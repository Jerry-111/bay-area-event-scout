import assert from "node:assert/strict";
import test from "node:test";
import { classifyEventWindowRejection, loadEnv, type RawCandidate } from "@event-scout/shared";
import { processCandidatesWithStats, toSharedEventCandidate } from "./index.js";
import type { ExtractedEvent, StructuredEventScore } from "./schemas.js";

test("toSharedEventCandidate preserves missing startAt", () => {
  const event = eventFixture();
  const shared = toSharedEventCandidate({ ...event, startAt: undefined }, scoreFixture(event.id));

  assert.equal(shared.startAt, undefined);
});

test("classifyEventWindowRejection explains page-level date gate decisions", () => {
  const now = new Date("2026-08-23T12:00:00-07:00");

  assert.equal(classifyEventWindowRejection({}, { now }), "missing_date");
  assert.equal(classifyEventWindowRejection({ startAt: "not-a-date" }, { now }), "invalid_date");
  assert.equal(classifyEventWindowRejection({ startAt: "2026-08-22T19:00:00.000Z" }, { now }), "past_event");
  assert.equal(classifyEventWindowRejection({ startAt: "2026-10-01T19:00:00.000Z" }, { now }), "too_far_future");
  assert.equal(classifyEventWindowRejection({ startAt: "2026-09-01T19:00:00.000Z" }, { now }), undefined);
});

function eventFixture(): ExtractedEvent {
  return {
    id: "event-1",
    canonicalUrl: "https://lu.ma/event-1",
    sourceUrls: ["https://lu.ma/event-1"],
    title: "AI Builders Dinner",
    description: "Small dinner for AI builders.",
    startAt: "2026-08-25T02:00:00.000Z",
    timezone: "America/Los_Angeles",
    city: "San Francisco",
    locationPrecision: "city_only",
    hosts: ["Host A"],
    organizers: ["Host A"],
    platforms: ["luma"],
    visibilityFlags: ["approval_required"],
    registrationStatus: "approval_required",
    eventType: "dinner",
    confidence: 0.8
  };
}

function scoreFixture(eventId: string): StructuredEventScore {
  return {
    eventId,
    totalScore: 88,
    userFit: 23,
    roomQuality: 18,
    networkingValue: 14,
    timeliness: 8,
    locationActionability: 9,
    novelty: 8,
    evidenceConfidence: 8,
    penalties: [],
    shouldRecommend: true,
    rationale: "Strong AI/founder fit",
    nextAction: "apply"
  };
}

const EVENT_PAGE_HTML =
  "<main>AI Founders Dinner in San Francisco on October 15, 2026 at 6pm. Approval required; for founders, operators, and investors.</main>";

function pageCandidates(count: number): RawCandidate[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `candidate-${index}`,
    sourcePlatform: "web" as const,
    sourceUrl: `https://example.com/event-${index}`,
    title: "AI Founders Dinner",
    snippet: "October 15 in San Francisco",
    discoveredAt: "2026-09-18T12:00:00Z",
    evidence: []
  }));
}

function realLlmEnv(overrides: NodeJS.ProcessEnv = {}) {
  return loadEnv({
    MOCK_MODE: "false",
    LLM_PROVIDER: "dashscope",
    LLM_API_KEY: "test",
    MAX_FIRECRAWL_PAGES_PER_RUN: "0",
    ...overrides
  });
}

/** Stubs fetch: LLM calls get `llmResponse(prompt)`, anything else gets an event page. Counts page loads. */
function stubFetch(
  t: { mock: { method: (...args: any[]) => unknown } },
  llmResponse: (prompt: string) => Response
): { pageLoads: () => number } {
  let pageLoads = 0;
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes("/chat/completions")) {
      const body = JSON.parse(String(init?.body ?? "{}")) as { messages?: Array<{ content?: string }> };
      return llmResponse(body.messages?.[0]?.content ?? "");
    }
    pageLoads += 1;
    return new Response(EVENT_PAGE_HTML, { headers: { "content-type": "text/html" } });
  });
  return { pageLoads: () => pageLoads };
}

test("a provider that refuses requests stops the scan early instead of failing every page", async (t) => {
  const fetches = stubFetch(t, () =>
    new Response(JSON.stringify({ code: "AccessDenied.Unpurchased", message: "Access to model denied" }), { status: 403 })
  );
  await assert.rejects(
    processCandidatesWithStats(pageCandidates(12), realLlmEnv({ MAX_LLM_EXTRACT_CONCURRENCY: "2" })),
    /stopped this scan while reading event pages \(HTTP 403\).*AccessDenied\.Unpurchased: Access to model denied/
  );
  assert.equal(fetches.pageLoads(), 2, "only the two pages already in flight were loaded");
});

test("repeated rate limiting stops the scan after a few pages", async (t) => {
  const fetches = stubFetch(t, () =>
    new Response(JSON.stringify({ error: { message: "Rate limit reached" } }), { status: 429, headers: { "retry-after": "0" } })
  );
  await assert.rejects(
    processCandidatesWithStats(pageCandidates(10), realLlmEnv({ MAX_LLM_EXTRACT_CONCURRENCY: "1" })),
    /kept rate-limiting requests or is out of quota/
  );
  assert.equal(fetches.pageLoads(), 3);
});

test("a scan where every page fails ends with an error instead of zero events", async (t) => {
  stubFetch(t, () => new Response(JSON.stringify({ choices: [{ message: { content: "not json at all" } }] })));
  await assert.rejects(
    processCandidatesWithStats(pageCandidates(3), realLlmEnv({ MAX_LLM_EXTRACT_CONCURRENCY: "3" })),
    /Could not read any of the 3 event pages this scan/
  );
});

test("one unreadable page does not stop the scan, and pages are read in parallel", async (t) => {
  const extracted = JSON.stringify({
    id: "evt",
    canonicalUrl: "https://example.com/event-1",
    sourceUrls: ["https://example.com/event-1"],
    title: "AI Founders Dinner",
    startAt: "2026-10-15T18:00:00-07:00",
    timezone: "America/Los_Angeles",
    city: "San Francisco",
    locationPrecision: "city_only",
    hosts: ["Host"],
    organizers: [],
    platforms: ["web"],
    visibilityFlags: [],
    registrationStatus: "approval_required",
    eventType: "dinner",
    confidence: 0.8
  });
  // candidate-0's page never yields JSON (nor does the repair call that follows); candidate-1's does.
  stubFetch(t, (prompt) => {
    const unreadable = prompt.includes("candidate-0") || prompt.includes("not json at all");
    return new Response(JSON.stringify({ choices: [{ message: { content: unreadable ? "not json at all" : extracted } }] }));
  });
  const result = await processCandidatesWithStats(
    pageCandidates(2),
    realLlmEnv({ MAX_LLM_EXTRACT_CONCURRENCY: "2", MAX_LLM_SCORE_EVENTS_PER_RUN: "0" })
  );
  assert.equal(result.stats.candidatesAttempted, 2);
  assert.equal(result.stats.extractConcurrency, 2);
  assert.equal(result.stats.rawEventsExtracted, 1);
});
