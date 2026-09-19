import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool, type PoolConfig } from "pg";
import type {
  AppEnv,
  CandidateUrl,
  EventCandidate,
  EventScore,
  FeedbackType,
  Recommendation,
  RunStats,
  RunType,
  ScoutRun
} from "@event-scout/shared";
import { createId, createRunStats, isInsideTriggerDotDevRun } from "@event-scout/shared";
import {
  buildDashboard,
  buildFeedbackSummary,
  buildMemoryOrganizerPerformance,
  buildMemorySourcePerformance,
  buildRecommendationRows,
  buildReviewCandidates,
  buildSuppressedEvents,
  buildTasteSignals,
  buildTasteSignalsFromSummaries,
  scoringModelLabel
} from "./dashboard-builders.js";
import {
  applyLoadedState,
  applyRetentionCap,
  DEFAULT_RETENTION_RUNS,
  parseStateFile,
  readStateFile,
  readStateFileSync,
  resolveScoutDataDir,
  SCOUT_STORE_FILE_NAME,
  withFileLock,
  writeStateFileAtomic
} from "./file-store.js";
import { createMemoryState, eventRunId, findRun, seedMockData, upsertMany, type MemoryState } from "./memory-state.js";
import type {
  AdminDashboard,
  DashboardFeedbackSummary,
  DashboardMissedEvent,
  DashboardOrganizerPerformance,
  DashboardRecommendation,
  DashboardReviewCandidate,
  DashboardSourcePerformance,
  DashboardSuppressedEvent,
  EventSourceLink,
  EventStore,
  SaveMissHuntResultInput
} from "./types.js";

export * from "./types.js";
export { DEFAULT_RETENTION_RUNS, resolveScoutDataDir, SCOUT_DATA_DIR_NAME, SCOUT_STORE_FILE_NAME } from "./file-store.js";

export const migrationFiles = ["001_initial_schema.sql"];

export function createEventStore(env: AppEnv): EventStore {
  // Mock mode always gets its own disposable, seeded in-memory store, no
  // matter what DATABASE_URL happens to be set to.
  if (env.mockMode) return new MockEventStore(env);
  // Real mode without a database still needs somewhere to put results:
  // a local JSON file, so `pnpm scout:real` followed by `pnpm admin` shows
  // real results without any infrastructure. It is never seeded.
  if (!env.databaseUrl) {
    if (isInsideTriggerDotDevRun()) {
      console.warn(
        "[db] DATABASE_URL is not set, so results go to a local file that Trigger.dev discards after the run. " +
          "Set DATABASE_URL in the Trigger.dev environment to keep history and avoid repeat recommendations."
      );
    }
    return new FileEventStore(env);
  }
  return new PgEventStore(env);
}

/** Opens a connection and runs `select 1`; used by `pnpm scout:doctor --live`. */
export async function pingDatabase(env: AppEnv): Promise<void> {
  const pool = new Pool(pgPoolConfig(env));
  try {
    await pool.query("select 1");
  } finally {
    await pool.end().catch(() => undefined);
  }
}

export async function runMigrations(env: AppEnv): Promise<void> {
  if (env.mockMode || !env.databaseUrl) {
    const reason = env.mockMode ? "mock mode" : "no DATABASE_URL configured";
    console.log(`[db:migrate] ${reason}: validated migration files without opening a database`);
    for (const file of migrationFiles) {
      readFileSync(migrationPath(file), "utf8");
    }
    return;
  }

  for (const file of migrationFiles) {
    const pool = new Pool(pgPoolConfig(env));
    try {
      await pool.query(readFileSync(migrationPath(file), "utf8"));
    } finally {
      await pool.end();
    }
    console.log(`[db:migrate] applied ${file}`);
  }
}

/**
 * Implements `EventStore` entirely against an in-memory `MemoryState`.
 * `reload()` and `persist()` are no-ops here, so every read/write and the
 * dashboard computation live exactly once, shared by both backends that
 * extend this class: `MockEventStore` (pure in-memory, seeded, disposable)
 * and `FileEventStore` (same logic, backed by a JSON file on disk).
 */
class MemoryEventStore implements EventStore {
  constructor(protected readonly env: AppEnv, protected readonly state: MemoryState) {}

  /** No-op here; `FileEventStore` reloads from disk if the file changed. */
  protected async reload(): Promise<void> {}

  /**
   * Every write goes through here: reload the latest state, apply the change, save.
   * `FileEventStore` wraps this in a cross-process lock so the worker and the admin
   * never overwrite each other's changes.
   */
  protected async mutate<T>(change: () => T): Promise<T> {
    await this.reload();
    return change();
  }

  async createRun(runType: RunType): Promise<ScoutRun> {
    return this.mutate(() => {
      const run: ScoutRun = {
        id: createId("run"),
        runType,
        startedAt: new Date().toISOString(),
        status: "running",
        stats: createRunStats({ mockMode: this.env.mockMode })
      };
      this.state.runs.unshift(run);
      return run;
    });
  }

  async finishRun(runId: string, stats: RunStats): Promise<void> {
    await this.mutate(() => {
      const run = findRun(this.state, runId);
      run.status = "succeeded";
      run.finishedAt = new Date().toISOString();
      run.stats = stats;
    });
  }

