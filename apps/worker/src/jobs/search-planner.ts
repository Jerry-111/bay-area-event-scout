import type { QuerySpec } from "@event-scout/discovery";
import { callLlm, llmEnabled, looseJsonParse } from "@event-scout/intelligence";
import {
  localAreaTerms,
  matchesAnyKeyword,
  searchExclusions,
  type AppEnv,
  type CandidateUrl,
  type EventCandidate,
  type Recommendation,
  type ScanMode,
  type ScoutProfile
} from "@event-scout/shared";

const AGENT_QUERY_MAX_RESULTS = 12;
const MAX_ORGANIZER_FOLLOW_UP_QUERIES = 5;

export interface SearchPlannerHistory {
  recentCandidates: CandidateUrl[];
  recentEvents: EventCandidate[];
  recentRecommendations: Recommendation[];
}

export interface AgenticSearchPlan {
  id: string;
  planner: "llm" | "mock" | "fallback";
  createdAt: string;
  scanTime?: string;
  targetExaQueries: number;
  avoidFingerprints: string[];
  items: AgenticSearchPlanItem[];
}

export interface AgenticSearchPlanItem {
  id: string;
  connector: "exa";
  query: string;
  rationale: string;
  noveltyAxis: string;
  maxResults: number;
  recencyDays: number;
  includeDomains?: string[];
}

interface BuildAgenticSearchPlanInput {
  env: AppEnv;
  now: Date;
  scanTime?: string;
  runContext: {
    scanMode: ScanMode;
    xEnabled: boolean;
    xBudgetRemaining: number;
  };
  staticQueryPack: QuerySpec[];
  history: SearchPlannerHistory;
}

export async function buildAgenticSearchPlan(input: BuildAgenticSearchPlanInput): Promise<AgenticSearchPlan> {
  const targetExaQueries = targetAgentExaQueryCount(input.env);
  const createdAt = input.now.toISOString();
  const avoidFingerprints = buildAvoidFingerprints(input.staticQueryPack, input.history);
  const profile = input.env.profile;
  const organizerFollowUps = buildOrganizerFollowUpItems(
    input.history,
    input.now,
    Math.min(MAX_ORGANIZER_FOLLOW_UP_QUERIES, Math.max(0, Math.floor(targetExaQueries * 0.25))),
    profile
  );

  if (targetExaQueries <= 0) {
    return {
      id: `search_plan_${stableHash(`${createdAt}:disabled`)}`,
      planner: "fallback",
      createdAt,
      scanTime: input.scanTime,
      targetExaQueries,
      avoidFingerprints,
      items: []
    };
  }

  if (!llmEnabled(input.env)) {
    const items = fillPlanIfNeeded(sanitizePlanItems([...organizerFollowUps, ...mockPlanItems(input.now, input.scanTime, targetExaQueries * 2, profile)], {
      targetExaQueries,
      avoidFingerprints,
      profile
    }), input.now, input.scanTime, targetExaQueries, avoidFingerprints, profile);
    return {
      id: `search_plan_${stableHash(`${createdAt}:mock:${input.scanTime ?? ""}`)}`,
      planner: "mock",
      createdAt,
      scanTime: input.scanTime,
      targetExaQueries,
      avoidFingerprints,
      items
    };
  }

  try {
    const raw = await callLlm({
      env: input.env,
      model: input.env.llm.models.fast,
      prompt: buildPlannerPrompt(input, targetExaQueries, avoidFingerprints)
    });
    const parsed = looseJsonParse(raw);
    const items = sanitizePlanItems([...organizerFollowUps, ...extractPlanItems(parsed)], { targetExaQueries, avoidFingerprints, profile });
    return {
      id: `search_plan_${stableHash(`${createdAt}:llm:${raw}`)}`,
      planner: "llm",
      createdAt,
      scanTime: input.scanTime,
      targetExaQueries,
      avoidFingerprints,
      items: fillPlanIfNeeded(items, input.now, input.scanTime, targetExaQueries, avoidFingerprints, profile)
    };
  } catch (error) {
    console.warn(`[search-planner] LLM planner failed; using fallback plan: ${error instanceof Error ? error.message : String(error)}`);
    const items = fillPlanIfNeeded(sanitizePlanItems([...organizerFollowUps, ...mockPlanItems(input.now, input.scanTime, targetExaQueries * 2, profile)], {
      targetExaQueries,
      avoidFingerprints,
      profile
    }), input.now, input.scanTime, targetExaQueries, avoidFingerprints, profile);
    return {
      id: `search_plan_${stableHash(`${createdAt}:fallback:${input.scanTime ?? ""}`)}`,
      planner: "fallback",
      createdAt,
      scanTime: input.scanTime,
      targetExaQueries,
      avoidFingerprints,
      items
    };
  }
}

