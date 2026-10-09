# Naad — Ambient AI for Doctors

Naad listens to a clinic visit (or reads a typed conversation), and turns it into a structured, **clinician-signed** note — from the front desk through the doctor, pharmacy, ward and discharge. Built by DigiYaan.

**Stack:** React 19 · TypeScript (strict) · Vite · Tailwind v4 · Supabase (Postgres + RLS + Realtime + Edge Functions) · Playwright.

## What is real, what is simulated

| Piece | In production | In the test/mock build (`VITE_USE_MOCK=1`) |
|---|---|---|
| Reception "AI Guided Intake" and Doctor ambient session | Real microphone → `transcribe-and-extract` edge function (Deepgram nova-3 diarised speech-to-text → Claude structured extraction) | Scripted simulation (so the test suite never needs a mic or paid APIs) |
| Typed fallback (mic denied / noisy room) | Same edge function, text in | Same |
| Clinical Whisperer, risk scan | Real edge function / rule-based on patient data | Static fallback |
| Data | Supabase with row-level security per hospital | In-memory mock |

The AI never writes the diagnosis: examination findings are left to the clinician, assessment/plan are phrased as tentative, and a Human-in-the-Loop sign-off gate precedes authorisation.

## Run locally

```bash
npm install
cp .env.example .env.local     # real Supabase (anon key only; safe to expose)
npm run dev
```

Mock backend, no network: `VITE_USE_MOCK=1 npm run dev`. Demo logins use `*.digiyaan.demo` / `pass1234`.

## Test

```bash
npx tsc -b && npm run lint
npx playwright install chromium   # first time only
npx playwright test               # both projects below
```

- **chromium** — scripted flows for every role, plus an **accessibility gate** (axe-core WCAG 2.1 AA at phone and desktop widths; serious/critical violations fail).
- **real-ambient** — Chromium's fake microphone drives the real capture path (`getUserMedia` → `MediaRecorder` → upload) against a stubbed edge function, asserting the request contract and how the extraction lands in Reception and Doctor screens.

Edge function and database checks (no browser needed):

```bash
npm run test:functions                     # transcribe-and-extract contract
DATABASE_URL=postgres://… npm run test:db  # schema + RLS tests on a throwaway Postgres
```

- **test:functions** runs the real `transcribe-and-extract` handler against stubbed Deepgram, Anthropic and Supabase and compares the pinned model, prompt hash, tool schemas and response shape with `tests/functions/transcribe-and-extract.contract.json`. A deliberate change: `UPDATE_CONTRACT=1 npm run test:functions`, then commit the snapshot.
- **test:db** loads `supabase/schema.sql` (the production `public` schema, dumped 2026-10-09) plus any newer migration, then runs `supabase/tests/*.test.sql`. It drops and recreates a `naad_test` database.

CI (`.github/workflows/ci.yml`) runs all of the above on every push and pull request.

## Deploy

**GitHub Pages (primary, free).** `.github/workflows/deploy-pages.yml` builds and publishes on every push to `main`. One-time setup: repo **Settings → Pages → Source: GitHub Actions**. The app is then live at `https://<user>.github.io/naad-webapp/`. For a custom domain (recommended before hospitals use it), add it under Settings → Pages and set the repository variable `PAGES_BASE_PATH` to `/`.

Netlify still works with the same code (`netlify.toml`), but it is no longer required.

Edge functions live in `supabase/functions`. `transcribe-and-extract` deploys from this repo only: `.github/workflows/deploy-functions.yml` runs on pushes to `main` that touch it (repository secret `SUPABASE_ACCESS_TOKEN` required); secrets (`DEEPGRAM_API_KEY`, `ANTHROPIC_API_KEY`) are set there, **never** in this repo. The browser only ever holds the public anon key (`.env.production`).

> Supabase free-tier projects pause after a week of inactivity. A paying hospital deployment needs the Pro plan (or an uptime ping).

## Hospitals, users and subscriptions

Multi-tenant by design: every row carries `org_id` and Postgres RLS scopes all reads/writes to the signed-in user's hospital (`current_org_id()`); the app derives the hospital from the signed-in account.

Per-user ("seat") pricing is built into the database (`supabase/migrations/20261007_org_subscription_seats.sql`):

- `organizations` carries `plan`, `subscription_status` (`trialing | active | past_due | canceled`), `seat_limit`, `billing_email`, `trial_ends_at`, `current_period_end`.
- A **seat** = one active staff account. Patients are free.
- A trigger rejects creating/reactivating a staff account beyond `seat_limit` (`seat_limit_reached`) or for a `canceled` hospital — enforced server-side, not bypassable from the browser.
- Hospitals cannot change their own plan (no UPDATE policy on `organizations`); only the service role can. To onboard a hospital: insert an `organizations` row with its `seat_limit`, then add its staff.
- The Admin screen shows plan, status and seats used / limit.

**Not built yet (needs your payment-gateway choice):** checkout and a webhook (Stripe or Razorpay) that sets `plan`, `seat_limit`, `subscription_status` and `current_period_end` on payment events. The schema above is the contract that webhook writes to.

## Security notes

- Row-level security on every table; staff roles gate writes.
- The anon key in `.env.example` is public by design; never commit the service-role key or any vendor API key.
- Review the Supabase security advisor before onboarding real patients (leaked-password protection, function execute grants).
