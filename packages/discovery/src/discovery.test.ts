import assert from "node:assert/strict";
import test from "node:test";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_PROFILE, loadEnv, loadProfile, type AppEnv, type ScoutProfile } from "@event-scout/shared";
import { discoverCandidates, getDefaultMemoryDiscoveryRepository } from "./index.js";
import { ingestCandidates } from "./ingest.js";
import {
  classifyCandidateIntent,
  classifyRejectionReason,
  hasExplicitPastEventDate,
  isEventbriteUrl,
  isMeetupUrl,
  isNonEventLink,
  normalizeCandidateUrl,
  scoreCandidateSignal
} from "./normalize.js";
import { buildDailyQueryPack } from "./query-packs.js";
import { runExaDiscovery } from "./exa.js";
import { extractCandidateLinks, runPublicSourceDiscovery } from "./public-source.js";
import { parseFeedEntries, runRssDiscovery } from "./rss.js";
import { runXDiscovery } from "./x.js";
import type { QuerySpec } from "./types.js";

const profile = DEFAULT_PROFILE;
const baseEnv: AppEnv = {
  ...loadEnv({ MOCK_MODE: "true" }),
  adminPort: 8787,
  budgets: {
    maxExaSearchesPerRun: 2,
    maxXPostsPerRun: 2,
    maxXPostsPerDay: 2,
    maxFirecrawlPagesPerRun: 0,
    maxLlmExtractCandidatesPerRun: 0,
    maxLlmScoreEventsPerRun: 0,
    maxRecommendationsPerRun: 0
  },
  timeouts: {
    exaMs: 1000,
    xMs: 1000,
    firecrawlMs: 1000,
    pageFetchMs: 1000,
    llmMs: 1000,
    telegramMs: 1000,
    postgresConnectionMs: 1000,
    postgresQueryMs: 1000
  }
};

function presetProfile(name: string): ScoutProfile {
  return loadProfile({ cwd: dirname(fileURLToPath(import.meta.url)), env: { SCOUT_PROFILE: name } }).profile;
}

test("normalizeCandidateUrl removes tracking noise and keeps meaningful params", () => {
  assert.equal(
    normalizeCandidateUrl("https://www.lu.ma/event-slug/?utm_source=x&ref=abc&invite=keep#section"),
    "https://lu.ma/event-slug?invite=keep"
  );
});

test("classifyRejectionReason rejects explicit past event dates before extraction", () => {
  const now = new Date("2026-08-23T12:00:00-07:00");

  assert.equal(
    classifyRejectionReason(
      {
        canonicalUrl: "https://example.com/events/2024/09/12/ai-founders-dinner",
        title: "AI Founders Dinner",
        snippet: "Small dinner for AI founders in SF."
      },
      { now, profile }
    ),
    "past_event_explicit_date"
  );

  assert.equal(
    classifyRejectionReason(
      {
        canonicalUrl: "https://example.com/events/ai-builders",
        title: "AI Builders Salon September 12, 2024",
        snippet: "Join founders in San Francisco."
      },
      { now, profile }
    ),
    "past_event_explicit_date"
  );

  assert.equal(
    classifyRejectionReason(
      {
        canonicalUrl: "https://example.com/events/agent-demo",
        title: "Agent Demo Night",
        snippet: "Event recap from 2025 with videos and photos."
      },
      { now, profile }
    ),
    "past_event_explicit_date"
  );
});

test("past event date detection keeps future explicit dates eligible", () => {
  const now = new Date("2026-08-23T12:00:00-07:00");
  assert.equal(hasExplicitPastEventDate("AI founders dinner September 12, 2026 in SF", now), false);
  assert.equal(
    classifyRejectionReason(
      {
        canonicalUrl: "https://lu.ma/ai-founders-2026-09-12",
        title: "AI Founders Dinner",
        snippet: "Approval required dinner in San Francisco."
      },
      { now, profile }
    ),
    undefined
  );
});