  async failRun(runId: string, error: unknown, stats: Partial<RunStats> = {}): Promise<void> {
    await this.mutate(() => {
      const run = findRun(this.state, runId);
      run.status = "failed";
      run.finishedAt = new Date().toISOString();
      run.error = errorToString(error);
      run.stats = createRunStats({ ...run.stats, ...stats });
    });
  }

  async saveCandidateUrls(_runId: string, candidates: CandidateUrl[]): Promise<void> {
    await this.mutate(() => upsertMany(this.state.candidates, candidates));
  }

  async saveCandidates(candidates: CandidateUrl[]): Promise<void> {
    await this.mutate(() => upsertMany(this.state.candidates, candidates));
  }

  async saveEvents(events: EventCandidate[]): Promise<void> {
    await this.mutate(() => upsertMany(this.state.events, events));
  }

  async saveEventSources(links: EventSourceLink[]): Promise<void> {
    await this.mutate(() => {
      for (const link of links) {
        const index = this.state.eventSources.findIndex(
          (row) => row.eventId === link.eventId && row.candidateUrlId === link.candidateUrlId
        );
        if (index === -1) {
          this.state.eventSources.unshift(link);
        } else {
          this.state.eventSources[index] = link;
        }
      }
    });
  }

  async saveEventScores(_runId: string, scores: EventScore[]): Promise<void> {
    await this.mutate(() => {
      for (const score of scores) {
        this.state.scores.push(score);
      }
    });
  }

  async saveRecommendations(_runId: string, recommendations: Recommendation[]): Promise<void> {
    await this.mutate(() => upsertMany(this.state.recommendations, recommendations));
  }

  async saveMissHuntResult(input: SaveMissHuntResultInput): Promise<void> {
    await this.mutate(() => {
      const createdAt = new Date().toISOString();
      for (const event of input.missedEvents) {
        this.state.missedEvents.unshift({
          id: createId("missed"),
          title: event.title,
          url: event.url,
          happenedAt: event.happenedAt,
          missReason: event.missReason,
          suggestion: event.suggestion,
          createdAt
        });
      }
    });
  }

  async listRuns(limit = 25): Promise<ScoutRun[]> {
    await this.reload();
    return this.state.runs.slice(0, limit);
  }

  async listCandidateUrls(options: { runId?: string; status?: string; limit?: number } = {}): Promise<CandidateUrl[]> {
    await this.reload();
    return this.state.candidates
      .filter((candidate) => !options.runId || candidate.runId === options.runId)
      .filter((candidate) => !options.status || candidate.status === options.status)
      .slice(0, options.limit ?? 100);
  }

  async listEvents(options: { runId?: string; limit?: number } = {}): Promise<EventCandidate[]> {
    await this.reload();
    return this.state.events
      .filter((event) => !options.runId || event.runId === options.runId)
      .slice(0, options.limit ?? 100);
  }

  async listEventScores(options: { runId?: string; limit?: number } = {}): Promise<EventScore[]> {
    await this.reload();
    return this.state.scores
      .filter((score) => !options.runId || score.eventId === undefined || eventRunId(this.state, score.eventId) === options.runId)
      .slice(0, options.limit ?? 100);
  }

  async listRecommendations(options: { runId?: string; limit?: number } = {}): Promise<Recommendation[]> {
    await this.reload();
    return this.state.recommendations
      .filter((recommendation) => !options.runId || recommendation.runId === options.runId)
      .slice(0, options.limit ?? 25);
  }

  async createFeedback(input: { eventId: string; feedbackType: FeedbackType; note?: string }): Promise<void> {
    await this.mutate(() => {
      this.state.feedback.push({
        id: createId("feedback"),
        eventId: input.eventId,
        feedbackType: input.feedbackType,
        note: input.note,
        createdAt: new Date().toISOString()
      });
    });
  }

  async getDashboard(): Promise<AdminDashboard> {
    await this.reload();
    const runs = await this.listRuns(20);
    const latestRunId = runs[0]?.id;
    const topRecommendations = await this.listRecommendations({ limit: 25 });
    const latestRecommendations = latestRunId
      ? await this.listRecommendations({ runId: latestRunId, limit: 25 })
      : [];
    const events = await this.listEvents({ limit: 50 });
    const scores = await this.listEventScores({ limit: 50 });
    const reviewCandidates = buildReviewCandidates(events, scores, this.env.profile.thresholds);
    const dashboardRecommendations = latestRecommendations;
    const sourcePerformance = buildMemorySourcePerformance(this.state.candidates, events, topRecommendations);
    const organizerPerformance = buildMemoryOrganizerPerformance(events, scores, topRecommendations);
    return buildDashboard({
      env: this.env,
      runs,
      candidates: this.state.candidates,
      topRecommendations,
      dashboardRecommendations,
      recommendationHistory: buildRecommendationRows(topRecommendations, events, scores),
      suppressedEvents: buildSuppressedEvents(events, scores, dashboardRecommendations, topRecommendations, this.env.profile.thresholds),
      rejectedCandidates: await this.listCandidateUrls({ status: "rejected", limit: 25 }),
      events,
      scores,
      reviewCandidates,
      sourcePerformance,
      organizerPerformance,
      feedbackSummary: buildFeedbackSummary(this.state.feedback),
      tasteSignals: buildTasteSignals(this.state.feedback, events),
      missedEvents: this.state.missedEvents.slice(0, 10),
      dataGaps: this.state.missedEvents.length ? [] : ["Miss hunt has not produced missed-event rows yet."]
    });
  }

