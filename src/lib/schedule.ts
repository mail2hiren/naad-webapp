import type {
  AppointmentRow, AppointmentStatus, BillItem, BillRow, BillStatus, PractitionerRow, VisitType, Weekday, WorkingHours,
} from '../types/db';

/**
 * Front-desk scheduling and billing rules, kept free of React and the
 * database so they can be unit tested (tests/lib/schedule.test.ts).
 * All times are the browser's local time: the hospital and its front desk
 * are in the same place.
 */

const SESSIONS: [string, string][] = [['09:30', '13:30'], ['16:00', '19:00']];
/** Hospital default when a doctor has no working hours of their own: Mon-Sat. */
export const DEFAULT_HOURS: WorkingHours = { mon: SESSIONS, tue: SESSIONS, wed: SESSIONS, thu: SESSIONS, fri: SESSIONS, sat: SESSIONS };
const WEEKDAYS: Weekday[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

export const VISIT_LABEL: Record<VisitType, string> = {
  consultation: 'New consultation', follow_up: 'Follow-up', therapy: 'Therapy session', procedure: 'Procedure',
};
export const STATUS_TONE: Record<AppointmentStatus, 'default' | 'gate' | 'ok' | 'danger' | 'accent'> = {
  requested: 'gate', scheduled: 'accent', checked_in: 'ok', in_consultation: 'accent', completed: 'default', cancelled: 'danger', no_show: 'danger',
};
export const STATUS_LABEL: Record<AppointmentStatus, string> = {
  requested: 'Requested', scheduled: 'Booked', checked_in: 'Waiting', in_consultation: 'With doctor', completed: 'Done', cancelled: 'Cancelled', no_show: 'No-show',
};

/** "2026-11-28" for a local date. */
export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Local midnight of a "YYYY-MM-DD" day. */
export function parseDay(day: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(day: string, n: number): string {
  const d = parseDay(day);
  d.setDate(d.getDate() + n);
  return dayKey(d);
}

/** Local Date for a time of day ("16:30") on a day. */
export function at(day: string, hhmm: string): Date {
  const d = parseDay(day);
  const [h, m] = hhmm.split(':').map(Number);
  d.setHours(h, m, 0, 0);
  return d;
}

export function hoursFor(p: Pick<PractitionerRow, 'working_hours'>, day: string): [string, string][] {
  const hours = p.working_hours ?? DEFAULT_HOURS;
  return hours[WEEKDAYS[parseDay(day).getDay()]] ?? [];
}

export function slotLength(p: Pick<PractitionerRow, 'slot_minutes' | 'role'>): number {
  return p.slot_minutes ?? (p.role === 'physio' ? 30 : 15);
}

export interface Slot { start: Date; minutes: number; session: number }

/** Every bookable slot of a practitioner on a day, in order. */
export function slotsFor(p: Pick<PractitionerRow, 'working_hours' | 'slot_minutes' | 'role'>, day: string): Slot[] {
  const len = slotLength(p);
  const out: Slot[] = [];
  hoursFor(p, day).forEach(([from, to], session) => {
    const end = at(day, to).getTime();
    for (let t = at(day, from).getTime(); t + len * 60_000 <= end; t += len * 60_000) {
      out.push({ start: new Date(t), minutes: len, session });
    }
  });
  return out;
}

export function apptStart(a: Pick<AppointmentRow, 'start_time' | 'date'>): Date | null {
  const v = a.start_time ?? a.date;
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function onDay(a: Pick<AppointmentRow, 'start_time' | 'date'>, day: string): boolean {
  const s = apptStart(a);
  return s != null && dayKey(s) === day;
}

/** Statuses that hold a slot. Cancelled and no-show free it again. */
export function holdsSlot(status: AppointmentStatus): boolean {
  return status === 'requested' || status === 'scheduled' || status === 'checked_in' || status === 'in_consultation' || status === 'completed';
}

/** Appointments of a practitioner that clash with [start, start+minutes). */
export function clashes(
  appts: AppointmentRow[], practitionerId: string, start: Date, minutes: number, ignoreId?: string,
): AppointmentRow[] {
  const s = start.getTime();
  const e = s + minutes * 60_000;
  return appts.filter((a) => {
    if (a.id === ignoreId || a.practitioner_id !== practitionerId || !holdsSlot(a.status)) return false;
    const as = apptStart(a)?.getTime();
    if (as == null) return false;
    const ae = as + (a.duration_minutes || 15) * 60_000;
    return as < e && s < ae;
  });
}

/** Free slots of a practitioner on a day (not clashing, and not already past). */
export function freeSlots(
  p: PractitionerRow, day: string, appts: AppointmentRow[], now: Date = new Date(), ignoreId?: string,
): Slot[] {
  return slotsFor(p, day).filter((sl) => sl.start.getTime() > now.getTime() && clashes(appts, p.id, sl.start, sl.minutes, ignoreId).length === 0);
}

/** The next token number for a practitioner's day: tokens start at 1 each day. */
export function nextToken(appts: AppointmentRow[], practitionerId: string | null, day: string): number {
  const used = appts
    .filter((a) => a.practitioner_id === practitionerId && a.token_no != null && onDay(a, day))
    .map((a) => a.token_no as number);
  return (used.length ? Math.max(...used) : 0) + 1;
}

/** Receipt numbers run per hospital: R-01001, R-01002, ... */
export function nextBillNumber(bills: Pick<BillRow, 'number'>[]): string {
  const nums = bills.map((b) => Number(/^R-(\d+)$/.exec(b.number)?.[1] ?? 0));
  const next = Math.max(1000, ...nums) + 1;
  return `R-${String(next).padStart(5, '0')}`;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function billTotals(items: BillItem[], discount: number): { subtotal: number; discount: number; total: number } {
  const subtotal = round2(items.reduce((s, it) => s + Math.max(0, it.qty) * Math.max(0, it.rate), 0));
  const d = round2(Math.min(Math.max(0, discount), subtotal));
  return { subtotal, discount: d, total: round2(subtotal - d) };
}

export function billStatusFor(total: number, paid: number): BillStatus {
  if (paid <= 0) return total === 0 ? 'paid' : 'unpaid';
  return paid >= total ? 'paid' : 'part_paid';
}

export function balance(b: Pick<BillRow, 'total' | 'paid' | 'status'>): number {
  return b.status === 'void' ? 0 : round2(Math.max(0, b.total - b.paid));
}

const INR = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2, minimumFractionDigits: 0 });
export function money(n: number): string {
  return INR.format(n);
}

export function timeLabel(d: Date): string {
  return d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
}

export function dayLabel(day: string): string {
  return parseDay(day).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function frozenDemo(): boolean {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  return env?.VITE_USE_MOCK === '1' && env?.VITE_FREEZE_DEMO_DATES === '1';
}

/** The clinic's "today". The frozen-date test builds keep the demo on its seed day. */
export function clinicToday(): string {
  return frozenDemo() ? '2026-08-29' : dayKey(new Date());
}

/** "Now" for the front desk. The frozen-date test builds stop the clock at
 * 11:05 on the seed day, so tests see the same past and free slots every run. */
export function clinicNow(): Date {
  return frozenDemo() ? at('2026-08-29', '11:05') : new Date();
}

export const WEEK: { key: Weekday; label: string }[] = [
  { key: 'mon', label: 'Monday' }, { key: 'tue', label: 'Tuesday' }, { key: 'wed', label: 'Wednesday' },
  { key: 'thu', label: 'Thursday' }, { key: 'fri', label: 'Friday' }, { key: 'sat', label: 'Saturday' }, { key: 'sun', label: 'Sunday' },
];

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Checks a week of working hours: valid times, each session ends after it
 * starts, sessions in order and not overlapping. Returns a message or null. */
export function validateHours(hours: WorkingHours): string | null {
  for (const { key, label } of WEEK) {
    const sessions = hours[key] ?? [];
    let lastEnd = '';
    for (const [from, to] of sessions) {
      if (!HHMM.test(from) || !HHMM.test(to)) return `${label}: enter times as HH:MM.`;
      if (from >= to) return `${label}: a session must end after it starts (${from} to ${to}).`;
      if (lastEnd && from < lastEnd) return `${label}: sessions overlap or are out of order.`;
      lastEnd = to;
    }
  }
  return null;
}

/** Bookable slots in a week of hours at a slot length. */
export function weeklySlots(hours: WorkingHours, minutes: number): number {
  const mins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  return WEEK.reduce((n, { key }) => n + (hours[key] ?? []).reduce((m, [f, t]) => m + Math.floor((mins(t) - mins(f)) / minutes), 0), 0);
}
