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
| 0007 | Platform layer: super admins, platform audit, hospital profile fields | Waiting for owner's go (Phase 2) |
| 0008 | Departments per hospital | Waiting for owner's go (Phase 2) |

They are kept outside `supabase/migrations/` on purpose, so no tool
(`supabase db push`, a Supabase GitHub integration) can apply them by accident.
