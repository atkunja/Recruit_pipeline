-- Experiences are stored separately from the bullets that describe them, so a
-- tailored resume can pick a different subset of bullets per job without ever
-- restating the underlying experience.

create table experiences (
  id            bigint generated always as identity primary key,
  kind          experience_kind not null,
  organization  text        not null,
  title         text        not null,
  location      text,
  start_date    date        not null,
  end_date      date,
  is_current    boolean     not null default false,

  -- One-line context the AI may summarise but never extend.
  description   text,

  technologies  text[]      not null default '{}',
  categories    text[]      not null default '{}',
  url           text,

  -- Manual ordering on the master resume.
  display_order integer     not null default 0,

  -- Guard rail: unverified rows are never eligible for a generated resume.
  verified      boolean     not null default true,
  is_active     boolean     not null default true,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint experiences_dates_ordered
    check (end_date is null or end_date >= start_date),
  constraint experiences_current_has_no_end
    check (not is_current or end_date is null)
);

create index experiences_kind_idx on experiences (kind) where is_active;
create index experiences_order_idx on experiences (display_order, start_date desc);
create index experiences_categories_idx on experiences using gin (categories);
create index experiences_technologies_idx on experiences using gin (technologies);

-- The bullet bank. `canonical_text` is the user-verified wording; the AI may
-- select, reorder, shorten or rephrase it, but the canonical row is what any
-- generated variant is checked against.
create table resume_bullets (
  id             bigint generated always as identity primary key,
  experience_id  bigint      not null references experiences (id) on delete cascade,

  canonical_text text        not null,

  skills         text[]      not null default '{}',
  technologies   text[]      not null default '{}',
  -- Quantitative claims stated in the bullet, e.g. '40% latency reduction'.
  -- Extracted so a generated variant can be checked for invented numbers.
  metrics        text[]      not null default '{}',
  keywords       text[]      not null default '{}',
  categories     text[]      not null default '{}',

  -- 1-10, how strong this bullet is in isolation. Ties are broken by relevance
  -- to the specific job at tailoring time.
  strength       smallint    not null default 5
                   check (strength between 1 and 10),

  verified       boolean     not null default true,
  is_active      boolean     not null default true,
  display_order  integer     not null default 0,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index resume_bullets_experience_idx on resume_bullets (experience_id);
create index resume_bullets_strength_idx on resume_bullets (strength desc)
  where is_active and verified;
create index resume_bullets_categories_idx on resume_bullets using gin (categories);
create index resume_bullets_technologies_idx on resume_bullets using gin (technologies);
create index resume_bullets_keywords_idx on resume_bullets using gin (keywords);

comment on column resume_bullets.canonical_text is
  'User-verified source of truth. Generated variants must be traceable to this.';

create table skills (
  id            bigint generated always as identity primary key,
  name          text        not null,
  category      skill_category not null,
  -- 1-5 self-assessed, used for ordering on the resume, not for scoring claims.
  proficiency   smallint    not null default 3 check (proficiency between 1 and 5),
  years         numeric(3, 1),
  verified      boolean     not null default true,
  is_active     boolean     not null default true,
  display_order integer     not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Skill names are matched case-insensitively during scoring, so enforce
-- uniqueness the same way.
create unique index skills_name_key on skills (lower(name));
create index skills_category_idx on skills (category, display_order);
