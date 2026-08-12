-- Gmail-backed conversation tracking. We store metadata and a snippet, not
-- full message bodies, to keep the database small and limit what is retained.

create table email_threads (
  id               bigint generated always as identity primary key,
  gmail_thread_id  text        not null,

  application_id   bigint      references applications (id) on delete set null,
  contact_id       bigint      references contacts (id) on delete set null,
  company_id       bigint      references companies (id) on delete set null,

  subject          text,
  snippet          text,
  last_message_at  timestamptz,
  last_from        text,
  message_count    smallint    not null default 0,

  classification   email_classification not null default 'unknown',
  -- 0..1. Below the auto-apply threshold we ask instead of acting.
  confidence       numeric(3, 2) not null default 0
                     check (confidence >= 0 and confidence <= 1),
  needs_review     boolean     not null default false,
  -- Set once the user confirms or corrects the classification.
  reviewed_at      timestamptz,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create unique index email_threads_gmail_key on email_threads (gmail_thread_id);
create index email_threads_application_idx on email_threads (application_id);
create index email_threads_review_idx on email_threads (needs_review, last_message_at desc)
  where needs_review;
create index email_threads_recent_idx on email_threads (last_message_at desc);

create table email_messages (
  id               bigint generated always as identity primary key,
  thread_id        bigint      not null references email_threads (id) on delete cascade,
  gmail_message_id text        not null,

  -- 'inbound' | 'outbound'
  direction        text        not null default 'inbound',
  from_email       text,
  from_name        text,
  to_email         text,
  subject          text,
  snippet          text,
  received_at      timestamptz not null,

  classification   email_classification not null default 'unknown',
  confidence       numeric(3, 2) not null default 0,

  created_at       timestamptz not null default now()
);

create unique index email_messages_gmail_key on email_messages (gmail_message_id);
create index email_messages_thread_idx on email_messages (thread_id, received_at desc);

create table interviews (
  id             bigint generated always as identity primary key,
  application_id bigint      not null references applications (id) on delete cascade,

  kind           interview_kind not null,
  status         interview_status not null default 'scheduled',

  scheduled_at   timestamptz,
  -- OAs usually arrive as "complete within 7 days" rather than a fixed time.
  due_at         timestamptz,
  duration_min   smallint,
  location       text,
  meeting_url    text,

  interviewers   text[]      not null default '{}',
  notes          text,
  outcome        text,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index interviews_application_idx on interviews (application_id);
create index interviews_upcoming_idx on interviews (scheduled_at)
  where status = 'scheduled';
create index interviews_due_idx on interviews (due_at)
  where status = 'scheduled' and due_at is not null;
