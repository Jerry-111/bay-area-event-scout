import { fetchWithTimeout, type AppEnv, type RawCandidate } from "@event-scout/shared";
import { fetchWithFirecrawl, htmlToPlainText, trimPageText } from "./firecrawl.js";
import type { FetchedPage } from "./schemas.js";

export interface FetchPageInput {
  candidate: RawCandidate;
  preferFirecrawl?: boolean;
}

export async function fetchCandidatePage(
  input: FetchPageInput,
  env: AppEnv
): Promise<FetchedPage> {
  const fetchUrl = input.candidate.url || input.candidate.sourceUrl;
  if (input.preferFirecrawl !== false && (env.mockMode || env.firecrawlApiKey)) {
    const firecrawlPage = await fetchWithFirecrawl({ url: fetchUrl }, env);
    if (firecrawlPage.status === "ok" && firecrawlPage.text.trim().length > 80) {
      return firecrawlPage;
    }
  }

  return fetchPlainPage(fetchUrl, env);
}

export async function fetchPlainPage(url: string, env: AppEnv): Promise<FetchedPage> {
  if (env.mockMode) {
    return {
      url,
      canonicalUrl: url,
      fetchMethod: "mock",
      status: "ok",
      title: "Mock fallback event page",
      text: "Approval required salon for AI product builders in SF. Hosted by credible founders.",
      fetchedAt: new Date().toISOString()
    };
  }

  try {
    const response = await fetchWithTimeout(
      fetch,
      url,
      {
        headers: {
          "User-Agent": "bay-event-scout/0.1 (+https://example.local/event-scout)",
          Accept: "text/html, text/plain;q=0.9, */*;q=0.8"
        }
      },
      env.timeouts.pageFetchMs,
      `plain fetch ${url}`
    );

    const body = await response.text();
    const title = extractTitle(body);
    const canonicalUrl = extractCanonicalUrl(body, url);
    const readableText = extractReadableText(body);

    return {
      url,
      canonicalUrl,
      fetchMethod: "fetch",
      status: response.ok ? "ok" : "error",
      title,
      text: trimPageText(readableText),
      error: response.ok ? undefined : `Plain fetch failed with HTTP ${response.status}`,
      fetchedAt: new Date().toISOString()
    };
  } catch (error) {
    return {
      url,
      canonicalUrl: url,
      fetchMethod: "fetch",
      status: "error",
      text: "",
      error: error instanceof Error ? error.message : String(error),
      fetchedAt: new Date().toISOString()
    };
  }
}

export function extractReadableText(html: string): string {
  const mainMatch =
    html.match(/<main[\s\S]*?<\/main>/i) ??
    html.match(/<article[\s\S]*?<\/article>/i) ??
    html.match(/<body[\s\S]*?<\/body>/i);

  return htmlToPlainText(mainMatch?.[0] ?? html);
}

function extractTitle(html: string): string | undefined {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  return title ? htmlToPlainText(title) : undefined;
}

function extractCanonicalUrl(html: string, fallback: string): string {
  const canonical = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i)?.[1];
  if (!canonical) return fallback;

  try {
    return new URL(canonical, fallback).toString();
  } catch {
    return fallback;
  }
}
