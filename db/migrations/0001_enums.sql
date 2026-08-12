-- Core enums. Kept narrow on purpose: this is a single-user system and every
-- value below maps to something the UI actually renders.

create type source_kind as enum (
  'greenhouse',
  'lever',
  'ashby',
  'workday',
  'simplify',
  'ycombinator',
  'careers_page',
  'manual',
  'other'
);

create type experience_kind as enum (
  'work',
  'internship',
  'startup',
  'project',
  'research',
  'leadership'
);

create type skill_category as enum (
  'language',
  'framework',
  'library',
  'tool',
  'cloud',
  'database',
  'domain'
);

create type company_category as enum (
  'bigtech',
  'trading',
  'ai',
  'infrastructure',
  'devtools',
  'startup',
  'robotics',
  'fintech',
  'defense',
  'other'
);

-- The application lifecycle. Order matters: the CRM renders funnel stages in
-- this declaration order.
create type application_status as enum (
  'discovered',
  'preparing',
  'ready_to_apply',
  'applied',
  'outreach_sent',
  'oa',
  'interview',
  'rejected',
  'offer',
  'withdrawn'
);

create type prefilter_verdict as enum ('pending', 'pass', 'reject');

create type contact_category as enum (
  'university_recruiter',
  'technical_recruiter',
  'recruiter',
  'hiring_manager',
  'engineer',
  'alum',
  'other'
);

create type contact_status as enum (
  'identified',
  'queued',
  'contacted',
  'replied',
  'bounced',
  'do_not_contact'
);

create type outreach_kind as enum ('initial', 'follow_up', 'thank_you');

create type outreach_status as enum (
  'draft',
  'approved',
  'sent',
  'failed',
  'skipped'
);

create type email_classification as enum (
  'recruiter_reply',
  'interview_invite',
  'oa_invite',
  'rejection',
  'follow_up',
  'auto_ack',
  'other',
  'unknown'
);

create type interview_kind as enum (
  'oa',
  'phone_screen',
  'technical',
  'behavioral',
  'onsite',
  'final'
);

create type interview_status as enum (
  'scheduled',
  'completed',
  'cancelled',
  'no_show'
);

create type task_status as enum ('open', 'done', 'dismissed');

create type question_kind as enum (
  'why_company',
  'why_role',
  'experience',
  'technical',
  'logistics',
  'sensitive',
  'other'
);
