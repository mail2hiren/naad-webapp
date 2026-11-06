# CLAUDE.md — Naad

Naad is DigiYaan's ambient-AI healthcare SaaS for doctors. It listens to a
clinic visit and turns it into a structured, clinician-signed note, from front
desk through doctor, pharmacy, ward and discharge.

**Non-negotiable: live microphone ambient voice capture is the core feature.
Never remove it, hide it, or replace it with typing-only.** The typed path is a
fallback (mic denied, noisy room, AI budget reached), not a substitute.

## Working rules (owner's rules — follow every time)

1. **One branch per change.** Never commit to `main` directly.
2. **No merge to `main` without the owner's explicit "go".** Open the PR, report, wait.
3. **Version tags + CHANGELOG.** Every merged change gets a `CHANGELOG.md` entry
   and a semver tag (`vMAJOR.MINOR.PATCH`) on the merge commit; keep
   `package.json` `version` in step.
4. **Verify live before saying "done".** After deploy, open the live site (and
   check the DB/function state) and confirm the change works. If it could not
   be verified, say so plainly — never report it as done.
5. **Database changes only with the owner's OK — per migration.** Write the SQL
   in `supabase/proposed/`, explain it, wait for "go", apply it, verify, then
   move the file into `supabase/migrations/` named by its applied version.
   No ad-hoc DDL, no data edits on the live DB without the same OK.
6. **Budget is $0/month.** Do not create paid resources (Supabase branches,
   paid add-ons, new projects with cost, paid hosting). Flag anything that
   would cost money before doing it.
7. Never commit secrets. Only the public anon/publishable key may live in the
   repo. Vendor keys are Supabase Edge Function secrets.

## Roles (6)

| Product role | DB `staff_role` / account | Route |
|---|---|---|
| Surgeon (Doctor) | `surgeon` | `/doctor`, `/inpatient` |
| Physiotherapist | `physio` | `/doctor`, `/inpatient` |
| Receptionist | `receptionist` | `/reception` |
| Pharmacist | `pharmacist` | `/pharmacy` |
| Hospital Admin | `admin` | `/admin`, `/inpatient` |
| Patient | `patients.auth_user_id` (not staff) | `/patient` (separate login) |

Staff login (`AuthContext`) requires an **active** `practitioners` row whose
`auth_user_id` matches the Supabase auth user, and the role picked at login
must match the DB role.

## Architecture

- **Frontend:** React 19 + TypeScript (strict) + Vite + Tailwind v4, React Router 7. PWA (`public/sw.js`, manifest).
- **Backend:** Supabase only — Postgres + RLS, Auth (email/password), Realtime, Storage, Edge Functions. No other server.
- **Data access:** `src/lib/supabaseClient.ts`. `src/context/ClinicContext.tsx` loads all org data and keeps it live with one Realtime channel per table.
- **Ambient capture:** `src/hooks/useRealAmbientCapture.ts` — `getUserMedia` → `MediaRecorder` → POST audio to edge function `transcribe-and-extract` (Deepgram nova-3 diarised STT → Claude structured extraction; logs cost to `ai_usage_log`; refuses with 402 past the hospital's monthly AI budget).
- **Clinical Whisperer:** edge function `clinical-whisperer` — case-specific reminders; fails soft to a static checklist.
- **Mock mode:** `VITE_USE_MOCK=1` uses the in-memory backend in `src/mock/` and scripted ambient (CI, demos). `VITE_FORCE_REAL_AMBIENT=1` drives the real capture path against a stubbed function (Playwright `real-ambient` project).
- **AI guardrails:** the AI never writes the diagnosis or examination; assessment/plan are tentative; a human sign-off gate precedes authorisation.

## Hosting

- **GitHub Pages** — primary per README: `.github/workflows/deploy-pages.yml` builds on every push to `main` → `https://mail2hiren.github.io/naad-webapp/` (base path `/naad-webapp/`; `PAGES_BASE_PATH` repo variable overrides for a custom domain).
- **Netlify** — site `naad-care` (`https://naad-care.netlify.app`) is the **live demo site** (rebuilds on push to `main`; `netlify.toml`: `npm run build` → `dist`, SPA redirect). Since 2026-11-06 it has **no** `VITE_SUPABASE_*` env vars in Netlify: the build reads `.env.production`. Do not re-add them there (they silently override the repo and once kept the live site on the old database).
- Pushes to `main` deploy, which is another reason nothing merges without "go".
- CI: `.github/workflows/ci.yml` — `tsc -b`, `oxlint`, both Playwright projects (incl. axe WCAG 2.1 AA gate) on every push/PR.

## Database

- **Project:** Supabase "Naad", ref **`qerqzzqmpeqeknbnvyec`**, region ap-south-1, Postgres 17, Free plan (pauses after ~7 days idle).
- The app (`.env.production`) points at this project since v0.1.0.
- **Demo data:** org `org1` "Naad Demo Hospital" (fictional). Staff logins `sunita|sagar|jayani|namrata|vikram|raj@digiyaan.demo`, patient logins `ramesh|deepak|kavita@digiyaan.demo`; the shared demo password is held by the owner, never in the repo. Monthly AI budget for org1: $5.
- **Multi-tenant:** every row has `org_id`; RLS scopes to `current_org_id()`. Helper functions: `current_org_id`, `current_staff_role`, `current_patient_id`, `current_practitioner_id`, `current_actor_name` (SECURITY DEFINER).
- **Tables (public):** organizations, practitioners, patients, appointments, encounters, prescriptions, pharmacy_orders, referrals, ward_billing_ledger, inventory, notifications, documents, transcripts, ai_usage_log, audit_events (hash-chained by trigger), lab_orders, physiotherapy_plans, therapy_sessions, exercise_library.
- **Subscriptions/seats:** `organizations.plan / subscription_status / seat_limit`; trigger `enforce_seat_limit` on practitioners; `org_seat_usage()` RPC for the Admin screen. Hospitals cannot change their own plan.
- **Storage:** private bucket `patient-documents`, paths `<org_id>/<patient_id>/...`.
- **Edge function secrets:** `DEEPGRAM_API_KEY`, `ANTHROPIC_API_KEY` (optional `ANTHROPIC_MODEL`) — set in Supabase, never in the repo.
- **Migrations:** applied history lives in the DB (`supabase_migrations.schema_migrations`). Proposed-but-unapproved SQL lives in `supabase/proposed/`. Migrations from 2026-11-06 onward are in `supabase/migrations/` under their applied versions; the 2026-10-28 baseline is still only in the DB (gap H1).

## Commands

```bash
npm ci
npm run dev                      # real backend (needs .env.local)
VITE_USE_MOCK=1 npm run dev      # mock backend, no network
npx tsc -b && npm run lint
npx playwright test --trace off  # chromium + real-ambient projects
npm run build
```

Demo logins in mock mode: `*.digiyaan.demo` / `pass1234`.
