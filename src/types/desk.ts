/** Front-desk records added by migration 0020 (follow-ups, calls, cash, admissions, insurance, enquiries, packages). */

export type FollowUpStatus = 'open' | 'booked' | 'done' | 'declined';
export interface FollowUpRow {
  id: string;
  org_id: string;
  patient_id: string;
  practitioner_id: string | null;
  due_on: string;
  reason: string | null;
  status: FollowUpStatus;
  appointment_id: string | null;
  created_by: string | null;
  created_at: string;
}

export type ContactChannel = 'call' | 'sms' | 'whatsapp' | 'in_person' | 'email';
export type ContactPurpose = 'reminder' | 'recall' | 'enquiry' | 'payment' | 'report' | 'insurance' | 'other';
export type ContactOutcome = 'booked' | 'no_answer' | 'call_later' | 'declined' | 'wrong_number' | 'informed' | 'other';
export interface PatientContactRow {
  id: string;
  org_id: string;
  patient_id: string | null;
  enquiry_id: string | null;
  follow_up_id: string | null;
  channel: ContactChannel;
  purpose: ContactPurpose;
  outcome: ContactOutcome;
  note: string | null;
  contacted_by: string | null;
  contacted_at: string;
}

export interface CashClosingRow {
  id: string;
  org_id: string;
  day: string;
  closed_by: string;
  expected_cash: number;
  counted_cash: number;
  expected_upi: number;
  expected_card: number;
  expected_insurance: number;
  refunds_cash: number;
  difference: number;
  note: string | null;
  closed_at: string;
}

export type Payer = 'self' | 'insurance' | 'corporate' | 'government';
export interface AdmissionRow {
  id: string;
  org_id: string;
  patient_id: string;
  bed_id: string | null;
  practitioner_id: string | null;
  reason: string | null;
  admitted_at: string;
  expected_days: number | null;
  deposit: number;
  deposit_bill_id: string | null;
  payer: Payer;
  status: 'admitted' | 'discharged' | 'cancelled';
  discharged_at: string | null;
  created_by: string | null;
  created_at: string;
}

export type ClaimStatus = 'draft' | 'submitted' | 'query' | 'approved' | 'partly_approved' | 'rejected' | 'settled';
export interface InsuranceClaimRow {
  id: string;
  org_id: string;
  patient_id: string;
  admission_id: string | null;
  bill_id: string | null;
  insurer: string;
  tpa: string | null;
  policy_no: string | null;
  claim_no: string | null;
  kind: 'preauth' | 'final' | 'reimbursement';
  amount_requested: number;
  amount_approved: number | null;
  amount_settled: number | null;
  status: ClaimStatus;
  documents_pending: string[];
  submitted_on: string | null;
  decided_on: string | null;
  settled_on: string | null;
  note: string | null;
  updated_by: string | null;
  updated_at: string;
  created_at: string;
}

export type EnquirySource = 'phone' | 'walk_in' | 'website' | 'referral' | 'other';
export interface EnquiryRow {
  id: string;
  org_id: string;
  name: string;
  phone: string | null;
  source: EnquirySource;
  interest: string | null;
  practitioner_id: string | null;
  status: 'open' | 'booked' | 'closed';
  next_follow_up_on: string | null;
  note: string | null;
  patient_id: string | null;
  created_by: string | null;
  created_at: string;
}

export interface TreatmentPackageRow {
  id: string;
  org_id: string;
  name: string;
  sessions: number;
  price: number;
  valid_days: number | null;
  active: boolean;
  created_at: string;
}

export interface PatientPackageRow {
  id: string;
  org_id: string;
  patient_id: string;
  package_id: string | null;
  name: string;
  sessions_total: number;
  price: number;
  bill_id: string | null;
  starts_on: string;
  expires_on: string | null;
  status: 'active' | 'finished' | 'expired' | 'cancelled';
  created_by: string | null;
  created_at: string;
}
