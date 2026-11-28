import type { AppointmentRow, BillRow, PatientRow } from '../types/db';
import { ORG_ID } from './seed';

/**
 * Demo front-desk day (Phase 4), written as if today were Saturday
 * 2026-08-29 like the rest of the seed (mockSupabase shifts the dates).
 * Times are UTC; in India they read 09:30 onwards. By 11:00 the morning has
 * happened: two patients seen (one billed, one waiting to be billed), four
 * checked in with tokens, one no-show, and the rest of the day booked,
 * cancelled or requested by a patient from the app.
 */

const patient = (p: Pick<PatientRow, 'id' | 'mrn' | 'name' | 'age' | 'gender' | 'phone' | 'queue_status'> & { complaint: string }): PatientRow => ({
  org_id: ORG_ID, auth_user_id: null, conditions: [], allergies: [], medications: [], urgency_level: 'routine',
  draft_summary: null, assigned_practitioner_id: 'pr-surgeon', preferred_language: 'en', phone_verified: true,
  journey_stage: null, journey_stage_history: [], discharged_at: null, discharge_summary: null,
  intake_state: {}, triage: { complaints: p.complaint },
  id: p.id, mrn: p.mrn, name: p.name, age: p.age, gender: p.gender, phone: p.phone, queue_status: p.queue_status,
} as PatientRow);

export const patients: PatientRow[] = [
  patient({ id: 'p-anil', mrn: 'DGY-1012', name: 'Anil Gokhale', age: 47, gender: 'Male', phone: '98221 40551', queue_status: 'done', complaint: 'Low back pain after lifting, 1 week.' }),
  patient({ id: 'p-sunanda', mrn: 'DGY-1013', name: 'Sunanda Patil', age: 55, gender: 'Female', phone: '99600 21874', queue_status: 'done', complaint: 'Frozen shoulder review.' }),
  patient({ id: 'p-imran', mrn: 'DGY-1014', name: 'Imran Shaikh', age: 36, gender: 'Male', phone: '98500 66120', queue_status: 'new', complaint: 'Ankle sprain, playing football.' }),
];

const ap = (
  id: string, patientId: string, practitionerId: string, startUtc: string, status: AppointmentRow['status'],
  extra: Partial<AppointmentRow> = {},
): AppointmentRow => ({
  id, org_id: ORG_ID, patient_id: patientId, practitioner_id: practitionerId,
  specialty: practitionerId === 'pr-physio' ? 'Physiotherapy' : practitionerId === 'pr-namrata' ? 'Critical Care' : 'Orthopedics',
  date: startUtc, start_time: startUtc, duration_minutes: practitionerId === 'pr-physio' ? 30 : 15,
  status, reason: null, requested_by_patient: false, token_no: null, checked_in_at: null, cancel_reason: null,
  visit_type: practitionerId === 'pr-physio' ? 'therapy' : 'consultation', rescheduled_from: null, booked_by: 'Sunita Kulkarni',
  ...extra,
});

