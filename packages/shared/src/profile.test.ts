import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_PROFILE,
  findKeywordMatches,
  listProfilePresets,
  loadEnv,
  loadProfile,
  parseProfile,
  readProfileFile,
  resolveLlmConfig,
  searchExclusions
} from "./index.js";

const here = dirname(fileURLToPath(import.meta.url));

test("the consumer-ai-founder preset matches the built-in default profile", () => {
  const preset = loadProfile({ cwd: here, env: { SCOUT_PROFILE: "consumer-ai-founder" } });
  assert.equal(preset.source, "profiles/consumer-ai-founder.yaml");
  assert.deepEqual(preset.profile, DEFAULT_PROFILE);
});

test("every preset in profiles/ is a valid profile", () => {
  const presets = listProfilePresets(here);
  assert.ok(presets.includes("b2b-saas-founder"));
  assert.ok(presets.includes("fintech"));
  assert.ok(presets.includes("climate-tech"));
  for (const name of presets) {
    const { profile } = loadProfile({ cwd: here, env: { SCOUT_PROFILE: name } });
    assert.equal(profile.name, name);
    assert.ok(profile.thresholds.review < profile.thresholds.recommend);
  }
});

test("without SCOUT_PROFILE or scout.profile.yaml the built-in default is used", () => {
  const empty = mkdtempSync(join(tmpdir(), "scout-empty-"));
  const selection = loadProfile({ cwd: empty, env: {} });
  assert.equal(selection.profile, DEFAULT_PROFILE);
  assert.match(selection.source, /built-in default/);
});

test("scout.profile.yaml is found from nested directories and minimal profiles get neutral defaults", () => {
  const root = mkdtempSync(join(tmpdir(), "scout-profile-"));
  const nested = join(root, "apps", "worker");
  mkdirSync(nested, { recursive: true });
  writeFileSync(
    join(root, "scout.profile.yaml"),
    [
      "persona: a climate tech founder",
      "topics:",
      "  - name: Climate",
      "    weight: 8",
      "    keywords: [climate, energy, carbon]",
      "search:",
      "  phrases: [climate founders]"
    ].join("\n")
  );

  const { profile, source } = loadProfile({ cwd: nested, env: {} });
  assert.equal(source, "scout.profile.yaml");
  assert.equal(profile.name, "custom");
  assert.equal(profile.region.name, "SF Bay Area");
  assert.deepEqual(profile.exclude.formats, []);
  assert.deepEqual(profile.hubs, []);
  assert.deepEqual(profile.thresholds, { recommend: 80, review: 65 });
});

test("profile errors name the offending field", () => {
  assert.throws(
    () => parseProfile({ persona: "x", search: { phrases: [] }, topic: [] }, "test"),
    /search\.phrases: add at least one phrase[\s\S]*Unrecognized key: "topic"/
  );
  assert.throws(
    () => parseProfile({ persona: "x", search: { phrases: ["a"] }, thresholds: { recommend: 60, review: 70 } }, "test"),
    /thresholds\.review must be lower than thresholds\.recommend/
  );
  assert.throws(
    () => parseProfile({ persona: "x", search: { phrases: ["a"] }, sources: { add: [{ name: "Feed", kind: "rss_feed" }] } }, "test"),
    /rss_feed sources need a feed URL/
  );
});

test("profile schema caps sizes no human-written profile would hit, with readable errors", () => {
  const base = { persona: "x", search: { phrases: ["a"] } };

  assert.throws(
    () => parseProfile({ ...base, persona: "x".repeat(1001) }, "test"),
    /persona must be 1000 characters or fewer/
  );
  assert.doesNotThrow(() => parseProfile({ ...base, persona: "x".repeat(1000) }, "test"));

  assert.throws(
    () => parseProfile({ ...base, topics: Array.from({ length: 51 }, (_, i) => ({ name: `t${i}`, keywords: ["k"] })) }, "test"),
    /list at most 50 topics/
  );
  assert.doesNotThrow(() =>
    parseProfile({ ...base, topics: Array.from({ length: 50 }, (_, i) => ({ name: `t${i}`, keywords: ["k"] })) }, "test")
  );

  assert.throws(
    () =>
      parseProfile(
        { ...base, topics: [{ name: "t", keywords: Array.from({ length: 101 }, (_, i) => `k${i}`) }] },
        "test"
      ),
    /list at most 100 keywords per topic/
  );

  for (const field of ["audience", "hubs"] as const) {
    assert.throws(
      () => parseProfile({ ...base, [field]: Array.from({ length: 201 }, (_, i) => `v${i}`) }, "test"),
      /list at most 200 entries/
    );
  }

  assert.throws(
    () => parseProfile({ ...base, exclude: { formats: Array.from({ length: 201 }, (_, i) => `f${i}`) } }, "test"),
    /list at most 200 entries/
  );

  assert.throws(
    () => parseProfile({ ...base, search: { phrases: Array.from({ length: 201 }, (_, i) => `p${i}`) } }, "test"),
    /list at most 200 search phrases/
  );
  assert.throws(
    () => parseProfile({ ...base, search: { phrases: ["a"], rooms: Array.from({ length: 201 }, (_, i) => `r${i}`) } }, "test"),
    /list at most 200 search room phrases/
  );

  assert.throws(
    () => parseProfile({ ...base, notes: Array.from({ length: 51 }, (_, i) => `n${i}`) }, "test"),
    /list at most 50 notes/
  );
  assert.doesNotThrow(() => parseProfile({ ...base, notes: Array.from({ length: 50 }, (_, i) => `n${i}`) }, "test"));
});

