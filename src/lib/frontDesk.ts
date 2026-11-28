import { supabase } from './supabaseClient';
import {
  apptStart, billStatusFor, billTotals, clashes, dayKey, nextBillNumber, nextToken,
} from './schedule';
import { blockAt, outsideHours } from './calendar';
import type {
  AppointmentRow, BillItem, BillRow, BlockKind, CalendarBlockRow, PatientRow, PaymentMethod, PractitionerRow, VisitType, WaitlistRow,
} from '../types/db';

/**
 * Front-desk writes. Each returns an error message (string) or null, so the
 * screens can show it; nothing here throws. Rules live in schedule.ts.
 */

export function newId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

const err = (e: { message: string } | null | undefined) => (e ? e.message : null);

/** Hospital numbers: DGY-1001, DGY-1002, ... */
export function nextMrn(patients: PatientRow[]): string {
  const nums = patients.map((p) => Number(/^DGY-(\d+)$/.exec(p.mrn ?? '')?.[1] ?? 0));
  return `DGY-${Math.max(1000, ...nums) + 1}`;
}

/** Matches by name, phone (digits only) or hospital number. */
export function searchPatients(patients: PatientRow[], q: string): PatientRow[] {
  const s = q.trim().toLowerCase();
  if (!s) return [];
  const digits = s.replace(/\D/g, '');
  return patients
    .filter((p) => p.name.toLowerCase().includes(s)
      || (p.mrn ?? '').toLowerCase().includes(s)
      || (digits.length >= 3 && (p.phone ?? '').replace(/\D/g, '').includes(digits)))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 8);
}

export interface NewPatient { name: string; phone: string; age: string; gender: string }

export async function registerPatient(orgId: string, patients: PatientRow[], f: NewPatient): Promise<{ patient: PatientRow | null; error: string | null }> {
  const row: PatientRow = {
    id: newId('p'), org_id: orgId, auth_user_id: null, mrn: nextMrn(patients), name: f.name.trim(),
    age: f.age.trim() ? Number(f.age) : null, gender: f.gender || null, phone: f.phone.trim() || null,
    conditions: [], allergies: [], medications: [], queue_status: 'new', urgency_level: 'routine', draft_summary: null,
    assigned_practitioner_id: null, preferred_language: 'en', phone_verified: false, journey_stage: null,
    journey_stage_history: [], discharged_at: null, discharge_summary: null, intake_state: {}, triage: {},
  } as PatientRow;
  const { error } = await supabase.from('patients').insert(row);
  return error ? { patient: null, error: error.message } : { patient: row, error: null };
}

export interface Booking {
  patientId: string; practitioner: PractitionerRow; start: Date; minutes: number;
  visitType: VisitType; reason: string; bookedBy: string | null;
  /** Book over another appointment on purpose. */
  overbook?: boolean; seriesId?: string | null;
}

/** Why a time cannot be booked, or null. Clashes are allowed only when overbooking. */
export function bookingProblem(
  appts: AppointmentRow[], blocks: CalendarBlockRow[], p: PractitionerRow, start: Date, minutes: number,
  opts: { overbook?: boolean; ignoreId?: string } = {},
): string | null {
  const block = blockAt(blocks, p.id, start, minutes);
  if (block) return `${p.name} is not available then (${block.reason || block.kind}).`;
  if (!opts.overbook && clashes(appts, p.id, start, minutes, opts.ignoreId).length) return 'That time is already booked. Tick "Overbook" to add the patient anyway.';
  if (!opts.overbook && outsideHours(p, start, minutes)) return `That is outside ${p.name}'s working hours. Tick "Overbook" to book it anyway.`;
  return null;
}

function apptRow(orgId: string, b: Booking, overbooked: boolean) {
  const iso = b.start.toISOString();
  return {
    id: newId('ap'), org_id: orgId, patient_id: b.patientId, practitioner_id: b.practitioner.id, specialty: b.practitioner.specialty,
    date: iso, start_time: iso, duration_minutes: b.minutes, status: 'scheduled', reason: b.reason.trim() || null,
    requested_by_patient: false, token_no: null, checked_in_at: null, cancel_reason: null, visit_type: b.visitType,
    rescheduled_from: null, booked_by: b.bookedBy, overbooked, series_id: b.seriesId ?? null, called_in_at: null, completed_at: null,
  };
}

export async function bookAppointment(orgId: string, appts: AppointmentRow[], b: Booking, blocks: CalendarBlockRow[] = []): Promise<string | null> {
  const problem = bookingProblem(appts, blocks, b.practitioner, b.start, b.minutes, { overbook: b.overbook });
  if (problem) return problem;
  const overbooked = clashes(appts, b.practitioner.id, b.start, b.minutes).length > 0;
  return err((await supabase.from('appointments').insert(apptRow(orgId, b, overbooked))).error);
}

