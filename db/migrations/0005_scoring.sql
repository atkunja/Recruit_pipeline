-- AI fit scores. One row per (job, weights, description) triple so a re-run
-- with unchanged inputs is a cache hit rather than another OpenAI call.

create table job_scores (
  id             bigint generated always as identity primary key,
  job_id         bigint      not null references jobs (id) on delete cascade,

  total          smallint    not null check (total between 0 and 100),

  -- Per-component points and maxima, e.g.
  -- {"technical":{"score":34,"max":35,"reason":"..."}, ...}
  components     jsonb       not null default '{}'::jsonb,

  -- Explanations rendered on the job card and detail view.
  summary                text,
  strongest_experience_ids bigint[] not null default '{}',
  strongest_skills       text[]   not null default '{}',
  missing_requirements   text[]   not null default '{}',
  concerns               text[]   not null default '{}',
  emphasize              text[]   not null default '{}',

  -- Cache keys. weights_hash changes when the user retunes scoring;
  -- description_hash changes when the posting text changes.
  weights_hash   text        not null,
  description_hash text      not null,

  model          text        not null,
  created_at     timestamptz not null default now()
);

create unique index job_scores_cache_key
  on job_scores (job_id, weights_hash, description_hash);
create index job_scores_job_idx on job_scores (job_id, created_at desc);
create index job_scores_total_idx on job_scores (total desc);

comment on table job_scores is
  'Cache-keyed fit scores. Never delete rows to re-score; change the weights '
  'or the description and a new row is written alongside the old one.';
