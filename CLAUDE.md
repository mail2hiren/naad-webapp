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
| DigiYaan Super admin | `platform_admins.auth_user_id` (not staff, above all hospitals) | `/platform` (separate login) |

Staff login (`AuthContext`) requires an **active** `practitioners` row whose
`auth_user_id` matches the Supabase auth user, and the role picked at login
must match the DB role (Doctor = `surgeon`, Physiotherapist = `physio`).

Navigation: `src/lib/nav.ts` (`ROLE_NAV`) lists each role's sidebar pages;
`?section=` picks the part of a workspace page to show (`useSection`).

## Architecture

- **Frontend:** React 19 + TypeScript (strict) + Vite + Tailwind v4, React Router 7. PWA (`public/sw.js`, manifest).
- **Theme:** colour tokens in `src/index.css` (light default, `[data-theme='dark']` override; `src/lib/theme.ts`). Never hard-code colours in components; minimum text size 12 px.
- **Backend:** Supabase only — Postgres + RLS, Auth (email/password), Realtime, Storage, Edge Functions. No other server.
- **Data access:** `src/lib/supabaseClient.ts`. `src/context/ClinicContext.tsx` loads all org data and keeps it live with one Realtime channel per table.
- **Ambient capture:** `src/hooks/useRealAmbientCapture.ts` — `getUserMedia` → `MediaRecorder` → POST audio to edge function `transcribe-and-extract` (Deepgram nova-3 diarised STT → Claude structured extraction; logs cost to `ai_usage_log`; refuses with 402 past the hospital's monthly AI budget).
- **Clinical Whisperer:** edge function `clinical-whisperer` — case-specific reminders; fails soft to a static checklist.
- **Calendar:** `src/components/calendar/` (`CalendarPage`; spec `docs/specs/calendar.md`), rules in `src/lib/calendar.ts` (grid layout, lanes, week/month, blocks, waiting/running late, repeat courses, no-show risk, waitlist matching, reminders; tests in `tests/lib/calendar.test.ts`). Patient flow: requested → scheduled → checked_in (Waiting) → in_consultation (With doctor; the doctor opening the chart calls `startConsult`) → completed (Done, `checkOut`/`markSeen`). Blocked time in `calendar_blocks`, waitlist in `appointment_waitlist` (`useCalendarBlocks`, `useWaitlist`). Waiting-room token screen: `/reception?section=display`. Patients see their live queue via RPC `my_queue_status()`.
- **Front desk (Reception):** `?section=calendar|patients|walk-in|billing|queue|display`. Patients opens on today's patients (check-in on the row); `?patient=<id>` opens the full record (`src/components/reception/PatientRecord.tsx`, extra data via `usePatientRecord`). Rules in `src/lib/schedule.ts` (slots from `practitioners.working_hours`/`slot_minutes`, clashes, tokens per doctor per day, receipt numbers `R-01001…`, totals), writes in `src/lib/frontDesk.ts`, UI in `src/components/reception/`. Bills in `bills` via `useBills`. Doctor/physio finishing a visit calls `markSeen` so it appears under "Waiting to be billed".
- **Hospital admin:** `?section=overview|staff|departments|hours|fees|beds|reports|audit|billing`; components in `src/components/admin/`. Price list in `service_rates` and wards/beds in `beds` (`useRates`, `useBeds` in `src/hooks/useHospitalSetup.ts`, generic live table hook `useOrgTable`). Audit log integrity via RPC `audit_chain_check()` (admin only). CSV export via `src/lib/csv.ts`.
- **Pharmacy and ward:** stock by batch in `stock_batches` (rules in `src/lib/pharmacy.ts`: dose quantity, expiry, earliest-expiry-first picking); `inventory.stock` is kept as the total. Dispensing (`src/components/pharmacy/Dispense.tsx`) bills with `bills.source = 'pharmacy'`. Ward: admission, bed moves and vitals in `src/components/ward/WardPanels.tsx`, writes in `src/lib/wardActions.ts`, vital-sign flags in `src/lib/ward.ts`; one bed-day charge per day per patient in `ward_billing_ledger`.
- **Patient app:** `/patient` (`PatientPortalView` sign-in, `src/components/patient/PatientApp.tsx`, `?tab=home|visits|medicines|bills|reports`), data via `usePatientData` (own rows only). Booking uses RPC `doctor_busy_times()` (times only) through `src/lib/patientBooking.ts`; trigger `appointments_patient_limits` lets a patient only request or cancel.
- **Physiotherapy module:** `/physio` (`PhysioView`): caseload, therapy plans (`physiotherapy_plans`, incl. `home_programme` jsonb), session records (`therapy_sessions`), exercise library (`exercise_library`); data via `usePhysio`. Physio recordings use stage `physio` with `x-plan-id`.
- **Platform admin:** edge function `platform-admin` — the only code that creates logins or works across hospitals (service role). Super admins may do everything; a hospital admin only staff/departments of their own hospital. Every action is written to `platform_audit`. New/reset logins get a one-time password and `user_metadata.must_change_password`, enforced by `ProtectedRoute` (`ChangePassword` screen). Demo mode runs the same handler against the mock tables.
- **Mock mode:** `VITE_USE_MOCK=1` uses the in-memory backend in `src/mock/` and scripted ambient (CI, demos). Demo dates shift to today (`VITE_FREEZE_DEMO_DATES=1` in the test builds keeps them fixed); demo recordings fill the note from `src/mock/demoExtraction.ts` (not in `--mode test`). `VITE_FORCE_REAL_AMBIENT=1` drives the real capture path against a stubbed function (Playwright `real-ambient` project).
- **AI guardrails:** the AI never writes the diagnosis or examination; assessment/plan are tentative; a human sign-off gate precedes authorisation.

## Hosting

- **GitHub Pages** — primary per README: `.github/workflows/deploy-pages.yml` builds on every push to `main` → **`https://naad.digiyaan.com/`** (custom domain since 2026-11-28: CNAME `naad` → `mail2hiren.github.io` in GoDaddy DNS for digiyaan.com, repo variable `PAGES_BASE_PATH=/`, HTTPS enforced). The old `https://mail2hiren.github.io/naad-webapp/` redirects there. This is the demo site; real hospitals get their own domain and a separate paid database later.
- **E-brochure:** `public/brochure/index.html` is a standalone static marketing page served at `/brochure/` (not part of the React app).
- **Netlify** — site `naad-care` (`https://naad-care.netlify.app`) also exists, built from `netlify.toml` (`npm run build` → `dist`, SPA redirect).
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
- **Super admins:** rows in `platform_admins` (service-role only). The first one is the owner's login, added 2026-11-27. Auth Site URL = `https://naad.digiyaan.com/`; redirect URLs allow it, the old github.io address, Netlify, `deploy-preview-*--naad-care.netlify.app` and localhost:5173.
- **Edge function secrets:** `DEEPGRAM_API_KEY`, `ANTHROPIC_API_KEY` (optional `ANTHROPIC_MODEL`) — set in Supabase, never in the repo.
- **Migrations:** applied history lives in the DB (`supabase_migrations.schema_migrations`). Proposed-but-unapproved SQL lives in `supabase/proposed/`. Every applied migration (2026-10-28 baseline onward) is in `supabase/migrations/` under its applied version, byte-for-byte as recorded in the DB. `supabase/migrations_legacy/` holds three files from the old project, kept for history only.
- **Edge function source:** `supabase/functions/<name>/` is exactly what is deployed (`index.ts` wires Deno, `handler.ts` is the logic, `contract.ts` pins the model/prompt/tools). `npm run test:functions` runs their tests (also in CI). Deploys are manual for now (`supabase functions deploy <name>`); there is no deploy workflow yet.

## Commands

```bash
npm ci
npm run dev                      # real backend (needs .env.local)
VITE_USE_MOCK=1 npm run dev      # mock backend, no network
npx tsc -b && npm run lint
npm run test:functions          # edge function tests (Node, no network)
npx playwright test --trace off  # chromium + real-ambient projects
npm run build
```

Demo logins in mock mode: `*.digiyaan.demo` / `pass1234`.
