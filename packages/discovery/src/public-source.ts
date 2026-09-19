import { fetchWithTimeout, type AppEnv, type ScoutProfile, type SourcePlatform } from "@event-scout/shared";
import {
  classifyRejectionReason,
  extractUrlsFromText,
  isEventbriteUrl,
  isKnownEventPlatformUrl,
  isNonEventLink,
  isLumaUrl,
  isMeetupUrl,
  normalizeCandidateUrl,
  scoreCandidateSignal,
  stableId
} from "./normalize.js";
import type { CandidateUrl, ConnectorOptions, QuerySpec } from "./types.js";

const DEFAULT_MAX_LINKS_PER_SOURCE = 20;

export async function runPublicSourceDiscovery(
  runId: string,
  queryPack: QuerySpec[],
  env: AppEnv,
  options: ConnectorOptions = {}
): Promise<CandidateUrl[]> {
  const now = options.now ?? new Date();
  const profile = env.profile;
  const fetchImpl = options.fetchImpl ?? fetch;
  const queries = queryPack.filter((query) => query.connector === "public_source");

  if (env.mockMode) {
    return queries.flatMap((query, index) => mockPublicSourceCandidates(runId, query, now, index, profile));
  }

  const candidates: CandidateUrl[] = [];

  for (const query of queries) {
    const seedUrls = (query.seedUrls ?? []).slice(0, Math.max(1, query.maxResults));
    for (const seedUrl of seedUrls) {
      let response: Response;
      try {
        response = await fetchWithTimeout(
          fetchImpl,
          seedUrl,
          {
            headers: {
              "User-Agent": "bay-event-scout/0.1 (+https://example.local/event-scout)",
              Accept: "text/html, text/plain;q=0.9, application/xhtml+xml;q=0.8, */*;q=0.5"
            }
          },
          env.timeouts.pageFetchMs,
          `public source ${query.id}`
        );
      } catch (error) {
        candidates.push(errorCandidate(runId, query, seedUrl, now, error));
        continue;
      }

      const body = await response.text().catch(() => "");
      if (!response.ok) {
        candidates.push(errorCandidate(runId, query, seedUrl, now, `HTTP ${response.status}`));
        continue;
      }

      const sourceTitle = extractTitle(body) ?? query.sourceName ?? seedUrl;
      const links = extractCandidateLinks(body, seedUrl).slice(0, maxCandidateLinksForQuery(query));
      if (links.length === 0) {
        candidates.push(retainedSourceCandidate(runId, query, seedUrl, sourceTitle, now));
        continue;
      }

      for (const link of links) {
        const canonicalUrl = normalizeCandidateUrl(link);
        const title = `Public source link from ${query.sourceName ?? sourceTitle}`;
        const snippet = textSnippet(body);
        const rejectionReason = classifyRejectionReason({ canonicalUrl, title, snippet }, { now, profile });
        candidates.push({
          id: stableId([runId, query.id, seedUrl, canonicalUrl]),
          runId,
          sourcePlatform: sourcePlatformForUrl(canonicalUrl),
          sourceUrl: seedUrl,
          url: link,
          canonicalUrl,
          sourceQuery: query.text,
          sourceId: seedUrl,
          title,
          snippet,
          discoveredAt: now.toISOString(),
          evidence: [query.text, seedUrl, sourceTitle],
          status: rejectionReason ? "rejected" : "new",
          rejectionReason,
          sourceName: query.sourceName ?? sourceTitle,
          sourceType: query.sourceType ?? "organizer_site",
          sourceScore: sourceScoreForQuery(query, { canonicalUrl, title, snippet }, profile)
        });
      }
    }
  }

  return candidates;
}

export function extractCandidateLinks(body: string, baseUrl: string): string[] {
  // Only <a> tags: a bare href-attribute scan also matches <link> tags (favicon, stylesheet,
  // canonical, alternate, ...), which are page metadata, not links a visitor would follow. A
  // page's own favicon is often served from the page's own domain (e.g. Luma's own discovery
  // pages link a same-origin /favicon.ico), so scanning every href turns it into a fake
  // same-platform "event" candidate every time that page is fetched.
  const hrefs = [...body.matchAll(/<a\b[^>]*?\bhref=["']([^"']+)["']/gi)].map((match) => match[1] ?? "");
  const textUrls = extractUrlsFromText(body);
  const urls = [...hrefs, ...textUrls]
    .map((url) => absolutizeUrl(url, baseUrl))
    .filter((url): url is string => Boolean(url))
    .map(normalizeCandidateUrl)
    .filter((url) => url !== normalizeCandidateUrl(baseUrl))
    .filter((url) => !isNonEventLink(url))
    .filter((url) => isKnownEventPlatformUrl(url) || hasEventPathSignal(url));

  return [...new Set(urls)];
}

