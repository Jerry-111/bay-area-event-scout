# 云端版：GitHub 每天自动扫描，dashboard 在你电脑上看

[English](github-actions.md) | 中文

这种用法里，scout 在 GitHub 的服务器上每天扫描两次（你的电脑关着也没关系），精选活动推送到 Telegram；结果同时存进一个免费数据库，你电脑上的 dashboard 随时打开就能看。在浏览器里配置大约 15 分钟，另外需要为 dashboard 装一次 Node.js。

你需要：

- 一个免费的 [GitHub 账号](https://github.com/signup)；
- 一个 LLM key 和一个 Telegram 机器人，最好再加一个 Exa key；
- 一个 [Neon](https://neon.com) 免费数据库。

每一项去哪里申请、要花多少钱，见[配置与费用](setup-and-costs.zh-CN.md)。GitHub 和 Neon 这部分都是免费的：私有仓库每月有 2,000 分钟 Actions 额度，每天扫两次大约用掉 300–900 分钟。

## 1. 复制一份你自己的仓库

1. 打开 [github.com/Jerry-111/bay-area-event-scout](https://github.com/Jerry-111/bay-area-event-scout)，点 **Use this template → Create a new repository**。
2. 起个名字（比如 `my-event-scout`），选 **Private**，点 **Create repository**。

下面所有操作都在你新建的这个仓库里进行。觉得好用的话，欢迎给原仓库点个 star，帮更多人找到它。

## 2. 建一个免费数据库

1. 在 [neon.com](https://neon.com) 注册，免费套餐不需要绑卡。
2. 新建一个项目（名字随意，地区选离你近的）。
3. 点 **Connect**，复制连接字符串。它以 `postgresql://` 开头，里面带密码，请像 key 一样保管。

扫描结果会存在这里，dashboard 也从这里读取。这一步可以跳过：跳过的话照样有 Telegram 推送和运行页面，只是没有 dashboard。

## 3. 填入你的 key

在你的仓库里打开 **Settings → Secrets and variables → Actions**。

在 **Secrets** 标签页，下面每一项点一次 **New repository secret**。Secret 是加密保存的，不会出现在日志里。

| 名称 | 是否必需 | 填什么 |
| --- | --- | --- |
| `LLM_API_KEY` | 必需 | 你的 LLM key |
| `DATABASE_URL` | 推荐 | 第 2 步复制的 Neon 连接字符串 |
| `TELEGRAM_BOT_TOKEN` | 推荐 | @BotFather 给你的 token |
| `EXA_API_KEY` | 推荐 | 你的 Exa key |
| `X_BEARER_TOKEN` | 可选 | 你的 X API Bearer Token |
| `FIRECRAWL_API_KEY` | 可选 | 你的 Firecrawl key |

在 **Variables** 标签页，每个设置点一次 **New repository variable**：

| 名称 | 是否必需 | 填什么 |
| --- | --- | --- |
| `LLM_PROVIDER` | 必需 | `openai`、`gemini`、`anthropic`、`deepseek`、`dashscope-intl`、`dashscope` 或 `openrouter` |
| `SCOUT_PROFILE` | 可选 | 偏好的起点：`b2b-saas-founder`、`climate-tech`、`fintech` 或 `consumer-ai-founder`（默认） |
| `SCANS_PER_DAY` | 可选 | `1`、`2`（默认）或 `3`，见[第 8 步](#8-运行时间) |
| `SCOUT_BUDGET` | 可选 | `small`（这里的默认值）、`medium` 或 `large`，见[费用](setup-and-costs.zh-CN.md#要花多少钱) |
| `LLM_MODEL` | 可选 | 换成同一家的其他模型 |
| `TELEGRAM_CHAT_ID` | 第 5 步再加 | 推送发到哪个聊天 |

## 4. 试运行

1. 打开 **Actions** 标签页。如果 GitHub 提示，点 **I understand my workflows, go ahead and enable them**。
2. 点左侧的 **Scout**，再点 **Run workflow**，在 **What to run** 里选 **sample scan (a free test that uses no keys)**，点 **Run workflow**。这是一次免费测试，不会用到你的 key。
3. 运行结束后（一两分钟）点进去，summary 页面最上面是一张 **Setup check** 表（列出你的仓库配置了哪些 key，不会显示 key 的内容），下面是一份示例 digest。
4. 再运行一次 **Scout**，这次选 **scan**，就是第一次真实扫描。结果会显示在运行的 summary 页面上；完成第 5 步后也会推送到 Telegram。

## 5. Telegram chat id

1. 在 Telegram 里打开你的机器人，点 **Start**（想推送到群里的话，把机器人拉进群，在群里发一条消息）。
2. 在 **Actions** 里运行 **Telegram chat id**。它的 summary 页面会列出给机器人发过消息的聊天和对应的 id。
3. 把这个 id 加成 `TELEGRAM_CHAT_ID` 变量（同第 3 步）。

## 6. 你的 dashboard

dashboard 是一个在你电脑上运行的小网站，用的时候打开就行。

1. 装一次 **Node.js 22 或更新版本**：从 [nodejs.org](https://nodejs.org/zh-cn/download) 下载 LTS 安装包，双击安装。
2. 在你自己仓库的 GitHub 页面点 **Code → Download ZIP**，解压（会用 git 的话直接 clone 你的仓库）。
3. 在那个文件夹里打开终端。Mac：打开"终端"，输入 `cd `（后面带一个空格），把文件夹拖进窗口，按回车。Windows：打开文件夹，点地址栏，输入 `cmd`，按回车。
4. 运行 `npm start`。它会问几个配置问题：LLM 和搜索 key 都直接按回车跳过（扫描在 GitHub 上跑）；问到 **Cloud results** 时，粘贴第 2 步的 Neon 连接字符串。然后选 **Open the dashboard**。

以后想看的时候运行 `npm start` 就行，浏览器会打开 dashboard，显示 GitHub 最新扫描的结果。看完在终端里按 Ctrl+C 关闭。

## 7. 你的偏好

偏好决定搜什么、跳过什么、怎么给活动打分，保存在你 GitHub 仓库里的 `scout.profile.yaml`，扫描用的就是这一份。不用手改这个文件也能修改：

1. 在 **Actions** 里打开 **Preferences**，点 **Run workflow**。
2. 选一个操作：
   - **show my preferences**：用大白话显示当前偏好。
   - **change them**：写下想改什么，中英文都行，比如 `多一些 B2B go-to-market 的饭局，加上 climate tech，不要 crypto`。
   - **start over from a description**：描述你自己，比如 `我在一家 B2B SaaS 创业公司做 partnership，想参加有 founder 和企业买家的小型饭局`。
   - **undo the last change**：撤销上一次修改（再运行一次就是恢复）。
3. 运行的 summary 页面会列出具体改了什么。修改会保存到你的仓库，下一次扫描就会生效。

修改由你的 LLM 完成，保存前会按 profile 规则校验，而且不会碰你的 `sources` 部分。喜欢直接改文件的话，点 `scout.profile.yaml` 上的铅笔图标也可以；每个字段的含义见 [profiles](profiles.md)。请在 GitHub 上修改，不要在电脑上改：电脑上那份只用来运行 dashboard。

## 8. 运行时间

默认每天扫描两次：旧金山时间早上 9:17 左右和晚上 18:17 左右（冬令时会早一个小时，因为 GitHub 的定时任务按 UTC 时间运行）。早上那次还会搜 X。两次扫描用的搜索词不一样，晚上那次不是简单重复。

想改每天扫几次，设置 `SCANS_PER_DAY` 变量（同第 3 步）：

| `SCANS_PER_DAY` | 扫描时间 |
| --- | --- |
| `1` | 早上 |
| `2`（默认） | 早上和晚上 |
| `3` | 早上、中午（13:17）和晚上 |

扫得越多花得越多（[费用](setup-and-costs.zh-CN.md#要花多少钱)）。GitHub 的定时任务有时会晚几分钟启动。公开仓库如果 60 天没有提交，GitHub 会暂停定时任务；私有仓库不受影响。想换成别的时间，可以修改 `.github/workflows/scout.yml` 开头的 `cron` 行（以及下面 `if:` 里对应的几行）。

**每周漏检回顾。** 每周日晚上，scout 还会回头搜一遍过去一周里有没有好活动被日常扫描漏掉，把结果和原因（比如某个它还没读的日历）列在那次运行的 summary 页面上。这一项需要 Exa key。想现在就跑一次：**Run workflow → look back for missed events**。

## 其他须知

- **历史结果：** 每次扫描都会保留历史，所以同一个活动只会推荐一次。有数据库时历史存在数据库里；没有时存在 Actions cache 里（在 **Actions → Caches** 删除 cache 就会从头开始）。
- **更新：** 用 template 复制出来的仓库不会自动更新。想用新版本，可以重新复制一份再填一次 secret，或者用 git 从这个仓库合并。
- **关掉它：** 在 **Actions** 里打开 **Scout**，点 **…**，选 **Disable workflow**。
