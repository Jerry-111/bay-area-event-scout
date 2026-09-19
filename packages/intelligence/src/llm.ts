import {
  findKeywordMatches,
  loadRuntimeEnv,
  localAreaTerms,
  matchesAnyKeyword,
  negativeTopics,
  neutralTopics,
  positiveTopics,
  relevantTopicKeywords,
  type AppEnv,
  type ProfileTopic,
  type RawCandidate,
  type ScoutProfile
} from "@event-scout/shared";
import type { z } from "zod";
import { callLlm } from "./llm-client.js";
import {
  eventExtractionSchema,
  eventScoreSchema,
  missHuntClassificationSchema,
  parseWithSchema,
  type ExtractedEvent,
  type FetchedPage,
  type MissHuntClassification,
  type StructuredEventScore
} from "./schemas.js";

export interface ExtractEventInput {
  candidate: RawCandidate;
  page?: FetchedPage;
  env?: AppEnv;
}

export interface ScoreEventInput {
  event: ExtractedEvent;
  env?: AppEnv;
}

export interface MissHuntInput {
  title: string;
  url?: string;
  evidenceText: string;
  knownEventTitles?: string[];
  env?: AppEnv;
}

const JSON_INSTRUCTION =
  "Return only valid JSON matching the requested schema. Do not wrap it in Markdown.";

/** Words that signal a curated, application-based, or small room regardless of profile. */
const CURATION_TERMS = ["approval", "invite", "invite only", "member", "application", "apply to attend", "curated", "limited capacity", "closed door"];

/** True when real LLM calls should be made (not mock mode, and a provider is configured). */
export function llmEnabled(env: AppEnv): boolean {
  return !env.mockMode && env.llm.enabled;
}

export async function extractEventWithLlm(input: ExtractEventInput): Promise<ExtractedEvent | null> {
  const env = input.env ?? loadRuntimeEnv();
  if (!llmEnabled(env)) {
    // Mock mode builds sample events on purpose. Real mode without an LLM cannot read event
    // pages, so it extracts nothing instead of inventing dates and places.
    return env.mockMode ? mockExtractedEvent(input) : null;
  }

  const prompt = [
    `Extract one ${env.profile.region.name} event from the candidate and page text.`,
    "If the page is not an event, return null.",
    JSON_INSTRUCTION,
    "Schema fields: id, runId?, canonicalUrl, sourceUrls, title, description?, startAt?, endAt?, timezone, city?, venueText?, locationPrecision, hosts, organizers, platforms, visibilityFlags, registrationStatus, eventType, confidence.",
    "Enum constraints: locationPrecision must be one of exact, neighborhood, city_only, unknown. registrationStatus must be one of open, approval_required, sold_out, closed, unknown. eventType must be one of dinner, breakfast, happy_hour, demo, salon, panel, conference, workshop, online, other.",
    `Candidate: ${JSON.stringify(input.candidate)}`,
    `Page: ${JSON.stringify(pageForPrompt(input.page))}`
  ].join("\n\n");

  return parseWithModelFallbacks({
    env,
    models: orderedModels(env.llm.models.extract, env.llm.models.fast, env.llm.models.score),
    prompt,
    schema: eventExtractionSchema.nullable(),
    schemaName: "eventExtraction"
  });
}

/**
 * The page as the extraction prompt sees it. Firecrawl pages also carry the full `markdown`, which
 * is the same content as `text` without the length cap, so sending both would pay for every page
 * twice (and the uncapped copy could be much longer than the cap allows).
 */
export function pageForPrompt(page: FetchedPage | undefined): Omit<FetchedPage, "markdown"> | null {
  if (!page) return null;
  const { markdown: _markdown, ...rest } = page;
  return rest;
}

export async function scoreEventWithLlm(input: ScoreEventInput): Promise<StructuredEventScore> {
  const env = input.env ?? loadRuntimeEnv();
  if (!llmEnabled(env)) {
    return heuristicScoreEvent(input.event, env.profile);
  }

  return parseWithModelFallbacks({
    env,
    models: orderedModels(env.llm.models.score, env.llm.models.fast, env.llm.models.extract),
    prompt: buildScoringPrompt(input.event, env.profile),
    schema: eventScoreSchema,
    schemaName: "eventScore"
  });
}

