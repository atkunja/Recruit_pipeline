import "server-only";
import postgres from "postgres";

/**
 * Postgres client.
 *
 * Pooling, and which port to use:
 *
 *   Transaction pooler (6543) — for the app. It multiplexes many clients onto
 *     far fewer backends, which is what serverless needs, since every warm
 *     function instance holds its own pool.
 *   Session pooler (5432) — for migrations, which need a stable session.
 *
 * An earlier version had this backwards, on the theory that transaction mode
 * caused a hang. It did not: the hang came from a lazy Proxy that rebuilt the
 * client on every property access and leaked pools until Supabase stopped
 * granting connections. With that fixed, session mode's 15-client ceiling
 * became the binding constraint in production instead.
 *
 * `prepare: false` is required under transaction pooling and harmless under
 * session pooling.
 */

type Sql = ReturnType<typeof postgres>;

const globalForDb = globalThis as unknown as { __sql?: Sql };

/**
 * Connection string, tolerating absence at import time.
 *
 * `next build` imports every module to collect page metadata, and a machine
 * running a build need not have database credentials. Rather than deferring
 * construction (see the note on `sql` below for why that went badly), we
 * construct against an unroutable placeholder. No socket is opened until a
 * query runs, and a query that does run without credentials fails quickly with
 * a connection error instead of hanging.
 */
function connectionString(): string {
  const url = process.env.DATABASE_URL;
  if (url !== undefined && url.length > 0) return url;
  return "postgresql://unset:unset@127.0.0.1:1/unset";
}

function create(): Sql {
  return postgres(connectionString(), {
    prepare: false,
    // snake_case in Postgres, camelCase in TypeScript, translated in both
    // directions — including for the `sql(object)` insert/update helper.
    transform: postgres.camel,

    // Parse bigint (int8) as a JS number.
    //
    // postgres.js returns int8 as a *string* by default to protect values past
    // 2^53. Every id in this schema is a generated identity column that will
    // never come close, and every type in src/lib/types.ts declares them as
    // `number` — so the default silently made runtime disagree with the types.
    //
    // That mismatch was not theoretical: resume tailoring compared model-supplied
    // numeric ids against a Set of strings, matched nothing, and produced a
    // resume with no experience on it that still passed every fabrication check.
    types: {
      bigint: {
        to: 20,
        from: [20],
        serialize: (value: number | string) => String(value),
        parse: (value: string) => Number(value),
      },
    },

    // Pool size, per client instance.
    //
    // The ceiling that matters is Supabase's, not ours, and it is shared across
    // every process: serverless gives each concurrent function instance its own
    // pool, so `max` is multiplied by however many are warm. At max:10 two
    // Vercel instances exhausted the session pooler's 15-client limit and 36 of
    // 44 sources failed with EMAXCONNSESSION.
    //
    // Keep this small and let the transaction pooler do the real multiplexing.
    max: Number(process.env.DATABASE_POOL_MAX ?? 4),

    // Hand the connection back quickly so an idle page view doesn't hold a
    // slot, and recycle periodically so a half-dead socket can't persist.
    idle_timeout: 10,
    max_lifetime: 60 * 10,
    connect_timeout: 10,

    // Fail loudly rather than hanging. Without this a stuck query blocks the
    // request forever and the UI just shows a spinner with no error anywhere.
    connection: { statement_timeout: 20_000 },

    onnotice: () => {},
  });
}

/**
 * The query client.
 *
 * A plain instance, created once at module load and cached on `globalThis` so
 * dev hot-reloads reuse it.
 *
 * This was briefly a Proxy that deferred construction to the first query, so
 * that `next build` could import the module without credentials. That was a
 * mistake worth recording: under Next's server runtime the `globalThis` cache
 * did not hold across module graphs, so the proxy rebuilt a `postgres()`
 * client on property access. That exhausted Supabase's pooler slots and every
 * query hung forever with no error — the worst possible failure mode.
 *
 * `postgres()` does not open a socket until the first query, so constructing
 * eagerly costs nothing and needs no live database.
 */
export const sql: Sql = globalForDb.__sql ?? create();

if (process.env.NODE_ENV !== "production") {
  globalForDb.__sql = sql;
}

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
