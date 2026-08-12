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

## Using a different model provider

The client talks to any OpenAI-compatible endpoint. To run Kimi instead:

```bash
OPENAI_BASE_URL="https://api.moonshot.ai/v1"
OPENAI_API_KEY="<moonshot key>"
OPENAI_MODEL_CHEAP="kimi-k2"
OPENAI_MODEL_STRONG="kimi-k2"
```

Three things to know before you do:

- **Add a price entry.** `src/lib/ai/pricing.ts` bills unknown models at a
  deliberately pessimistic $5/$20 per M tokens, so an unpriced model will trip
  the budget guard almost immediately. Kimi and Moonshot rates are already in
  the table; third-party hosts charge more than Moonshot direct, so put your
  actual provider's rate in if you use one.
- **JSON mode has to work.** Every call uses
  `response_format: { type: "json_object" }`. Moonshot supports it. Some
  OpenRouter routes silently don't, in which case output fails Zod validation
  and retries twice before erroring — you'll see it immediately, not subtly.
- **Safety doesn't depend on the model.** `checkIntegrity` is deterministic, so
  a weaker model can't fabricate its way past it. It just fails the check more
  often and falls back to your canonical bullet wording.

Mixing is supported and probably the right call: a cheap model for scoring and
email classification (high volume, low stakes) and a stronger one for resume
tailoring and outreach (low volume, and the wording is the whole point). The
Analytics page breaks spend down by purpose so you can see which is actually
costing you anything.

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

## Deploying to Vercel

```bash
npx vercel link
npx vercel env add DATABASE_URL production        # session pooler, port 5432
npx vercel env add DIRECT_DATABASE_URL production
npx vercel env add APP_PASSWORD production
npx vercel env add AUTH_SECRET production
npx vercel env add OPENAI_API_KEY production
npx vercel env add CRON_SECRET production
npx vercel env add NEXT_PUBLIC_APP_URL production # https://<app>.vercel.app
npx vercel --prod
```

Then, if you want Gmail on the deployment, add
`https://<app>.vercel.app/api/gmail/callback` to the OAuth client's authorized
redirect URIs and set `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` /
`GOOGLE_REDIRECT_URI`.

`GET /api/health` returns 503 when the database is unreachable and 200
otherwise, with source and job counts — point an uptime monitor at it.

### Operational notes worth knowing

These were all learned by breaking them:

- **Use the session pooler (5432), not the transaction pooler (6543).**
  Transaction mode multiplexes clients onto shared backends, so `SET` state
  leaks between them and a long-lived client eventually queues queries forever
  with no error surfaced. `npm run db:check` warns if the port looks wrong.
- **Postgres `bigint` arrives as a string** unless told otherwise. `src/lib/db.ts`
  parses int8 as a number because every id type declares `number`; without it,
  id comparisons silently fail and produce empty results rather than errors.
- **Discovery is time-budgeted, not count-budgeted.** Board polling gets 50% of
  the window, enrichment 20%, scoring 30%, with unused time rolling forward.
  Before that the polling phase consumed the whole run and nothing was scored.
- **The prefilter should only reject what is certainly wrong.** Scoring costs
  about a fifth of a cent; a job wrongly filtered out is invisible forever.

## Commands

```bash
npm run setup        # interactive .env.local setup
npm run db:check     # verify both connection strings, with specific fixes
npm run db:migrate   # apply migrations
npm run db:seed      # load db/profile.json
npm run db:refilter  # re-run the prefilter over stored jobs after a rule change
npm run db:redupe    # recompute dedupe keys and relink duplicates
npm run dev          # local dev server
npm run build        # production build
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
npm test             # node:test suite
npm run apply -- <id># Playwright application assistant (local only)
```

The three `db:` maintenance commands exist because normalization, prefiltering
and dedupe are all pure functions of stored data. When their rules improve, the
existing corpus should be re-evaluated rather than left stale — the first
`db:refilter` run recovered 79 jobs that a substring bug had discarded.

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