test("past event date detection does not reject listing-derived snippets", () => {
  const now = new Date("2026-08-23T12:00:00-07:00");
  const candidate = {
    canonicalUrl: "https://foundercal.com/events/agents-in-production-devtools-demo-night-ZyFjwNGmPr04VjZ",
    title: "Public source link from FounderCal SF",
    snippet:
      "199 upcoming startup & tech events in San Francisco. Startup School 2026 July 25-26. Agents in Production Devtools Demo Night September 10, 2026."
  };

  assert.equal(classifyRejectionReason(candidate, { now, profile }), undefined);
  assert.ok(scoreCandidateSignal(candidate, profile) >= 40);
});

test("classifyCandidateIntent separates event pages from source/listing pages without keyword hard rejects", () => {
  assert.equal(
    classifyCandidateIntent({
      canonicalUrl: "https://lu.ma/agent-demo-night",
      title: "Agent Demo Night",
      snippet: "Apply to attend this San Francisco builder demo night on September 12, 2026."
    }, profile),
    "concrete_event"
  );
  assert.equal(
    classifyCandidateIntent({
      canonicalUrl: "https://sf.aitinkerers.org/events",
      title: "AI Tinkerers - San Francisco - Events",
      snippet: "Upcoming events calendar with builder demos in San Francisco."
    }, profile),
    "listing_source"
  );
  assert.equal(
    classifyCandidateIntent({
      canonicalUrl: "https://homebrewclub.berrry.app/",
      title: "Homebrew Club — Community Coworking Space",
      snippet: "Community space and event space in San Francisco."
    }, profile),
    "organizer_source"
  );
  assert.equal(
    classifyCandidateIntent({
      canonicalUrl: "https://eventbrite.com/e/founder-conference-side-dinner-tickets-123",
      title: "Founder Conference Side Dinner",
      snippet: "San Francisco dinner. Apply to attend."
    }, profile),
    "concrete_event"
  );
});

test("classifyRejectionReason rejects hackathon-style time sinks", () => {
  const now = new Date("2026-08-23T12:00:00-07:00");

  assert.equal(
    classifyRejectionReason(
      {
        canonicalUrl: "https://lu.ma/ai-agent-hackathon",
        title: "AI Agent Hackathon",
        snippet: "Two-day buildathon for founders and developers in San Francisco."
      },
      { now, profile }
    ),
    "excluded_format:hackathon"
  );

  assert.ok(
    scoreCandidateSignal({
      canonicalUrl: "https://lu.ma/ai-agent-hackathon",
      title: "AI Agent Hackathon",
      snippet: "Two-day buildathon for founders and developers in San Francisco."
    }, profile) < 75
  );
});

test("classifyRejectionReason rejects excluded topics and eligibility gates from the profile", () => {
  const now = new Date("2026-08-23T12:00:00-07:00");

  assert.equal(
    classifyRejectionReason(
      {
        canonicalUrl: "https://lu.ma/physical-ai-research-club",
        title: "Physical AI Research Club",
        snippet: "Frontier research discussion for robotics PhDs, postdocs, and research scientists in San Francisco."
      },
      { now, profile }
    ),
    "excluded_topic:physical ai"
  );

  assert.equal(
    classifyRejectionReason(
      {
        canonicalUrl: "https://lu.ma/series-a-founder-dinner",
        title: "AI Founder Dinner",
        snippet: "Private dinner for Series A+ founders only."
      },
      { now, profile }
    ),
    "eligibility_gate:series a+"
  );
});

test("classifyRejectionReason follows the active profile, not hardcoded preferences", () => {
  const now = new Date("2026-08-23T12:00:00-07:00");
  const robotics = {
    canonicalUrl: "https://lu.ma/robotics-founders",
    title: "Robotics Founders Dinner",
    snippet: "Approval required dinner in San Francisco."
  };

  assert.equal(classifyRejectionReason(robotics, { now, profile }), "excluded_topic:robotics");
  assert.equal(classifyRejectionReason(robotics, { now, profile: presetProfile("fintech") }), undefined);
  assert.equal(
    classifyRejectionReason(
      { canonicalUrl: "https://lu.ma/sale", title: "Founder Dinner", snippet: "Tickets on sale now for pre-revenue founders in SF." },
      { now, profile }
    ),
    undefined
  );
});