export function mergeAgenticSearchPlan(staticQueryPack: QuerySpec[], plan: AgenticSearchPlan, env: AppEnv): QuerySpec[] {
  const maxExaSearches = Math.max(0, env.budgets.maxExaSearchesPerRun);
  const agentQueries = plan.items.slice(0, Math.min(plan.items.length, plan.targetExaQueries)).map(agentItemToQuerySpec);
  const staticExaBudget = Math.max(0, maxExaSearches - agentQueries.length);
  const staticExaQueries = staticQueryPack.filter((query) => query.connector === "exa").slice(0, staticExaBudget);
  const staticNonExaQueries = staticQueryPack.filter((query) => query.connector !== "exa");
  return [...staticExaQueries, ...agentQueries, ...staticNonExaQueries];
}

export function summarizeQueryMix(queryPack: QuerySpec[]): Record<string, unknown> {
  const exaQueries = queryPack.filter((query) => query.connector === "exa");
  const agentExaQueries = exaQueries.filter((query) => query.group === "agent_exploration");
  return {
    totalQueries: queryPack.length,
    exaQueries: exaQueries.length,
    agentExaQueries: agentExaQueries.length,
    agentExaPercent: exaQueries.length ? Math.round((agentExaQueries.length / exaQueries.length) * 100) : 0,
    xQueries: queryPack.filter((query) => query.connector === "x").length,
    publicSourceQueries: queryPack.filter((query) => query.connector === "public_source").length,
    rssQueries: queryPack.filter((query) => query.connector === "rss").length
  };
}

export function summarizeSearchPlannerHistory(history: SearchPlannerHistory): Record<string, unknown> {
  const organizerSignals = buildOrganizerSignals(history, MAX_ORGANIZER_FOLLOW_UP_QUERIES);
  return {
    recentCandidates: history.recentCandidates.length,
    recentEvents: history.recentEvents.length,
    recentRecommendations: history.recentRecommendations.length,
    recommendedOrganizers: organizerSignals.map((signal) => signal.name),
    recentCandidateQueries: unique(history.recentCandidates.map((candidate) => candidate.sourceQuery).filter(isString)).length,
    recentRejectedCandidates: history.recentCandidates.filter((candidate) => candidate.status === "rejected").length
  };
}

export function summarizeSearchPlanItems(plan: AgenticSearchPlan): Array<Record<string, unknown>> {
  return plan.items.map((item) => ({
    id: item.id,
    connector: item.connector,
    noveltyAxis: item.noveltyAxis,
    recencyDays: item.recencyDays,
    maxResults: item.maxResults,
    includeDomains: item.includeDomains,
    query: truncateForLog(item.query, 220)
  }));
}

function targetAgentExaQueryCount(env: AppEnv): number {
  const maxExaSearches = Math.max(0, env.budgets.maxExaSearchesPerRun);
  const percent = Math.max(0, Math.min(100, env.budgets.maxExplorationBudgetPercent ?? 50));
  const percentCap = Math.floor((maxExaSearches * percent) / 100);
  const absoluteCap = Math.max(0, env.budgets.maxAgentGeneratedExaQueries ?? percentCap);
  return Math.min(maxExaSearches, percentCap, absoluteCap);
}

function agentItemToQuerySpec(item: AgenticSearchPlanItem): QuerySpec {
  return {
    id: `agent-exa-${item.id}`,
    group: "agent_exploration",
    connector: "exa",
    text: item.query,
    maxResults: item.maxResults,
    recencyDays: item.recencyDays,
    includeDomains: item.includeDomains,
    notes: `${item.noveltyAxis}: ${item.rationale}`
  };
}

