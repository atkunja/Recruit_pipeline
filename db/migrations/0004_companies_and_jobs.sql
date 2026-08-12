create table companies (
  id            bigint generated always as identity primary key,
  name          text        not null,
  -- Lowercased, punctuation-stripped name. The dedupe key for companies that
  -- appear as "Databricks", "Databricks, Inc." and "databricks" across sources.
  slug          text        not null,
  website       text,
  category      company_category not null default 'other',

  -- Which ATS this company posts on, learned from whichever adapter found it.
  ats_kind      source_kind,
  ats_slug      text,

  -- -2 avoid ... +2 dream company. Feeds the company-preference score.
  preference    smallint    not null default 0 check (preference between -2 and 2),
  notes         text,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create unique index companies_slug_key on companies (slug);
create index companies_category_idx on companies (category);
create index companies_preference_idx on companies (preference desc)
  where preference <> 0;

-- Registry of configured discovery adapters. One row per board we poll, e.g.
-- ('greenhouse', 'databricks'). Adding a source is an INSERT, not a deploy.
create table job_sources (
  id            bigint generated always as identity primary key,
  kind          source_kind not null,
  name          text        not null,
  -- Adapter-specific config, e.g. {"board":"databricks"} or {"url":"..."}.
  config        jsonb       not null default '{}'::jsonb,
  enabled       boolean     not null default true,

  -- Polling cadence and health, surfaced on the Sources admin screen.
  priority      smallint    not null default 0,
  last_run_at   timestamptz,
  last_status   text,
  last_error    text,
  consecutive_failures smallint not null default 0,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create unique index job_sources_kind_name_key on job_sources (kind, name);
create index job_sources_enabled_idx on job_sources (enabled, priority desc);

create table jobs (
  id              bigint generated always as identity primary key,
  company_id      bigint      not null references companies (id) on delete cascade,
  source_kind     source_kind not null,
  source_id       bigint      references job_sources (id) on delete set null,
  -- The board's own id for this posting, when it exposes one.
  source_job_id   text,

  title           text        not null,
  -- Lowercased title with seniority/season noise stripped; used for dedupe
  -- and for the deterministic title filter.
  normalized_title text       not null,

  url             text        not null,
  location_raw    text,
  locations       text[]      not null default '{}',
  is_remote       boolean     not null default false,

  description     text,
  requirements    text,
  preferred_qualifications text,
  compensation    text,

  season          text,
  posted_at       timestamptz,
  discovered_at   timestamptz not null default now(),
  closed_at       timestamptz,
  is_active       boolean     not null default true,

  -- sha256 of the description. Lets discovery skip re-scoring a listing whose
  -- text has not changed, which is the single biggest OpenAI cost saver.
  description_hash text,

  -- company_slug + normalized_title + primary location, hashed. Two rows with
  -- the same dedupe_key are the same real-world job posted to two boards.
  dedupe_key      text        not null,
  canonical_job_id bigint     references jobs (id) on delete set null,

  -- Deterministic prefilter outcome; only 'pass' rows ever reach the LLM.
  prefilter        prefilter_verdict not null default 'pending',
  prefilter_reasons text[]     not null default '{}',

  -- User actions taken straight from the Discover feed.
  is_ignored      boolean     not null default false,
  ignored_reason  text,

  raw             jsonb,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- A board's own id is the strongest identity we have; enforce it where present.
create unique index jobs_source_job_key
  on jobs (source_kind, source_job_id)
  where source_job_id is not null;

-- Fallback identity for sources that expose no id.
create unique index jobs_url_key on jobs (url);

create index jobs_dedupe_idx on jobs (dedupe_key);
create index jobs_company_idx on jobs (company_id);
create index jobs_discovered_idx on jobs (discovered_at desc);
create index jobs_active_prefilter_idx on jobs (prefilter, is_active)
  where is_active and not is_ignored;
create index jobs_canonical_idx on jobs (canonical_job_id)
  where canonical_job_id is not null;
create index jobs_season_idx on jobs (season) where is_active;

comment on column jobs.canonical_job_id is
  'When set, this row is a duplicate of another posting and is hidden from '
  'Discover. The row it points at is the one shown.';
