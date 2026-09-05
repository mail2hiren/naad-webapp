/**
 * Row types for the real, live Supabase schema (project linxtliatqpoaqbflwvh).
 * These mirror `information_schema` exactly as of the `clinic_ops_matrix_extension`
 * and `clinic_ops_matrix_extension_2` migrations applied this session -- do not
 * invent columns that aren't listed here without also writing a migration.
 */

export type StaffRole = 'receptionist' | 'surgeon' | 'pharmacist' | 'physio' | 'admin';
export type Specialty = 'Orthopedics' | 'Physiotherapy' | 'Critical Care';

export interface PractitionerRow {
  id: string;
  org_id: string;
  auth_user_id: string | null;
  name: string;
  role: StaffRole;
  title: string | null;
  specialty: Specialty | null;
  consult_fee: number | null;
  preferred_language: 'en' | 'hi';
  active: boolean;
}

export type QueueStatus =
  | 'new' | 'checking_in' | 'awaiting_verification' | 'waiting_doctor' | 'with_doctor'
  | 'under_review' | 'at_pharmacy' | 'admitted' | 'pending_discharge_clearance'
  | 'active_follow_up' | 'done';

export type UrgencyLevel = 'routine' | 'urgent' | 'critical_bypass';
export type JourneyStage = 'admitted' | 'operation' | 'physiotherapy' | 'progress_review' | 'discharged';

export interface JourneyHistoryEntry { stage: JourneyStage; enteredAt: string; by: string; note: string }

export interface IntakeCompleteness { identity: boolean; complaint: boolean; timeline: boolean; reports: boolean }
export interface IntakeState {
  rawTranscriptStream?: string;
  completenessCheck?: IntakeCompleteness;
  doctorQueryActive?: boolean;
  doctorQueryNote?: string;
  doctorResponseClearance?: string;
}
export interface TriageVitals {
  height?: number | null;
  weight?: number | null;
  bloodPressure?: string;
  pulseRate?: number | null;
  complaints?: string;
  /** Auto-filled from confirmed Ambient AI recommendation chips during
   * Reception's guided intake (Clinical_User_Stories row 2.4) -- kept
   * distinct from the raw transcript so it reads as structured triage
   * input, not buried conversational text. */
  notes?: string;
  /** Ward staff's current clinical read on an admitted bed (Clinical_User_
   * Stories row 5.0's "matrix grid of bed configurations -- Blue indicates
   * stable, Red signifies unstable"). Distinct from `journey_stage`, which
   * tracks care-pathway progress, not moment-to-moment clinical stability --
   * a patient can be mid-"Physiotherapy" and still flip unstable overnight.
   * Undefined = not yet assessed this admission. Lives on the existing
   * jsonb `triage` column rather than a new one, per this project's
   * additive-only-migration rule. */
  wardStability?: 'stable' | 'unstable';
}

export interface PatientRow {
  id: string;
  org_id: string;
  auth_user_id: string | null;
  mrn: string | null;
  name: string;
  age: number | null;
  gender: string | null;
  phone: string | null;
  conditions: string[];
  allergies: string[];
  medications: string[];
  queue_status: QueueStatus;
  urgency_level: UrgencyLevel;
  draft_summary: Record<string, unknown> | null;
  assigned_practitioner_id: string | null;
  preferred_language: 'en' | 'hi';
  phone_verified: boolean;
  journey_stage: JourneyStage | null;
  journey_stage_history: JourneyHistoryEntry[];
  discharged_at: string | null;
  discharge_summary: string | null;
  intake_state: IntakeState;
  triage: TriageVitals;
}

export type AppointmentStatus = 'requested' | 'scheduled' | 'checked_in' | 'completed' | 'cancelled' | 'no_show';

export interface AppointmentRow {
  id: string;
  org_id: string;
  patient_id: string;
  specialty: string | null;
  date: string | null;
  reason: string | null;
  practitioner_id: string | null;
  status: AppointmentStatus;
  start_time: string | null;
  duration_minutes: number;
  requested_by_patient: boolean;
}

