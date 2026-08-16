-- Structured compensation, extracted from the posting text.
--
-- `jobs.compensation` already held whatever free-text the ATS happened to
-- return, which was only 23 of 473 rows and not comparable across postings.
-- These columns hold a parsed figure normalized to a monthly equivalent so
-- an hourly rate, a weekly base and an annual salary can be ranked together.

alter table jobs
  add column pay_min          numeric(12, 2),
  add column pay_max          numeric(12, 2),
  add column pay_period       text check (pay_period in ('hour', 'week', 'month', 'year')),
  add column pay_currency     text default 'USD',
  -- Monthly equivalent, for sorting and filtering across different units.
  add column pay_monthly_min  integer,
  add column pay_monthly_max  integer,
  -- The matched text, so a suspicious figure can be audited against the source.
  add column pay_raw          text,
  -- 'ats'  — a structured field from the provider's API
  -- 'text' — parsed out of the description
  add column pay_source       text check (pay_source in ('ats', 'text')),
  -- False when the period was inferred from magnitude rather than stated.
  add column pay_period_stated boolean not null default false;

-- Sorting the feed by pay, highest first, skipping rows without a figure.
create index jobs_pay_idx on jobs (pay_monthly_max desc nulls last)
  where pay_monthly_max is not null;

comment on column jobs.pay_monthly_max is
  'Normalized monthly equivalent. Hourly assumes a 40-hour week; weekly and '
  'annual are converted directly. Use this to compare across pay periods.';
