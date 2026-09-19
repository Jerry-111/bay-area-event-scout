import type { AppEnv } from "@event-scout/shared";
import { loadRuntimeEnv } from "@event-scout/shared";
import { runExaDiscovery } from "./exa.js";
import { createDiscoveryRepository, ingestCandidates, updateSourceGraph } from "./ingest.js";
import { runLumaSeedRefresh } from "./luma.js";
import { runPublicSourceDiscovery } from "./public-source.js";
import { buildDailyQueryPack } from "./query-packs.js";
import { runRssDiscovery } from "./rss.js";
import { runXDiscoveryWithStats } from "./x.js";
import type { CandidateUrl, ConnectorOptions, DiscoveryCandidatesResult, DiscoveryRepository, QuerySpec } from "./types.js";

export { runExaDiscovery } from "./exa.js";
export {
  MemoryDiscoveryRepository,
  createDiscoveryRepository,
  createQueryRows,
  getDefaultMemoryDiscoveryRepository,
  ingestCandidates,
  updateSourceGraph
} from "./ingest.js";
export { runLumaSeedRefresh } from "./luma.js";
export { extractCandidateLinks, runPublicSourceDiscovery } from "./public-source.js";
export {
  classifyCandidateIntent,
  classifyRejectionReason,
  extractUrlsFromText,
  hasExplicitPastEventDate,
  hasExcludedFormat,
  isEventbriteUrl,
  isIndexedLinkedInUrl,
  isKnownEventPlatformUrl,
  isLumaUrl,
  isMeetupUrl,
  isNonEventLink,
  isPartifulUrl,
  normalizeCandidateUrl,
  scoreCandidateSignal,
  sourceFromCandidate,
  sourceTypeForUrl,
  stableId
} from "./normalize.js";
export { buildDailyQueryPack, buildMissHuntQueryPack } from "./query-packs.js";
export { runRssDiscovery, parseFeedEntries } from "./rss.js";
export {
  FREE_PUBLIC_SOURCES,
  registrySourcesByKind,
  registrySourcesForProfile,
  sourceTypeForRegistryKind,
  type RegistrySource
} from "./source-registry.js";
export {
  buildKnownSourceQueries,
  KNOWN_INDEXED_SOURCES,
  KNOWN_LUMA_SOURCES,
  KNOWN_MEETUP_GROUPS,
  KNOWN_X_SOURCES,
  knownLumaSeedUrls,
  type KnownSourcePriority
} from "./known-sources.js";
export { buildSourceGraph } from "./source-graph.js";
export type {
  CandidateUrl,
  ConnectorOptions,
  DiscoveryConnector,
  DiscoveryCandidatesResult,
  DiscoveryRepository,
  DiscoveryRunResult,
  DiscoveryRunContext,
  DiscoveryStats,
  QueryGroup,
  QueryRow,
  QuerySpec,
  SourceEdge,
  SourceRecord,
  SourceType
} from "./types.js";
export { runXDiscovery } from "./x.js";
export { runXDiscoveryWithStats } from "./x.js";

function dedupeCandidates(candidates: CandidateUrl[]): CandidateUrl[] {
  const byKey = new Map<string, CandidateUrl>();
  for (const candidate of candidates) {
    const key = `${candidate.canonicalUrl}:${candidate.sourcePlatform}:${candidate.sourceId ?? candidate.sourceQuery ?? ""}`;
    if (!byKey.has(key)) {
      byKey.set(key, candidate);
    }
  }
  return Array.from(byKey.values());
}

export async function discoverCandidates(
  envOrRunId: AppEnv | string,
  queryPackOrEnv?: QuerySpec[] | AppEnv,
  maybeRepository?: DiscoveryRepository,
  options: ConnectorOptions = {}
): Promise<CandidateUrl[]> {
  return (await discoverCandidatesWithStats(envOrRunId, queryPackOrEnv, maybeRepository, options)).candidates;
}

export async function discoverCandidatesWithStats(
  envOrRunId: AppEnv | string,
  queryPackOrEnv?: QuerySpec[] | AppEnv,
  maybeRepository?: DiscoveryRepository | AppEnv,
  options: ConnectorOptions = {}
): Promise<DiscoveryCandidatesResult> {
  const calledWithRunId = typeof envOrRunId === "string";
  const runId = calledWithRunId ? envOrRunId : `discovery-${Date.now()}`;
  const explicitEnv = isAppEnv(maybeRepository) ? maybeRepository : undefined;
  const env = calledWithRunId
    ? (explicitEnv ?? (queryPackOrEnv && !Array.isArray(queryPackOrEnv) ? queryPackOrEnv : loadRuntimeEnv()))
    : envOrRunId;
  const queryPack = Array.isArray(queryPackOrEnv)
    ? queryPackOrEnv
    : buildDailyQueryPack(options.now ?? new Date(), { scanTime: options.runContext?.scanTime, profile: env.profile });

  const repository = maybeRepository && !isAppEnv(maybeRepository) ? maybeRepository : createDiscoveryRepository(env);
  const shouldCloseRepository = !maybeRepository || isAppEnv(maybeRepository);
  try {
    const [exaCandidates, xResult, lumaSeeds, publicSourceCandidates, rssCandidates] = await Promise.all([
      runExaDiscovery(runId, queryPack, env, options),
      runXDiscoveryWithStats(runId, queryPack, env, options),
      runLumaSeedRefresh(runId, queryPack, env, options),
      runPublicSourceDiscovery(runId, queryPack, env, options),
      runRssDiscovery(runId, queryPack, env, options)
    ]);

    const candidates = dedupeCandidates([...exaCandidates, ...xResult.candidates, ...lumaSeeds, ...publicSourceCandidates, ...rssCandidates]);
    await ingestCandidates(runId, candidates, queryPack, repository, options.now, env.profile);

    return {
      candidates,
      stats: xResult.stats
    };
  } finally {
    if (shouldCloseRepository) {
      await repository.close?.();
    }
  }
}

function isAppEnv(value: unknown): value is AppEnv {
  return Boolean(value && typeof value === "object" && "budgets" in value && "timeouts" in value);
}