/** The scoring prompt is generated from the profile so every preference change reaches the LLM. */
export function buildScoringPrompt(event: ExtractedEvent, profile: ScoutProfile): string {
  const preferred = positiveTopics(profile);
  const relevant = neutralTopics(profile);
  const lowerPriority = negativeTopics(profile);
  const lookingFor = [
    preferred.length ? `- Top-priority topics (most important first): ${preferred.map(describeTopic).join("; ")}.` : undefined,
    relevant.length ? `- Also relevant topics: ${relevant.map(describeTopic).join("; ")}.` : undefined,
    profile.formats.prefer.length ? `- Preferred formats: ${profile.formats.prefer.join(", ")}.` : undefined,
    profile.audience.length ? `- People they want in the room: ${profile.audience.join(", ")}.` : undefined,
    `- Location: ${profile.region.name}, especially ${profile.region.cities.join(", ")}.`,
    profile.hubs.length
      ? `- Venues and communities that usually signal a strong room: ${profile.hubs.join(", ")}. These lift roomQuality and networkingValue for otherwise relevant in-person rooms, but do not override topic, format, location, or eligibility penalties.`
      : undefined
  ];
  const skipRules = [
    profile.exclude.formats.length ? `- Excluded formats: ${profile.exclude.formats.join(", ")}.` : undefined,
    profile.exclude.topics.length ? `- Excluded topics: ${profile.exclude.topics.join(", ")}.` : undefined,
    profile.exclude.eligibility.length
      ? `- Eligibility gates this person likely cannot pass: ${profile.exclude.eligibility.join(", ")}. Skip when the gate is explicit.`
      : undefined
  ];

  return [
    `Score this event for ${profile.persona}.`,
    "Return exactly one JSON object. Do not return null. Do not use Markdown. Do not include any keys outside the schema.",
    "Use the event.id value as eventId.",
    "Schema template:",
    JSON.stringify({
      eventId: event.id,
      totalScore: 0,
      userFit: 0,
      roomQuality: 0,
      networkingValue: 0,
      timeliness: 0,
      locationActionability: 0,
      novelty: 0,
      evidenceConfidence: 0,
      penalties: [],
      shouldRecommend: false,
      rationale: "...",
      nextAction: "monitor"
    }),
    "totalScore must be 0-100.",
    "Component caps are absolute points, not percentages: userFit 0-25, roomQuality 0-20, networkingValue 0-15, timeliness 0-10, locationActionability 0-10, novelty 0-10, evidenceConfidence 0-10.",
    "nextAction must be exactly one of: apply, rsvp, ask_intro, monitor, skip.",
    ["What this person is looking for:", ...lookingFor.filter(isString)].join("\n"),
    lowerPriority.length
      ? [
          "Lower priority (penalize unless the event is clearly a small, relevant room for the people above):",
          ...lowerPriority.map((topic) => `- ${describeTopic(topic)}`)
        ].join("\n")
      : undefined,
    skipRules.some(Boolean)
      ? ["Usually set shouldRecommend=false and nextAction=skip for:", ...skipRules.filter(isString)].join("\n")
      : undefined,
    `Also penalize ${profile.formats.avoid.length ? `${profile.formats.avoid.join(", ")} formats, ` : ""}online-only events, weak location/date evidence, sold-out or closed registration, and events outside ${profile.region.name}.`,
    profile.notes.length ? ["Additional guidance:", ...profile.notes.map((note) => `- ${note}`)].join("\n") : undefined,
    `Event: ${JSON.stringify(event)}`
  ]
    .filter(isString)
    .join("\n\n");
}

export async function repairJsonWithLlm(
  raw: string,
  schemaName: string,
  env: AppEnv = loadRuntimeEnv()
): Promise<unknown> {
  if (!llmEnabled(env)) {
    return looseJsonParse(raw);
  }

  const prompt = [
    "Repair the following model output into valid JSON.",
    `Target schema name: ${schemaName}`,
    JSON_INSTRUCTION,
    raw
  ].join("\n\n");

  return looseJsonParse(await callLlm({ env, model: env.llm.models.fast, prompt }));
}

export async function classifyMissedEventWithLlm(input: MissHuntInput): Promise<MissHuntClassification> {
  const env = input.env ?? loadRuntimeEnv();
  if (!llmEnabled(env)) {
    return heuristicMissHuntClassification(input, env.profile);
  }

  const prompt = [
    `Classify whether this historical event should count as a miss for the ${env.profile.region.name} Event Scout.`,
    `A miss means it was likely relevant to ${env.profile.persona}, and should have been discovered before it happened.`,
    JSON_INSTRUCTION,
    `Known event titles: ${JSON.stringify(input.knownEventTitles ?? [])}`,
    `Evidence: ${JSON.stringify({ ...input, env: undefined })}`
  ].join("\n\n");

  const raw = await callLlm({ env, model: env.llm.models.fast, prompt });
  return parseJsonWithRepair(raw, missHuntClassificationSchema, "missHuntClassification", env);
}

