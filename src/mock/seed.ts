import type {
  PractitionerRow, PatientRow, AppointmentRow, EncounterRow, PrescriptionRow,
  PharmacyOrderRow, ReferralRow, WardBillingLedgerRow, InventoryRow, DocumentRow,
  NotificationRow, AuditEventRow,
} from '../types/db';

/**
 * In-memory seed data for VITE_USE_MOCK=1 -- a snapshot shaped exactly like
 * the real Supabase tables (see types/db.ts), used for local dev and the
 * Playwright test suite so automated runs never write test data into the
 * live production database.
 *
 * Deliberately populated across EVERY queue/pharmacy/ward status and all
 * three doctor specialties (Orthopedics/Sagar, Physiotherapy/Jayani,
 * Critical Care/Namrata) -- built 2026-08-29 after feedback that a
 * pilot-doctor demo with mostly-empty queues/pharmacy/ward screens doesn't
 * actually show what the app does. Every patient below is a deliberately
 * fictional demo name, never a real patient. Original 4 (Meera Nair, Rohan
 * Joshi, Ramesh Iyer, Priya Sharma) kept exactly as before for continuity
 * with existing screenshots/tests; 7 new patients added to light up the
 * screens/states that were previously empty by default.
 */

export const ORG_ID = 'org1';

export const practitioners: PractitionerRow[] = [
  { id: 'pr-admin', org_id: ORG_ID, auth_user_id: 'auth-admin', name: 'Raj Kishore', role: 'admin', title: 'Hospital Administrator', specialty: null, consult_fee: null, preferred_language: 'en', active: true },
  { id: 'pr-pharm', org_id: ORG_ID, auth_user_id: 'auth-pharm', name: 'Vikram Shah', role: 'pharmacist', title: 'Pharmacist', specialty: null, consult_fee: null, preferred_language: 'en', active: true },
  { id: 'pr-physio', org_id: ORG_ID, auth_user_id: 'auth-physio', name: 'Dr. Jayani Bhatt', role: 'physio', title: 'Physiotherapist (MPT)', specialty: 'Physiotherapy', consult_fee: 600, preferred_language: 'en', active: true },
  { id: 'pr-recep', org_id: ORG_ID, auth_user_id: 'auth-recep', name: 'Sunita Kulkarni', role: 'receptionist', title: 'Front Desk', specialty: null, consult_fee: null, preferred_language: 'en', active: true },
  { id: 'pr-surgeon', org_id: ORG_ID, auth_user_id: 'auth-surgeon', name: 'Dr. Sagar Karvir', role: 'surgeon', title: 'Orthopedic Surgeon', specialty: 'Orthopedics', consult_fee: 800, preferred_language: 'en', active: true },
  { id: 'pr-namrata', org_id: ORG_ID, auth_user_id: 'auth-namrata', name: 'Dr. Namrata Rao', role: 'surgeon', title: 'Critical Care Physician', specialty: 'Critical Care', consult_fee: 1200, preferred_language: 'en', active: true },
];

