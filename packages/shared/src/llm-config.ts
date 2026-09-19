/**
 * LLM provider configuration. The scout talks to three API shapes:
 * - "chat": OpenAI-compatible Chat Completions (OpenAI, Gemini, DeepSeek, DashScope, OpenRouter, Ollama, vLLM, ...)
 * - "responses": OpenAI-compatible Responses API
 * - "anthropic": Anthropic Messages API (Claude)
 *
 * Pick a provider with LLM_PROVIDER. Nothing is inferred from API keys that happen to be in the
 * shell environment, so an exported OPENAI_API_KEY is never billed unless LLM_PROVIDER says so.
 */

export type LlmApiStyle = "chat" | "responses" | "anthropic";

export interface LlmModels {
  /** Page -> structured event extraction. */
  extract: string;
  /** Event scoring against the profile. */
  score: string;
  /** Search planning, JSON repair, and miss-hunt classification. */
  fast: string;
}

export interface LlmConfig {
  provider: string;
  apiStyle: LlmApiStyle;
  apiKey?: string;
  baseUrl: string;
  models: LlmModels;
  /** True when the provider has everything it needs to make real calls. */
  enabled: boolean;
  /** Why the LLM is disabled, when it is. */
  disabledReason?: string;
  maxTokens?: number;
  jsonMode: boolean;
  reasoningEffort?: string;
  /**
   * Effort sent when LLM_REASONING_EFFORT is unset, and only to models matching `modelPattern`
   * (non-reasoning models reject the parameter).
   */
  defaultReasoningEffort?: { effort: string; modelPattern: RegExp };
  /** Extra JSON merged into chat/responses request bodies (LLM_EXTRA_BODY). */
  extraBody: Record<string, unknown>;
  /** Configured through the deprecated QWEN_* / DASHSCOPE_API_KEY variables. */
  legacyQwenEnv: boolean;
}

interface LlmPreset {
  label: string;
  apiStyle: LlmApiStyle;
  baseUrl: string;
  models: LlmModels;
  /** Provider-specific key variables accepted when LLM_API_KEY is unset. */
  keyEnv: string[];
  keyOptional?: boolean;
  extraBody?: Record<string, unknown>;
  defaultReasoningEffort?: { effort: string; modelPattern: RegExp };
}

function sameModel(model: string): LlmModels {
  return { extract: model, score: model, fast: model };
}