  async close(): Promise<void> {}
}

/** Pure in-memory, seeded with canned sample data, and disposed with the process. Never touches disk or a database. */
class MockEventStore extends MemoryEventStore {
  constructor(env: AppEnv) {
    super(env, createMemoryState());
    // Guaranteed by createEventStore() only ever constructing this class in
    // mock mode, but kept here too so the invariant holds even if that call
    // site changes later: this class never runs unseeded, and nothing else
    // ever seeds fixture data.
    if (env.mockMode) seedMockData(this.state, env);
  }
}

export interface FileEventStoreOptions {
  /** Overrides the resolved data directory; tests should always set this to a temp directory. */
  dataDir?: string;
  /** Overrides the store's file name within the data directory. Defaults to "store.json". */
  fileName?: string;
  /** How many of the newest runs (and their candidates/events/scores/recommendations) to keep. */
  retentionRuns?: number;
}

/**
 * Same read/write/dashboard logic as `MockEventStore`, but backed by a JSON
 * file so results survive the process and a second process (the admin) can
 * see them. Reloads the file before every read in case another process wrote
 * to it, and atomically rewrites it (temp file + rename) after every write.
 * Never seeds mock data.
 */
export class FileEventStore extends MemoryEventStore {
  private readonly filePath: string;
  private readonly retentionRuns: number;
  private lastSynced: { mtimeMs: number; size: number } | undefined;
  private mutationChain: Promise<unknown> = Promise.resolve();

  constructor(env: AppEnv, options: FileEventStoreOptions = {}) {
    super(env, createMemoryState());
    const dataDir = options.dataDir ?? resolveScoutDataDir(env.scoutDataDir);
    this.filePath = join(dataDir, options.fileName ?? SCOUT_STORE_FILE_NAME);
    this.retentionRuns = options.retentionRuns ?? DEFAULT_RETENTION_RUNS;
    this.loadInitialSync();
  }

  /** Path this store reads from and writes to, for callers that want to tell the user where their data lives. */
  get dataFilePath(): string {
    return this.filePath;
  }

  private loadInitialSync(): void {
    const loaded = readStateFileSync(this.filePath);
    if (!loaded) return;
    applyLoadedState(this.state, parseStateFile(loaded.raw, this.filePath));
    this.lastSynced = { mtimeMs: loaded.mtimeMs, size: loaded.raw.length };
  }

  protected override async reload(): Promise<void> {
    const loaded = await readStateFile(this.filePath);
    if (!loaded) return;
    if (this.lastSynced && loaded.mtimeMs === this.lastSynced.mtimeMs && loaded.raw.length === this.lastSynced.size) return;
    applyLoadedState(this.state, parseStateFile(loaded.raw, this.filePath));
    this.lastSynced = { mtimeMs: loaded.mtimeMs, size: loaded.raw.length };
  }

  /**
   * Serializes writes inside this process, then takes a lock file so a scan and the admin
   * (separate processes) never interleave reload -> change -> save. A failed save throws, like
   * the Postgres store, and does not affect later writes.
   */
  protected override async mutate<T>(change: () => T): Promise<T> {
    const run = (): Promise<T> =>
      withFileLock(`${this.filePath}.lock`, async () => {
        await this.reload();
        const result = change();
        applyRetentionCap(this.state, this.retentionRuns);
        const written = await writeStateFileAtomic(this.filePath, this.state);
        this.lastSynced = written;
        return result;
      });
    const next = this.mutationChain.then(run, run);
    this.mutationChain = next.catch(() => undefined);
    return next;
  }

  override async close(): Promise<void> {
    await this.mutationChain;
  }
}

class PgEventStore implements EventStore {
  private readonly pool: Pool;
  private readonly env: AppEnv;

  constructor(env: AppEnv) {
    this.env = env;
    this.pool = new Pool(pgPoolConfig(env));
  }

  async createRun(runType: RunType): Promise<ScoutRun> {
    const run: ScoutRun = {
      id: createId("run"),
      runType,
      startedAt: new Date().toISOString(),
      status: "running",
      stats: createRunStats({ mockMode: false })
    };
    await this.query(
      "insert into runs (id, run_type, started_at, status, stats_json) values ($1, $2, $3, $4, $5::jsonb)",
      [run.id, run.runType, run.startedAt, run.status, jsonParam(run.stats)]
    );
    return run;
  }

  async finishRun(runId: string, stats: RunStats): Promise<void> {
    await this.query(
      "update runs set finished_at = now(), status = 'succeeded', stats_json = $2::jsonb where id = $1",
      [runId, jsonParam(stats)]
    );
  }

  async failRun(runId: string, error: unknown, stats: Partial<RunStats> = {}): Promise<void> {
    await this.query(
      "update runs set finished_at = now(), status = 'failed', error = $2, stats_json = stats_json || $3::jsonb where id = $1",
      [runId, errorToString(error), jsonParam(stats)]
    );
  }

