import assert from "node:assert/strict";
import test from "node:test";
import { loadEnv, type AppEnv, type RawCandidate } from "@event-scout/shared";
import { extractEventFromCandidate } from "./extract-event.js";
import { fetchCandidatePage } from "./fetch-page.js";
import { fetchWithFirecrawl } from "./firecrawl.js";
import { extractEventWithLlm, pageForPrompt } from "./llm.js";

test("extractEventFromCandidate returns a structured event in mock mode", async () => {
  const env = mockEnv();
  const candidate: RawCandidate = {
    id: "candidate-1",
    sourcePlatform: "mock",
    sourceUrl: "https://lu.ma/mock",
    title: "AI Builders Dinner SF",
    snippet: "Approval required dinner for AI agent founders.",
    discoveredAt: new Date("2026-08-22T12:00:00Z").toISOString(),
    evidence: ["approval", "AI founders"]
  };

  const event = await extractEventFromCandidate({ candidate, env });

  assert.ok(event);
  assert.equal(event.id, "candidate-1");
  assert.equal(event.registrationStatus, "approval_required");
  assert.equal(event.locationPrecision, "city_only");
  assert.ok(event.confidence > 0);
});

function mockEnv(): AppEnv {
  return loadEnv({ MOCK_MODE: "true" });
}

test("real mode without an LLM extracts nothing instead of inventing an event", async () => {
  const candidate: RawCandidate = {
    id: "candidate-real",
    sourcePlatform: "luma",
    sourceUrl: "https://lu.ma/some-event",
    title: "Founder Dinner",
    snippet: "Approval required dinner for AI founders.",
    discoveredAt: new Date("2026-08-22T12:00:00Z").toISOString(),
    evidence: []
  };
  const page = {
    url: "https://lu.ma/some-event",
    canonicalUrl: "https://lu.ma/some-event",
    fetchMethod: "fetch" as const,
    status: "ok" as const,
    text: "Founder Dinner. Approval required.",
    fetchedAt: new Date().toISOString()
  };

  assert.equal(await extractEventWithLlm({ candidate, page, env: loadEnv({ MOCK_MODE: "false" }) }), null);
  assert.ok(await extractEventWithLlm({ candidate, page, env: loadEnv({ MOCK_MODE: "true" }) }));
});

test("real mode without a Firecrawl key fetches the real page instead of a placeholder", async () => {
  const env = loadEnv({ MOCK_MODE: "false" });
  const firecrawl = await fetchWithFirecrawl({ url: "https://lu.ma/some-event" }, env);
  assert.equal(firecrawl.status, "error");
  assert.equal(firecrawl.text, "");

  const originalFetch = globalThis.fetch;
  const requested: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    requested.push(String(input instanceof Request ? input.url : input));
    return new Response("<html><title>Real Event</title><body><main>The real event page text about a founder dinner.</main></body></html>");
  }) as typeof fetch;
  try {
    const page = await fetchCandidatePage(
      {
        candidate: {
          id: "candidate-page",
          sourcePlatform: "luma",
          sourceUrl: "https://lu.ma/some-event",
          title: "Some Event",
          snippet: "",
          discoveredAt: new Date().toISOString(),
          evidence: []
        }
      },
      env
    );
    assert.equal(page.fetchMethod, "fetch");
    assert.match(page.text, /real event page text/);
    assert.deepEqual(requested, ["https://lu.ma/some-event"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("the extraction prompt carries the page text once, without Firecrawl's uncapped markdown copy", () => {
  const page = {
    url: "https://lu.ma/some-event",
    canonicalUrl: "https://lu.ma/some-event",
    fetchMethod: "firecrawl" as const,
    status: "ok" as const,
    text: "Founder Dinner. Approval required.",
    markdown: "# Founder Dinner\n\nApproval required. ".repeat(500),
    fetchedAt: new Date().toISOString()
  };
  const promptPage = pageForPrompt(page);
  assert.equal(promptPage?.text, page.text);
  assert.equal("markdown" in (promptPage ?? {}), false);
  assert.equal(pageForPrompt(undefined), null);
});
