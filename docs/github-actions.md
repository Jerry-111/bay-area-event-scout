# Cloud setup: daily scans on GitHub, dashboard on your computer

English | [中文](github-actions.zh-CN.md)

In this setup the scout scans twice a day on GitHub's servers, even when your computer is off, and
sends the picks to Telegram. Results are saved in a free database, and the dashboard on your
computer reads them whenever you open it. Setting it up takes about 15 minutes in the browser,
plus installing Node.js once for the dashboard.

You need:

- a free [GitHub account](https://github.com/signup);
- an LLM key and a Telegram bot, plus an Exa key, which is recommended;
- a free database from [Neon](https://neon.com).

[Setup and costs](setup-and-costs.md) says where to get each key and what it costs. GitHub and
Neon are free here. Private repositories get 2,000 Actions minutes a month, and two scans a day
use about 300–900 of them.

## 1. Make your own copy

1. Open [github.com/Jerry-111/bay-area-event-scout](https://github.com/Jerry-111/bay-area-event-scout)
   and click **Use this template → Create a new repository**.
2. Pick a name (for example `my-event-scout`), choose **Private**, and click **Create repository**.

Everything below happens in your new copy. If the scout is useful to you, a star on the original
repository helps other people find it.

## 2. Create a free database

1. Sign up at [neon.com](https://neon.com). The free plan needs no card.
2. Create a project (any name, and the region closest to you).
3. Click **Connect** and copy the connection string. It starts with `postgresql://` and contains a
   password, so treat it like a key.

The scans save their results here, and your dashboard reads them. You can skip this step; you then
get the Telegram digest and the run pages, but no dashboard.

## 3. Add your keys

In your copy, open **Settings → Secrets and variables → Actions**.

On the **Secrets** tab, click **New repository secret** for each of these. Secrets are encrypted
and never shown in logs.

| Name | Needed? | Value |
| --- | --- | --- |
| `LLM_API_KEY` | Required | Your LLM key |
| `DATABASE_URL` | Recommended | The Neon connection string from step 2 |
| `TELEGRAM_BOT_TOKEN` | Recommended | The token from @BotFather |
| `EXA_API_KEY` | Recommended | Your Exa key |
| `X_BEARER_TOKEN` | Optional | Your X API bearer token |
| `FIRECRAWL_API_KEY` | Optional | Your Firecrawl key |

On the **Variables** tab, click **New repository variable** for these settings:

| Name | Needed? | Value |
| --- | --- | --- |
| `LLM_PROVIDER` | Required | `openai`, `gemini`, `anthropic`, `deepseek`, `dashscope-intl`, `dashscope`, or `openrouter` |
| `SCOUT_PROFILE` | Optional | A starting point for your preferences: `b2b-saas-founder`, `climate-tech`, `fintech`, or `consumer-ai-founder` (the default) |
| `SCANS_PER_DAY` | Optional | `1`, `2` (the default), or `3`; see [step 8](#8-schedule) |
| `SCOUT_BUDGET` | Optional | `small` (the default here), `medium`, or `large`; see [costs](setup-and-costs.md#what-it-costs) |
| `LLM_MODEL` | Optional | A different model from your provider |
| `TELEGRAM_CHAT_ID` | Add in step 5 | Where the digest goes |

## 4. Try it

1. Open the **Actions** tab. If GitHub asks, click **I understand my workflows, go ahead and enable them**.
2. Click **Scout** on the left, then **Run workflow**. Under **What to run**, pick
   **sample scan (a free test that uses no keys)** and click **Run workflow**.
3. When the run finishes (a minute or two), open it. The summary page starts with a **Setup check**
   table (which keys your copy has, never their values), followed by a sample digest.
4. Run **Scout** again with **scan** for your first real scan. Its digest shows up on the run's
   summary page, and on Telegram once step 5 is done.

## 5. Telegram chat id

1. In Telegram, open your bot and press **Start** (for a group, add the bot to the group and post a
   message there).
2. In **Actions**, run **Telegram chat id**. Its summary page lists the chats that messaged your bot,
   with their ids.
3. Add the id as the `TELEGRAM_CHAT_ID` variable (step 3).

## 6. Your dashboard

The dashboard is a small website that runs on your computer while you use it.

1. Install **Node.js 22 or newer** once: download the LTS installer from
   [nodejs.org](https://nodejs.org/en/download) and run it.
2. On your copy's GitHub page, click **Code → Download ZIP** and unzip it. If you use git, clone
   your copy instead.
3. Open a terminal in that folder. On a Mac: open Terminal, type `cd ` (with a space), drag the
   folder onto the window, and press Enter. On Windows: open the folder, click its address bar,
   type `cmd`, and press Enter.
4. Run `npm start`. Setup asks a few questions; press Enter to skip the LLM and search keys, since
   the scans run on GitHub. When it asks about **Cloud results**, paste the Neon connection string
   from step 2. Then choose **Open the dashboard**.

From then on, run `npm start` whenever you want to look. The dashboard opens in your browser with
the latest results from GitHub's scans. Press Ctrl+C in the terminal when you're done.

## 7. Your preferences

Preferences decide what gets searched for, what gets skipped, and how events are scored. They live in
`scout.profile.yaml` in your copy on GitHub, and that is the version the scans use. You can change
them without editing that file:

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
`scout.profile.yaml` works too; [profiles](profiles.md) explains every field. Make changes on
GitHub rather than on your computer: the local copy only runs the dashboard.

## 8. Schedule

The scout scans twice a day by default: around 9:17 in the morning and 18:17 in the evening, San
Francisco time (an hour earlier in winter, since GitHub schedules run on UTC). The morning scan
also searches X. The two scans use different searches, so the evening one is not a repeat.

To change how often it scans, set the `SCANS_PER_DAY` variable (step 3):

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

## Good to know

- **Past results:** each scan keeps its history, so an event is only recommended once. With the
  database it lives there; without it, in the Actions cache (deleting the caches under
  **Actions → Caches** starts fresh).
- **Updates:** a copy made from a template does not update itself. To pick up a new version, make a
  new copy and add your secrets again, or merge from this repository with git.
- **Turning it off:** in **Actions**, open **Scout**, click **…**, and choose **Disable workflow**.
