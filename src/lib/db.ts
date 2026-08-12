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

function instance(): Sql {
  const existing = globalForDb.__sql;
  if (existing) return existing;
  const created = create();
  globalForDb.__sql = created;
  return created;
}

/**
 * The query client.
 *
 * A proxy rather than a plain instance so the connection — and the read of
 * DATABASE_URL — is deferred to the first query. `next build` imports every
 * module to collect page metadata, and connecting at import time would make a
 * build fail on a machine that has no database credentials.
 */
export const sql: Sql = new Proxy(function noop() {} as unknown as Sql, {
  apply(_target, _thisArg, args: unknown[]) {
    return (instance() as unknown as (...a: unknown[]) => unknown)(...args);
  },
  get(_target, property) {
    const client = instance() as unknown as Record<string | symbol, unknown>;
    const value = client[property];
    return typeof value === "function" ? value.bind(client) : value;
  },
  has(_target, property) {
    return property in (instance() as unknown as object);
  },
});

/** The transaction-scoped client handed to `transaction()` callbacks. */
export type Tx = postgres.TransactionSql<Record<string, unknown>>;

/**
 * Run a set of statements inside a transaction.
 * Thin wrapper so call sites don't import `postgres` types directly.
 */
export function transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return sql.begin((tx) => fn(tx as Tx)) as Promise<T>;
}

/**
 * Cast a plain object to the shape `sql.json()` accepts.
 * Our domain types are JSON-serializable but lack the index signature the
 * driver's `JSONValue` requires, and adding one to every type would weaken it.
 */
export function json(value: unknown): postgres.JSONValue {
  return value as postgres.JSONValue;
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