export const appointments: AppointmentRow[] = [
  // Dr. Sagar Karvir, Orthopedics
  ap('ap-s1', 'p-anil', 'pr-surgeon', '2026-08-29T04:00:00Z', 'completed', { token_no: 1, checked_in_at: '2026-08-29T03:52:00Z', reason: 'Low back pain after lifting' }),
  ap('ap-s2', 'p-sunanda', 'pr-surgeon', '2026-08-29T04:15:00Z', 'completed', { token_no: 2, checked_in_at: '2026-08-29T04:10:00Z', visit_type: 'follow_up', reason: 'Frozen shoulder review' }),
  ap('ap-s3', 'p-meera', 'pr-surgeon', '2026-08-29T04:30:00Z', 'checked_in', { token_no: 3, checked_in_at: '2026-08-29T04:22:00Z', reason: 'Pre-operative assessment' }),
  ap('ap-s4', 'p-neha', 'pr-surgeon', '2026-08-29T04:45:00Z', 'checked_in', { token_no: 4, checked_in_at: '2026-08-29T04:40:00Z', reason: 'Wrist pain' }),
  ap('ap-s5', 'p-imran', 'pr-surgeon', '2026-08-29T05:15:00Z', 'no_show', { reason: 'Ankle sprain' }),
  ap('ap-s6', 'p-deepak', 'pr-surgeon', '2026-08-29T06:00:00Z', 'scheduled', { visit_type: 'follow_up', reason: 'Knee replacement review, 10 weeks' }),
  ap('ap-s7', 'p-ramesh', 'pr-surgeon', '2026-08-29T11:00:00Z', 'cancelled', { visit_type: 'follow_up', reason: 'Hip review', cancel_reason: 'Admitted on the ward; reviewed there' }),
  ap('ap-s8', 'p-lata', 'pr-surgeon', '2026-08-29T11:30:00Z', 'requested', { visit_type: 'follow_up', reason: 'Requested from the patient app', requested_by_patient: true, booked_by: null }),
  // Dr. Namrata Rao, Critical Care
  ap('ap-n1', 'p-arjun', 'pr-namrata', '2026-08-29T04:30:00Z', 'checked_in', { token_no: 1, checked_in_at: '2026-08-29T04:25:00Z', reason: 'Palpitations' }),
  ap('ap-n2', 'p-farah', 'pr-namrata', '2026-08-29T04:45:00Z', 'checked_in', { token_no: 2, checked_in_at: '2026-08-29T04:41:00Z', reason: 'Breathlessness, diabetic' }),
  // Dr. Jayani Bhatt, Physiotherapy
  ap('ap-p1', 'p-rohan', 'pr-physio', '2026-08-29T04:00:00Z', 'checked_in', { token_no: 1, checked_in_at: '2026-08-29T03:58:00Z', reason: 'ACL rehab session' }),
  ap('ap-p2', 'p-kavita', 'pr-physio', '2026-08-29T04:30:00Z', 'checked_in', { token_no: 2, checked_in_at: '2026-08-29T04:26:00Z', reason: 'Low back pain session' }),
  // Monday
  ap('ap-m1', 'p-suresh', 'pr-surgeon', '2026-08-31T04:30:00Z', 'scheduled', { visit_type: 'follow_up', reason: 'Post-discharge review' }),
  ap('ap-m2', 'p-anil', 'pr-surgeon', '2026-08-31T05:00:00Z', 'scheduled', { visit_type: 'follow_up', reason: 'Back pain review' }),
];

const bill = (b: Omit<BillRow, 'org_id' | 'appointment_id' | 'encounter_id' | 'void_reason' | 'created_by'> & Partial<BillRow>): BillRow => ({
  org_id: ORG_ID, appointment_id: null, encounter_id: null, void_reason: null, created_by: 'Sunita Kulkarni', ...b,
});

export const bills: BillRow[] = [
  bill({
    id: 'bill-1', number: 'R-01001', patient_id: 'p-deepak', created_at: '2026-08-27T06:10:00Z', paid_at: '2026-08-27T06:11:00Z',
    items: [{ description: 'Consultation, Dr. Sagar Karvir', qty: 1, rate: 800 }, { description: 'X-ray, knee (2 views)', qty: 1, rate: 450 }],
    subtotal: 1250, discount: 0, total: 1250, paid: 1250, payment_method: 'card', status: 'paid',
  }),
  bill({
    id: 'bill-2', number: 'R-01002', patient_id: 'p-kavita', created_at: '2026-08-28T11:40:00Z', paid_at: '2026-08-28T11:41:00Z',
    items: [{ description: 'Physiotherapy package, 8 sessions', qty: 8, rate: 600 }],
    subtotal: 4800, discount: 400, total: 4400, paid: 2000, payment_method: 'cash', status: 'part_paid',
  }),
  bill({
    id: 'bill-3', number: 'R-01003', patient_id: 'p-anil', appointment_id: 'ap-s1', created_at: '2026-08-29T04:20:00Z', paid_at: '2026-08-29T04:21:00Z',
    items: [{ description: 'Consultation, Dr. Sagar Karvir', qty: 1, rate: 800 }],
    subtotal: 800, discount: 0, total: 800, paid: 800, payment_method: 'upi', status: 'paid',
  }),
];
