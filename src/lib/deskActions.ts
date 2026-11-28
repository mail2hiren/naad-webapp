import { supabase } from './supabaseClient';
import { createBill, newId } from './frontDesk';
import { admit } from './wardActions';
import { clinicToday } from './schedule';
import type { BedRow, BillRow, PatientRow, PaymentMethod, WardBillingLedgerRow } from '../types/db';
import type {
  AdmissionRow, ClaimStatus, ContactChannel, ContactOutcome, ContactPurpose, EnquiryRow, EnquirySource, FollowUpRow,
  InsuranceClaimRow, Payer, PatientPackageRow, TreatmentPackageRow,
} from '../types/desk';

/** Front-desk writes for the 0020 modules. Each returns an error message or null; nothing throws. */

const err = (e: { message: string } | null | undefined) => (e ? e.message : null);

// ------------------------------------------------------------ follow-ups and calls
export async function addFollowUp(orgId: string, f: { patientId: string; practitionerId: string | null; dueOn: string; reason: string; by: string | null }): Promise<string | null> {
  return err((await supabase.from('follow_ups').insert({
    id: newId('fu'), org_id: orgId, patient_id: f.patientId, practitioner_id: f.practitionerId, due_on: f.dueOn,
    reason: f.reason.trim() || null, status: 'open', appointment_id: null, created_by: f.by, created_at: new Date().toISOString(),
  })).error);
}

export async function setFollowUp(f: FollowUpRow, status: FollowUpRow['status'], appointmentId: string | null = null, dueOn?: string): Promise<string | null> {
  return err((await supabase.from('follow_ups').update({ status, appointment_id: appointmentId ?? f.appointment_id, ...(dueOn ? { due_on: dueOn } : {}) }).eq('id', f.id)).error);
}

export async function logContact(orgId: string, c: {
  patientId?: string | null; enquiryId?: string | null; followUpId?: string | null; channel: ContactChannel; purpose: ContactPurpose;
  outcome: ContactOutcome; note: string; by: string | null; at: Date;
}): Promise<string | null> {
  return err((await supabase.from('patient_contacts').insert({
    id: newId('ct'), org_id: orgId, patient_id: c.patientId ?? null, enquiry_id: c.enquiryId ?? null, follow_up_id: c.followUpId ?? null,
    channel: c.channel, purpose: c.purpose, outcome: c.outcome, note: c.note.trim() || null, contacted_by: c.by, contacted_at: c.at.toISOString(),
  })).error);
}

// ------------------------------------------------------------ refunds and cash closing
export async function refundBill(bill: BillRow, amount: number, method: PaymentMethod, reason: string, now: Date): Promise<string | null> {
  const already = (bill as BillRow & { refunded?: number }).refunded ?? 0;
  const max = Math.round((bill.paid - already) * 100) / 100;
  if (amount <= 0 || amount > max) return `You can refund up to ${max}.`;
  if (!reason.trim()) return 'Give the reason for the refund.';
  return err((await supabase.from('bills').update({
    refunded: Math.round((already + amount) * 100) / 100, refund_reason: reason.trim(), refunded_at: now.toISOString(), refund_method: method,
  }).eq('id', bill.id)).error);
}

export async function closeCash(orgId: string, c: {
  day: string; by: string; expectedCash: number; countedCash: number; upi: number; card: number; insurance: number; refundsCash: number; note: string;
}): Promise<string | null> {
  const { error } = await supabase.from('cash_closings').insert({
    id: newId('cc'), org_id: orgId, day: c.day, closed_by: c.by, expected_cash: c.expectedCash, counted_cash: c.countedCash,
    expected_upi: c.upi, expected_card: c.card, expected_insurance: c.insurance, refunds_cash: c.refundsCash,
    difference: Math.round((c.countedCash - c.expectedCash) * 100) / 100, note: c.note.trim() || null, closed_at: new Date().toISOString(),
  });
  if (error && /duplicate|unique/i.test(error.message)) return 'You have already closed this day.';
  return err(error);
}

// ------------------------------------------------------------ admissions
export interface AdmitDraft {
  patient: PatientRow; bed: BedRow; doctorId: string; reason: string; expectedDays: number | null; payer: Payer;
  deposit: number; method: PaymentMethod; by: string | null;
}

/** Admit: bed, patient on the ward, first bed-day charge, a deposit receipt, and the stay recorded. */
export async function admitPatient(orgId: string, ledger: WardBillingLedgerRow[], bills: BillRow[], d: AdmitDraft, now: Date): Promise<{ admission: AdmissionRow | null; depositBill: BillRow | null; error: string | null }> {
  const e = await admit(orgId, ledger, d.patient, d.bed, d.doctorId, d.reason, d.by, now);
  if (e) return { admission: null, depositBill: null, error: e };
  let depositBill: BillRow | null = null;
  if (d.deposit > 0) {
    const r = await createBill(orgId, bills, {
      patientId: d.patient.id, appointmentId: null, items: [{ description: `Admission deposit, ${d.bed.ward} bed ${d.bed.label}`, qty: 1, rate: d.deposit }],
      discount: 0, paid: d.deposit, method: d.method, createdBy: d.by, source: 'ward',
    }, now);
    if (r.error) return { admission: null, depositBill: null, error: `Admitted, but the deposit receipt failed: ${r.error}` };
    depositBill = r.bill;
  }
  const admission: AdmissionRow = {
    id: newId('adm'), org_id: orgId, patient_id: d.patient.id, bed_id: d.bed.id, practitioner_id: d.doctorId, reason: d.reason.trim() || null,
    admitted_at: now.toISOString(), expected_days: d.expectedDays, deposit: d.deposit, deposit_bill_id: depositBill?.id ?? null, payer: d.payer,
    status: 'admitted', discharged_at: null, created_by: d.by, created_at: now.toISOString(),
  };
  const { error } = await supabase.from('admissions').insert(admission);
  return { admission: error ? null : admission, depositBill, error: err(error) };
}