  async saveCandidateUrls(runId: string, candidates: CandidateUrl[]): Promise<void> {
    for (const candidate of candidates) {
      await this.query(
        `insert into candidate_urls (id, run_id, url, canonical_url, source_platform, source_query, source_id, title, snippet, status, rejection_reason, discovered_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         on conflict (id) do update set status = excluded.status, rejection_reason = excluded.rejection_reason`,
        [
          candidate.id,
          runId,
          candidate.url,
          candidate.canonicalUrl,
          candidate.sourcePlatform,
          candidate.sourceQuery,
          candidate.sourceId,
          candidate.title,
          candidate.snippet,
          candidate.status,
          candidate.rejectionReason,
          candidate.discoveredAt
        ]
      );
    }
  }

  async saveCandidates(candidates: CandidateUrl[]): Promise<void> {
    for (const candidate of candidates) {
      await this.saveCandidateUrls(candidate.runId, [candidate]);
    }
  }

  async saveEvents(events: EventCandidate[]): Promise<void> {
    for (const event of events) {
      await this.query(
        `insert into events (id, dedupe_key, canonical_url, title, description, start_at, end_at, timezone, city, venue_text, location_precision, hosts_json, organizers_json, visibility_flags_json, registration_status, event_type, first_seen_at, last_seen_at, status)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13::jsonb, $14::jsonb, $15, $16, now(), now(), 'active')
         on conflict (id) do update set last_seen_at = now(), title = excluded.title, description = excluded.description`,
        [
          event.id,
          event.canonicalUrl,
          event.canonicalUrl,
          event.title,
          event.description,
          event.startAt,
          event.endAt,
          event.timezone,
          event.city,
          event.venueText,
          event.locationPrecision,
          jsonParam(event.hosts),
          jsonParam(event.organizers ?? []),
          jsonParam(event.visibilityFlags),
          event.registrationStatus ?? event.status,
          event.eventType
        ]
      );
    }
  }

  async saveEventSources(links: EventSourceLink[]): Promise<void> {
    for (const link of links) {
      await this.query(
        `insert into event_sources (id, event_id, candidate_url_id, source_platform, created_at)
         values ($1, $2, $3, $4, now())
         on conflict (event_id, candidate_url_id) do update set source_platform = excluded.source_platform`,
        [createId("event_src"), link.eventId, link.candidateUrlId, link.sourcePlatform]
      );
    }
  }

  async saveEventScores(runId: string, scores: EventScore[]): Promise<void> {
    for (const score of scores) {
      await this.query(
        `insert into event_scores (id, event_id, run_id, model, prompt_version, total_score, breakdown_json, penalties_json, should_recommend, rationale, next_action, created_at)
         values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10, $11, now())`,
        [
          createId("score"),
          score.eventId ?? "",
          runId,
          scoringModelLabel(this.env),
          `profile:${this.env.profile.name}`,
          score.totalScore ?? score.score ?? 0,
          jsonParam(score),
          jsonParam(score.penalties ?? score.risks ?? []),
          score.shouldRecommend ?? (score.totalScore ?? score.score ?? 0) >= this.env.profile.thresholds.recommend,
          score.rationale ?? score.reasons?.join("; "),
          score.nextAction ?? "monitor"
        ]
      );
    }
  }

  async saveRecommendations(runId: string, recommendations: Recommendation[]): Promise<void> {
    for (const recommendation of recommendations) {
      await this.query(
        `insert into recommendations (id, run_id, event_id, score, reason, created_at)
         values ($1, $2, $3, $4, $5, $6)
         on conflict (id) do nothing`,
        [recommendation.id, runId, recommendation.eventId, recommendation.score, recommendation.reason, recommendation.createdAt]
      );
    }
  }

  async saveMissHuntResult(input: SaveMissHuntResultInput): Promise<void> {
    const missHuntId = createId("miss_hunt");
    await this.query(
      `insert into miss_hunts (id, run_id, week_start, week_end, status, summary_json, created_at)
       values ($1, $2, $3, $4, $5, $6::jsonb, now())`,
      [missHuntId, input.runId, input.weekStart, input.weekEnd, input.status, jsonParam(input.summary)]
    );

    for (const event of input.missedEvents) {
      await this.query(
        `insert into missed_events (id, miss_hunt_id, title, url, happened_at, miss_reason, evidence_json, suggestion, created_at)
         values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, now())`,
        [
          createId("missed"),
          missHuntId,
          event.title,
          event.url,
          event.happenedAt,
          event.missReason,
          jsonParam(event.evidence),
          event.suggestion
        ]
      );
    }
  }

