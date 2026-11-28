# Reception calendar — product spec

The calendar is the front desk's main screen. It must be complete and fast on a
busy morning: a receptionist books, checks in, moves and checks out patients
without leaving it. Benchmark: Practo Ray. Reviewer: a practising physiotherapist.

## Layout
- **Left panel:** mini month calendar (jump to any date, today marked, days with
  bookings dotted); the doctor list with a colour per doctor, tick to show or
  hide, "Only" to show one, today's count per doctor; filters by visit type and
  status; legend.
- **Top bar:** Today, previous/next, the date or range, Day / Week / Month,
  search appointments, Block time, Day sheet, New appointment.
- **Main area:** the chosen view.
- **Right panel (wide screens) / below (narrow):** the live patient flow:
  Waiting (with minutes waited, over 20 flagged), With doctor, Done today.

## Views
- **Day:** one column per selected doctor on a time grid (5-minute precision).
  Working hours light, outside hours and breaks shaded, blocked time hatched
  with its reason, a red "now" line. Appointments are blocks as tall as their
  length, coloured by status, with token, patient, visit type and reason.
  Overlapping (overbooked) appointments sit side by side.
- **Week:** seven day columns for the selected doctors, blocks marked with the
  doctor's colour.
- **Month:** a month grid; each day shows counts by status and the first few
  patients; click a day to open it.

## Booking
- Click a free time (or New appointment): patient search by name, mobile or
  hospital number, or a new patient in place; doctor and time prefilled; visit
  type sets the length (new 15, follow-up 10, procedure 30, therapy = the
  physio's slot); reason; **Repeat** for courses (e.g. every 2 days × 8).
- Booked time, blocked time and outside hours are refused; a clash can be
  **overbooked** on purpose with a warning, and the block shows "Overbooked".

## Patient flow
Booked → Arrived (check-in, token, time) → With doctor (called in, time) →
Done (checked out, time) → Billed. Also Requested (from the patient app),
No-show, Cancelled. Every step records its time; waiting time is live.
The doctor's screen moves a patient to With doctor when the consult starts and
to Done when it is signed.

## Appointment panel (click any appointment)
Patient summary (age, sex, mobile, hospital number, allergies, last visit,
no-shows, money owed) with **Open patient record**; visit details; status
timeline with times; one-tap next step; reschedule (pick a new time or drag),
change doctor, cancel with reason, no-show, bill, copy a reminder message.

## Moving
Drag an appointment to another time or doctor; the drop is checked for clashes,
blocked time and working hours before it saves.

## Day sheet
Each doctor's list for the day with token, time, patient, mobile, visit type
and status, printable, plus tomorrow's reminder messages ready to copy.

## Keyboard
T today, ← → previous/next, D / W / M views, N new appointment, / search, Esc close.

## Later (not in this release)
Waitlist for earlier slots, sending reminders by SMS/WhatsApp (needs a paid
provider), online booking from the hospital website, Google Calendar sync,
rooms and branches.
