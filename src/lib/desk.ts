import type { AppointmentRow, BillRow, PaymentMethod } from '../types/db';
import type { AdmissionRow, ClaimStatus, FollowUpRow, PatientPackageRow } from '../types/desk';
import { addDays, apptStart, dayKey, parseDay } from './schedule.ts';

/**
 * Front-desk rules for follow-ups, recalls, cash closing, packages,
 * admissions and insurance. Pure functions (tests/lib/desk.test.ts).
 */

const DAY = 86_400_000;

export type DueGroup = 'overdue' | 'today' | 'week' | 'later';

/** Open follow-ups grouped by when they are due. */
export function groupFollowUps(list: FollowUpRow[], today: string): Record<DueGroup, FollowUpRow[]> {
  const week = addDays(today, 7);
  const out: Record<DueGroup, FollowUpRow[]> = { overdue: [], today: [], week: [], later: [] };
  list.filter((f) => f.status === 'open').sort((a, b) => a.due_on.localeCompare(b.due_on)).forEach((f) => {
    const g: DueGroup = f.due_on < today ? 'overdue' : f.due_on === today ? 'today' : f.due_on <= week ? 'week' : 'later';
    out[g].push(f);
  });
  return out;
}

/**
 * Patients who have drifted away: their last finished visit was more than
 * `afterDays` ago, nothing is booked and no follow-up is open. Most recent first.
 */
export function lapsedPatients(appts: AppointmentRow[], followUps: FollowUpRow[], now: Date, afterDays = 60, withinDays = 365): { patientId: string; last: AppointmentRow; days: number }[] {
  const byPatient = new Map<string, AppointmentRow[]>();
  appts.forEach((a) => byPatient.set(a.patient_id, [...(byPatient.get(a.patient_id) ?? []), a]));
  const open = new Set(followUps.filter((f) => f.status === 'open').map((f) => f.patient_id));
  const out: { patientId: string; last: AppointmentRow; days: number }[] = [];
  byPatient.forEach((list, pid) => {
    if (open.has(pid)) return;
    if (list.some((a) => (a.status === 'scheduled' || a.status === 'requested') && (apptStart(a)?.getTime() ?? 0) > now.getTime())) return;
    const done = list.filter((a) => a.status === 'completed' && apptStart(a)).sort((a, b) => apptStart(b)!.getTime() - apptStart(a)!.getTime());
    if (!done.length) return;
    const days = Math.floor((now.getTime() - apptStart(done[0])!.getTime()) / DAY);
    if (days >= afterDays && days <= withinDays) out.push({ patientId: pid, last: done[0], days });
  });
  return out.sort((a, b) => a.days - b.days);
}

export interface CashDay {
  byMethod: Record<PaymentMethod, number>;
  refunds: Record<PaymentMethod, number>;
  bills: number;
  total: number;
}

const zero = (): Record<PaymentMethod, number> => ({ cash: 0, upi: 0, card: 0, insurance: 0 });
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Money taken on a day, by payment method, from bills last paid that day
 * (optionally only those one person created), and refunds given that day.
 */
export function cashForDay(bills: BillRow[], day: string, by?: string | null): CashDay {
  const out: CashDay = { byMethod: zero(), refunds: zero(), bills: 0, total: 0 };
  bills.forEach((b) => {
    if (by && b.created_by !== by) return;
    if (b.status !== 'void' && b.paid > 0 && b.paid_at && dayKey(new Date(b.paid_at)) === day) {
      const m = (b.payment_method ?? 'cash') as PaymentMethod;
      out.byMethod[m] = round2(out.byMethod[m] + b.paid);
      out.bills += 1;
    }
    const r = b as BillRow & { refunded?: number; refunded_at?: string | null; refund_method?: PaymentMethod | null };
    if (r.refunded && r.refunded > 0 && r.refunded_at && dayKey(new Date(r.refunded_at)) === day) {
      const m = r.refund_method ?? 'cash';
      out.refunds[m] = round2(out.refunds[m] + r.refunded);
    }
  });
  out.total = round2(Object.values(out.byMethod).reduce((s, v) => s + v, 0) - Object.values(out.refunds).reduce((s, v) => s + v, 0));
  return out;
}

/** Cash that should be in the drawer: cash taken minus cash refunded (plus any opening float). */
export function expectedCash(day: CashDay, float = 0): number {
  return round2(float + day.byMethod.cash - day.refunds.cash);
}

/** Sessions used, left and whether the package can still be used. */
export function packageState(p: PatientPackageRow, appts: AppointmentRow[], today: string): { used: number; booked: number; left: number; usable: boolean; why: string | null } {
  const mine = appts.filter((a) => (a as AppointmentRow & { patient_package_id?: string | null }).patient_package_id === p.id);
  const used = mine.filter((a) => a.status === 'completed' || a.status === 'in_consultation').length;
  const booked = mine.filter((a) => a.status === 'scheduled' || a.status === 'checked_in' || a.status === 'requested').length;
  const left = Math.max(0, p.sessions_total - used);
  const why = p.status === 'cancelled' ? 'Cancelled' : p.expires_on && p.expires_on < today ? 'Expired' : left === 0 ? 'All sessions used' : null;
  return { used, booked, left, usable: why === null, why };
}

/** Days in hospital so far (a started day counts as one, like a bed-day charge). */
export function daysAdmitted(a: Pick<AdmissionRow, 'admitted_at' | 'discharged_at'>, now: Date): number {
  const end = a.discharged_at ? new Date(a.discharged_at) : now;
  const from = parseDay(dayKey(new Date(a.admitted_at)));
  const to = parseDay(dayKey(end));
  return Math.max(1, Math.round((to.getTime() - from.getTime()) / DAY) + (a.discharged_at ? 0 : 1));
}

export const CLAIM_LABEL: Record<ClaimStatus, string> = {
  draft: 'Draft', submitted: 'Submitted', query: 'Insurer has a query', approved: 'Approved', partly_approved: 'Partly approved', rejected: 'Rejected', settled: 'Settled',
};

/** What the desk should do next on a claim. */
export function claimNextStep(c: { status: ClaimStatus; documents_pending: string[]; kind: string }): string {
  if (c.status === 'draft') return c.documents_pending.length ? `Collect ${c.documents_pending.join(', ')}, then submit` : 'Submit to the insurer';
  if (c.status === 'submitted') return 'Waiting for the insurer; follow up after 2 days';
  if (c.status === 'query') return c.documents_pending.length ? `Send ${c.documents_pending.join(', ')}` : 'Answer the insurer\'s query';
  if (c.status === 'approved' || c.status === 'partly_approved') return c.kind === 'preauth' ? 'Raise the final claim at discharge' : 'Wait for payment';
  if (c.status === 'rejected') return 'Tell the patient; collect from them or appeal';
  return 'Done';
}

/** Days since the claim last moved, for chasing slow insurers. */
export function claimAgeDays(c: { updated_at: string }, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - Date.parse(c.updated_at)) / DAY));
}