export const patients: PatientRow[] = [
  // ---- Original 4, unchanged ----------------------------------------
  {
    id: 'p-meera', org_id: ORG_ID, auth_user_id: null, mrn: 'DGY-1004', name: 'Meera Nair', age: 61, gender: 'Female', phone: '99870 12233',
    conditions: ['Hypertension'], allergies: [], medications: [], queue_status: 'waiting_doctor', urgency_level: 'routine',
    draft_summary: null, assigned_practitioner_id: 'pr-surgeon', preferred_language: 'en', phone_verified: true,
    journey_stage: null, journey_stage_history: [], discharged_at: null, discharge_summary: null,
    intake_state: { rawTranscriptStream: 'Patient reports intermittent palpitations and mild exertional breathlessness over 2 weeks; denies chest pain.', completenessCheck: { identity: true, complaint: true, timeline: true, reports: false }, doctorQueryActive: false, doctorQueryNote: '', doctorResponseClearance: '' },
    triage: { height: 160, weight: 71, bloodPressure: '148/92', pulseRate: 96, complaints: 'Pre-operative assessment for total knee replacement, listed. Recurrent elevated heart rate trends on chart history.' },
  },
  {
    id: 'p-rohan', org_id: ORG_ID, auth_user_id: null, mrn: 'DGY-1005', name: 'Rohan Joshi', age: 33, gender: 'Male', phone: '98220 55671',
    conditions: [], allergies: [], medications: [], queue_status: 'waiting_doctor', urgency_level: 'routine',
    draft_summary: null, assigned_practitioner_id: 'pr-physio', preferred_language: 'en', phone_verified: true,
    journey_stage: null, journey_stage_history: [], discharged_at: null, discharge_summary: null,
    intake_state: { rawTranscriptStream: 'Physiotherapy recall, session 4 due, post-ACL reconstruction.', completenessCheck: { identity: true, complaint: true, timeline: true, reports: true }, doctorQueryActive: false, doctorQueryNote: '', doctorResponseClearance: '' },
    triage: { height: 175, weight: 80, bloodPressure: '118/76', pulseRate: 72, complaints: 'Post-ACL reconstruction, session 4 due.' },
  },
  {
    id: 'p-ramesh', org_id: ORG_ID, auth_user_id: 'auth-ramesh', mrn: 'DGY-1002', name: 'Ramesh Iyer', age: 58, gender: 'Male', phone: '90000 11122',
    conditions: [], allergies: [], medications: [], queue_status: 'admitted', urgency_level: 'routine',
    assigned_practitioner_id: 'pr-surgeon', preferred_language: 'en', phone_verified: true,
    draft_summary: null,
    journey_stage: 'physiotherapy',
    journey_stage_history: [
      { stage: 'admitted', enteredAt: '2026-08-24T03:10:00Z', by: 'Dr. Sagar Karvir', note: 'Admitted for right hip replacement.' },
      { stage: 'operation', enteredAt: '2026-08-24T08:00:00Z', by: 'Dr. Sagar Karvir', note: 'Right total hip replacement completed without complication.' },
      { stage: 'physiotherapy', enteredAt: '2026-08-25T08:10:00Z', by: 'Dr. Sagar Karvir', note: 'Vitals stable, wound clean and dry, ambulating with walker.' },
    ],
    discharged_at: null, discharge_summary: null,
    intake_state: {},
    triage: { height: 170, weight: 78, bloodPressure: '124/80', pulseRate: 76, complaints: 'Post-operative recovery, right hip replacement.', wardStability: 'stable' },
  },
  {
    id: 'p-priya', org_id: ORG_ID, auth_user_id: null, mrn: 'DGY-1001', name: 'Priya Sharma', age: 29, gender: 'Female', phone: '98765 43210',
    conditions: [], allergies: [], medications: [], queue_status: 'new', urgency_level: 'routine',
    draft_summary: null, assigned_practitioner_id: null, preferred_language: 'en', phone_verified: true,
    journey_stage: null, journey_stage_history: [], discharged_at: null, discharge_summary: null,
    intake_state: {}, triage: { complaints: 'Right shoulder pain, 2 days.' },
  },

  // ---- New: Critical Care / Dr. Namrata Rao --------------------------
  {
    // Fresh queue patient (3-second briefing state) with a prior completed
    // visit already on file, so Namrata's queue isn't empty by default AND
    // the "Encounter History" strip on the briefing card has something to
    // show even on a patient who hasn't started today's consult yet.
    id: 'p-arjun', org_id: ORG_ID, auth_user_id: null, mrn: 'DGY-1006', name: 'Arjun Mehta', age: 52, gender: 'Male', phone: '98330 11987',
    conditions: ['Hypertension'], allergies: [], medications: [], queue_status: 'waiting_doctor', urgency_level: 'urgent',
    draft_summary: null, assigned_practitioner_id: 'pr-namrata', preferred_language: 'en', phone_verified: true,
    journey_stage: null, journey_stage_history: [], discharged_at: null, discharge_summary: null,
    intake_state: { rawTranscriptStream: 'Recurrent palpitations since yesterday evening, follow-up after an ER visit for suspected arrhythmia.', completenessCheck: { identity: true, complaint: true, timeline: true, reports: true }, doctorQueryActive: false, doctorQueryNote: '', doctorResponseClearance: '' },
    triage: { height: 172, weight: 84, bloodPressure: '138/88', pulseRate: 104, complaints: 'Recurrent palpitations, follow-up post ER visit for suspected arrhythmia.' },
  },
  {
    // Already mid-consultation -- her encounter (enc-farah-1) is
    // in_progress, so opening her chart resumes straight into a
    // partially-filled note instead of a blank Session tab.
    id: 'p-farah', org_id: ORG_ID, auth_user_id: null, mrn: 'DGY-1007', name: 'Farah Sheikh', age: 45, gender: 'Female', phone: '98670 22456',
    conditions: ['Type 2 Diabetes'], allergies: ['Penicillin'], medications: [], queue_status: 'with_doctor', urgency_level: 'urgent',
    draft_summary: null, assigned_practitioner_id: 'pr-namrata', preferred_language: 'en', phone_verified: true,
    journey_stage: null, journey_stage_history: [], discharged_at: null, discharge_summary: null,
    intake_state: { rawTranscriptStream: 'Chest tightness and shortness of breath on exertion, worsening over 3 days.', completenessCheck: { identity: true, complaint: true, timeline: true, reports: true }, doctorQueryActive: false, doctorQueryNote: '', doctorResponseClearance: '' },
    triage: { height: 158, weight: 66, bloodPressure: '152/94', pulseRate: 110, complaints: 'Chest tightness and shortness of breath on exertion, worsening over 3 days.' },
  },

  // ---- New: Physiotherapy / Dr. Jayani Bhatt -------------------------
  {
    // A second physio patient, already mid-session (enc-kavita-1 in
    // progress) with rehab exercises partially filled -- shows the
    // Physiotherapy quality-gate flags without needing any typing.
    id: 'p-kavita', org_id: ORG_ID, auth_user_id: 'auth-kavita', mrn: 'DGY-1008', name: 'Kavita Deshmukh', age: 39, gender: 'Female', phone: '99110 33218',
    conditions: [], allergies: [], medications: [], queue_status: 'with_doctor', urgency_level: 'routine',
    draft_summary: null, assigned_practitioner_id: 'pr-physio', preferred_language: 'en', phone_verified: true,
    journey_stage: null, journey_stage_history: [], discharged_at: null, discharge_summary: null,
    intake_state: { rawTranscriptStream: 'Post-op knee arthroscopy, week 3 rehab session.', completenessCheck: { identity: true, complaint: true, timeline: true, reports: true }, doctorQueryActive: false, doctorQueryNote: '', doctorResponseClearance: '' },
    triage: { height: 162, weight: 68, bloodPressure: '122/80', pulseRate: 74, complaints: 'Post-op knee arthroscopy, week 3 rehab session.' },
  },

  // ---- New: Ward -- a second admitted bed, an earlier journey stage --
  {
    id: 'p-suresh', org_id: ORG_ID, auth_user_id: null, mrn: 'DGY-1009', name: 'Suresh Pillai', age: 65, gender: 'Male', phone: '90220 44871',
    conditions: ['Type 2 Diabetes'], allergies: [], medications: [], queue_status: 'admitted', urgency_level: 'routine',
    draft_summary: null, assigned_practitioner_id: 'pr-surgeon', preferred_language: 'en', phone_verified: true,
    journey_stage: 'operation',
    journey_stage_history: [
      { stage: 'admitted', enteredAt: '2026-08-28T02:30:00Z', by: 'Dr. Sagar Karvir', note: 'Admitted for left total hip replacement, diabetic -- perioperative glucose monitoring ordered.' },
      { stage: 'operation', enteredAt: '2026-08-28T07:15:00Z', by: 'Dr. Sagar Karvir', note: 'Left total hip replacement completed without complication.' },
    ],
    discharged_at: null, discharge_summary: null,
    intake_state: {},
    triage: { height: 168, weight: 82, bloodPressure: '130/84', pulseRate: 80, complaints: 'Post-operative recovery, left hip replacement.', wardStability: 'unstable' },
  },

  // ---- New: Ward -- pending discharge, ready for Admin to settle -----
  {
    id: 'p-lata', org_id: ORG_ID, auth_user_id: null, mrn: 'DGY-1010', name: 'Lata Kulkarni', age: 70, gender: 'Female', phone: '98450 66782',
    conditions: ['Osteoporosis'], allergies: [], medications: [], queue_status: 'pending_discharge_clearance', urgency_level: 'routine',
    draft_summary: null, assigned_practitioner_id: 'pr-surgeon', preferred_language: 'en', phone_verified: true,
    journey_stage: 'progress_review',
    journey_stage_history: [
      { stage: 'admitted', enteredAt: '2026-08-25T02:00:00Z', by: 'Dr. Sagar Karvir', note: 'Admitted for right hip fracture fixation.' },
      { stage: 'operation', enteredAt: '2026-08-25T06:30:00Z', by: 'Dr. Sagar Karvir', note: 'Right hip fracture fixation completed without complication.' },
      { stage: 'physiotherapy', enteredAt: '2026-08-26T09:00:00Z', by: 'Dr. Jayani Bhatt', note: 'Weight-bearing as tolerated, gait training started.' },
      { stage: 'progress_review', enteredAt: '2026-08-28T09:30:00Z', by: 'Dr. Sagar Karvir', note: 'Mobilizing independently with a stick. Cleared for discharge pending balance settlement.' },
    ],
    discharged_at: null, discharge_summary: null,
    intake_state: {},
    triage: { height: 155, weight: 58, bloodPressure: '128/78', pulseRate: 72, complaints: 'Right hip fracture, post-fixation recovery.' },
  },

  // ---- New: fully discharged, second Patient Portal login ------------
  {
    id: 'p-deepak', org_id: ORG_ID, auth_user_id: 'auth-deepak', mrn: 'DGY-1003', name: 'Deepak Rane', age: 60, gender: 'Male', phone: '98220 99001',
    conditions: [], allergies: [], medications: [], queue_status: 'active_follow_up', urgency_level: 'routine',
    draft_summary: null, assigned_practitioner_id: 'pr-surgeon', preferred_language: 'en', phone_verified: true,
    journey_stage: 'discharged',
    journey_stage_history: [
      { stage: 'admitted', enteredAt: '2026-08-18T02:15:00Z', by: 'Dr. Sagar Karvir', note: 'Admitted for left knee total replacement.' },
      { stage: 'operation', enteredAt: '2026-08-18T06:45:00Z', by: 'Dr. Sagar Karvir', note: 'Left total knee replacement completed without complication.' },
      { stage: 'physiotherapy', enteredAt: '2026-08-19T09:00:00Z', by: 'Dr. Jayani Bhatt', note: 'Started range-of-motion exercises, tolerating well.' },
      { stage: 'progress_review', enteredAt: '2026-08-21T09:00:00Z', by: 'Dr. Sagar Karvir', note: 'Good progress, independent mobility with a walker.' },
      { stage: 'discharged', enteredAt: '2026-08-22T11:00:00Z', by: 'Dr. Sagar Karvir', note: 'Discharged home. Follow-up in clinic in 2 weeks.' },
    ],
    discharged_at: '2026-08-22T11:00:00Z',
    discharge_summary: 'Left total knee replacement, uncomplicated post-op course. Discharged ambulant with a walker. Follow-up in clinic in 2 weeks; continue home physiotherapy exercises.',
    intake_state: {},
    triage: { height: 174, weight: 88, bloodPressure: '126/80', pulseRate: 74, complaints: 'Post-operative recovery, left knee replacement.' },
  },

  // ---- New: Reception -- mid AI-guided intake, doctor query cleared --
  {
    id: 'p-neha', org_id: ORG_ID, auth_user_id: null, mrn: 'DGY-1011', name: 'Neha Kelkar', age: 27, gender: 'Female', phone: '99225 71034',
    conditions: [], allergies: [], medications: [], queue_status: 'awaiting_verification', urgency_level: 'routine',
    draft_summary: null, assigned_practitioner_id: 'pr-surgeon', preferred_language: 'en', phone_verified: true,
    journey_stage: null, journey_stage_history: [], discharged_at: null, discharge_summary: null,
    intake_state: {
      rawTranscriptStream: 'Sudden dizziness on standing this morning, no chest pain, no fall.',
      completenessCheck: { identity: true, complaint: true, timeline: true, reports: false },
      doctorQueryActive: false,
      doctorQueryNote: 'Any history of similar episodes or medication changes?',
      doctorResponseClearance: 'No red flags -- likely orthostatic, proceed with standard intake and routine BP check.',
    },
    triage: { bloodPressure: '108/68', pulseRate: 88, complaints: 'Sudden dizziness on standing, no chest pain, no fall.' },
  },
];