test("buildDailyQueryPack searches for the profile's own topics", () => {
  const now = new Date("2026-08-22T12:00:00Z");
  const fintech = presetProfile("fintech");
  const agendaText = (pack: ReturnType<typeof buildDailyQueryPack>) =>
    pack.filter((query) => !query.id.startsWith("registry-")).map((query) => query.text).join("\n");

  const defaultText = agendaText(buildDailyQueryPack(now, { scanTime: "09:00", profile }));
  const fintechText = agendaText(buildDailyQueryPack(now, { scanTime: "09:00", profile: fintech }));

  assert.ok(defaultText.includes("\"consumer AI founders\""));
  assert.ok(fintechText.includes("\"fintech founders\""));
  assert.ok(fintechText.includes("\"payments founders\""));
  assert.equal(fintechText.includes("consumer AI"), false);
  assert.equal(fintechText.includes("agent builders"), false);
});

test("profile sources can disable built-in sources and add new ones", () => {
  const now = new Date("2026-08-22T12:00:00Z");
  const custom: ScoutProfile = {
    ...profile,
    sources: {
      disable: ["luma-south-park-commons", "research"],
      add: [
        { name: "My Fintech Calendar", kind: "luma_calendar", url: "https://luma.com/my-fintech", priority: "must_scan" },
        { name: "Payments Organizer", kind: "x_account", handle: "@paymentsorg", priority: "high" }
      ]
    }
  };
  const pack = buildDailyQueryPack(now, { profile: custom });
  const seedUrls = pack.flatMap((query) => query.seedUrls ?? []);
  const queryText = pack.map((query) => query.text).join("\n");

  assert.equal(seedUrls.includes("https://luma.com/southparkcommons-events"), false);
  assert.equal(queryText.includes("Frontier Syndicate"), false);
  assert.ok(seedUrls.includes("https://luma.com/my-fintech"));
  assert.ok(queryText.includes("site:luma.com/my-fintech"));
  assert.ok(queryText.includes("from:paymentsorg"));
});

test("buildDailyQueryPack includes separate Exa, X, LinkedIn indexed, and Luma seed surfaces", () => {
  const pack = buildDailyQueryPack(new Date("2026-08-22T12:00:00Z"), { profile });
  assert.ok(pack.some((query) => query.connector === "exa" && query.group === "luma"));
  assert.ok(pack.some((query) => query.connector === "exa" && query.group === "meetup"));
  assert.ok(pack.some((query) => query.connector === "exa" && query.group === "eventbrite"));
  assert.ok(pack.some((query) => query.connector === "exa" && query.group === "source_discovery"));
  assert.ok(pack.some((query) => query.connector === "x"));
  assert.ok(pack.some((query) => query.group === "linkedin_indexed"));
  assert.ok(pack.some((query) => query.connector === "luma_seed"));
});

test("buildDailyQueryPack targets a wide discovery pass before deep filtering", () => {
  const pack = buildDailyQueryPack(new Date("2026-08-22T12:00:00Z"), { profile });
  const exaRawResultCapacity = pack
    .filter((query) => query.connector === "exa")
    .slice(0, 50)
    .reduce((sum, query) => sum + query.maxResults, 0);
  const xPostCapacity = pack
    .filter((query) => query.connector === "x")
    .reduce((sum, query) => sum + query.maxResults, 0);

  assert.ok(exaRawResultCapacity >= 200);
  assert.ok(exaRawResultCapacity < 350);
  assert.ok(xPostCapacity >= 150);
});