test("an unknown SCOUT_PROFILE lists the available presets", () => {
  assert.throws(() => loadProfile({ cwd: here, env: { SCOUT_PROFILE: "nope" } }), /fintech/);
});

test("readProfileFile explains YAML syntax errors", () => {
  const dir = mkdtempSync(join(tmpdir(), "scout-bad-"));
  const path = join(dir, "bad.yaml");
  writeFileSync(path, "persona: [unclosed");
  assert.throws(() => readProfileFile(path), /Could not read scout profile/);
});

test("keyword matching uses whole words, ignores punctuation, and tolerates plurals", () => {
  assert.deepEqual(findKeywordMatches("Founders dinner", ["founder"]), ["founder"]);
  assert.deepEqual(findKeywordMatches("Consumer-facing AI", ["consumer facing"]), ["consumer facing"]);
  assert.deepEqual(findKeywordMatches("Tickets on sale now", ["sales"]), []);
  assert.deepEqual(findKeywordMatches("Said the agent", ["ai"]), []);
  assert.deepEqual(findKeywordMatches("For Series A+ founders only", ["series a+"]), ["series a+"]);
});

test("searchExclusions turns excluded formats into search operators", () => {
  assert.deepEqual(searchExclusions(DEFAULT_PROFILE), ["-hackathon", "-buildathon", "-webinar"]);
  assert.deepEqual(
    searchExclusions({ ...DEFAULT_PROFILE, exclude: { ...DEFAULT_PROFILE.exclude, formats: ["hack night"] } }),
    ['-"hack night"']
  );
});

test("an LLM provider is only used when LLM_PROVIDER selects it", () => {
  const unselected = resolveLlmConfig({ OPENAI_API_KEY: "sk-test", ANTHROPIC_API_KEY: "sk-ant" });
  assert.equal(unselected.enabled, false);
  assert.equal(unselected.provider, "none");

  const openai = resolveLlmConfig({ LLM_PROVIDER: "openai", OPENAI_API_KEY: "sk-test" });
  assert.equal(openai.enabled, true);
  assert.equal(openai.apiKey, "sk-test");
  assert.equal(openai.baseUrl, "https://api.openai.com/v1");

  const anthropic = resolveLlmConfig({ LLM_PROVIDER: "anthropic", LLM_API_KEY: "key", LLM_SCORE_MODEL: "claude-opus-5" });
  assert.equal(anthropic.apiStyle, "anthropic");
  assert.equal(anthropic.models.extract, "claude-haiku-4-5");
  assert.equal(anthropic.models.score, "claude-opus-5");
  assert.equal(anthropic.models.fast, "claude-haiku-4-5");
  assert.equal(anthropic.maxTokens, 16000);
});

test("custom OpenAI-compatible endpoints need a base URL and model but no key", () => {
  assert.equal(resolveLlmConfig({ LLM_PROVIDER: "openai-compatible" }).enabled, false);
  const local = resolveLlmConfig({ LLM_PROVIDER: "openai-compatible", LLM_BASE_URL: "http://localhost:8000/v1/", LLM_MODEL: "local" });
  assert.equal(local.enabled, true);
  assert.equal(local.baseUrl, "http://localhost:8000/v1");
  assert.equal(local.models.extract, "local");
});

test("deprecated QWEN_* variables keep working", () => {
  const legacy = resolveLlmConfig({
    DASHSCOPE_API_KEY: "key",
    QWEN_BASE_URL: "https://workspace.example.com/api/v2/apps/protocols/compatible-mode/v1",
    QWEN_FAST_MODEL: "qwen-fast"
  });
  assert.equal(legacy.legacyQwenEnv, true);
  assert.equal(legacy.provider, "dashscope");
  assert.equal(legacy.apiStyle, "responses");
  assert.equal(legacy.baseUrl, "https://workspace.example.com/compatible-mode/v1");
  assert.equal(legacy.models.fast, "qwen-fast");
  assert.equal(legacy.models.score, "qwen3.7-plus");
  assert.equal(loadEnv({ QWEN_TIMEOUT_MS: "12000" }).timeouts.llmMs, 12000);
});

test("invalid LLM settings fail loudly", () => {
  assert.throws(() => resolveLlmConfig({ LLM_PROVIDER: "not-a-provider" }), /not supported/);
  assert.throws(() => resolveLlmConfig({ LLM_PROVIDER: "openai", LLM_EXTRA_BODY: "[1]" }), /LLM_EXTRA_BODY/);
  assert.throws(() => resolveLlmConfig({ LLM_PROVIDER: "openai", LLM_API_STYLE: "grpc" }), /LLM_API_STYLE/);
});
