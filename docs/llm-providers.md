# LLM providers

The scout uses an LLM for three jobs:

| Job | Model variable | What it does |
| --- | --- | --- |
| Extract | `LLM_EXTRACT_MODEL` | Turns an event page into structured fields (date, city, hosts, registration status, ...) |
| Score | `LLM_SCORE_MODEL` | Scores the event 0-100 against your [profile](profiles.md) |
| Fast | `LLM_FAST_MODEL` | Plans exploration searches, repairs malformed JSON, classifies weekly misses |

`LLM_MODEL` sets all three at once; the specific variables win over it. If a model fails, the scout
retries the same prompt on the other two models before giving up on that event.

Mock mode (`MOCK_MODE=true`) needs no LLM: it runs the whole pipeline on sample data with a keyword
scorer driven by the same profile. Real scans need an LLM to read event pages; without one a scan
still collects candidate links but extracts no events, rather than guessing dates and places.

## Choosing a provider

Run `pnpm onboard` to pick a provider interactively, or set `LLM_PROVIDER` and a key in `.env.local`
yourself and check it with `pnpm scout:doctor --live`:

```env
LLM_PROVIDER=openai
LLM_API_KEY=sk-...
```

The scout never picks a provider on its own: an `OPENAI_API_KEY` that happens to be exported in
your shell is not used unless `LLM_PROVIDER=openai`.

| `LLM_PROVIDER` | API | Default base URL | Default models (extract / score / fast) | Key variable |
| --- | --- | --- | --- | --- |
| `openai` | Chat Completions | `https://api.openai.com/v1` | `gpt-5-mini` for all | `OPENAI_API_KEY` |
| `anthropic` | Messages (official SDK) | `https://api.anthropic.com` | `claude-haiku-4-5` / `claude-sonnet-5` / `claude-haiku-4-5` | `ANTHROPIC_API_KEY` |
| `gemini` | Chat Completions (OpenAI-compatible endpoint) | `https://generativelanguage.googleapis.com/v1beta/openai` | `gemini-flash-latest` for all | `GEMINI_API_KEY` or `GOOGLE_API_KEY` |
| `deepseek` | Chat Completions | `https://api.deepseek.com` | `deepseek-flash` for all | `DEEPSEEK_API_KEY` |
| `dashscope` | Chat Completions | `https://dashscope.aliyuncs.com/compatible-mode/v1` (mainland China) | `qwen-plus` / `qwen-plus` / `qwen-flash` | `DASHSCOPE_API_KEY` |
| `dashscope-intl` | Chat Completions | `https://dashscope-intl.aliyuncs.com/compatible-mode/v1` | `qwen-plus` / `qwen-plus` / `qwen-flash` | `DASHSCOPE_API_KEY` |
| `openrouter` | Chat Completions | `https://openrouter.ai/api/v1` | `openai/gpt-5-mini` for all | `OPENROUTER_API_KEY` |
| `ollama` | Chat Completions | `http://localhost:11434/v1` | `llama3.1` for all | none |
| `openai-compatible` | Chat Completions | set `LLM_BASE_URL` | set `LLM_MODEL` | `LLM_API_KEY` (optional) |

`LLM_API_KEY` always works; the provider-specific variable is used only when it is empty.

Default models are suggestions that were current when this was written. Model names change, so
override them with `LLM_MODEL` when your provider retires one. Cost is roughly
`MAX_LLM_EXTRACT_CANDIDATES_PER_RUN + MAX_LLM_SCORE_EVENTS_PER_RUN` calls per scan (plus a planner
call), with extraction prompts carrying up to ~24k characters of page text, so pick models with that
volume in mind.

### Other OpenAI-compatible services

Anything that speaks the OpenAI Chat Completions API works through `openai-compatible`:

```env
LLM_PROVIDER=openai-compatible
LLM_BASE_URL=https://api.groq.com/openai/v1      # or Together, Fireworks, Moonshot, SiliconFlow, vLLM, LM Studio, ...
LLM_API_KEY=...
LLM_MODEL=<model id from that service>
```

