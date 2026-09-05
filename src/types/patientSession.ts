import type {
  PatientRow, EncounterRow, PrescriptionRow, WardBillingLedgerRow, DocumentRow, PractitionerRow,
} from './db';

/**
 * PatientSession -- the exact view-model shape requested for cross-module
 * communication. It is assembled (not stored as one row) from the real,
 * normalized Supabase tables in types/db.ts: a flat mega-object mixing
 * registration data, ambient transcripts, clinical notes and billing into
 * a single table would be a real anti-pattern for a relational system with
 * RLS per table, so the source of truth stays split across
 * patients / encounters / prescriptions / ward_billing_ledger / documents,
 * and `assemblePatientSession()` below joins them into this shape for
 * components to consume -- satisfying "one typed interface" for the
 * frontend without denormalizing the database.
 */
export interface UploadedFile {
  fileId: string;
  fileName: string;
  fileType: 'XRay' | 'MRI' | 'BloodReport' | 'Other';
  url: string;
}

export interface PatientSession {
  sessionId: string;
  encounterId: string | null;
  patientName: string;
  phone: string;
  age: number;
  gender: 'Male' | 'Female' | 'Other';
  status:
    | 'Scheduled' | 'In Queue' | 'Awaiting Verification' | 'With Doctor' | 'Under Review'
    | 'At Pharmacy' | 'Admitted' | 'Pending Discharge Clearance' | 'Active Follow-up' | 'Done';
  urgencyLevel: 'Routine' | 'Urgent' | 'CRITICAL_BYPASS';
  serviceType: 'Outpatient Consultation' | 'Inpatient Ward Admission';
  assignedDoctorId: string | null;
  assignedDoctor: string;
  triage: {
    height: number;
    weight: number;
    bloodPressure: string;
    pulseRate: number;
    complaints: string;
    uploadedFiles: UploadedFile[];
  };
  aiGuidedIntake: {
    rawTranscriptStream: string;
    completenessCheck: { identity: boolean; complaint: boolean; timeline: boolean; reports: boolean };
    doctorQueryActive: boolean;
    doctorQueryNote: string;
    doctorResponseClearance: string;
  };
  clinicalNotes: {
    soapSummary: { history: string; examination: string[]; assessment: string[]; plan: string };
    prescriptions: {
      medicationId: string; name: string; dosage: string; frequency: string; duration: string;
      foodInstruction: string; isStockAvailable: boolean; substitutionApproved: boolean; price: number;
    }[];
    rehabExercises: { exerciseName: string; sets: number; reps: number; frequencyPerWeek: string; progressionNotes: string }[];
    precautions: string[];
    dosAndDonts: string[];
    lastUpdatedBy: string;
    timestamp: string;
  };
  billing: {
    baseConsultationFee: number;
    wardStayDays: number;
    accumulatedInpatientCharges: number;
    pharmacyBillTotal: number;
    paymentStatus: 'Unpaid' | 'Paid' | 'Inpatient Ledger Locked';
    billingNotes: string;
  };
}

const STATUS_DB_TO_UI: Record<string, PatientSession['status']> = {
  new: 'Scheduled',
  checking_in: 'In Queue',
  awaiting_verification: 'Awaiting Verification',
  waiting_doctor: 'In Queue',
  with_doctor: 'With Doctor',
  under_review: 'Under Review',
  at_pharmacy: 'At Pharmacy',
  admitted: 'Admitted',
  pending_discharge_clearance: 'Pending Discharge Clearance',
  active_follow_up: 'Active Follow-up',
  done: 'Done',
};
export const STATUS_UI_TO_DB: Record<PatientSession['status'], string> = Object.fromEntries(
  Object.entries(STATUS_DB_TO_UI).map(([db, ui]) => [ui, db]),
) as Record<PatientSession['status'], string>;

const URGENCY_DB_TO_UI: Record<string, PatientSession['urgencyLevel']> = {
  routine: 'Routine', urgent: 'Urgent', critical_bypass: 'CRITICAL_BYPASS',
};
export const URGENCY_UI_TO_DB: Record<PatientSession['urgencyLevel'], string> = {
  Routine: 'routine', Urgent: 'urgent', CRITICAL_BYPASS: 'critical_bypass',
};