test("buildDailyQueryPack includes tracked high-quality source surfaces", () => {
  const pack = buildDailyQueryPack(new Date("2026-08-22T12:00:00Z"), { profile });
  const queryText = pack.map((query) => query.text).join("\n");
  const seedUrls = pack.flatMap((query) => query.seedUrls ?? []);

  assert.ok(queryText.includes("site:meetup.com/sfbay-ai/events"));
  assert.ok(queryText.includes("site:meetup.com/sfentrepreneur/events"));
  assert.ok(queryText.includes("Bond AI"));
  assert.ok(queryText.includes("bayareafoundersclub.substack.com"));
  assert.ok(queryText.includes("kyosuketogami.substack.com"));
  assert.ok(queryText.includes("justmovetosf.com/events"));
  assert.ok(queryText.includes("90.gold/events"));
  assert.ok(queryText.includes("SHACK15"));
  assert.ok(queryText.includes("StartupHQ"));
  assert.ok(queryText.includes("SignalFire Events"));
  assert.ok(queryText.includes("malaikacommons.com/events"));
  assert.ok(queryText.includes("Brex Startup Community"));
  assert.ok(queryText.includes("Pitch & Run"));
  assert.ok(queryText.includes("Founders Common"));
  assert.ok(queryText.includes("AI Hustle"));
  assert.ok(queryText.includes("site:lu.ma/cspedjbp"));
  assert.ok(queryText.includes("AI After Hours"));
  assert.ok(queryText.includes("Founders You Should Know"));
  assert.ok(queryText.includes("garysguide.com/events"));
  assert.ok(queryText.includes("cerebralvalley.ai/events"));
  assert.ok(queryText.includes("Climate Tech Bay Area"));
  assert.ok(queryText.includes("GP Dinners"));
  assert.ok(queryText.includes("from:michelleefang"));
  assert.ok(queryText.includes("from:thechangj"));
  assert.ok(queryText.includes("from:JoshConstine"));
  assert.ok(queryText.includes("from:theaievangelist"));
  assert.ok(queryText.includes("from:kyosukesf"));
  assert.ok(queryText.includes("from:fdotinc"));
  assert.ok(queryText.includes("from:southpkcommons"));
  assert.ok(queryText.includes("from:marianebekker"));
  assert.ok(queryText.includes("from:founders_cafe"));
  assert.ok(queryText.includes("from:frontiertower"));
  assert.ok(queryText.includes("from:pear_vc"));
  assert.ok(queryText.includes("from:AITinkerers"));
  assert.ok(queryText.includes("-hackathon"));
  assert.ok(queryText.includes("\"August 2026\""));
  assert.ok(queryText.includes("\"September 2026\""));
  assert.ok(queryText.includes("\"October 2026\""));
  assert.ok(seedUrls.includes("https://luma.com/user/saharmor"));
  assert.ok(seedUrls.includes("https://luma.com/bfc"));
  assert.ok(!seedUrls.includes("https://luma.com/ycss"));
  assert.ok(seedUrls.includes("https://luma.com/calendar/cal-nMqbWGTGmLVubAx"));
  assert.ok(seedUrls.includes("https://luma.com/southparkcommons-events"));
  assert.ok(seedUrls.includes("https://luma.com/inception-studio"));
  assert.ok(seedUrls.includes("https://luma.com/foundersocialclub"));
  assert.ok(seedUrls.includes("https://luma.com/brderless"));
  assert.ok(seedUrls.includes("https://luma.com/founderscafe"));
  assert.ok(seedUrls.includes("https://luma.com/eChaiSF"));
  assert.ok(seedUrls.includes("https://luma.com/_ai"));
  assert.ok(seedUrls.includes("https://lu.ma/brexevents"));
  assert.ok(seedUrls.includes("https://luma.com/pnr"));
  assert.ok(seedUrls.includes("https://lu.ma/founderscommon"));
  assert.ok(seedUrls.includes("https://lu.ma/user/usr-HGhLx5Y8wzhj0Oh"));
  assert.ok(seedUrls.includes("https://lu.ma/cspedjbp"));
  assert.ok(seedUrls.includes("https://lu.ma/artificially-intelligent"));
  assert.ok(seedUrls.includes("https://sam.events/tech"));
  assert.ok(seedUrls.includes("https://sam.events/this-week"));
  assert.ok(seedUrls.includes("https://sam.events/plan-ahead"));
  assert.ok(seedUrls.includes("https://sam.events/free"));
  assert.ok(seedUrls.includes("https://sam.events/women"));
  assert.ok(!seedUrls.includes("https://foundercal.com/cities/sf"));
  assert.ok(queryText.includes("Founders Inc"));
  assert.ok(queryText.includes("Founders Bay"));
  assert.ok(queryText.includes("AI Tinkerers San Francisco"));
  assert.ok(queryText.includes("South Park Commons"));
  assert.ok(queryText.includes("Inception Studio"));
  assert.ok(queryText.includes("Founder Social Club"));
  assert.ok(queryText.includes("Brderless"));
  assert.ok(queryText.includes("Pear Events Calendar"));
  assert.ok(queryText.includes("site:sam.events/tech"));
  const samTechQuery = pack.find((query) => query.seedUrls?.includes("https://sam.events/tech"));
  assert.equal(samTechQuery?.maxCandidateLinks, 80);
  assert.equal(samTechQuery?.sourceScore, 96);
  assert.ok(pack.some((query) => query.connector === "public_source"));
  assert.ok(pack.some((query) => query.connector === "rss"));
});

