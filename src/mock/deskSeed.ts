import type {
  AdmissionRow, EnquiryRow, FollowUpRow, InsuranceClaimRow, PatientContactRow, PatientPackageRow, TreatmentPackageRow,
} from '../types/desk';
import { ORG_ID } from './seed';

/**
 * Demo front desk (migration 0020), written for Saturday 2026-08-29 like
 * the rest of the seed: follow-ups due, enquiries to call back, the stays of
 * the patients already on the ward (with deposits and an insurance claim),
 * and physiotherapy packages (Kavita's 8-session package is bill R-01002).
 */

const fu = (id: string, patientId: string, doctor: string, due: string, reason: string): FollowUpRow => ({
  id, org_id: ORG_ID, patient_id: patientId, practitioner_id: doctor, due_on: due, reason, status: 'open', appointment_id: null,
  created_by: doctor === 'pr-physio' ? 'Dr. Jayani Bhatt' : 'Dr. Sagar Karvir', created_at: '2026-08-15T06:00:00Z',
});

export const followUps: FollowUpRow[] = [
  fu('fu-priya', 'p-priya', 'pr-surgeon', '2026-08-26', 'Shoulder review after 2 weeks of physio'),
  fu('fu-arjun', 'p-arjun', 'pr-namrata', '2026-08-29', 'ECG and BP review'),
  fu('fu-neha', 'p-neha', 'pr-surgeon', '2026-09-02', 'Wrist X-ray review'),
  fu('fu-farah', 'p-farah', 'pr-namrata', '2026-09-20', 'HbA1c after 3 months'),
];

export const enquiries: EnquiryRow[] = [
  { id: 'enq-1', org_id: ORG_ID, name: 'Mahesh Kale', phone: '98221 77654', source: 'phone', interest: 'Knee replacement cost and Dr. Karvir\'s days', practitioner_id: 'pr-surgeon', status: 'open', next_follow_up_on: '2026-08-29', note: 'Mother, 68, both knees', patient_id: null, created_by: 'Sunita Kulkarni', created_at: '2026-08-27T07:30:00Z' },
  { id: 'enq-2', org_id: ORG_ID, name: 'Sneha Joglekar', phone: '99700 31245', source: 'website', interest: 'Physio for frozen shoulder, evening times', practitioner_id: 'pr-physio', status: 'open', next_follow_up_on: '2026-08-31', note: null, patient_id: null, created_by: 'Sunita Kulkarni', created_at: '2026-08-28T12:10:00Z' },
  { id: 'enq-3', org_id: ORG_ID, name: 'Rahul Deo', phone: '90110 45678', source: 'walk_in', interest: 'Sports injury clinic', practitioner_id: null, status: 'closed', next_follow_up_on: null, note: 'Went elsewhere', patient_id: null, created_by: 'Sunita Kulkarni', created_at: '2026-08-20T05:00:00Z' },
];

export const contacts: PatientContactRow[] = [
  { id: 'ct-1', org_id: ORG_ID, patient_id: 'p-priya', enquiry_id: null, follow_up_id: 'fu-priya', channel: 'call', purpose: 'recall', outcome: 'no_answer', note: null, contacted_by: 'Sunita Kulkarni', contacted_at: '2026-08-27T05:00:00Z' },
  { id: 'ct-2', org_id: ORG_ID, patient_id: null, enquiry_id: 'enq-1', follow_up_id: null, channel: 'call', purpose: 'enquiry', outcome: 'call_later', note: 'Will discuss with family', contacted_by: 'Sunita Kulkarni', contacted_at: '2026-08-28T06:00:00Z' },
];

export const admissions: AdmissionRow[] = [
  { id: 'adm-ramesh', org_id: ORG_ID, patient_id: 'p-ramesh', bed_id: 'bed-g2', practitioner_id: 'pr-surgeon', reason: 'Right hip replacement', admitted_at: '2026-08-25T06:00:00Z', expected_days: 6, deposit: 20000, deposit_bill_id: null, payer: 'insurance', status: 'admitted', discharged_at: null, created_by: 'Sunita Kulkarni', created_at: '2026-08-25T06:00:00Z' },
  { id: 'adm-suresh', org_id: ORG_ID, patient_id: 'p-suresh', bed_id: 'bed-g5', practitioner_id: 'pr-surgeon', reason: 'Observation after a fall', admitted_at: '2026-08-27T09:00:00Z', expected_days: 3, deposit: 0, deposit_bill_id: null, payer: 'self', status: 'admitted', discharged_at: null, created_by: 'Sunita Kulkarni', created_at: '2026-08-27T09:00:00Z' },
];

export const claims: InsuranceClaimRow[] = [
  { id: 'clm-ramesh', org_id: ORG_ID, patient_id: 'p-ramesh', admission_id: 'adm-ramesh', bill_id: null, insurer: 'Star Health', tpa: 'Medi Assist', policy_no: 'SH-2231-88710', claim_no: 'MA-55120934', kind: 'preauth', amount_requested: 245000, amount_approved: 210000, amount_settled: null, status: 'approved', documents_pending: [], submitted_on: '2026-08-24', decided_on: '2026-08-25', settled_on: null, note: 'Approved for hip replacement package', updated_by: 'Sunita Kulkarni', updated_at: '2026-08-25T10:00:00Z', created_at: '2026-08-24T08:00:00Z' },
  { id: 'clm-lata', org_id: ORG_ID, patient_id: 'p-lata', admission_id: null, bill_id: null, insurer: 'HDFC ERGO', tpa: null, policy_no: 'HE-77812', claim_no: null, kind: 'preauth', amount_requested: 80000, amount_approved: null, amount_settled: null, status: 'query', documents_pending: ['Investigation reports'], submitted_on: '2026-08-21', decided_on: null, settled_on: null, note: 'Insurer asked for the MRI report', updated_by: 'Sunita Kulkarni', updated_at: '2026-08-26T09:00:00Z', created_at: '2026-08-21T08:00:00Z' },
];

export const packageTypes: TreatmentPackageRow[] = [
  { id: 'pkg-physio8', org_id: ORG_ID, name: 'Physiotherapy, 8 sessions', sessions: 8, price: 4800, valid_days: 60, active: true, created_at: '2026-08-01T00:00:00Z' },
  { id: 'pkg-physio12', org_id: ORG_ID, name: 'Physiotherapy, 12 sessions', sessions: 12, price: 6600, valid_days: 90, active: true, created_at: '2026-08-01T00:00:00Z' },
  { id: 'pkg-dressing5', org_id: ORG_ID, name: 'Wound dressing, 5 visits', sessions: 5, price: 1500, valid_days: 30, active: true, created_at: '2026-08-01T00:00:00Z' },
];

export const patientPackages: PatientPackageRow[] = [
  { id: 'pp-kavita', org_id: ORG_ID, patient_id: 'p-kavita', package_id: 'pkg-physio8', name: 'Physiotherapy, 8 sessions', sessions_total: 8, price: 4800, bill_id: 'bill-2', starts_on: '2026-08-28', expires_on: '2026-10-27', status: 'active', created_by: 'Sunita Kulkarni', created_at: '2026-08-28T11:40:00Z' },
];