function buildPlannerPrompt(input: BuildAgenticSearchPlanInput, targetExaQueries: number, avoidFingerprints: string[]): string {
  const staticSamples = unique(input.staticQueryPack.filter((query) => query.connector === "exa").map((query) => query.text)).slice(0, 24);
  const recentCandidateQueries = unique(input.history.recentCandidates.map((candidate) => candidate.sourceQuery).filter(isString)).slice(0, 24);
  const recentTitles = unique([
    ...input.history.recentCandidates.map((candidate) => candidate.title).filter(isString),
    ...input.history.recentEvents.map((event) => event.title).filter(isString)
  ]).slice(0, 24);
  const recentRecommendationIds = unique(input.history.recentRecommendations.map((recommendation) => recommendation.eventId)).slice(0, 12);
  const recommendedOrganizers = buildOrganizerSignals(input.history, 16).map((signal) => ({
    name: signal.name,
    eventCount: signal.eventIds.size,
    recommendationCount: signal.recommendationCount,
    maxRecommendationScore: signal.maxRecommendationScore
  }));

  const profile = input.env.profile;
  const avoidFormats = [...profile.exclude.formats, ...profile.formats.avoid];
  return [
    `You are the ${profile.region.name} Event Scout agentic search planner.`,
    "Generate exploration search queries that increase variety without replacing the proven static source refresh.",
    `Current date/time: ${input.now.toISOString()}. Scan time: ${input.scanTime ?? "unknown"}. Scan mode: ${input.runContext.scanMode}.`,
    `Return exactly ${targetExaQueries} Exa web-search query items.`,
    "Hard constraints:",
    "- Return only JSON. No Markdown.",
    "- Use connector exa only.",
    `- Focus on networking-heavy ${profile.region.name} events for ${profile.persona}.`,
    `- Good events are described as: ${[...profile.search.phrases, ...profile.search.rooms].join(", ")}.`,
    `- Avoid ${avoidFormats.length ? `${avoidFormats.join(", ")}, ` : ""}generic conferences, online-only events, student-only events, and classes.`,
    "- Prefer public/indexed pages; do not require paid Meetup/Luma/Eventbrite APIs; do not use LinkedIn logged-in automation; do not scrape X.",
    "- Make each query materially different from recent/static queries and from the other generated queries.",
    `- Every query must name a place, and should mix geography across ${localAreaTerms(profile).join(", ")}.`,
    "- Mix discovery angles: source discovery, curated rooms, VC/operator offices, private-ish RSVP pages, community calendars, newsletters, organizer sites.",
    "Required JSON shape:",
    JSON.stringify({
      items: [
        {
          query: "string",
          rationale: "string",
          noveltyAxis: "string",
          recencyDays: 21,
          maxResults: 12,
          includeDomains: ["optional-domain.com"]
        }
      ]
    }),
    `Avoid fingerprints: ${JSON.stringify(avoidFingerprints.slice(0, 40))}`,
    `Static Exa query samples: ${JSON.stringify(staticSamples)}`,
    `Recent candidate query samples: ${JSON.stringify(recentCandidateQueries)}`,
    `Recent event/candidate title samples: ${JSON.stringify(recentTitles)}`,
    `Recent recommendation event ids: ${JSON.stringify(recentRecommendationIds)}`,
    `High-value recent organizers/hosts to follow up: ${JSON.stringify(recommendedOrganizers)}`
  ].join("\n\n");
}

interface OrganizerSignal {
  name: string;
  eventIds: Set<string>;
  recommendationCount: number;
  maxRecommendationScore: number;
}

function buildOrganizerFollowUpItems(
  history: SearchPlannerHistory,
  now: Date,
  limit: number,
  profile: ScoutProfile
): AgenticSearchPlanItem[] {
  if (limit <= 0) return [];
  const places = anyOf(localAreaTerms(profile).slice(0, 5));
  return buildOrganizerSignals(history, limit).map((signal, index) => {
    const query = `"${signal.name}" ("Luma" OR "RSVP" OR "apply" OR "event" OR "dinner" OR "salon" OR "demo") ${places} ${futureEventQueryTerms(now)}`;
    return {
      id: `organizer-${slugForQuery(signal.name, index)}`,
      connector: "exa",
      query,
      rationale: `Follow up on organizer/host with ${signal.recommendationCount} recent recommendation${signal.recommendationCount === 1 ? "" : "s"}.`,
      noveltyAxis: "organizer_follow_up",
      maxResults: AGENT_QUERY_MAX_RESULTS,
      recencyDays: 30
    };
  });
}