  async listRuns(limit = 25): Promise<ScoutRun[]> {
    return this.queryJson<ScoutRun>(
      `select coalesce(json_agg(json_build_object(
        'id', r.id,
        'runType', r.run_type,
        'startedAt', r.started_at,
        'finishedAt', r.finished_at,
        'status', r.status,
        'error', r.error,
        'stats', r.stats_json || jsonb_build_object(
          'candidatesFound', greatest(coalesce((r.stats_json->>'candidatesFound')::int, 0), coalesce(rc.candidate_count, 0)),
          'eventsExtracted', greatest(coalesce((r.stats_json->>'eventsExtracted')::int, 0), coalesce(rc.event_count, 0), coalesce(rc.score_count, 0)),
          'scoresCreated', greatest(coalesce((r.stats_json->>'scoresCreated')::int, 0), coalesce(rc.score_count, 0)),
          'recommendationsCreated', greatest(coalesce((r.stats_json->>'recommendationsCreated')::int, 0), coalesce(rc.recommendation_count, 0)),
          'rejectedCandidates', greatest(coalesce((r.stats_json->>'rejectedCandidates')::int, 0), coalesce(rc.rejected_count, 0))
        )
      ) order by r.started_at desc), '[]'::json) as data
      from (select * from runs order by started_at desc limit $1) r
      left join lateral (
        select
          (select count(*)::int from candidate_urls cu where cu.run_id = r.id) as candidate_count,
          (select count(*)::int from candidate_urls cu where cu.run_id = r.id and cu.status = 'rejected') as rejected_count,
          (select count(distinct es.event_id)::int from event_sources es join candidate_urls cu on cu.id = es.candidate_url_id where cu.run_id = r.id) as event_count,
          (select count(*)::int from event_scores s where s.run_id = r.id) as score_count,
          (select count(*)::int from recommendations rec where rec.run_id = r.id) as recommendation_count
      ) rc on true`,
      [limit]
    );
  }

  async listCandidateUrls(options: { runId?: string; status?: string; limit?: number } = {}): Promise<CandidateUrl[]> {
    const params: unknown[] = [];
    const where = [
      options.runId ? `run_id = $${params.push(options.runId)}` : undefined,
      options.status ? `status = $${params.push(options.status)}` : undefined
    ].filter(Boolean).join(" and ");
    const limitRef = `$${params.push(options.limit ?? 100)}`;
    return this.queryJson<CandidateUrl>(
      `select coalesce(json_agg(json_build_object('id', id, 'runId', run_id, 'url', url, 'canonicalUrl', canonical_url, 'sourcePlatform', source_platform, 'sourceQuery', source_query, 'sourceId', source_id, 'title', title, 'snippet', snippet, 'discoveredAt', discovered_at, 'status', status, 'rejectionReason', rejection_reason) order by discovered_at desc), '[]'::json) as data from (select * from candidate_urls ${where ? `where ${where}` : ""} order by discovered_at desc limit ${limitRef}) c`,
      params
    );
  }

  async listEvents(options: { runId?: string; limit?: number } = {}): Promise<EventCandidate[]> {
    void options.runId;
    return this.queryJson<EventCandidate>(
      `select coalesce(json_agg(json_build_object('id', id, 'canonicalUrl', canonical_url, 'sourceUrls', json_build_array(canonical_url), 'title', title, 'description', description, 'startAt', start_at, 'endAt', end_at, 'timezone', timezone, 'city', city, 'venueText', venue_text, 'locationPrecision', location_precision, 'hosts', hosts_json, 'organizers', organizers_json, 'visibilityFlags', visibility_flags_json, 'registrationStatus', registration_status, 'eventType', event_type) order by first_seen_at desc), '[]'::json) as data from (select * from events order by first_seen_at desc limit $1) e`,
      [options.limit ?? 100]
    );
  }

  async listEventScores(options: { runId?: string; limit?: number } = {}): Promise<EventScore[]> {
    const params: unknown[] = [];
    const where = options.runId ? `where run_id = $${params.push(options.runId)}` : "";
    const limitRef = `$${params.push(options.limit ?? 100)}`;
    return this.queryJson<EventScore>(
      `select coalesce(json_agg(breakdown_json order by created_at desc), '[]'::json) as data from (select * from event_scores ${where} order by created_at desc limit ${limitRef}) s`,
      params
    );
  }

  async listRecommendations(options: { runId?: string; limit?: number } = {}): Promise<Recommendation[]> {
    const params: unknown[] = [];
    const where = options.runId ? `where run_id = $${params.push(options.runId)}` : "";
    const limitRef = `$${params.push(options.limit ?? 25)}`;
    return this.queryJson<Recommendation>(
      `select coalesce(json_agg(json_build_object('id', id, 'runId', run_id, 'eventId', event_id, 'score', score, 'reason', reason, 'createdAt', created_at) order by score desc), '[]'::json) as data from (select * from recommendations ${where} order by score desc limit ${limitRef}) r`,
      params
    );
  }

  async createFeedback(input: { eventId: string; feedbackType: FeedbackType; note?: string }): Promise<void> {
    await this.query(
      "insert into feedback (id, event_id, feedback_type, note, created_at) values ($1, $2, $3, $4, now())",
      [createId("feedback"), input.eventId, input.feedbackType, input.note]
    );
  }

