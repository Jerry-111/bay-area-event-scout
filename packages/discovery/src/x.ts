import { fetchWithTimeout, type AppEnv, type ScoutProfile } from "@event-scout/shared";
import { classifyRejectionReason, extractUrlsFromText, normalizeCandidateUrl, scoreCandidateSignal, stableId } from "./normalize.js";
import type { CandidateUrl, ConnectorOptions, DiscoveryStats, QuerySpec } from "./types.js";

interface XUrlEntity {
  expanded_url?: string;
  unwound_url?: string;
  url?: string;
}

interface XPost {
  id: string;
  text: string;
  author_id?: string;
  created_at?: string;
  entities?: {
    urls?: XUrlEntity[];
  };
}

interface XUser {
  id: string;
  name?: string;
  username?: string;
}

interface XRecentSearchResponse {
  data?: XPost[];
  includes?: {
    users?: XUser[];
  };
  meta?: {
    next_token?: string;
    result_count?: number;
  };
}

function userById(users: XUser[] | undefined): Map<string, XUser> {
  return new Map((users ?? []).map((user) => [user.id, user]));
}

function urlsForPost(post: XPost): string[] {
  const entityUrls =
    post.entities?.urls
      ?.map((url) => url.unwound_url ?? url.expanded_url ?? url.url)
      .filter((url): url is string => Boolean(url)) ?? [];
  const textUrls = extractUrlsFromText(post.text).filter((url) => {
    try {
      const host = new URL(url).hostname.toLowerCase();
      return host !== "t.co" && !host.endsWith(".t.co");
    } catch {
      return false;
    }
  });
  return Array.from(new Set([...entityUrls, ...textUrls]));
}

function mockXCandidate(runId: string, query: QuerySpec, now: Date, profile: ScoutProfile): CandidateUrl {
  const canonicalUrl = normalizeCandidateUrl("https://lu.ma/mock-agent-builders-breakfast?utm_medium=social");
  const title = "X post from @mockbuilder";
  const snippet = "Hosting an agent builders breakfast in SF next week. Apply on Luma.";
  const rejectionReason = classifyRejectionReason({ canonicalUrl, title, snippet }, { now, profile });

  return {
    id: stableId([runId, query.id, canonicalUrl, "mock-x"]),
    runId,
    sourcePlatform: "x",
    sourceUrl: "https://x.com/mockbuilder/status/1",
    url: canonicalUrl,
    canonicalUrl,
    sourceQuery: query.text,
    sourceId: "1",
    title,
    snippet,
    discoveredAt: now.toISOString(),
    evidence: ["mock x result", query.text],
    status: rejectionReason ? "rejected" : "new",
    rejectionReason,
    sourceHandle: "mockbuilder",
    sourceName: "Mock Builder",
    sourceType: "x_account",
    sourceScore: scoreCandidateSignal({ canonicalUrl, title, snippet }, profile)
  };
}

export async function runXDiscovery(
  runId: string,
  queryPack: QuerySpec[],
  env: AppEnv,
  options: ConnectorOptions = {}
): Promise<CandidateUrl[]> {
  return (await runXDiscoveryWithStats(runId, queryPack, env, options)).candidates;
}