export type EncounterSetting = 'clinic' | 'ward';
export type EncounterStatus = 'in_progress' | 'completed';
export type PaymentStatus = 'unpaid' | 'paid' | 'ledger_locked';

/**
 * Examination and Assessment are bullet lists (one finding/conclusion per
 * entry) rather than free paragraph text -- doctor feedback (Dr. Jayani,
 * 2026-09-03) was that these two fields specifically need to be scannable
 * at a glance during a live consult, matching the existing Precautions/
 * Dos & Don'ts bullet-list pattern. History and Plan stay as prose, which
 * is how doctors actually dictate/write them. See `src/lib/clinicalNote.ts`
 * for the read-side compatibility shim: every encounter saved before this
 * change has `examination`/`assessment` stored as a plain string in
 * Supabase, and that raw jsonb comes back untyped, so callers must run it
 * through `toBullets()` rather than assuming the array shape.
 */
export interface SoapSummary { history: string; examination: string[]; assessment: string[]; plan: string }
/**
 * One week's editable entry in a rehab exercise's Progression Matrix
 * (Clinical_User_Stories row 3.1.B, "Biomechanical Rehabilitation" --
 * "multi-week Progression Matrix Grid cards"). Physio adds a row per week
 * of the exercise's course; the same array is read (never edited) on the
 * Patient Portal's visit-history accordion once the encounter completes.
 */
export interface WeeklyProgressEntry { week: number; painScore: number | null; repsCompleted: number | null; note: string }
export interface RehabExercise {
  exerciseName: string; sets: number; reps: number; frequencyPerWeek: string; progressionNotes: string;
  weeklyProgress?: WeeklyProgressEntry[];
}
/**
 * Orthopedic joint-by-joint alignment tracker (row 3.1.A, "Skeletal
 * Assessment Log" -- "joint spacing checkers and alignment lines"). The
 * sheet frames this as ephemeral ("temporary text layers"), but persisting
 * it on the clinical note like every other structured field is more useful
 * for continuity across visits and costs nothing extra (still the same
 * jsonb column) -- a deliberate deviation from the sheet's literal framing,
 * called out to the user rather than silently applied.
 */
export type JointAlignment = 'Normal' | 'Reduced spacing' | 'Bone-on-bone' | 'Fracture line';
export interface JointAssessmentEntry { joint: string; alignment: JointAlignment }
/**
 * A single logged vitals reading during a Critical Care consult (row
 * 3.0.C, "High-Vigilance Intake" -- "prominent vital trend tracking line
 * graphs"). There is no separate `vitals_history` table in this schema, so
 * the trend is built from readings the doctor logs during the encounter
 * itself, kept on the clinical note alongside everything else.
 */
export interface VitalsLogEntry { timestamp: string; spo2: number | null; heartRate: number | null; bloodPressure: string }
export interface ClinicalNote {
  soapSummary: SoapSummary;
  rehabExercises: RehabExercise[];
  precautions: string[];
  dosAndDonts: string[];
  lastUpdatedBy: string;
  timestamp: string;
  jointAssessment?: JointAssessmentEntry[];
  vitalsLog?: VitalsLogEntry[];
}
export interface PreConsultSummary {
  height?: number | null;
  weight?: number | null;
  bloodPressure?: string;
  pulseRate?: number | null;
  complaints?: string;
  frontDeskNotes?: string;
}
/**
 * @deprecated superseded by the richer `QualityFlag`/`FixKind` defined
 * locally in `routes/doctor/ConsultationQualityGate.tsx`, which covers the
 * full set of specialty-aware fix kinds (rehab frequency, dos & don'ts,
 * food instructions) this narrower shape didn't anticipate. Kept here
 * unused rather than deleted, since nothing else in the app still expects
 * this exact shape -- do not add new imports of it.
 */
