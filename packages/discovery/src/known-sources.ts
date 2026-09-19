import type { ScoutProfile } from "@event-scout/shared";
import type { QueryGroup, QuerySpec } from "./types.js";

export type KnownSourcePriority = "high" | "medium";

interface KnownSourceBase {
  id: string;
  name: string;
  priority: KnownSourcePriority;
  notes?: string;
}

interface KnownMeetupGroup extends KnownSourceBase {
  slug: string;
  queryTerms: string;
}

interface KnownLumaSource extends KnownSourceBase {
  url: string;
  queryText: string;
}

interface KnownIndexedSource extends KnownSourceBase {
  group: QueryGroup;
  includeDomains?: string[];
  queryText: string;
}

interface KnownXSource extends KnownSourceBase {
  handle: string;
  queryText: string;
}

const SOURCE_RESULTS_PER_QUERY = 8;

export const KNOWN_MEETUP_GROUPS: KnownMeetupGroup[] = [
  {
    id: "meetup-sfbay-ai",
    name: "SF AI",
    priority: "high",
    slug: "sfbay-ai",
    queryTerms: '"AI" OR "LLM" OR "GenAI" OR "Agentic AI" OR "agents"',
    notes: "Large SF AI/GenAI group."
  },
  {
    id: "meetup-sfentrepreneur",
    name: "San Francisco Entrepreneurs & Startups",
    priority: "high",
    slug: "sfentrepreneur",
    queryTerms: '"startup" OR "founder" OR "VC" OR "pitch" OR "cofounder"',
    notes: "Large founder/startup Meetup group; downstream scoring should penalize generic online sessions."
  },
  {
    id: "meetup-sf-python",
    name: "San Francisco Python Meetup Group",
    priority: "medium",
    slug: "sfpython",
    queryTerms: '"AI" OR "agents" OR "LLM" OR "startup" OR "builders"',
    notes: "Developer-heavy group; useful when AI builder topics show up."
  },
  {
    id: "meetup-ai-user-group",
    name: "SF Bay Area AI User Group",
    priority: "medium",
    slug: "ai-user-group",
    queryTerms: '"AI" OR "Generative AI" OR "developers" OR "production"',
    notes: "Practical AI user group found during source review."
  },
  {
    id: "meetup-multi-agent-systems",
    name: "SFBay Multi Agent Systems",
    priority: "medium",
    slug: "sfbay-multi-agent-systems",
    queryTerms: '"multi-agent" OR "agents" OR "AI systems" OR "builders"',
    notes: "Small but very on-profile niche source."
  }
];

export const KNOWN_LUMA_SOURCES: KnownLumaSource[] = [
  {
    id: "luma-sahar-bond-ai",
    name: "Sahar Mor / Bond AI",
    priority: "high",
    url: "https://luma.com/user/saharmor",
    queryText: 'site:luma.com ("Sahar Mor" OR "Bond AI") ("San Francisco" OR "Bay Area" OR "AI")',
    notes: "High-signal Bond AI host profile; public Luma user/calendar surface."
  },
  {
    id: "luma-bfc",
    name: "Bay Area Founders Club",
    priority: "high",
    url: "https://luma.com/bfc",
    queryText: 'site:luma.com ("Bay Area Founders Club" OR "BFC" OR "Dr. Paul Fang") ("AI" OR "founder" OR "startup")',
    notes: "Large Bay Area founder community with frequent Luma event links."
  },
  {
    id: "luma-yc-startup-school",
    name: "YC Startup School Calendar",
    priority: "medium",
    url: "https://luma.com/ycss",
    queryText: 'site:luma.com ("YC Startup School" OR "Startup School") ("founder" OR "AI" OR "afterparty")',
    notes: "Useful around YC Startup School and side-event clusters."
  },
  {
    id: "luma-startx",
    name: "StartX Founder Exclusive",
    priority: "medium",
    url: "https://luma.com/StartXSession",
    queryText: 'site:luma.com ("StartX" OR "Stanford") ("founder" OR "AI" OR "startup")',
    notes: "Stanford founder network; may include alumni/cohort-only events."
  }
];

