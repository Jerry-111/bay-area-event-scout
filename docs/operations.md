# Operations

## Local setup

Requirements: Node.js 22 or newer and pnpm 11 (`corepack enable` picks up the version pinned in
`package.json`). A conda environment is available in `environment.yml` if you prefer one.

```sh
pnpm install       # also builds the workspace
pnpm test          # typecheck + all unit tests
pnpm scout:mock    # full pipeline with sample data, no API keys
pnpm admin         # admin UI on http://127.0.0.1:4310
pnpm onboard       # guided setup of .env.local and your profile for real runs
```

`MOCK_MODE=true` is the default. It needs no Exa, X, Firecrawl, LLM, Telegram, Trigger.dev, or
Postgres credentials, and it never writes to a real database or sends a Telegram message.

The runtime reads `.env.local` from the working directory or any parent directory, then lets
exported shell variables override it. Run `pnpm scout:doctor` for a checklist of the resolved
profile, LLM provider, connectors, and storage (keys are never printed); `--live` also makes one
cheap test call per configured service, and `pnpm config:check` prints the same data as JSON.
(Use `pnpm scout:doctor`, not `pnpm doctor`, which is a pnpm built-in.)

## Environment

Real mode (`MOCK_MODE=false`) uses whatever is configured:

- `LLM_PROVIDER` + `LLM_API_KEY` for extraction, scoring, and planning — see [llm-providers.md](llm-providers.md).
- `SCOUT_PROFILE` or `scout.profile.yaml` for preferences — see [profiles.md](profiles.md).
- `EXA_API_KEY` and/or `X_BEARER_TOKEN` for discovery (optional: without them, scans read the
  public calendars and RSS feeds only).
- `FIRECRAWL_API_KEY` for page fetching (optional; plain fetch is the fallback).
- `DATABASE_URL` for Postgres (optional locally: without it, real runs are saved to a JSON file in
  `.scout-data/`, or `SCOUT_DATA_DIR`).
- `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` for the digest (optional).
- `TRIGGER_PROJECT_REF` + `TRIGGER_SECRET_KEY` for scheduled runs on Trigger.dev (optional).
- `ADMIN_USERNAME` + `ADMIN_PASSWORD` to protect the admin UI.