function docTypeFor(label: string): UploadedFile['fileType'] {
  if (label === 'xray') return 'XRay';
  if (label === 'report') return 'BloodReport';
  return 'Other';
}

export function assemblePatientSession(
  patient: PatientRow,
  opts: {
    encounter?: EncounterRow | null;
    practitioner?: PractitionerRow | null;
    prescription?: PrescriptionRow | null;
    ledger?: WardBillingLedgerRow[];
    documents?: DocumentRow[];
  } = {},
): PatientSession {
  const { encounter = null, practitioner = null, prescription = null, ledger = [], documents = [] } = opts;
  const ledgerTotal = ledger.reduce((sum, l) => sum + Number(l.amount), 0);
  const pharmacyBillTotal = (prescription?.items ?? []).reduce((sum, i) => sum + (i.price || 0), 0);
  const clinicalNote = encounter?.clinical_note;
  return {
    sessionId: patient.id,
    encounterId: encounter?.id ?? null,
    patientName: patient.name,
    phone: patient.phone ?? '',
    age: patient.age ?? 0,
    gender: (patient.gender === 'Male' || patient.gender === 'Female' ? patient.gender : 'Other'),
    status: STATUS_DB_TO_UI[patient.queue_status] ?? 'Scheduled',
    urgencyLevel: URGENCY_DB_TO_UI[patient.urgency_level] ?? 'Routine',
    serviceType: encounter?.setting === 'ward' ? 'Inpatient Ward Admission' : 'Outpatient Consultation',
    assignedDoctorId: patient.assigned_practitioner_id,
    assignedDoctor: practitioner ? practitioner.name : '',
    triage: {
      height: patient.triage?.height ?? 0,
      weight: patient.triage?.weight ?? 0,
      bloodPressure: patient.triage?.bloodPressure ?? '',
      pulseRate: patient.triage?.pulseRate ?? 0,
      complaints: patient.triage?.complaints ?? '',
      uploadedFiles: documents.map((d) => ({
        fileId: d.id, fileName: d.file_name, fileType: docTypeFor(d.label), url: d.storage_path,
      })),
    },
    aiGuidedIntake: {
      rawTranscriptStream: patient.intake_state?.rawTranscriptStream ?? '',
      completenessCheck: patient.intake_state?.completenessCheck ?? {
        identity: false, complaint: false, timeline: false, reports: false,
      },
      doctorQueryActive: patient.intake_state?.doctorQueryActive ?? false,
      doctorQueryNote: patient.intake_state?.doctorQueryNote ?? '',
      doctorResponseClearance: patient.intake_state?.doctorResponseClearance ?? '',
    },
    clinicalNotes: {
      soapSummary: clinicalNote?.soapSummary ?? { history: '', examination: [], assessment: [], plan: '' },
      prescriptions: prescription?.items ?? [],
      rehabExercises: clinicalNote?.rehabExercises ?? [],
      precautions: clinicalNote?.precautions ?? [],
      dosAndDonts: clinicalNote?.dosAndDonts ?? [],
      lastUpdatedBy: clinicalNote?.lastUpdatedBy ?? '',
      timestamp: clinicalNote?.timestamp ?? '',
    },
    billing: {
      baseConsultationFee: encounter?.consultation_fee ?? practitioner?.consult_fee ?? 0,
      wardStayDays: ledger.length ? Math.max(1, new Set(ledger.map((l) => l.created_at.slice(0, 10))).size) : 0,
      accumulatedInpatientCharges: ledgerTotal,
      pharmacyBillTotal,
      paymentStatus: encounter?.payment_status === 'paid' ? 'Paid'
        : encounter?.payment_status === 'ledger_locked' ? 'Inpatient Ledger Locked' : 'Unpaid',
      billingNotes: encounter?.billing_notes ?? '',
    },
  };
}
