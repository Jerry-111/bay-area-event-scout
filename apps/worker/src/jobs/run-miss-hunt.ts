import { createEventStore } from "@event-scout/db";
import { buildMissHuntQueryPack, discoverCandidatesWithStats } from "@event-scout/discovery";
import { classifyWeeklyMissHunt } from "@event-scout/intelligence";
import {
  type AppEnv,
  type RunStats,
  createLogger,
  createRunStats,
  getLogFormat,
  isMainModule,
  loadRuntimeEnv
} from "@event-scout/shared";

const logger = createLogger("worker:miss-hunt");

export async function runMissHunt(env: AppEnv = loadRuntimeEnv()): Promise<RunStats> {
  const store = createEventStore(env);
  const run = await store.createRun("miss_hunt");

  logger.info("miss hunt started", { runId: run.id, mockMode: env.mockMode, profile: env.profile.name });

  try {
    const now = new Date();
    const queryPack = buildMissHuntQueryPack(now, env.profile);
    const discovery = await discoverCandidatesWithStats(run.id, queryPack, env, {
      now,
      runContext: {
        scanMode: "light",
        scanTime: "miss_hunt",
        xEnabled: false,
        xBudgetRemaining: 0
      }
    });
    await store.saveCandidateUrls(run.id, discovery.candidates);

    const knownEvents = await store.listEvents({ limit: 500 });
    const classifications = await classifyWeeklyMissHunt(
      discovery.candidates.map((candidate) => ({
        title: candidate.title,
        url: candidate.url,
        evidenceText: [
          candidate.title,
          candidate.snippet,
          candidate.sourceQuery,
          candidate.url
        ].filter(Boolean).join("\n"),
        knownEventTitles: knownEvents.map((event) => event.title),
        env
      }))
    );
    const week = missHuntWeek(now);

    await store.saveMissHuntResult?.({
      runId: run.id,
      weekStart: week.start,
      weekEnd: week.end,
      status: "completed",
      summary: {
        checked: classifications.checked,
        missed: classifications.missed.length,
        ignored: classifications.ignored.length,
        queries: queryPack.length
      },
      missedEvents: classifications.missed.map((miss) => ({
        title: miss.eventTitle,
        url: miss.eventUrl,
        happenedAt: miss.happenedAt,
        missReason: miss.missReason,
        evidence: [miss.rationale],
        suggestion: miss.suggestedQuery ?? miss.suggestedSource
      }))
    });

    const stats = createRunStats({
      mockMode: env.mockMode,
      candidatesFound: discovery.candidates.length,
      eventsExtracted: classifications.checked,
      scoresCreated: classifications.checked,
      recommendationsCreated: classifications.missed.length,
      rejectedCandidates: classifications.ignored.length,
      scanMode: "light",
      xEnabled: false,
      xPostsRead: discovery.stats.xPostsRead,
      xBudgetRemaining: discovery.stats.xBudgetRemaining
    });
    await store.finishRun(run.id, stats);
    logger.info("miss hunt finished", {
      runId: run.id,
      checked: classifications.checked,
      missed: classifications.missed.length,
      ignored: classifications.ignored.length
    });
    return stats;
  } catch (error) {
    await store.failRun(run.id, error);
    logger.error("miss hunt failed", { runId: run.id, error: error instanceof Error ? error.message : String(error) });
    throw error;
  } finally {
    await store.close?.();
  }
}

function missHuntWeek(now: Date): { start: string; end: string } {
  const end = new Date(now);
  end.setUTCHours(0, 0, 0, 0);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 7);
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10)
  };
}

if (isMainModule(import.meta.url)) {
  const stats = await runMissHunt();
  // Same reasoning as the scout job: don't bury the pretty log lines above under a raw JSON dump.
  if (getLogFormat() !== "pretty") {
    console.log(JSON.stringify(stats, null, 2));
  }
}
