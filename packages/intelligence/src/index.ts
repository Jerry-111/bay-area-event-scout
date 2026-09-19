import {
  createLogger,
  classifyEventWindowRejection,
  filterEventsInFutureWindow,
  type AppEnv,
  type EventCandidate as SharedEventCandidate,
  type RawCandidate,
  type SourcePlatform
} from "@event-scout/shared";
import { buildEventDedupeKey, dedupeEvents } from "./dedupe.js";
import { extractEventFromCandidate } from "./extract-event.js";
import { scoreExtractedEvent } from "./score-event.js";
import type { ExtractedEvent, StructuredEventScore } from "./schemas.js";

const logger = createLogger("intelligence");
const HARD_MAX_LLM_EXTRACT_CANDIDATES_PER_RUN = 72;
const HARD_MAX_FIRECRAWL_PAGES_PER_RUN = 48;
const HARD_MAX_LLM_SCORE_EVENTS_PER_RUN = 48;
const MIN_LLM_SCORE_EVENTS_FOR_QUALITY = 24;
const MAX_REAL_EXTRACTION_STAGE_MS = 14 * 60 * 1000;
const MAX_REAL_SCORING_STAGE_MS = 8 * 60 * 1000;

export * from "./dedupe.js";
export * from "./extract-event.js";
export * from "./fetch-page.js";
export * from "./firecrawl.js";
export * from "./miss-hunt.js";
export * from "./llm-client.js";
export * from "./llm.js";
export * from "./profile-draft.js";
export * from "./rank.js";
export * from "./schemas.js";
export * from "./score-event.js";

