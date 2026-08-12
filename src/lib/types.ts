/**
 * Domain types.
 *
 * These mirror the SQL schema one-for-one. The Postgres client is configured
 * with `transform: postgres.camel`, so column `graduation_date` arrives as
 * `graduationDate` and these types describe query results directly.
 */

// --- enums (mirror db/migrations/0001_enums.sql) ---------------------------

export const SOURCE_KINDS = [
  "greenhouse",
  "lever",
  "ashby",
  "workday",
  "simplify",
  "ycombinator",
  "careers_page",
  "manual",
  "other",
] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export const EXPERIENCE_KINDS = [
  "work",
  "internship",
  "startup",
  "project",
  "research",
  "leadership",
] as const;
export type ExperienceKind = (typeof EXPERIENCE_KINDS)[number];

export const SKILL_CATEGORIES = [
  "language",
  "framework",
  "library",
  "tool",
  "cloud",
  "database",
  "domain",
] as const;
export type SkillCategory = (typeof SKILL_CATEGORIES)[number];

export const COMPANY_CATEGORIES = [
  "bigtech",
  "trading",
  "ai",
  "infrastructure",
  "devtools",
  "startup",
  "robotics",
  "fintech",
  "defense",
  "other",
] as const;
export type CompanyCategory = (typeof COMPANY_CATEGORIES)[number];

/** Declaration order is funnel order; the CRM renders stages in this sequence. */
export const APPLICATION_STATUSES = [
  "discovered",
  "preparing",
  "ready_to_apply",
  "applied",
  "outreach_sent",
  "oa",
  "interview",
  "rejected",
  "offer",
  "withdrawn",
] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export type PrefilterVerdict = "pending" | "pass" | "reject";

export const CONTACT_CATEGORIES = [
  "university_recruiter",
  "technical_recruiter",
  "recruiter",
  "hiring_manager",
  "engineer",
  "alum",
  "other",
] as const;
export type ContactCategory = (typeof CONTACT_CATEGORIES)[number];

export type ContactStatus =
  | "identified"
  | "queued"
  | "contacted"
  | "replied"
  | "bounced"
  | "do_not_contact";

export type OutreachKind = "initial" | "follow_up" | "thank_you";
export type OutreachStatus = "draft" | "approved" | "sent" | "failed" | "skipped";

export const EMAIL_CLASSIFICATIONS = [
  "recruiter_reply",
  "interview_invite",
  "oa_invite",
  "rejection",
  "follow_up",
  "auto_ack",
  "other",
  "unknown",
] as const;
export type EmailClassification = (typeof EMAIL_CLASSIFICATIONS)[number];

export type InterviewKind =
  | "oa"
  | "phone_screen"
  | "technical"
  | "behavioral"
  | "onsite"
  | "final";
export type InterviewStatus = "scheduled" | "completed" | "cancelled" | "no_show";

export type TaskStatus = "open" | "done" | "dismissed";

export const QUESTION_KINDS = [
  "why_company",
  "why_role",
  "experience",
  "technical",
  "logistics",
  "sensitive",
  "other",
] as const;
export type QuestionKind = (typeof QUESTION_KINDS)[number];

// --- rows ------------------------------------------------------------------

