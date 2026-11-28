import { supabase } from './supabaseClient';
import {
  apptStart, billStatusFor, billTotals, clashes, dayKey, nextBillNumber, nextToken,
} from './schedule';
import type {
  AppointmentRow, BillItem, BillRow, PatientRow, PaymentMethod, PractitionerRow, VisitType,
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
}

export async function bookAppointment(orgId: string, appts: AppointmentRow[], b: Booking): Promise<string | null> {
  if (clashes(appts, b.practitioner.id, b.start, b.minutes).length) return 'That time was just taken. Pick another slot.';
  const iso = b.start.toISOString();
  return err((await supabase.from('appointments').insert({
    id: newId('ap'), org_id: orgId, patient_id: b.patientId, practitioner_id: b.practitioner.id, specialty: b.practitioner.specialty,
    date: iso, start_time: iso, duration_minutes: b.minutes, status: 'scheduled', reason: b.reason.trim() || null,
    requested_by_patient: false, token_no: null, checked_in_at: null, cancel_reason: null, visit_type: b.visitType,
    rescheduled_from: null, booked_by: b.bookedBy,
  })).error);
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

export async function reschedule(appt: AppointmentRow, appts: AppointmentRow[], start: Date): Promise<string | null> {
  if (!appt.practitioner_id) return 'This appointment has no doctor.';
  if (clashes(appts, appt.practitioner_id, start, appt.duration_minutes, appt.id).length) return 'That time was just taken. Pick another slot.';
  const iso = start.toISOString();
  return err((await supabase.from('appointments').update({
    date: iso, start_time: iso, status: 'scheduled', rescheduled_from: appt.rescheduled_from ?? appt.start_time ?? appt.date,
  }).eq('id', appt.id)).error);
}

export async function setStatus(appt: AppointmentRow, status: 'scheduled' | 'cancelled' | 'no_show', cancelReason?: string): Promise<string | null> {
  return err((await supabase.from('appointments').update({ status, cancel_reason: status === 'cancelled' ? (cancelReason ?? null) : appt.cancel_reason ?? null }).eq('id', appt.id)).error);
}

/** Called by the doctor and the physio when a visit is done, so reception can bill it. */
export async function markSeen(appts: AppointmentRow[], patientId: string, practitionerId: string): Promise<void> {
  const open = appts.filter((a) => a.patient_id === patientId && a.practitioner_id === practitionerId && a.status === 'checked_in');
  for (const a of open) await supabase.from('appointments').update({ status: 'completed' }).eq('id', a.id);
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