export const KNOWN_INDEXED_SOURCES: KnownIndexedSource[] = [
  {
    id: "newsletter-kyosuke",
    name: "Kyosuke's Newsletter",
    priority: "medium",
    group: "source_discovery",
    includeDomains: ["kyosuketogami.substack.com"],
    queryText: 'site:kyosuketogami.substack.com ("Tech Events in SF Bay Area" OR "SF Tech Events") ("AI" OR "startup" OR "founder")',
    notes: "Newsletter that regularly aggregates many SF tech events."
  },
  {
    id: "newsletter-bfc",
    name: "Bay Area Founders Club Substack",
    priority: "high",
    group: "source_discovery",
    includeDomains: ["bayareafoundersclub.substack.com"],
    queryText: 'site:bayareafoundersclub.substack.com ("Bay Area Events" OR "curated events") ("AI" OR "founder" OR "startup")',
    notes: "BFC weekly roundup often exposes Luma links and private/community sources."
  },
  {
    id: "institution-yc-startup-school",
    name: "Y Combinator Startup School",
    priority: "medium",
    group: "source_discovery",
    includeDomains: ["ycstartupschools.com"],
    queryText: 'site:ycstartupschools.com ("Startup School" OR "founders") ("San Francisco" OR "SF")',
    notes: "Official YC Startup School surface; source for side-event timing."
  },
  {
    id: "institution-startx-ai",
    name: "StartX AI",
    priority: "medium",
    group: "source_discovery",
    includeDomains: ["startx.com", "web.startx.com"],
    queryText: 'site:startx.com OR site:web.startx.com ("StartX AI" OR "AI founders" OR "exclusive events")',
    notes: "Stanford founder ecosystem source."
  },
  {
    id: "institution-skydeck",
    name: "Berkeley SkyDeck",
    priority: "medium",
    group: "source_discovery",
    queryText: '("Berkeley SkyDeck" OR "UC Berkeley SkyDeck") ("Luma" OR "events" OR "demo day" OR "founders")',
    notes: "UC Berkeley entrepreneurship ecosystem source."
  },
  {
    id: "aggregator-fogcity",
    name: "Fog City Events",
    priority: "medium",
    group: "semantic_web",
    includeDomains: ["fogcity.events"],
    queryText: 'site:fogcity.events ("Luma Event Link" OR "RSVP") ("AI" OR "founder" OR "startup" OR "agents")',
    notes: "Public SF events aggregator that can reveal Luma links."
  }
];

export const KNOWN_X_SOURCES: KnownXSource[] = [
  {
    id: "x-theaievangelist",
    name: "Sahar Mor / Bond AI",
    priority: "high",
    handle: "theaievangelist",
    queryText: 'from:theaievangelist (url:lu.ma OR "RSVP" OR "San Francisco" OR "Bay Area" OR "AI event") -is:retweet',
    notes: "Bond AI founder account."
  },
  {
    id: "x-kyosukesf",
    name: "Kyosuke",
    priority: "medium",
    handle: "kyosukesf",
    queryText: 'from:kyosukesf ("Tech Events" OR "SFTech" OR "AIEvents" OR url:airtable.com OR url:lu.ma) -is:retweet',
    notes: "Newsletter author account observed publishing SF tech event lists."
  },
  {
    id: "x-ycombinator",
    name: "Y Combinator",
    priority: "medium",
    handle: "ycombinator",
    queryText: 'from:ycombinator ("Startup School" OR "San Francisco" OR "founders" OR "AI") -is:retweet',
    notes: "Official YC account; useful for Startup School timing and official event announcements."
  }
];

function withYear(text: string, year: number): string {
  return `${text} ${year}`;
}

function enabledFor<T extends KnownSourceBase>(sources: T[], profile: ScoutProfile): T[] {
  const disabled = new Set(profile.sources.disable.map((value) => value.toLowerCase()));
  return sources.filter((source) => !disabled.has(source.id.toLowerCase()));
}

export function buildKnownSourceQueries(now: Date, profile: ScoutProfile): QuerySpec[] {
  const year = now.getFullYear();

  const meetupQueries: QuerySpec[] = enabledFor(KNOWN_MEETUP_GROUPS, profile).map((source) => ({
    id: `${source.id}-${year}`,
    group: "meetup",
    connector: "exa",
    text: `site:meetup.com/${source.slug}/events (${source.queryTerms}) ("upcoming" OR "${year}")`,
    maxResults: SOURCE_RESULTS_PER_QUERY,
    includeDomains: ["meetup.com"],
    recencyDays: 30,
    notes: `${source.name}. ${source.notes ?? ""}`.trim()
  }));

  const lumaQueries: QuerySpec[] = enabledFor(KNOWN_LUMA_SOURCES, profile).map((source) => ({
    id: `${source.id}-${year}`,
    group: "luma",
    connector: "exa",
    text: withYear(source.queryText, year),
    maxResults: SOURCE_RESULTS_PER_QUERY,
    includeDomains: ["luma.com"],
    recencyDays: 30,
    notes: `${source.name}. ${source.notes ?? ""}`.trim()
  }));

  const indexedQueries: QuerySpec[] = enabledFor(KNOWN_INDEXED_SOURCES, profile).map((source) => ({
    id: `${source.id}-${year}`,
    group: source.group,
    connector: "exa",
    text: withYear(source.queryText, year),
    maxResults: SOURCE_RESULTS_PER_QUERY,
    includeDomains: source.includeDomains,
    recencyDays: 45,
    notes: `${source.name}. ${source.notes ?? ""}`.trim()
  }));

  const xQueries: QuerySpec[] = enabledFor(KNOWN_X_SOURCES, profile).map((source) => ({
    id: `${source.id}-${year}`,
    group: "x",
    connector: "x",
    text: source.queryText,
    maxResults: source.priority === "high" ? 50 : 35,
    recencyDays: 7,
    notes: `${source.name}. ${source.notes ?? ""}`.trim()
  }));

  return [...meetupQueries, ...lumaQueries, ...indexedQueries, ...xQueries];
}

export function knownLumaSeedUrls(profile: ScoutProfile): string[] {
  return enabledFor(KNOWN_LUMA_SOURCES, profile)
    .filter((source) => source.id !== "luma-yc-startup-school")
    .map((source) => source.url);
}
