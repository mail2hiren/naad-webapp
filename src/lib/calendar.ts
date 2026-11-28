import type { AppointmentRow, CalendarBlockRow, PatientRow, PractitionerRow, VisitType, WaitlistRow } from '../types/db';
import { addDays, apptStart, at, clashes, dayKey, holdsSlot, hoursFor, parseDay, slotLength, slotsFor, timeLabel } from './schedule.ts';

/**
 * Calendar rules: layout of the time grid, week and month matrices, blocked
 * time, the patient-flow clock (waiting, with doctor), repeat courses,
 * no-show risk, running-late, waitlist matching and reminder text.
 * Pure functions, no React or database (tests/lib/calendar.test.ts).
 */

const MIN = 60_000;

/** Doctors get one of eight colours (theme tokens --doc-1 ... --doc-8) by their place in the list. */
export const DOCTOR_TONES = 8;
export function doctorTone(index: number): string {
  return `var(--doc-${(index % DOCTOR_TONES) + 1})`;
}

export const VISIT_MINUTES: Record<VisitType, number | null> = { consultation: 15, follow_up: 10, procedure: 30, therapy: null };

/** Default length of a visit with this practitioner: therapy = the physio's slot. */
export function visitMinutes(p: Pick<PractitionerRow, 'slot_minutes' | 'role'>, v: VisitType): number {
  return VISIT_MINUTES[v] ?? slotLength(p);
}