export const appointments: AppointmentRow[] = [
  { id: 'ap-1', org_id: ORG_ID, patient_id: 'p-priya', specialty: 'Orthopedics', date: null, reason: 'Right shoulder pain, 2 days', practitioner_id: 'pr-surgeon', status: 'scheduled', start_time: null, duration_minutes: 20, requested_by_patient: false },
  { id: 'ap-2', org_id: ORG_ID, patient_id: 'p-priya', specialty: 'Physiotherapy', date: '30 Aug, 11:00 AM', reason: 'Knee stiffness follow-up (telephonic booking)', practitioner_id: 'pr-physio', status: 'scheduled', start_time: null, duration_minutes: 20, requested_by_patient: false },
];

export const encounters: EncounterRow[] = [
  {
    id: 'enc-meera-1', org_id: ORG_ID, patient_id: 'p-meera', practitioner_id: 'pr-surgeon', specialty: 'Orthopedics', status: 'in_progress',
    started_at: '2026-08-27T04:00:00Z',
    pre_consult_summary: { height: 160, weight: 71, bloodPressure: '148/92', pulseRate: 96, complaints: 'Pre-operative assessment, total knee replacement, listed.', frontDeskNotes: 'AI insight: recurrent elevated heart rate trends on chart history, flagged for pre-anesthesia clearance.' },
    clinical_note: {
      soapSummary: { history: 'Reports intermittent palpitations and mild exertional breathlessness over 2 weeks; denies chest pain.', examination: ['BP 148/92, HR 96 and irregular, SpO2 98%', 'Pre-op labs pending'], assessment: ['Essential hypertension, poorly controlled - elevated peri-operative cardiac risk'], plan: 'Cardiology pre-anesthesia clearance requested; hold surgical scheduling pending clearance.' },
      rehabExercises: [], precautions: ['Pre-anesthesia clearance required before surgical scheduling'], dosAndDonts: [],
      lastUpdatedBy: 'Dr. Sagar Karvir', timestamp: '2026-08-27T04:05:00Z',
    },
    setting: 'clinic', ward: null, bed: null, recording_consent: 'given', capture_mode: 'dictation',
    consultation_fee: null, billing_notes: null, payment_status: 'unpaid',
  },
  {
    // Ramesh and Deepak are the two seeded Patient Portal logins -- both
    // need a completed encounter on file for the portal's own
    // "longitudinal visit timeline accordion" to have something to show.
    id: 'enc-ramesh-1', org_id: ORG_ID, patient_id: 'p-ramesh', practitioner_id: 'pr-surgeon', specialty: 'Orthopedics', status: 'completed',
    started_at: '2026-08-24T08:00:00Z',
    pre_consult_summary: { height: 170, weight: 78, bloodPressure: '124/80', pulseRate: 76, complaints: 'Right hip osteoarthritis, listed for total hip replacement.' },
    clinical_note: {
      soapSummary: { history: 'Chronic right hip pain, worsening mobility over 18 months.', examination: ['Reduced right hip range of motion, antalgic gait'], assessment: ['Right hip osteoarthritis, end-stage'], plan: 'Right total hip replacement performed without complication.' },
      rehabExercises: [{ exerciseName: 'Ankle pumps', sets: 3, reps: 15, frequencyPerWeek: 'Daily', progressionNotes: 'Begin post-op day 1' }],
      precautions: ['No hip flexion beyond 90 degrees for 6 weeks', 'Use walker for ambulation until cleared'],
      dosAndDonts: ['Do keep the incision site clean and dry', "Don't cross legs or twist at the hip"],
      lastUpdatedBy: 'Dr. Sagar Karvir', timestamp: '2026-08-24T09:30:00Z',
    },
    setting: 'ward', ward: 'Ortho Ward A', bed: '4B', recording_consent: 'given', capture_mode: 'dictation',
    consultation_fee: 800, billing_notes: null, payment_status: 'unpaid',
  },
  {
    // A prior, already-closed-out visit for Arjun -- gives his CURRENT
    // fresh queue entry an "Encounter History" line on the briefing card
    // even before today's consult starts.
    id: 'enc-arjun-0', org_id: ORG_ID, patient_id: 'p-arjun', practitioner_id: 'pr-namrata', specialty: 'Critical Care', status: 'completed',
    started_at: '2026-08-20T05:00:00Z',
    pre_consult_summary: { height: 172, weight: 85, bloodPressure: '142/90', pulseRate: 98, complaints: 'First presentation of palpitations, no prior cardiac history.' },
    clinical_note: {
      soapSummary: { history: 'New-onset palpitations, no prior cardiac history, no syncope.', examination: ['HR 98 irregular, BP 142/90, SpO2 97%', 'ECG showed occasional ectopics'], assessment: ['Suspected paroxysmal arrhythmia, further monitoring advised'], plan: '24-hour Holter monitor arranged; review in 1 week or sooner if symptoms worsen.' },
      rehabExercises: [], precautions: ['Maintain SpO2 above 94%; escalate if symptoms worsen'], dosAndDonts: ["Don't skip prescribed beta-blocker doses"],
      lastUpdatedBy: 'Dr. Namrata Rao', timestamp: '2026-08-20T05:20:00Z',
    },
    setting: 'clinic', ward: null, bed: null, recording_consent: 'given', capture_mode: 'dictation',
    consultation_fee: 1200, billing_notes: null, payment_status: 'paid',
  },
  {
    // In progress -- deliberately leaves precautions/dosAndDonts empty so
    // the Critical Care Quality Gate's two flags (SpO2 monitoring, discharge
    // safety checklist) are visible the moment "Finish Consultation" is
    // clicked, without anyone needing to type anything first.
    id: 'enc-farah-1', org_id: ORG_ID, patient_id: 'p-farah', practitioner_id: 'pr-namrata', specialty: 'Critical Care', status: 'in_progress',
    started_at: '2026-08-29T03:30:00Z',
    pre_consult_summary: { height: 158, weight: 66, bloodPressure: '152/94', pulseRate: 110, complaints: 'Chest tightness and shortness of breath on exertion, worsening over 3 days.', frontDeskNotes: 'Diabetic, penicillin allergy on file.' },
    clinical_note: {
      soapSummary: { history: 'Chest tightness and dyspnea on exertion, progressive over 3 days. No fever, no cough.', examination: ['BP 152/94, HR 110, SpO2 95% on room air', 'Bilateral air entry equal, no added sounds'], assessment: ['Suspected unstable angina vs. anxiety-related chest tightness -- cardiology workup indicated'], plan: 'ECG and troponin ordered; cardiology referral; started on aspirin and statin pending review.' },
      rehabExercises: [], precautions: [], dosAndDonts: [],
      lastUpdatedBy: 'Dr. Namrata Rao', timestamp: '2026-08-29T03:45:00Z',
    },
    setting: 'clinic', ward: null, bed: null, recording_consent: 'given', capture_mode: 'dictation',
    consultation_fee: null, billing_notes: null, payment_status: 'unpaid',
  },
  {
    // In progress -- one rehab exercise deliberately missing its frequency,
    // and precautions left empty, so both Physiotherapy Quality Gate flags
    // are ready to demonstrate.
    id: 'enc-kavita-1', org_id: ORG_ID, patient_id: 'p-kavita', practitioner_id: 'pr-physio', specialty: 'Physiotherapy', status: 'in_progress',
    started_at: '2026-08-29T04:00:00Z',
    pre_consult_summary: { height: 162, weight: 68, bloodPressure: '122/80', pulseRate: 74, complaints: 'Post-op knee arthroscopy, week 3 rehab session.' },
    clinical_note: {
      soapSummary: { history: 'Week 3 post-arthroscopic knee surgery, progressing with rehab.', examination: ['Knee ROM 0-110 degrees, mild residual swelling, quadriceps activation improving'], assessment: ['Expected post-op recovery trajectory, on track'], plan: 'Progress quadriceps strengthening, add balance work next session.' },
      rehabExercises: [{ exerciseName: 'Straight leg raises', sets: 3, reps: 12, frequencyPerWeek: '', progressionNotes: 'Add ankle weight once pain-free' }],
      precautions: [], dosAndDonts: ['Do ice the knee for 15 minutes after each session'],
      lastUpdatedBy: 'Dr. Jayani Bhatt', timestamp: '2026-08-29T04:15:00Z',
    },
    setting: 'clinic', ward: null, bed: null, recording_consent: 'given', capture_mode: 'dictation',
    consultation_fee: null, billing_notes: null, payment_status: 'unpaid',
  },
  {
    id: 'enc-suresh-1', org_id: ORG_ID, patient_id: 'p-suresh', practitioner_id: 'pr-surgeon', specialty: 'Orthopedics', status: 'completed',
    started_at: '2026-08-28T07:15:00Z',
    pre_consult_summary: { height: 168, weight: 82, bloodPressure: '130/84', pulseRate: 80, complaints: 'Left hip osteoarthritis, listed for total hip replacement. Diabetic.' },
    clinical_note: {
      soapSummary: { history: 'Chronic left hip pain, diabetic, HbA1c well controlled pre-op.', examination: ['Reduced left hip range of motion, antalgic gait'], assessment: ['Left hip osteoarthritis, end-stage'], plan: 'Left total hip replacement performed without complication. Perioperative glucose monitoring continued.' },
      rehabExercises: [{ exerciseName: 'Ankle pumps', sets: 3, reps: 15, frequencyPerWeek: 'Daily', progressionNotes: 'Begin post-op day 1' }],
      precautions: ['No hip flexion beyond 90 degrees for 6 weeks', 'Monitor blood glucose 4x daily during admission'],
      dosAndDonts: ['Do keep the incision site clean and dry', "Don't cross legs or twist at the hip"],
      lastUpdatedBy: 'Dr. Sagar Karvir', timestamp: '2026-08-28T08:30:00Z',
    },
    setting: 'ward', ward: 'Ortho Ward A', bed: '5A', recording_consent: 'given', capture_mode: 'dictation',
    consultation_fee: 800, billing_notes: null, payment_status: 'unpaid',
  },
  {
    // payment_status:'ledger_locked' -- the one enum value that otherwise
    // never appears in seed data; a patient mid-discharge-settlement.
    id: 'enc-lata-1', org_id: ORG_ID, patient_id: 'p-lata', practitioner_id: 'pr-surgeon', specialty: 'Orthopedics', status: 'completed',
    started_at: '2026-08-25T06:30:00Z',
    pre_consult_summary: { height: 155, weight: 58, bloodPressure: '128/78', pulseRate: 72, complaints: 'Right hip fracture, post-fixation recovery.' },
    clinical_note: {
      soapSummary: { history: 'Fall at home, right hip fracture, underwent fixation.', examination: ['Wound healing well, mobilizing with a stick'], assessment: ['Right hip fracture, post-fixation, recovering as expected'], plan: 'Cleared for discharge once billing is settled. Continue home physiotherapy.' },
      rehabExercises: [{ exerciseName: 'Assisted gait training', sets: 1, reps: 1, frequencyPerWeek: 'Daily', progressionNotes: 'Progress from stick to unaided as tolerated' }],
      precautions: ['Fall-risk precautions at home -- clear walkways, use the prescribed stick'],
      dosAndDonts: ['Do continue calcium and vitamin D supplementation', "Don't skip physiotherapy follow-up"],
      lastUpdatedBy: 'Dr. Sagar Karvir', timestamp: '2026-08-28T09:30:00Z',
    },
    setting: 'ward', ward: 'Ortho Ward A', bed: '3C', recording_consent: 'given', capture_mode: 'dictation',
    consultation_fee: 800, billing_notes: 'Awaiting Admin discharge balance settlement.', payment_status: 'ledger_locked',
  },
  {
    id: 'enc-deepak-1', org_id: ORG_ID, patient_id: 'p-deepak', practitioner_id: 'pr-surgeon', specialty: 'Orthopedics', status: 'completed',
    started_at: '2026-08-18T06:45:00Z',
    pre_consult_summary: { height: 174, weight: 88, bloodPressure: '126/80', pulseRate: 74, complaints: 'Left knee osteoarthritis, listed for total knee replacement.' },
    clinical_note: {
      soapSummary: { history: 'Chronic left knee pain, worsening mobility over 2 years.', examination: ['Reduced left knee range of motion, varus deformity'], assessment: ['Left knee osteoarthritis, end-stage'], plan: 'Left total knee replacement performed without complication.' },
      rehabExercises: [{ exerciseName: 'Quad sets', sets: 3, reps: 15, frequencyPerWeek: 'Daily', progressionNotes: 'Begin post-op day 1' }],
      precautions: ['Use a walker for ambulation until cleared', 'No kneeling for 8 weeks'],
      dosAndDonts: ['Do keep the incision site clean and dry', "Don't twist at the knee"],
      lastUpdatedBy: 'Dr. Sagar Karvir', timestamp: '2026-08-18T08:00:00Z',
    },
    setting: 'ward', ward: 'Ortho Ward A', bed: '2A', recording_consent: 'given', capture_mode: 'dictation',
    consultation_fee: 900, billing_notes: null, payment_status: 'paid',
  },
];

