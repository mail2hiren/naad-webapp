# Changelog

All notable changes to Naad. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions follow [SemVer](https://semver.org/) and each release is tagged `vX.Y.Z`.

## [Unreleased]

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
