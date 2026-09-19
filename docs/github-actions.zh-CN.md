# 用 GitHub 每天自动运行（什么都不用装）

[English](github-actions.md) | 中文

这是每天收到推送最简单的方式：scout 在你自己的私有仓库里、用 GitHub 的服务器每天扫描两次，精选活动推送到 Telegram，你的电脑关着也没关系。不用装任何东西，也不用维护服务器，全程在浏览器里完成，大约 10 分钟。

你需要一个免费的 [GitHub 账号](https://github.com/signup)、一个 LLM key 和一个 Telegram 机器人，最好再加一个 Exa key。每一项去哪里申请、要花多少钱，见[配置与费用](setup-and-costs.zh-CN.md)。GitHub 这部分是免费的：私有仓库每月有 2,000 分钟 Actions 额度，一次扫描约用 5–15 分钟。

## 1. 复制一份你自己的仓库

1. 打开 [github.com/Jerry-111/bay-area-event-scout](https://github.com/Jerry-111/bay-area-event-scout)，点 **Use this template → Create a new repository**。
2. 起个名字（比如 `my-event-scout`），选 **Private**，点 **Create repository**。

下面所有操作都在你新建的这个仓库里进行。

## 2. 填入你的 key

在你的仓库里打开 **Settings → Secrets and variables → Actions**。

在 **Secrets** 标签页，每个 key 点一次 **New repository secret**。Secret 是加密保存的，不会出现在日志里。

| 名称 | 是否必需 | 填什么 |
| --- | --- | --- |
| `LLM_API_KEY` | 必需 | 你的 LLM key |
| `TELEGRAM_BOT_TOKEN` | 推荐 | @BotFather 给你的 token |
| `EXA_API_KEY` | 推荐 | 你的 Exa key |
| `X_BEARER_TOKEN` | 可选 | 你的 X API Bearer Token |
| `FIRECRAWL_API_KEY` | 可选 | 你的 Firecrawl key |
| `DATABASE_URL` | 可选 | 只有想用 dashboard 时才需要，见[下文](#在-dashboard-里看结果可选) |

在 **Variables** 标签页，每个设置点一次 **New repository variable**：

| 名称 | 是否必需 | 填什么 |
| --- | --- | --- |
| `LLM_PROVIDER` | 必需 | `openai`、`gemini`、`anthropic`、`deepseek`、`dashscope-intl`、`dashscope` 或 `openrouter` |
| `SCOUT_PROFILE` | 可选 | 偏好的起点：`b2b-saas-founder`、`climate-tech`、`fintech` 或 `consumer-ai-founder`（默认） |
| `SCANS_PER_DAY` | 可选 | `1`、`2`（默认）或 `3`，见[第 6 步](#6-运行时间) |
| `SCOUT_BUDGET` | 可选 | `small`（这里的默认值）、`medium` 或 `large`，见[费用](setup-and-costs.zh-CN.md#要花多少钱) |
| `LLM_MODEL` | 可选 | 换成同一家的其他模型 |
| `TELEGRAM_CHAT_ID` | 第 4 步再加 | 推送发到哪个聊天 |

## 3. 试运行

1. 打开 **Actions** 标签页。如果 GitHub 提示，点 **I understand my workflows, go ahead and enable them**。
2. 点左侧的 **Scout**，再点 **Run workflow**，在 **What to run** 里选 **sample scan (a free test that uses no keys)**，点 **Run workflow**。这是一次免费测试，不会用到你的 key。
3. 运行结束后（一两分钟）点进去，summary 页面最上面是一张 **Setup check** 表（列出你的仓库配置了哪些 key，不会显示 key 的内容），下面是一份示例 digest。
4. 再运行一次 **Scout**，这次选 **scan**，就是第一次真实扫描。结果会显示在运行的 summary 页面上；完成第 4 步后也会推送到 Telegram。

## 4. Telegram chat id

1. 在 Telegram 里打开你的机器人，点 **Start**（想推送到群里的话，把机器人拉进群，在群里发一条消息）。
2. 在 **Actions** 里运行 **Telegram chat id**。它的 summary 页面会列出给机器人发过消息的聊天和对应的 id。
3. 把这个 id 加成 `TELEGRAM_CHAT_ID` 变量（同第 2 步）。

## 5. 你的偏好

偏好决定搜什么、跳过什么、怎么给活动打分，保存在你仓库里的 `scout.profile.yaml`。不用手改这个文件也能修改：

1. 在 **Actions** 里打开 **Preferences**，点 **Run workflow**。
2. 选一个操作：
   - **show my preferences**：用大白话显示当前偏好。
   - **change them**：写下想改什么，中英文都行，比如 `多一些 B2B go-to-market 的饭局，加上 climate tech，不要 crypto`。
   - **start over from a description**：描述你自己，比如 `我在一家 B2B SaaS 创业公司做 partnership，想参加有 founder 和企业买家的小型饭局`。
   - **undo the last change**：撤销上一次修改（再运行一次就是恢复）。
3. 运行的 summary 页面会列出具体改了什么。修改会保存到你的仓库，下一次扫描就会生效。

修改由你的 LLM 完成，保存前会按 profile 规则校验，而且不会碰你的 `sources` 部分。喜欢直接改文件的话，点 `scout.profile.yaml` 上的铅笔图标也可以；每个字段的含义见 [profiles](profiles.md)。

## 6. 运行时间

默认每天扫描两次：旧金山时间早上 9:17 左右和晚上 18:17 左右（冬令时会早一个小时，因为 GitHub 的定时任务按 UTC 时间运行）。早上那次还会搜 X。两次扫描用的搜索词不一样，晚上那次不是简单重复。

想改每天扫几次，设置 `SCANS_PER_DAY` 变量（同第 2 步）：

| `SCANS_PER_DAY` | 扫描时间 |
| --- | --- |
| `1` | 早上 |
| `2`（默认） | 早上和晚上 |
| `3` | 早上、中午（13:17）和晚上 |

扫得越多花得越多（[费用](setup-and-costs.zh-CN.md#要花多少钱)）。GitHub 的定时任务有时会晚几分钟启动。公开仓库如果 60 天没有提交，GitHub 会暂停定时任务；私有仓库不受影响。想换成别的时间，可以修改 `.github/workflows/scout.yml` 开头的 `cron` 行（以及下面 `if:` 里对应的几行）。

**每周漏检回顾。** 每周日晚上，scout 还会回头搜一遍过去一周里有没有好活动被日常扫描漏掉，把结果和原因（比如某个它还没读的日历）列在那次运行的 summary 页面上。这一项需要 Exa key。想现在就跑一次：**Run workflow → look back for missed events**。

## 在 dashboard 里看结果（可选）

GitHub Actions 本身没有 dashboard，推送就是结果。如果还想在 dashboard 里浏览、打分，可以让扫描结果存进一个免费数据库，再在自己电脑上打开 dashboard：

1. 在 [neon.com](https://neon.com) 免费建一个 Postgres 数据库，复制它的连接字符串（以 `postgresql://` 开头）。
2. 在你的仓库里把它加成 `DATABASE_URL` secret（同第 2 步）。从下一次扫描起，结果会存进这个数据库，而不是 Actions cache。
3. 在自己电脑上下载 scout 并运行 `npm start`（见 [README](../README.zh-CN.md#在自己电脑上运行)）。配置问到 **Cloud results** 时，粘贴同一个连接字符串，然后选 **Open the dashboard**。

## 其他须知

- **历史结果：** 每次扫描都会保留历史，所以同一个活动只会推荐一次。没有数据库时，历史保存在 Actions cache 里；删除 cache（**Actions → Caches**）就会从头开始。
- **更新：** 用 template 复制出来的仓库不会自动更新。想用新版本，可以重新复制一份再填一次 secret，或者用 git 从这个仓库合并。
- **关掉它：** 在 **Actions** 里打开 **Scout**，点 **…**，选 **Disable workflow**。