export const prescriptions: PrescriptionRow[] = [
  {
    id: 'rx-ramesh-1', org_id: ORG_ID, encounter_id: 'enc-ramesh-1', patient_id: 'p-ramesh', status: 'sent_to_pharmacy',
    items: [
      { medicationId: 'med-etoricoxib', name: 'Etoricoxib 90mg', dosage: '1 tablet', frequency: 'Once daily', duration: '7 days', foodInstruction: 'Take after meals', isStockAvailable: true, substitutionApproved: false, price: 12 },
      { medicationId: 'med-rabeprazole', name: 'Rabeprazole 20mg', dosage: '1 tablet', frequency: 'Once daily, morning', duration: '7 days', foodInstruction: 'Take before breakfast', isStockAvailable: true, substitutionApproved: false, price: 8 },
    ],
    approved_by: 'Dr. Sagar Karvir', approved_at: '2026-08-24T09:30:00Z',
  },
  {
    id: 'rx-farah-1', org_id: ORG_ID, encounter_id: 'enc-farah-1', patient_id: 'p-farah', status: 'sent_to_pharmacy',
    items: [
      { medicationId: 'med-aspirin', name: 'Aspirin 75mg', dosage: '1 tablet', frequency: 'Once daily', duration: '30 days', foodInstruction: 'Take after meals', isStockAvailable: true, substitutionApproved: false, price: 5 },
      { medicationId: 'med-atorvastatin', name: 'Atorvastatin 20mg', dosage: '1 tablet', frequency: 'Once daily, night', duration: '30 days', foodInstruction: 'Take at bedtime', isStockAvailable: true, substitutionApproved: false, price: 15 },
    ],
    approved_by: null, approved_at: null,
  },
  {
    id: 'rx-kavita-1', org_id: ORG_ID, encounter_id: 'enc-kavita-1', patient_id: 'p-kavita', status: 'sent_to_pharmacy',
    items: [
      { medicationId: 'med-diclofenac-gel', name: 'Diclofenac Gel 1%', dosage: 'Apply thin layer', frequency: 'Twice daily', duration: '10 days', foodInstruction: 'N/A - topical', isStockAvailable: true, substitutionApproved: false, price: 90 },
    ],
    approved_by: 'Dr. Jayani Bhatt', approved_at: '2026-08-29T04:20:00Z',
  },
  {
    id: 'rx-suresh-1', org_id: ORG_ID, encounter_id: 'enc-suresh-1', patient_id: 'p-suresh', status: 'sent_to_pharmacy',
    items: [
      { medicationId: 'med-tramadol', name: 'Tramadol 50mg', dosage: '1 tablet', frequency: 'Twice daily', duration: '5 days', foodInstruction: 'Take after meals', isStockAvailable: true, substitutionApproved: false, price: 10 },
      { medicationId: 'med-pantoprazole', name: 'Pantoprazole 40mg', dosage: '1 tablet', frequency: 'Once daily, morning', duration: '10 days', foodInstruction: 'Take before breakfast', isStockAvailable: true, substitutionApproved: false, price: 9 },
    ],
    approved_by: 'Dr. Sagar Karvir', approved_at: '2026-08-28T08:30:00Z',
  },
  {
    id: 'rx-lata-1', org_id: ORG_ID, encounter_id: 'enc-lata-1', patient_id: 'p-lata', status: 'sent_to_pharmacy',
    items: [
      { medicationId: 'med-calcium-d3', name: 'Calcium + Vitamin D3', dosage: '1 tablet', frequency: 'Once daily', duration: '30 days', foodInstruction: 'Take after meals', isStockAvailable: false, substitutionApproved: false, price: 18 },
      { medicationId: 'med-paracetamol', name: 'Paracetamol 650mg', dosage: '1 tablet', frequency: 'As needed for pain', duration: '10 days', foodInstruction: 'Take after meals', isStockAvailable: true, substitutionApproved: false, price: 4 },
    ],
    approved_by: 'Dr. Sagar Karvir', approved_at: '2026-08-28T09:30:00Z',
  },
  {
    id: 'rx-deepak-1', org_id: ORG_ID, encounter_id: 'enc-deepak-1', patient_id: 'p-deepak', status: 'sent_to_pharmacy',
    items: [
      { medicationId: 'med-aspirin', name: 'Aspirin 75mg', dosage: '1 tablet', frequency: 'Once daily', duration: '14 days', foodInstruction: 'Take after meals', isStockAvailable: true, substitutionApproved: false, price: 5 },
    ],
    approved_by: 'Dr. Sagar Karvir', approved_at: '2026-08-18T08:00:00Z',
  },
];

