import { dirname } from "node:path";
import { createEventStore, FileEventStore, type EventSourceLink, type EventStore } from "@event-scout/db";
import {
  buildDailyQueryPack,
  classifyCandidateIntent,
  discoverCandidatesWithStats as discoverCandidateFixtures,
  type QuerySpec
} from "@event-scout/discovery";
import {
  areLikelyDuplicateEvents,
  processCandidatesWithStats,
  type DedupeComparableEvent,
  type ProcessCandidatesStats
} from "@event-scout/intelligence";
import { sendDigest as sendDigestFixture } from "@event-scout/notify";
import { logger as triggerLogger, metadata as triggerMetadata, type RunMetadata } from "@trigger.dev/sdk";
import {
  type AppEnv,
  type CandidateUrl,
  type EventCandidate,
  type EventScore,
  type RawCandidate,
  type Recommendation,
  type RunStats,
  type RunType,
  type ScanMode,
  type ScoutRun,
  type Logger,
  type ScoutProfile,
  canonicalizeUrl,
  createId,
  createLogger,
  createRunStats,
  describeLlm,
  filterEventsInFutureWindow,
  getLogFormat,
  isMainModule,
  loadRuntimeEnv,
  normalizeRawCandidate
} from "@event-scout/shared";
import {
  buildAgenticSearchPlan,
  mergeAgenticSearchPlan,
  summarizeSearchPlannerHistory,
  summarizeSearchPlanItems,
  summarizeQueryMix,
  type SearchPlannerHistory
} from "./search-planner.js";

const logger = createTriggerAwareLogger("worker:scout");

export interface RunDailyScoutOptions {
  runType: Extract<RunType, "daily" | "manual">;
  env?: AppEnv;
  scanTime?: string;
  now?: Date;
}

