import "server-only";
import { json, sql } from "../db";
import type { ResumeDocument, ResumeRationale } from "./types";

/** Persistence for generated resume versions. */

export interface ResumeVersionRow {
  id: number;
  jobId: number | null;
  label: string;
  isMaster: boolean;
  content: ResumeDocument;
  bulletIds: number[];
  rationale: ResumeRationale;
  integrityOk: boolean;
  integrityIssues: string[];
  model: string | null;
  approved: boolean;
  approvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SaveResumeVersionInput {
  jobId: number | null;
  label: string;
  isMaster?: boolean;
  content: ResumeDocument;
  bulletIds: number[];
  rationale: ResumeRationale;
  integrityOk: boolean;
  integrityIssues: string[];
  model: string | null;
}

export async function saveResumeVersion(
  input: SaveResumeVersionInput,
): Promise<ResumeVersionRow> {
  const rows = await sql<ResumeVersionRow[]>`
    insert into resume_versions (
      job_id, label, is_master, content, bullet_ids, rationale,
      integrity_ok, integrity_issues, model
    ) values (
      ${input.jobId}, ${input.label}, ${input.isMaster ?? false},
      ${sql.json(json(input.content))}, ${input.bulletIds},
      ${sql.json(json(input.rationale))}, ${input.integrityOk},
      ${input.integrityIssues}, ${input.model}
    )
    returning *
  `;
  const row = rows[0];
  if (!row) throw new Error("Failed to save resume version");
  return row;
}

export async function getResumeVersion(
  id: number,
): Promise<ResumeVersionRow | null> {
  const rows = await sql<ResumeVersionRow[]>`
    select * from resume_versions where id = ${id}
  `;
  return rows[0] ?? null;
}

/** Most recent generated version for a job. */
export async function getLatestResumeForJob(
  jobId: number,
): Promise<ResumeVersionRow | null> {
  const rows = await sql<ResumeVersionRow[]>`
    select * from resume_versions
    where job_id = ${jobId}
    order by created_at desc
    limit 1
  `;
  return rows[0] ?? null;
}

export async function getMasterResume(): Promise<ResumeVersionRow | null> {
  const rows = await sql<ResumeVersionRow[]>`
    select * from resume_versions where is_master limit 1
  `;
  return rows[0] ?? null;
}

/**
 * Replace the stored master resume.
 * The partial unique index allows only one, so the old row is demoted first.
 */
export async function replaceMasterResume(
  content: ResumeDocument,
  bulletIds: number[],
): Promise<ResumeVersionRow> {
  await sql`update resume_versions set is_master = false where is_master`;
  return saveResumeVersion({
    jobId: null,
    label: "Master",
    isMaster: true,
    content,
    bulletIds,
    rationale: { summary: "Assembled from every verified experience.", changes: [] },
    integrityOk: true,
    integrityIssues: [],
    model: null,
  });
}

export async function approveResumeVersion(id: number): Promise<void> {
  await sql`
    update resume_versions
    set approved = true, approved_at = now(), updated_at = now()
    where id = ${id}
  `;
}

/** Update a version's content after a manual edit, re-running no AI. */
export async function updateResumeContent(
  id: number,
  content: ResumeDocument,
  bulletIds: number[],
  integrityOk: boolean,
  integrityIssues: string[],
): Promise<void> {
  await sql`
    update resume_versions set
      content          = ${sql.json(json(content))},
      bullet_ids       = ${bulletIds},
      integrity_ok     = ${integrityOk},
      integrity_issues = ${integrityIssues},
      approved         = false,
      approved_at      = null,
      updated_at       = now()
    where id = ${id}
  `;
}