/** A course of visits (e.g. physio every 2 days): books each free one, reports the rest. */
export async function bookSeries(
  orgId: string, appts: AppointmentRow[], blocks: CalendarBlockRow[], b: Booking, starts: Date[],
): Promise<{ booked: Date[]; skipped: { start: Date; why: string }[]; error: string | null }> {
  const seriesId = newId('series');
  const booked: Date[] = [];
  const skipped: { start: Date; why: string }[] = [];
  const rows = [];
  for (const start of starts) {
    const why = bookingProblem(appts, blocks, b.practitioner, start, b.minutes, { overbook: b.overbook });
    if (why) { skipped.push({ start, why }); continue; }
    rows.push(apptRow(orgId, { ...b, start, seriesId }, clashes(appts, b.practitioner.id, start, b.minutes).length > 0));
    booked.push(start);
  }
  if (!rows.length) return { booked, skipped, error: null };
  const { error } = await supabase.from('appointments').insert(rows);
  return error ? { booked: [], skipped, error: error.message } : { booked, skipped, error: null };
}

/** Check in: next token for the doctor's day, and the patient joins the doctor's queue. */
export async function checkIn(appt: AppointmentRow, appts: AppointmentRow[], patient: PatientRow | undefined, now: Date): Promise<{ token: number | null; error: string | null }> {
  const day = dayKey(apptStart(appt) ?? now);
  const token = appt.practitioner_id ? nextToken(appts, appt.practitioner_id, day) : null;
  const { error } = await supabase.from('appointments').update({ status: 'checked_in', token_no: token, checked_in_at: now.toISOString() }).eq('id', appt.id);
  if (error) return { token: null, error: error.message };
  // A ward patient stays on the ward; everyone else goes to the doctor's queue.
  if (patient && patient.queue_status !== 'admitted' && patient.queue_status !== 'pending_discharge_clearance') {
    await supabase.from('patients').update({ queue_status: 'waiting_doctor', assigned_practitioner_id: appt.practitioner_id ?? patient.assigned_practitioner_id }).eq('id', patient.id);
  }
  return { token, error: null };
}

export async function reschedule(
  appt: AppointmentRow, appts: AppointmentRow[], start: Date,
  opts: { practitioner?: PractitionerRow; blocks?: CalendarBlockRow[]; overbook?: boolean } = {},
): Promise<string | null> {
  const doctorId = opts.practitioner?.id ?? appt.practitioner_id;
  if (!doctorId) return 'This appointment has no doctor.';
  if (opts.practitioner) {
    const why = bookingProblem(appts, opts.blocks ?? [], opts.practitioner, start, appt.duration_minutes, { overbook: opts.overbook, ignoreId: appt.id });
    if (why) return why;
  } else if (clashes(appts, doctorId, start, appt.duration_minutes, appt.id).length) return 'That time was just taken. Pick another slot.';
  const iso = start.toISOString();
  const moved: Record<string, unknown> = {
    date: iso, start_time: iso, rescheduled_from: appt.rescheduled_from ?? appt.start_time ?? appt.date,
    overbooked: clashes(appts, doctorId, start, appt.duration_minutes, appt.id).length > 0,
  };
  if (appt.status === 'cancelled' || appt.status === 'no_show') moved.status = 'scheduled';
  if (opts.practitioner && opts.practitioner.id !== appt.practitioner_id) {
    moved.practitioner_id = opts.practitioner.id;
    moved.specialty = opts.practitioner.specialty;
    moved.token_no = null; // tokens run per doctor per day
  }
  return err((await supabase.from('appointments').update(moved).eq('id', appt.id)).error);
}

export async function setStatus(appt: AppointmentRow, status: 'scheduled' | 'cancelled' | 'no_show', cancelReason?: string): Promise<string | null> {
  return err((await supabase.from('appointments').update({ status, cancel_reason: status === 'cancelled' ? (cancelReason ?? null) : appt.cancel_reason ?? null }).eq('id', appt.id)).error);
}

/** The doctor calls the patient in: "With doctor", timed. Checks the patient in first if the desk had not. */
export async function callIn(appt: AppointmentRow, appts: AppointmentRow[], now: Date): Promise<string | null> {
  const patch: Record<string, unknown> = { status: 'in_consultation', called_in_at: now.toISOString() };
  if (!appt.checked_in_at) patch.checked_in_at = now.toISOString();
  if (appt.token_no == null && appt.practitioner_id) patch.token_no = nextToken(appts, appt.practitioner_id, dayKey(apptStart(appt) ?? now));
  return err((await supabase.from('appointments').update(patch).eq('id', appt.id)).error);
}

/** The visit is over: "Done", timed, and it waits at the desk to be billed. */
export async function checkOut(appt: AppointmentRow, now: Date): Promise<string | null> {
  return err((await supabase.from('appointments').update({
    status: 'completed', completed_at: now.toISOString(), called_in_at: appt.called_in_at ?? null,
  }).eq('id', appt.id)).error);
}

/** Back one step, for a mis-tap: Done -> With doctor -> Waiting -> Booked. */
export async function undoStep(appt: AppointmentRow): Promise<string | null> {
  const back: Record<string, Record<string, unknown>> = {
    completed: { status: 'in_consultation', completed_at: null },
    in_consultation: { status: 'checked_in', called_in_at: null },
    checked_in: { status: 'scheduled', checked_in_at: null, token_no: null },
    no_show: { status: 'scheduled' },
  };
  const patch = back[appt.status];
  if (!patch) return 'Nothing to undo.';
  return err((await supabase.from('appointments').update(patch).eq('id', appt.id)).error);
}

