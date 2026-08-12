-- The master candidate profile. Singleton: `id` is pinned to 1 by a check
-- constraint so there is exactly one row and every join can hardcode it.

create table profile (
  id                  smallint primary key default 1 check (id = 1),

  -- Identity / application autofill
  full_name           text        not null,
  email               text        not null,
  phone               text,
  location            text,

  -- Education
  university          text        not null,
  degree              text        not null,
  major               text        not null,
  minor               text,
  graduation_date     date        not null,
  gpa                 numeric(3, 2) check (gpa is null or (gpa >= 0 and gpa <= 4.5)),

  -- Eligibility
  work_authorization  text        not null,
  needs_sponsorship   boolean     not null default false,

  -- Links
  github_url          text,
  linkedin_url        text,
  portfolio_url       text,

  -- Targeting. These drive both the deterministic prefilter and AI scoring.
  target_season       text        not null default 'Summer 2027',
  preferred_locations text[]      not null default '{}',
  target_categories   text[]      not null default '{}',
  target_companies    text[]      not null default '{}',

  -- Free-text summary used as context for tailoring and outreach.
  summary             text,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

comment on table profile is
  'Singleton master profile. Every fact here is verified by the user and is the '
  'only source the AI may draw on when writing resumes or answers.';