test("buildDailyQueryPack diversifies scheduled scan windows", () => {
  const now = new Date("2026-08-22T12:00:00Z");
  const morning = buildDailyQueryPack(now, { scanTime: "09:00", profile });
  const midday = buildDailyQueryPack(now, { scanTime: "14:00", profile });
  const evening = buildDailyQueryPack(now, { scanTime: "22:00", profile });

  assert.ok(morning.some((query) => query.connector === "x"));
  assert.equal(midday.some((query) => query.connector === "x"), false);
  assert.equal(evening.some((query) => query.connector === "x"), false);
  assert.ok(midday.some((query) => query.id.startsWith("midday-")));
  assert.ok(evening.some((query) => query.id.startsWith("evening-")));

  const morningPublic = queryIds(morning, "public_source");
  const middayPublic = queryIds(midday, "public_source");
  const eveningPublic = queryIds(evening, "public_source");
  assert.ok(overlapRatio(morningPublic, middayPublic) < 0.75);
  assert.ok(overlapRatio(middayPublic, eveningPublic) < 0.75);
});

test("buildDailyQueryPack rotates scheduled sources across days", () => {
  const today = buildDailyQueryPack(new Date("2026-08-22T12:00:00Z"), { scanTime: "14:00", profile });
  const tomorrow = buildDailyQueryPack(new Date("2026-08-23T12:00:00Z"), { scanTime: "14:00", profile });

  const todayPublic = queryIds(today, "public_source");
  const tomorrowPublic = queryIds(tomorrow, "public_source");
  assert.ok(todayPublic.size > 0);
  assert.ok(tomorrowPublic.size > 0);
  assert.ok(overlapRatio(todayPublic, tomorrowPublic) < 0.9);
});

test("extractCandidateLinks pulls event links from public source pages", () => {
  const links = extractCandidateLinks(
    `
    <html>
      <a href="https://lu.ma/agent-dinner?utm_source=newsletter">Agent dinner</a>
      <a href="/events/internal-founder-breakfast">Founder breakfast</a>
      <a href="mailto:test@example.com">Mail</a>
    </html>
    `,
    "https://example.com/roundup"
  );

  assert.ok(links.includes("https://lu.ma/agent-dinner"));
  assert.ok(links.includes("https://example.com/events/internal-founder-breakfast"));
  assert.equal(links.some((link) => link.startsWith("mailto:")), false);
});

