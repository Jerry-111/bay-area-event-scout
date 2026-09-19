import { fetchWithTimeout, type AppEnv, type ScoutProfile, type SourcePlatform } from "@event-scout/shared";
import {
  classifyRejectionReason,
  isEventbriteUrl,
  isIndexedLinkedInUrl,
  isLumaUrl,
  isMeetupUrl,
  normalizeCandidateUrl,
  scoreCandidateSignal,
  stableId
} from "./normalize.js";
import type { CandidateUrl, ConnectorOptions, QuerySpec } from "./types.js";

interface ExaResult {
  id?: string;
  title?: string;
  url?: string;
  publishedDate?: string;
  author?: string;
  highlights?: string[];
  summary?: string;
  text?: string;
}

interface ExaSearchResponse {
  results?: ExaResult[];
}

function startCrawlDate(now: Date, recencyDays?: number): string | undefined {
  if (!recencyDays) return undefined;
  return new Date(now.getTime() - recencyDays * 24 * 60 * 60 * 1000).toISOString();
}

function sourcePlatformForExaUrl(url: string): SourcePlatform {
  if (isLumaUrl(url)) return "luma";
  if (isMeetupUrl(url)) return "meetup";
  if (isEventbriteUrl(url)) return "eventbrite";
  if (isIndexedLinkedInUrl(url)) return "linkedin_indexed";
  return "exa";
}

function mockExaCandidate(runId: string, query: QuerySpec, now: Date, profile: ScoutProfile): CandidateUrl {
  const url = query.group === "luma" ? "https://lu.ma/mock-ai-founders-dinner?utm_source=mock" : "https://example.com/sf-ai-builders-salon";
  const canonicalUrl = normalizeCandidateUrl(url);
  const sourcePlatform = sourcePlatformForExaUrl(canonicalUrl);
  const title = query.group === "luma" ? "Mock AI Founders Dinner SF" : "Mock SF AI Builders Salon";
  const snippet = "Small curated Bay Area event for AI founders, builders, and agent product people.";
  const rejectionReason = classifyRejectionReason({ canonicalUrl, title, snippet }, { now, profile });

  return {
    id: stableId([runId, query.id, canonicalUrl]),
    runId,
    sourcePlatform,
    sourceUrl: canonicalUrl,
    url,
    canonicalUrl,
    sourceQuery: query.text,
    title,
    snippet,
    discoveredAt: now.toISOString(),
    evidence: ["mock exa result", query.text],
    status: rejectionReason ? "rejected" : "new",
    rejectionReason,
    sourceScore: sourceScoreForQuery(query, { canonicalUrl, title, snippet }, profile)
  };
}

export async function runExaDiscovery(
  runId: string,
  queryPack: QuerySpec[],
  env: AppEnv,
  options: ConnectorOptions = {}
): Promise<CandidateUrl[]> {
  const now = options.now ?? new Date();
  const profile = env.profile;
  const fetchImpl = options.fetchImpl ?? fetch;
  const queries = queryPack.filter((query) => query.connector === "exa").slice(0, env.budgets.maxExaSearchesPerRun);

  if (env.mockMode) {
    return queries.map((query) => mockExaCandidate(runId, query, now, profile));
  }

  if (!env.exaApiKey) {
    console.warn("[discovery:exa] EXA_API_KEY missing; skipping Exa discovery.");
    return [];
  }

  const candidates: CandidateUrl[] = [];

  for (const query of queries) {
    const body = {
      query: query.text,
      type: "auto",
      numResults: Math.max(1, Math.min(100, query.maxResults)),
      includeDomains: query.includeDomains,
      startCrawlDate: startCrawlDate(now, query.recencyDays),
      contents: {
        highlights: true
      }
    };

    let response: Response;
    try {
      response = await fetchWithTimeout(
        fetchImpl,
        "https://api.exa.ai/search",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": env.exaApiKey
          },
          body: JSON.stringify(body)
        },
        env.timeouts.exaMs,
        `Exa query ${query.id}`
      );
    } catch (error) {
      console.warn(`[discovery:exa] query ${query.id} failed before response: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }

    if (!response.ok) {
      const errorText = await response.text();
      console.warn(`[discovery:exa] query ${query.id} failed with ${response.status}: ${errorText.slice(0, 240)}`);
      continue;
    }

    const payload = (await response.json()) as ExaSearchResponse;
    for (const result of payload.results ?? []) {
      if (!result.url) continue;
      const canonicalUrl = normalizeCandidateUrl(result.url);
      const title = result.title ?? canonicalUrl;
      const snippet = result.highlights?.join("\n") ?? result.summary ?? result.text?.slice(0, 500) ?? "";
      const rejectionReason = classifyRejectionReason({ canonicalUrl, title, snippet }, { now, profile });

      candidates.push({
        id: stableId([runId, query.id, canonicalUrl]),
        runId,
        sourcePlatform: sourcePlatformForExaUrl(canonicalUrl),
        sourceUrl: canonicalUrl,
        url: result.url,
        canonicalUrl,
        sourceQuery: query.text,
        sourceId: result.id,
        title,
        snippet,
        discoveredAt: now.toISOString(),
        evidence: [query.text, result.publishedDate, result.author].filter((value): value is string => Boolean(value)),
        status: rejectionReason ? "rejected" : "new",
        rejectionReason,
        sourceName: result.author,
        sourceScore: sourceScoreForQuery(query, { canonicalUrl, title, snippet }, profile)
      });
    }
  }

  return candidates;
}

function sourceScoreForQuery(
  query: QuerySpec,
  candidate: Pick<CandidateUrl, "canonicalUrl" | "title" | "snippet">,
  profile: ScoutProfile
): number {
  return Math.max(scoreCandidateSignal(candidate, profile), query.sourceScore ?? 0);
}