export async function parseJsonWithRepair<T>(
  raw: string,
  schema: z.ZodType<T>,
  schemaName: string,
  env: AppEnv
): Promise<T> {
  try {
    return parseWithSchema(schema, looseJsonParse(raw), schemaName);
  } catch (firstError) {
    const repaired = await repairJsonWithLlm(raw, schemaName, env);
    try {
      return parseWithSchema(schema, repaired, schemaName);
    } catch (secondError) {
      throw new Error(
        `${schemaName} parsing failed after one repair attempt: ${
          secondError instanceof Error ? secondError.message : String(secondError)
        }; first error: ${firstError instanceof Error ? firstError.message : String(firstError)}`
      );
    }
  }
}

async function parseWithModelFallbacks<T>(input: {
  env: AppEnv;
  models: string[];
  prompt: string;
  schema: z.ZodType<T>;
  schemaName: string;
}): Promise<T> {
  const errors: string[] = [];

  for (const model of input.models) {
    try {
      const raw = await callLlm({ env: input.env, model, prompt: input.prompt });
      return await parseJsonWithRepair(raw, input.schema, input.schemaName, input.env);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${model}: ${message}`);
      console.warn(`[llm] ${input.schemaName} failed with ${model}: ${message}`);
    }
  }

  throw new Error(`${input.schemaName} failed across models: ${errors.join(" | ")}`);
}

function orderedModels(...models: string[]): string[] {
  return Array.from(new Set(models.filter(Boolean)));
}

export function looseJsonParse(raw: string): unknown {
  const trimmed = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = Math.min(
      ...["{", "["].map((char) => {
        const index = trimmed.indexOf(char);
        return index === -1 ? Number.POSITIVE_INFINITY : index;
      })
    );
    const end = Math.max(trimmed.lastIndexOf("}"), trimmed.lastIndexOf("]"));
    if (!Number.isFinite(start) || end <= start) throw new Error("No JSON object or array found");
    return JSON.parse(trimmed.slice(start, end + 1));
  }
}

function describeTopic(topic: ProfileTopic): string {
  return `${topic.name} (${topic.keywords.slice(0, 8).join(", ")})`;
}

function mockExtractedEvent(input: ExtractEventInput): ExtractedEvent | null {
  const text = `${input.candidate.title} ${input.candidate.snippet} ${input.page?.text ?? ""}`.toLowerCase();
  if (!/(event|dinner|salon|breakfast|demo|meetup|workshop|panel|founder|builder|ai)/i.test(text)) {
    return null;
  }

  const startAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
  return {
    id: input.candidate.id,
    canonicalUrl: input.page?.canonicalUrl ?? input.candidate.canonicalUrl ?? input.candidate.url ?? input.candidate.sourceUrl,
    sourceUrls: Array.from(new Set([input.candidate.url, input.candidate.sourceUrl].filter((value): value is string => Boolean(value)))),
    title: input.candidate.title,
    description: input.candidate.snippet,
    startAt,
    timezone: "America/Los_Angeles",
    city: text.includes("palo alto") ? "Palo Alto" : "San Francisco",
    venueText: text.includes("tbd") ? "TBD" : undefined,
    locationPrecision: "city_only",
    hosts: ["Mock Organizer"],
    organizers: ["Mock Organizer"],
    platforms: [input.candidate.sourcePlatform],
    visibilityFlags: text.includes("approval") ? ["approval_required"] : ["public"],
    registrationStatus: text.includes("sold out") ? "sold_out" : "approval_required",
    eventType: text.includes("dinner") ? "dinner" : text.includes("salon") ? "salon" : "other",
    confidence: 0.82
  };
}

/**
 * Keyword scorer used in mock mode and when no LLM provider is configured.
 * It follows the same rubric as the LLM prompt, driven by the same profile.
 */
export function heuristicScoreEvent(event: ExtractedEvent, profile: ScoutProfile): StructuredEventScore {
  const haystack = eventHaystack(event);
  const excludedFormats = findKeywordMatches(haystack, profile.exclude.formats);
  const excludedTopics = findKeywordMatches(haystack, profile.exclude.topics);
  const eligibilityGates = findKeywordMatches(haystack, profile.exclude.eligibility);
  const matchedTopics = profile.topics.filter((topic) => topic.weight >= 0 && matchesAnyKeyword(haystack, topic.keywords));
  const audienceMatch = matchesAnyKeyword(haystack, profile.audience);
  const relevant = matchedTopics.length > 0 || audienceMatch;
  const curated = matchesAnyKeyword(haystack, [...CURATION_TERMS, ...profile.formats.prefer]);
  const hub = findKeywordMatches(haystack, profile.hubs)[0];
  const local = matchesAnyKeyword(haystack, localAreaTerms(profile));
  const generic = matchesAnyKeyword(haystack, profile.formats.avoid);
  const closed = event.registrationStatus === "sold_out" || event.registrationStatus === "closed";
  const mismatch = excludedTopics.length > 0 || eligibilityGates.length > 0;
  const blocked = mismatch || excludedFormats.length > 0;
  const hubRoom = Boolean(hub) && relevant;

  const userFit = mismatch ? 5 : matchedTopics.length ? 23 : audienceMatch ? 16 : 10;
  const roomQuality = blocked ? 6 : curated ? 18 : hubRoom ? 17 : 10;
  const networkingValue = blocked ? 3 : curated && relevant ? 14 : hubRoom ? 13 : audienceMatch ? 9 : 8;
  const timeliness = event.startAt ? 8 : 4;
  const locationActionability = local ? 9 : event.locationPrecision === "unknown" ? 2 : 5;
  const novelty = blocked ? 3 : curated ? 8 : hubRoom ? 7 : 4;
  const evidenceConfidence = Math.round(event.confidence * 10);
  const penaltyPoints =
    (generic ? 10 : 0) +
    (excludedFormats.length ? 30 : 0) +
    (excludedTopics.length ? 32 : 0) +
    (eligibilityGates.length ? 35 : 0) +
    (closed ? 12 : 0);
  const subtotal = userFit + roomQuality + networkingValue + timeliness + locationActionability + novelty + evidenceConfidence;
  const totalScore = Math.max(0, Math.min(100, subtotal - penaltyPoints));
  const recommendable = totalScore >= profile.thresholds.recommend && !closed && !blocked;

  return {
    eventId: event.id,
    totalScore,
    userFit,
    roomQuality,
    networkingValue,
    timeliness,
    locationActionability,
    novelty,
    evidenceConfidence,
    penalties: [
      ...(generic ? ["generic_large_or_online_format"] : []),
      ...excludedFormats.slice(0, 3).map((term) => `excluded_format:${term}`),
      ...excludedTopics.slice(0, 3).map((term) => `excluded_topic:${term}`),
      ...eligibilityGates.slice(0, 3).map((term) => `eligibility_gate:${term}`),
      ...(closed ? ["registration_unavailable"] : [])
    ],
    shouldRecommend: recommendable,
    rationale: [
      excludedTopics.length
        ? `Excluded topic: ${excludedTopics[0]}`
        : eligibilityGates.length
          ? `Eligibility gate likely excludes you: ${eligibilityGates[0]}`
          : excludedFormats.length
            ? `Excluded format: ${excludedFormats[0]}`
            : matchedTopics.length
              ? `Matches your topics: ${matchedTopics.map((topic) => topic.name).join(", ")}`
              : audienceMatch
                ? "Right audience, topic unclear"
                : "Weak profile fit",
      curated ? "Curated room signal" : hub ? `Ecosystem hub signal (${hub})` : "Limited curation evidence",
      local ? `${profile.region.name} location evidence` : "Location needs verification"
    ].join("; "),
    nextAction: closed ? "monitor" : blocked ? "skip" : curated ? "apply" : recommendable ? "rsvp" : "skip"
  };
}

function heuristicMissHuntClassification(input: MissHuntInput, profile: ScoutProfile): MissHuntClassification {
  const text = `${input.title} ${input.evidenceText}`;
  const relevant = matchesAnyKeyword(text, [
    ...relevantTopicKeywords(profile),
    ...profile.audience,
    ...profile.formats.prefer
  ]);
  const alreadyKnown = (input.knownEventTitles ?? []).some(
    (title) => normalizeTitle(title) === normalizeTitle(input.title)
  );

  return {
    eventTitle: input.title,
    eventUrl: input.url,
    wasMissed: relevant && !alreadyKnown,
    missReason: alreadyKnown ? "not_relevant" : relevant ? "source_gap" : "not_relevant",
    confidence: relevant ? 0.76 : 0.55,
    suggestedQuery: relevant ? `"${input.title}" ${profile.region.name} ${profile.search.phrases[0]} event` : undefined,
    rationale: relevant
      ? "Historical evidence matches the scout's high-signal event profile."
      : "Evidence does not clearly match the scout rubric."
  };
}

export function eventHaystack(event: ExtractedEvent): string {
  return [
    event.title,
    event.description,
    event.eventType,
    event.city,
    event.venueText,
    event.registrationStatus,
    ...event.visibilityFlags,
    ...event.hosts,
    ...event.organizers
  ]
    .filter(Boolean)
    .join(" ");
}

function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}
