create table if not exists runs (
  id text primary key,
  run_type text not null check (run_type in ('daily', 'miss_hunt', 'manual')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null check (status in ('running', 'succeeded', 'failed')),
  error text,
  stats_json jsonb not null default '{}'::jsonb
);

create table if not exists queries (
  id text primary key,
  run_id text references runs(id) on delete cascade,
  query_text text not null,
  query_type text not null,
  platform text not null,
  budget_cost integer not null default 1,
  created_at timestamptz not null default now()
);

create table if not exists candidate_urls (
  id text primary key,
  run_id text not null references runs(id) on delete cascade,
  url text not null,
  canonical_url text not null,
  source_platform text not null,
  source_query text,
  source_id text,
  title text,
  snippet text,
  status text not null default 'new',
  rejection_reason text,
  discovered_at timestamptz not null default now()
);

create index if not exists candidate_urls_run_id_idx on candidate_urls(run_id);
create index if not exists candidate_urls_status_idx on candidate_urls(status);
create index if not exists candidate_urls_canonical_url_idx on candidate_urls(canonical_url);

create table if not exists raw_pages (
  id text primary key,
  candidate_url_id text not null references candidate_urls(id) on delete cascade,
  fetch_method text not null check (fetch_method in ('firecrawl', 'fetch', 'exa_contents')),
  status text not null,
  title text,
  text text,
  markdown text,
  error text,
  fetched_at timestamptz not null default now()
);

create table if not exists sources (
  id text primary key,
  source_type text not null,
  name text not null,
  url text,
  handle text,
  quality_score numeric not null default 0,
  noise_rate numeric not null default 0,
  freshness_score numeric not null default 0,
  events_found_count integer not null default 0,
  recommended_events_count integer not null default 0,
  last_seen_at timestamptz
);

create table if not exists source_edges (
  id text primary key,
  source_id text not null references sources(id) on delete cascade,
  target_source_id text not null references sources(id) on delete cascade,
  edge_type text not null,
  weight numeric not null default 1,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create table if not exists events (
  id text primary key,
  dedupe_key text not null,
  canonical_url text not null,
  title text not null,
  description text,
  start_at timestamptz,
  end_at timestamptz,
  timezone text,
  city text,
  venue_text text,
  location_precision text not null default 'unknown',
  hosts_json jsonb not null default '[]'::jsonb,
  organizers_json jsonb not null default '[]'::jsonb,
  visibility_flags_json jsonb not null default '[]'::jsonb,
  registration_status text,
  event_type text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  status text not null default 'active'
);

create index if not exists events_dedupe_key_idx on events(dedupe_key);
create index if not exists events_start_at_idx on events(start_at);

create table if not exists event_sources (
  id text primary key,
  event_id text not null references events(id) on delete cascade,
  candidate_url_id text not null references candidate_urls(id) on delete cascade,
  source_platform text not null,
  created_at timestamptz not null default now(),
  unique(event_id, candidate_url_id)
);

create table if not exists event_scores (
  id text primary key,
  event_id text not null references events(id) on delete cascade,
  run_id text not null references runs(id) on delete cascade,
  model text not null,
  prompt_version text not null,
  total_score numeric not null,
  breakdown_json jsonb not null default '{}'::jsonb,
  penalties_json jsonb not null default '[]'::jsonb,
  should_recommend boolean not null default false,
  rationale text,
  next_action text,
  created_at timestamptz not null default now()
);

create index if not exists event_scores_run_id_idx on event_scores(run_id);
create index if not exists event_scores_total_score_idx on event_scores(total_score desc);

create table if not exists recommendations (
  id text primary key,
  run_id text not null references runs(id) on delete cascade,
  event_id text not null references events(id) on delete cascade,
  score numeric not null,
  reason text not null,
  created_at timestamptz not null default now(),
  unique(run_id, event_id)
);

create table if not exists feedback (
  id text primary key,
  event_id text not null references events(id) on delete cascade,
  feedback_type text not null,
  note text,
  created_at timestamptz not null default now()
);

create table if not exists miss_hunts (
  id text primary key,
  run_id text not null references runs(id) on delete cascade,
  week_start date not null,
  week_end date not null,
  status text not null,
  summary_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists missed_events (
  id text primary key,
  miss_hunt_id text references miss_hunts(id) on delete cascade,
  title text not null,
  url text,
  happened_at timestamptz,
  miss_reason text not null,
  evidence_json jsonb not null default '[]'::jsonb,
  suggestion text,
  created_at timestamptz not null default now()
);

create table if not exists prompt_versions (
  id text primary key,
  name text not null,
  version text not null,
  model text,
  prompt_hash text not null,
  prompt_text text not null,
  created_at timestamptz not null default now(),
  unique(name, version)
);
