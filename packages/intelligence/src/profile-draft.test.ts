import assert from "node:assert/strict";
import test from "node:test";
import { loadEnv, type AppEnv } from "@event-scout/shared";
import { draftProfileYaml, editProfileYaml } from "./profile-draft.js";

const VALID_YAML = [
  "name: climate-tech-founder",
  "persona: a seed-stage climate tech founder who wants rooms with other climate founders and investors",
  "topics:",
  "  - name: Climate tech",
  "    weight: 8",
  "    keywords: [climate, clean energy, carbon removal]",
  "search:",
  "  phrases: [climate founders, climate tech founders]"
].join("\n");

const MISSING_SEARCH_YAML = ["persona: a seed-stage climate tech founder"].join("\n");

test("draftProfileYaml returns validated YAML and the parsed profile on the first attempt", async () => {
  const env = realEnv({ LLM_PROVIDER: "openai", OPENAI_API_KEY: "sk-test" });
  const requests = await withFetch([chatResponse(VALID_YAML)], async () => {
    const result = await draftProfileYaml("a seed-stage climate tech founder", env);
    assert.equal(result.profile.name, "climate-tech-founder");
    assert.deepEqual(result.profile.search.phrases, ["climate founders", "climate tech founders"]);
    assert.match(result.yaml, /persona: a seed-stage climate tech founder/);
  });
  assert.equal(requests.length, 1);
});

test("draftProfileYaml works in MOCK_MODE=true, as long as an LLM is configured", async () => {
  // Regression test: drafting is a CLI/wizard action gated on env.llm.enabled alone. It must not
  // reuse the intelligence pipeline's llmEnabled() (mockMode && llm.enabled), which would force
  // MOCK_MODE=false just to draft a profile before the user has otherwise gone live.
  const env = loadEnv({ MOCK_MODE: "true", LLM_PROVIDER: "openai", OPENAI_API_KEY: "sk-test" });
  await withFetch([chatResponse(VALID_YAML)], async () => {
    const result = await draftProfileYaml("a seed-stage climate tech founder", env);
    assert.equal(result.profile.name, "climate-tech-founder");
  });
});

test("draftProfileYaml strips Markdown code fences around the YAML", async () => {
  const env = realEnv({ LLM_PROVIDER: "openai", OPENAI_API_KEY: "sk-test" });
  await withFetch([chatResponse(`\`\`\`yaml\n${VALID_YAML}\n\`\`\``)], async () => {
    const result = await draftProfileYaml("a seed-stage climate tech founder", env);
    assert.equal(result.profile.name, "climate-tech-founder");
    assert.equal(result.yaml.includes("```"), false);
  });
});

test("draftProfileYaml extracts a fenced block that is not the whole reply", async () => {
  // Regression test: models sometimes add a sentence before or after the fence despite being
  // told not to. The old stripCodeFences only matched a fence wrapping the *entire* reply, so
  // this would previously fail to parse as YAML at all.
  const env = realEnv({ LLM_PROVIDER: "openai", OPENAI_API_KEY: "sk-test" });
  const reply = `Sure, here is the profile:\n\n\`\`\`yaml\n${VALID_YAML}\n\`\`\`\n\nLet me know if you'd like changes.`;
  await withFetch([chatResponse(reply)], async () => {
    const result = await draftProfileYaml("a seed-stage climate tech founder", env);
    assert.equal(result.profile.name, "climate-tech-founder");
    assert.equal(result.yaml.includes("```"), false);
    assert.equal(result.yaml.includes("Let me know"), false);
  });
});

test("draftProfileYaml strips a sources key the model was told not to draft, and flags it", async () => {
  const env = realEnv({ LLM_PROVIDER: "openai", OPENAI_API_KEY: "sk-test" });
  const withSources = [
    VALID_YAML,
    "sources:",
    "  add:",
    "    - name: Some calendar",
    "      kind: luma_calendar",
    "      url: https://luma.com/some-calendar"
  ].join("\n");
  await withFetch([chatResponse(withSources)], async () => {
    const result = await draftProfileYaml("a seed-stage climate tech founder", env);
    assert.equal(result.sourcesWereStripped, true);
    // The fabricated source (and everything else the model drafted for it) is gone from both the
    // validated profile and the yaml text that will be written to disk; only an empty default
    // sources object (if any) can remain, never the injected URL.
    assert.deepEqual(result.profile.sources.add, []);
    assert.equal(result.yaml.includes("luma.com/some-calendar"), false);
    assert.equal(result.yaml.includes("Some calendar"), false);
  });
});

test("draftProfileYaml leaves yaml untouched and unflagged when there is no sources key", async () => {
  const env = realEnv({ LLM_PROVIDER: "openai", OPENAI_API_KEY: "sk-test" });
  await withFetch([chatResponse(VALID_YAML)], async () => {
    const result = await draftProfileYaml("a seed-stage climate tech founder", env);
    assert.equal(result.sourcesWereStripped, false);
    assert.equal(result.yaml, VALID_YAML.trim());
  });
});

test("draftProfileYaml retries once with the validation errors fed back, then succeeds", async () => {
  const env = realEnv({ LLM_PROVIDER: "openai", OPENAI_API_KEY: "sk-test" });
  const requests = await withFetch(
    [chatResponse(MISSING_SEARCH_YAML), chatResponse(VALID_YAML)],
    async () => {
      const result = await draftProfileYaml("a seed-stage climate tech founder", env);
      assert.equal(result.profile.name, "climate-tech-founder");
    }
  );
  assert.equal(requests.length, 2);
  assert.match(requests[1]?.body.messages?.[0]?.content ?? "", /Validation errors/);
});

