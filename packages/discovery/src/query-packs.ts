import { searchExclusions, type ScoutProfile } from "@event-scout/shared";
import type { QuerySpec } from "./types.js";
import { buildKnownSourceQueries, knownLumaSeedUrls } from "./known-sources.js";
import { registrySourcesForProfile, sourceTypeForRegistryKind } from "./source-registry.js";
import type { RegistrySource, RegistrySourcePriority } from "./source-registry.js";

const DEFAULT_RESULTS_PER_QUERY = 12;
const REGISTRY_RESULTS_PER_QUERY = 5;

export interface QueryPackOptions {
  scanTime?: string;
  profile: ScoutProfile;
}

type ScanWindow = "morning" | "midday" | "evening";

/**
 * Words used to build search queries, all taken from the profile so a fintech or B2B
 * profile searches for its own events instead of the default consumer AI ones.
 */
interface QueryTerms {
  phrases: string[];
  rooms: string[];
  formats: string[];
  city: string;
  short: string;
  places: string[];
  nearbyCities: string[];
  areaLabel: string;
  exclusions: string;
}

function queryTerms(profile: ScoutProfile): QueryTerms {
  const { cities, aliases } = profile.region;
  const city = cities[0] ?? profile.region.name;
  const short = aliases[0] ?? city;
  const phrases = profile.search.phrases;
  return {
    phrases,
    rooms: profile.search.rooms.length ? profile.search.rooms : ["founder dinner", "founder breakfast", "operator roundtable"],
    formats: profile.formats.prefer.length ? profile.formats.prefer : ["dinner", "breakfast", "salon", "roundtable"],
    city,
    short,
    places: unique([short, city, aliases[1] ?? profile.region.name]),
    nearbyCities: cities.length > 1 ? cities.slice(1, 4) : [city],
    areaLabel: aliases[1] ?? profile.region.name,
    exclusions: searchExclusions(profile).join(" ")
  };
}

function pick<T>(values: T[], index: number): T {
  return values[index % values.length] as T;
}

function anyOf(values: string[]): string {
  return `(${unique(values).map((value) => `"${value}"`).join(" OR ")})`;
}

export function buildDailyQueryPack(now: Date, options: QueryPackOptions): QuerySpec[] {
  const year = now.getFullYear();
  const profile = options.profile;
  const scanWindow = scanWindowForTime(options.scanTime);
  const dateTerms = futureEventQueryTerms(now);
  const terms = queryTerms(profile);

  return [
    ...buildAgendaBaseQueries(year, scanWindow, dateTerms, terms),
    {
      id: `luma-public-seeds-${year}`,
      group: "luma_seed",
      connector: "luma_seed",
      text: "Known public Luma surfaces and calendars",
      maxResults: 10,
      seedUrls: [
        "https://lu.ma/sf",
        "https://lu.ma/ai",
        "https://lu.ma/san-francisco",
        "https://lu.ma/bay-area",
        ...knownLumaSeedUrls(profile),
        ...eligibleRegistrySources(profile, now, scanWindow, "luma_seed")
          .filter((source) => source.kind === "luma_calendar" && source.url)
          .map((source) => source.url as string)
      ]
    },
    ...buildRegistryQueryPack(now, profile, { scanWindow, dateTerms }),
    ...(scanWindow ? [] : buildKnownSourceQueries(now, profile))
  ];
}