  async getDashboard(): Promise<AdminDashboard> {
    const runs = await this.listRuns(20);
    const latestRunId = runs[0]?.id;
    const dataGaps: string[] = [];
    const [
      topRecommendations,
      latestRecommendations,
      rejectedCandidates,
      latestCandidates,
      allCandidates,
      events,
      scores,
      reviewCandidates,
      sourcePerformance,
      organizerPerformance,
      feedbackSummary,
      missedEvents
    ] = await Promise.all([
      this.listRecommendations({ limit: 25 }),
      latestRunId ? this.listRecommendations({ runId: latestRunId, limit: 25 }) : Promise.resolve([]),
      this.listCandidateUrls({ status: "rejected", limit: 25 }),
      latestRunId ? this.listCandidateUrls({ runId: latestRunId, limit: 5000 }) : Promise.resolve([]),
      this.listCandidateUrls({ limit: 1000 }),
      this.listEvents({ limit: 50 }),
      this.listEventScores({ limit: 50 }),
      latestRunId ? this.listReviewCandidates(latestRunId, 25) : Promise.resolve([]),
      this.listSourcePerformance(12, dataGaps),
      this.listOrganizerPerformance(15, dataGaps),
      this.listFeedbackSummary(12, dataGaps),
      this.listMissedEvents(10, dataGaps)
    ]);
    const dashboardRecommendations = latestRecommendations;
    const recommendedEvents = await this.listEventsByIds(dashboardRecommendations.map((recommendation) => recommendation.eventId));
    const recommendedScores = await this.listLatestScoresByEventIds(dashboardRecommendations.map((recommendation) => recommendation.eventId));
    const [recommendationHistory, suppressedEvents] = await Promise.all([
      this.listRecommendationHistory(50),
      latestRunId ? this.listSuppressedEvents(latestRunId, 25) : Promise.resolve([])
    ]);
    if (sourcePerformance.every((row) => row.eventCount === 0 && row.recommendationCount === 0)) {
      dataGaps.push("Source/query performance can count candidates and noise, but event and recommendation attribution needs populated event_sources rows.");
    }

    return buildDashboard({
      env: this.env,
      runs,
      topRecommendations,
      dashboardRecommendations,
      recommendationHistory,
      suppressedEvents,
      rejectedCandidates,
      candidates: latestCandidates.length ? latestCandidates : allCandidates,
      events: mergeEvents(events, recommendedEvents),
      scores: scores
        .concat(recommendedScores)
        .filter((score, index, all) => all.findIndex((item) => item.eventId === score.eventId) === index),
      reviewCandidates,
      sourcePerformance,
      organizerPerformance,
      feedbackSummary,
      tasteSignals: buildTasteSignalsFromSummaries(feedbackSummary),
      missedEvents,
      dataGaps
    });
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  private async listEventsByIds(eventIds: string[]): Promise<EventCandidate[]> {
    if (eventIds.length === 0) return [];
    return this.queryJson<EventCandidate>(
      `select coalesce(json_agg(json_build_object('id', id, 'canonicalUrl', canonical_url, 'sourceUrls', json_build_array(canonical_url), 'title', title, 'description', description, 'startAt', start_at, 'endAt', end_at, 'timezone', timezone, 'city', city, 'venueText', venue_text, 'locationPrecision', location_precision, 'hosts', hosts_json, 'organizers', organizers_json, 'visibilityFlags', visibility_flags_json, 'registrationStatus', registration_status, 'eventType', event_type) order by first_seen_at desc), '[]'::json) as data from events where id = any($1::text[])`,
      [eventIds]
    );
  }

  private async listLatestScoresByEventIds(eventIds: string[]): Promise<EventScore[]> {
    if (eventIds.length === 0) return [];
    return this.queryJson<EventScore>(
      `select coalesce(json_agg(breakdown_json order by created_at desc), '[]'::json) as data
       from (
         select distinct on (event_id) breakdown_json, created_at
         from event_scores
         where event_id = any($1::text[])
         order by event_id, created_at desc
       ) s`,
      [eventIds]
    );
  }

  private async listRecommendationHistory(limit: number): Promise<DashboardRecommendation[]> {
    try {
      const result = await this.pool.query<{ data: DashboardRecommendation[] }>(
        `select coalesce(json_agg(json_build_object(
          'recommendation', json_build_object('id', r.id, 'runId', r.run_id, 'eventId', r.event_id, 'score', r.score, 'reason', r.reason, 'createdAt', r.created_at),
          'event', json_build_object('id', e.id, 'canonicalUrl', e.canonical_url, 'sourceUrls', json_build_array(e.canonical_url), 'title', e.title, 'description', e.description, 'startAt', e.start_at, 'endAt', e.end_at, 'timezone', e.timezone, 'city', e.city, 'venueText', e.venue_text, 'locationPrecision', e.location_precision, 'hosts', e.hosts_json, 'organizers', e.organizers_json, 'visibilityFlags', e.visibility_flags_json, 'registrationStatus', e.registration_status, 'eventType', e.event_type),
          'score', s.breakdown_json
        ) order by r.created_at desc), '[]'::json) as data
        from (
          select *
          from recommendations
          order by created_at desc
          limit $1
        ) r
        left join events e on e.id = r.event_id
        left join lateral (
          select breakdown_json
          from event_scores
          where event_id = r.event_id
          order by created_at desc
          limit 1
        ) s on true`,
        [limit]
      );
      return result.rows[0]?.data ?? [];
    } catch (error) {
      if (isMissingRelation(error)) return [];
      throw error;
    }
  }

  private async listSuppressedEvents(runId: string, limit: number): Promise<DashboardSuppressedEvent[]> {
    try {
      const result = await this.pool.query<{ data: DashboardSuppressedEvent[] }>(
        `with suppressed as (
          select
            e.*,
            s.breakdown_json,
            s.total_score,
            previous.id as previous_id,
            previous.run_id as previous_run_id,
            previous.event_id as previous_event_id,
            previous.score as previous_score,
            previous.reason as previous_reason,
            previous.created_at as previous_created_at
          from (
            select distinct on (event_id) *
            from event_scores
            where run_id = $1 and total_score >= $3
            order by event_id, created_at desc
          ) s
          join events e on e.id = s.event_id
          left join recommendations current_rec on current_rec.run_id = $1 and current_rec.event_id = s.event_id
          left join lateral (
            select r.*
            from recommendations r
            join events previous_event on previous_event.id = r.event_id
            where r.run_id <> $1
              and (
                previous_event.canonical_url = e.canonical_url
                or lower(previous_event.title) = lower(e.title)
              )
            order by r.created_at desc
            limit 1
          ) previous on true
          where current_rec.id is null
          order by s.total_score desc
          limit $2
        )
        select coalesce(json_agg(json_build_object(
          'event', json_build_object('id', e.id, 'canonicalUrl', e.canonical_url, 'sourceUrls', json_build_array(e.canonical_url), 'title', e.title, 'description', e.description, 'startAt', e.start_at, 'endAt', e.end_at, 'timezone', e.timezone, 'city', e.city, 'venueText', e.venue_text, 'locationPrecision', e.location_precision, 'hosts', e.hosts_json, 'organizers', e.organizers_json, 'visibilityFlags', e.visibility_flags_json, 'registrationStatus', e.registration_status, 'eventType', e.event_type),
          'score', e.breakdown_json,
          'reason', case
            when e.previous_id is not null then 'Previously recommended; hidden from the latest digest to avoid repeats.'
            else 'Scored above the recommendation threshold but did not enter the latest recommendation set.'
          end,
          'previousRecommendation', case
            when e.previous_id is null then null
            else json_build_object('id', e.previous_id, 'runId', e.previous_run_id, 'eventId', e.previous_event_id, 'score', e.previous_score, 'reason', e.previous_reason, 'createdAt', e.previous_created_at)
          end
        ) order by e.total_score desc), '[]'::json) as data
        from suppressed e`,
        [runId, limit, this.env.profile.thresholds.recommend]
      );
      return result.rows[0]?.data ?? [];
    } catch (error) {
      if (isMissingRelation(error)) return [];
      throw error;
    }
  }

  private async listReviewCandidates(runId: string, limit: number): Promise<DashboardReviewCandidate[]> {
    try {
      const result = await this.pool.query<{ data: DashboardReviewCandidate[] }>(
        `select coalesce(json_agg(json_build_object(
          'event', json_build_object('id', e.id, 'canonicalUrl', e.canonical_url, 'sourceUrls', json_build_array(e.canonical_url), 'title', e.title, 'description', e.description, 'startAt', e.start_at, 'endAt', e.end_at, 'timezone', e.timezone, 'city', e.city, 'venueText', e.venue_text, 'locationPrecision', e.location_precision, 'hosts', e.hosts_json, 'organizers', e.organizers_json, 'visibilityFlags', e.visibility_flags_json, 'registrationStatus', e.registration_status, 'eventType', e.event_type),
          'score', s.breakdown_json,
          'reason', coalesce(s.rationale, 'Scored below the recommendation threshold.')
        ) order by s.total_score desc), '[]'::json) as data
        from (
          select distinct on (event_id) *
          from event_scores
          where run_id = $1 and total_score >= $3 and total_score < $4
          order by event_id, created_at desc
          limit $2
        ) s
        join events e on e.id = s.event_id`,
        [runId, limit, this.env.profile.thresholds.review, this.env.profile.thresholds.recommend]
      );
      return result.rows[0]?.data ?? [];
    } catch (error) {
      if (isMissingRelation(error)) return [];
      throw error;
    }
  }

  private async listFeedbackSummary(limit: number, dataGaps: string[]): Promise<DashboardFeedbackSummary[]> {
    try {
      const result = await this.pool.query<{ data: DashboardFeedbackSummary[] }>(
        `select coalesce(json_agg(json_build_object(
          'feedbackType', feedback_type,
          'count', feedback_count,
          'latestAt', latest_at
        ) order by feedback_count desc, latest_at desc), '[]'::json) as data
        from (
          select feedback_type, count(*)::int as feedback_count, max(created_at) as latest_at
          from feedback
          group by feedback_type
          order by feedback_count desc, latest_at desc
          limit $1
        ) f`,
        [limit]
      );
      return result.rows[0]?.data ?? [];
    } catch (error) {
      if (isMissingRelation(error)) {
        dataGaps.push("Taste signals need feedback rows before this section can show preferences.");
        return [];
      }
      throw error;
    }
  }

  private async listSourcePerformance(limit: number, dataGaps: string[]): Promise<DashboardSourcePerformance[]> {
    try {
      const result = await this.pool.query<{ data: DashboardSourcePerformance[] }>(
        `with candidate_stats as (
          select
            coalesce(nullif(source_query, ''), source_platform) as label,
            source_platform as source_type,
            count(*)::int as candidate_count,
            count(*) filter (where status in ('rejected', 'error'))::int as noise_count
          from candidate_urls
          group by coalesce(nullif(source_query, ''), source_platform), source_platform
        ),
        event_stats as (
          select
            coalesce(nullif(cu.source_query, ''), cu.source_platform) as label,
            cu.source_platform as source_type,
            count(distinct es.event_id)::int as event_count,
            count(distinct r.id)::int as recommendation_count
          from candidate_urls cu
          join event_sources es on es.candidate_url_id = cu.id
          left join recommendations r on r.event_id = es.event_id
          group by coalesce(nullif(cu.source_query, ''), cu.source_platform), cu.source_platform
        )
        select coalesce(json_agg(json_build_object(
          'label', c.label,
          'sourceType', c.source_type,
          'candidateCount', c.candidate_count,
          'eventCount', coalesce(e.event_count, 0),
          'recommendationCount', coalesce(e.recommendation_count, 0),
          'noiseCount', c.noise_count
        ) order by c.candidate_count desc), '[]'::json) as data
        from (
          select * from candidate_stats
          order by candidate_count desc
          limit $1
        ) c
        left join event_stats e on e.label = c.label and e.source_type = c.source_type`,
        [limit]
      );
      return result.rows[0]?.data ?? [];
    } catch (error) {
      if (isMissingRelation(error)) {
        dataGaps.push("Source/query performance needs candidate_urls and event_sources tables.");
        return [];
      }
      throw error;
    }
  }

  private async listOrganizerPerformance(limit: number, dataGaps: string[]): Promise<DashboardOrganizerPerformance[]> {
    try {
      const result = await this.pool.query<{ data: DashboardOrganizerPerformance[] }>(
        `with latest_scores as (
          select distinct on (event_id) event_id, total_score
          from event_scores
          order by event_id, created_at desc
        ),
        organizer_rows as (
          select distinct
            e.id as event_id,
            nullif(trim(organizer), '') as organizer,
            coalesce(s.total_score, 0) as total_score
          from events e
          left join latest_scores s on s.event_id = e.id
          cross join lateral jsonb_array_elements_text(
            coalesce(e.hosts_json, '[]'::jsonb) || coalesce(e.organizers_json, '[]'::jsonb)
          ) organizer
          where nullif(trim(organizer), '') is not null
        ),
        recommendation_stats as (
          select event_id, count(*)::int as recommendation_count
          from recommendations
          group by event_id
        ),
        ranked as (
          select
            o.organizer,
            count(distinct o.event_id)::int as event_count,
            coalesce(sum(rs.recommendation_count), 0)::int as recommendation_count,
            max(o.total_score)::float as max_score,
            round(avg(o.total_score)::numeric, 1)::float as avg_score
          from organizer_rows o
          left join recommendation_stats rs on rs.event_id = o.event_id
          group by o.organizer
          order by max(o.total_score) desc, count(distinct o.event_id) desc
          limit $1
        )
        select coalesce(json_agg(json_build_object(
          'organizer', organizer,
          'eventCount', event_count,
          'recommendationCount', recommendation_count,
          'maxScore', max_score,
          'avgScore', avg_score
        ) order by max_score desc, event_count desc), '[]'::json) as data
        from ranked`,
        [limit]
      );
      return result.rows[0]?.data ?? [];
    } catch (error) {
      if (isMissingRelation(error)) {
        dataGaps.push("Organizer performance needs events, event_scores, and recommendations tables.");
        return [];
      }
      throw error;
    }
  }

  private async listMissedEvents(limit: number, dataGaps: string[]): Promise<DashboardMissedEvent[]> {
    try {
      const result = await this.pool.query<{ data: DashboardMissedEvent[] }>(
        `select coalesce(json_agg(json_build_object(
          'id', id,
          'title', title,
          'url', url,
          'happenedAt', happened_at,
          'missReason', miss_reason,
          'suggestion', suggestion,
          'createdAt', created_at
        ) order by created_at desc), '[]'::json) as data
        from (select * from missed_events order by created_at desc limit $1) m`,
        [limit]
      );
      return result.rows[0]?.data ?? [];
    } catch (error) {
      if (isMissingRelation(error)) {
        dataGaps.push("Miss hunt needs missed_events table data before this section can show misses.");
        return [];
      }
      throw error;
    }
  }

  private async query(sqlText: string, params: unknown[] = []): Promise<void> {
    await this.pool.query(sqlText, params);
  }

  private async queryJson<T>(sqlText: string, params: unknown[] = []): Promise<T[]> {
    const result = await this.pool.query<{ data: T[] }>(sqlText, params);
    return result.rows[0]?.data ?? [];
  }
}

function mergeEvents(left: EventCandidate[], right: EventCandidate[]): EventCandidate[] {
  const byId = new Map<string, EventCandidate>();
  for (const event of [...right, ...left]) {
    byId.set(event.id, event);
  }
  return [...byId.values()];
}

function isMissingRelation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && ["42P01", "42703"].includes(String(error.code));
}

function errorToString(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function jsonParam(value: unknown): string {
  return JSON.stringify(value);
}

function migrationPath(file: string): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const distPath = resolve(here, "migrations", file);
  if (existsSync(distPath)) return distPath;
  return resolve(here, "..", "src", "migrations", file);
}

function pgPoolConfig(env: AppEnv): PoolConfig {
  return {
    connectionString: env.databaseUrl,
    connectionTimeoutMillis: env.timeouts.postgresConnectionMs,
    query_timeout: env.timeouts.postgresQueryMs,
    statement_timeout: env.timeouts.postgresQueryMs,
    idleTimeoutMillis: 10_000
  };
}
