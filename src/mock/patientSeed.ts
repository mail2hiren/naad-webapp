import type { DocumentRow, LabOrderRow } from '../types/db';
import { ORG_ID } from './seed';

/** Demo reports for the patient app (Phase 6): test results and documents
 * for the demo patients who can sign in (Ramesh, Kavita, Deepak). */

const lab = (id: string, patientId: string, test: string, type: string, status: string, at: string, summary: string | null, flagged = false): LabOrderRow => ({
  id, org_id: ORG_ID, patient_id: patientId, encounter_id: null, ordered_by: 'Dr. Sagar Karvir', test_name: test, test_type: type, urgency: 'routine',
  status, notes: null, result_document_id: null, result_summary: summary, flagged, ordered_at: at,
  reviewed_by: summary ? 'Dr. Sagar Karvir' : null, reviewed_at: summary ? at.replace('T04', 'T09') : null,
});

export const labOrders: LabOrderRow[] = [
  lab('lab-r1', 'p-ramesh', 'X-ray, right hip (2 views)', 'imaging', 'reviewed', '2026-08-26T04:00:00Z', 'Hip replacement components well placed. No fracture or loosening.'),
  lab('lab-r2', 'p-ramesh', 'Complete blood count', 'blood', 'reviewed', '2026-08-27T04:00:00Z', 'Haemoglobin 10.8 g/dL, a little low after surgery. Iron tablets started.', true),
  lab('lab-r3', 'p-ramesh', 'Blood sugar, fasting', 'blood', 'ordered', '2026-08-29T03:30:00Z', null),
  lab('lab-k1', 'p-kavita', 'MRI, lower back', 'imaging', 'reviewed', '2026-08-02T04:00:00Z', 'Mild disc bulge at L4-L5, no nerve compression. Suits physiotherapy.'),
  lab('lab-d1', 'p-deepak', 'X-ray, right knee', 'imaging', 'reviewed', '2026-08-12T04:00:00Z', 'Knee replacement well aligned. Healing as expected.'),
];

const doc = (id: string, patientId: string, label: DocumentRow['label'], file: string, at: string): DocumentRow => ({
  id, org_id: ORG_ID, patient_id: patientId, label, file_name: file, storage_path: `demo/${file}`, content_type: 'application/pdf',
  size_bytes: 120000, uploaded_by: 'Sunita Kulkarni', uploaded_at: at,
});

export const documents: DocumentRow[] = [
  doc('doc-r1', 'p-ramesh', 'xray', 'Hip_xray_26Aug.pdf', '2026-08-26T06:00:00Z'),
  doc('doc-r2', 'p-ramesh', 'report', 'CBC_27Aug.pdf', '2026-08-27T08:00:00Z'),
  doc('doc-k1', 'p-kavita', 'report', 'MRI_lumbar_spine.pdf', '2026-08-02T07:00:00Z'),
  doc('doc-d1', 'p-deepak', 'report', 'Discharge_summary_knee.pdf', '2026-08-12T07:00:00Z'),
];