export interface MissingDataFlag {
  id: string;
  label: string;
  fixKind: 'rx-instructions' | 'precaution';
  fixText: string;
  resolved: boolean;
}

export interface EncounterRow {
  id: string;
  org_id: string;
  patient_id: string;
  practitioner_id: string;
  specialty: string | null;
  status: EncounterStatus;
  started_at: string;
  pre_consult_summary: PreConsultSummary | null;
  clinical_note: ClinicalNote | null;
  setting: EncounterSetting;
  ward: string | null;
  bed: string | null;
  recording_consent: 'given' | 'declined' | 'not_asked';
  capture_mode: 'conversation' | 'dictation';
  consultation_fee: number | null;
  billing_notes: string | null;
  payment_status: PaymentStatus;
}

export interface PrescriptionItem {
  medicationId: string;
  name: string;
  dosage: string;
  frequency: string;
  duration: string;
  foodInstruction: string;
  isStockAvailable: boolean;
  substitutionApproved: boolean;
  price: number;
}
export type PrescriptionStatus = 'draft' | 'sent_to_pharmacy';
export interface PrescriptionRow {
  id: string;
  org_id: string;
  encounter_id: string;
  patient_id: string;
  status: PrescriptionStatus;
  items: PrescriptionItem[];
  approved_by: string | null;
  approved_at: string | null;
}

export type PharmacyOrderStatus = 'received' | 'preparing' | 'packed' | 'exception' | 'ready' | 'collected';
export interface PharmacyOrderRow {
  id: string;
  org_id: string;
  prescription_id: string;
  patient_id: string;
  status: PharmacyOrderStatus;
  items: PrescriptionItem[];
  exception_note: string;
  updated_at: string;
  prep_started_at: string | null;
  ready_at: string | null;
}

export type ReferralStatus = 'pending' | 'accepted';
export interface ReferralRow {
  id: string;
  org_id: string;
  encounter_id: string;
  patient_id: string;
  from_practitioner_id: string;
  to_specialty: string | null;
  reason: string | null;
  restrictions: string | null;
  status: ReferralStatus;
  created_at: string;
}

export interface WardBillingLedgerRow {
  id: string;
  org_id: string;
  patient_id: string;
  encounter_id: string | null;
  description: string;
  amount: number;
  created_by: string | null;
  created_at: string;
}

export interface InventoryRow {
  id: number;
  org_id: string;
  drug: string;
  stock: number;
  unit: string | null;
  low: number;
  alternates: string[];
}

export type DocumentLabel = 'xray' | 'prescription' | 'report' | 'other';
export interface DocumentRow {
  id: string;
  org_id: string;
  patient_id: string;
  label: DocumentLabel;
  file_name: string;
  storage_path: string;
  content_type: string | null;
  size_bytes: number | null;
  uploaded_by: string | null;
  uploaded_at: string;
}

export type TranscriptStage = 'reception' | 'consult' | 'physio';
export interface TranscriptRow {
  id: string;
  org_id: string;
  patient_id: string;
  encounter_id: string | null;
  plan_id: string | null;
  stage: TranscriptStage;
  diarized_text: string;
  duration_seconds: number | null;
  created_at: string;
  source: 'audio' | 'typed';
}

export type NotificationType =
  | 'critical_bypass' | 'doctor_query' | 'doctor_query_cleared' | 'substitution_flag'
  | 'prescription_authorized' | 'discharge_ready' | 'general';
export interface NotificationRow {
  id: string;
  org_id: string;
  patient_id: string | null;
  practitioner_id: string | null;
  type: NotificationType | null;
  message: string | null;
  created_at: string;
  read: boolean;
  channel: 'inapp' | 'push';
}

export interface AuditEventRow {
  id: string;
  org_id: string;
  ts: string;
  actor: string | null;
  role: string | null;
  action: string | null;
  detail: string | null;
}