function buildAgendaBaseQueries(year: number, scanWindow: ScanWindow | undefined, dateTerms: string, terms: QueryTerms): QuerySpec[] {
  const { phrases, rooms, formats, city, short, places, nearbyCities, areaLabel, exclusions } = terms;

  if (!scanWindow || scanWindow === "morning") {
    return [
      {
        id: `luma-topic-city-${year}`,
        group: "luma",
        connector: "exa",
        text: `site:lu.ma "${city}" "${pick(phrases, 0)}"`,
        maxResults: DEFAULT_RESULTS_PER_QUERY,
        includeDomains: ["lu.ma"],
        recencyDays: 21
      },
      {
        id: `luma-topic-short-${year}`,
        group: "luma",
        connector: "exa",
        text: `site:lu.ma "${short}" "${pick(phrases, 1)}"`,
        maxResults: DEFAULT_RESULTS_PER_QUERY,
        includeDomains: ["lu.ma"],
        recencyDays: 21
      },
      {
        id: `luma-room-city-${year}`,
        group: "luma",
        connector: "exa",
        text: `site:lu.ma "${pick(rooms, 0)}" "${city}"`,
        maxResults: DEFAULT_RESULTS_PER_QUERY,
        includeDomains: ["lu.ma"],
        recencyDays: 30
      },
      {
        id: `meetup-topic-city-${year}`,
        group: "meetup",
        connector: "exa",
        text: `site:meetup.com "events" "${pick(phrases, 0)}" "${city}" ${dateTerms}`,
        maxResults: DEFAULT_RESULTS_PER_QUERY,
        includeDomains: ["meetup.com"],
        recencyDays: 30,
        notes: "Public indexed Meetup pages only; no logged-in Meetup access."
      },
      {
        id: `meetup-startup-founders-area-${year}`,
        group: "meetup",
        connector: "exa",
        text: `site:meetup.com "events" ("founder" OR "startup") ${anyOf([short, areaLabel, pick(nearbyCities, 0)])} ${dateTerms}`,
        maxResults: DEFAULT_RESULTS_PER_QUERY,
        includeDomains: ["meetup.com"],
        recencyDays: 30,
        notes: "Public indexed Meetup pages only; no logged-in Meetup access."
      },
      {
        id: `eventbrite-topic-city-${year}`,
        group: "eventbrite",
        connector: "exa",
        text: `site:eventbrite.com/e/ "${pick(phrases, 0)}" "${city}" ${dateTerms}`,
        maxResults: DEFAULT_RESULTS_PER_QUERY,
        includeDomains: ["eventbrite.com"],
        recencyDays: 30,
        notes: "Eventbrite public search API is deprecated; use indexed public event pages."
      },
      {
        id: `eventbrite-topics-area-${year}`,
        group: "eventbrite",
        connector: "exa",
        text: `site:eventbrite.com/e/ ${anyOf(phrases.slice(1, 3).length ? phrases.slice(1, 3) : phrases)} ${anyOf([short, areaLabel])} ${dateTerms}`,
        maxResults: DEFAULT_RESULTS_PER_QUERY,
        includeDomains: ["eventbrite.com"],
        recencyDays: 30,
        notes: "Eventbrite public search API is deprecated; use indexed public pages."
      },
      {
        id: `web-profile-topics-city-${year}`,
        group: "semantic_web",
        connector: "exa",
        text: `${anyOf(phrases)} ("RSVP" OR "apply" OR "register") "${city}" ${dateTerms}`,
        maxResults: DEFAULT_RESULTS_PER_QUERY,
        recencyDays: 30
      },
      {
        id: `web-topic-small-rooms-${year}`,
        group: "semantic_web",
        connector: "exa",
        text: `${anyOf(phrases.slice(2, 4).length ? phrases.slice(2, 4) : phrases)} ${anyOf(formats.slice(0, 3))} ("RSVP" OR "apply") ${anyOf([short, city])} ${dateTerms}`,
        maxResults: DEFAULT_RESULTS_PER_QUERY,
        recencyDays: 30
      },
      {
        id: `source-discovery-communities-${year}`,
        group: "source_discovery",
        connector: "exa",
        text: `"${pick(phrases, phrases.length - 1)}" "${city}" ("calendar" OR "events" OR "community") ${dateTerms}`,
        maxResults: DEFAULT_RESULTS_PER_QUERY,
        recencyDays: 45,
        notes: "Find repeat organizers/calendars that can become high-quality future sources."
      },
      {
        id: `source-discovery-rooms-${year}`,
        group: "source_discovery",
        connector: "exa",
        text: `${anyOf(rooms.slice(0, 3))} ${anyOf([short, areaLabel, pick(nearbyCities, 0)])} ${dateTerms}`,
        maxResults: DEFAULT_RESULTS_PER_QUERY,
        recencyDays: 45,
        notes: "Find repeat organizers/calendars that can become high-quality future sources."
      },
      {
        id: `linkedin-indexed-topic-${year}`,
        group: "linkedin_indexed",
        connector: "exa",
        text: `site:linkedin.com "${pick(phrases, 0)}" "${city}" "lu.ma"`,
        maxResults: DEFAULT_RESULTS_PER_QUERY,
        includeDomains: ["linkedin.com"],
        recencyDays: 30,
        notes: "Indexed public results only; no logged-in LinkedIn automation."
      },
      ...buildMorningXQueries(year, terms)
    ];
  }

  if (scanWindow === "midday") {
    return [
      {
        id: `midday-vc-founder-networking-nearby-${year}`,
        group: "semantic_web",
        connector: "exa",
        text: `("founder breakfast" OR "founder mixer" OR "VC office hours") ${anyOf(nearbyCities)} ${dateTerms} ${exclusions}`.trim(),
        maxResults: DEFAULT_RESULTS_PER_QUERY,
        recencyDays: 21
      },
      {
        id: `midday-topic-small-rooms-${year}`,
        group: "semantic_web",
        connector: "exa",
        text: `${anyOf(phrases.slice(0, 3))} ${anyOf(formats.slice(0, 3))} ${anyOf([short, city])} ${dateTerms} ${exclusions}`.trim(),
        maxResults: DEFAULT_RESULTS_PER_QUERY,
        recencyDays: 21
      },
      {
        id: `midday-founder-investor-roundtable-area-${year}`,
        group: "source_discovery",
        connector: "exa",
        text: `("founder investor roundtable" OR "operator roundtable" OR "founder networking") ${anyOf([areaLabel, city])} ${dateTerms} ${exclusions}`.trim(),
        maxResults: DEFAULT_RESULTS_PER_QUERY,
        recencyDays: 30
      }
    ];
  }

  return [
    {
      id: `evening-next-week-topic-networking-${year}`,
      group: "semantic_web",
      connector: "exa",
      text: `("next week" OR "upcoming") ${anyOf([pick(phrases, 0), ...rooms.slice(0, 3)])} ${anyOf(places)} ("RSVP" OR "apply") ${exclusions}`.trim(),
      maxResults: DEFAULT_RESULTS_PER_QUERY,
      recencyDays: 14
    },
    {
      id: `evening-upcoming-luma-networking-${year}`,
      group: "luma",
      connector: "exa",
      text: `site:luma.com ("upcoming" OR "next week" OR "this week") ${anyOf(formats.slice(0, 5))} ${anyOf([short, city, pick(nearbyCities, 0)])} ${exclusions}`.trim(),
      maxResults: DEFAULT_RESULTS_PER_QUERY,
      includeDomains: ["luma.com"],
      recencyDays: 14
    },
    {
      id: `evening-updated-roundups-next-week-${year}`,
      group: "source_discovery",
      connector: "exa",
      text: `("this week" OR "next week" OR "upcoming") ${anyOf([`${areaLabel} events`, `${short} tech events`])} ${anyOf(["founder", pick(phrases, 0), "VC", "operator"])} ${exclusions}`.trim(),
      maxResults: DEFAULT_RESULTS_PER_QUERY,
      recencyDays: 14
    }
  ];
}

