import assert from "node:assert/strict";
import test from "node:test";
import { loadEnv, normalizeLegacyQwenBaseUrl, type AppEnv } from "@event-scout/shared";
import { buildChatCompletionsBody, buildResponsesBody, callLlm } from "./llm-client.js";

interface CapturedRequest {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

test("legacy QWEN_* configuration keeps the Responses body that disables thinking", () => {
  const env = loadEnv({ DASHSCOPE_API_KEY: "key", QWEN_BASE_URL: "https://workspace.example.com/compatible-mode/v1" });
  const body = buildResponsesBody(env.llm, "qwen3.7-plus", "Return JSON.");

  assert.equal(env.llm.apiStyle, "responses");
  assert.equal(body.enable_thinking, false);
  assert.deepEqual(body.reasoning, { effort: "none" });
  assert.equal(body.input, "Return JSON.");
  assert.equal("extra_body" in body, false);
});

test("normalizeLegacyQwenBaseUrl migrates the legacy Responses path to the official path", () => {
  assert.equal(
    normalizeLegacyQwenBaseUrl("https://workspace.example.com/api/v2/apps/protocols/compatible-mode/v1"),
    "https://workspace.example.com/compatible-mode/v1"
  );
});

test("chat bodies carry provider extras without letting them replace the model or prompt", () => {
  const dashscope = loadEnv({ LLM_PROVIDER: "dashscope", LLM_API_KEY: "key" }).llm;
  const openai = loadEnv({
    LLM_PROVIDER: "openai",
    LLM_API_KEY: "key",
    LLM_JSON_MODE: "true",
    LLM_EXTRA_BODY: JSON.stringify({ model: "sneaky", temperature: 0.2 })
  }).llm;

  assert.equal(buildChatCompletionsBody(dashscope, "qwen-plus", "hi").enable_thinking, false);

  const body = buildChatCompletionsBody(openai, "gpt-5-mini", "hi");
  assert.equal(body.model, "gpt-5-mini");
  assert.equal(body.reasoning_effort, "low", "gpt-5 models default to low effort instead of OpenAI's medium");
  assert.equal("reasoning_effort" in buildChatCompletionsBody(openai, "gpt-4.1-mini", "hi"), false);
  const responsesStyle = loadEnv({ LLM_PROVIDER: "openai", LLM_API_KEY: "key", LLM_API_STYLE: "responses" }).llm;
  assert.deepEqual(buildResponsesBody(responsesStyle, "gpt-5-mini", "hi").reasoning, { effort: "low" });
  assert.equal("reasoning" in buildResponsesBody(responsesStyle, "gpt-4.1-mini", "hi"), false);
  assert.deepEqual(body.messages, [{ role: "user", content: "hi" }]);
  assert.deepEqual(body.response_format, { type: "json_object" });
  assert.equal(body.temperature, 0.2);
  assert.equal("enable_thinking" in body, false);
});

test("callLlm posts OpenAI-compatible chat requests and reads the message text", async () => {
  const env = realEnv({ LLM_PROVIDER: "openai-compatible", LLM_BASE_URL: "http://localhost:9999/v1/", LLM_MODEL: "local-model", LLM_API_KEY: "secret" });
  const requests = await withFetch(
    [jsonResponse({ choices: [{ message: { content: "{\"ok\":true}" } }] })],
    async () => assert.equal(await callLlm({ env, model: env.llm.models.fast, prompt: "ping" }), "{\"ok\":true}")
  );

  assert.equal(requests[0]?.url, "http://localhost:9999/v1/chat/completions");
  assert.equal(requests[0]?.headers.authorization, "Bearer secret");
  assert.equal(requests[0]?.body.model, "local-model");
});

test("callLlm retries rate-limited requests", async () => {
  const env = realEnv({ LLM_PROVIDER: "deepseek", LLM_API_KEY: "key" });
  const requests = await withFetch(
    [
      new Response("slow down", { status: 429, headers: { "retry-after": "0" } }),
      jsonResponse({ choices: [{ message: { content: "done" } }] })
    ],
    async () => assert.equal(await callLlm({ env, model: "deepseek-flash", prompt: "ping" }), "done")
  );

  assert.equal(requests.length, 2);
  assert.equal(requests[0]?.url, "https://api.deepseek.com/chat/completions");
});

test("callLlm surfaces provider errors with the provider and model", async () => {
  const env = realEnv({ LLM_PROVIDER: "openai", OPENAI_API_KEY: "key" });
  await withFetch([jsonResponse({ error: { message: "model not found" } }, 404)], async () => {
    await assert.rejects(callLlm({ env, model: "gpt-missing", prompt: "ping" }), /openai gpt-missing failed with HTTP 404: model not found/);
  });
});

test("callLlm refuses to run when no provider is configured", async () => {
  await assert.rejects(callLlm({ env: realEnv({}), model: "any", prompt: "ping" }), /LLM_PROVIDER is not set/);
});

test("callLlm sends Anthropic Messages requests through the SDK with low effort and refusal fallbacks", async () => {
  const env = realEnv({ LLM_PROVIDER: "anthropic", ANTHROPIC_API_KEY: `key-${Date.now()}` });
  const reply = {
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: "claude-opus-5",
    content: [{ type: "text", text: "{\"score\":1}" }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 }
  };
  const requests = await withFetch(
    [jsonResponse(reply), jsonResponse({ ...reply, model: "claude-haiku-4-5" }), jsonResponse({ ...reply, model: "claude-sonnet-5" })],
    async () => {
      assert.equal(await callLlm({ env, model: "claude-opus-5", prompt: "score it" }), "{\"score\":1}");
      assert.equal(await callLlm({ env, model: env.llm.models.fast, prompt: "repair it" }), "{\"score\":1}");
      assert.equal(await callLlm({ env, model: env.llm.models.score, prompt: "score it" }), "{\"score\":1}");
    }
  );

  const [opus, haiku, sonnet] = requests;
  assert.match(opus?.url ?? "", /^https:\/\/api\.anthropic\.com\/v1\/messages/);
  assert.equal(opus?.headers["x-api-key"], env.llm.apiKey);
  assert.ok(opus?.headers["anthropic-version"]);
  assert.match(opus?.headers["anthropic-beta"] ?? "", /server-side-fallback-2026-07-01/);
  assert.equal(opus?.body.model, "claude-opus-5");
  assert.equal(opus?.body.fallbacks, "default");
  assert.equal(opus?.body.max_tokens, 16000);
  assert.deepEqual(opus?.body.output_config, { effort: "low" });

  assert.equal(haiku?.body.model, "claude-haiku-4-5");
  assert.equal("output_config" in (haiku?.body ?? {}), false);
  assert.equal("fallbacks" in (haiku?.body ?? {}), false);

  // The default scoring model gets low effort but not the Opus/Fable-only fallback beta.
  assert.equal(sonnet?.body.model, "claude-sonnet-5");
  assert.deepEqual(sonnet?.body.output_config, { effort: "low" });
  assert.equal("fallbacks" in (sonnet?.body ?? {}), false);
});

test("callLlm treats an Anthropic refusal as a failure so the next model is tried", async () => {
  const env = realEnv({ LLM_PROVIDER: "anthropic", LLM_API_KEY: `key-refusal-${Date.now()}`, LLM_MODEL: "claude-sonnet-5" });
  await withFetch(
    [
      jsonResponse({
        id: "msg_2",
        type: "message",
        role: "assistant",
        model: "claude-sonnet-5",
        content: [],
        stop_reason: "refusal",
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 0 }
      })
    ],
    async () => {
      await assert.rejects(callLlm({ env, model: "claude-sonnet-5", prompt: "score it" }), /declined the request/);
    }
  );
});

function realEnv(values: NodeJS.ProcessEnv): AppEnv {
  return loadEnv({ MOCK_MODE: "false", ...values });
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}

async function withFetch(responses: Response[], run: () => Promise<void>): Promise<CapturedRequest[]> {
  const originalFetch = globalThis.fetch;
  const requests: CapturedRequest[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const text = await request.text();
    requests.push({
      url: request.url,
      headers: Object.fromEntries(request.headers.entries()),
      body: text ? (JSON.parse(text) as Record<string, unknown>) : {}
    });
    const response = responses.shift();
    if (!response) throw new Error("Unexpected extra fetch call");
    return response;
  }) as typeof fetch;

  try {
    await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
  return requests;
}