export async function closeAdmission(a: AdmissionRow, status: 'discharged' | 'cancelled', now: Date): Promise<string | null> {
  return err((await supabase.from('admissions').update({ status, discharged_at: now.toISOString() }).eq('id', a.id)).error);
}

// ------------------------------------------------------------ insurance
export async function saveInsurance(p: PatientRow, f: { insurer: string; policyNo: string; tpa: string; validTill: string }): Promise<string | null> {
  return err((await supabase.from('patients').update({
    insurer: f.insurer.trim() || null, insurance_policy_no: f.policyNo.trim() || null, insurance_tpa: f.tpa.trim() || null, insurance_valid_till: f.validTill || null,
  }).eq('id', p.id)).error);
}

export async function createClaim(orgId: string, c: Omit<InsuranceClaimRow, 'id' | 'org_id' | 'created_at' | 'updated_at'>): Promise<string | null> {
  const now = new Date().toISOString();
  return err((await supabase.from('insurance_claims').insert({ id: newId('clm'), org_id: orgId, ...c, created_at: now, updated_at: now })).error);
}

export async function updateClaim(c: InsuranceClaimRow, patch: Partial<InsuranceClaimRow> & { status?: ClaimStatus }, by: string | null): Promise<string | null> {
  const today = clinicToday();
  const dates: Partial<InsuranceClaimRow> = {};
  if (patch.status === 'submitted' && !c.submitted_on) dates.submitted_on = today;
  if ((patch.status === 'approved' || patch.status === 'partly_approved' || patch.status === 'rejected') && !c.decided_on) dates.decided_on = today;
  if (patch.status === 'settled' && !c.settled_on) dates.settled_on = today;
  return err((await supabase.from('insurance_claims').update({ ...patch, ...dates, updated_by: by, updated_at: new Date().toISOString() }).eq('id', c.id)).error);
}

// ------------------------------------------------------------ enquiries
export async function addEnquiry(orgId: string, e: { name: string; phone: string; source: EnquirySource; interest: string; practitionerId: string | null; nextOn: string | null; note: string; by: string | null }): Promise<string | null> {
  if (!e.name.trim()) return 'Enter the caller\'s name.';
  return err((await supabase.from('enquiries').insert({
    id: newId('enq'), org_id: orgId, name: e.name.trim(), phone: e.phone.trim() || null, source: e.source, interest: e.interest.trim() || null,
    practitioner_id: e.practitionerId, status: 'open', next_follow_up_on: e.nextOn, note: e.note.trim() || null, patient_id: null, created_by: e.by, created_at: new Date().toISOString(),
  })).error);
}

export async function updateEnquiry(e: EnquiryRow, patch: Partial<Pick<EnquiryRow, 'status' | 'next_follow_up_on' | 'patient_id' | 'note'>>): Promise<string | null> {
  return err((await supabase.from('enquiries').update(patch).eq('id', e.id)).error);
}

// ------------------------------------------------------------ packages
/** Sell a package: a bill for its price (paid now or later) and the package on the patient. */
export async function sellPackage(orgId: string, bills: BillRow[], p: PatientRow, pkg: TreatmentPackageRow, paid: number, method: PaymentMethod, by: string | null, now: Date): Promise<{ error: string | null; bill: BillRow | null }> {
  const r = await createBill(orgId, bills, {
    patientId: p.id, appointmentId: null, items: [{ description: `${pkg.name} (${pkg.sessions} sessions)`, qty: 1, rate: pkg.price }],
    discount: 0, paid, method, createdBy: by, source: 'front_desk',
  }, now);
  if (r.error || !r.bill) return { error: r.error ?? 'Could not bill the package.', bill: null };
  const starts = clinicToday();
  const expires = pkg.valid_days ? new Date(now.getTime() + pkg.valid_days * 86_400_000).toISOString().slice(0, 10) : null;
  const row: PatientPackageRow = {
    id: newId('pp'), org_id: orgId, patient_id: p.id, package_id: pkg.id, name: pkg.name, sessions_total: pkg.sessions, price: pkg.price,
    bill_id: r.bill.id, starts_on: starts, expires_on: expires, status: 'active', created_by: by, created_at: now.toISOString(),
  };
  const { error } = await supabase.from('patient_packages').insert(row);
  return { error: err(error), bill: r.bill };
}

export async function setPackageStatus(p: PatientPackageRow, status: PatientPackageRow['status']): Promise<string | null> {
  return err((await supabase.from('patient_packages').update({ status }).eq('id', p.id)).error);
}

/** Put a booked visit on a package (or take it off). */
export async function putVisitOnPackage(appointmentId: string, packageId: string | null): Promise<string | null> {
  return err((await supabase.from('appointments').update({ patient_package_id: packageId }).eq('id', appointmentId)).error);
}

export async function savePackageType(orgId: string, t: { id?: string; name: string; sessions: number; price: number; validDays: number | null; active: boolean }): Promise<string | null> {
  if (!t.name.trim() || t.sessions <= 0 || t.price < 0) return 'Give a name, sessions and a price.';
  const row = { name: t.name.trim(), sessions: t.sessions, price: t.price, valid_days: t.validDays, active: t.active };
  if (t.id) return err((await supabase.from('treatment_packages').update(row).eq('id', t.id)).error);
  return err((await supabase.from('treatment_packages').insert({ id: newId('pkg'), org_id: orgId, ...row })).error);
}

