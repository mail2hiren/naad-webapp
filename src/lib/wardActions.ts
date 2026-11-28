import { supabase } from './supabaseClient';
import { newId } from './frontDesk';
import { bedDayDescription } from './ward';
import { dayKey } from './schedule';
import type { BedRow, JourneyHistoryEntry, PatientRow, VitalsRow, WardBillingLedgerRow } from '../types/db';

/** Ward writes. Each returns an error message or null; nothing throws. */

const err = (e: { message: string } | null | undefined) => (e ? e.message : null);

/** Charges today's bed-day once. Returns true if a charge was added. */
export async function chargeBedDay(orgId: string, ledger: WardBillingLedgerRow[], patient: PatientRow, bed: BedRow, by: string | null, now: Date): Promise<boolean> {
  const description = bedDayDescription(bed.ward, bed.label, dayKey(now));
  if (ledger.some((l) => l.patient_id === patient.id && l.description === description)) return false;
  const { error } = await supabase.from('ward_billing_ledger').insert({
    id: newId('wl'), org_id: orgId, patient_id: patient.id, encounter_id: null, description, amount: bed.daily_rate,
    created_by: by, created_at: now.toISOString(),
  });
  return !error;
}

export async function admit(
  orgId: string, ledger: WardBillingLedgerRow[], patient: PatientRow, bed: BedRow, doctorId: string, reason: string, by: string | null, now: Date,
): Promise<string | null> {
  if (bed.patient_id) return `${bed.label} was just taken. Pick another bed.`;
  const entry: JourneyHistoryEntry = { stage: 'admitted', enteredAt: now.toISOString(), by: by ?? 'Ward staff', note: `Admitted to ${bed.ward}, bed ${bed.label}. ${reason}`.trim() };
  const p = await supabase.from('patients').update({
    queue_status: 'admitted', assigned_practitioner_id: doctorId, journey_stage: 'admitted',
    journey_stage_history: [...(patient.journey_stage_history ?? []), entry], discharged_at: null, discharge_summary: null,
  }).eq('id', patient.id);
  if (p.error) return p.error.message;
  const b = await supabase.from('beds').update({ patient_id: patient.id, occupied_since: now.toISOString() }).eq('id', bed.id);
  if (b.error) return b.error.message;
  await chargeBedDay(orgId, ledger, patient, bed, by, now);
  return null;
}

export async function moveBed(from: BedRow, to: BedRow, now: Date): Promise<string | null> {
  if (to.patient_id) return `${to.label} was just taken. Pick another bed.`;
  const a = await supabase.from('beds').update({ patient_id: from.patient_id, occupied_since: now.toISOString() }).eq('id', to.id);
  if (a.error) return a.error.message;
  return err((await supabase.from('beds').update({ patient_id: null, occupied_since: null }).eq('id', from.id)).error);
}

export async function freeBed(bed: BedRow | undefined): Promise<string | null> {
  if (!bed) return null;
  return err((await supabase.from('beds').update({ patient_id: null, occupied_since: null }).eq('id', bed.id)).error);
}

export type VitalsDraft = Pick<VitalsRow, 'bp_systolic' | 'bp_diastolic' | 'pulse' | 'temp_c' | 'spo2' | 'resp_rate' | 'pain' | 'note'>;

export async function recordVitals(orgId: string, patientId: string, v: VitalsDraft, by: string | null, now: Date): Promise<string | null> {
  return err((await supabase.from('vitals').insert({
    id: newId('vt'), org_id: orgId, patient_id: patientId, taken_at: now.toISOString(), ...v, recorded_by: by,
  })).error);
}
