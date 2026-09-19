# Discovery

Discovery (`packages/discovery`) finds candidate event URLs. It never logs in to Luma, Meetup,
Eventbrite, LinkedIn, or X; it uses official APIs and public pages only. Search terms come from the
active [scout profile](profiles.md).

## Connectors

| Connector | What it reads | Needs |
| --- | --- | --- |
| `exa` | Exa search over Luma, public Meetup/Eventbrite pages, organizer sites, newsletters, and publicly indexed LinkedIn posts | `EXA_API_KEY` |
| `x` | X API v2 recent search (`GET /2/tweets/search/recent`), expanding links in posts | `X_BEARER_TOKEN` |
| `public_source` | Direct fetches of public calendars and digest pages from the source registry, extracting event links | nothing |
| `rss` | Public RSS/Atom feeds of newsletters and event roundups | nothing |
| `luma_seed` | Known public Luma calendar URLs, kept as source-graph anchors (not treated as events) | nothing |

A connector whose key is missing logs a warning and returns nothing in real mode; the others still
run. With `MOCK_MODE=true` every connector returns deterministic sample candidates.

X is the connector that finds small, lightly advertised events: hosts often post a Luma or Partiful
link only on X. X searches run once a day by default (`X_SCAN_SCHEDULES`) and are capped by
`MAX_X_POSTS_PER_RUN` and `MAX_X_POSTS_PER_DAY`.

## Query packs

`buildDailyQueryPack(now, { scanTime, profile })` builds the static queries for a scan:

- **Agenda queries** combine the profile's `search.phrases`, `search.rooms`, `formats.prefer`,
  cities, and region aliases into Luma, Meetup, Eventbrite, semantic web, source-discovery, indexed
  LinkedIn, and X queries. Excluded formats become search operators (`-hackathon -buildathon -webinar`).
- **Registry queries** come from `packages/discovery/src/source-registry.ts`, the curated list of
  SF Bay Area calendars, digests, newsletters, organizer sites, and X accounts, minus anything the
  profile disables and plus anything it adds.

Scheduled scans rotate through a daily agenda instead of repeating one pack:

- `09:00` (full): broad source refresh, RSS/newsletters, X API, must-scan calendars, general discovery.
- `14:00` (light): a different slice of the registry plus nearby-city, VC, operator, and roundtable queries.
- `22:00` (light): another slice plus this-week/next-week, RSVP, and roundup queries.

Registry sources rotate across windows and days by source id, so adjacent scans see different
sources. Calling `buildDailyQueryPack` without `scanTime` returns the broad pack for debugging.

## Agentic search planner

Before discovery, `apps/worker/src/jobs/search-planner.ts` asks the fast LLM for extra Exa queries
that increase variety. The prompt includes the profile, recent queries and event titles (to avoid
repeats), and organizers behind recent recommendations (to follow up on good hosts). Planned queries
must name a local place and must not target an excluded format. By default they fill 50% of
`MAX_EXA_SEARCHES_PER_RUN`, capped by `MAX_AGENT_GENERATED_EXA_QUERIES`. Without an LLM, a
deterministic planner fills the same slots from profile-based query axes.

## Candidate handling

- URLs are normalized (lowercased host, no `www.`, no tracking parameters, sorted query string).
- Weak candidates are stored with a `rejectionReason` instead of being dropped, so the admin Health
  tab can explain every drop: explicit past dates, profile exclusions, promotional junk, and indexed
  LinkedIn results without event evidence.
- Before extraction, candidates are deduped by canonical URL and ranked by a 0-100 signal score
  built from the profile's terms plus platform and page-type hints, then interleaved across sources
  so one noisy query cannot fill the extraction budget.

## Source graph and storage

`buildSourceGraph` records sources (X accounts, Luma calendars, Meetup groups, newsletters, organizer
sites) and edges from sources to candidates. `ingestCandidates` writes queries, candidate URLs,
sources, and edges through a `DiscoveryRepository`: in memory for tests and mock mode, Postgres when
`MOCK_MODE=false` and `DATABASE_URL` is set. `event_sources` attribution then shows which sources
actually produce recommended events, so noisy sources can be demoted or disabled in the profile.

## Smoke test with real keys

```env
MOCK_MODE=false
MAX_EXA_SEARCHES_PER_RUN=1
MAX_X_POSTS_PER_RUN=1
```
