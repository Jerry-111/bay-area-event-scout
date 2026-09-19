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
import { LlmServiceError } from "./llm-client.js";
import { scoreExtractedEvent } from "./score-event.js";
import type { ExtractedEvent, StructuredEventScore } from "./schemas.js";

const logger = createLogger("intelligence");
const HARD_MAX_LLM_EXTRACT_CANDIDATES_PER_RUN = 72;
const HARD_MAX_FIRECRAWL_PAGES_PER_RUN = 48;
const HARD_MAX_LLM_SCORE_EVENTS_PER_RUN = 48;
const MIN_LLM_SCORE_EVENTS_FOR_QUALITY = 24;
const MAX_REAL_EXTRACTION_STAGE_MS = 14 * 60 * 1000;
const MAX_REAL_SCORING_STAGE_MS = 8 * 60 * 1000;
const HARD_MAX_LLM_EXTRACT_CONCURRENCY = 6;
const HARD_MAX_LLM_SCORE_CONCURRENCY = 6;
/** Rate-limited pages (after the LLM client's own retries) tolerated before a stage gives up. */
const MAX_RATE_LIMITED_FAILURES = 3;

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

export interface ProcessCandidatesStats {
  candidatesReceived: number;
  candidatesLimited: number;
  candidatesAttempted: number;
  extractConcurrency: number;
  firecrawlPagesUsed: number;
  rawEventsExtracted: number;
  dedupedEventsExtracted: number;
  futureWindowEvents: number;
  dateWindowRejected: Record<string, number>;
  extractionStoppedByTimeBudget: boolean;
  scoreConcurrency: number;
  scoringEventsLimited: number;
  scoringEventsAttempted: number;
  scoringStoppedByTimeBudget: boolean;
}

export interface ProcessCandidatesResult {
  events: SharedEventCandidate[];
  stats: ProcessCandidatesStats;
}

export async function processCandidates(
  candidates: RawCandidate[],
  env: AppEnv,
  options: { now?: Date } = {}
): Promise<SharedEventCandidate[]> {
  return (await processCandidatesWithStats(candidates, env, options)).events;
}

/**
 * Reads candidate pages into events and scores them, a few at a time (MAX_LLM_EXTRACT_CONCURRENCY /
 * MAX_LLM_SCORE_CONCURRENCY). Stops early, with an error that says why, when the LLM provider
 * refuses requests outright (bad key, no billing, no access to the model), keeps rate-limiting, or
 * when every page failed, instead of finishing "successfully" with zero events.
 */
