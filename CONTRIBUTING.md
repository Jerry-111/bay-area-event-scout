# Contributing to Bay Area Event Scout

Thanks for taking the time to contribute. This project runs entirely in **mock mode** with no API
keys, so you can build, test, and verify almost any change without signing up for anything.

## Development setup

Requirements: Node.js 22 (see `.nvmrc`; `corepack enable` picks up the pnpm version pinned in
`package.json`) and pnpm 11.

```sh
git clone <your fork>
cd <your fork>
pnpm install
cp .env.example .env.local   # MOCK_MODE=true by default — no keys needed
pnpm test                    # typecheck + all unit tests
pnpm scout:mock              # full pipeline on sample data
pnpm admin                   # dashboard at http://127.0.0.1:4310
```

A conda environment is also available in `environment.yml` if you prefer one. If you use Claude
Code, `.claude/launch.json` defines dashboard preview servers; `admin-mock` forces mock mode so a
preview never reads a real database.

## Running tests

`pnpm test` type checks every package (`tsc -b`) and then runs every unit test with Node's built-in
test runner (`node --test`). This is what CI runs, so it should pass before you open a PR.

While iterating on one package, it's faster to scope the run:

```sh
pnpm --filter @event-scout/shared test
pnpm --filter @event-scout/discovery test
pnpm --filter @event-scout/intelligence test
```

`.github/workflows/ci.yml` runs `pnpm test` and then a `pnpm scout:mock` smoke run on every push and
pull request, entirely in mock mode with no API keys or secrets. If your change needs a real key to
exercise fully (a new discovery connector, a new LLM provider against the live API), test that
locally with your own `.env.local` — CI will only ever run in mock mode.

## Repository layout

- `apps/worker` — the scheduled scout and weekly miss-hunt jobs (Trigger.dev tasks in `src/trigger`)
- `apps/admin` — the server-rendered dashboard
- `packages/discovery` — connectors, query packs, the source registry, and candidate filtering
- `packages/intelligence` — page fetching, the LLM client, extraction, scoring, and dedupe
- `packages/notify` — the Telegram digest
- `packages/db` — the Postgres schema and storage (in-memory in mock mode)
- `packages/shared` — env loading, the scout profile schema, and LLM provider configuration
- `profiles/` — preset scout profiles
- `docs/` — [profiles](docs/profiles.md), [LLM providers](docs/llm-providers.md),
  [scoring](docs/scoring.md), [discovery](docs/discovery.md), [operations](docs/operations.md)

See [README.md](README.md) for the full pipeline overview.

## Ground rules

- **Never commit secrets or `.env.local`.** It's gitignored; `.env.example` is the template new
  variables should be added to.
- **Keep `MOCK_MODE=true` working without any API keys.** It's how CI, code review, and new
  contributors verify a change, so mock-mode code paths (`env.mockMode` checks, deterministic sample
  data) aren't optional extras — they're part of the feature.
- **PRs must pass `pnpm test`.**
- **Don't add personal information** — names, emails, company names, private endpoints, or
  production URLs — to code, docs, or commit messages. If a contribution needs a real person's
  handle or name (for example a new X account in the source registry), make sure it's the kind of
  public, professional handle that already appears in `packages/discovery/src/source-registry.ts`,
  not private contact information.

## Common contributions

### 1. Add a source to the source registry

Built-in Bay Area sources live in `FREE_PUBLIC_SOURCES` in
[`packages/discovery/src/source-registry.ts`](packages/discovery/src/source-registry.ts). Each entry
is a `RegistrySource`:

| Field | Notes |
| --- | --- |
| `id` | Unique, kebab-case (`luma-sf`, `x-swyx`). Used for dedupe and for `profile.sources.disable`. |
| `name` | Human-readable name shown in logs and the admin UI. |
| `kind` | `luma_calendar` \| `rss_feed` \| `event_digest` \| `organizer_site` \| `indexed_source` \| `x_account`. Picks which connector reads it: `public_source` fetches `luma_calendar`/`event_digest`/`organizer_site` pages directly, `rss` reads `feedUrl`, `x` reads `x_account` handles/queries through the X API, and `indexed_source` has no direct fetch — it's Exa-only recall via `queryText`. |
| `priority` | `must_scan` \| `high` \| `medium` \| `paused`. Controls how often it's included in the rotating daily agenda — see below. |
| `url` / `feedUrl` / `handle` / `queryText` | Provide whichever your `kind` needs: a page `url` for calendars/digests/organizer sites, `feedUrl` for RSS, `handle` for an X account, and/or a `queryText` Exa search query for indexed recall. |
| `includeDomains` | Restricts Exa results for this source's query to these domains. |
| `sourceScore` / `maxCandidateLinks` | Optional tuning for ranking and how many links to pull from a page. |
| `tags` | Freeform labels (platform, topic, city). A profile's `sources.disable` can name either a source `id` or a `tag` to drop a whole group at once. |
| `notes` | Free text explaining why the source is worth scanning — read by maintainers, not by the pipeline. |

