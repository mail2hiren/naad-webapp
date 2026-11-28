# Changelog

All notable changes to Naad. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions follow [SemVer](https://semver.org/) and each release is tagged `vX.Y.Z`.

## [Unreleased]

## [0.8.2] - 2026-11-28

### Changed
- The demo now lives at **https://naad.digiyaan.com/** (GoDaddy CNAME to GitHub Pages, HTTPS enforced, built for the domain root). The old github.io address redirects there. Supabase sign-in emails and password resets now point to the new address; the old address stays allowed.

## [0.8.1] - 2026-11-28

### Added
- Data load `20261128092837_seed_patient_demo` for the demo hospital (org1): 5 test results (one awaiting its result, one the doctor flagged) and 4 documents for Ramesh, Kavita and Deepak, so the patient app's Reports tab and its Home alert show on the live site. Applied to the Naad database with the owner's go.

### Fixed
- Demo test results now use the database's own test types (xray, mri, blood) and record the ordering doctor by id, as the live table requires; the patient app shows the doctor's name.

## [0.8.0] - 2026-11-28

Phase 6 of the product gap audit: the patient app, built for a phone.

### Added
- **Patient app** (`/patient`) with a tab bar along the bottom on phones and along the top on larger screens: Home, Visits, Medicines, Bills, Reports.
- **Home:** the next appointment (requested, confirmed, or checked in with token), what needs attention (medicines ready to collect, money to pay, a test result the doctor noted), home exercises and pain progress, care journey, and recent visits.
- **Booking:** pick a doctor and a day and choose from that doctor's real free times (only working hours, nothing already taken); the request lands on the reception calendar to confirm. One tap "Request a follow-up" asks for the first free time with the patient's doctor. Patients can cancel their own request or booking.
- **Medicines:** each prescription with how to take it and where it is at the pharmacy (sent, being prepared, ready to collect, collected).
- **Bills:** every bill with what is still to pay, and a receipt to print or save as PDF.
- **Reports:** test results once the doctor has seen them (flagged ones marked), latest vital signs for ward patients, and the documents the hospital holds.
- A signed-in patient stays signed in when the page is reloaded or the app reopened.
- Demo: test results and documents for the patients who can sign in (Ramesh, Kavita, Deepak).
- Migration `20261128091221_patient_app` (`doctor_busy_times()` returning only busy times, and a trigger so a patient can only request or cancel their own appointments), applied to the Naad database with the owner's go.
- Tests: `e2e/patient-app-phase6.spec.ts` (4 flows), every patient tab in the accessibility scan at phone and desktop width.

### Changed
- "Request a follow-up" now asks for a real free time (it used to send a request with no date, which the reception calendar could not show).

## [0.7.1] - 2026-11-28

### Added
- Data load `20261128085409_seed_pharmacy_demo` for the demo hospital (org1): 8 more medicines so every prescribed demo medicine is stocked, 15 batches for all 12 (some expiring soon, one expired), and 9 vital-sign readings for the ward patients. Applied to the Naad database with the owner's go.

## [0.7.0] - 2026-11-28

Phase 5, part 2 of the product gap audit: the pharmacist's and the ward's working day.

### Added
- **Pharmacy stock by batch:** each medicine's batches with expiry date, quantity and selling price; filters for reorder, expiring within 90 days and expired; editable reorder level; receive stock (existing or new medicine, duplicate batches and already-expired stock refused); write off a batch with a reason (it stays on record); reorder list as CSV.
- **Dispense and bill:** dispensing an order works out the quantity from dose and duration, takes the earliest-expiring usable batches first (never expired stock), shows any shortfall, lowers stock and creates the pharmacy bill with a receipt; part payments and discounts as at reception.
- **Pharmacy Sales** page: today's sales and takings, every pharmacy bill with its receipt, and later payments.
- **Ward admission:** admit any patient to a free bed under a doctor; today's bed charge goes on the ward bill; move a patient to another bed; marking for discharge frees the bed, and so does the admin clearing payment.
- **Vital signs:** record BP, pulse, temperature, SpO2, breathing rate and pain with range checks; readings that need attention (high or low BP, fast or slow pulse, fever, low oxygen, fast breathing, severe pain) are flagged on the chart and the ward card; trend charts for pulse, temperature, BP and SpO2; every reading kept.
- Ward summary: free beds per ward and patients whose latest vitals need attention.
- Demo: stock for every prescribed demo medicine in batches (some expiring, one expired), and vitals for the three ward patients (Suresh with a rising fever).
- Migration `20261128084529_pharmacy_ward` (`stock_batches`, `vitals`, bill source and pharmacy order, pharmacist billing, doctors and physios may change only bed occupancy), applied to the Naad database with the owner's go.
- Tests: `e2e/pharmacy-ward-phase5b.spec.ts` (4 flows), pharmacy and ward screens in the accessibility scan at phone and desktop width, unit tests for dosing, expiry, earliest-expiry picking and vital-sign flags.

### Changed
- A rounds note charges that bed's daily rate once a day (it used to add a fixed ₹1,500 every time).
- Line charts can start above zero, so narrow ranges such as body temperature show their trend.
- Generic-equivalent chips on pharmacy orders have stronger contrast.

## [0.6.1] - 2026-11-28

### Added
- Data load `20261128080055_seed_admin_demo` for the demo hospital (org1): the demo build's price list (14 charges, 1 retired) and 17 beds in four wards, with the admitted demo patients in their beds. Applied to the Naad database with the owner's go.

## [0.6.0] - 2026-11-28

Phase 5, part 1 of the product gap audit: the hospital admin's working day.

### Added
- **Overview** with today's numbers: visits booked, seen, collected today, balance due, beds occupied, pharmacy orders waiting.
- **Working hours** per doctor and physio: working days, morning and evening sessions, slot length; checked before saving (times, order, overlaps) and shown as bookable slots a week. The reception calendar uses them straight away; "Use hospital hours" goes back to the default.
- **Price list** (Fees and price list): add charges by kind, reprice, retire and bring back (no deletes), duplicate names refused. Reception's bill now adds charges from this list.
- **Wards and beds:** occupancy totals, each ward's beds with type, daily rate and patient, add a bed (new or existing ward, duplicate labels refused), reprice, close and reopen (an occupied bed cannot be closed).
- **Reports** for today, the last 7 days, this month or chosen dates: visits by doctor (booked, seen, no-show rate, cancelled, billed), money (billed, discounts, collected by method), top charges, who owes money, beds and pharmacy. Visits and bills download as CSV.
- **Audit log:** every recorded action, newest first, searchable by text, role and dates, downloadable as CSV, with a check that the log's hash chain is unbroken.
- Demo: price list of 14 charges, 17 beds in four wards with the admitted demo patients in them, and Dr. Namrata on her own hours (10 am to 2 pm).
- Migration `20261128075340_admin_rates_beds_audit` (`service_rates` and `beds` tables, `audit_chain_check()`), applied to the Naad database with the owner's go.
- Tests: `e2e/admin-phase5.spec.ts` (6 flows), the admin screens in the accessibility scan at phone and desktop width, unit tests for working-hours checks and CSV.

### Changed
- Staff changes (fees, working hours) now reach every open screen live.
- Admin sidebar: Overview, Staff, Departments, Working hours, Fees and price list, Wards and beds, Reports, Audit log, Discharge billing, Ward.

## [0.5.1] - 2026-11-28

### Added
- Data load `20261128072327_seed_reception_demo` for the demo hospital (org1): the demo build's front-desk day (3 demo patients, 14 appointments with tokens and every status, 3 bills incl. a part-paid physio package) and the hospital's address and phone for receipts where empty. Applied to the Naad database with the owner's go.

## [0.5.0] - 2026-11-28

Phase 4 of the product gap audit: the front desk's full working day.

### Added
- **Calendar** (Reception): one column per doctor and physio for any day, built from working hours (default Mon-Sat 09:30-13:30 and 16:00-19:00; 15-min slots, 30 for physios). Free slots are tap-to-book; booked slots show the patient, visit type, token and status. Day totals: booked, checked in, seen, no-shows, free slots left.
- **Booking** with patient search (name, mobile, hospital number) or new-patient registration (next `DGY-` number, duplicate-mobile warning); only free, future slots are offered.
- **Appointment actions:** check in (next token for that doctor's day, patient joins the doctor's queue), reschedule (keeps the original time), cancel with a reason, no-show, book again, and confirm, move or decline a request a patient made in the app.
- **Billing:** visits waiting to be billed (seen first), bills with line items, quick items (registration, X-ray, dressing, physio session, 8-session physio package), discount, full or part payment by cash, UPI, card or insurance, later payments, void with a reason (never delete), and a printable receipt. Day totals: collected today by method, bills today, waiting, balance due.
- **Patients** (Reception): search everyone, register, see upcoming and recent visits, bills and balance due, and book or bill from there.
- Walk-ins get a token and a visit in the doctor's day, so they can be billed too.
- Finishing a consult (doctor) or saving a therapy session (physio) marks the visit "seen" for billing.
- Today's queue shows token numbers, in check-in order.
- Demo: a full Saturday for three doctors (seen, billed, checked in, no-show, cancelled, requested), Monday follow-ups, three more demo patients and three bills including a part-paid physio package.
- Migration `20261128070653_reception_calendar_billing` (working hours and slot length, appointment token/check-in/cancel/visit type/reschedule fields, a `bills` table, and a policy letting a doctor or physio mark their own appointments seen), applied to the Naad database with the owner's go.
- Tests: `tests/lib/schedule.test.ts` (slots, clashes, tokens, receipt numbers, totals), `e2e/reception-calendar.spec.ts` (7 flows), and the reception screens in the accessibility scan at phone and desktop width.

### Changed
- Reception sidebar: Today's queue, Calendar, Patients, Walk-in registration, Billing. The old single "Appointments" form is replaced by the calendar (`?section=appointments` still opens it).
- Notifications now sit above open dialogs.

## [0.4.1] - 2026-11-28

### Added
- Data load `20261128064102_seed_physio_demo` for the demo hospital (org1): 30 library exercises, 5 therapy plans and 15 session records, so the live physio screens show a working caseload. Applied to the Naad database with the owner's go.

## [0.4.0] - 2026-11-28

Phase 3 of the product gap audit: a real physiotherapy module.

### Added
- **Caseload** (`/physio`): every active therapy plan with sessions done, current pain and its trend, and review date (flagged when due). New referrals from doctors appear on top; **Accept and plan** starts a therapy plan.
- **Therapy plan page**:
  - Condition, goals, planned sessions, sessions per week and review date; mark complete or reopen.
  - Pain-over-sessions chart and the latest range of motion and strength.
  - Full session record, newest first.
- **Record a session**: pain (0-10), range of motion, strength, mobility, tolerance, exercises done and a progress note. **Start recording** lets Naad draft the session from the conversation (real recordings now carry the therapy plan); the physio checks it and signs by saving. Drafts are marked "drafted by Naad, approved by the physio".
- **Home exercise programme** per plan, built from the library with sets, reps, days a week and a note.
- **Exercise library**: searchable by name and body region; add and edit exercises with instructions.
- **Patient app**: "Your home exercises" and "Your progress" (pain chart) for patients with an active plan.
- Physio sidebar: Today's patients, Caseload, Exercise library, Ward. A physio's patient chart links to that patient's therapy plan.
- Migration `20261128062138_physio_plan_details` (plan details, home programme, exercise instructions, editable sessions), applied to the Naad database with the owner's go.

### Demo mode
- 30 exercises, 5 therapy plans (4 active, 1 completed) with 15 sessions where pain falls and range of motion improves. Demo recordings draft a session that matches the patient's condition (knee, back, hip) and their own programme.

## [0.3.0] - 2026-11-27

Phase 2 of the product gap audit: the DigiYaan Super admin console and departments.

### Added
- **Super admin console** at `/platform`, with its own sign-in for DigiYaan staff:
  - Hospitals list with seats used, patients and AI spend this month.
  - Add a hospital together with its first admin login.
  - Edit a hospital's profile, plan, user seats, AI budget and status (trial, active, payment overdue, suspended).
  - Departments and staff for any hospital.
  - Activity log of every change.
- **Real staff logins**: add staff (doctor, physiotherapist, receptionist, pharmacist, admin) with a one-time password; reset passwords; deactivate and reactivate. Seat limits are enforced.
- **Choose your password** screen: new or reset logins must pick their own password at first sign-in.
- **Set your password from an email link**: invitations and password-reset emails open a Set password screen wherever they land; expired links say so. **Forgot password?** on the staff and super admin sign-in pages.
- Hospital admins get **Staff** and **Departments** pages for their own hospital (same tools, limited to their hospital).
- `platform-admin` edge function: the only place logins are created or cross-hospital changes happen; checks the caller on every request and writes an audit entry. 11 Node tests.
- Migrations `20261127054343_platform_admins_and_audit` and `20261127054404_departments` (applied to the Naad database with the owner's go). `platform-admin` deployed.

### Fixed
- The hospital Admin "Reset Password" button only displayed a made-up password and changed nothing. It now really resets the login.

### Setup (live)
- Supabase Auth Site URL set to the live app; redirect URLs allow the live site, Netlify, Netlify PR previews and localhost.
- First super admin: the owner's own login (password set by the owner via the reset link), added to `platform_admins` with the owner's OK.

### Demo mode
- Super admin `owner@digiyaan.demo`, a second hospital (Sahyadri Ortho Care, admin `meera@digiyaan.demo`) and three departments for the demo hospital. Demo mode runs the real `platform-admin` code against the in-memory data.

## [0.2.0] - 2026-11-27

Phase 1 of the product gap audit: the foundation every user sees first.

### Added
- Left sidebar navigation for every role, with one page per job: Reception (Today's queue, Appointments, Walk-in registration), Pharmacy (Orders, Stock), Admin (Overview, Staff, Consultation fees, Discharge billing). On phones it becomes a slide-in menu.
- Light theme by default, with a Dark mode switch in the sidebar (remembered per device).
- Physiotherapist is now its own option at sign-in (previously physios had to pick "Doctor").
- Demo mode: stopping a recording fills the note with a realistic AI draft for each specialty, instead of an empty note.
- Demo mode: all demo dates move with the calendar, so the demo always happens today; demo sign-in survives a page refresh.

### Changed
- Readable type everywhere: no text smaller than 12 px, labels in plain sans-serif at higher contrast, 15 px inputs.
- Naad branding: new sound-wave mark on sign-in, sidebar, favicon and app icons (replaces the placeholder lightning bolt). The hospital's name shows in the sidebar.
- Plain clinic wording instead of developer terms (e.g. "Waiting to be seen" instead of "waiting doctor", "Sign and finish" instead of "Authorize & Route", no database field names on screen). The finish button now describes a physio session correctly.

### Fixed
- Pharmacy timers read "2h 35m" or "3 days" instead of six-figure minute counts.
- Medicines missing from the stock list say "Not in stock list" instead of a false "Low stock".
- Demo appointments have real times instead of "Time not set".

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