test("draftProfileYaml fails after one retry, reporting both errors", async () => {
  const env = realEnv({ LLM_PROVIDER: "openai", OPENAI_API_KEY: "sk-test" });
  await withFetch([chatResponse(MISSING_SEARCH_YAML), chatResponse(MISSING_SEARCH_YAML)], async () => {
    await assert.rejects(
      draftProfileYaml("a seed-stage climate tech founder", env),
      /Could not draft a valid profile after one retry/
    );
  });
});

test("draftProfileYaml refuses to call the LLM when none is configured", async () => {
  const env = realEnv({});
  await withFetch([], async () => {
    await assert.rejects(draftProfileYaml("a founder", env), /Drafting a profile needs a configured LLM/);
  });
});

test("draftProfileYaml refuses an empty description without calling the LLM", async () => {
  const env = realEnv({ LLM_PROVIDER: "openai", OPENAI_API_KEY: "sk-test" });
  await withFetch([], async () => {
    await assert.rejects(draftProfileYaml("   ", env), /Describe the person/);
  });
});

const CURRENT_WITH_SOURCES = [
  "# My preferences",
  VALID_YAML,
  "sources:",
  "  add:",
  "    - name: My favorite calendar # keep this one",
  "      kind: luma_calendar",
  "      url: https://luma.com/my-favorite-calendar"
].join("\n");

const EDITED_YAML = [
  "name: climate-tech-founder",
  "persona: a seed-stage climate tech founder who wants rooms with other climate founders and investors",
  "topics:",
  "  - name: Climate tech",
  "    weight: 8",
  "    keywords: [climate, clean energy, carbon removal]",
  "  - name: Crypto",
  "    weight: -10",
  "    keywords: [crypto, web3]",
  "search:",
  "  phrases: [climate founders, climate tech founders]"
].join("\n");

test("editProfileYaml applies the change, lists it, and never lets the model see or touch sources", async () => {
  const env = realEnv({ LLM_PROVIDER: "openai", OPENAI_API_KEY: "sk-test" });
  const modelReply = [
    EDITED_YAML,
    "sources:",
    "  add:",
    "    - name: Invented calendar",
    "      kind: luma_calendar",
    "      url: https://luma.com/invented"
  ].join("\n");
  const requests = await withFetch([chatResponse(modelReply)], async () => {
    const result = await editProfileYaml({ currentYaml: CURRENT_WITH_SOURCES, instruction: "less crypto please", env });
    assert.deepEqual(result.changes, ['Topics: added Crypto (-10): crypto, web3']);
    assert.deepEqual(
      result.profile.sources.add.map((source) => source.url),
      ["https://luma.com/my-favorite-calendar"]
    );
    assert.match(result.yaml, /# keep this one/);
    assert.equal(result.yaml.includes("invented"), false);
  });
  const prompt = requests[0]?.body.messages?.[0]?.content ?? "";
  assert.match(prompt, /less crypto please/);
  assert.match(prompt, /# My preferences/);
  assert.equal(prompt.includes("my-favorite-calendar"), false);
});

test("editProfileYaml reports no changes when the model returns the profile as it was", async () => {
  const env = realEnv({ LLM_PROVIDER: "openai", OPENAI_API_KEY: "sk-test" });
  await withFetch([chatResponse(VALID_YAML)], async () => {
    const result = await editProfileYaml({ currentYaml: VALID_YAML, instruction: "what's the weather?", env });
    assert.deepEqual(result.changes, []);
  });
});

test("editProfileYaml retries once with the validation errors, then succeeds", async () => {
  const env = realEnv({ LLM_PROVIDER: "openai", OPENAI_API_KEY: "sk-test" });
  const requests = await withFetch([chatResponse(MISSING_SEARCH_YAML), chatResponse(EDITED_YAML)], async () => {
    const result = await editProfileYaml({ currentYaml: VALID_YAML, instruction: "less crypto", env });
    assert.equal(result.changes.length, 1);
  });
  assert.equal(requests.length, 2);
  assert.match(requests[1]?.body.messages?.[0]?.content ?? "", /Validation errors/);
});

test("editProfileYaml fails after one retry and leaves the decision to the caller", async () => {
  const env = realEnv({ LLM_PROVIDER: "openai", OPENAI_API_KEY: "sk-test" });
  await withFetch([chatResponse("- just\n- a list"), chatResponse(MISSING_SEARCH_YAML)], async () => {
    await assert.rejects(
      editProfileYaml({ currentYaml: VALID_YAML, instruction: "less crypto", env }),
      /Could not produce a valid updated profile after one retry/
    );
  });
});

test("editProfileYaml checks its inputs before calling the LLM", async () => {
  const configured = realEnv({ LLM_PROVIDER: "openai", OPENAI_API_KEY: "sk-test" });
  await withFetch([], async () => {
    await assert.rejects(editProfileYaml({ currentYaml: VALID_YAML, instruction: "  ", env: configured }), /Say what you would like to change/);
    await assert.rejects(
      editProfileYaml({ currentYaml: VALID_YAML, instruction: "less crypto", env: realEnv({}) }),
      /needs a configured LLM/
    );
    await assert.rejects(
      editProfileYaml({ currentYaml: MISSING_SEARCH_YAML, instruction: "less crypto", env: configured }),
      /current profile/
    );
  });
});

function realEnv(values: NodeJS.ProcessEnv): AppEnv {
  return loadEnv({ MOCK_MODE: "false", ...values });
}

function chatResponse(content: string): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

interface CapturedRequest {
  url: string;
  body: { messages?: Array<{ content?: string }> };
}

async function withFetch(responses: Response[], run: () => Promise<void>): Promise<CapturedRequest[]> {
  const originalFetch = globalThis.fetch;
  const requests: CapturedRequest[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const text = await request.text();
    requests.push({ url: request.url, body: text ? JSON.parse(text) : {} });
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