function mockPublicSourceCandidates(runId: string, query: QuerySpec, now: Date, index: number, profile: ScoutProfile): CandidateUrl[] {
  const sourceUrl = query.seedUrls?.[0] ?? "https://example.com/events";
  const canonicalUrl = normalizeCandidateUrl(`https://lu.ma/mock-public-source-${index}`);
  const title = `Mock public source event from ${query.sourceName ?? "registry"}`;
  const snippet = "Approval required AI founder and builder salon discovered from a free public source page.";
  return [
    {
      id: stableId([runId, query.id, canonicalUrl]),
      runId,
      sourcePlatform: "luma",
      sourceUrl,
      url: canonicalUrl,
      canonicalUrl,
      sourceQuery: query.text,
      sourceId: sourceUrl,
      title,
      snippet,
      discoveredAt: now.toISOString(),
      evidence: ["mock public source", query.text],
      status: "new",
      sourceName: query.sourceName,
      sourceType: query.sourceType,
      sourceScore: sourceScoreForQuery(query, { canonicalUrl, title, snippet }, profile)
    }
  ];
}

function retainedSourceCandidate(runId: string, query: QuerySpec, seedUrl: string, sourceTitle: string, now: Date): CandidateUrl {
  const canonicalUrl = normalizeCandidateUrl(seedUrl);
  const title = `Public source retained: ${query.sourceName ?? sourceTitle}`;
  const snippet = "No direct event links were extracted from this public source page during this run.";
  return {
    id: stableId([runId, query.id, canonicalUrl, "retained"]),
    runId,
    sourcePlatform: sourcePlatformForUrl(canonicalUrl),
    sourceUrl: canonicalUrl,
    url: seedUrl,
    canonicalUrl,
    sourceQuery: query.text,
    sourceId: seedUrl,
    title,
    snippet,
    discoveredAt: now.toISOString(),
    evidence: [query.text, seedUrl],
    status: "rejected",
    rejectionReason: "public_source_no_event_links",
    sourceName: query.sourceName ?? sourceTitle,
    sourceType: query.sourceType ?? "organizer_site",
    sourceScore: 0
  };
}

function errorCandidate(runId: string, query: QuerySpec, seedUrl: string, now: Date, error: unknown): CandidateUrl {
  const canonicalUrl = normalizeCandidateUrl(seedUrl);
  return {
    id: stableId([runId, query.id, canonicalUrl, "error"]),
    runId,
    sourcePlatform: sourcePlatformForUrl(canonicalUrl),
    sourceUrl: canonicalUrl,
    url: seedUrl,
    canonicalUrl,
    sourceQuery: query.text,
    sourceId: seedUrl,
    title: `Public source fetch failed: ${query.sourceName ?? canonicalUrl}`,
    snippet: error instanceof Error ? error.message : String(error),
    discoveredAt: now.toISOString(),
    evidence: [query.text],
    status: "error",
    rejectionReason: "public_source_fetch_failed",
    sourceName: query.sourceName,
    sourceType: query.sourceType ?? "organizer_site",
    sourceScore: 0
  };
}

function sourcePlatformForUrl(url: string): SourcePlatform {
  if (isLumaUrl(url)) return "luma";
  if (isMeetupUrl(url)) return "meetup";
  if (isEventbriteUrl(url)) return "eventbrite";
  return "web";
}

function absolutizeUrl(url: string, baseUrl: string): string | undefined {
  if (!url || url.startsWith("mailto:") || url.startsWith("tel:") || url.startsWith("javascript:")) return undefined;
  try {
    return new URL(url, baseUrl).toString();
  } catch {
    return undefined;
  }
}

function hasEventPathSignal(url: string): boolean {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.toLowerCase();
    return /(event|events|calendar|rsvp|register|tickets|startup-school|after-hours)/.test(path);
  } catch {
    return false;
  }
}

function maxCandidateLinksForQuery(query: QuerySpec): number {
  return Math.max(1, Math.min(100, query.maxCandidateLinks ?? DEFAULT_MAX_LINKS_PER_SOURCE));
}

function sourceScoreForQuery(
  query: QuerySpec,
  candidate: Pick<CandidateUrl, "canonicalUrl" | "title" | "snippet">,
  profile: ScoutProfile
): number {
  return Math.max(scoreCandidateSignal(candidate, profile), query.sourceScore ?? 0);
}

function extractTitle(html: string): string | undefined {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  return title ? decodeEntities(stripTags(title)).trim() : undefined;
}

function textSnippet(html: string): string {
  return decodeEntities(stripTags(html)).replace(/\s+/g, " ").trim().slice(0, 500);
}

function stripTags(value: string): string {
  return value.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ");
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}