export async function processCandidatesWithStats(
  candidates: RawCandidate[],
  env: AppEnv,
  options: { now?: Date } = {}
): Promise<ProcessCandidatesResult> {
  const effectiveExtractLimit = Math.min(env.budgets.maxLlmExtractCandidatesPerRun, HARD_MAX_LLM_EXTRACT_CANDIDATES_PER_RUN);
  const effectiveFirecrawlLimit = Math.min(env.budgets.maxFirecrawlPagesPerRun, HARD_MAX_FIRECRAWL_PAGES_PER_RUN);
  const extractConcurrency = clampConcurrency(env.budgets.maxLlmExtractConcurrency, HARD_MAX_LLM_EXTRACT_CONCURRENCY);
  const scoreConcurrency = clampConcurrency(env.budgets.maxLlmScoreConcurrency, HARD_MAX_LLM_SCORE_CONCURRENCY);
  const limited = candidates.slice(0, effectiveExtractLimit);
  const extracted: Array<{ index: number; event: ExtractedEvent }> = [];
  const extractionGuard = new ProviderGuard();
  const extractionErrors: string[] = [];
  let firecrawlPagesUsed = 0;
  let candidatesAttempted = 0;
  let extractionStoppedByTimeBudget = false;
  const extractionStageStart = Date.now();

  logger.info("candidate extraction cap applied", {
    candidatesReceived: candidates.length,
    configuredExtractLimit: env.budgets.maxLlmExtractCandidatesPerRun,
    effectiveExtractLimit,
    configuredFirecrawlLimit: env.budgets.maxFirecrawlPagesPerRun,
    effectiveFirecrawlLimit,
    extractConcurrency
  });

  await runConcurrent(limited, extractConcurrency, async (candidate, index) => {
    if (extractionGuard.stopped) return;
    if (!env.mockMode && Date.now() - extractionStageStart > MAX_REAL_EXTRACTION_STAGE_MS) {
      extractionStoppedByTimeBudget = true;
      return;
    }
    candidatesAttempted += 1;
    const candidateStart = Date.now();
    const preferFirecrawl = firecrawlPagesUsed < effectiveFirecrawlLimit;
    if (preferFirecrawl) firecrawlPagesUsed += 1;
    // High-volume per-candidate detail: noise in an interactive terminal (there can be dozens of
    // these a run), so it's debug-only in pretty mode. JSON mode (Trigger.dev, CI, log
    // pipelines) never filters by level, so nothing is lost there.
    logger.debug("candidate extraction started", {
      candidateId: candidate.id,
      sourcePlatform: candidate.sourcePlatform,
      preferFirecrawl
    });
    try {
      const event = await extractEventFromCandidate({ candidate, env, preferFirecrawl });
      if (event) extracted.push({ index, event });
      logger.debug("candidate extraction finished", {
        candidateId: candidate.id,
        durationMs: Date.now() - candidateStart,
        extracted: Boolean(event)
      });
    } catch (error) {
      extractionErrors.push(errorMessage(error));
      extractionGuard.record(error);
      logger.warn("candidate extraction failed", {
        candidateId: candidate.id,
        durationMs: Date.now() - candidateStart,
        error: errorMessage(error)
      });
    }
  });

  extractionGuard.throwIfStopped("reading event pages");
  if (extracted.length === 0 && candidatesAttempted > 0 && extractionErrors.length === candidatesAttempted) {
    throw new Error(`Could not read any of the ${candidatesAttempted} event pages this scan. First error: ${extractionErrors[0]}`);
  }
  if (extractionStoppedByTimeBudget) {
    logger.warn("candidate extraction stopped by stage time budget", {
      elapsedMs: Date.now() - extractionStageStart,
      candidatesAttempted,
      extracted: extracted.length,
      remainingSkipped: limited.length - candidatesAttempted
    });
  }

  // Parallel reads finish in any order; put events back in ranking order before deduplicating.
  const extractedInInputOrder = extracted.sort((left, right) => left.index - right.index).map((item) => item.event);
  const dedupedGroups = dedupeEvents(extractedInInputOrder);
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
  const dateWindowRejected = countBy(windowRejected, (item) => item.reason);
  logger.info("candidate extraction aggregation finished", {
    rawExtracted: extractedInInputOrder.length,
    deduped: dedupedCandidates.length,
    futureWindowEligible: dedupedEvents.length,
    dateWindowRejected
  });
  const scorePercent = clampPercent(env.budgets.maxLlmScoreEventPercent ?? 30);
  const effectiveScoreLimit = buildEffectiveScoreLimit(dedupedEvents.length, env, scorePercent);
  const scoreLimit = dedupedEvents.slice(0, effectiveScoreLimit);
  const scored: Array<{ event: ExtractedEvent; score: StructuredEventScore }> = [];
  const scoringGuard = new ProviderGuard();
  const scoringErrors: string[] = [];
  let scoringEventsAttempted = 0;
  let scoringStoppedByTimeBudget = false;
  const scoringStageStart = Date.now();

  logger.info("event scoring cap applied", {
    eventsReceived: dedupedEvents.length,
    configuredScoreLimit: env.budgets.maxLlmScoreEventsPerRun,
    configuredScorePercent: scorePercent,
    minimumQualityScoreLimit: MIN_LLM_SCORE_EVENTS_FOR_QUALITY,
    hardScoreLimit: HARD_MAX_LLM_SCORE_EVENTS_PER_RUN,
    effectiveScoreLimit,
    scoreConcurrency
  });

  await runConcurrent(scoreLimit, scoreConcurrency, async (event) => {
    if (scoringGuard.stopped) return;
    if (!env.mockMode && Date.now() - scoringStageStart > MAX_REAL_SCORING_STAGE_MS) {
      scoringStoppedByTimeBudget = true;
      return;
    }
    scoringEventsAttempted += 1;
    const scoreStart = Date.now();
    // Same reasoning as candidate extraction above: per-event detail, debug-only in pretty mode.
    logger.debug("event scoring started", { eventId: event.id });
    try {
      scored.push({ event, score: await scoreExtractedEvent(event, env) });
      logger.debug("event scoring finished", { eventId: event.id, durationMs: Date.now() - scoreStart });
    } catch (error) {
      scoringErrors.push(errorMessage(error));
      scoringGuard.record(error);
      logger.warn("event scoring failed", {
        eventId: event.id,
        durationMs: Date.now() - scoreStart,
        error: errorMessage(error)
      });
    }
  });

  scoringGuard.throwIfStopped("scoring events");
  if (scored.length === 0 && scoringEventsAttempted > 0 && scoringErrors.length === scoringEventsAttempted) {
    throw new Error(`Could not score any of the ${scoringEventsAttempted} events this scan. First error: ${scoringErrors[0]}`);
  }
  if (scoringStoppedByTimeBudget) {
    logger.warn("event scoring stopped by stage time budget", {
      elapsedMs: Date.now() - scoringStageStart,
      scored: scored.length,
      remainingSkipped: scoreLimit.length - scoringEventsAttempted
    });
  }

  const events = scored
    .sort((left, right) => right.score.totalScore - left.score.totalScore)
    .map(({ event, score }) => toSharedEventCandidate(event, score));

  return {
    events,
    stats: {
      candidatesReceived: candidates.length,
      candidatesLimited: limited.length,
      candidatesAttempted,
      extractConcurrency,
      firecrawlPagesUsed,
      rawEventsExtracted: extractedInInputOrder.length,
      dedupedEventsExtracted: dedupedCandidates.length,
      futureWindowEvents: dedupedEvents.length,
      dateWindowRejected,
      extractionStoppedByTimeBudget,
      scoreConcurrency,
      scoringEventsLimited: scoreLimit.length,
      scoringEventsAttempted,
      scoringStoppedByTimeBudget
    }
  };
}