function buildOrganizerSignals(history: SearchPlannerHistory, limit: number): OrganizerSignal[] {
  const eventById = new Map(history.recentEvents.map((event) => [event.id, event]));
  const signals = new Map<string, OrganizerSignal>();

  for (const recommendation of history.recentRecommendations) {
    const event = eventById.get(recommendation.eventId);
    if (!event) continue;

    for (const name of organizerNamesForEvent(event)) {
      if (!isUsefulOrganizerName(name)) continue;
      const key = name.toLowerCase();
      const signal = signals.get(key) ?? {
        name,
        eventIds: new Set<string>(),
        recommendationCount: 0,
        maxRecommendationScore: 0
      };
      signal.eventIds.add(event.id);
      signal.recommendationCount += 1;
      signal.maxRecommendationScore = Math.max(signal.maxRecommendationScore, recommendation.score);
      signals.set(key, signal);
    }
  }

  return [...signals.values()]
    .sort((left, right) =>
      right.recommendationCount - left.recommendationCount ||
      right.maxRecommendationScore - left.maxRecommendationScore ||
      right.eventIds.size - left.eventIds.size ||
      left.name.localeCompare(right.name)
    )
    .slice(0, limit);
}

function organizerNamesForEvent(event: EventCandidate): string[] {
  return unique([...(event.hosts ?? []), ...(event.organizers ?? [])])
    .map((name) => name.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function isUsefulOrganizerName(name: string): boolean {
  const normalized = name.toLowerCase();
  if (name.length < 4 || name.length > 80) return false;
  if (/^\d+$/.test(normalized)) return false;
  if (["unknown", "eventbrite", "meetup", "luma", "admin", "team"].includes(normalized)) return false;
  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length >= 2) return true;
  return /\b(ai|vc|labs?|club|community|founders?|ventures?|capital|studio|commons|robotics|mechanics|cloud|school|cafe|tower|fund|alliance|tinkerers)\b/i.test(name);
}

function futureEventQueryTerms(now: Date): string {
  const months = Array.from({ length: 3 }, (_, offset) => {
    const date = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    const month = new Intl.DateTimeFormat("en-US", { month: "long" }).format(date);
    return `"${month} ${date.getFullYear()}"`;
  });
  return `("upcoming" OR "this week" OR "next week" OR ${months.join(" OR ")})`;
}

function extractPlanItems(parsed: unknown): AgenticSearchPlanItem[] {
  const value = parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  const rawItems = Array.isArray(value.items) ? value.items : Array.isArray(parsed) ? parsed : [];
  return rawItems.flatMap((item, index) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const query = stringField(record.query ?? record.text);
    if (!query) return [];
    const includeDomains = Array.isArray(record.includeDomains)
      ? record.includeDomains.filter(isString).map((domain) => domain.toLowerCase()).slice(0, 3)
      : undefined;
    return [{
      id: slugForQuery(query, index),
      connector: "exa" as const,
      query,
      rationale: stringField(record.rationale) ?? "Agent-generated exploration query.",
      noveltyAxis: stringField(record.noveltyAxis ?? record.novelty_axis) ?? "variety",
      maxResults: clampInteger(record.maxResults ?? record.max_results, 5, 20, AGENT_QUERY_MAX_RESULTS),
      recencyDays: clampInteger(record.recencyDays ?? record.recency_days, 7, 45, 21),
      includeDomains
    }];
  });
}

function sanitizePlanItems(
  items: AgenticSearchPlanItem[],
  options: { targetExaQueries: number; avoidFingerprints: string[]; profile: ScoutProfile }
): AgenticSearchPlanItem[] {
  const localTerms = localAreaTerms(options.profile);
  const seen = new Set<string>();
  const sanitized: AgenticSearchPlanItem[] = [];
  for (const item of items) {
    const query = normalizeQueryText(item.query);
    const positiveQuery = stripNegativeFilters(query);
    const fingerprint = queryFingerprint(query);
    const isOrganizerFollowUp = item.noveltyAxis === "organizer_follow_up";
    if (!query || seen.has(fingerprint)) continue;
    if (matchesAnyKeyword(positiveQuery, options.profile.exclude.formats)) continue;
    if (!matchesAnyKeyword(query, localTerms)) continue;
    if (isOrganizerFollowUp ? options.avoidFingerprints.includes(fingerprint) : isTooSimilarToAvoidSet(fingerprint, options.avoidFingerprints)) continue;
    seen.add(fingerprint);
    sanitized.push({
      ...item,
      id: slugForQuery(query, sanitized.length),
      query: ensureNegativeFilters(query, options.profile),
      maxResults: Math.max(5, Math.min(20, item.maxResults || AGENT_QUERY_MAX_RESULTS)),
      recencyDays: Math.max(7, Math.min(45, item.recencyDays || 21))
    });
    if (sanitized.length >= options.targetExaQueries) break;
  }
  return sanitized;
}