export async function processCandidates(
  candidates: RawCandidate[],
  env: AppEnv,
  options: { now?: Date } = {}
): Promise<SharedEventCandidate[]> {
  const effectiveExtractLimit = Math.min(env.budgets.maxLlmExtractCandidatesPerRun, HARD_MAX_LLM_EXTRACT_CANDIDATES_PER_RUN);
  const effectiveFirecrawlLimit = Math.min(env.budgets.maxFirecrawlPagesPerRun, HARD_MAX_FIRECRAWL_PAGES_PER_RUN);
  const limited = candidates.slice(0, effectiveExtractLimit);
  const extracted: ExtractedEvent[] = [];
  let firecrawlPagesUsed = 0;
  let candidatesAttempted = 0;
  const extractionStageStart = Date.now();

  logger.info("candidate extraction cap applied", {
    candidatesReceived: candidates.length,
    configuredExtractLimit: env.budgets.maxLlmExtractCandidatesPerRun,
    effectiveExtractLimit,
    configuredFirecrawlLimit: env.budgets.maxFirecrawlPagesPerRun,
    effectiveFirecrawlLimit
  });

  for (const candidate of limited) {
    if (!env.mockMode && Date.now() - extractionStageStart > MAX_REAL_EXTRACTION_STAGE_MS) {
      logger.warn("candidate extraction stopped by stage time budget", {
        elapsedMs: Date.now() - extractionStageStart,
        candidatesAttempted,
        extracted: extracted.length,
        remainingSkipped: limited.length - candidatesAttempted
      });
      break;
    }
    candidatesAttempted += 1;
    const candidateStart = Date.now();
    const preferFirecrawl = firecrawlPagesUsed < effectiveFirecrawlLimit;
    // High-volume per-candidate detail: noise in an interactive terminal (there can be dozens of
    // these a run), so it's debug-only in pretty mode. JSON mode (Trigger.dev, CI, log
    // pipelines) never filters by level, so nothing is lost there.
    logger.debug("candidate extraction started", {
      candidateId: candidate.id,
      sourcePlatform: candidate.sourcePlatform,
      preferFirecrawl
    });
    try {
      if (preferFirecrawl) firecrawlPagesUsed += 1;
      const event = await extractEventFromCandidate({ candidate, env, preferFirecrawl });
      if (event) extracted.push(event);
      logger.debug("candidate extraction finished", {
        candidateId: candidate.id,
        durationMs: Date.now() - candidateStart,
        extracted: Boolean(event)
      });
    } catch (error) {
      logger.warn("candidate extraction failed", {
        candidateId: candidate.id,
        durationMs: Date.now() - candidateStart,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  const dedupedGroups = dedupeEvents(extracted);
  const dedupedCandidates = dedupedGroups.map((group) => group.event);
  const dedupedEvents = filterEventsInFutureWindow(dedupedCandidates, { now: options.now });
  const windowRejected = dedupedCandidates
    .map((event) => ({ event, reason: classifyEventWindowRejection(event, { now: options.now }) }))
    .filter((item): item is { event: ExtractedEvent; reason: NonNullable<ReturnType<typeof classifyEventWindowRejection>> } =>
      Boolean(item.reason)
    );
  for (const { event, reason } of windowRejected) {
    logger.warn("extracted event rejected by date window", {
      eventId: event.id,
      title: event.title,
      startAt: event.startAt,
      reason
    });
  }
  logger.info("candidate extraction aggregation finished", {
    rawExtracted: extracted.length,
    deduped: dedupedCandidates.length,
    futureWindowEligible: dedupedEvents.length,
    dateWindowRejected: countBy(windowRejected, (item) => item.reason)
  });
  const scorePercent = clampPercent(env.budgets.maxLlmScoreEventPercent ?? 30);
  const effectiveScoreLimit = buildEffectiveScoreLimit(dedupedEvents.length, env, scorePercent);
  const scoreLimit = dedupedEvents.slice(0, effectiveScoreLimit);
  const scored: Array<{ event: ExtractedEvent; score: StructuredEventScore }> = [];
  const scoringStageStart = Date.now();

  logger.info("event scoring cap applied", {
    eventsReceived: dedupedEvents.length,
    configuredScoreLimit: env.budgets.maxLlmScoreEventsPerRun,
    configuredScorePercent: scorePercent,
    minimumQualityScoreLimit: MIN_LLM_SCORE_EVENTS_FOR_QUALITY,
    hardScoreLimit: HARD_MAX_LLM_SCORE_EVENTS_PER_RUN,
    effectiveScoreLimit
  });

  for (const event of scoreLimit) {
    if (!env.mockMode && Date.now() - scoringStageStart > MAX_REAL_SCORING_STAGE_MS) {
      logger.warn("event scoring stopped by stage time budget", {
        elapsedMs: Date.now() - scoringStageStart,
        scored: scored.length,
        remainingSkipped: scoreLimit.length - scored.length
      });
      break;
    }
    const scoreStart = Date.now();
    // Same reasoning as candidate extraction above: per-event detail, debug-only in pretty mode.
    logger.debug("event scoring started", { eventId: event.id });
    try {
      scored.push({ event, score: await scoreExtractedEvent(event, env) });
      logger.debug("event scoring finished", { eventId: event.id, durationMs: Date.now() - scoreStart });
    } catch (error) {
      logger.warn("event scoring failed", {
        eventId: event.id,
        durationMs: Date.now() - scoreStart,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return scored
    .sort((left, right) => right.score.totalScore - left.score.totalScore)
    .map(({ event, score }) =>
    toSharedEventCandidate(event, score)
  );
}

export function toSharedEventCandidate(
  event: ExtractedEvent,
  score: StructuredEventScore
): SharedEventCandidate {
  return {
    id: event.id,
    canonicalUrl: event.canonicalUrl,
    sourceUrls: event.sourceUrls,
    sourcePlatforms: event.platforms
      .filter((platform): platform is SourcePlatform => isSharedSourcePlatform(platform)),
    title: event.title,
    startAt: event.startAt,
    endAt: event.endAt,
    timezone: event.timezone,
    city: event.city ?? "Unknown",
    venueText: event.venueText,
    locationPrecision: event.locationPrecision,
    hosts: event.hosts.length ? event.hosts : event.organizers,
    description: event.description ?? "",
    status: event.registrationStatus,
    visibilityFlags: event.visibilityFlags,
    score: score.totalScore,
    scoreBreakdown: {
      userFit: score.userFit,
      roomQuality: score.roomQuality,
      networkingValue: score.networkingValue,
      timeliness: score.timeliness,
      locationActionability: score.locationActionability,
      novelty: score.novelty,
      evidenceConfidence: score.evidenceConfidence,
      nextAction: score.nextAction
    },
    reasons: [score.rationale],
    risks: score.penalties,
    registrationStatus: event.registrationStatus,
    eventType: event.eventType,
    confidence: event.confidence,
  };
}

export function eventDedupeKeyForSharedCandidate(event: ExtractedEvent): string {
  return buildEventDedupeKey(event);
}

function isSharedSourcePlatform(platform: string): platform is SourcePlatform {
  return ["exa", "x", "luma", "meetup", "eventbrite", "linkedin_indexed", "firecrawl", "manual", "mock", "web"].includes(platform);
}

function countBy<T>(items: T[], getKey: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const key = getKey(item);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function buildEffectiveScoreLimit(eventCount: number, env: AppEnv, scorePercent: number): number {
  if (eventCount <= 0) return 0;
  const percentTarget = Math.ceil(eventCount * (scorePercent / 100));
  const qualityFloor = Math.min(MIN_LLM_SCORE_EVENTS_FOR_QUALITY, eventCount);
  return Math.min(
    eventCount,
    env.budgets.maxLlmScoreEventsPerRun,
    HARD_MAX_LLM_SCORE_EVENTS_PER_RUN,
    Math.max(percentTarget, qualityFloor)
  );
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 30;
  return Math.max(0, Math.min(100, value));
}