function buildMorningXQueries(year: number, terms: QueryTerms): QuerySpec[] {
  const { phrases, rooms, formats, short, city, places, nearbyCities } = terms;
  const xExclusions = `-is:retweet ${terms.exclusions}`.trim();
  return [
    {
      id: `x-luma-topics-${year}`,
      group: "x",
      connector: "x",
      text: `(url:lu.ma OR url:luma.com OR "lu.ma") ${anyOf(phrases.slice(0, 4))} ${anyOf(places)} ${xExclusions}`,
      maxResults: 40,
      recencyDays: 7
    },
    {
      id: `x-topic-small-rooms-${year}`,
      group: "x",
      connector: "x",
      text: `"${pick(phrases, 0)}" ${anyOf(formats.slice(0, 3))} ${anyOf([short, places[2] ?? city])} ${xExclusions}`,
      maxResults: 40,
      recencyDays: 7
    },
    {
      id: `x-second-topic-${year}`,
      group: "x",
      connector: "x",
      text: `"${pick(phrases, 1)}" ${anyOf([short, city])} ${xExclusions}`,
      maxResults: 40,
      recencyDays: 7
    },
    {
      id: `x-event-links-${year}`,
      group: "x",
      connector: "x",
      text: `("RSVP" OR "apply" OR "dinner" OR "salon" OR "demo night" OR "happy hour") ${anyOf([...places, pick(nearbyCities, 0)])} (url:lu.ma OR url:luma.com OR url:partiful.com OR url:eventbrite.com OR url:meetup.com) ${xExclusions}`,
      maxResults: 50,
      recencyDays: 7
    },
    {
      id: `x-event-intent-${year}`,
      group: "x",
      connector: "x",
      text: `("join us" OR "RSVP" OR "apply to attend" OR "hosting") ${anyOf([...phrases.slice(0, 2), ...rooms.slice(0, 2)])} ${anyOf([...places, pick(nearbyCities, 0)])} ${xExclusions}`,
      maxResults: 40,
      recencyDays: 7
    }
  ];
}

