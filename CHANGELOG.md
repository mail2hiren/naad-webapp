# Changelog

All notable changes to Naad. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions follow [SemVer](https://semver.org/) and each release is tagged `vX.Y.Z`.

## [Unreleased]

## [0.1.2] - 2026-11-21

Repo now holds exactly what is live. No change to the live app, database or functions.

### Added
- Source of both live edge functions, copied exactly from Supabase: `transcribe-and-extract` (with the hospital/role checks and Deepgram data opt-out) and `clinical-whisperer` (doctor-only, budget-checked).
- `npm run test:functions` (and a CI step): 22 tests for access rules, privacy rules and the pinned AI contract.
- The six 2026-10-28 baseline migrations in `supabase/migrations/`, checksum-identical to the database's history.

### Changed
- Three migrations from the old Supabase project moved to `supabase/migrations_legacy/`.
- Replaces old PRs #1–#4 (E01, A01, A02, A03): their fixes were already live; this brings the matching code and tests into the repo.

## [0.1.1] - 2026-11-21

### Added
- `supabase-keepalive` GitHub Actions workflow: pings the Naad database every 3 days so the Free-plan project no longer auto-pauses after 7 idle days (it paused around 2026-11-14 after the last use on 2026-11-07). Free; needs no secrets.

## [0.1.0] - 2026-11-06

First version wired to the Naad Supabase project and live for demos.

### Changed
- App now uses the Naad Supabase project (`qerqzzqmpeqeknbnvyec`) instead of the old one.

### Fixed
- Reception "schedule appointment" saved free text into a date-time column, so real bookings failed; it now uses a date-time picker, stores a real time, and shows an error if saving fails.
- Database: Admin can now mark visits paid (was a silent no-op); Physiotherapists can save visit notes and patient progress (not prescriptions); ward charges update live on other screens; ward billing rows can no longer be deleted from the browser.

### Added
- Demo hospital "Naad Demo Hospital" with staff and patient logins and sample patients (fictional).
- `CLAUDE.md`: architecture, hosting, database and working rules.
- `docs/db-gap-report-2026-11-06.md`: code vs. Naad database comparison.
- `supabase/proposed/`: migrations still awaiting approval (0005 storage upload, 0006 seed template).