Budget: `SCOUT_BUDGET=small|medium|large` sets every per-scan cap at once (unset means `large`).
What each costs is in [setup and costs](setup-and-costs.md#what-it-costs).

| Cap | `small` | `medium` | `large` |
| --- | ---: | ---: | ---: |
| `MAX_EXA_SEARCHES_PER_RUN` (Exa queries, not raw results) | 10 | 20 | 40 |
| `MAX_X_POSTS_PER_DAY` (and `MAX_X_POSTS_PER_RUN`) | 25 | 50 | 150 |
| `MAX_FIRECRAWL_PAGES_PER_RUN` | 10 | 15 | 60 |
| `MAX_LLM_EXTRACT_CANDIDATES_PER_RUN` | 15 | 25 | 40 |
| `MAX_LLM_SCORE_EVENTS_PER_RUN` | 10 | 15 | 25 |

Setting any `MAX_*` variable overrides the budget's value for that cap. Other caps:

- `MAX_AGENT_GENERATED_EXA_QUERIES` caps planner-generated Exa queries (default: half of the Exa budget).
- `MAX_AGENT_GENERATED_X_QUERIES=0` keeps X on the scheduled official API searches.
- `MAX_EXPLORATION_BUDGET_PERCENT=50` share of the Exa budget reserved for planner queries.
- `MAX_RECOMMENDATIONS_PER_RUN=10`

Schedules: `SCAN_SCHEDULES=09:00,14:00,22:00` lists the Trigger.dev scans to run (a time left out
is skipped, so `SCAN_SCHEDULES=09:00` scans once a day), and `X_SCAN_SCHEDULES=09:00` the scans that
also search X.

Timeouts: `EXA_TIMEOUT_MS`, `X_TIMEOUT_MS`, `FIRECRAWL_TIMEOUT_MS`, `PAGE_FETCH_TIMEOUT_MS`,
`LLM_TIMEOUT_MS`, `TELEGRAM_TIMEOUT_MS`, `POSTGRES_CONNECTION_TIMEOUT_MS`, `POSTGRES_QUERY_TIMEOUT_MS`.

## Database

Where results are stored depends on the mode:

| Mode | Storage |
| --- | --- |
| `MOCK_MODE=true` | In memory, seeded with sample data. Nothing is written to disk. |
| Real mode, no `DATABASE_URL` | A JSON file at `.scout-data/store.json` in the repo root (override with `SCOUT_DATA_DIR`; relative paths resolve against the repo root). The worker and the dashboard share it, so `pnpm scout:real` then `pnpm admin` shows real results. The newest 30 runs are kept. |
| Real mode with `DATABASE_URL` | Postgres. Use this for hosted deployments (Trigger.dev containers have no persistent disk). |

Any Postgres 14+ works: Railway, [Neon](https://neon.com) (free tier), Supabase, or a local
container:

```sh
docker run -d --name scout-db -e POSTGRES_PASSWORD=scout -p 5432:5432 postgres:16
```

```env
DATABASE_URL=postgres://postgres:scout@localhost:5432/postgres
```

The schema lives in `packages/db/src/migrations`. Create the tables with:

```sh
MOCK_MODE=false pnpm db:migrate
```

In mock mode the migration command only validates that the migration files are readable.

Core tables: `runs`, `queries`, `candidate_urls`, `raw_pages`, `sources`, `source_edges`, `events`,
`event_sources`, `event_scores`, `recommendations`, `feedback`, `miss_hunts`, `missed_events`,
`prompt_versions`. `event_scores` records which model (or `heuristic`) and which profile produced
each score.

## Worker

```sh
pnpm scout:mock                                   # mock scan
pnpm scout:real                                   # real scan with your .env.local
pnpm --filter @event-scout/worker miss-hunt       # weekly miss hunt, on demand
```

Schedules (America/Los_Angeles), defined in `apps/worker/src/trigger`:

- `daily-scout-9am-pt` — full scan with X: `0 9 * * *`
- `daily-scout-2pm-pt` — light scan: `0 14 * * *`
- `daily-scout-10pm-pt` — light scan: `0 22 * * *`
- `weekly-miss-hunt-sunday-6pm-pt` — looks back for good events the scans missed: `0 18 * * 0`

Each scan follows the daily agenda described in [discovery.md](discovery.md), runs the search
planner, discovers candidates, extracts and scores events, stores everything, and sends the digest.
Runs record `scanMode`, `xEnabled`, `xPostsRead`, and `xBudgetRemaining` in `stats_json`; when X is
skipped by schedule or budget, a rejected marker candidate with
`rejectionReason=x_skipped_due_to_schedule_or_budget` records why.

Logs are readable one-liners when you run in a terminal, and one JSON object per line elsewhere
(Trigger.dev, CI, pipes). Override with `LOG_FORMAT=pretty|json`; `LOG_LEVEL=debug` also shows
per-candidate lines in the readable format (JSON always includes them).

Log lines to check after a run:

- `run started`: mode, active profile, and LLM provider/models.
- `search planner finished` / `search planner generated queries`: planner mode, query mix, novelty axes.
- `discovery started`: the final query mix.
- `pipeline quality summary`: candidates by platform/status/query group, rejection reasons, URL
  uniqueness, extraction yield, score distribution, top recommendations, and `qualityFlags` such as
  `low_extraction_yield` or `agent_queries_returned_no_candidates`.

On Trigger.dev, logs appear in the run's trace panel under `Attempt 1 -> run()`, and the `Metadata`
tab shows `stage`, `planner`, `discovery`, `extraction`, `output`, `qualitySummary`, and final `stats`.

Useful queries:

```sql
select run_type, started_at, status, stats_json from runs order by started_at desc limit 5;

select query_type, platform, count(*) as query_count
from queries where run_id = '<run_id>'
group by query_type, platform order by query_count desc;
```

### Small real runs

```sh
MAX_EXA_SEARCHES_PER_RUN=2 \
MAX_X_POSTS_PER_RUN=0 \
MAX_FIRECRAWL_PAGES_PER_RUN=3 \
MAX_LLM_EXTRACT_CANDIDATES_PER_RUN=3 \
MAX_LLM_SCORE_EVENTS_PER_RUN=2 \
MAX_RECOMMENDATIONS_PER_RUN=2 \
pnpm scout:debug:light
```

`pnpm scout:debug:full` runs the 09:00 agenda (including X) with the same kind of caps.

## Scheduling

Two ways to scan on a schedule:

- **GitHub Actions** (free, nothing to host): `.github/workflows/scout.yml` scans twice a day in
  your own copy of the repository (`SCANS_PER_DAY` = 1, 2, or 3), runs the weekly miss hunt, and
  keeps history in the Actions cache, or in Postgres when the `DATABASE_URL` secret is set (a local
  `npm start` dashboard pointed at the same database then shows those results). See
  [github-actions.md](github-actions.md).
- **Trigger.dev** (for a hosted team setup, below).

## Trigger.dev

1. Create a project at [cloud.trigger.dev](https://cloud.trigger.dev) and copy its project ref
   (`proj_...`) into `TRIGGER_PROJECT_REF`.
2. Copy the development secret key (`tr_dev_...`) into `TRIGGER_SECRET_KEY` for `pnpm trigger:dev`.
3. Add `LLM_*`, the connector keys, `DATABASE_URL`, Telegram, `SCOUT_PROFILE`, and `SCOUT_BUDGET`
   to the project's Production environment variables, then deploy:

```sh
TRIGGER_PROJECT_REF=<your-project-ref> pnpm trigger:dev
TRIGGER_PROJECT_REF=<your-project-ref> pnpm trigger:deploy --skip-sync-env-vars
```

`trigger.config.ts` bundles `profiles/*.yaml` and `scout.profile.yaml` with the tasks. Keep secrets
in the Trigger.dev and Railway secret stores; do not sync `.env.local` by accident. The free plan's
monthly credit covers three scans a day ([costs](setup-and-costs.md#where-it-runs)).

## Admin UI

```sh
pnpm admin                                   # http://127.0.0.1:4310, or set ADMIN_PORT
```

With `ADMIN_PASSWORD` set, users sign in with `ADMIN_USERNAME` and `ADMIN_PASSWORD` and get a signed
HttpOnly session cookie. Set `APP_BASE_URL` to the public admin URL so Telegram digests link to it.
See [admin-railway-deploy.md](admin-railway-deploy.md) for Railway.

The dashboard has four tabs, each with a shareable link:

- `#today` — **Act now** (at or above the profile's recommend bar and not sent before),
  **Worth a look** (the review band just under the bar), and **Hidden** (scored well but already
  sent or duplicated). Every list uses the same event card.
- `#history` — every recommendation the scout has sent, grouped by day.
- `#health` — recent runs with their funnel counts and rejected candidates grouped by reason.
- `#tuning` — the active profile, captured feedback, source/query yield, organizer yield, and misses
  found by the weekly miss hunt.

Endpoints: `GET /`, `GET /health`, `GET /api/dashboard`, `GET /api/runs`, `GET /api/events`,
`GET /api/recommendations`, `GET /api/candidates/rejected`, `POST /api/feedback`.

## Platform rules

- X is read through the official API only; the scout never automates the X website.
- LinkedIn is limited to publicly indexed results found through search; no logged-in automation,
  profile scraping, or attendee harvesting.
- Luma, Meetup, and Eventbrite are read from public pages only. Private or member-only events are
  found only when someone shares the link publicly (for example on X).
