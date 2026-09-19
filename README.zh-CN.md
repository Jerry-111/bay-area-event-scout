# Bay Area Event Scout

[English](README.md) | 中文

一个帮你发现旧金山湾区（SF Bay Area）高质量小型活动的 scout：founder dinner、salon、roundtable 这类很少出现在大型活动日历上的局。它会搜索公开日历、newsletter、网页和 X，读取每个活动页面，按**你自己的**偏好打分，然后把精选结果推送到 Telegram，并提供一个方便团队一起筛选的 dashboard。

- **覆盖面广。** 除了 Luma 的公开页面，还会扫描 100 多个精选的湾区日历、活动汇总和 newsletter，并通过官方 X API 捕捉那些只在 X 上发布的活动。每次运行都会让 LLM 生成新的搜索词，避免反复搜同样的东西。
- **用大白话设置偏好。** 想多看/少看的方向、活动形式、想认识的人、优质场地、坚决不要的东西、推荐分数线，都在一个 [scout profile](docs/profiles.md) 里。可以从预设开始（B2B SaaS、climate tech、fintech、consumer AI），也可以用一句话描述自己；之后同样用一句话修改，比如"加上 climate tech，不要 crypto"。
- **LLM 随便换。** 支持 OpenAI、Anthropic、Gemini、DeepSeek、通义千问/DashScope、OpenRouter、Ollama，以及任何 OpenAI 兼容接口。详见 [LLM providers](docs/llm-providers.md)。
- **打分可解释。** 每个活动都有 0-100 分、分项明细，以及说明是哪条偏好影响了分数的理由。详见 [scoring](docs/scoring.md)。
- **运行成本低，预算自己定。** 默认的 GitHub 配置每月约 $6，见[配置与费用](docs/setup-and-costs.zh-CN.md)。

## 三种用法

| | 扫描 | Dashboard | 配置 | 运行费用 |
| --- | --- | --- | --- | --- |
| **1. 本地版** | 在你电脑上，你想扫的时候扫 | 在你电脑上 | 装 Node.js，运行 `npm start` | 免费 |
| **2. 云端版** | 在 GitHub 上每天自动扫两次，电脑关着也行 | 在你电脑上，读取一个免费数据库 | 在浏览器里大约 15 分钟，另外为 dashboard 装一次 Node.js | 免费 |
| **3. 团队版** | 在 Trigger.dev 上每天扫三次 | 部署在服务器上，大家都能打开 | 需要用终端，自己部署三个服务 | 服务器每月约 $5–25 |

