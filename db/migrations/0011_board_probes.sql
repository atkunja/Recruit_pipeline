-- Records every attempt to find a company's ATS board, so board discovery is
-- incremental: a company probed last week is skipped this week, and one with
-- no board is not re-probed for a month.

create table company_board_probes (
  id            bigint generated always as identity primary key,

  -- Free-form external key, e.g. 'yc:airbnb'. Not a companies FK: we probe
  -- before we have any reason to create a company row.
  external_key  text        not null,
  company_name  text        not null,
  website       text,

  probed_at     timestamp with time zone not null default now(),
  -- 'found' | 'not_found' | 'error'
  result        text        not null,
  found_kind    source_kind,
  found_slug    text,
  -- Set once the discovered board has been inserted into job_sources.
  source_id     bigint      references job_sources (id) on delete set null,
  attempts      smallint    not null default 1,
  error         text
);

create unique index company_board_probes_key on company_board_probes (external_key);
create index company_board_probes_result_idx on company_board_probes (result, probed_at);
