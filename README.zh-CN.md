# Bay Area Event Scout

[English](README.md) | 中文

一个帮你发现旧金山湾区（SF Bay Area）高质量小型活动的 scout：founder dinner、salon、roundtable 这类很少出现在大型活动日历上的局。它会搜索公开日历、newsletter、网页和 X，读取每个活动页面，按**你自己的**偏好打分，然后把精选结果推送到 Telegram，并提供一个方便团队一起筛选的 dashboard。

- **覆盖面广。** 除了 Luma 的公开页面，还会扫描 100 多个精选的湾区日历、活动汇总和 newsletter，并通过官方 X API 捕捉那些只在 X 上发布的活动。每次运行都会让 LLM 生成新的搜索词，避免反复搜同样的东西。
- **用大白话设置偏好。** 想多看/少看的方向、活动形式、想认识的人、优质场地、坚决不要的东西、推荐分数线，都在一个 [scout profile](docs/profiles.md) 里。可以从预设开始（B2B SaaS、climate tech、fintech、consumer AI），也可以用一句话描述自己；之后同样用一句话修改：`pnpm profile:edit "加上 climate tech，不要 crypto"`。
- **LLM 随便换。** 支持 OpenAI、Anthropic、Gemini、DeepSeek、通义千问/DashScope、OpenRouter、Ollama，以及任何 OpenAI 兼容接口。详见 [LLM providers](docs/llm-providers.md)。
- **打分可解释。** 每个活动都有 0-100 分、分项明细，以及说明是哪条偏好影响了分数的理由。详见 [scoring](docs/scoring.md)。
- **运行成本低，预算自己定。** 每月最低约 $2，见[配置与费用](docs/setup-and-costs.zh-CN.md)。

## 选一种用法

| | 需要什么 | 适合 |
| --- | --- | --- |
| **[用 GitHub 每天推送](docs/github-actions.zh-CN.md)** | 一个 GitHub 账号、一个 LLM key、一个 Telegram 机器人，什么都不用装 | 大多数人。在浏览器里大约 10 分钟配置完 |
| **[在自己电脑上运行](#在自己电脑上运行)** | Node.js 和终端 | 先试试、用 dashboard、自己折腾 |
| **[团队线上部署](docs/operations.md)** | Trigger.dev、Postgres、一个 Node 主机 | 团队共用 dashboard，定时扫描 |

## 要花多少钱

用示例数据试用完全免费。真实扫描时，你直接向各家服务付费，预算设置会限制每次扫描最多用多少：

| `SCOUT_BUDGET` | 每次扫描 | 建议频率 | 每月 |
| --- | ---: | --- | ---: |
| `small` | ~$0.25 | 每天 1 次 | ~$2 |
| `medium` | ~$0.50 | 每天 2 次 | ~$20 |
| `large` | ~$1，另加 X | 每天 3 次 | ~$80–130 |

只有 LLM key 是必需的；推荐加上 Telegram（免费）和 Exa；X 和 Firecrawl 是可选的。每个 key 怎么一步步申请、各家 LLM 价格对比，见[配置与费用](docs/setup-and-costs.zh-CN.md)。

## 在自己电脑上运行

### 先试一下（2 分钟，不需要任何 key）

需要 **Node.js 22 或更新版本**（[下载 LTS 安装包](https://nodejs.org/zh-cn/download)）和 **pnpm**。获取 pnpm：运行一次 `corepack enable`（Mac 上如果提示没有权限，改用 `sudo corepack enable`），或者 `npm install -g pnpm`。然后下载代码：会用 git 的话直接 clone；不会的话，在 GitHub 页面点 **Code → Download ZIP** 再解压。

```sh
git clone https://github.com/Jerry-111/bay-area-event-scout.git
cd bay-area-event-scout
pnpm install        # 安装依赖并编译
pnpm scout:mock     # 用示例数据跑一遍完整流程
pnpm admin          # dashboard：http://127.0.0.1:4310
```

### 正式配置（约 5 分钟）

```sh
pnpm onboard        # 引导式配置：LLM、搜索 key、Telegram、预算和你的偏好
pnpm scout:doctor   # 检查配置；加 --live 会实际测试 key 是否可用
pnpm scout:real     # 真实扫描（结果保存在 .scout-data/）
pnpm admin          # 查看、打分、分享结果
```

`pnpm onboard` 一次只问一个问题，并解释每一项。它会自动帮你找到 Telegram 的 chat id，并把 key 写进 `.env.local`（已被 gitignore，且只有你本人可读）。喜欢手动改文件的话，把 `.env.example` 复制成 `.env.local` 再填写即可。

## 改成你自己的偏好

偏好（也就是 "scout profile"）决定了一切：搜什么、哪些候选在调用 LLM 之前就被过滤掉、打分 prompt、以及推荐分数线。你完全不用碰 YAML：

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

- **免费、不用安装：** [GitHub Actions](docs/github-actions.zh-CN.md) 每天在你自己的私有仓库里扫描一次，结果推送到 Telegram。
- **团队使用：** 把 worker 部署到 [Trigger.dev](https://trigger.dev)（太平洋时间每天 09:00、14:00、22:00 扫描，外加每周一次的漏检回顾），结果存进 Postgres，dashboard 部署到 Railway 或任何 Node 主机（记得设置 `ADMIN_PASSWORD`）。详见 [operations](docs/operations.md) 和 [admin deploy](docs/admin-railway-deploy.md)。

## 常用命令

| 命令 | 作用 |
| --- | --- |
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