1. **[本地版](#在自己电脑上运行)**：最快的试用方式，偶尔扫一扫也完全够用。
2. **[云端版](docs/github-actions.zh-CN.md)**：适合大多数想每天收到推荐的人。扫描在 GitHub Actions 上跑，结果推送到 Telegram，同时存进一个免费的 [Neon](https://neon.com) 数据库，你电脑上的 dashboard 读取它。
3. **[团队版](docs/operations.md)**：适合团队共用一个线上 dashboard。Trigger.dev 负责扫描，Postgres 保存历史，dashboard 自己部署（Railway 或任何 Node 主机）。

三种用法只要配置了机器人，都会把推荐推送到 Telegram。

## 要花多少钱

用示例数据试用完全免费。真实扫描时，你直接向各家服务付费；预算档位限制每次扫描最多用多少，每天扫几次由你决定：

| `SCOUT_BUDGET` | 每次扫描 | 每天 1 次 | 每天 2 次（GitHub 默认） | 每天 3 次 |
| --- | ---: | ---: | ---: | ---: |
| `small`（GitHub 默认） | ~$0.25 | 约 $2/月 | 约 $6/月 | 约 $13/月 |
| `medium` | ~$0.50 | 约 $5/月 | 约 $20/月 | 约 $35/月 |
| `large` | ~$1 | 约 $19/月 | 约 $48/月 | 约 $77/月 |

如果加了 X，每天只搜一次：small、medium、large 每月分别多约 $4、$8、$23。只有 LLM key 是必需的；推荐加上 Telegram（免费）和 Exa；X 和 Firecrawl 是可选的。每个 key 怎么一步步申请、各家 LLM 价格对比，见[配置与费用](docs/setup-and-costs.zh-CN.md)。

## 在自己电脑上运行

需要 **Node.js 22 或更新版本**。没有的话，从 [nodejs.org](https://nodejs.org/zh-cn/download) 下载 LTS 安装包装上（只需一次）。然后在终端里运行：

```sh
git clone https://github.com/Jerry-111/bay-area-event-scout.git
cd bay-area-event-scout
npm start
```

没有 git？在 GitHub 页面点 **Code → Download ZIP**，解压后在那个文件夹里打开终端。Mac：打开"终端"，输入 `cd `（后面带一个空格），把文件夹拖进窗口，按回车。Windows：打开文件夹，点地址栏，输入 `cmd`，按回车。然后运行 `npm start`。

只需要这一个命令。第一次运行时，`npm start` 会自动安装（一两分钟），问几个配置问题（每一项都可以直接按回车跳过；没有 LLM key 时显示示例数据），然后在浏览器里打开 dashboard。之后每次运行 `npm start` 都会显示一个菜单：

```text
What would you like to do?
  1) Scan for new events, then open the dashboard (last scan: 2 days ago)
  2) Open the dashboard
  3) Show or change my preferences
  4) Change keys, Telegram, budget, or preferences (setup)
  5) Check my setup
```

一次扫描大约 3–10 分钟，过程中会显示进度；dashboard 会一直开着，按 Ctrl+C 关闭。也可以跳过菜单直接运行：`npm start scan`、`npm start dashboard`、`npm start setup`、`npm start preferences`、`npm start undo`、`npm start doctor`。

配置会把 key 保存在 `.env.local`（已被 gitignore，且只有你本人可读），扫描结果保存在 `.scout-data/`。开发者也可以用下面[常用命令](#常用命令)里的 `pnpm` 命令一步步单独运行。

## 改成你自己的偏好

偏好（也就是 "scout profile"）决定了一切：搜什么、哪些候选在调用 LLM 之前就被过滤掉、打分 prompt、以及推荐分数线。你完全不用碰 YAML：运行 `npm start preferences`（或者在菜单里选），它会先显示 scout 现在在找什么，再问你想改什么，比如"多一些 B2B go-to-market 的饭局，加上 climate tech，不要 crypto"；`npm start undo` 可以撤销。用 pnpm 的话，也可以一行搞定：

```sh
pnpm profile:show                                     # 看看 scout 现在在找什么
pnpm profile:edit "多一些 B2B go-to-market 的饭局，加上 climate tech，不要 crypto"
pnpm profile:new "我在一家 B2B SaaS 创业公司做 partnership，想参加有 founder 和企业买家的小型饭局"
pnpm profile:undo                                     # 后悔了？（再运行一次就是恢复）
```

`profile:edit` 和 `profile:new` 用的是你自己的 LLM key：LLM 改写 profile，结果会按 profile 规则校验，保存之前你会看到一份"具体改了什么"的清单。中英文都可以。也可以直接从预设开始：在 `.env.local` 里把 `SCOUT_PROFILE` 设成 `b2b-saas-founder`、`climate-tech`、`fintech` 或 `consumer-ai-founder`（默认）。

profile 本身是一份很好读的 YAML，想自己改也可以：

```yaml
persona: a climate tech founder who wants small rooms with climate investors and corporate buyers
topics:
  - name: Climate tech
    weight: 8          # 正数加分，负数减分
    keywords: [climate tech, clean energy, decarbonization, grid, battery]
exclude:
  formats: [hackathon, webinar]   # 在调用 LLM 之前直接排除
search:
  phrases: [climate tech founders, climate investors]
thresholds:
  recommend: 80
  review: 65
```

关键词和活动页面都是英文的，所以 profile 里的内容用英文写（用 `profile:edit` 时可以说中文，它会自动写成英文）。每个字段的说明见 [docs/profiles.md](docs/profiles.md)。

## 定时运行

- **云端版（免费）：** [GitHub Actions](docs/github-actions.zh-CN.md) 在你自己的私有仓库里每天扫描两次（设置 `SCANS_PER_DAY` 可改成 1 或 3 次），结果推送到 Telegram，每周还会回头找一次漏掉的活动。
- **团队版：** 把 worker 部署到 [Trigger.dev](https://trigger.dev)（太平洋时间每天 09:00、14:00、22:00 扫描，外加每周一次的漏检回顾），结果存进 Postgres，dashboard 部署到 Railway 或任何 Node 主机（记得设置 `ADMIN_PASSWORD`）。详见 [operations](docs/operations.md) 和 [admin deploy](docs/admin-railway-deploy.md)。

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `npm start` | 一站式：安装、配置、扫描、dashboard、修改偏好（菜单） |
| `pnpm onboard` | 引导式配置 `.env.local`、预算和偏好 |
| `pnpm scout:doctor` | 配置自检（`--live` 实测 key；`pnpm config:check` 输出 JSON） |
| `pnpm profile:show` | 用大白话显示当前偏好 |
| `pnpm profile:edit "<想改什么>"` | 用一句话修改偏好 |
| `pnpm profile:new "<描述>"` | 根据一段描述重新生成偏好 |
| `pnpm profile:undo` | 撤销上一次偏好修改（再运行一次就是恢复） |
| `pnpm scout:mock` / `pnpm scout:real` | 用示例数据 / 真实数据扫描 |
| `pnpm admin` | dashboard：http://127.0.0.1:4310 |
| `pnpm telegram:chats` | 列出给你的机器人发过消息的 Telegram 聊天及其 id |
| `pnpm telegram:test` | 用当前 Telegram 配置发一条测试消息 |
| `pnpm test` | 类型检查 + 全部测试 |

## 参与贡献

特别欢迎补充新的湾区活动来源、profile 预设和 LLM provider。见 [CONTRIBUTING.md](CONTRIBUTING.md)；安全问题请按 [SECURITY.md](SECURITY.md) 私下报告。

## 合规使用

本项目只读取公开页面和官方 API：不登录 Luma、LinkedIn、Meetup 或 Eventbrite，不自动化操作 X 网站，也不收集参会者或个人资料数据。提高预算上限时请遵守各平台的条款和速率限制。

## License

[MIT](LICENSE)
