import type { AppEnv, ScoutProfile } from "@event-scout/shared";
import { Pool, type PoolConfig } from "pg";
import type { QuerySpec } from "./types.js";
import type { CandidateUrl, DiscoveryRepository, DiscoveryRunResult, QueryRow, SourceEdge, SourceRecord } from "./types.js";
import { buildSourceGraph } from "./source-graph.js";

export class MemoryDiscoveryRepository implements DiscoveryRepository {
  readonly queries: QueryRow[] = [];
  readonly candidateUrls: CandidateUrl[] = [];
  readonly sources = new Map<string, SourceRecord>();
  readonly sourceEdges: SourceEdge[] = [];

  async insertQueries(rows: QueryRow[]): Promise<void> {
    this.queries.push(...rows);
  }

  async insertCandidateUrls(rows: CandidateUrl[]): Promise<void> {
    this.candidateUrls.push(...rows);
  }

  async upsertSources(rows: SourceRecord[]): Promise<void> {
    for (const row of rows) {
      const existing = this.sources.get(row.id);
      if (existing) {
        this.sources.set(row.id, {
          ...existing,
          qualityScore: Math.round((existing.qualityScore + row.qualityScore) / 2),
          noiseRate: Math.round(((existing.noiseRate + row.noiseRate) / 2) * 100) / 100,
          freshnessScore: Math.max(existing.freshnessScore, row.freshnessScore),
          eventsFoundCount: existing.eventsFoundCount + row.eventsFoundCount,
          recommendedEventsCount: existing.recommendedEventsCount + row.recommendedEventsCount,
          lastSeenAt: row.lastSeenAt > existing.lastSeenAt ? row.lastSeenAt : existing.lastSeenAt
        });
      } else {
        this.sources.set(row.id, row);
      }
    }
  }

  async insertSourceEdges(rows: SourceEdge[]): Promise<void> {
    this.sourceEdges.push(...rows);
  }
}

const defaultRepository = new MemoryDiscoveryRepository();

export function createDiscoveryRepository(env: AppEnv): DiscoveryRepository {
  if (env.mockMode || !env.databaseUrl) {
    return defaultRepository;
  }

  return new PgDiscoveryRepository(env);
}

export function createQueryRows(runId: string, queryPack: QuerySpec[], executedAt = new Date()): QueryRow[] {
  return queryPack.map((query) => ({
    id: `${runId}:${query.id}`,
    runId,
    queryGroup: query.group,
    connector: query.connector,
    queryText: query.text,
    maxResults: query.maxResults,
    executedAt: executedAt.toISOString()
  }));
}

export async function ingestCandidates(
  runId: string,
  candidates: CandidateUrl[],
  queryPack: QuerySpec[] = [],
  repository: DiscoveryRepository = defaultRepository,
  now = new Date(),
  profile?: ScoutProfile
): Promise<DiscoveryRunResult> {
  const queries = createQueryRows(runId, queryPack, now);
  const { sources, sourceEdges } = buildSourceGraph(runId, candidates, now, profile);

  await repository.insertQueries(queries);
  await repository.insertCandidateUrls(candidates);
  await repository.upsertSources(sources);
  await repository.insertSourceEdges(sourceEdges);

  return {
    runId,
    queries,
    candidates,
    sources,
    sourceEdges
  };
}

export async function updateSourceGraph(
  runId: string,
  candidates: CandidateUrl[] = [],
  repository: DiscoveryRepository = defaultRepository,
  now = new Date(),
  profile?: ScoutProfile
): Promise<{ sources: SourceRecord[]; sourceEdges: SourceEdge[] }> {
  const { sources, sourceEdges } = buildSourceGraph(runId, candidates, now, profile);
  await repository.upsertSources(sources);
  await repository.insertSourceEdges(sourceEdges);
  return { sources, sourceEdges };
}

export function getDefaultMemoryDiscoveryRepository(): MemoryDiscoveryRepository {
  return defaultRepository;
}

class PgDiscoveryRepository implements DiscoveryRepository {
  private readonly pool: Pool;

  constructor(env: AppEnv) {
    this.pool = new Pool(pgPoolConfig(env));
  }

  async insertQueries(rows: QueryRow[]): Promise<void> {
    for (const row of rows) {
      await this.query(
        `insert into queries (id, run_id, query_text, query_type, platform, budget_cost, created_at)
         values ($1, $2, $3, $4, $5, $6, $7)
         on conflict (id) do update set query_text = excluded.query_text, budget_cost = excluded.budget_cost`,
        [row.id, row.runId, row.queryText, row.queryGroup, row.connector, row.maxResults, row.executedAt]
      );
    }
  }

  async insertCandidateUrls(rows: CandidateUrl[]): Promise<void> {
    for (const row of rows) {
      await this.query(
        `insert into candidate_urls (id, run_id, url, canonical_url, source_platform, source_query, source_id, title, snippet, status, rejection_reason, discovered_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         on conflict (id) do update set status = excluded.status, rejection_reason = excluded.rejection_reason, title = excluded.title, snippet = excluded.snippet`,
        [
          row.id,
          row.runId,
          row.url,
          row.canonicalUrl,
          row.sourcePlatform,
          row.sourceQuery,
          row.sourceId,
          row.title,
          row.snippet,
          row.status,
          row.rejectionReason,
          row.discoveredAt
        ]
      );
    }
  }

  async upsertSources(rows: SourceRecord[]): Promise<void> {
    for (const row of rows) {
      await this.query(
        `insert into sources (id, source_type, name, url, handle, quality_score, noise_rate, freshness_score, events_found_count, recommended_events_count, last_seen_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         on conflict (id) do update set quality_score = (sources.quality_score + excluded.quality_score) / 2, noise_rate = (sources.noise_rate + excluded.noise_rate) / 2, freshness_score = greatest(sources.freshness_score, excluded.freshness_score), events_found_count = sources.events_found_count + excluded.events_found_count, recommended_events_count = sources.recommended_events_count + excluded.recommended_events_count, last_seen_at = greatest(coalesce(sources.last_seen_at, excluded.last_seen_at), excluded.last_seen_at)`,
        [
          row.id,
          row.sourceType,
          row.name,
          row.url,
          row.handle,
          row.qualityScore,
          row.noiseRate,
          row.freshnessScore,
          row.eventsFoundCount,
          row.recommendedEventsCount,
          row.lastSeenAt
        ]
      );
    }
  }

  async insertSourceEdges(rows: SourceEdge[]): Promise<void> {
    for (const row of rows) {
      await this.query(
        `insert into source_edges (id, source_id, target_source_id, edge_type, weight, first_seen_at, last_seen_at)
         values ($1, $2, $3, $4, $5, $6, $7)
         on conflict (id) do update set weight = excluded.weight, last_seen_at = excluded.last_seen_at`,
        [row.id, row.fromSourceId, row.toSourceId, row.edgeType, row.weight, row.createdAt, row.createdAt]
      );
    }
  }

  private async query(sqlText: string, params: unknown[]): Promise<void> {
    await this.pool.query(sqlText, params);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
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