**Priority and rotation:** scheduled scans don't scan every source every run. `must_scan` sources get
the morning full scan plus one rotating light-scan slot; `high`/`medium` sources rotate across scan
windows and days by source id (`sourceRotationSlot` in
[`packages/discovery/src/query-packs.ts`](packages/discovery/src/query-packs.ts)); `paused` sources
are skipped by scheduled scans entirely (kept for manual runs or historical context). See
[docs/discovery.md](docs/discovery.md) and [docs/free-source-strategy.md](docs/free-source-strategy.md)
for the full rationale.

**To add a source:**

1. Add an entry to `FREE_PUBLIC_SOURCES`.
2. Add or extend a test in
   [`packages/discovery/src/discovery.test.ts`](packages/discovery/src/discovery.test.ts) — for
   example, assert your source id appears in `registrySourcesForProfile(...)` or in a built query
   pack.
3. Run `pnpm --filter @event-scout/discovery test` (or `pnpm test` from the root).
4. `pnpm scout:mock` exercises the full pipeline end to end; in mock mode every connector returns
   deterministic sample candidates, so it confirms nothing throws but doesn't hit your new URL/feed.
   To verify the fetch itself, run locally with `MOCK_MODE=false` and the relevant key
   (`EXA_API_KEY` and/or `X_BEARER_TOKEN`) — never in CI, and never commit those keys.

### 2. Contribute a profile preset

Presets live in `profiles/*.yaml`; the field reference is in [docs/profiles.md](docs/profiles.md).

1. Copy an existing preset as a starting point: `cp profiles/consumer-ai-founder.yaml profiles/your-persona.yaml`.
2. Edit `persona`, `region`, `topics` (positive `weight` boosts, negative penalizes, `0` is neutral),
   `audience`, `formats.prefer`/`formats.avoid`, `hubs`, `exclude.{formats,topics,eligibility}`,
   `search.phrases`/`search.rooms`, `notes`, `thresholds.recommend`/`thresholds.review` (`review` must
   be lower than `recommend`), and optionally `sources.disable`/`sources.add`.
3. The file name becomes the preset name for `SCOUT_PROFILE=your-persona`; leave `name` out of the
   YAML and it defaults to the file name.
4. You don't need to add a new test case per preset:
   [`packages/shared/src/profile.test.ts`](packages/shared/src/profile.test.ts) has a test, "every
   preset in `profiles/` is a valid profile", that discovers every file under `profiles/`
   automatically and asserts it parses and that `thresholds.review < thresholds.recommend`. Just make
   sure `pnpm test` (or `pnpm --filter @event-scout/shared test`) passes.
5. Locally, `pnpm scout:doctor` shows the resolved profile and which LLM provider/connectors are
   configured, without printing any keys.

### 3. Add an LLM provider preset

Provider presets live in `LLM_PRESETS` in
[`packages/shared/src/llm-config.ts`](packages/shared/src/llm-config.ts). Each entry is an
`LlmPreset`:

- `label` — shown in logs and the provider table.
- `apiStyle` — `chat` (OpenAI-compatible Chat Completions), `responses` (OpenAI-compatible Responses
  API), or `anthropic` (the Anthropic Messages API).
- `baseUrl` — the default API base URL.
- `models` — `{ extract, score, fast }`; use the `sameModel(id)` helper if one model handles all
  three jobs.
- `keyEnv` — provider-specific env var names checked (in order) when `LLM_API_KEY` is empty.
- `keyOptional` (optional) — set `true` for something like a local server that needs no key.
- `extraBody` (optional) — JSON merged into every request, e.g. DashScope's `{ enable_thinking: false }`.

**To add a provider:**

1. Add the entry to `LLM_PRESETS`.
2. Add coverage in [`packages/shared/src/profile.test.ts`](packages/shared/src/profile.test.ts),
   which already exercises `resolveLlmConfig` for the built-in presets (see "an LLM provider is only
   used when `LLM_PROVIDER` selects it" and "custom OpenAI-compatible endpoints need a base URL and
   model but no key" for the pattern to follow). At minimum, assert that `LLM_PROVIDER=<yours>`
   resolves the expected `baseUrl`/`apiStyle`/default models, and that it's `enabled` only once a key
   (or `keyOptional`) is satisfied. `resolveLlmConfig` is pure env-in/config-out, so no network access
   or real key is needed to test it.
3. Add a row to the provider table in [docs/llm-providers.md](docs/llm-providers.md) with the API
   style, default base URL, default models, and key variable.
4. Run `pnpm --filter @event-scout/shared test` (or `pnpm test`).

## Opening a pull request

Fill out `.github/pull_request_template.md` (what changed, how you tested it, the checklist). Small,
focused PRs are easier to review than large ones — if you're adding several unrelated sources or
presets, consider splitting them up.