function fillPlanIfNeeded(
  items: AgenticSearchPlanItem[],
  now: Date,
  scanTime: string | undefined,
  targetExaQueries: number,
  avoidFingerprints: string[],
  profile: ScoutProfile
): AgenticSearchPlanItem[] {
  if (items.length >= targetExaQueries) return items.slice(0, targetExaQueries);
  const filled = [...items];
  const existingAvoid = [...avoidFingerprints, ...filled.map((item) => queryFingerprint(item.query))];
  const fallbackItems = sanitizePlanItems(mockPlanItems(now, scanTime, targetExaQueries * 2, profile), {
    targetExaQueries,
    avoidFingerprints: existingAvoid,
    profile
  });
  for (const item of fallbackItems) {
    if (filled.length >= targetExaQueries) break;
    filled.push(item);
  }
  return filled;
}

/**
 * Deterministic exploration axes used when no LLM is configured or the planner fails.
 * Topic axes come from the profile's search phrases; the rest are topic-agnostic
 * founder-networking angles. Places rotate through the profile's region terms.
 */
function mockPlanItems(now: Date, scanTime: string | undefined, count: number, profile: ScoutProfile): AgenticSearchPlanItem[] {
  const year = now.getFullYear();
  const window = scanWindowName(scanTime);
  const topics = mockPlanTopics(profile, year);
  const offset = Math.abs(stableHash(`${now.toISOString().slice(0, 10)}:${window}`)) % topics.length;
  return Array.from({ length: Math.min(count, topics.length) }, (_, index) => {
    const topic = topics[(offset + index) % topics.length]!;
    return {
      id: slugForQuery(topic.query, index),
      connector: "exa" as const,
      query: ensureNegativeFilters(topic.query, profile),
      rationale: `Fallback ${window} exploration axis for query variety.`,
      noveltyAxis: topic.axis,
      maxResults: AGENT_QUERY_MAX_RESULTS,
      recencyDays: window === "evening" ? 14 : 21
    };
  });
}

function mockPlanTopics(profile: ScoutProfile, year: number): Array<{ axis: string; query: string }> {
  const { phrases, rooms } = profile.search;
  const placeTerms = localAreaTerms(profile);
  const places = (index: number, size = 2): string =>
    anyOf(Array.from({ length: Math.min(size, placeTerms.length) }, (_, offset) => placeTerms[(index + offset) % placeTerms.length]!));
  const lead = phrases[0]!;
  const room = rooms[0] ?? "founder dinner";
  const short = profile.region.aliases[0] ?? profile.region.cities[0] ?? profile.region.name;
  const area = profile.region.aliases[1] ?? profile.region.name;

  const topicAxes = phrases.flatMap((phrase, index) => [
    {
      axis: `topic_rooms_${axisSlug(phrase)}`,
      query: `"${phrase}" ${anyOf([rooms[index % Math.max(1, rooms.length)] ?? room, rooms[(index + 1) % Math.max(1, rooms.length)] ?? "salon"])} ${places(index)} ${year}`
    },
    {
      axis: `topic_rsvp_${axisSlug(phrase)}`,
      query: `"${phrase}" ("RSVP" OR "apply to attend") ${places(index + 2)} ${year}`
    }
  ]);

  const networkingAxes = [
    { axis: "vc_operator_office_hours", query: `("VC office hours" OR "operator roundtable") ${places(1, 3)} ("founder" OR "startup") ${year}` },
    { axis: "angel_investor_rooms", query: `("angel investors" OR "seed investors") ("founder dinner" OR "startup salon") ${places(0)} ${year}` },
    { axis: "community_calendar_discovery", query: `("${lead}" OR "founder community") ("calendar" OR "events") ${places(2)} ${year}` },
    { axis: "newsletter_event_discovery", query: `("founder events" OR "${lead} events") ("newsletter" OR "Substack") ${places(3)} ("upcoming" OR "this week") ${year}` },
    { axis: "privateish_application_rooms", query: `("approval required" OR "apply to attend") ("founder dinner" OR "${room}") ${places(4)} ${year}` },
    { axis: "demo_with_networking", query: `("demo night" OR "startup showcase") ("networking" OR "reception") ("${lead}" OR "founder") ${places(5)} ${year}` },
    { axis: "founder_house_open_events", query: `("founder house" OR "startup house") ("open house" OR "mixer" OR "salon") ${places(0)} ${year}` },
    { axis: "vc_platform_events", query: `("platform team" OR "portfolio event") ("founder breakfast" OR "operator roundtable") ${places(1)} ${year}` },
    { axis: "investor_founder_small_rooms", query: `("founder investor" OR "investor founder") ("roundtable" OR "dinner" OR "breakfast") ${places(2)} ${year}` },
    { axis: "women_founders", query: `("women founders" OR "female founders") ("${lead}" OR "startup") ("dinner" OR "mixer" OR "roundtable") ${places(3)} ${year}` },
    { axis: "immigrant_founders", query: `("immigrant founders" OR "international founders") ("startup mixer" OR "founder dinner") ${places(4)} ${year}` },
    { axis: "founder_cohort_alumni", query: `("founder alumni" OR "startup cohort") ("demo" OR "mixer" OR "reception") ${places(5)} ${year}` },
    { axis: "week_ahead_roundups", query: `("next week" OR "week ahead") ("${short} tech events" OR "${area} startup events") ("founder" OR "${lead}" OR "operator") ${year}` },
    { axis: "founder_breakfasts", query: `("founder breakfast" OR "startup breakfast") ${places(1, 3)} ("RSVP" OR "apply") ${year}` },
    { axis: "technical_founder_rooms", query: `("solo founders" OR "technical founders") ("dinner" OR "salon" OR "mixer") ${places(2)} ${year}` },
    ...(profile.hubs.length
      ? [{ axis: "hub_venue_events", query: `${anyOf(profile.hubs.slice(0, 5))} ("${lead}" OR "founder" OR "investor") ("event" OR "RSVP" OR "Luma") ${places(0)} ${year}` }]
      : [])
  ];

  return [...topicAxes, ...networkingAxes];
}