export const pharmacyOrders: PharmacyOrderRow[] = [
  {
    // Ready for Pickup column
    id: 'po-ramesh-1', org_id: ORG_ID, prescription_id: 'rx-ramesh-1', patient_id: 'p-ramesh', status: 'ready',
    items: prescriptions[0].items, exception_note: '', updated_at: '2026-08-24T10:15:00Z',
    prep_started_at: '2026-08-24T09:40:00Z', ready_at: '2026-08-24T10:15:00Z',
  },
  {
    // Pending Preparation column
    id: 'po-farah-1', org_id: ORG_ID, prescription_id: 'rx-farah-1', patient_id: 'p-farah', status: 'received',
    items: prescriptions[1].items, exception_note: '', updated_at: '2026-08-29T03:50:00Z',
    prep_started_at: null, ready_at: null,
  },
  {
    // Collected -- already picked up, drops off the Kanban entirely.
    id: 'po-kavita-1', org_id: ORG_ID, prescription_id: 'rx-kavita-1', patient_id: 'p-kavita', status: 'collected',
    items: prescriptions[2].items, exception_note: '', updated_at: '2026-08-29T04:40:00Z',
    prep_started_at: '2026-08-29T04:22:00Z', ready_at: '2026-08-29T04:30:00Z',
  },
  {
    // Preparing column, with a real elapsed-time ticker.
    id: 'po-suresh-1', org_id: ORG_ID, prescription_id: 'rx-suresh-1', patient_id: 'p-suresh', status: 'preparing',
    items: prescriptions[3].items, exception_note: '', updated_at: '2026-08-29T02:10:00Z',
    prep_started_at: '2026-08-29T02:10:00Z', ready_at: null,
  },
  {
    // Exception -- low-stock substitution flag, tied to the low-stock
    // inventory row below.
    id: 'po-lata-1', org_id: ORG_ID, prescription_id: 'rx-lata-1', patient_id: 'p-lata', status: 'exception',
    items: prescriptions[4].items, exception_note: 'Calcium + Vitamin D3 combination out of stock -- substitute Calcium Citrate 500mg + Vitamin D3 60000IU separately?',
    updated_at: '2026-08-28T10:00:00Z', prep_started_at: '2026-08-28T09:45:00Z', ready_at: null,
  },
  {
    id: 'po-deepak-1', org_id: ORG_ID, prescription_id: 'rx-deepak-1', patient_id: 'p-deepak', status: 'collected',
    items: prescriptions[5].items, exception_note: '', updated_at: '2026-08-18T09:00:00Z',
    prep_started_at: '2026-08-18T08:15:00Z', ready_at: '2026-08-18T08:45:00Z',
  },
];

