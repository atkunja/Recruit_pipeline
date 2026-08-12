-- People worth contacting at a company.
--
-- Scope note: this table intentionally holds only *professional, publicly
-- listed* information — name, role, company, public profile URL. There is no
-- column for personal address, phone, or any other private detail, so no
-- adapter can persist one.

create table contacts (
  id             bigint generated always as identity primary key,
  company_id     bigint      not null references companies (id) on delete cascade,

  name           text        not null,
  title          text,
  category       contact_category not null default 'other',

  linkedin_url   text,
  -- Only ever a work address the person or company published.
  email          text,
  email_verified boolean     not null default false,

  -- Where we learned about them, e.g. 'careers_page', 'manual', 'ai_suggested'.
  source         text        not null default 'manual',
  -- Plain-language justification shown in the UI before any outreach.
  relevance_reason text,

  is_alum        boolean     not null default false,
  -- 0-100 ranking used to order the outreach queue.
  outreach_value smallint    not null default 50
                   check (outreach_value between 0 and 100),

  status         contact_status not null default 'identified',
  last_contacted_at timestamptz,
  contact_count  smallint    not null default 0,

  notes          text,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- Same human at the same company should never be stored twice.
create unique index contacts_company_name_key
  on contacts (company_id, lower(name));
create unique index contacts_email_key on contacts (lower(email))
  where email is not null;
create index contacts_company_idx on contacts (company_id);
create index contacts_value_idx on contacts (outreach_value desc, status);
create index contacts_status_idx on contacts (status);

create table outreach_messages (
  id             bigint generated always as identity primary key,
  contact_id     bigint      not null references contacts (id) on delete cascade,
  application_id bigint      references applications (id) on delete set null,
  job_id         bigint      references jobs (id) on delete set null,

  kind           outreach_kind not null default 'initial',
  subject        text        not null,
  body           text        not null,

  status         outreach_status not null default 'draft',

  -- Nothing leaves the machine until approved_at is set by an explicit click.
  approved_at    timestamptz,
  sent_at        timestamptz,
  error          text,

  gmail_message_id text,
  gmail_thread_id  text,

  -- For follow-ups: the message this one chases.
  in_reply_to_id bigint      references outreach_messages (id) on delete set null,

  model          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index outreach_contact_idx on outreach_messages (contact_id, created_at desc);
create index outreach_application_idx on outreach_messages (application_id);
create index outreach_status_idx on outreach_messages (status, created_at desc);
create index outreach_thread_idx on outreach_messages (gmail_thread_id)
  where gmail_thread_id is not null;

-- Anti-spam guard: at most one *sent* initial message per contact per job.
-- This is the constraint that stops a duplicate "hi, I applied" email.
create unique index outreach_one_initial_per_contact_job
  on outreach_messages (contact_id, job_id)
  where kind = 'initial' and status = 'sent';

comment on index outreach_one_initial_per_contact_job is
  'Prevents emailing the same recruiter twice about the same position.';
