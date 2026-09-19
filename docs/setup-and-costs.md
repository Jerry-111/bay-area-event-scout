# Setup and costs

English | [中文](setup-and-costs.zh-CN.md)

What you have to set up, what's optional, and what it costs each month. Prices were checked on
2026-09-18 and change often, so follow the links for current numbers. Mock mode
(`pnpm scout:mock`) never spends anything.

## The short version

| Piece | Needed? | What it does | Cost | Setup |
| --- | --- | --- | --- | --- |
| An LLM key | **Required** for real scans | Reads each event page and scores it against your preferences | About $1–12 a month with the default OpenAI model; $0 on Gemini's free tier or a local Ollama model | [1. LLM](#1-an-llm-key-required) |
| A Telegram bot | Recommended | Delivers the digest to your phone | Free | [2. Telegram](#2-a-telegram-bot-recommended-free) |
| Exa | Recommended | Web search, which finds far more events than the public calendars alone | About $0.21 per small scan; the $10 of free credit Exa adds each month covers a small scan a day | [3. Exa](#3-exa-recommended) |
| X API | Optional | Catches events announced only on X | $0.005 per post read: about $4–23 a month | [4. X](#4-x-api-optional-paid) |
| Firecrawl | Optional | Reads JavaScript-heavy event pages more reliably | Free up to 1,000 pages a month, then from $16 a month | [5. Firecrawl](#5-firecrawl-optional) |
| Somewhere to run it daily | Optional | Scans on a schedule without you | Free with GitHub Actions | [6. Running it daily](#6-running-it-every-day) |

With only an LLM key, real scans still work. They read the 100+ public calendars and RSS
feeds for free; they just find fewer events than with Exa.

## What it costs

Two things decide the bill: how much each scan may do (`SCOUT_BUDGET`) and how many scans you run
a day. `pnpm onboard` asks for a budget; GitHub Actions uses `small` unless you change it.

| | `small` | `medium` | `large` |
| --- | ---: | ---: | ---: |
| Web searches (Exa) per scan | 10 | 20 | 40 |
| Event pages the LLM reads per scan | 15 | 25 | 40 |
| Events the LLM scores per scan | 10 | 15 | 25 |
| X posts read per day | 25 | 50 | 150 |
| Exa per scan | $0.21 | $0.42 | $0.84 |
| LLM per scan (OpenAI `gpt-5-mini`) | ~$0.05 | ~$0.08 | ~$0.13 |
| X per day, if you set it up | $0.13 | $0.25 | $0.75 |
| Suggested scans per day | 1 | 2 | 3 |
| **Per month at that pace** | **~$2** | **~$20** | **~$80** |
| Plus X, if set up | +$4 | +$8 | +$23 |
| Plus Firecrawl, if set up | free tier | free tier | +$16 |

The monthly totals subtract Exa's $10 monthly credit. `large` with everything turned on is what
this project used to default to: about **$110–130 a month**, most of it Exa. Leaving
`SCOUT_BUDGET` unset still means `large`, so existing setups keep behaving the same.

How these are estimated: an Exa search asks for 12 results with highlights ($0.007 + $0.002
for the two results past 10 + $0.012 for highlights). An LLM page read is about 5,000 tokens in and
500 out; a scoring call is about 3,000 in and 400 out. Both figures are at the budget's caps, so
real scans often cost less.

### Choosing an LLM

Monthly LLM cost at the most expensive setting (`large`, 3 scans a day). For `small` at one scan a
day, divide by about 8.

| `LLM_PROVIDER` (default models) | Per `large` scan | Per month | Notes |
| --- | ---: | ---: | --- |
| `openai` (`gpt-5-mini`) | ~$0.13 | ~$12 | The simplest choice. OpenAI asks for $5 of prepaid credit. |
| `openai` with `LLM_MODEL=gpt-5-nano` | ~$0.03 | ~$3 | Cheaper, somewhat weaker. |
| `gemini` (`gemini-flash-latest`, now Gemini 3.8 Flash) | ~$0.33 | ~$30 | Has a free tier with per-account rate limits; Google may use free-tier data to improve its products. The price doubles on 2027-01-01. |
| `anthropic` (Haiku 4.5 reads, Sonnet 5 scores) | ~$0.56 | ~$50 | `LLM_MODEL=claude-opus-5` costs about four times as much. |
| `dashscope-intl` (`qwen-plus`) | ~$0.15 | ~$13 | Alibaba Cloud international. |
| `dashscope` (`qwen-plus`, mainland China) | ~¥0.29 | ~¥26 | New accounts get a free token quota. |
| `deepseek` (`deepseek-flash`) | ~$0.06 | ~$5 | Off-peak price; about double during peak hours. |
| `openrouter` | model price | +5.5% | Fee on credit purchases. |
| `ollama` | $0 | $0 | Runs on your computer; small models extract dates and venues less reliably. |

Per-token prices behind the table (per million tokens, input / output): gpt-5-mini $0.25 / $2,
gpt-5-nano $0.05 / $0.40, Gemini 3.8 Flash $0.75 / $3.75, Claude Haiku 4.5 $1 / $5, Claude Sonnet 5
$2 / $10, Claude Opus 5 $5 / $25, qwen-plus $0.40 / $1.20 (international) or ¥0.8 / ¥2 (mainland),
deepseek-flash about $0.15 / $0.60 off-peak.

### Where it runs

| Option | Cost | Good for |
| --- | --- | --- |
| [GitHub Actions](github-actions.md) | Free. Private copies get 2,000 free minutes a month, and a scan uses about 5–15. | A daily Telegram digest with nothing to install. |
| Your computer | Free | Trying it out, occasional scans, the dashboard at `localhost`. |
| [Trigger.dev](operations.md#triggerdev) + Postgres + [Railway](admin-railway-deploy.md) | Trigger.dev's free plan covers the scans (about $1–2 of its $5 monthly credit); Neon Postgres has a free tier; Railway is about $5–25 a month for an always-on dashboard. | Teams sharing a hosted dashboard. |

## Setting up each piece

Where keys go: `pnpm onboard` writes them to `.env.local` on your computer (never commit that
file). For GitHub Actions, they go in your copy's **Settings → Secrets and variables → Actions**
([guide](github-actions.md)). For Trigger.dev, they go in the project's environment variables.

### 1. An LLM key (required)

**Recommended: OpenAI.**

1. Sign up at [platform.openai.com](https://platform.openai.com/signup).
2. Add at least $5 of credit under **Settings → Billing**. Prepaid credit is also your spending cap.
3. Open **[API keys](https://platform.openai.com/api-keys)** → **Create new secret key**. Copy it
   right away (it starts with `sk-` and is shown once).
4. Set `LLM_PROVIDER=openai` and `LLM_API_KEY=<the key>` (the wizard asks for both).

Other providers ([all options](llm-providers.md)):

- **Gemini, free tier:** [aistudio.google.com](https://aistudio.google.com/app/apikey) → **Create
  API key** (starts with `AIza`) → `LLM_PROVIDER=gemini`. Check your rate limits at
  [aistudio.google.com/rate-limit](https://aistudio.google.com/rate-limit); a scan makes about
  25–65 calls in a few minutes.
- **Anthropic:** [console.anthropic.com](https://console.anthropic.com) → **Settings → API Keys →
  Create Key** (starts with `sk-ant-`) → `LLM_PROVIDER=anthropic`. Add credit under **Billing**.
- **Qwen (Alibaba Cloud Model Studio):** follow Alibaba's
  [get an API key](https://www.alibabacloud.com/help/en/model-studio/get-api-key) guide
  (international, `LLM_PROVIDER=dashscope-intl`) or the
  [mainland China guide](https://help.aliyun.com/zh/model-studio/get-api-key) (`LLM_PROVIDER=dashscope`).
  The two regions have separate accounts and keys.
- **DeepSeek:** [platform.deepseek.com](https://platform.deepseek.com/api_keys) → **Create API key**
  → `LLM_PROVIDER=deepseek`.
- **Ollama (local, free):** install from [ollama.com](https://ollama.com), run `ollama pull llama3.1`,
  and set `LLM_PROVIDER=ollama`. No key needed; your computer does the work.

### 2. A Telegram bot (recommended, free)

1. In Telegram, open [@BotFather](https://t.me/BotFather) and send `/newbot`.
2. Pick a display name, then a username that ends in `bot`. BotFather replies with a token like
   `123456789:AAH...`. That's `TELEGRAM_BOT_TOKEN`.
3. Open your new bot in Telegram and press **Start** (for a group digest, add the bot to the group
   and post a message there).
4. Get the chat id (`TELEGRAM_CHAT_ID`) without reading any JSON:
   - `pnpm onboard` finds it for you after step 3, and can send a test message.
   - Or run `pnpm telegram:chats`, which lists the chats that messaged your bot.
   - With GitHub Actions, run the **Telegram chat id** workflow ([guide](github-actions.md#4-telegram-chat-id)).

### 3. Exa (recommended)

1. Sign up at [dashboard.exa.ai](https://dashboard.exa.ai). New accounts get $20 of credit, and the
   free tier adds $10 each month ([pricing](https://exa.ai/pricing)).
2. Open **API Keys** → create a key → `EXA_API_KEY`.

Exa is pay-as-you-go with no subscription. At `small` and one scan a day (about $6 a month), the
monthly credit covers it.

### 4. X API (optional, paid)

1. Sign in at [developer.x.com](https://developer.x.com) and create a developer account, a Project,
   and an App.
2. In the app's **Keys and tokens** tab, generate the **Bearer Token** → `X_BEARER_TOKEN`.
3. Buy credits in the [X developer console](https://console.x.com) (at least $10). Reads cost $0.005
   per post ([pricing](https://docs.x.com/x-api/getting-started/pricing)). Turn off auto-recharge if
   you want a hard cap.

The scout only uses recent search, once a day, capped by `MAX_X_POSTS_PER_DAY` (from your budget).

### 5. Firecrawl (optional)

1. Sign up at [firecrawl.dev](https://www.firecrawl.dev). The free plan includes 1,000 pages a month
   with no card required.
2. Copy the API key (starts with `fc-`) → `FIRECRAWL_API_KEY`.

`small` and `medium` fit in the free plan; `large` at three scans a day needs the Hobby plan
([pricing](https://www.firecrawl.dev/pricing)). Without Firecrawl, pages are fetched directly,
which works for most event pages.

### 6. Running it every day

- **No install, free:** [GitHub Actions](github-actions.md). Scans run in your own private copy of
  this repository, and the digest arrives on Telegram.
- **Hosted, for teams:** [Trigger.dev](https://trigger.dev) runs the scans, Postgres
  ([Neon](https://neon.com) has a free tier) keeps history, and the dashboard runs on
  [Railway](https://railway.com) or any Node host. See [operations](operations.md) and
  [admin deploy](admin-railway-deploy.md).

## Keeping the bill down

- Pick a smaller `SCOUT_BUDGET`, or lower one `MAX_*` value (`.env.example` lists them).
- Scan less often. With GitHub Actions, edit the `cron` lines in `.github/workflows/scout.yml`; with
  Trigger.dev, remove times from `SCAN_SCHEDULES`.
- Skip X and Firecrawl; they are the easiest line items to drop.
- Use prepaid credit with each provider, so the most you can spend is what you loaded.
- Run `pnpm scout:doctor`: its **Budget** line shows what one scan may use.