export const referrals: ReferralRow[] = [
  {
    id: 'ref-meera-1', org_id: ORG_ID, encounter_id: 'enc-meera-1', patient_id: 'p-meera', from_practitioner_id: 'pr-surgeon',
    to_specialty: 'Physiotherapy', reason: 'Pre-hab strengthening ahead of listed total knee replacement.', restrictions: 'Avoid high-impact loading pending surgical clearance.',
    status: 'pending', created_at: '2026-08-27T04:10:00Z',
  },
];

export const wardBillingLedger: WardBillingLedgerRow[] = [
  { id: 'wl-1', org_id: ORG_ID, patient_id: 'p-ramesh', encounter_id: null, description: 'Room charges - Day 1', amount: 3500, created_by: 'Sunita Kulkarni', created_at: '2026-08-24T09:00:00Z' },
  { id: 'wl-2', org_id: ORG_ID, patient_id: 'p-ramesh', encounter_id: null, description: 'Physiotherapy session', amount: 1200, created_by: 'Dr. Jayani Bhatt', created_at: '2026-08-25T10:00:00Z' },
  { id: 'wl-3', org_id: ORG_ID, patient_id: 'p-suresh', encounter_id: null, description: 'Room charges - Day 1', amount: 3500, created_by: 'Sunita Kulkarni', created_at: '2026-08-28T09:00:00Z' },
  { id: 'wl-4', org_id: ORG_ID, patient_id: 'p-suresh', encounter_id: null, description: 'OT charges - Left Total Hip Replacement', amount: 18000, created_by: 'Dr. Sagar Karvir', created_at: '2026-08-28T08:00:00Z' },
  { id: 'wl-5', org_id: ORG_ID, patient_id: 'p-suresh', encounter_id: null, description: 'Room charges - Day 2', amount: 3500, created_by: 'Sunita Kulkarni', created_at: '2026-08-29T09:00:00Z' },
  { id: 'wl-6', org_id: ORG_ID, patient_id: 'p-lata', encounter_id: null, description: 'Room charges - Day 1', amount: 3200, created_by: 'Sunita Kulkarni', created_at: '2026-08-25T09:00:00Z' },
  { id: 'wl-7', org_id: ORG_ID, patient_id: 'p-lata', encounter_id: null, description: 'Room charges - Day 2', amount: 3200, created_by: 'Sunita Kulkarni', created_at: '2026-08-26T09:00:00Z' },
  { id: 'wl-8', org_id: ORG_ID, patient_id: 'p-lata', encounter_id: null, description: 'Physiotherapy sessions x3', amount: 3600, created_by: 'Dr. Jayani Bhatt', created_at: '2026-08-27T10:00:00Z' },
];

