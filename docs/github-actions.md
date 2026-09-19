# Run it every day on GitHub (no install)

English | [中文](github-actions.zh-CN.md)

This is the easiest way to get a daily digest: the scout runs twice a day in your own private copy
of this repository on GitHub's servers, and the picks arrive on Telegram. Your computer can be off.
There is nothing to install and no server to keep running, and it is all done in the browser. It
takes about 10 minutes.

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
| `DATABASE_URL` | Optional | Only for a dashboard; see [below](#see-your-results-in-a-dashboard-optional) |

On the **Variables** tab, click **New repository variable** for these settings:

| Name | Needed? | Value |
| --- | --- | --- |
| `LLM_PROVIDER` | Required | `openai`, `gemini`, `anthropic`, `deepseek`, `dashscope-intl`, `dashscope`, or `openrouter` |
| `SCOUT_PROFILE` | Optional | A starting point for your preferences: `b2b-saas-founder`, `climate-tech`, `fintech`, or `consumer-ai-founder` (the default) |
| `SCANS_PER_DAY` | Optional | `1`, `2` (the default), or `3`; see [step 6](#6-schedule) |
| `SCOUT_BUDGET` | Optional | `small` (the default here), `medium`, or `large`; see [costs](setup-and-costs.md#what-it-costs) |
| `LLM_MODEL` | Optional | A different model from your provider |
| `TELEGRAM_CHAT_ID` | Add in step 4 | Where the digest goes |

## 3. Try it

1. Open the **Actions** tab. If GitHub asks, click **I understand my workflows, go ahead and enable them**.
2. Click **Scout** on the left, then **Run workflow**. Under **What to run**, pick
   **sample scan (a free test that uses no keys)** and click **Run workflow**.
3. When the run finishes (a minute or two), open it. The summary page starts with a **Setup check**
   table (which keys your copy has, never their values), followed by a sample digest.
4. Run **Scout** again with **scan** for your first real scan. Its digest shows up on the run's
   summary page, and on Telegram once step 4 is done.

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

The scout scans twice a day by default: around 9:17 in the morning and 18:17 in the evening, San
Francisco time (an hour earlier in winter, since GitHub schedules run on UTC). The morning scan
also searches X. The two scans use different searches, so the evening one is not a repeat.

To change how often it scans, set the `SCANS_PER_DAY` variable (step 2):

| `SCANS_PER_DAY` | Scans |
| --- | --- |
| `1` | Morning |
| `2` (default) | Morning and evening |
| `3` | Morning, midday (13:17), and evening |

More scans cost more ([costs](setup-and-costs.md#what-it-costs)). GitHub sometimes starts scheduled
runs a few minutes late. In a public copy, GitHub pauses schedules after 60 days with no commits;
private copies are not affected. To choose other times, edit the `cron` lines at the top of
`.github/workflows/scout.yml` (and the matching lines in its `if:` below them).

**Weekly look back.** Every Sunday evening the scout also searches the past week for good events
the daily scans missed, and lists them on that run's summary page with the reason (for example, a
calendar it does not read yet). It needs the Exa key. To run it now: **Run workflow → look back for
missed events**.

## See your results in a dashboard (optional)

GitHub Actions has no dashboard; the digest is the output. To also browse and rate events in the
dashboard, have the scans save to a free database, and open the dashboard on your computer:

1. Create a free Postgres database at [neon.com](https://neon.com) and copy its connection string
   (it starts with `postgresql://`).
2. In your copy, add it as the `DATABASE_URL` secret (step 2). From the next scan on, results are
   saved there instead of the Actions cache.
3. On your computer, get the scout and run `npm start` (see the [README](../README.md#on-your-computer)).
   When setup asks about **Cloud results**, paste the same connection string, then choose
   **Open the dashboard**.

## Good to know

- **Past results:** each scan keeps its history, so an event is only recommended once. Without a
  database it lives in the Actions cache; deleting the caches (**Actions → Caches**) starts fresh.
- **Updates:** a copy made from a template does not update itself. To pick up a new version, make a
  new copy and add your secrets again, or merge from this repository with git.
- **Turning it off:** in **Actions**, open **Scout**, click **…**, and choose **Disable workflow**.