function buildRegistryQueryPack(
  now: Date,
  profile: ScoutProfile,
  options: { scanWindow?: ScanWindow; dateTerms?: string } = {}
): QuerySpec[] {
  const year = now.getFullYear();
  const dateTerms = options.dateTerms ?? futureEventQueryTerms(now);
  const sources = registrySourcesForProfile(profile);
  const topic = `${profile.region.name} ${profile.search.phrases[0]}`;
  const publicSourceQueries: QuerySpec[] = sources
    .filter((source) => source.url && source.kind !== "rss_feed" && source.kind !== "x_account")
    .filter((source) => isRegistrySourceEligible(source, now, options.scanWindow, "public_source"))
    .map((source) => ({
      id: `registry-public-${source.id}-${year}`,
      group: "public_source",
      connector: "public_source",
      text: source.queryText ?? `${source.name} events ${topic} ${year}`,
      maxResults: source.priority === "must_scan" ? 3 : 1,
      seedUrls: [source.url as string],
      sourceName: source.name,
      sourceType: sourceTypeForRegistryKind(source.kind),
      sourceScore: source.sourceScore,
      maxCandidateLinks: source.maxCandidateLinks,
      notes: source.notes
    }));

  const rssQueries: QuerySpec[] = sources
    .filter((source) => source.feedUrl)
    .filter((source) => isRegistrySourceEligible(source, now, options.scanWindow, "rss"))
    .map((source) => ({
      id: `registry-rss-${source.id}-${year}`,
      group: "rss_feed",
      connector: "rss",
      text: source.queryText ?? `${source.name} feed events ${topic} ${year}`,
      maxResults: source.priority === "must_scan" ? 5 : 3,
      seedUrls: [source.feedUrl as string],
      sourceName: source.name,
      sourceType: sourceTypeForRegistryKind(source.kind),
      sourceScore: source.sourceScore,
      maxCandidateLinks: source.maxCandidateLinks,
      notes: source.notes
    }));

  const searchQueries: QuerySpec[] = sources
    .filter((source) => source.queryText && source.kind !== "x_account")
    .filter((source) => isRegistrySourceEligible(source, now, options.scanWindow, "exa"))
    // A small search budget only reaches the first few of these, so the most important go first.
    .sort(compareRegistrySourcesForSearch)
    .map((source) => ({
      id: `registry-search-${source.id}-${year}`,
      group: source.kind === "luma_calendar" ? "luma" : "source_discovery",
      connector: "exa",
      text: `${source.queryText} ${dateTerms}`,
      maxResults: REGISTRY_RESULTS_PER_QUERY,
      includeDomains: source.includeDomains,
      recencyDays: source.kind === "rss_feed" || source.kind === "event_digest" ? 45 : 30,
      sourceName: source.name,
      sourceType: sourceTypeForRegistryKind(source.kind),
      sourceScore: source.sourceScore,
      maxCandidateLinks: source.maxCandidateLinks,
      notes: source.notes
    }));

  const xQueries: QuerySpec[] = sources
    .filter((source) => source.kind === "x_account" && source.queryText)
    .filter((source) => isRegistrySourceEligible(source, now, options.scanWindow, "x"))
    .map((source) => ({
      id: `registry-x-${source.id}-${year}`,
      group: "x",
      connector: "x",
      text: source.queryText as string,
      maxResults: source.priority === "must_scan" ? 50 : 35,
      recencyDays: 7,
      sourceName: source.name,
      sourceType: sourceTypeForRegistryKind(source.kind),
      sourceScore: source.sourceScore,
      notes: source.notes
    }));

  return [...publicSourceQueries, ...rssQueries, ...searchQueries, ...xQueries];
}

