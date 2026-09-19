# Run it every day on GitHub (no install)

English | [中文](github-actions.zh-CN.md)

This is the easiest way to get a daily digest: the scout runs in your own private copy of this
repository on GitHub's servers, and the picks arrive on Telegram. There is nothing to install and
no server to keep running, and it is all done in the browser. It takes about 10 minutes.

You need a free [GitHub account](https://github.com/signup), an LLM key, and a Telegram bot. Exa is
recommended too. [Setup and costs](setup-and-costs.md) says where to get each one and what it costs.
GitHub itself is free here: private repositories get 2,000 Actions minutes a month, and a scan uses
about 5–15.

## 1. Make your own copy

1. Open [github.com/Jerry-111/bay-area-event-scout](https://github.com/Jerry-111/bay-area-event-scout)
   and click **Use this template → Create a new repository**.
2. Pick a name (for example `my-event-scout`), choose **Private**, and click **Create repository**.

Everything below happens in your new copy.

## 2. Add your keys

In your copy, open **Settings → Secrets and variables → Actions**.

On the **Secrets** tab, click **New repository secret** for each key you have. Secrets are
encrypted and never shown in logs.

| Name | Needed? | Value |
| --- | --- | --- |
| `LLM_API_KEY` | Required | Your LLM key |
| `TELEGRAM_BOT_TOKEN` | Recommended | The token from @BotFather |
| `EXA_API_KEY` | Recommended | Your Exa key |
| `X_BEARER_TOKEN` | Optional | Your X API bearer token |
| `FIRECRAWL_API_KEY` | Optional | Your Firecrawl key |

On the **Variables** tab, click **New repository variable** for these settings:

| Name | Needed? | Value |
| --- | --- | --- |
| `LLM_PROVIDER` | Required | `openai`, `gemini`, `anthropic`, `deepseek`, `dashscope-intl`, `dashscope`, or `openrouter` |
| `SCOUT_PROFILE` | Optional | A starting point for your preferences: `b2b-saas-founder`, `climate-tech`, `fintech`, or `consumer-ai-founder` (the default) |
| `SCOUT_BUDGET` | Optional | `small` (the default here), `medium`, or `large`; see [costs](setup-and-costs.md#what-it-costs) |
| `LLM_MODEL` | Optional | A different model from your provider |
| `TELEGRAM_CHAT_ID` | Add in step 4 | Where the digest goes |

## 3. Try it

1. Open the **Actions** tab. If GitHub asks, click **I understand my workflows, go ahead and enable them**.
2. Click **Scout** on the left, then **Run workflow**. Tick **Use sample data** and click **Run workflow**.
   This free test checks the setup without using your keys.
3. When the run finishes (a minute or two), open it. The summary page shows a sample digest.
4. Run **Scout** again with the box unticked for your first real scan. Its digest shows up on the
   run's summary page, and on Telegram once step 4 is done.

## 4. Telegram chat id

1. In Telegram, open your bot and press **Start** (for a group, add the bot to the group and post a
   message there).
2. In **Actions**, run **Telegram chat id**. Its summary page lists the chats that messaged your bot,
   with their ids.
3. Add the id as the `TELEGRAM_CHAT_ID` variable (step 2).

## 5. Your preferences

Preferences decide what gets searched for, what gets skipped, and how events are scored. They live in
`scout.profile.yaml` in your copy. You can change them without editing that file:

1. In **Actions**, open **Preferences** and click **Run workflow**.
2. Pick what to do:
   - **show my preferences**: a plain-language summary.
   - **change them**: type what to change, in any language, for example
     `more B2B go-to-market dinners, add climate tech, no crypto`.
   - **start over from a description**: describe yourself, for example
     `I run partnerships at a B2B SaaS startup and want small dinners with founders and enterprise buyers`.
   - **undo the last change**: goes back one step (run it again to redo).
3. The run's summary page lists exactly what changed. The change is saved to your copy, and the next
   scan uses it.

Your LLM makes the change. The result is checked against the profile rules before it is saved, and
your `sources` section is never touched. If you like editing files, the pencil icon on
`scout.profile.yaml` works too; [profiles](profiles.md) explains every field.

## 6. Schedule

The scout runs once a day at 16:17 UTC (9:17 in San Francisco in summer, 8:17 in winter). To change
that, open `.github/workflows/scout.yml` in your copy, click the pencil icon, and edit the `cron`
line. Each line is one scan (times are UTC):

```yaml
    - cron: "17 16 * * *"   # 9:17 PDT
    - cron: "17 1 * * *"    # 18:17 PDT, a second scan each day
```

More scans cost more ([costs](setup-and-costs.md#what-it-costs)). GitHub sometimes starts
scheduled runs a few minutes late. In a public copy, GitHub pauses the schedule after 60 days with
no commits; private copies are not affected.

## Good to know

- **Past results:** each scan keeps its history in the Actions cache, so an event is only
  recommended once. Deleting the caches (**Actions → Caches**) starts fresh.
- **Dashboard:** this setup has no dashboard; the digest is the output. For the dashboard, run the
  scout on your computer (see the [README](../README.md)), or use the hosted setup in
  [operations](operations.md).
- **Updates:** a copy made from a template does not update itself. To pick up a new version, make a
  new copy and add your secrets again, or merge from this repository with git.
- **Turning it off:** in **Actions**, open **Scout**, click **…**, and choose **Disable workflow**.
