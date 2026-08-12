/**
 * The structured resume document.
 *
 * Stored as JSON on `resume_versions.content` rather than as a PDF blob, so the
 * UI can diff two versions field by field and the PDF can be re-rendered at any
 * time without file storage.
 *
 * Note what the model is *not* allowed to supply: organization, title, dates,
 * university, GPA and graduation date are all copied from verified database
 * rows when the document is assembled. The model chooses ids and rewords bullet
 * text; it never authors a fact.
 */

export interface ResumeLink {
  label: string;
  url: string;
}

export interface ResumeHeader {
  name: string;
  email: string;
  phone: string | null;
  location: string | null;
  links: ResumeLink[];
}

export interface ResumeEducation {
  university: string;
  degree: string;
  major: string;
  minor: string | null;
  graduationLabel: string;
  gpa: string | null;
}

export interface ResumeBulletLine {
  /** Always points at a real row in `resume_bullets`. */
  bulletId: number;
  /** Wording used in this version — canonical text, or a verified rewrite. */
  text: string;
  /** True when `text` differs from the bullet's canonical wording. */
  rewritten: boolean;
}

export interface ResumeEntry {
  experienceId: number;
  organization: string;
  title: string;
  location: string | null;
  dateRange: string;
  bullets: ResumeBulletLine[];
}

export interface ResumeSection {
  title: string;
  entries: ResumeEntry[];
}

export interface ResumeSkillGroup {
  label: string;
  items: string[];
}

export interface ResumeDocument {
  header: ResumeHeader;
  education: ResumeEducation;
  sections: ResumeSection[];
  skills: ResumeSkillGroup[];
}

/** One difference between the master resume and a tailored version. */
export interface ResumeChange {
  kind:
    | "bullet_rewritten"
    | "bullet_included"
    | "bullet_omitted"
    | "experience_omitted"
    | "experience_reordered"
    | "skills_reordered";
  experienceId?: number;
  bulletId?: number;
  before?: string;
  after?: string;
  why: string;
}

export interface ResumeRationale {
  summary: string;
  changes: ResumeChange[];
}

/** Result of the anti-fabrication check. */
export interface IntegrityReport {
  ok: boolean;
  issues: string[];
}