/** Default models are suggestions; override them with LLM_MODEL or LLM_*_MODEL. */
export const LLM_PRESETS: Record<string, LlmPreset> = {
  openai: {
    label: "OpenAI",
    apiStyle: "chat",
    baseUrl: "https://api.openai.com/v1",
    models: sameModel("gpt-5-mini"),
    keyEnv: ["OPENAI_API_KEY"],
    // Without this, gpt-5 models reason at "medium": several times the output tokens and latency
    // for extraction and scoring calls that do not need it.
    defaultReasoningEffort: { effort: "low", modelPattern: /^(gpt-5|o\d)/ }
  },
  anthropic: {
    label: "Anthropic (Claude)",
    apiStyle: "anthropic",
    baseUrl: "https://api.anthropic.com",
    // Bulk page extraction runs dozens of times per scan, so it gets the cheapest model; scoring
    // decides what you see, so it gets a stronger one. Set LLM_MODEL / LLM_*_MODEL to change either.
    models: { extract: "claude-haiku-4-5", score: "claude-sonnet-5", fast: "claude-haiku-4-5" },
    keyEnv: ["ANTHROPIC_API_KEY"]
  },
  gemini: {
    label: "Google Gemini (OpenAI-compatible endpoint)",
    apiStyle: "chat",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    models: sameModel("gemini-flash-latest"),
    keyEnv: ["GEMINI_API_KEY", "GOOGLE_API_KEY"]
  },
  deepseek: {
    label: "DeepSeek",
    apiStyle: "chat",
    baseUrl: "https://api.deepseek.com",
    // "deepseek-chat" was retired on 2026-07-24; "deepseek-flash" is its current replacement.
    models: sameModel("deepseek-flash"),
    keyEnv: ["DEEPSEEK_API_KEY"]
  },
  dashscope: {
    label: "Alibaba Cloud Model Studio / DashScope (mainland China)",
    apiStyle: "chat",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    models: { extract: "qwen-plus", score: "qwen-plus", fast: "qwen-flash" },
    keyEnv: ["DASHSCOPE_API_KEY"],
    extraBody: { enable_thinking: false }
  },
  "dashscope-intl": {
    label: "Alibaba Cloud Model Studio / DashScope (international)",
    apiStyle: "chat",
    baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    models: { extract: "qwen-plus", score: "qwen-plus", fast: "qwen-flash" },
    keyEnv: ["DASHSCOPE_API_KEY"],
    extraBody: { enable_thinking: false }
  },
  openrouter: {
    label: "OpenRouter",
    apiStyle: "chat",
    baseUrl: "https://openrouter.ai/api/v1",
    models: sameModel("openai/gpt-5-mini"),
    keyEnv: ["OPENROUTER_API_KEY"]
  },
  ollama: {
    label: "Ollama (local)",
    apiStyle: "chat",
    baseUrl: "http://localhost:11434/v1",
    models: sameModel("llama3.1"),
    keyEnv: [],
    keyOptional: true
  },
  "openai-compatible": {
    label: "Any OpenAI-compatible endpoint (set LLM_BASE_URL and LLM_MODEL)",
    apiStyle: "chat",
    baseUrl: "",
    models: sameModel(""),
    keyEnv: [],
    keyOptional: true
  }
};

const LEGACY_QWEN_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1";
const LEGACY_QWEN_MODELS: LlmModels = { extract: "qwen3.7-plus", score: "qwen3.7-plus", fast: "qwen3.7-flash" };
const DEFAULT_ANTHROPIC_MAX_TOKENS = 16_000;

export function resolveLlmConfig(env: NodeJS.ProcessEnv): LlmConfig {
  const read = (key: string): string | undefined => {
    const value = env[key]?.trim();
    return value ? value : undefined;
  };

  const requestedProvider = read("LLM_PROVIDER")?.toLowerCase();
  const legacyQwenEnv = !requestedProvider && Boolean(
    read("QWEN_API_KEY") || read("QWEN_BASE_URL") || read("DASHSCOPE_API_KEY")
  );
  const extraBody = parseExtraBody(read("LLM_EXTRA_BODY"));
  const shared = {
    maxTokens: optionalPositiveInt(read("LLM_MAX_TOKENS"), "LLM_MAX_TOKENS"),
    jsonMode: read("LLM_JSON_MODE")?.toLowerCase() === "true",
    reasoningEffort: read("LLM_REASONING_EFFORT"),
    legacyQwenEnv
  };

  if (legacyQwenEnv) {
    const models = pickModels(read, {
      extract: read("QWEN_EXTRACT_MODEL") ?? LEGACY_QWEN_MODELS.extract,
      score: read("QWEN_SCORE_MODEL") ?? LEGACY_QWEN_MODELS.score,
      fast: read("QWEN_FAST_MODEL") ?? LEGACY_QWEN_MODELS.fast
    });
    const apiKey = read("LLM_API_KEY") ?? read("DASHSCOPE_API_KEY") ?? read("QWEN_API_KEY");
    return {
      ...shared,
      provider: "dashscope",
      apiStyle: parseApiStyle(read("LLM_API_STYLE")) ?? "responses",
      apiKey,
      baseUrl: normalizeLegacyQwenBaseUrl(read("LLM_BASE_URL") ?? read("QWEN_BASE_URL") ?? LEGACY_QWEN_BASE_URL),
      models,
      enabled: Boolean(apiKey),
      disabledReason: apiKey ? undefined : "DASHSCOPE_API_KEY is empty",
      extraBody: { enable_thinking: false, reasoning: { effort: "none" }, ...extraBody }
    };
  }

  if (!requestedProvider || requestedProvider === "none") {
    return {
      ...shared,
      provider: "none",
      apiStyle: "chat",
      baseUrl: "",
      models: sameModel(""),
      enabled: false,
      disabledReason: "LLM_PROVIDER is not set",
      extraBody
    };
  }

  const preset = LLM_PRESETS[requestedProvider];
  if (!preset) {
    throw new Error(
      `LLM_PROVIDER=${requestedProvider} is not supported. Use one of: ${Object.keys(LLM_PRESETS).join(", ")}, or none.`
    );
  }

  const apiKey = read("LLM_API_KEY") ?? preset.keyEnv.map(read).find(Boolean);
  const baseUrl = (read("LLM_BASE_URL") ?? preset.baseUrl).replace(/\/+$/, "");
  const models = pickModels(read, preset.models);
  const apiStyle = parseApiStyle(read("LLM_API_STYLE")) ?? preset.apiStyle;
  const disabledReason = !apiKey && !preset.keyOptional
    ? `LLM_API_KEY (or ${preset.keyEnv.join(" / ")}) is empty`
    : !baseUrl
      ? "LLM_BASE_URL is required for this provider"
      : !models.extract || !models.score || !models.fast
        ? "LLM_MODEL is required for this provider"
        : undefined;

  return {
    ...shared,
    provider: requestedProvider,
    apiStyle,
    apiKey,
    baseUrl,
    models,
    enabled: !disabledReason,
    disabledReason,
    maxTokens: shared.maxTokens ?? (apiStyle === "anthropic" ? DEFAULT_ANTHROPIC_MAX_TOKENS : undefined),
    ...(preset.defaultReasoningEffort ? { defaultReasoningEffort: preset.defaultReasoningEffort } : {}),
    extraBody: { ...(preset.extraBody ?? {}), ...extraBody }
  };
}

