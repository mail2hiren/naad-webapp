# Code vs. database gap report — 2026-11-06

Compared: this repo at `72749a8` (main) against the Naad Supabase project
`qerqzzqmpeqeknbnvyec` (ap-south-1, Postgres 17, status ACTIVE_HEALTHY).
Read-only review. **Update (same day, owner's go):** B1, B2, P1, P2, P3, R1 fixed — 0001–0004 applied, demo hospital seeded, app repointed (v0.1.0). Still open: P4/0005, H1, H2, AI keys.

## Summary

The database **was** built: 19 tables, 59 RLS policies, 10 functions, 3 triggers,
1 storage bucket, Realtime on 17 tables, both edge functions deployed. Every
column and every status value the app reads or writes exists and passes the
CHECK constraints. The gaps are in wiring, data, a few permissions, and the repo
being behind what is deployed.

## Blockers (the app cannot work against Naad today)

| # | Gap | Evidence | Fix |
|---|-----|----------|-----|
| B1 | **The app points at a different Supabase project.** | `.env.production` / `.env.example` use `linxtliatqpoaqbflwvh`, which is not in the Naad org (the org has only `qerqzzqmpeqeknbnvyec`). | Code change: set `VITE_SUPABASE_URL=https://qerqzzqmpeqeknbnvyec.supabase.co` and the Naad anon/publishable key. Not a migration. |
| B2 | **No hospital, no staff, no logins.** | 0 rows in `organizations`, `practitioners`, `auth.users`. Login requires an active `practitioners` row linked to the auth user. | Create users in Dashboard → Authentication, then proposal **0006**. |

## Permission gaps (RLS vs. what the screens do)

| # | Gap | Effect | Fix |
|---|-----|--------|-----|
| P1 | Admin "clear for discharge" updates `encounters.payment_status`; only `surgeon` may update encounters. | **Silent failure**: 0 rows updated, no error, screen says done, encounters stay unpaid. | **0003** |
| P2 | Role `physio` is routed to `/doctor` and `/inpatient`, but encounters insert/update are surgeon-only and patient updates exclude physio. | Physiotherapist can open the screens but cannot save. | **0004** (needs your decision on scope) |
| P3 | `ward_billing_ledger` still has the old FOR ALL policy next to the explicit ones. | Clinical staff can DELETE billing rows from the browser. | **0002** |
| P4 | Storage bucket `patient-documents` has a read policy only; no upload policy, no size/type limit. | No impact yet (the app does not upload real files — it stores `mock/<name>` paths). Needed when uploads are built. | **0005** with the upload code |

## Realtime

| # | Gap | Fix |
|---|-----|-----|
| R1 | App subscribes to `ward_billing_ledger`; table is not in `supabase_realtime`. | **0001** |

## Repo out of step with what is deployed

| # | Gap | Fix |
|---|-----|-----|
| H1 | DB migration history (`baseline_01..03`, `patients_read_own_row`, `wave0_security_hardening`, `revoke_anon_rls_helper_rpc`, all 2026-10-28) is **not in the repo**. The repo's three `supabase/migrations/2026100*` files are from the old project and are not in Naad's history (their effects are already in the baseline). | Repo-only: export the six applied migrations into `supabase/migrations/` under their real version numbers; move the three old files to `supabase/migrations_legacy/`. No DB change. |
| H2 | Edge function `transcribe-and-extract` (the live-mic pipeline) is deployed but its source is **not in the repo**. Deployed `clinical-whisperer` is a newer version (server-side role + budget checks) than the repo copy. Both reference `handler.ts`, `contract.ts`, `tests/functions/` and a `deploy-functions.yml` workflow that do not exist here. | Repo-only: pull the deployed source of both functions into `supabase/functions/`. |

## Things I could not verify from here

- **Edge function secrets** (`DEEPGRAM_API_KEY`, `ANTHROPIC_API_KEY`): the tools cannot list them. Without them the mic still records but transcription returns 500. Check Dashboard → Edge Functions → Secrets.
- **Auth settings**: Site URL / redirect URLs for the live host, email confirmation, leaked-password protection. Check Dashboard → Authentication.
- **Which DB the live sites call**: this container's network blocks `naad-care.netlify.app` and GitHub Pages.

## Cost notes ($0/month)

- Supabase Free: fine for a pilot, but the project **pauses after ~7 days idle** (it just did). A free GitHub Actions scheduled ping keeps it awake.
- Live mic → Deepgram (speech-to-text) + Claude (extraction) are **paid per use**. Deepgram gives starter credit; Anthropic needs prepaid credit. The DB enforces a per-hospital monthly ceiling (`organizations.ai_monthly_budget_usd`, default **45**). Set it on purpose in 0006. At 0 the mic still captures but the app falls back to typing.

## Low priority / informational

- Security advisor: 6 WARN "SECURITY DEFINER function executable by authenticated" — these are the `current_*` RLS helpers and `org_seat_usage` (used by the Admin screen). Intended; could later move helpers to a private schema.
- Most policies are `TO public` and call helpers that `anon` cannot execute, so a logged-out request gets a permission error rather than an empty list. Safe (fails closed); cosmetic.
- `link_patient_by_phone()` exists but is not callable by anyone and not used by the app; patient portal accounts are linked manually (see 0006 notes).
- Tables present but not used by the web app (used by edge functions or future screens): `ai_usage_log`, `transcripts`, `lab_orders`, `physiotherapy_plans`, `therapy_sessions`, `exercise_library`, `documents`.

## Proposed migration files (in `supabase/proposed/`, not applied)

1. `0001_realtime_ward_billing_ledger.sql` — low risk
2. `0002_ward_billing_ledger_append_only.sql` — low risk
3. `0003_admin_can_settle_encounter_billing.sql` — fixes a live silent bug
4. `0004_physiotherapist_clinical_writes.sql` — **decision needed**
5. `0005_storage_patient_documents_upload.sql` — apply with the upload code
6. `0006_seed_first_hospital_and_staff.sql` — template; fill placeholders after creating users