test("extractCandidateLinks ignores <link> tags (favicon, stylesheet, canonical), not just <a> tags", () => {
  // Regression test: a same-origin favicon on a known event platform's own discovery page (e.g.
  // Luma's own /sf page links a relative /favicon.ico) used to be scraped by a bare href-attribute
  // scan and absolutized into a fake candidate like https://lu.ma/favicon.ico, which then passed
  // the known-platform filter because the host matched.
  const links = extractCandidateLinks(
    `
    <html>
      <head>
        <link rel="shortcut icon" href="/favicon.ico" />
        <link rel="stylesheet" href="/styles.css" />
        <link rel="canonical" href="https://lu.ma/sf" />
      </head>
      <body>
        <a href="https://lu.ma/agent-dinner">Agent dinner</a>
      </body>
    </html>
    `,
    "https://lu.ma/sf"
  );

  assert.ok(links.includes("https://lu.ma/agent-dinner"));
  assert.equal(links.some((link) => link.includes("favicon")), false);
  assert.equal(links.some((link) => link.includes("styles.css")), false);
});

test("runPublicSourceDiscovery fetches free public pages and emits event candidates", async () => {
  const queryPack: QuerySpec[] = [
    {
      id: "public-source-test",
      group: "public_source",
      connector: "public_source",
      text: "public source test",
      maxResults: 1,
      seedUrls: ["https://example.com/events"],
      sourceName: "Example Events",
      sourceType: "organizer_site",
      sourceScore: 97,
      maxCandidateLinks: 2
    }
  ];
  const fetchImpl: typeof fetch = async () =>
    new Response(
      '<title>Example Events</title><a href="https://lu.ma/ai-founder-dinner">AI Founder Dinner</a><a href="https://lu.ma/operator-breakfast">Operator Breakfast</a><a href="https://lu.ma/extra-demo-night">Extra Demo Night</a>'
    );

  const candidates = await runPublicSourceDiscovery("run-public", queryPack, { ...baseEnv, mockMode: false }, {
    fetchImpl,
    now: new Date("2026-08-22T12:00:00Z")
  });

  assert.equal(candidates.length, 2);
  assert.equal(candidates[0]?.sourcePlatform, "luma");
  assert.equal(candidates[0]?.canonicalUrl, "https://lu.ma/ai-founder-dinner");
  assert.ok((candidates[0]?.sourceScore ?? 0) >= 97);
});

test("parseFeedEntries and runRssDiscovery extract event links from free feeds", async () => {
  const feed = `<?xml version="1.0"?>
    <rss><channel><item>
      <title>Bay Area Events This Week</title>
      <link>https://newsletter.example.com/p/events</link>
      <description><![CDATA[RSVP: https://lu.ma/agent-breakfast?utm_source=feed]]></description>
      <pubDate>Sat, 22 Aug 2026 12:00:00 GMT</pubDate>
    </item></channel></rss>`;
  assert.equal(parseFeedEntries(feed)[0]?.title, "Bay Area Events This Week");

  const queryPack: QuerySpec[] = [
    {
      id: "rss-test",
      group: "rss_feed",
      connector: "rss",
      text: "rss test",
      maxResults: 3,
      seedUrls: ["https://newsletter.example.com/feed"],
      sourceName: "Example Newsletter",
      sourceType: "newsletter"
    }
  ];
  const fetchImpl: typeof fetch = async () => new Response(feed);
  const candidates = await runRssDiscovery("run-rss", queryPack, { ...baseEnv, mockMode: false }, {
    fetchImpl,
    now: new Date("2026-08-22T12:00:00Z")
  });

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]?.canonicalUrl, "https://lu.ma/agent-breakfast");
  assert.equal(candidates[0]?.sourcePlatform, "luma");
});

