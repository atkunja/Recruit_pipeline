-- Generic key/value config. Holds scoring weights, Gmail OAuth tokens, saved
-- answers to sensitive application questions, and feature flags. One user, so
-- a settings table beats a column per knob.
create table settings (
  key        text        primary key,
  value      jsonb       not null,
  updated_at timestamptz not null default now()
);

comment on table settings is
  'Known keys: scoring_weights, gmail_tokens, sensitive_answers, '
  'auto_submit_enabled, auto_send_enabled, discovery_config.';

-- Every OpenAI call is logged with its cost so the monthly guard in
-- src/lib/ai/budget.ts can refuse to spend past the ceiling.
create table ai_usage (
  id                bigint generated always as identity primary key,
  at                timestamptz not null default now(),

  -- 'score' | 'tailor' | 'outreach' | 'answers' | 'classify' | 'contacts'
  purpose           text        not null,
  model             text        not null,

  prompt_tokens     integer     not null default 0,
  completion_tokens integer     not null default 0,
  cached_tokens     integer     not null default 0,
  cost_usd          numeric(10, 6) not null default 0,

  job_id            bigint      references jobs (id) on delete set null,
  ok                boolean     not null default true,
  error             text
);

create index ai_usage_at_idx on ai_usage (at desc);
create index ai_usage_purpose_idx on ai_usage (purpose, at desc);
-- The budget guard sums cost over the current calendar month.
create index ai_usage_month_idx on ai_usage (date_trunc('month', at));

-- Default scoring weights. Components sum to 100 and are user-editable from
-- Settings; the shape is validated by ScoringWeightsSchema in
-- src/lib/scoring/weights.ts.
insert into settings (key, value) values (
  'scoring_weights',
  '{
    "technical": 35,
    "experience": 25,
    "education": 15,
    "role": 10,
    "location": 10,
    "eligibility": 5,
    "companyPreferenceBonus": 5,
    "minimumDisplayScore": 60
  }'::jsonb
) on conflict (key) do nothing;

insert into settings (key, value) values
  ('auto_submit_enabled', 'false'::jsonb),
  ('auto_send_enabled',   'false'::jsonb),
  ('sensitive_answers',   '{}'::jsonb)
on conflict (key) do nothing;
