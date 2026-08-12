create table tasks (
  id             bigint generated always as identity primary key,

  -- e.g. 'follow_up', 'complete_oa', 'review_application', 'answer_question'
  kind           text        not null,
  title          text        not null,
  detail         text,

  application_id bigint      references applications (id) on delete cascade,
  contact_id     bigint      references contacts (id) on delete cascade,
  job_id         bigint      references jobs (id) on delete cascade,
  interview_id   bigint      references interviews (id) on delete cascade,

  due_at         timestamptz,
  status         task_status not null default 'open',
  completed_at   timestamptz,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index tasks_open_idx on tasks (due_at nulls last) where status = 'open';
create index tasks_application_idx on tasks (application_id);
-- Don't queue two identical follow-up reminders for the same contact.
create unique index tasks_open_dedupe_idx
  on tasks (kind, coalesce(application_id, 0), coalesce(contact_id, 0))
  where status = 'open';

-- Append-only event log. Every timeline in the CRM is a query against this
-- table, which keeps history correct even when a row is later edited.
create table activity_events (
  id             bigint generated always as identity primary key,
  at             timestamptz not null default now(),

  -- e.g. 'job_discovered', 'job_scored', 'resume_generated', 'applied',
  -- 'outreach_sent', 'email_received', 'status_changed'
  kind           text        not null,
  message        text        not null,

  job_id         bigint      references jobs (id) on delete cascade,
  application_id bigint      references applications (id) on delete cascade,
  contact_id     bigint      references contacts (id) on delete set null,
  company_id     bigint      references companies (id) on delete set null,

  meta           jsonb       not null default '{}'::jsonb
);

create index activity_at_idx on activity_events (at desc);
create index activity_application_idx on activity_events (application_id, at);
create index activity_job_idx on activity_events (job_id, at);
create index activity_kind_idx on activity_events (kind, at desc);

comment on table activity_events is
  'Append-only. Never UPDATE or DELETE — the CRM timeline is derived from it.';

-- Bookkeeping for scheduled discovery runs, so a silently failing adapter is
-- visible rather than just producing no jobs.
create table discovery_runs (
  id             bigint generated always as identity primary key,
  source_id      bigint      references job_sources (id) on delete cascade,

  started_at     timestamptz not null default now(),
  finished_at    timestamptz,
  -- 'running' | 'ok' | 'error'
  status         text        not null default 'running',

  jobs_seen      integer     not null default 0,
  jobs_new       integer     not null default 0,
  jobs_updated   integer     not null default 0,
  jobs_duplicate integer     not null default 0,
  error          text
);

create index discovery_runs_source_idx on discovery_runs (source_id, started_at desc);
create index discovery_runs_recent_idx on discovery_runs (started_at desc);