test("platform URL helpers identify Meetup and Eventbrite public pages", () => {
  assert.equal(isMeetupUrl("https://www.meetup.com/sf-ai/events/123"), true);
  assert.equal(isEventbriteUrl("https://www.eventbrite.com/e/ai-founder-dinner-tickets-123"), true);
  assert.equal(isMeetupUrl("https://example.com/meetup-not-platform"), false);
});

test("runExaDiscovery classifies Meetup and Eventbrite result platforms", async () => {
  const queryPack: QuerySpec[] = [
    {
      id: "platform-test",
      group: "eventbrite",
      connector: "exa",
      text: "AI founder event SF",
      maxResults: 2
    }
  ];
  const env: AppEnv = { ...baseEnv, mockMode: false, exaApiKey: "exa" };
  const fetchImpl: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        results: [
          { id: "meetup-1", title: "AI Builders Meetup SF", url: "https://www.meetup.com/sf-ai/events/123", highlights: ["Upcoming AI builders meetup."] },
          { id: "eventbrite-1", title: "AI Founder Dinner", url: "https://www.eventbrite.com/e/ai-founder-dinner-tickets-123", highlights: ["San Francisco founder dinner."] }
        ]
      })
    );

  const candidates = await runExaDiscovery("run-platform", queryPack, env, {
    fetchImpl,
    now: new Date("2026-08-22T12:00:00Z")
  });

  assert.equal(candidates.find((candidate) => candidate.sourceId === "meetup-1")?.sourcePlatform, "meetup");
  assert.equal(candidates.find((candidate) => candidate.sourceId === "eventbrite-1")?.sourcePlatform, "eventbrite");
});

test("scoreCandidateSignal boosts curated local builder events over generic online events", () => {
  const strong = scoreCandidateSignal({
    canonicalUrl: "https://lu.ma/ai-founder-dinner",
    title: "AI Founder Dinner San Francisco",
    snippet: "Approval required dinner for agent builders and operators."
  }, profile);
  const weak = scoreCandidateSignal({
    canonicalUrl: "https://example.com/webinar",
    title: "Online AI Webinar Course",
    snippet: "Virtual only vendor training and sponsorship."
  }, profile);
  assert.ok(strong > weak);
  assert.ok(strong >= 80);
});

test("runXDiscovery uses X API response entities and honors max post budget", async () => {
  const queryPack: QuerySpec[] = [
    {
      id: "x-test",
      group: "x",
      connector: "x",
      text: '"lu.ma" "SF"',
      maxResults: 40
    }
  ];

  const env: AppEnv = {
    ...baseEnv,
    mockMode: false,
    xBearerToken: "token",
    budgets: {
      ...baseEnv.budgets,
      maxXPostsPerRun: 1
    }
  };

  const calls: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    calls.push(String(input));
    return new Response(
      JSON.stringify({
        data: [
          {
            id: "10",
            text: "Apply here https://t.co/a",
            author_id: "u1",
            created_at: "2026-08-22T10:00:00Z",
            entities: {
              urls: [{ expanded_url: "https://lu.ma/agents?utm_source=x" }]
            }
          }
        ],
        includes: {
          users: [{ id: "u1", name: "Builder", username: "builder" }]
        }
      })
    );
  };

  const candidates = await runXDiscovery("run-1", queryPack, env, { fetchImpl, now: new Date("2026-08-22T12:00:00Z") });
  assert.equal(calls.length, 1);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]?.canonicalUrl, "https://lu.ma/agents");
  assert.equal(candidates[0]?.sourcePlatform, "x");
  assert.equal(candidates[0]?.sourceHandle, "builder");
});

test("runXDiscovery returns skip marker when X post budget is zero", async () => {
  const candidates = await runXDiscovery(
    "run-zero",
    [{ id: "x-zero", group: "x", connector: "x", text: '"agents" "SF"', maxResults: 40 }],
    {
      ...baseEnv,
      budgets: {
        ...baseEnv.budgets,
        maxXPostsPerRun: 0
      }
    },
    { now: new Date("2026-08-22T12:00:00Z") }
  );
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]?.status, "rejected");
  assert.equal(candidates[0]?.rejectionReason, "x_skipped_due_to_schedule_or_budget");
});

