# Proposed migrations — NOT APPLIED

Nothing in this folder has been run against any database. Each file is a
proposal from the 2026-11-06 code-vs-database gap review
(`docs/db-gap-report-2026-11-06.md`).

Workflow (see CLAUDE.md): the owner says "go" per file → it is applied to the
Naad project (`qerqzzqmpeqeknbnvyec`) → verified live → the file is moved into
`supabase/migrations/` with its applied timestamp as the filename prefix.

| File | What | Status |
| --- | --- | --- |
| 0005 | Storage upload policy for patient documents | Waiting (needed with the upload screens) |
| 0006 | Seed template for a first real hospital | Superseded by the Super admin console (Phase 2) |
| 0007 | Platform layer: super admins, platform audit, hospital profile fields | Applied 2026-11-27 as `20261127054343` |
| 0008 | Departments per hospital | Applied 2026-11-27 as `20261127054404` |
| 0009 | Physio plan details, home programme, exercise instructions, editable sessions | Applied 2026-11-28 as `20261128062138` |
| 0010 | Demo physio data for org1: 30 exercises, 5 plans, 15 sessions (data only) | Applied 2026-11-28 as `20261128064102` |
| 0011 | Reception: working hours, tokens, reschedule/cancel fields, bills, clinician may mark own visits seen | Applied 2026-11-28 as `20261128070653` |
| 0012 | Demo front-desk day for org1: 3 patients, 14 appointments, 3 bills, receipt address (data only) | Applied 2026-11-28 as `20261128072327` |
| 0013 | Admin: service_rates and beds tables, audit_chain_check() | Applied 2026-11-28 as `20261128075340` |
| 0014 | Demo price list and wards/beds for org1, admitted patients in beds (data only) | Applied 2026-11-28 as `20261128080055` |
| 0015 | Pharmacy stock batches, vitals, pharmacy billing, clinician bed occupancy | Applied 2026-11-28 as `20261128084529` |
| 0016 | Demo pharmacy stock (8 medicines, 15 batches) and ward vitals for org1 (data only) | Applied 2026-11-28 as `20261128085409` |
| 0017 | Patient app: doctor_busy_times(), patients may only request or cancel appointments | Applied 2026-11-28 as `20261128091221` |
| 0018 | Demo test results and documents for the patient app, org1 (data only) | Applied 2026-11-28 as `20261128092837` |
| 0019 | Calendar: "with doctor" step and times, overbooking, repeat courses, blocked time, waitlist, patient's live queue | Applied 2026-11-28 as `20261128171547` |
| 0020 | Front desk modules: follow-ups, contact log, refunds and cash closing, admissions by reception, insurance, enquiries, packages | Proposed, awaiting go |

They are kept outside `supabase/migrations/` on purpose, so no tool
(`supabase db push`, a Supabase GitHub integration) can apply them by accident.
