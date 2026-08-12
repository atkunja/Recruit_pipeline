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

## What it will and won't do on its own

Everything outward-facing is gated behind an explicit click. This is the part
worth reading before you connect Gmail.

| Action | Automatic? |
|---|---|
| Discover, dedupe, score jobs | yes, on a schedule |
| Tailor a resume, draft answers, draft outreach | yes, into a **draft** |
| Update an application's status from a recruiter email | yes, only above 75% confidence — otherwise it asks |
| **Send an email** | **no** — requires you to approve, then confirm the recipient |
| **Submit an application** | **no** — the browser assistant fills fields and stops |
| Answer a self-identification or salary question | **never**, unless you saved that exact answer yourself |

Two feature flags exist for later (`auto_send_enabled`, `auto_submit_enabled`).
Both default to false and nothing turns them on for you.

### On finding people

Contact discovery searches **your own mailbox** for humans at a company who
have already written to you, and reads recruiter names off ATS postings. It
does not scrape LinkedIn and does not guess email addresses from name patterns
— guessed addresses bounce, which damages your sender reputation and gets your
real mail filtered. Everyone else you add by hand, which the job page supports.

Anti-spam is enforced in the database, not just the UI: a partial unique index
makes it impossible to send a second initial email to the same person about the
same job. Follow-ups wait 5 days, happen at most once, stop if they reply, and
still only produce a draft.

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
5. **Prepare** ([`prepare.ts`](src/lib/pipeline/prepare.ts)) tailors a resume,
   drafts answers to the usual application questions, looks for contacts,
   drafts one outreach email, and queues the whole thing for review.

Nothing is submitted or emailed without an explicit approval.

## Applying

```bash
npm run apply -- <applicationId>
```

Opens the posting in a real browser, fills contact details, links and the
resume from your approved package, prints the prepared answers, and stops. It
refuses to run at all if the resume isn't approved or questions are unanswered
(override with `--force`). You submit; it then asks whether you did, and only
marks the application applied if you say yes.

Coverage: Greenhouse and Lever fill reliably; Ashby is partial (dynamic fields);
Workday fills the first step only. Anything else prints the package for you to
copy. Playwright runs locally on purpose — a headless Chromium does not belong
in a serverless function.

## Analytics

Rates are computed against honest denominators (interview rate over
*applications*, not over everything discovered), and a percentage is shown as
`—` until there are at least 5 data points behind it.

Insights are deterministic, not model-generated, and only surface when each
group being compared has ≥8 applications and the gap is ≥15 points — labelled
*emerging* until ≥20, then *solid*. A conclusion drawn from three applications
is worse than no conclusion, so the engine stays quiet instead.
`test/insights.test.ts` asserts that silence.

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
