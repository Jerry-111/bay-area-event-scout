# 配置与费用

[English](setup-and-costs.md) | 中文

这篇说明哪些东西必须配置、哪些可选，以及每个月大概要花多少钱。价格核对于 2026-09-18，之后可能会变，以各家官网链接为准。mock 模式（`pnpm scout:mock`）不花任何钱。

## 一句话版本

| 项目 | 是否必需 | 用来做什么 | 费用 | 配置步骤 |
| --- | --- | --- | --- | --- |
| 一个 LLM key | 真实扫描**必需** | 读每个活动页面，按你的偏好打分 | 默认的 OpenAI 模型每月约 $1–12；用 Gemini 免费额度或本地 Ollama 为 $0 | [1. LLM](#1-llm-key必需) |
| Telegram 机器人 | 推荐 | 把精选活动推送到手机 | 免费 | [2. Telegram](#2-telegram-机器人推荐免费) |
| Exa | 推荐 | 网页搜索，比只看公开日历能多找到很多活动 | small 档每次扫描约 $0.21；Exa 每月送的 $10 额度够每天扫一次 | [3. Exa](#3-exa推荐) |
| X API | 可选 | 找到只在 X 上宣布的活动 | 每读一条帖子 $0.005：每月约 $4–23 | [4. X](#4-x-api可选付费) |
| Firecrawl | 可选 | 更可靠地读取依赖 JavaScript 的活动页面 | 每月 1,000 页以内免费，之后 $16/月起 | [5. Firecrawl](#5-firecrawl可选) |
| 每天自动运行的地方 | 可选 | 按时自动扫描 | 用 GitHub Actions 免费 | [6. 每天自动运行](#6-每天自动运行) |

只有一个 LLM key 也能做真实扫描：scout 会免费读取 100 多个公开日历和 RSS，只是找到的活动比加上 Exa 时少。

## 要花多少钱

账单由两件事决定：每次扫描允许做多少事（`SCOUT_BUDGET`），以及每天扫几次。配置时（`npm start` 或 `pnpm onboard`）会问你选哪一档；GitHub Actions 默认用 `small`、每天扫两次（可以用 `SCANS_PER_DAY` 修改）。

| | `small` | `medium` | `large` |
| --- | ---: | ---: | ---: |
| 每次扫描的网页搜索（Exa） | 10 | 20 | 40 |
| 每次扫描 LLM 读取的活动页面 | 15 | 25 | 40 |
| 每次扫描 LLM 打分的活动 | 10 | 15 | 25 |
| 每天读取的 X 帖子 | 25 | 50 | 150 |
| 每次扫描的 Exa 费用 | $0.21 | $0.42 | $0.84 |
| 每次扫描的 LLM 费用（OpenAI `gpt-5-mini`） | ~$0.05 | ~$0.08 | ~$0.13 |
| **每月，每天 1 次** | **~$2** | **~$5** | **~$19** |
| **每月，每天 2 次**（GitHub 默认） | **~$6** | **~$20** | **~$48** |
| **每月，每天 3 次**（Trigger.dev 默认） | **~$13** | **~$35** | **~$77** |
| 另加 X（如果配置了，每天只搜一次） | +$4 | +$8 | +$23 |
| 另加 Firecrawl（如果配置了） | 免费额度内 | 每天 2 次以内免费 | +$16 |

每月合计已经减去 Exa 每月送的 $10。`large` 档每天 3 次、再开上 X 和 Firecrawl，就是这个项目以前的默认配置：每月大约 **$110–130**，大头是 Exa。不设置 `SCOUT_BUDGET` 仍然等于 `large`，所以已有的部署行为不变。每周一次的漏检回顾每周只多花几美分。

估算方法：一次 Exa 搜索取 12 条结果并带 highlights（$0.007 基础费 + 超过 10 条的 2 条 $0.002 + highlights $0.012）。LLM 读一个活动页面约输入 5,000 token、输出 500；打分一次约输入 3,000、输出 400。以上都按档位上限计算，实际扫描通常更便宜。

### 选哪个 LLM

下表是最贵设置（`large`、每天 3 次）下每月的 LLM 费用。GitHub 默认配置（`small`、每天 2 次）大约除以 4。

| `LLM_PROVIDER`（默认模型） | 每次 `large` 扫描 | 每月 | 说明 |
| --- | ---: | ---: | --- |
| `openai`（`gpt-5-mini`） | ~$0.13 | ~$12 | 最省心的选择。OpenAI 需要先预充 $5。 |
| `openai` 加 `LLM_MODEL=gpt-5-nano` | ~$0.03 | ~$3 | 更便宜，效果稍弱。 |
| `gemini`（`gemini-flash-latest`，目前是 Gemini 3.8 Flash） | ~$0.33 | ~$30 | 有免费额度，按账号限速；免费额度下的数据可能被 Google 用于改进产品。2027-01-01 起价格翻倍。 |
| `anthropic`（Haiku 4.5 读页面，Sonnet 5 打分） | ~$0.56 | ~$50 | 全部用 `LLM_MODEL=claude-opus-5` 大约贵 4 倍。 |
| `dashscope-intl`（`qwen-plus`） | ~$0.15 | ~$13 | 阿里云国际站。 |
| `dashscope`（`qwen-plus`，中国大陆） | ~¥0.29 | ~¥26 | 新账号有免费 token 额度。 |
| `deepseek`（`deepseek-flash`） | ~$0.06 | ~$5 | 闲时价格；高峰时段约贵一倍。 |
| `openrouter` | 按所选模型 | +5.5% | 充值时收取手续费。 |
| `ollama` | $0 | $0 | 在你自己的电脑上运行；小模型提取日期、地点没那么准。 |

表格背后的单价（每百万 token，输入 / 输出）：gpt-5-mini $0.25 / $2，gpt-5-nano $0.05 / $0.40，Gemini 3.8 Flash $0.75 / $3.75，Claude Haiku 4.5 $1 / $5，Claude Sonnet 5 $2 / $10，Claude Opus 5 $5 / $25，qwen-plus 国际站 $0.40 / $1.20、大陆 ¥0.8 / ¥2，deepseek-flash 闲时约 $0.15 / $0.60。

### 在哪里运行

| 方式 | 费用 | 适合 |
| --- | --- | --- |
| [GitHub Actions](github-actions.zh-CN.md) | 免费。私有仓库每月有 2,000 分钟免费额度，每天扫两次大约用掉 300–900 分钟。 | 每天收到 Telegram 推送，什么都不用装。 |
| 你自己的电脑（`npm start`） | 免费 | 用 dashboard、偶尔扫一次、先试试。 |
| GitHub Actions + 免费的 [Neon](https://neon.com) 数据库 + `npm start` | 免费 | 云端扫描，在自己电脑上看 dashboard（[方法](github-actions.zh-CN.md#在-dashboard-里看结果可选)）。 |
| [Trigger.dev](operations.md#triggerdev) + Postgres + [Railway](admin-railway-deploy.md) | Trigger.dev 免费套餐够用（扫描只用掉每月 $5 额度里的 $1–2）；Neon 有免费档；Railway 常驻 dashboard 每月约 $5–25。 | 团队共用一个线上 dashboard。 |

## 逐项配置

key 放在哪里：在自己电脑上，配置时（`npm start`）会写进 `.env.local`（千万不要提交这个文件）。用 GitHub Actions 的话，放在你仓库的 **Settings → Secrets and variables → Actions**（[说明](github-actions.zh-CN.md)）。用 Trigger.dev 的话，放在项目的环境变量里。

### 1. LLM key（必需）

**推荐：OpenAI。**

1. 在 [platform.openai.com](https://platform.openai.com/signup) 注册。
2. 在 **Settings → Billing** 里至少充值 $5。预充值也就是你的花费上限。
3. 打开 **[API keys](https://platform.openai.com/api-keys)** → **Create new secret key**，马上复制（以 `sk-` 开头，只显示一次）。
4. 设置 `LLM_PROVIDER=openai` 和 `LLM_API_KEY=<你的 key>`（引导程序会依次问这两项）。

其他选择（[全部选项](llm-providers.md)）：

- **Gemini 免费额度：** [aistudio.google.com](https://aistudio.google.com/app/apikey) → **Create API key**（以 `AIza` 开头）→ `LLM_PROVIDER=gemini`。在 [aistudio.google.com/rate-limit](https://aistudio.google.com/rate-limit) 查看你的限速；一次扫描会在几分钟内调用 25–65 次。
- **Anthropic：** [console.anthropic.com](https://console.anthropic.com) → **Settings → API Keys → Create Key**（以 `sk-ant-` 开头）→ `LLM_PROVIDER=anthropic`。在 **Billing** 里充值。
- **通义千问（阿里云百炼 / Model Studio）：** 按阿里云官方的[获取 API Key（国际站）](https://www.alibabacloud.com/help/en/model-studio/get-api-key)操作，对应 `LLM_PROVIDER=dashscope-intl`；或者[中国大陆版说明](https://help.aliyun.com/zh/model-studio/get-api-key)，对应 `LLM_PROVIDER=dashscope`。两个地域的账号和 key 互不通用。
- **DeepSeek：** [platform.deepseek.com](https://platform.deepseek.com/api_keys) → **创建 API key** → `LLM_PROVIDER=deepseek`。
- **Ollama（本地、免费）：** 从 [ollama.com](https://ollama.com) 安装，运行 `ollama pull llama3.1`，然后设置 `LLM_PROVIDER=ollama`。不需要 key，由你的电脑来算。

### 2. Telegram 机器人（推荐，免费）

1. 在 Telegram 里打开 [@BotFather](https://t.me/BotFather)，发送 `/newbot`。
2. 起一个显示名，再起一个以 `bot` 结尾的用户名。BotFather 会回复一个形如 `123456789:AAH...` 的 token，这就是 `TELEGRAM_BOT_TOKEN`。
3. 在 Telegram 里打开你的新机器人，点 **Start**（想推送到群里的话，把机器人拉进群，在群里发一条消息）。
4. 获取 chat id（`TELEGRAM_CHAT_ID`），不用看任何 JSON：
   - 配置时（`npm start` 或 `pnpm onboard`）会在第 3 步之后自动帮你找到，还能发一条测试消息。
   - 或者运行 `pnpm telegram:chats`，列出给机器人发过消息的聊天。
   - 用 GitHub Actions 的话，运行 **Telegram chat id** 工作流（[说明](github-actions.zh-CN.md#4-telegram-chat-id)）。

### 3. Exa（推荐）

1. 在 [dashboard.exa.ai](https://dashboard.exa.ai) 注册。新账号送 $20，免费档每月再送 $10（[价格](https://exa.ai/pricing)）。
2. 打开 **API Keys** → 新建一个 key → `EXA_API_KEY`。

Exa 按用量付费，没有订阅。`small` 档每天扫一次（每月约 $6），每月送的额度就够了。

### 4. X API（可选，付费）

1. 登录 [developer.x.com](https://developer.x.com)，创建开发者账号、一个 Project 和一个 App。
2. 在 App 的 **Keys and tokens** 页生成 **Bearer Token** → `X_BEARER_TOKEN`。
3. 在 [X 开发者控制台](https://console.x.com) 购买额度（至少 $10）。每读一条帖子 $0.005（[价格](https://docs.x.com/x-api/getting-started/pricing)）。想要硬上限的话，关掉自动续充。

scout 只用 recent search，每天一次，上限由 `MAX_X_POSTS_PER_DAY`（跟随你的档位）控制。

### 5. Firecrawl（可选）

1. 在 [firecrawl.dev](https://www.firecrawl.dev) 注册。免费套餐每月 1,000 页，不需要绑卡。
2. 复制 API key（以 `fc-` 开头）→ `FIRECRAWL_API_KEY`。

`small` 和 `medium` 在免费额度内；`large` 每天 3 次需要 Hobby 套餐（[价格](https://www.firecrawl.dev/pricing)）。不用 Firecrawl 时，页面会直接抓取，大多数活动页面都没问题。

### 6. 每天自动运行

- **什么都不用装，免费：** [GitHub Actions](github-actions.zh-CN.md)。在你自己的私有仓库里定时扫描，结果推送到 Telegram。
- **团队线上部署：** [Trigger.dev](https://trigger.dev) 负责定时扫描，Postgres（[Neon](https://neon.com) 有免费档）保存历史，dashboard 部署在 [Railway](https://railway.com) 或任何 Node 主机上。见 [operations](operations.md) 和 [admin deploy](admin-railway-deploy.md)。

## 省钱方法

- 选小一档的 `SCOUT_BUDGET`，或者单独调低某个 `MAX_*`（`.env.example` 里有完整列表）。
- 少扫几次。GitHub Actions 把 `SCANS_PER_DAY` 设成 `1`；Trigger.dev 从 `SCAN_SCHEDULES` 里删掉时间点。
- 不用 X 和 Firecrawl，这是最容易省掉的两项。
- 每家都用预充值，最多只会花掉你充进去的钱。
- 运行 `pnpm scout:doctor`，**Budget** 这一行会显示一次扫描最多用多少。