export function minutesOfDay(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

function endOf(a: AppointmentRow): number {
  return (apptStart(a)?.getTime() ?? 0) + (a.duration_minutes || 15) * MIN;
}

/** Blocks that touch [start, start+minutes) for this doctor (their own, or the whole hospital's). */
export function blocksOver(blocks: CalendarBlockRow[], practitionerId: string, start: Date, minutes: number): CalendarBlockRow[] {
  const s = start.getTime();
  const e = s + minutes * MIN;
  return blocks.filter((b) => (b.practitioner_id === null || b.practitioner_id === practitionerId)
    && Date.parse(b.starts_at) < e && s < Date.parse(b.ends_at));
}

export function blockAt(blocks: CalendarBlockRow[], practitionerId: string, start: Date, minutes: number): CalendarBlockRow | undefined {
  return blocksOver(blocks, practitionerId, start, minutes)[0];
}

/** Blocks of a doctor on a day, clipped to that day. */
export function blocksOn(blocks: CalendarBlockRow[], practitionerId: string, day: string): { block: CalendarBlockRow; from: Date; to: Date }[] {
  const d0 = parseDay(day).getTime();
  const d1 = parseDay(addDays(day, 1)).getTime();
  return blocks
    .filter((b) => (b.practitioner_id === null || b.practitioner_id === practitionerId) && Date.parse(b.starts_at) < d1 && d0 < Date.parse(b.ends_at))
    .map((b) => ({ block: b, from: new Date(Math.max(d0, Date.parse(b.starts_at))), to: new Date(Math.min(d1, Date.parse(b.ends_at))) }));
}

/** True when any part of [start, start+minutes) is outside the doctor's sessions that day. */
export function outsideHours(p: Pick<PractitionerRow, 'working_hours'>, start: Date, minutes: number): boolean {
  const s = minutesOfDay(start);
  const e = s + minutes;
  return !hoursFor(p, dayKey(start)).some(([f, t]) => toMin(f) <= s && e <= toMin(t));
}

/** Hours the day grid shows: the widest working hours of the doctors shown, and any booking outside them. */
export function gridRange(doctors: Pick<PractitionerRow, 'working_hours'>[], days: string[], appts: AppointmentRow[]): { from: number; to: number } {
  let from = 9 * 60;
  let to = 19 * 60;
  for (const p of doctors) for (const day of days) for (const [f, t] of hoursFor(p, day)) { from = Math.min(from, toMin(f)); to = Math.max(to, toMin(t)); }
  for (const a of appts) {
    const s = apptStart(a);
    if (!s || !days.includes(dayKey(s))) continue;
    from = Math.min(from, minutesOfDay(s));
    to = Math.max(to, minutesOfDay(s) + (a.duration_minutes || 15));
  }
  return { from: Math.floor(from / 60) * 60, to: Math.min(24 * 60, Math.ceil(to / 60) * 60) };
}

export interface Placed { appt: AppointmentRow; lane: number; lanes: number }

/** Side-by-side lanes for overlapping appointments (overbooking): each group of overlaps shares its width. */
export function layoutLanes(appts: AppointmentRow[]): Placed[] {
  const sorted = [...appts].filter((a) => apptStart(a)).sort((a, b) => (apptStart(a)!.getTime() - apptStart(b)!.getTime()) || (b.duration_minutes - a.duration_minutes));
  const out: Placed[] = [];
  let group: Placed[] = [];
  let groupEnd = -Infinity;
  const flush = () => { const n = Math.max(1, ...group.map((g) => g.lane + 1)); group.forEach((g) => { g.lanes = n; }); out.push(...group); group = []; };
  for (const a of sorted) {
    const s = apptStart(a)!.getTime();
    if (s >= groupEnd && group.length) { flush(); groupEnd = -Infinity; }
    const laneEnds: number[] = [];
    group.forEach((g) => { laneEnds[g.lane] = Math.max(laneEnds[g.lane] ?? -Infinity, endOf(g.appt)); });
    let lane = laneEnds.findIndex((e) => e <= s);
    if (lane === -1) lane = laneEnds.length;
    group.push({ appt: a, lane, lanes: 1 });
    groupEnd = Math.max(groupEnd, endOf(a));
  }
  if (group.length) flush();
  return out;
}

/** The seven days (Monday first) of the week holding `day`. */
export function weekDays(day: string): string[] {
  const dow = (parseDay(day).getDay() + 6) % 7;
  const monday = addDays(day, -dow);
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

/** Six weeks of days (Monday first) covering the month of `day`. */
export function monthMatrix(day: string): string[][] {
  const first = `${day.slice(0, 7)}-01`;
  const start = weekDays(first)[0];
  return Array.from({ length: 6 }, (_, w) => Array.from({ length: 7 }, (_, d) => addDays(start, w * 7 + d)));
}

export function sameMonth(a: string, b: string): boolean {
  return a.slice(0, 7) === b.slice(0, 7);
}

export function addMonths(day: string, n: number): string {
  const d = parseDay(day);
  const target = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(d.getDate(), last));
  return dayKey(target);
}

/** Minutes a patient has waited since arriving (to being called in, or to now). */
export function waitMinutes(a: AppointmentRow, now: Date): number | null {
  if (!a.checked_in_at) return null;
  const end = a.called_in_at ? Date.parse(a.called_in_at) : now.getTime();
  return Math.max(0, Math.round((end - Date.parse(a.checked_in_at)) / MIN));
}

/** Minutes with the doctor (to checkout, or to now). */
export function consultMinutes(a: AppointmentRow, now: Date): number | null {
  if (!a.called_in_at) return null;
  const end = a.completed_at ? Date.parse(a.completed_at) : now.getTime();
  return Math.max(0, Math.round((end - Date.parse(a.called_in_at)) / MIN));
}

export const LONG_WAIT_MIN = 20;

export function minutesLabel(m: number): string {
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60 ? `${m % 60} min` : ''}`.trim();
}

/** How late a doctor is running today, in minutes (0 when on time or under 5). With the doctor
 * given, only while a session is on (or within 30 minutes of its end): after hours it means nothing. */
export function runningLate(doctorDay: AppointmentRow[], now: Date, doctor?: Pick<PractitionerRow, 'working_hours'>): number {
  if (doctor) {
    const m = minutesOfDay(now);
    if (!hoursFor(doctor, dayKey(now)).some(([f, t]) => toMin(f) <= m && m <= toMin(t) + 30)) return 0;
  }
  const withDoc = doctorDay.find((a) => a.status === 'in_consultation');
  let late = 0;
  if (withDoc) {
    const s = apptStart(withDoc)!.getTime();
    late = Math.max(0, now.getTime() - (s + (withDoc.duration_minutes || 15) * MIN)) / MIN;
  } else {
    const waiting = doctorDay.filter((a) => a.status === 'checked_in').map((a) => apptStart(a)!.getTime()).filter((s) => s < now.getTime());
    if (waiting.length) late = (now.getTime() - Math.min(...waiting)) / MIN;
  }
  late = Math.round(late);
  return late >= 5 ? late : 0;
}

/** Average minutes per patient today for a doctor (from finished visits), else their slot length. */
export function averageConsult(doctor: Pick<PractitionerRow, 'slot_minutes' | 'role'>, doctorDay: AppointmentRow[]): number {
  const done = doctorDay.map((a) => (a.status === 'completed' && a.called_in_at && a.completed_at ? (Date.parse(a.completed_at) - Date.parse(a.called_in_at)) / MIN : null))
    .filter((m): m is number => m != null && m > 0);
  return done.length ? Math.round(done.reduce((s, m) => s + m, 0) / done.length) : slotLength(doctor);
}

/** The waiting queue of a doctor, in the order they will be seen (arrival time), with estimated waits. */
export function queueOf(doctor: PractitionerRow, doctorDay: AppointmentRow[], now: Date): { appt: AppointmentRow; position: number; estWait: number }[] {
  const avg = averageConsult(doctor, doctorDay);
  const withDoc = doctorDay.find((a) => a.status === 'in_consultation');
  const busyFor = withDoc ? Math.max(0, avg - (consultMinutes(withDoc, now) ?? 0)) : 0;
  return doctorDay.filter((a) => a.status === 'checked_in')
    .sort((a, b) => (a.checked_in_at ?? '').localeCompare(b.checked_in_at ?? ''))
    .map((appt, i) => ({ appt, position: i + 1, estWait: busyFor + i * avg }));
}

export interface RepeatRule { everyDays: number; count: number; skipSundays: boolean }

/** Start times of a course: the first visit, then every N days, Sundays moved to Monday when asked. */
export function expandRepeat(first: Date, rule: RepeatRule): Date[] {
  const out: Date[] = [];
  const hhmm = `${String(first.getHours()).padStart(2, '0')}:${String(first.getMinutes()).padStart(2, '0')}`;
  let day = dayKey(first);
  const n = Math.max(1, Math.min(52, Math.floor(rule.count)));
  const step = Math.max(1, Math.floor(rule.everyDays));
  while (out.length < n) {
    let d = day;
    if (rule.skipSundays && parseDay(d).getDay() === 0) d = addDays(d, 1);
    const t = at(d, hhmm);
    if (!out.some((x) => x.getTime() === t.getTime())) out.push(t);
    day = addDays(day, step);
  }
  return out;
}

export type Risk = 'none' | 'some' | 'high';

/** No-show risk from the patient's own history: 2 or more no-shows, or a third of visits, is high. */
export function noShowRisk(appts: AppointmentRow[], patientId: string, now: Date): { risk: Risk; noShows: number; visits: number } {
  const past = appts.filter((a) => a.patient_id === patientId && (apptStart(a)?.getTime() ?? Infinity) < now.getTime()
    && (a.status === 'no_show' || a.status === 'completed'));
  const noShows = past.filter((a) => a.status === 'no_show').length;
  const risk: Risk = noShows >= 2 || (past.length >= 3 && noShows / past.length >= 1 / 3) ? 'high' : noShows === 1 ? 'some' : 'none';
  return { risk, noShows, visits: past.length };
}

/** The patient's last finished visit before now. */
export function lastVisit(appts: AppointmentRow[], patientId: string, now: Date): AppointmentRow | undefined {
  return appts.filter((a) => a.patient_id === patientId && a.status === 'completed' && (apptStart(a)?.getTime() ?? Infinity) < now.getTime())
    .sort((a, b) => apptStart(b)!.getTime() - apptStart(a)!.getTime())[0];
}

export interface FreeOption { doctor: PractitionerRow; start: Date; minutes: number }

/** The next free times across doctors from `now`, soonest first, skipping blocked time. */
export function nextFree(
  doctors: PractitionerRow[], appts: AppointmentRow[], blocks: CalendarBlockRow[], now: Date, opts: { days?: number; limit?: number; perDoctor?: number } = {},
): FreeOption[] {
  const days = opts.days ?? 14;
  const limit = opts.limit ?? 6;
  const per = opts.perDoctor ?? 2;
  const out: FreeOption[] = [];
  for (const doctor of doctors) {
    let n = 0;
    for (let i = 0; i < days && n < per; i += 1) {
      for (const sl of slotsFor(doctor, addDays(dayKey(now), i))) {
        if (n >= per) break;
        if (sl.start.getTime() <= now.getTime()) continue;
        if (clashes(appts, doctor.id, sl.start, sl.minutes).length || blockAt(blocks, doctor.id, sl.start, sl.minutes)) continue;
        out.push({ doctor, start: sl.start, minutes: sl.minutes });
        n += 1;
      }
    }
  }
  return out.sort((a, b) => a.start.getTime() - b.start.getTime()).slice(0, limit);
}

/** Waitlist entries that a free time suits: same doctor (or any), within their days and part of day. */
export function waitlistFor(list: WaitlistRow[], practitionerId: string, start: Date): WaitlistRow[] {
  const day = dayKey(start);
  const h = start.getHours();
  return list.filter((w) => w.status === 'waiting' && (w.practitioner_id === null || w.practitioner_id === practitionerId)
    && w.from_day <= day && day <= w.to_day
    && (w.part_of_day === 'any' || (w.part_of_day === 'morning' ? h < 14 : h >= 14)))
    .sort((a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? ''));
}

/** Booked share of a doctor's working time on a day, 0 to 1 (overbooking can pass 1). */
export function utilisation(doctor: PractitionerRow, day: string, doctorDay: AppointmentRow[]): number {
  const work = hoursFor(doctor, day).reduce((m, [f, t]) => m + toMin(t) - toMin(f), 0);
  if (!work) return 0;
  const booked = doctorDay.filter((a) => holdsSlot(a.status)).reduce((m, a) => m + (a.duration_minutes || 15), 0);
  return booked / work;
}

/** Appointments matching a search by patient name, mobile, hospital number or token. */
export function searchAppointments(appts: AppointmentRow[], patients: PatientRow[], q: string): AppointmentRow[] {
  const s = q.trim().toLowerCase();
  if (s.length < 2) return [];
  const digits = s.replace(/\D/g, '');
  const ids = new Set(patients.filter((p) => p.name.toLowerCase().includes(s) || (p.mrn ?? '').toLowerCase().includes(s)
    || (digits.length >= 3 && (p.phone ?? '').replace(/\D/g, '').includes(digits))).map((p) => p.id));
  return appts.filter((a) => ids.has(a.patient_id)).sort((a, b) => (apptStart(b)?.getTime() ?? 0) - (apptStart(a)?.getTime() ?? 0)).slice(0, 12);
}

/** A ready-to-send reminder (SMS or WhatsApp) for an appointment. */
export function reminderText(patientName: string, doctorName: string, start: Date, hospital: string): string {
  const first = patientName.split(' ')[0];
  const when = start.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
  return `Namaste ${first}, this is a reminder of your appointment with ${doctorName} on ${when} at ${timeLabel(start)} at ${hospital}. `
    + 'Please arrive 10 minutes early with your previous reports. Reply 1 to confirm or call us to change the time.';
}