/** The doctor opened today's patient: they are now with the doctor. */
export async function startConsult(appts: AppointmentRow[], patientId: string, practitionerId: string, day: string, now: Date): Promise<void> {
  const a = appts.find((x) => x.patient_id === patientId && x.practitioner_id === practitionerId && x.status === 'checked_in' && dayKey(apptStart(x) ?? now) === day);
  if (a) await callIn(a, appts, now);
}

/** Called by the doctor and the physio when a visit is done, so reception can bill it. */
export async function markSeen(appts: AppointmentRow[], patientId: string, practitionerId: string, now: Date = new Date()): Promise<void> {
  const open = appts.filter((a) => a.patient_id === patientId && a.practitioner_id === practitionerId && (a.status === 'checked_in' || a.status === 'in_consultation'));
  for (const a of open) await checkOut(a, now);
}

export interface BlockDraft { practitionerId: string | null; start: Date; end: Date; kind: BlockKind; reason: string; createdBy: string | null }

export async function createBlock(orgId: string, d: BlockDraft): Promise<string | null> {
  if (d.end.getTime() <= d.start.getTime()) return 'The block must end after it starts.';
  return err((await supabase.from('calendar_blocks').insert({
    id: newId('blk'), org_id: orgId, practitioner_id: d.practitionerId, starts_at: d.start.toISOString(), ends_at: d.end.toISOString(),
    kind: d.kind, reason: d.reason.trim() || null, created_by: d.createdBy,
  })).error);
}

export async function removeBlock(id: string): Promise<string | null> {
  return err((await supabase.from('calendar_blocks').delete().eq('id', id)).error);
}

export type WaitlistDraft = Pick<WaitlistRow, 'patient_id' | 'practitioner_id' | 'from_day' | 'to_day' | 'part_of_day' | 'visit_type' | 'note' | 'created_by'>;

export async function addToWaitlist(orgId: string, d: WaitlistDraft): Promise<string | null> {
  if (d.to_day < d.from_day) return 'The last day must be on or after the first day.';
  return err((await supabase.from('appointment_waitlist').insert({ id: newId('wl'), org_id: orgId, status: 'waiting', appointment_id: null, ...d, note: d.note?.trim() || null })).error);
}

export async function closeWaitlist(id: string, status: 'booked' | 'removed', appointmentId: string | null = null): Promise<string | null> {
  return err((await supabase.from('appointment_waitlist').update({ status, appointment_id: appointmentId }).eq('id', id)).error);
}

export interface BillDraft {
  patientId: string; appointmentId: string | null; items: BillItem[]; discount: number;
  paid: number; method: PaymentMethod | null; createdBy: string | null;
  source?: 'front_desk' | 'pharmacy' | 'ward'; pharmacyOrderId?: string | null;
}

export async function createBill(orgId: string, bills: BillRow[], d: BillDraft, now: Date): Promise<{ bill: BillRow | null; error: string | null }> {
  const items = d.items.filter((it) => it.description.trim() && it.qty > 0).map((it) => ({ ...it, description: it.description.trim() }));
  if (!items.length) return { bill: null, error: 'Add at least one item.' };
  const t = billTotals(items, d.discount);
  const paid = Math.min(Math.max(0, d.paid), t.total);
  const base = {
    org_id: orgId, patient_id: d.patientId, appointment_id: d.appointmentId, encounter_id: null, items,
    subtotal: t.subtotal, discount: t.discount, total: t.total, paid, payment_method: paid > 0 ? d.method : null,
    status: billStatusFor(t.total, paid), void_reason: null, created_by: d.createdBy, created_at: now.toISOString(),
    paid_at: paid > 0 ? now.toISOString() : null,
    source: d.source ?? 'front_desk', pharmacy_order_id: d.pharmacyOrderId ?? null,
  };
  // Two desks billing at once can pick the same next number; the unique
  // constraint refuses the second, so try the following number.
  let taken = bills;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const bill = { ...base, id: newId('bill'), number: nextBillNumber(taken) } as BillRow;
    const { error } = await supabase.from('bills').insert(bill);
    if (!error) return { bill, error: null };
    if (!/duplicate|unique/i.test(error.message)) return { bill: null, error: error.message };
    taken = [...taken, { number: bill.number } as BillRow];
  }
  return { bill: null, error: 'Could not number the bill. Try again.' };
}

export async function recordPayment(bill: BillRow, amount: number, method: PaymentMethod, now: Date): Promise<string | null> {
  const paid = Math.min(bill.total, Math.round((bill.paid + Math.max(0, amount)) * 100) / 100);
  return err((await supabase.from('bills').update({
    paid, payment_method: method, status: billStatusFor(bill.total, paid), paid_at: now.toISOString(),
  }).eq('id', bill.id)).error);
}

export async function voidBill(bill: BillRow, reason: string): Promise<string | null> {
  return err((await supabase.from('bills').update({ status: 'void', void_reason: reason.trim() }).eq('id', bill.id)).error);
}