function anyOf(values: string[]): string {
  return `(${unique(values).map((value) => `"${value}"`).join(" OR ")})`;
}

function axisSlug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function buildAvoidFingerprints(staticQueryPack: QuerySpec[], history: SearchPlannerHistory): string[] {
  const values = [
    ...staticQueryPack.filter((query) => query.connector === "exa").map((query) => query.text),
    ...history.recentCandidates.map((candidate) => candidate.sourceQuery).filter(isString),
    ...history.recentCandidates.map((candidate) => candidate.title).filter(isString),
    ...history.recentEvents.map((event) => event.title).filter(isString)
  ];
  return unique(values.map(queryFingerprint).filter(Boolean)).slice(0, 160);
}

function isTooSimilarToAvoidSet(fingerprint: string, avoidFingerprints: string[]): boolean {
  return avoidFingerprints.some((avoid) => {
    if (fingerprint === avoid) return true;
    const comparison = tokenComparison(fingerprint, avoid);
    return comparison.shared >= 5 && comparison.similarity >= 0.82;
  });
}

function queryFingerprint(value: string): string {
  return unique(
    value
      .toLowerCase()
      .replace(/\b20\d{2}\b/g, "")
      .replace(/site:[^\s)]+/g, "")
      .replace(/["()]/g, " ")
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length > 2)
      .filter((token) => !["the", "and", "for", "with", "from", "events", "event", "upcoming"].includes(token))
  ).join(" ");
}

function tokenComparison(left: string, right: string): { shared: number; similarity: number } {
  const leftTokens = new Set(left.split(/\s+/).filter(Boolean));
  const rightTokens = new Set(right.split(/\s+/).filter(Boolean));
  if (leftTokens.size === 0 || rightTokens.size === 0) return { shared: 0, similarity: 0 };
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  return {
    shared: intersection,
    similarity: intersection / Math.min(leftTokens.size, rightTokens.size)
  };
}

function normalizeQueryText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function ensureNegativeFilters(query: string, profile: ScoutProfile): string {
  const existing = query.toLowerCase();
  const filters = searchExclusions(profile).filter((filter) => !existing.includes(filter.toLowerCase()));
  return `${query} ${filters.join(" ")}`.trim();
}

function stripNegativeFilters(query: string): string {
  return query.replace(/-"[^"]*"/g, " ").replace(/-\w+/g, " ");
}

function scanWindowName(scanTime: string | undefined): "morning" | "midday" | "evening" {
  const hour = Number(scanTime?.split(":")[0] ?? "9");
  if (Number.isFinite(hour) && hour >= 17) return "evening";
  if (Number.isFinite(hour) && hour >= 12) return "midday";
  return "morning";
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.round(parsed)));
}

function slugForQuery(query: string, index: number): string {
  const slug = query
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `${index + 1}-${slug || "query"}-${stableHash(query).toString(36)}`;
}

function stableHash(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function truncateForLog(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 3)}...`;
}