/**
 * Watches one stage's failures for signs that the LLM provider itself is the problem: an
 * account or configuration error stops the stage at once, and repeated rate limiting (after the
 * client's own retries) stops it after a few pages. Pages already in flight still finish.
 */
class ProviderGuard {
  stopped?: LlmServiceError;
  private rateLimitedFailures = 0;

  record(error: unknown): void {
    if (this.stopped || !(error instanceof LlmServiceError)) return;
    if (error.isAccountOrConfigProblem) {
      this.stopped = error;
    } else if (error.isRateLimited && ++this.rateLimitedFailures >= MAX_RATE_LIMITED_FAILURES) {
      this.stopped = error;
    }
  }

  throwIfStopped(stage: string): void {
    const error = this.stopped;
    if (!error) return;
    const why = error.isRateLimited
      ? "kept rate-limiting requests or is out of quota; if it is rate limiting, lower MAX_LLM_EXTRACT_CONCURRENCY and MAX_LLM_SCORE_CONCURRENCY"
      : "refused the request; check the API key, the model name, and the account's billing and model access";
    throw new Error(`The LLM provider stopped this scan while ${stage} (HTTP ${error.status}): it ${why}. Details: ${error.message}`);
  }
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

function clampConcurrency(value: number | undefined, hardMax: number): number {
  if (!value || !Number.isFinite(value)) return 1;
  return Math.max(1, Math.min(hardMax, Math.floor(value)));
}

/** Runs `worker` over `items` with at most `concurrency` calls in flight, in item order. */
async function runConcurrent<T>(items: T[], concurrency: number, worker: (item: T, index: number) => Promise<void>): Promise<void> {
  let nextIndex = 0;
  const lanes = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      await worker(items[index]!, index);
    }
  });
  await Promise.all(lanes);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
