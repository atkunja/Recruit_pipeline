-- Generated resumes. `content` is a structured document (not a PDF blob) so
-- the UI can diff it against the master and the PDF can be re-rendered at any
-- time without storing files.

create table resume_versions (
  id             bigint generated always as identity primary key,
  job_id         bigint      references jobs (id) on delete cascade,

  label          text        not null,
  is_master      boolean     not null default false,

  -- ResumeDocument: { header, education, sections[{ experienceId, bullets[] }],
  -- skills[] }. See src/lib/resume/types.ts.
  content        jsonb       not null,

  -- Every bullet id that appears in `content`, flattened. Lets us verify that
  -- nothing in the document came from outside the bullet bank.
  bullet_ids     bigint[]    not null default '{}',

  -- { changes: [{ kind, before, after, why }], omitted: [...] } — powers the
  -- "master → tailored, what changed and why" comparison view.
  rationale      jsonb       not null default '{}'::jsonb,

  -- Result of the anti-fabrication check run after generation.
  integrity_ok   boolean     not null default false,
  integrity_issues text[]    not null default '{}',

  model          text,
  approved       boolean     not null default false,
  approved_at    timestamptz,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- Exactly one master resume.
create unique index resume_versions_single_master
  on resume_versions ((true)) where is_master;
create index resume_versions_job_idx on resume_versions (job_id, created_at desc);

create table applications (
  id             bigint generated always as identity primary key,
  job_id         bigint      not null references jobs (id) on delete cascade,

  status         application_status not null default 'discovered',
  -- Higher sorts first in the Queue.
  priority       smallint    not null default 0,

  resume_version_id bigint   references resume_versions (id) on delete set null,

  prepared_at    timestamptz,
  applied_at     timestamptz,
  closed_at      timestamptz,

  -- Free-text scratchpad plus the next thing to do, surfaced on the dashboard.
  notes          text,
  next_action    text,
  next_action_at timestamptz,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- One application per job: applying twice to the same posting is the bug we
-- are preventing, so the database enforces it.
create unique index applications_job_key on applications (job_id);
create index applications_status_idx on applications (status, updated_at desc);
create index applications_next_action_idx on applications (next_action_at)
  where next_action_at is not null;

create table application_questions (
  id             bigint generated always as identity primary key,
  application_id bigint      not null references applications (id) on delete cascade,

  question       text        not null,
  answer         text,
  kind           question_kind not null default 'other',

  -- Self-identification / demographic questions. Never auto-answered unless a
  -- saved preference exists in `settings`.
  is_sensitive   boolean     not null default false,
  -- Set when the assistant could not answer confidently and needs the user.
  needs_review   boolean     not null default false,

  approved       boolean     not null default false,
  -- 'ai' | 'manual' | 'reused'
  source         text        not null default 'ai',
  -- When reused, the question row the answer came from.
  reused_from_id bigint      references application_questions (id) on delete set null,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index application_questions_app_idx on application_questions (application_id);
create index application_questions_review_idx on application_questions (needs_review)
  where needs_review;
-- Answer reuse looks up prior answers to the same question text.
create index application_questions_lookup_idx
  on application_questions (kind, lower(question));