export const inventory: InventoryRow[] = [
  { id: 1, org_id: ORG_ID, drug: 'Ibuprofen 400mg', stock: 40, unit: 'tablets', low: 10, alternates: ['Naproxen 250mg', 'Diclofenac 50mg'] },
  { id: 2, org_id: ORG_ID, drug: 'Salbutamol Nebulization 2.5mg', stock: 3, unit: 'vials', low: 5, alternates: ['Levosalbutamol 1.25mg'] },
  { id: 3, org_id: ORG_ID, drug: 'Amoxicillin 500mg', stock: 60, unit: 'capsules', low: 15, alternates: ['Cefixime 200mg'] },
  { id: 4, org_id: ORG_ID, drug: 'Calcium + Vitamin D3', stock: 2, unit: 'tablets', low: 10, alternates: ['Calcium Citrate 500mg', 'Vitamin D3 60000IU'] },
];

export const documents: DocumentRow[] = [
  { id: 'doc-arjun-1', org_id: ORG_ID, patient_id: 'p-arjun', label: 'report', file_name: 'ER_ECG_report.pdf', storage_path: 'demo/ER_ECG_report.pdf', content_type: 'application/pdf', size_bytes: 184320, uploaded_by: 'Sunita Kulkarni', uploaded_at: '2026-08-29T03:20:00Z' },
  { id: 'doc-arjun-2', org_id: ORG_ID, patient_id: 'p-arjun', label: 'report', file_name: 'ER_discharge_summary.pdf', storage_path: 'demo/ER_discharge_summary.pdf', content_type: 'application/pdf', size_bytes: 96256, uploaded_by: 'Sunita Kulkarni', uploaded_at: '2026-08-29T03:21:00Z' },
  { id: 'doc-farah-1', org_id: ORG_ID, patient_id: 'p-farah', label: 'report', file_name: 'CBC_and_lipid_panel.pdf', storage_path: 'demo/CBC_and_lipid_panel.pdf', content_type: 'application/pdf', size_bytes: 122880, uploaded_by: 'Sunita Kulkarni', uploaded_at: '2026-08-29T03:25:00Z' },
];