function futureEventQueryTerms(now: Date): string {
  const months = Array.from({ length: 3 }, (_, offset) => {
    const date = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    const month = new Intl.DateTimeFormat("en-US", { month: "long" }).format(date);
    return `"${month} ${date.getFullYear()}"`;
  });
  return `("upcoming" OR "this week" OR "next week" OR ${months.join(" OR ")})`;
}

function eligibleRegistrySources(
  profile: ScoutProfile,
  now: Date,
  scanWindow: ScanWindow | undefined,
  connector: QuerySpec["connector"]
): RegistrySource[] {
  return registrySourcesForProfile(profile).filter((source) => isRegistrySourceEligible(source, now, scanWindow, connector));
}

function isRegistrySourceEligible(
  source: RegistrySource,
  now: Date,
  scanWindow: ScanWindow | undefined,
  connector: QuerySpec["connector"]
): boolean {
  if (source.priority === "paused") return false;
  if (!scanWindow) return true;
  if (connector === "x") return scanWindow === "morning";
  if (connector === "rss") return scanWindow === "morning";

  const windowIndex = scanWindowIndex(scanWindow);
  const slot = sourceRotationSlot(source.id, now);
  if (source.priority === "must_scan") {
    if (scanWindow === "morning") return true;
    return slot % 2 === windowIndex - 1;
  }
  if (source.priority === "high") return slot % 3 === windowIndex;
  return slot % 6 === windowIndex;
}

function compareRegistrySourcesForSearch(left: RegistrySource, right: RegistrySource): number {
  return (
    priorityRank(right.priority) - priorityRank(left.priority) ||
    (right.sourceScore ?? 0) - (left.sourceScore ?? 0) ||
    left.id.localeCompare(right.id)
  );
}

function priorityRank(priority: RegistrySourcePriority): number {
  if (priority === "must_scan") return 3;
  if (priority === "high") return 2;
  if (priority === "medium") return 1;
  return 0;
}

function scanWindowForTime(scanTime: string | undefined): ScanWindow | undefined {
  if (!scanTime) return undefined;
  const hour = Number(scanTime.split(":")[0] ?? "9");
  if (!Number.isFinite(hour)) return undefined;
  if (hour >= 17) return "evening";
  if (hour >= 12) return "midday";
  return "morning";
}

function scanWindowIndex(scanWindow: ScanWindow): number {
  if (scanWindow === "morning") return 0;
  if (scanWindow === "midday") return 1;
  return 2;
}

function sourceRotationSlot(sourceId: string, now: Date): number {
  const day = Math.floor(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) / 86_400_000);
  return stableNumber(`${sourceId}:${day}`);
}

function stableNumber(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

export function buildMissHuntQueryPack(now: Date, profile: ScoutProfile): QuerySpec[] {
  const year = now.getFullYear();
  const { phrases, city, short } = queryTerms(profile);
  return [
    {
      id: `miss-thanks-topic-city-${year}`,
      group: "miss_hunt",
      connector: "exa",
      text: `"thanks for coming" "${pick(phrases, 0)}" "${city}"`,
      maxResults: DEFAULT_RESULTS_PER_QUERY,
      recencyDays: 14
    },
    {
      id: `miss-great-dinner-topic-${year}`,
      group: "miss_hunt",
      connector: "exa",
      text: `"great dinner last night" "${pick(phrases, 1)}" "${short}"`,
      maxResults: DEFAULT_RESULTS_PER_QUERY,
      recencyDays: 14
    },
    {
      id: `miss-recap-topic-dinner-${year}`,
      group: "miss_hunt",
      connector: "exa",
      text: `"recap" "${pick(phrases, 0)}" "${city}" "dinner"`,
      maxResults: DEFAULT_RESULTS_PER_QUERY,
      recencyDays: 14
    }
  ];
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.toLowerCase();
    if (!value || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
