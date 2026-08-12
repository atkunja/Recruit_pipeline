import "server-only";
import postgres from "postgres";
import { env } from "./env";

/**
 * Postgres client.
 *
 * Points at Supabase's *transaction* pooler, which does not support prepared
 * statements — hence `prepare: false`. The connection is cached on globalThis
 * so Next.js dev hot-reloads and serverless warm invocations reuse one pool
 * instead of exhausting Supabase's connection limit.
 */

type Sql = ReturnType<typeof postgres>;

const globalForDb = globalThis as unknown as { __sql?: Sql };

function create(): Sql {
  return postgres(env.databaseUrl, {
    prepare: false,
    // snake_case in Postgres, camelCase in TypeScript, translated in both
    // directions — including for the `sql(object)` insert/update helper.
    transform: postgres.camel,
    // One user, serverless: a tiny pool is plenty and keeps us far away from
    // Supabase free-tier connection limits.
    max: 3,
    idle_timeout: 20,
    connect_timeout: 15,
    // Postgres arrays of text come back as JS string arrays; keep the default
    // parsers otherwise.
    onnotice: () => {},
  });
}

export const sql: Sql = globalForDb.__sql ?? create();

if (process.env.NODE_ENV !== "production") {
  globalForDb.__sql = sql;
}

/**
 * Run a set of statements inside a transaction.
 * Thin wrapper so call sites don't import `postgres` types directly.
 */
export function transaction<T>(
  fn: (tx: Parameters<Parameters<Sql["begin"]>[0]>[0]) => Promise<T>,
): Promise<T> {
  return sql.begin(fn) as Promise<T>;
}

/** Narrow a query result to its first row, or null when empty. */
export function one<T>(rows: readonly T[]): T | null {
  return rows.length > 0 ? (rows[0] as T) : null;
}

/** Narrow a query result to its first row, throwing when empty. */
export function oneOrThrow<T>(rows: readonly T[], what = "row"): T {
  const row = one(rows);
  if (row === null) throw new Error(`Expected exactly one ${what}, got none`);
  return row;
}