export const notifications: NotificationRow[] = [
  { id: 'n-1', org_id: ORG_ID, patient_id: 'p-ramesh', practitioner_id: null, type: 'prescription_authorized', message: 'Prescription authorized for Ramesh Iyer', created_at: '2026-08-24T09:30:00Z', read: true, channel: 'inapp' },
  { id: 'n-2', org_id: ORG_ID, patient_id: 'p-lata', practitioner_id: 'pr-pharm', type: 'substitution_flag', message: 'Calcium + Vitamin D3 low stock -- substitution needed for Lata Kulkarni', created_at: '2026-08-28T10:00:00Z', read: false, channel: 'inapp' },
];

export const auditEvents: AuditEventRow[] = [
  { id: 'ae-1', org_id: ORG_ID, ts: '2026-08-24T09:30:00Z', actor: 'Dr. Sagar Karvir', role: 'surgeon', action: 'authorize_and_route', detail: 'Authorized prescription and routed to pharmacy for Ramesh Iyer.' },
  { id: 'ae-2', org_id: ORG_ID, ts: '2026-08-28T09:30:00Z', actor: 'Dr. Sagar Karvir', role: 'surgeon', action: 'journey_advance', detail: 'Advanced Lata Kulkarni to Progress Review, cleared for discharge pending balance settlement.' },
  { id: 'ae-3', org_id: ORG_ID, ts: '2026-08-22T11:00:00Z', actor: 'Dr. Sagar Karvir', role: 'surgeon', action: 'discharge', detail: 'Discharged Deepak Rane with a 2-week clinic follow-up.' },
];

/**
 * Demo credentials for the mock auth layer. Maps directly to a Supabase Auth
 * `user.id` (matching `auth_user_id` on either a `practitioners` row for
 * staff, or a `patients` row for the Patient Portal's separate patient-only
 * login) -- generic over both, since the Patient Portal authenticates the
 * same way staff do (supabase.auth.signInWithPassword) but is never staff.
 */
export const MOCK_CREDENTIALS: Record<string, { password: string; userId: string }> = {
  'sunita@digiyaan.demo': { password: 'pass1234', userId: 'auth-recep' },
  'sagar@digiyaan.demo': { password: 'pass1234', userId: 'auth-surgeon' },
  'jayani@digiyaan.demo': { password: 'pass1234', userId: 'auth-physio' },
  'namrata@digiyaan.demo': { password: 'pass1234', userId: 'auth-namrata' },
  'vikram@digiyaan.demo': { password: 'pass1234', userId: 'auth-pharm' },
  'raj@digiyaan.demo': { password: 'pass1234', userId: 'auth-admin' },
  // Patient Portal logins -- Ramesh Iyer (p-ramesh, mid-journey), Deepak
  // Rane (p-deepak, fully discharged), and Kavita Deshmukh (p-kavita, an
  // in-progress Physiotherapy visit -- needed so the Progression Matrix's
  // doctor-to-patient-portal mirror has a real portal login to verify
  // against) are the seeded patients with a linked auth_user_id, matching
  // the real live schema's convention.
  'ramesh@digiyaan.demo': { password: 'pass1234', userId: 'auth-ramesh' },
  'deepak@digiyaan.demo': { password: 'pass1234', userId: 'auth-deepak' },
  'kavita@digiyaan.demo': { password: 'pass1234', userId: 'auth-kavita' },
};
