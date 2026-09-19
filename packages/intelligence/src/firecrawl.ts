import { fetchWithTimeout, type AppEnv } from "@event-scout/shared";
import type { FetchedPage } from "./schemas.js";

export interface FirecrawlFetchInput {
  url: string;
  timeoutMs?: number;
}

interface FirecrawlScrapeResponse {
  success?: boolean;
  data?: {
    metadata?: {
      title?: string;
      sourceURL?: string;
      url?: string;
    };
    markdown?: string;
    content?: string;
    html?: string;
  };
  error?: string;
}

const FIRECRAWL_API_URL = "https://api.firecrawl.dev/v1/scrape";

export async function fetchWithFirecrawl(
  input: FirecrawlFetchInput,
  env: AppEnv
): Promise<FetchedPage> {
  if (!env.mockMode && !env.firecrawlApiKey) {
    // Real mode without a key: report an error so callers fall back to a plain fetch.
    return {
      url: input.url,
      canonicalUrl: input.url,
      fetchMethod: "firecrawl",
      status: "error",
      text: "",
      error: "FIRECRAWL_API_KEY is not set",
      fetchedAt: new Date().toISOString()
    };
  }

  if (env.mockMode) {
    return {
      url: input.url,
      canonicalUrl: input.url,
      fetchMethod: "mock",
      status: "ok",
      title: "Mock fetched event page",
      text: "Small approval-based AI builders dinner in San Francisco for founders and operators.",
      markdown:
        "# Mock fetched event page\n\nSmall approval-based AI builders dinner in San Francisco for founders and operators.",
      fetchedAt: new Date().toISOString()
    };
  }

  try {
    const response = await fetchWithTimeout(
      fetch,
      FIRECRAWL_API_URL,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.firecrawlApiKey}`
        },
        body: JSON.stringify({
          url: input.url,
          formats: ["markdown", "html"],
          onlyMainContent: true,
          waitFor: 1000
        })
      },
      input.timeoutMs ?? env.timeouts.firecrawlMs,
      `Firecrawl scrape ${input.url}`
    );

    const payload = (await response.json().catch(() => ({}))) as FirecrawlScrapeResponse;
    if (!response.ok || payload.success === false) {
      return {
        url: input.url,
        canonicalUrl: input.url,
        fetchMethod: "firecrawl",
        status: "error",
        text: "",
        error: payload.error ?? `Firecrawl scrape failed with HTTP ${response.status}`,
        fetchedAt: new Date().toISOString()
      };
    }

    const metadata = payload.data?.metadata;
    const markdown = payload.data?.markdown;
    const text = payload.data?.content ?? markdown ?? htmlToPlainText(payload.data?.html ?? "");

    return {
      url: input.url,
      canonicalUrl: metadata?.sourceURL ?? metadata?.url ?? input.url,
      fetchMethod: "firecrawl",
      status: "ok",
      title: metadata?.title,
      text: trimPageText(text),
      markdown,
      fetchedAt: new Date().toISOString()
    };
  } catch (error) {
    return {
      url: input.url,
      canonicalUrl: input.url,
      fetchMethod: "firecrawl",
      status: "error",
      text: "",
      error: error instanceof Error ? error.message : String(error),
      fetchedAt: new Date().toISOString()
    };
  }
}

export function htmlToPlainText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function trimPageText(text: string, maxChars = 24_000): string {
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n[truncated]` : text;
}