test("discoverCandidates records X skip marker when schedule disables X", async () => {
  const candidates = await discoverCandidates(baseEnv, undefined, undefined, {
    now: new Date("2026-08-22T20:30:00Z"),
    runContext: {
      scanMode: "light",
      xEnabled: false,
      xBudgetRemaining: 2
    }
  });
  const skip = candidates.find((candidate) => candidate.rejectionReason === "x_skipped_due_to_schedule_or_budget");
  assert.equal(skip?.sourcePlatform, "x");
  assert.equal(skip?.status, "rejected");
});

test("discoverCandidates keeps MOCK_MODE=true working and ingests table-shaped rows", async () => {
  const repo = getDefaultMemoryDiscoveryRepository();
  const before = repo.candidateUrls.length;
  const candidates = await discoverCandidates(baseEnv, undefined, repo, { now: new Date("2026-08-22T12:00:00Z") });
  assert.ok(candidates.length > 0);
  assert.ok(repo.candidateUrls.length > before);
  assert.ok(repo.queries.length > 0);
  assert.ok(repo.sources.size > 0);
  assert.ok(repo.sourceEdges.length > 0);
});

test("ingestCandidates stores weak candidates instead of dropping them", async () => {
  const weak = {
    id: "weak-1",
    runId: "run-weak",
    sourcePlatform: "exa" as const,
    sourceUrl: "https://example.com/job-fair",
    url: "https://example.com/job-fair?utm_campaign=noise",
    canonicalUrl: "https://example.com/job-fair",
    sourceQuery: "generic networking",
    title: "Generic Job Fair",
    snippet: "Large job fair and vendor webinar.",
    discoveredAt: "2026-08-22T12:00:00Z",
    evidence: ["test"],
    status: "rejected" as const,
    rejectionReason: "obvious_low_signal_or_junk"
  };

  const result = await ingestCandidates("run-weak", [weak], []);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0]?.rejectionReason, "obvious_low_signal_or_junk");
});

function queryIds(pack: ReturnType<typeof buildDailyQueryPack>, connector: string): Set<string> {
  return new Set(pack.filter((query) => query.connector === connector).map((query) => query.id));
}

function overlapRatio(left: Set<string>, right: Set<string>): number {
  const smaller = left.size < right.size ? left : right;
  const larger = left.size < right.size ? right : left;
  if (smaller.size === 0) return 0;
  let overlap = 0;
  for (const value of smaller) {
    if (larger.has(value)) overlap += 1;
  }
  return overlap / smaller.size;
}

test("isNonEventLink rejects static assets and app pages on event platforms", () => {
  assert.equal(isNonEventLink("https://lu.ma/favicon.ico"), true);
  assert.equal(isNonEventLink("https://example.com/images/logo.png"), true);
  assert.equal(isNonEventLink("https://luma.com/signin"), true);
  assert.equal(isNonEventLink("https://luma.com/explore"), true);
  assert.equal(isNonEventLink("https://luma.com/"), true);
  assert.equal(isNonEventLink("https://lu.ma/ai-founders-dinner"), false);
  assert.equal(isNonEventLink("https://www.eventbrite.com/e/founder-dinner-tickets-123"), false);
  assert.equal(isNonEventLink("https://example.com/events/founder-breakfast"), false);
});

test("extractCandidateLinks skips favicons, sign-in pages, and other non-event links", () => {
  const links = extractCandidateLinks(
    `<html><head><link rel="icon" href="https://lu.ma/favicon.ico"></head>
      <a href="https://luma.com/signin">Sign in</a>
      <a href="https://luma.com/founders-breakfast">Founders breakfast</a>
      <a href="/static/banner.png">Banner</a></html>`,
    "https://example.com/events"
  );
  assert.deepEqual(links, ["https://luma.com/founders-breakfast"]);
});
