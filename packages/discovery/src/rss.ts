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

interface FeedEntry {
  title: string;
  link: string;
  summary: string;
  publishedAt?: string;
}

export async function runRssDiscovery(
  runId: string,
  queryPack: QuerySpec[],
  env: AppEnv,
  options: ConnectorOptions = {}
): Promise<CandidateUrl[]> {
  const now = options.now ?? new Date();
  const profile = env.profile;
  const fetchImpl = options.fetchImpl ?? fetch;
  const queries = queryPack.filter((query) => query.connector === "rss");

  if (env.mockMode) {
    return queries.map((query, index) => mockRssCandidate(runId, query, now, index, profile));
  }

  const candidates: CandidateUrl[] = [];
  for (const query of queries) {
    const feedUrls = (query.seedUrls ?? []).slice(0, Math.max(1, query.maxResults));
    for (const feedUrl of feedUrls) {
      let response: Response;
      try {
        response = await fetchWithTimeout(
          fetchImpl,
          feedUrl,
          {
            headers: {
              "User-Agent": "bay-event-scout/0.1 (+https://example.local/event-scout)",
              Accept: "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5"
            }
          },
          env.timeouts.pageFetchMs,
          `rss feed ${query.id}`
        );
      } catch (error) {
        candidates.push(errorCandidate(runId, query, feedUrl, now, error));
        continue;
      }

      const body = await response.text().catch(() => "");
      if (!response.ok) {
        candidates.push(errorCandidate(runId, query, feedUrl, now, `HTTP ${response.status}`));
        continue;
      }

      const entries = parseFeedEntries(body).slice(0, Math.max(1, query.maxResults));
      if (entries.length === 0) {
        candidates.push(errorCandidate(runId, query, feedUrl, now, "No feed entries parsed"));
        continue;
      }

      for (const entry of entries) {
        for (const candidateUrl of candidateUrlsForFeedEntry(entry)) {
          const canonicalUrl = normalizeCandidateUrl(candidateUrl);
          const title = entry.title || `Feed item from ${query.sourceName ?? feedUrl}`;
          const snippet = entry.summary;
          const rejectionReason = classifyRejectionReason({ canonicalUrl, title, snippet }, { now, profile });
          candidates.push({
            id: stableId([runId, query.id, feedUrl, canonicalUrl, entry.publishedAt ?? ""]),
            runId,
            sourcePlatform: sourcePlatformForUrl(canonicalUrl),
            sourceUrl: entry.link,
            url: candidateUrl,
            canonicalUrl,
            sourceQuery: query.text,
            sourceId: feedUrl,
            title,
            snippet,
            discoveredAt: entry.publishedAt ?? now.toISOString(),
            evidence: [query.text, feedUrl, entry.link],
            status: rejectionReason ? "rejected" : "new",
            rejectionReason,
            sourceName: query.sourceName,
            sourceType: query.sourceType ?? "newsletter",
            sourceScore: sourceScoreForQuery(query, { canonicalUrl, title, snippet }, profile)
          });
        }
      }
    }
  }

  return candidates;
}

export function parseFeedEntries(xml: string): FeedEntry[] {
  const items = extractBlocks(xml, "item");
  if (items.length > 0) {
    return items.map((item) => ({
      title: textForTag(item, "title") ?? "Untitled feed item",
      link: textForTag(item, "link") ?? "",
      summary: textForTag(item, "description") ?? textForTag(item, "content:encoded") ?? "",
      publishedAt: textForTag(item, "pubDate")
    })).filter((entry) => entry.link);
  }

  return extractBlocks(xml, "entry").map((entry) => ({
    title: textForTag(entry, "title") ?? "Untitled feed entry",
    link: atomLink(entry) ?? textForTag(entry, "id") ?? "",
    summary: textForTag(entry, "summary") ?? textForTag(entry, "content") ?? "",
    publishedAt: textForTag(entry, "updated") ?? textForTag(entry, "published")
  })).filter((entry) => entry.link);
}

function candidateUrlsForFeedEntry(entry: FeedEntry): string[] {
  const embeddedUrls = extractUrlsFromText(entry.summary).filter((url) => isKnownEventPlatformUrl(url) && !isNonEventLink(url));
  const urls = embeddedUrls.length > 0 ? embeddedUrls : [entry.link];
  return [...new Set(urls)];
}

function mockRssCandidate(runId: string, query: QuerySpec, now: Date, index: number, profile: ScoutProfile): CandidateUrl {
  const feedUrl = query.seedUrls?.[0] ?? "https://example.com/feed";
  const canonicalUrl = normalizeCandidateUrl(`https://lu.ma/mock-rss-event-${index}`);
  const title = `Mock RSS event from ${query.sourceName ?? "newsletter"}`;
  const snippet = "Newsletter roundup linked an approval-required AI builders dinner in San Francisco.";
  return {
    id: stableId([runId, query.id, canonicalUrl]),
    runId,
    sourcePlatform: "luma",
    sourceUrl: feedUrl,
    url: canonicalUrl,
    canonicalUrl,
    sourceQuery: query.text,
    sourceId: feedUrl,
    title,
    snippet,
    discoveredAt: now.toISOString(),
    evidence: ["mock rss", query.text],
    status: "new",
    sourceName: query.sourceName,
    sourceType: query.sourceType ?? "newsletter",
    sourceScore: sourceScoreForQuery(query, { canonicalUrl, title, snippet }, profile)
  };
}

function errorCandidate(runId: string, query: QuerySpec, feedUrl: string, now: Date, error: unknown): CandidateUrl {
  const canonicalUrl = normalizeCandidateUrl(feedUrl);
  return {
    id: stableId([runId, query.id, canonicalUrl, "rss-error"]),
    runId,
    sourcePlatform: "web",
    sourceUrl: canonicalUrl,
    url: feedUrl,
    canonicalUrl,
    sourceQuery: query.text,
    sourceId: feedUrl,
    title: `RSS feed failed: ${query.sourceName ?? canonicalUrl}`,
    snippet: error instanceof Error ? error.message : String(error),
    discoveredAt: now.toISOString(),
    evidence: [query.text],
    status: "error",
    rejectionReason: "rss_feed_failed",
    sourceName: query.sourceName,
    sourceType: query.sourceType ?? "newsletter",
    sourceScore: 0
  };
}

function sourcePlatformForUrl(url: string): SourcePlatform {
  if (isLumaUrl(url)) return "luma";
  if (isMeetupUrl(url)) return "meetup";
  if (isEventbriteUrl(url)) return "eventbrite";
  return "web";
}

function sourceScoreForQuery(
  query: QuerySpec,
  candidate: Pick<CandidateUrl, "canonicalUrl" | "title" | "snippet">,
  profile: ScoutProfile
): number {
  return Math.max(scoreCandidateSignal(candidate, profile), query.sourceScore ?? 0);
}

function extractBlocks(xml: string, tag: string): string[] {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...xml.matchAll(new RegExp(`<${escaped}\\b[^>]*>([\\s\\S]*?)<\\/${escaped}>`, "gi"))].map((match) => match[1] ?? "");
}

function textForTag(xml: string, tag: string): string | undefined {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const value = xml.match(new RegExp(`<${escaped}\\b[^>]*>([\\s\\S]*?)<\\/${escaped}>`, "i"))?.[1];
  return value ? cleanXmlText(value) : undefined;
}

function atomLink(xml: string): string | undefined {
  const href = xml.match(/<link\b[^>]*href=["']([^"']+)["'][^>]*>/i)?.[1];
  return href ? decodeEntities(href) : undefined;
}

function cleanXmlText(value: string): string {
  return decodeEntities(value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}
