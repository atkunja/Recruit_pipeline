# Recruiting Pipeline

A personal AI recruiting operating system. One user. It finds Summer 2027
software internships several times a day, scores them against a verified
profile, tailors a one-page resume for each without inventing anything, helps
finish the application, finds people worth contacting, drafts outreach, and
tracks the whole funnel.

Runs on Vercel + Supabase for roughly **$0–25/month**.

---

## The one rule

The AI may never state a fact about you that isn't in the database.

It can select, reorder, shorten and reword your **verified** bullets. It cannot
invent a metric, a technology, a responsibility, an employer, or a date. This
isn't only a prompt instruction:

- Factual fields (employer, title, dates, university, GPA) are copied from
  database rows when a resume is assembled — the model never supplies them. It
  returns bullet ids and wording, nothing else.
- Every generated resume runs through
  [`checkIntegrity`](src/lib/resume/integrity.ts), which compares each reworded
  bullet against its canonical text and rejects any new number or technology.
- A draft that fails the check is flagged in the UI and **cannot be approved** —
  the server refuses, not just the button.
- If the model fabricates twice in a row, its structural choices are kept and
  its wording is thrown away in favour of your canonical text.

`test/integrity.test.ts` covers inflated metrics, invented metrics, unlisted
technologies, altered employers and titles, and bullets moved between jobs.

---

## Setup

### 1. Database (Supabase, free tier)

Create a project, then from **Project Settings → Database → Connection string**
grab both URIs:

- the **Transaction pooler** one (port `6543`) → `DATABASE_URL`
- the **Session pooler** one (port `5432`) → `DIRECT_DATABASE_URL`

The app uses the pooler (serverless-safe, no prepared statements); migrations
use the direct connection because DDL over the transaction pooler is flaky.

```bash
cp .env.example .env.local     # then fill it in
npm install
npm run db:migrate
```

### 2. Your profile

This is the most important step — it is the only source of fact the AI has.

```bash
cp db/profile.example.json db/profile.json
# edit db/profile.json with your real details
npm run db:seed
```

`db/profile.json` is gitignored. Anything you leave as a placeholder simply
won't appear on your resumes; it will not be invented. Re-running the seed
updates in place rather than duplicating.

### 3. Run it

```bash
npm run dev
```

Sign in with `APP_PASSWORD`.

### 4. Discovery

93 verified ATS boards and the Pitt CSC × Simplify Summer 2027 feed are seeded
already. Trigger a first run from **Settings → Sources → Run discovery**, or:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/discover
```

---

## Required credentials

| Variable | Needed for | Where to get it |
|---|---|---|
| `DATABASE_URL` | everything | Supabase → Database → Connection string (pooler, `:6543`) |
| `DIRECT_DATABASE_URL` | `npm run db:migrate` | same page, session pooler (`:5432`) |
| `APP_PASSWORD` | signing in | pick one |
| `AUTH_SECRET` | session cookie signing | `openssl rand -base64 32` |
| `OPENAI_API_KEY` | scoring, tailoring, outreach | platform.openai.com |
| `CRON_SECRET` | scheduled discovery | `openssl rand -hex 24` |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Gmail outreach + reply tracking | Google Cloud Console → OAuth client (Web) |

Gmail is optional — the app runs fine without it and hides the feature.

---

## Scheduling

Two options; the endpoints authenticate the same way either way.

**GitHub Actions (free, recommended).** `.github/workflows/discover.yml` runs
discovery three times a day. Add two repository secrets: `APP_URL` and
`CRON_SECRET`.

**Vercel Cron.** `vercel.json` is configured. Note the Hobby plan allows only
two cron jobs at once-a-day granularity; the schedule in `vercel.json` assumes
Pro. This is why Actions is the default recommendation.

---

## How a job becomes an application

Each step is ordered so the expensive one runs last and on the fewest rows:

1. **Adapters** ([`src/lib/sources/`](src/lib/sources)) pull boards and apply a
   loose title screen while parsing. Free.
2. **Ingest** ([`ingest.ts`](src/lib/jobs/ingest.ts)) normalizes, computes a
   dedupe key, links duplicates across boards, and runs the deterministic
   [prefilter](src/lib/jobs/prefilter.ts) — internship status, title, season,
   US location, degree level, years of experience, graduation window. Free.
3. **Enrichment** fetches descriptions, but only for postings that already
   passed the prefilter. Cheap and bounded.
4. **Scoring** ([`score.ts`](src/lib/scoring/score.ts)) — the first step that
   costs money. Cached on `(job, weights, description hash)`, so an unchanged
   listing is never re-scored.
5. **Prepare** ([`prepare.ts`](src/lib/pipeline/prepare.ts)) tailors a resume
   and queues it for review.

Nothing is submitted or emailed without an explicit approval.

## Cost control

- Deterministic filtering before any model call — a run touches thousands of
  postings and scores tens.
- Scores cached by description hash; re-running discovery over unchanged
  listings costs nothing.
- Cheap model for scoring and classification, strong model reserved for resume
  writing and outreach.
- Every call is priced and written to `ai_usage`; `OPENAI_MONTHLY_BUDGET_USD` is
  a hard server-side stop, not a warning.
- Current spend is on the Today page and in Settings.

## Sources

Greenhouse, Lever and Ashby public APIs; the Pitt CSC × Simplify curated
Summer 2027 repository; and a weekly job that walks YC's public company
directory and probes for ATS boards, registering any it finds.

**jobright.ai** is deliberately not integrated. Its recommendation feed sits
behind a personal login and is a paid product, so pulling it would mean driving
your authenticated session against that site's terms. Jobs you find there can
be pasted into **Add a job**, which reads Greenhouse/Lever/Ashby links directly
from their APIs.

## Commands

```bash
npm run dev          # local dev server
npm run build        # production build
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
npm test             # node:test suite
npm run db:migrate   # apply migrations
npm run db:seed      # load db/profile.json
```

## Layout

```
db/migrations/     numbered SQL, applied in order, checksum-verified
scripts/           migrate + seed (self-contained, no app imports)
src/lib/
  sources/         one file per job board + the registry
  jobs/            normalization, prefilter, ingestion, repository
  scoring/         weights and the AI fit engine
  resume/          assembly, tailoring, integrity check, PDF
  pipeline/        discovery and prepare orchestration
  ai/              OpenAI client, pricing, budget guard
src/app/(app)/     the dashboard
test/              unit tests for everything pure
```