export async function runXDiscoveryWithStats(
  runId: string,
  queryPack: QuerySpec[],
  env: AppEnv,
  options: ConnectorOptions = {}
): Promise<{ candidates: CandidateUrl[]; stats: DiscoveryStats }> {
  const now = options.now ?? new Date();
  const profile = env.profile;
  const fetchImpl = options.fetchImpl ?? fetch;
  const queries = queryPack.filter((query) => query.connector === "x");
  const context = options.runContext;
  const xBudgetRemaining = Math.max(0, context?.xBudgetRemaining ?? env.budgets.maxXPostsPerDay);
  const maxPosts = Math.min(env.budgets.maxXPostsPerRun, xBudgetRemaining);
  const skippedReason = "x_skipped_due_to_schedule_or_budget";

  if (context && !context.xEnabled) {
    return {
      candidates: [xSkipCandidate(runId, now, skippedReason)],
      stats: { xPostsRead: 0, xBudgetRemaining, xSkippedReason: skippedReason }
    };
  }

  if (maxPosts <= 0) {
    return {
      candidates: [xSkipCandidate(runId, now, skippedReason)],
      stats: { xPostsRead: 0, xBudgetRemaining: 0, xSkippedReason: skippedReason }
    };
  }

  if (env.mockMode) {
    const candidates = queries.slice(0, Math.min(queries.length, maxPosts)).map((query) => mockXCandidate(runId, query, now, profile));
    return {
      candidates,
      stats: { xPostsRead: candidates.length, xBudgetRemaining: Math.max(0, xBudgetRemaining - candidates.length) }
    };
  }

  if (!env.xBearerToken) {
    console.warn("[discovery:x] X_BEARER_TOKEN missing; skipping X API discovery.");
    return {
      candidates: [],
      stats: { xPostsRead: 0, xBudgetRemaining }
    };
  }

  const candidates: CandidateUrl[] = [];
  let postsSeen = 0;

  for (const query of queries) {
    if (postsSeen >= maxPosts) break;

    const requested = Math.min(100, Math.max(10, Math.min(query.maxResults, maxPosts - postsSeen)));
    const params = new URLSearchParams({
      query: query.text,
      max_results: String(requested),
      "tweet.fields": "author_id,created_at,entities,public_metrics",
      expansions: "author_id",
      "user.fields": "name,username,verified"
    });

    let response: Response;
    try {
      response = await fetchWithTimeout(
        fetchImpl,
        `https://api.x.com/2/tweets/search/recent?${params.toString()}`,
        {
          headers: {
            authorization: `Bearer ${env.xBearerToken}`
          }
        },
        env.timeouts.xMs,
        `X query ${query.id}`
      );
    } catch (error) {
      console.warn(`[discovery:x] query ${query.id} failed before response: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }

    if (!response.ok) {
      const errorText = await response.text();
      console.warn(`[discovery:x] query ${query.id} failed with ${response.status}: ${errorText.slice(0, 240)}`);
      continue;
    }

    const payload = (await response.json()) as XRecentSearchResponse;
    const users = userById(payload.includes?.users);

    for (const post of payload.data ?? []) {
      if (postsSeen >= maxPosts) break;
      postsSeen += 1;

      const author = post.author_id ? users.get(post.author_id) : undefined;
      const postUrl = author?.username ? `https://x.com/${author.username}/status/${post.id}` : `https://x.com/i/web/status/${post.id}`;
      const discoveredAt = post.created_at ?? now.toISOString();
      const urls = urlsForPost(post);

      if (urls.length === 0) {
        const canonicalUrl = normalizeCandidateUrl(postUrl);
        const title = `X post${author?.username ? ` from @${author.username}` : ""}`;
        const rejectionReason = "x_post_without_candidate_url";
        candidates.push({
          id: stableId([runId, query.id, post.id, canonicalUrl]),
          runId,
          sourcePlatform: "x",
          sourceUrl: postUrl,
          url: postUrl,
          canonicalUrl,
          sourceQuery: query.text,
          sourceId: post.id,
          title,
          snippet: post.text,
          discoveredAt,
          evidence: [query.text],
          status: "rejected",
          rejectionReason,
          sourceHandle: author?.username,
          sourceName: author?.name,
          sourceType: "x_account",
          sourceScore: scoreCandidateSignal({ canonicalUrl, title, snippet: post.text }, profile)
        });
        continue;
      }

      for (const rawUrl of urls) {
        const canonicalUrl = normalizeCandidateUrl(rawUrl);
        const title = `X post${author?.username ? ` from @${author.username}` : ""}`;
        const snippet = post.text;
        const rejectionReason = classifyRejectionReason({ canonicalUrl, title, snippet }, { now, profile });

        candidates.push({
          id: stableId([runId, query.id, post.id, canonicalUrl]),
          runId,
          sourcePlatform: "x",
          sourceUrl: postUrl,
          url: rawUrl,
          canonicalUrl,
          sourceQuery: query.text,
          sourceId: post.id,
          title,
          snippet,
          discoveredAt,
          evidence: [query.text, postUrl],
          status: rejectionReason ? "rejected" : "new",
          rejectionReason,
          sourceHandle: author?.username,
          sourceName: author?.name,
          sourceType: "x_account",
          sourceScore: scoreCandidateSignal({ canonicalUrl, title, snippet }, profile)
        });
      }
    }
  }

  return {
    candidates,
    stats: { xPostsRead: postsSeen, xBudgetRemaining: Math.max(0, xBudgetRemaining - postsSeen) }
  };
}

function xSkipCandidate(runId: string, now: Date, rejectionReason: string): CandidateUrl {
  const url = `x://skipped/${runId}`;
  return {
    id: stableId([runId, "x-skipped", rejectionReason]),
    runId,
    sourcePlatform: "x",
    sourceUrl: url,
    url,
    canonicalUrl: url,
    sourceQuery: "x_api",
    title: "X API discovery skipped",
    snippet: rejectionReason,
    discoveredAt: now.toISOString(),
    evidence: [rejectionReason],
    status: "rejected",
    rejectionReason,
    sourceType: "x_account",
    sourceScore: 0
  };
}