export interface Profile {
  id: number;
  fullName: string;
  email: string;
  phone: string | null;
  location: string | null;
  university: string;
  degree: string;
  major: string;
  minor: string | null;
  graduationDate: Date;
  gpa: string | null;
  workAuthorization: string;
  needsSponsorship: boolean;
  githubUrl: string | null;
  linkedinUrl: string | null;
  portfolioUrl: string | null;
  targetSeason: string;
  preferredLocations: string[];
  targetCategories: string[];
  targetCompanies: string[];
  summary: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Experience {
  id: number;
  kind: ExperienceKind;
  organization: string;
  title: string;
  location: string | null;
  startDate: Date;
  endDate: Date | null;
  isCurrent: boolean;
  description: string | null;
  technologies: string[];
  categories: string[];
  url: string | null;
  displayOrder: number;
  verified: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ResumeBullet {
  id: number;
  experienceId: number;
  canonicalText: string;
  skills: string[];
  technologies: string[];
  metrics: string[];
  keywords: string[];
  categories: string[];
  strength: number;
  verified: boolean;
  isActive: boolean;
  displayOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface Skill {
  id: number;
  name: string;
  category: SkillCategory;
  proficiency: number;
  years: string | null;
  verified: boolean;
  isActive: boolean;
  displayOrder: number;
}

export interface Company {
  id: number;
  name: string;
  slug: string;
  website: string | null;
  category: CompanyCategory;
  atsKind: SourceKind | null;
  atsSlug: string | null;
  preference: number;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface JobSource {
  id: number;
  kind: SourceKind;
  name: string;
  config: Record<string, unknown>;
  enabled: boolean;
  priority: number;
  lastRunAt: Date | null;
  lastStatus: string | null;
  lastError: string | null;
  consecutiveFailures: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface Job {
  id: number;
  companyId: number;
  sourceKind: SourceKind;
  sourceId: number | null;
  sourceJobId: string | null;
  title: string;
  normalizedTitle: string;
  url: string;
  locationRaw: string | null;
  locations: string[];
  isRemote: boolean;
  description: string | null;
  requirements: string | null;
  preferredQualifications: string | null;
  compensation: string | null;
  season: string | null;
  postedAt: Date | null;
  discoveredAt: Date;
  closedAt: Date | null;
  isActive: boolean;
  descriptionHash: string | null;
  dedupeKey: string;
  canonicalJobId: number | null;
  prefilter: PrefilterVerdict;
  prefilterReasons: string[];
  isIgnored: boolean;
  ignoredReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** One scored dimension of job fit, as rendered in the score breakdown. */
export interface ScoreComponent {
  score: number;
  max: number;
  reason: string;
}

export const SCORE_COMPONENT_KEYS = [
  "technical",
  "experience",
  "education",
  "role",
  "location",
  "eligibility",
] as const;
export type ScoreComponentKey = (typeof SCORE_COMPONENT_KEYS)[number];

export type ScoreComponents = Record<ScoreComponentKey, ScoreComponent>;

export interface JobScore {
  id: number;
  jobId: number;
  total: number;
  components: ScoreComponents;
  summary: string | null;
  strongestExperienceIds: number[];
  strongestSkills: string[];
  missingRequirements: string[];
  concerns: string[];
  emphasize: string[];
  weightsHash: string;
  descriptionHash: string;
  model: string;
  createdAt: Date;
}

export interface Application {
  id: number;
  jobId: number;
  status: ApplicationStatus;
  priority: number;
  resumeVersionId: number | null;
  preparedAt: Date | null;
  appliedAt: Date | null;
  closedAt: Date | null;
  notes: string | null;
  nextAction: string | null;
  nextActionAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ApplicationQuestion {
  id: number;
  applicationId: number;
  question: string;
  answer: string | null;
  kind: QuestionKind;
  isSensitive: boolean;
  needsReview: boolean;
  approved: boolean;
  source: "ai" | "manual" | "reused";
  reusedFromId: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Contact {
  id: number;
  companyId: number;
  name: string;
  title: string | null;
  category: ContactCategory;
  linkedinUrl: string | null;
  email: string | null;
  emailVerified: boolean;
  source: string;
  relevanceReason: string | null;
  isAlum: boolean;
  outreachValue: number;
  status: ContactStatus;
  lastContactedAt: Date | null;
  contactCount: number;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface OutreachMessage {
  id: number;
  contactId: number;
  applicationId: number | null;
  jobId: number | null;
  kind: OutreachKind;
  subject: string;
  body: string;
  status: OutreachStatus;
  approvedAt: Date | null;
  sentAt: Date | null;
  error: string | null;
  gmailMessageId: string | null;
  gmailThreadId: string | null;
  inReplyToId: number | null;
  model: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface EmailThread {
  id: number;
  gmailThreadId: string;
  applicationId: number | null;
  contactId: number | null;
  companyId: number | null;
  subject: string | null;
  snippet: string | null;
  lastMessageAt: Date | null;
  lastFrom: string | null;
  messageCount: number;
  classification: EmailClassification;
  confidence: string;
  needsReview: boolean;
  reviewedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Interview {
  id: number;
  applicationId: number;
  kind: InterviewKind;
  status: InterviewStatus;
  scheduledAt: Date | null;
  dueAt: Date | null;
  durationMin: number | null;
  location: string | null;
  meetingUrl: string | null;
  interviewers: string[];
  notes: string | null;
  outcome: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface TaskRow {
  id: number;
  kind: string;
  title: string;
  detail: string | null;
  applicationId: number | null;
  contactId: number | null;
  jobId: number | null;
  interviewId: number | null;
  dueAt: Date | null;
  status: TaskStatus;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ActivityEvent {
  id: number;
  at: Date;
  kind: string;
  message: string;
  jobId: number | null;
  applicationId: number | null;
  contactId: number | null;
  companyId: number | null;
  meta: Record<string, unknown>;
}

// --- composed view models --------------------------------------------------

/** A job as rendered on Discover: job + company + latest score + status. */
export interface JobListItem {
  id: number;
  title: string;
  url: string;
  locationRaw: string | null;
  isRemote: boolean;
  season: string | null;
  postedAt: Date | null;
  discoveredAt: Date;
  sourceKind: SourceKind;
  isIgnored: boolean;
  companyId: number;
  companyName: string;
  companyCategory: CompanyCategory;
  companyPreference: number;
  score: number | null;
  scoreSummary: string | null;
  strongestSkills: string[];
  missingRequirements: string[];
  applicationId: number | null;
  applicationStatus: ApplicationStatus | null;
  duplicateCount: number;
}