export async function runDailyScout(options: RunDailyScoutOptions = { runType: "manual" }): Promise<RunStats> {
  const env = options.env ?? loadRuntimeEnv();
  const store = createEventStore(env);
  const now = options.now ?? new Date();
  const scanTime = options.scanTime ?? env.scanSchedules[0] ?? "09:00";
  let failureStats: Partial<RunStats> = { mockMode: env.mockMode };
  let run: ScoutRun | undefined;

  try {
    run = await store.createRun(options.runType);
    const runId = run.id;
    logger.info("run started", {
      runId,
      runType: run.runType,
      mockMode: env.mockMode,
      scanTime,
      profile: env.profile.name,
      profileSource: env.profileSource,
      // Flattened so pretty mode's one-line summary shows the LLM at a glance; `llm` below keeps
      // the full breakdown (baseUrl, models, disabledReason) for JSON mode.
      llmProvider: env.llm.provider,
      llmEnabled: env.llm.enabled,
      llm: describeLlm(env.llm)
    });
    if (!env.mockMode && !env.llm.enabled) {
      logger.warn("no LLM provider configured: real scans collect candidate links but cannot extract events; run `pnpm onboard` or set LLM_PROVIDER", {
        runId,
        reason: env.llm.disabledReason
      });
    }
    setScoutMetadata({
      status: "running",
      stage: "run_started",
      runId,
      runType: run.runType,
      mockMode: env.mockMode,
      scanTime
    });

    const countStart = Date.now();
    logger.info("count x posts used today started", { runId, scanTime });
    const xPostsUsedToday = await countXPostsUsedToday(store, now);
    const xBudgetRemainingBeforeRun = Math.max(0, env.budgets.maxXPostsPerDay - xPostsUsedToday);
    const xAllowedBySchedule = env.xScanSchedules.includes(scanTime);
    const scanMode: ScanMode = xAllowedBySchedule ? "full" : "light";
    const xEnabled = xAllowedBySchedule && xBudgetRemainingBeforeRun > 0 && env.budgets.maxXPostsPerRun > 0;
    failureStats = {
      ...failureStats,
      scanMode,
      xEnabled,
      xPostsRead: 0,
      xBudgetRemaining: xBudgetRemainingBeforeRun
    };
    logger.info("count x posts used today finished", {
      runId,
      durationMs: Date.now() - countStart,
      xPostsUsedToday,
      xBudgetRemaining: xBudgetRemainingBeforeRun,
      xAllowedBySchedule,
      xEnabled
    });
    setScoutMetadata({
      stage: "budget_checked",
      scanMode,
      xEnabled,
      xPostsUsedToday,
      xBudgetRemaining: xBudgetRemainingBeforeRun
    });

    const runContext = {
      scanMode,
      scanTime,
      xEnabled,
      xBudgetRemaining: xBudgetRemainingBeforeRun
    };
    const staticQueryPack = buildDailyQueryPack(now, { scanTime, profile: env.profile });
    const plannerStart = Date.now();
    logger.info("search planner started", {
      runId,
      scanTime,
      maxExaSearchesPerRun: env.budgets.maxExaSearchesPerRun,
      maxAgentGeneratedExaQueries: env.budgets.maxAgentGeneratedExaQueries,
      maxAgentGeneratedXQueries: env.budgets.maxAgentGeneratedXQueries,
      maxExplorationBudgetPercent: env.budgets.maxExplorationBudgetPercent ?? 50
    });
    const plannerHistory = await loadSearchPlannerHistory(store);
    logger.info("search planner history loaded", {
      runId,
      ...summarizeSearchPlannerHistory(plannerHistory)
    });
    const searchPlan = await buildAgenticSearchPlan({
      env,
      now,
      scanTime,
      runContext,
      staticQueryPack,
      history: plannerHistory
    });
    const queryPack = mergeAgenticSearchPlan(staticQueryPack, searchPlan, env);
    logger.info("search planner finished", {
      runId,
      durationMs: Date.now() - plannerStart,
      planner: searchPlan.planner,
      searchPlanId: searchPlan.id,
      targetExaQueries: searchPlan.targetExaQueries,
      generatedExaQueries: searchPlan.items.length,
      staticQueryMix: summarizeQueryMix(staticQueryPack),
      plannedQueryMix: summarizeQueryMix(queryPack)
    });
    setScoutMetadata({
      stage: "planner_finished",
      planner: {
        mode: searchPlan.planner,
        searchPlanId: searchPlan.id,
        targetExaQueries: searchPlan.targetExaQueries,
        generatedExaQueries: searchPlan.items.length,
        plannedQueryMix: summarizeQueryMix(queryPack)
      }
    });
    logger.info("search planner generated queries", {
      runId,
      searchPlanId: searchPlan.id,
      planner: searchPlan.planner,
      items: summarizeSearchPlanItems(searchPlan)
    });

    const discoveryStart = Date.now();
    logger.info("discovery started", {
      runId,
      scanMode,
      xEnabled,
      queryMix: summarizeQueryMix(queryPack)
    });
    const discovery = await discoverCandidates(runId, env, runContext, queryPack, now);
    logger.info("discovery finished", {
      runId,
      durationMs: Date.now() - discoveryStart,
      candidatesFound: discovery.candidates.length,
      xPostsRead: discovery.stats.xPostsRead,
      xBudgetRemaining: discovery.stats.xBudgetRemaining,
      xSkippedReason: discovery.stats.xSkippedReason
    });
    setScoutMetadata({
      stage: "discovery_finished",
      discovery: {
        candidatesFound: discovery.candidates.length,
        xPostsRead: discovery.stats.xPostsRead,
        xBudgetRemaining: discovery.stats.xBudgetRemaining,
        xSkippedReason: discovery.stats.xSkippedReason
      }
    });

    const rawCandidates = discovery.candidates;
    const candidateUrls = rawCandidates.map((candidate) => normalizeRawCandidate(candidate, runId));
    const candidateSaveStart = Date.now();
    logger.info("candidate save started", { runId, candidatesFound: candidateUrls.length });
    await store.saveCandidateUrls(runId, candidateUrls);
    logger.info("candidate save finished", {
      runId,
      durationMs: Date.now() - candidateSaveStart,
      candidatesSaved: candidateUrls.length
    });
    // If a later stage fails, the run still records how far discovery got.
    failureStats = {
      ...failureStats,
      candidatesFound: candidateUrls.length,
      rejectedCandidates: candidateUrls.filter((candidate) => candidate.status === "rejected").length,
      xPostsRead: discovery.stats.xPostsRead,
      xBudgetRemaining: discovery.stats.xBudgetRemaining
    };

    // Loaded before extraction so candidates already recommended in earlier runs go to the back
    // of the queue: the extraction budget is spent on events the person has not seen yet.
    const recommendationHistory = await loadRecommendationHistory(store);
    const extractionStart = Date.now();
    const extractableCandidatesBeforeDedupe = rawCandidates.filter((candidate) => candidate.status !== "rejected" && candidate.status !== "error");
    const extractableCandidates = rankCandidatesForExtraction(
      extractableCandidatesBeforeDedupe,
      env.profile,
      recommendationHistory
    );
    const duplicateCandidatesSkipped = Math.max(0, extractableCandidatesBeforeDedupe.length - extractableCandidates.length);
    logger.info("extraction and scoring started", {
      runId,
      candidatesToProcess: extractableCandidates.length,
      candidatesBeforeUrlDedupe: extractableCandidatesBeforeDedupe.length,
      duplicateCandidatesSkipped,
      previouslyRecommendedCandidatesDemoted: countPreviouslyRecommendedCandidates(extractableCandidates, recommendationHistory),
      candidateQuality: summarizeCandidateQuality(extractableCandidates, env.profile)
    });
    const extraction = await extractAndScoreWithStats(runId, extractableCandidates, env, { now });
    const events = extraction.events;
    logger.info("extraction and scoring finished", {
      runId,
      durationMs: Date.now() - extractionStart,
      eventsExtracted: events.length,
      extractionStats: extraction.stats
    });
    setScoutMetadata({
      stage: "extraction_finished",
      extraction: {
        candidatesBeforeUrlDedupe: extractableCandidatesBeforeDedupe.length,
        candidatesAfterUrlDedupe: extractableCandidates.length,
        duplicateCandidatesSkipped,
        eventsExtracted: events.length,
        ...extraction.stats
      }
    });

    const eventSaveStart = Date.now();
    logger.info("event save started", { runId, eventsExtracted: events.length });
    await store.saveEvents(events);
    logger.info("event save finished", { runId, durationMs: Date.now() - eventSaveStart, eventsSaved: events.length });

    const eventSourceLinks = buildEventSourceLinks(events, candidateUrls);
    if (eventSourceLinks.length > 0) {
      const eventSourceStart = Date.now();
      logger.info("event source attribution started", { runId, linksCreated: eventSourceLinks.length });
      await store.saveEventSources?.(eventSourceLinks);
      logger.info("event source attribution finished", {
        runId,
        durationMs: Date.now() - eventSourceStart,
        linksSaved: eventSourceLinks.length
      });
    }

    const scores = buildScores(events, env.profile);
    const scoreSaveStart = Date.now();
    logger.info("score save started", { runId, scoresCreated: scores.length });
    await store.saveEventScores(runId, scores);
    logger.info("score save finished", { runId, durationMs: Date.now() - scoreSaveStart, scoresSaved: scores.length });

    const recommendationNovelty = filterPreviouslyRecommendedEvents(events, recommendationHistory);
    if (recommendationNovelty.skipped.length > 0) {
      logger.info("previously recommended events suppressed", {
        runId,
        skipped: recommendationNovelty.skipped.length,
        titles: recommendationNovelty.skipped.slice(0, 10).map((event) => event.title)
      });
    }

    const recommendations = buildRecommendations(runId, recommendationNovelty.eligible, env, now);
    const digestEvents = eventsForDigest(recommendationNovelty.eligible, recommendations, env);
    const recommendationSaveStart = Date.now();
    logger.info("recommendation save started", { runId, recommendationsCreated: recommendations.length });
    await store.saveRecommendations(runId, recommendations);
    logger.info("recommendation save finished", {
      runId,
      durationMs: Date.now() - recommendationSaveStart,
      recommendationsSaved: recommendations.length
    });
    setScoutMetadata({
      stage: "recommendations_finished",
      output: {
        eventsExtracted: events.length,
        scoresCreated: scores.length,
        recommendationsCreated: recommendations.length
      }
    });

    const digestStart = Date.now();
    logger.info("digest started", {
      runId,
      eventsForDigest: digestEvents.length,
      previouslyRecommendedSkipped: recommendationNovelty.skipped.length
    });
    try {
      const digestResult = await sendDigest(runId, digestEvents, env, now);
      logger.info("digest finished", {
        runId,
        durationMs: Date.now() - digestStart,
        delivered: digestResult.delivered,
        mock: digestResult.mock,
        messageLength: digestResult.message.length
      });
      setScoutMetadata({
        stage: "digest_finished",
        digest: {
          delivered: digestResult.delivered,
          mock: digestResult.mock,
          messageLength: digestResult.message.length
        }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn("digest failed", {
        runId,
        durationMs: Date.now() - digestStart,
        error: message
      });
      setScoutMetadata({
        stage: "digest_failed",
        digest: {
          delivered: false,
          mock: false,
          error: message
        }
      });
    }

    const stats = createRunStats({
      candidatesFound: candidateUrls.length,
      pagesInspected: candidateUrls.filter((candidate) => candidate.status === "fetched").length,
      eventsExtracted: events.length,
      scoresCreated: scores.length,
      recommendationsCreated: recommendations.length,
      rejectedCandidates: candidateUrls.filter((candidate) => candidate.status === "rejected").length,
      mockMode: env.mockMode,
      scanMode,
      xEnabled,
      xPostsRead: discovery.stats.xPostsRead,
      xBudgetRemaining: discovery.stats.xBudgetRemaining,
      ...runStatsFromExtraction(extraction.stats)
    });
    failureStats = stats;
    const qualitySummary = buildPipelineQualitySummary({
      profile: env.profile,
      queryPack,
      staticQueryPack,
      plannerHistory,
      searchPlan,
      rawCandidates,
      candidateUrls,
      extractableCandidatesBeforeDedupe,
      extractableCandidates,
      duplicateCandidatesSkipped,
      events,
      scores,
      recommendations,
      eventSourceLinks
    });
    logger.info("pipeline quality summary", {
      runId,
      // Flattened top-level numbers and flags so pretty mode can show one compact, actionable
      // line (e.g. `qualityFlags=[low_extraction_yield]`) instead of the full nested breakdown.
      // `quality` below still carries everything for JSON mode and Trigger metadata.
      candidatesFound: stats.candidatesFound,
      eventsExtracted: stats.eventsExtracted,
      recommendationsCreated: stats.recommendationsCreated,
      qualityFlags: qualitySummary.qualityFlags,
      quality: qualitySummary
    });
    setScoutMetadata({
      stage: "quality_summary_finished",
      qualitySummary,
      qualityFlags: qualitySummary.qualityFlags
    });

    const finishStart = Date.now();
    logger.info("finish run started", { runId });
    await store.finishRun(runId, stats);
    logger.info("finish run finished", { runId, durationMs: Date.now() - finishStart });
    logger.info("run finished", { runId, funnel: describeFunnel(stats), stats });
    setScoutMetadata({ status: "finished", stage: "run_finished", stats });
    await flushScoutMetadata();
    printLocalRunSummaryIfNeeded(env, store, stats);
    return stats;
  } catch (error) {
    if (run) {
      await store.failRun(run.id, error, failureStats);
    }
    logger.error("run failed", { runId: run?.id, error: error instanceof Error ? error.message : String(error) });
    setScoutMetadata({
      status: "failed",
      stage: "run_failed",
      runId: run?.id,
      error: error instanceof Error ? error.message : String(error)
    });
    await flushScoutMetadata();
    throw error;
  } finally {
    await store.close?.();
  }
}

/**
 * A first-time mock run and a zero-infrastructure real run (no Postgres) share the same problem:
 * the thing the user actually wants — the digest, the funnel — is easy to lose track of once the
 * structured JSON logs have scrolled past. In `pretty` mode (never `json`: CI/Trigger.dev/log
 * pipelines shouldn't get stray non-JSON lines), end the run with a short, friendly pointer to
 * what happened and what to do next, on top of (not instead of) the structured logs and
 * Trigger.dev metadata above.
 */
export function printLocalRunSummaryIfNeeded(env: AppEnv, store: EventStore, stats: RunStats): void {
  if (getLogFormat() !== "pretty") return;

  if (env.mockMode) {
    console.log("");
    console.log(`Mock run complete: ${describeFunnel(stats)}`);
    console.log("Run `pnpm admin` to see them on the dashboard, or `pnpm onboard` to set up real API keys.");
    return;
  }

  if (!env.llm.enabled) {
    console.log("");
    console.log(`Scout run complete: ${describeFunnel(stats)}`);
    console.log("No LLM is configured, so candidate links were collected but no events were read.");
    console.log("Run `pnpm onboard` to add one (a local model through Ollama works too), then `pnpm scout:real` again.");
    return;
  }

  if (env.databaseUrl || !(store instanceof FileEventStore)) return;

  try {
    const dataDir = dirname(store.dataFilePath);
    console.log("");
    console.log(`Scout run complete: ${describeFunnel(stats)}`);
    console.log(`Results stored in ${dataDir}`);
    console.log("Run `pnpm admin` to review them.");
  } catch {
    // Purely a friendly console message; never let it fail an otherwise-successful run.
  }
}

function describeFunnel(stats: RunStats): string {
  return (
    `${stats.candidatesFound} candidate${plural(stats.candidatesFound)} -> ` +
    `${stats.eventsExtracted} event${plural(stats.eventsExtracted)} -> ` +
    `${stats.recommendationsCreated} recommendation${plural(stats.recommendationsCreated)}`
  );
}

function plural(count: number): string {
  return count === 1 ? "" : "s";
}

export async function runScout(): Promise<void> {
  const stats = await runDailyScout({ runType: "manual" });
  // In pretty mode, printLocalRunSummaryIfNeeded (inside runDailyScout) already gave the human
  // reader a clean summary; a raw JSON dump right after would just bury it again. JSON mode
  // (CI, scripting, piping into another tool) keeps getting the full stats object as before.
  if (getLogFormat() !== "pretty") {
    console.log(JSON.stringify(stats, null, 2));
  }
}

export async function discoverCandidates(
  runId: string,
  env: AppEnv = loadRuntimeEnv(),
  runContext?: { scanMode: ScanMode; scanTime?: string; xEnabled: boolean; xBudgetRemaining: number },
  queryPack?: QuerySpec[],
  now?: Date
): Promise<{ candidates: RawCandidate[]; stats: { xPostsRead: number; xBudgetRemaining: number; xSkippedReason?: string } }> {
  const discovery = queryPack
    ? await discoverCandidateFixtures(runId, queryPack, env, { runContext, now })
    : await discoverCandidateFixtures(runId, env, undefined, { runContext, now });
  const rawCandidates = discovery.candidates;
  return {
    candidates: rawCandidates.map((candidate) => {
    const sourceUrl = candidate.sourceUrl || candidate.url || "mock://candidate";
    const url = candidate.url || sourceUrl;
    return {
      ...candidate,
      id: candidate.id || createId("candidate"),
      runId,
      url,
      sourceUrl,
      canonicalUrl: candidate.canonicalUrl || canonicalizeUrl(url),
      status: candidate.status ?? "new"
    };
    }),
    stats: discovery.stats
  };
}

async function loadSearchPlannerHistory(store: ReturnType<typeof createEventStore>): Promise<SearchPlannerHistory> {
  try {
    const [recentCandidates, recentEvents, recentRecommendations] = await Promise.all([
      store.listCandidateUrls({ limit: 300 }),
      store.listEvents({ limit: 100 }),
      store.listRecommendations({ limit: 50 })
    ]);
    return { recentCandidates, recentEvents, recentRecommendations };
  } catch (error) {
    logger.warn("search planner history unavailable", {
      error: error instanceof Error ? error.message : String(error)
    });
    return {
      recentCandidates: [],
      recentEvents: [],
      recentRecommendations: []
    };
  }
}

export async function extractAndScore(
  runId: string,
  candidates: RawCandidate[],
  env: AppEnv = loadRuntimeEnv(),
  options: { now?: Date } = {}
): Promise<EventCandidate[]> {
  return (await extractAndScoreWithStats(runId, candidates, env, options)).events;
}

export async function extractAndScoreWithStats(
  runId: string,
  candidates: RawCandidate[],
  env: AppEnv = loadRuntimeEnv(),
  options: { now?: Date } = {}
): Promise<{ events: EventCandidate[]; stats: ProcessCandidatesStats }> {
  const result = await processCandidatesWithStats(candidates, env, options);
  return {
    events: result.events.map((event) => ({
      ...event,
      runId,
      id: event.id || createId("event"),
      organizers: event.organizers ?? event.hosts,
      platforms: event.platforms ?? event.sourcePlatforms ?? ["mock"],
      confidence: event.confidence ?? Math.min(1, Math.max(0, (event.score ?? 0) / 100)),
      registrationStatus: event.registrationStatus ?? event.status
    })),
    stats: result.stats
  };
}

function runStatsFromExtraction(stats: ProcessCandidatesStats): Partial<RunStats> {
  return {
    extractionCandidatesAttempted: stats.candidatesAttempted,
    extractionCandidatesLimit: stats.candidatesLimited,
    extractionConcurrency: stats.extractConcurrency,
    extractionStoppedByTimeBudget: stats.extractionStoppedByTimeBudget,
    firecrawlPagesUsed: stats.firecrawlPagesUsed,
    rawEventsExtracted: stats.rawEventsExtracted,
    dedupedEventsExtracted: stats.dedupedEventsExtracted,
    futureWindowEvents: stats.futureWindowEvents,
    dateWindowRejected: stats.dateWindowRejected,
    scoringEventsAttempted: stats.scoringEventsAttempted,
    scoringEventsLimit: stats.scoringEventsLimited,
    scoringConcurrency: stats.scoreConcurrency,
    scoringStoppedByTimeBudget: stats.scoringStoppedByTimeBudget
  };
}

export async function sendDigest(
  _runId: string,
  events: EventCandidate[],
  env: AppEnv = loadRuntimeEnv(),
  now = new Date()
): Promise<Awaited<ReturnType<typeof sendDigestFixture>>> {
  return sendDigestFixture(filterEventsInFutureWindow(events, { now }), env);
}

/** Persists the scorer's real component scores; older events without a breakdown get a proportional split. */
export function buildScores(events: EventCandidate[], profile: ScoutProfile): EventScore[] {
  return events.map((event) => {
    const totalScore = event.score ?? Math.round((event.confidence ?? 0) * 100);
    const breakdown = event.scoreBreakdown;
    const recommended = totalScore >= profile.thresholds.recommend;
    return {
      eventId: event.id,
      totalScore,
      score: totalScore,
      userFit: breakdown?.userFit ?? Math.min(25, Math.round(totalScore * 0.25)),
      roomQuality: breakdown?.roomQuality ?? Math.min(20, Math.round(totalScore * 0.2)),
      networkingValue: breakdown?.networkingValue ?? Math.min(15, Math.round(totalScore * 0.15)),
      timeliness: breakdown?.timeliness ?? Math.min(10, Math.round(totalScore * 0.1)),
      locationActionability: breakdown?.locationActionability ?? Math.min(10, Math.round(totalScore * 0.1)),
      novelty: breakdown?.novelty ?? Math.min(10, Math.round(totalScore * 0.1)),
      evidenceConfidence: breakdown?.evidenceConfidence ?? Math.min(10, Math.round(totalScore * 0.1)),
      penalties: event.risks ?? [],
      risks: event.risks ?? [],
      shouldRecommend: recommended,
      rationale: event.reasons?.join("; ") ?? "No scorer rationale recorded.",
      reasons: event.reasons ?? [],
      nextAction: breakdown?.nextAction ?? (recommended ? "apply" : "monitor")
    };
  });
}

function buildRecommendations(runId: string, events: EventCandidate[], env: AppEnv, now = new Date()): Recommendation[] {
  return filterEventsInFutureWindow(events, { now })
    .filter((event) => (event.score ?? 0) >= env.profile.thresholds.recommend)
    .sort((left, right) => (right.score ?? 0) - (left.score ?? 0))
    .slice(0, env.budgets.maxRecommendationsPerRun)
    .map((event) => ({
      id: createId("rec"),
      runId,
      eventId: event.id,
      score: event.score ?? 0,
      reason: event.reasons?.join("; ") || "Recommended by current scoring pipeline.",
      createdAt: new Date().toISOString()
    }));
}

/**
 * The digest shows this run's saved recommendations and, under "Possible", the new events in the
 * review band. Recommending more than was saved (past MAX_RECOMMENDATIONS_PER_RUN) would show
 * events that are not recorded as sent, so they would come back in the next digest.
 */
export function eventsForDigest(events: EventCandidate[], recommendations: Recommendation[], env: AppEnv): EventCandidate[] {
  const recommendedIds = new Set(recommendations.map((recommendation) => recommendation.eventId));
  const { recommend, review } = env.profile.thresholds;
  return events.filter((event) => {
    const score = event.score ?? 0;
    return recommendedIds.has(event.id) || (score >= review && score < recommend);
  });
}

export interface RecommendationHistory {
  recommendations: Recommendation[];
  events: EventCandidate[];
}

async function loadRecommendationHistory(store: Pick<EventStore, "listRecommendations" | "listEvents">): Promise<RecommendationHistory> {
  try {
    const [recommendations, events] = await Promise.all([
      store.listRecommendations({ limit: 500 }),
      store.listEvents({ limit: 500 })
    ]);
    return { recommendations, events };
  } catch (error) {
    logger.warn("recommendation history unavailable", {
      error: error instanceof Error ? error.message : String(error)
    });
    return { recommendations: [], events: [] };
  }
}

export function filterPreviouslyRecommendedEvents(
  events: EventCandidate[],
  history: RecommendationHistory
): { eligible: EventCandidate[]; skipped: EventCandidate[] } {
  if (history.recommendations.length === 0 || history.events.length === 0) {
    return { eligible: events, skipped: [] };
  }

  const recommendedIds = new Set(history.recommendations.map((recommendation) => recommendation.eventId));
  const recommendedEvents = history.events.filter((event) => recommendedIds.has(event.id));
  if (recommendedEvents.length === 0) return { eligible: events, skipped: [] };

  const eligible: EventCandidate[] = [];
  const skipped: EventCandidate[] = [];
  for (const event of events) {
    if (recommendedIds.has(event.id) || recommendedEvents.some((historical) => sameRecommendedEvent(event, historical))) {
      skipped.push(event);
      continue;
    }
    eligible.push(event);
  }
  return { eligible, skipped };
}

function sameRecommendedEvent(event: EventCandidate, historical: EventCandidate): boolean {
  const current = toDedupeComparable(event);
  const previous = toDedupeComparable(historical);
  if (current.canonicalUrl && previous.canonicalUrl && canonicalizeUrl(current.canonicalUrl) === canonicalizeUrl(previous.canonicalUrl)) {
    return true;
  }
  return areLikelyDuplicateEvents(current, previous);
}

function toDedupeComparable(event: EventCandidate): DedupeComparableEvent {
  return {
    title: event.title,
    startAt: event.startAt,
    timezone: event.timezone,
    city: event.city,
    hosts: event.hosts,
    organizers: event.organizers,
    canonicalUrl: event.canonicalUrl,
    sourceUrls: event.sourceUrls
  };
}

function buildEventSourceLinks(events: EventCandidate[], candidates: CandidateUrl[]): EventSourceLink[] {
  const links = new Map<string, EventSourceLink>();
  for (const event of events) {
    const eventUrls = new Set([event.canonicalUrl, ...event.sourceUrls].filter(Boolean).map(canonicalizeUrl));
    for (const candidate of candidates) {
      const candidateUrls = [candidate.id === event.id ? candidate.canonicalUrl : undefined, candidate.canonicalUrl, candidate.url]
        .filter((value): value is string => Boolean(value))
        .map(canonicalizeUrl);
      if (!candidateUrls.some((url) => eventUrls.has(url))) continue;
      const key = `${event.id}:${candidate.id}`;
      links.set(key, {
        eventId: event.id,
        candidateUrlId: candidate.id,
        sourcePlatform: candidate.sourcePlatform
      });
    }
  }
  return [...links.values()];
}

export function rankCandidatesForExtraction(
  candidates: RawCandidate[],
  profile: ScoutProfile,
  history?: RecommendationHistory
): RawCandidate[] {
  const uniqueCandidates = dedupeCandidatesForExtraction(candidates);
  const priority = (candidate: RawCandidate): number => candidateExtractionPriorityScore(candidate, profile);
  const groups = new Map<string, RawCandidate[]>();
  for (const candidate of [...uniqueCandidates].sort((left, right) => priority(right) - priority(left))) {
    const key = candidateDiversityKey(candidate);
    groups.set(key, [...(groups.get(key) ?? []), candidate]);
  }

  const rankedGroups = [...groups.values()].sort((left, right) => priority(right[0]!) - priority(left[0]!));
  const ranked: RawCandidate[] = [];
  while (rankedGroups.some((group) => group.length > 0)) {
    for (const group of rankedGroups) {
      const candidate = group.shift();
      if (candidate) ranked.push(candidate);
    }
  }
  return history ? prioritizeFreshCandidates(ranked, history) : ranked;
}

/** Keeps the ranking, but moves candidates that match an earlier recommendation to the end. */
function prioritizeFreshCandidates(candidates: RawCandidate[], history: RecommendationHistory): RawCandidate[] {
  const recommendedEvents = previouslyRecommendedEvents(history);
  if (recommendedEvents.length === 0) return candidates;
  const fresh: RawCandidate[] = [];
  const seenBefore: RawCandidate[] = [];
  for (const candidate of candidates) {
    (candidateMatchesRecommendedEvent(candidate, recommendedEvents) ? seenBefore : fresh).push(candidate);
  }
  return [...fresh, ...seenBefore];
}

function countPreviouslyRecommendedCandidates(candidates: RawCandidate[], history: RecommendationHistory): number {
  const recommendedEvents = previouslyRecommendedEvents(history);
  if (recommendedEvents.length === 0) return 0;
  return candidates.filter((candidate) => candidateMatchesRecommendedEvent(candidate, recommendedEvents)).length;
}

function previouslyRecommendedEvents(history: RecommendationHistory): EventCandidate[] {
  if (history.recommendations.length === 0) return [];
  const recommendedIds = new Set(history.recommendations.map((recommendation) => recommendation.eventId));
  return history.events.filter((event) => recommendedIds.has(event.id));
}

/** Same page URL, or (for specific enough titles) the same title in the candidate's title or snippet. */
function candidateMatchesRecommendedEvent(candidate: RawCandidate, recommendedEvents: EventCandidate[]): boolean {
  const candidateUrls = [candidate.canonicalUrl, candidate.url, candidate.sourceUrl]
    .filter((value): value is string => Boolean(value))
    .map(canonicalizeUrl);
  const candidateTitle = normalizeForHistoryMatch(candidate.title);
  const candidateSnippet = normalizeForHistoryMatch(candidate.snippet);
  const titleCanMatch = candidateTitle.length >= 12 && !isGenericCandidateTitle(candidate.title);

  return recommendedEvents.some((event) => {
    const eventUrls = [event.canonicalUrl, ...event.sourceUrls]
      .filter((value): value is string => Boolean(value))
      .map(canonicalizeUrl);
    if (candidateUrls.some((url) => eventUrls.includes(url))) return true;
    const eventTitle = normalizeForHistoryMatch(event.title);
    if (eventTitle.length < 12) return false;
    if (titleCanMatch && candidateTitle === eventTitle) return true;
    return candidateSnippet.includes(eventTitle);
  });
}

function normalizeForHistoryMatch(value: string | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/&amp;/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** Placeholder titles that public-source discovery gives links it could not name. */
function isGenericCandidateTitle(title: string | undefined): boolean {
  return /^(public source link from|public source retained|public source fetch failed|luma public surface)/i.test(title ?? "");
}

function dedupeCandidatesForExtraction(candidates: RawCandidate[]): RawCandidate[] {
  const byUrl = new Map<string, RawCandidate>();
  for (const candidate of candidates) {
    const key = candidateExtractionDedupeKey(candidate);
    const current = byUrl.get(key);
    if (!current || candidateSourceScore(candidate) > candidateSourceScore(current)) {
      byUrl.set(key, candidate);
    }
  }
  return [...byUrl.values()];
}

function summarizeCandidateQuality(candidates: RawCandidate[], profile: ScoutProfile): Record<string, unknown> {
  if (candidates.length === 0) return { count: 0 };
  const scores = candidates.map(candidateSourceScore);
  return {
    count: candidates.length,
    topScore: Math.max(...scores),
    medianScore: scores.slice().sort((left, right) => left - right)[Math.floor(scores.length / 2)],
    bottomScore: Math.min(...scores),
    intentMix: countBy(candidates, (candidate) => candidateIntent(candidate, profile)),
    topPlatforms: candidates.slice(0, 5).map((candidate) => candidate.sourcePlatform)
  };
}

function buildPipelineQualitySummary(input: {
  profile: ScoutProfile;
  queryPack: QuerySpec[];
  staticQueryPack: QuerySpec[];
  plannerHistory: SearchPlannerHistory;
  searchPlan: Awaited<ReturnType<typeof buildAgenticSearchPlan>>;
  rawCandidates: RawCandidate[];
  candidateUrls: CandidateUrl[];
  extractableCandidatesBeforeDedupe: RawCandidate[];
  extractableCandidates: RawCandidate[];
  duplicateCandidatesSkipped: number;
  events: EventCandidate[];
  scores: EventScore[];
  recommendations: Recommendation[];
  eventSourceLinks: EventSourceLink[];
}): Record<string, unknown> {
  const queryGroupByText = new Map(input.queryPack.map((query) => [query.text, query.group]));
  const rawCandidatesByQueryGroup = countBy(input.rawCandidates, (candidate) => {
    const group = candidate.sourceQuery ? queryGroupByText.get(candidate.sourceQuery) : undefined;
    return group ?? candidate.sourcePlatform ?? "unknown";
  });
  const agentCandidateCount = rawCandidatesByQueryGroup.agent_exploration ?? 0;
  const uniqueCanonicalUrls = new Set(input.candidateUrls.map((candidate) => candidate.canonicalUrl)).size;
  const rejectedCandidates = input.candidateUrls.filter((candidate) => candidate.status === "rejected");
  const scores = input.scores.map((score) => score.totalScore ?? score.score ?? 0);
  const recommendedScores = input.recommendations.map((recommendation) => recommendation.score);
  const topRecommendationEvents = input.recommendations.slice(0, 5).map((recommendation) => {
    const event = input.events.find((candidateEvent) => candidateEvent.id === recommendation.eventId);
    return {
      eventId: recommendation.eventId,
      score: recommendation.score,
      title: event?.title,
      city: event?.city,
      eventType: event?.eventType,
      registrationStatus: event?.registrationStatus
    };
  });

  const qualityFlags = buildQualityFlags({
    candidateCount: input.candidateUrls.length,
    rejectionRate: ratio(rejectedCandidates.length, input.candidateUrls.length),
    uniqueUrlRate: ratio(uniqueCanonicalUrls, input.candidateUrls.length),
    duplicateExtractionRate: ratio(input.duplicateCandidatesSkipped, input.extractableCandidatesBeforeDedupe.length),
    extractionYield: ratio(input.events.length, input.extractableCandidates.length),
    recommendationRate: ratio(input.recommendations.length, Math.max(1, input.events.length)),
    agentExaPercent: summarizeQueryMix(input.queryPack).agentExaPercent as number,
    agentCandidateCount
  });

  return {
    inputCoverage: {
      staticQueryMix: summarizeQueryMix(input.staticQueryPack),
      plannedQueryMix: summarizeQueryMix(input.queryPack),
      planner: input.searchPlan.planner,
      searchPlanId: input.searchPlan.id,
      generatedAgentQueries: input.searchPlan.items.length,
      avoidFingerprintCount: input.searchPlan.avoidFingerprints.length,
      noveltyAxes: countBy(input.searchPlan.items, (item) => item.noveltyAxis),
      plannerHistory: summarizeSearchPlannerHistory(input.plannerHistory)
    },
    sourceAndCandidateQuality: {
      candidatesFound: input.candidateUrls.length,
      uniqueCanonicalUrls,
      uniqueUrlRate: percent(ratio(uniqueCanonicalUrls, input.candidateUrls.length)),
      byPlatform: countBy(input.candidateUrls, (candidate) => candidate.sourcePlatform),
      byStatus: countBy(input.candidateUrls, (candidate) => candidate.status),
      byQueryGroup: rawCandidatesByQueryGroup,
      agentCandidateCount,
      rejectionRate: percent(ratio(rejectedCandidates.length, input.candidateUrls.length)),
      topRejectionReasons: topCounts(rejectedCandidates.map((candidate) => candidate.rejectionReason ?? "unknown"), 8),
      uniqueSourceQueries: new Set(input.rawCandidates.map((candidate) => candidate.sourceQuery).filter(Boolean)).size
    },
    extractionFunnel: {
      extractableBeforeDedupe: input.extractableCandidatesBeforeDedupe.length,
      extractableAfterDedupe: input.extractableCandidates.length,
      duplicateCandidatesSkipped: input.duplicateCandidatesSkipped,
      duplicateExtractionRate: percent(ratio(input.duplicateCandidatesSkipped, input.extractableCandidatesBeforeDedupe.length)),
      eventsExtracted: input.events.length,
      extractionYield: percent(ratio(input.events.length, input.extractableCandidates.length)),
      eventSourceLinks: input.eventSourceLinks.length,
      candidateQuality: summarizeCandidateQuality(input.extractableCandidates, input.profile)
    },
    outputQuality: {
      recommendations: input.recommendations.length,
      recommendationRate: percent(ratio(input.recommendations.length, Math.max(1, input.events.length))),
      scoreDistribution: summarizeNumbers(scores),
      recommendedScoreDistribution: summarizeNumbers(recommendedScores),
      eventTypes: countBy(input.events, (event) => event.eventType ?? "unknown"),
      cities: countBy(input.events, (event) => event.city ?? "unknown"),
      registrationStatuses: countBy(input.events, (event) => event.registrationStatus ?? event.status ?? "unknown"),
      topRecommendations: topRecommendationEvents
    },
    qualityFlags
  };
}

function buildQualityFlags(input: {
  candidateCount: number;
  rejectionRate: number;
  uniqueUrlRate: number;
  duplicateExtractionRate: number;
  extractionYield: number;
  recommendationRate: number;
  agentExaPercent: number;
  agentCandidateCount: number;
}): string[] {
  return [
    input.candidateCount < 20 ? "low_candidate_volume" : undefined,
    input.rejectionRate > 0.5 ? "high_candidate_rejection_rate" : undefined,
    input.uniqueUrlRate < 0.55 ? "high_duplicate_url_rate" : undefined,
    input.duplicateExtractionRate > 0.5 ? "high_pre_extraction_duplicate_rate" : undefined,
    input.extractionYield < 0.35 ? "low_extraction_yield" : undefined,
    input.recommendationRate < 0.1 ? "low_recommendation_yield" : undefined,
    input.agentExaPercent < 40 ? "agent_exploration_under_target" : undefined,
    input.agentCandidateCount === 0 && input.agentExaPercent > 0 ? "agent_queries_returned_no_candidates" : undefined
  ].filter((flag): flag is string => Boolean(flag));
}

function countBy<T>(items: T[], getKey: (item: T) => string): Record<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = getKey(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Object.fromEntries([...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])));
}

function topCounts(items: string[], limit: number): Array<{ key: string; count: number }> {
  return Object.entries(countBy(items, (item) => item))
    .slice(0, limit)
    .map(([key, count]) => ({ key, count }));
}

function summarizeNumbers(values: number[]): Record<string, unknown> {
  if (values.length === 0) return { count: 0 };
  const sorted = [...values].sort((left, right) => left - right);
  return {
    count: values.length,
    min: sorted[0],
    p50: sorted[Math.floor(sorted.length / 2)],
    max: sorted[sorted.length - 1],
    avg: Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10
  };
}

function ratio(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function candidateSourceScore(candidate: RawCandidate): number {
  const value = (candidate as RawCandidate & { sourceScore?: unknown }).sourceScore;
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function candidateExtractionPriorityScore(candidate: RawCandidate, profile: ScoutProfile): number {
  const intent = candidateIntent(candidate, profile);
  const intentBoost = intent === "concrete_event"
    ? 40
    : intent === "listing_source"
      ? -20
      : intent === "organizer_source"
        ? -30
        : -45;
  return candidateSourceScore(candidate) + intentBoost + platformExtractionBoost(candidate);
}

function candidateIntent(candidate: RawCandidate, profile: ScoutProfile): ReturnType<typeof classifyCandidateIntent> {
  return classifyCandidateIntent({
    canonicalUrl: candidate.canonicalUrl ?? candidate.url ?? candidate.sourceUrl,
    title: candidate.title,
    snippet: candidate.snippet
  }, profile);
}

function platformExtractionBoost(candidate: RawCandidate): number {
  const url = candidate.canonicalUrl ?? candidate.url ?? candidate.sourceUrl;
  if (/^https:\/\/(?:www\.)?lu\.ma\/[^/?#]+/i.test(url)) return 18;
  if (/meetup\.com\/[^/]+\/events\/\d+/i.test(url)) return 14;
  if (/eventbrite\.com\/e\/[^/]+tickets-\d+/i.test(url)) return 12;
  return 0;
}

function candidateDiversityKey(candidate: RawCandidate): string {
  const source = candidate.sourceQuery ?? candidate.sourceId ?? hostForCandidate(candidate);
  return `${candidate.sourcePlatform}:${source}`;
}

function candidateExtractionDedupeKey(candidate: RawCandidate): string {
  return canonicalizeUrl(candidate.canonicalUrl ?? candidate.url ?? candidate.sourceUrl);
}

function hostForCandidate(candidate: RawCandidate): string {
  try {
    return new URL(candidate.canonicalUrl ?? candidate.url ?? candidate.sourceUrl).hostname;
  } catch {
    return candidate.sourceUrl;
  }
}

async function countXPostsUsedToday(store: { listRuns(limit?: number): Promise<Array<{ startedAt: string; stats: Partial<RunStats> }>> }, now: Date): Promise<number> {
  const today = localDateKey(now);
  const runs = await store.listRuns(200);
  return runs
    .filter((run) => localDateKey(new Date(run.startedAt)) === today)
    .reduce((sum, run) => sum + (run.stats.xPostsRead ?? 0), 0);
}

function localDateKey(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

if (isMainModule(import.meta.url)) {
  await runScout();
}

function createTriggerAwareLogger(scope: string): Logger {
  const appLogger = createLogger(scope);

  function write(level: "debug" | "info" | "warn" | "error", message: string, fields?: Record<string, unknown>): void {
    const inTriggerRun = isTriggerRunContext();
    if (!inTriggerRun) appLogger[level](message, fields);
    try {
      const triggerFields = { scope, ...(fields ?? {}) };
      if (level === "debug") {
        triggerLogger.debug(message, triggerFields);
      } else if (level === "info") {
        triggerLogger.info(message, triggerFields);
      } else if (level === "warn") {
        triggerLogger.warn(message, triggerFields);
      } else {
        triggerLogger.error(message, triggerFields);
      }
    } catch {
      if (inTriggerRun) appLogger[level](message, fields);
    }
  }

  return {
    debug: (message, fields) => write("debug", message, fields),
    info: (message, fields) => write("info", message, fields),
    warn: (message, fields) => write("warn", message, fields),
    error: (message, fields) => write("error", message, fields)
  };
}

function isTriggerRunContext(): boolean {
  try {
    return triggerMetadata.current() !== undefined;
  } catch {
    return false;
  }
}

function setScoutMetadata(fields: Record<string, unknown>): void {
  try {
    for (const [key, value] of Object.entries(fields)) {
      const metadataValue = toMetadataValue(value);
      if (metadataValue !== undefined) triggerMetadata.set(key, metadataValue);
    }
  } catch {
    // Metadata is only available inside a Trigger run.
  }
}

function toMetadataValue(value: unknown): RunMetadata[string] | undefined {
  if (value === undefined) return undefined;
  const serialized = JSON.stringify(value);
  if (serialized === undefined) return undefined;
  return JSON.parse(serialized) as RunMetadata[string];
}

async function flushScoutMetadata(): Promise<void> {
  try {
    await triggerMetadata.flush();
  } catch {
    // Metadata flush is only available inside a Trigger run.
  }
}