## Optional settings

| Variable | Default | Notes |
| --- | --- | --- |
| `LLM_BASE_URL` | preset | Point a preset at a proxy or a regional endpoint. |
| `LLM_API_STYLE` | preset | `chat`, `responses` (OpenAI Responses API), or `anthropic`. |
| `LLM_JSON_MODE` | `false` | Sends `response_format: {type: "json_object"}` (Chat) or `text.format` (Responses). Replies are parsed and repaired either way. |
| `LLM_REASONING_EFFORT` | Anthropic: `low`; others: unset | Anthropic: `output_config.effort` (`low`...`max`, or `none` to omit). Chat: `reasoning_effort`. Responses: `reasoning.effort`. Not sent to Haiku models, which do not accept it. |
| `LLM_MAX_TOKENS` | Anthropic: `16000`; others: unset | `max_tokens` / `max_output_tokens`. |
| `LLM_EXTRA_BODY` | `{}` | JSON merged into Chat/Responses request bodies, e.g. `{"temperature":0.2}` or `{"max_completion_tokens":4000}`. It cannot replace the model or prompt. |
| `LLM_TIMEOUT_MS` | `45000` | Per request. |

Requests that come back `429` or `5xx` are retried twice, honoring `Retry-After`.

## Notes per provider

- **Anthropic** goes through the official `@anthropic-ai/sdk`. The defaults keep a scan cheap:
  Haiku 4.5 for the many page extractions, Sonnet 5 for scoring. Opus 5 for everything
  (`LLM_MODEL=claude-opus-5`) costs roughly four times as much; see
  [setup and costs](setup-and-costs.md). For `claude-opus-5` and
  `claude-fable-5-1` on the first-party API, the scout opts into Anthropic's server-side refusal
  fallback (`fallbacks: "default"`), so a declined request is re-run on Anthropic's recommended
  fallback model instead of failing. Effort defaults to `low` because the scout makes many short
  extraction and scoring calls under a per-stage time budget; raise it with `LLM_REASONING_EFFORT`.
- **DashScope / Qwen** presets send `enable_thinking: false`, which Qwen3 models need for
  non-streaming calls.
- **OpenAI reasoning models** (the `gpt-5` family) accept `LLM_REASONING_EFFORT=minimal|low|medium|high`.
  They reject `temperature` and `max_tokens`; use `LLM_EXTRA_BODY={"max_completion_tokens":...}` if
  you need an output cap.
- **Local models** (Ollama, LM Studio, vLLM) work, but small models extract dates and venues less
  reliably. Keep an eye on the pipeline quality summary in the run logs.

## Migrating from the old `QWEN_*` variables

Earlier versions read `DASHSCOPE_API_KEY` / `QWEN_API_KEY`, `QWEN_BASE_URL`, `QWEN_EXTRACT_MODEL`,
`QWEN_SCORE_MODEL`, `QWEN_FAST_MODEL`, and `QWEN_TIMEOUT_MS`. When `LLM_PROVIDER` is not set and any
of `QWEN_API_KEY`, `QWEN_BASE_URL`, or `DASHSCOPE_API_KEY` is present, the scout still honors them:
it talks to DashScope through the Responses API exactly as before, and the run logs flag the
deprecated variables.

In that legacy mode an unset `QWEN_BASE_URL` now means the public DashScope endpoint
(`https://dashscope.aliyuncs.com/compatible-mode/v1`); older versions defaulted to a private
workspace endpoint. If you use a Model Studio workspace endpoint or another region, set
`QWEN_BASE_URL` explicitly, or better, switch to the new variables:

```env
LLM_PROVIDER=dashscope
LLM_API_KEY=<your DashScope key>
LLM_BASE_URL=<your Model Studio endpoint>/compatible-mode/v1
LLM_API_STYLE=responses           # keep the old request format, or drop this line to use Chat Completions
LLM_EXTRACT_MODEL=qwen3.7-plus
LLM_SCORE_MODEL=qwen3.7-plus
LLM_FAST_MODEL=qwen3.7-flash
```