/** Safe-to-log summary of the LLM configuration (never includes the key). */
export function describeLlm(config: LlmConfig): Record<string, unknown> {
  return {
    provider: config.provider,
    enabled: config.enabled,
    ...(config.enabled
      ? { apiStyle: config.apiStyle, baseUrl: config.baseUrl, models: config.models }
      : { disabledReason: config.disabledReason }),
    ...(config.legacyQwenEnv ? { deprecatedEnv: "QWEN_*/DASHSCOPE_API_KEY — switch to LLM_PROVIDER and LLM_* variables" } : {})
  };
}

/** Legacy Qwen Responses URLs used an /api/v2/apps/protocols prefix; the official path drops it. */
export function normalizeLegacyQwenBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "").replace(/\/api\/v2\/apps\/protocols\/compatible-mode\/v1$/, "/compatible-mode/v1");
}

function pickModels(read: (key: string) => string | undefined, fallback: LlmModels): LlmModels {
  const shared = read("LLM_MODEL");
  return {
    extract: read("LLM_EXTRACT_MODEL") ?? shared ?? fallback.extract,
    score: read("LLM_SCORE_MODEL") ?? shared ?? fallback.score,
    fast: read("LLM_FAST_MODEL") ?? shared ?? fallback.fast
  };
}

function parseApiStyle(value: string | undefined): LlmApiStyle | undefined {
  if (!value) return undefined;
  const normalized = value.toLowerCase();
  if (normalized === "chat" || normalized === "responses" || normalized === "anthropic") return normalized;
  throw new Error(`LLM_API_STYLE=${value} is not supported. Use chat, responses, or anthropic.`);
}

function parseExtraBody(value: string | undefined): Record<string, unknown> {
  if (!value) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("LLM_EXTRA_BODY must be a JSON object, for example {\"temperature\":0.2}");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("LLM_EXTRA_BODY must be a JSON object, for example {\"temperature\":0.2}");
  }
  return parsed as Record<string, unknown>;
}

function optionalPositiveInt(value: string | undefined, key: string): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${key} must be a positive integer`);
  return parsed;
}
