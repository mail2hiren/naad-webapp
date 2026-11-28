-- 0018 — Demo test results and documents for the patient app, org1 "Naad Demo Hospital" (fictional).
--
-- Why: v0.8.0 put the patient app live, but the patients who can sign in
-- (Ramesh, Kavita, Deepak) have no test results or documents on the live
-- site, so the Reports tab is nearly empty and the Home alert for a noted
-- result never shows. This loads what the demo build shows: 5 tests
-- (one still awaiting its result, one the doctor flagged) and 4 documents.
--
-- Data only, no schema change. Only org1 is touched; no existing row is
-- changed. Rows are only added for patients that exist. Dates are shifted
-- like the rest of the demo (relative to 2026-08-29). The documents are
-- listed only (storage_path 'demo/...'); there are no files behind them.
-- Safe to re-run: existing ids are skipped.
--
-- Generated from src/mock/patientSeed.ts.
--
-- Rollback:
--   delete from public.lab_orders where org_id = 'org1' and id in ('lab-r1', 'lab-r2', 'lab-r3', 'lab-k1', 'lab-d1');
--   delete from public.documents where org_id = 'org1' and id in ('doc-r1', 'doc-r2', 'doc-k1', 'doc-d1');

insert into public.lab_orders (id, org_id, patient_id, encounter_id, ordered_by, test_name, test_type, urgency, status, notes, result_summary, flagged, ordered_at, reviewed_by, reviewed_at)
select v.id, 'org1', p.id, null, v.ordered_by, v.test_name, v.test_type, v.urgency, v.status, null, v.result_summary, v.flagged, v.ordered_at, v.reviewed_by, v.reviewed_at
from (values
  ('lab-r1', 'p-ramesh', 'pr-surgeon', 'X-ray, right hip (2 views)', 'xray', 'routine', 'reviewed', 'Hip replacement components well placed. No fracture or loosening.', false, timestamptz '2026-08-26T04:00:00Z' + (current_date - date '2026-08-29') * interval '1 day', 'pr-surgeon', timestamptz '2026-08-26T09:00:00Z' + (current_date - date '2026-08-29') * interval '1 day'),
  ('lab-r2', 'p-ramesh', 'pr-surgeon', 'Complete blood count', 'blood', 'routine', 'reviewed', 'Haemoglobin 10.8 g/dL, a little low after surgery. Iron tablets started.', true, timestamptz '2026-08-27T04:00:00Z' + (current_date - date '2026-08-29') * interval '1 day', 'pr-surgeon', timestamptz '2026-08-27T09:00:00Z' + (current_date - date '2026-08-29') * interval '1 day'),
  ('lab-r3', 'p-ramesh', 'pr-surgeon', 'Blood sugar, fasting', 'blood', 'routine', 'ordered', null, false, timestamptz '2026-08-29T03:30:00Z' + (current_date - date '2026-08-29') * interval '1 day', null, null),
  ('lab-k1', 'p-kavita', 'pr-surgeon', 'MRI, lower back', 'mri', 'routine', 'reviewed', 'Mild disc bulge at L4-L5, no nerve compression. Suits physiotherapy.', false, timestamptz '2026-08-02T04:00:00Z' + (current_date - date '2026-08-29') * interval '1 day', 'pr-surgeon', timestamptz '2026-08-02T09:00:00Z' + (current_date - date '2026-08-29') * interval '1 day'),
  ('lab-d1', 'p-deepak', 'pr-surgeon', 'X-ray, right knee', 'xray', 'routine', 'reviewed', 'Knee replacement well aligned. Healing as expected.', false, timestamptz '2026-08-12T04:00:00Z' + (current_date - date '2026-08-29') * interval '1 day', 'pr-surgeon', timestamptz '2026-08-12T09:00:00Z' + (current_date - date '2026-08-29') * interval '1 day')
) as v (id, patient_id, ordered_by, test_name, test_type, urgency, status, result_summary, flagged, ordered_at, reviewed_by, reviewed_at)
join public.patients p on p.id = v.patient_id and p.org_id = 'org1'
on conflict (id) do nothing;

insert into public.documents (id, org_id, patient_id, label, file_name, storage_path, content_type, size_bytes, uploaded_by, uploaded_at)
select v.id, 'org1', p.id, v.label, v.file_name, v.storage_path, v.content_type, v.size_bytes, v.uploaded_by, v.uploaded_at
from (values
  ('doc-r1', 'p-ramesh', 'xray', 'Hip_xray_26Aug.pdf', 'demo/Hip_xray_26Aug.pdf', 'application/pdf', 120000, 'Sunita Kulkarni', timestamptz '2026-08-26T06:00:00Z' + (current_date - date '2026-08-29') * interval '1 day'),
  ('doc-r2', 'p-ramesh', 'report', 'CBC_27Aug.pdf', 'demo/CBC_27Aug.pdf', 'application/pdf', 120000, 'Sunita Kulkarni', timestamptz '2026-08-27T08:00:00Z' + (current_date - date '2026-08-29') * interval '1 day'),
  ('doc-k1', 'p-kavita', 'report', 'MRI_lumbar_spine.pdf', 'demo/MRI_lumbar_spine.pdf', 'application/pdf', 120000, 'Sunita Kulkarni', timestamptz '2026-08-02T07:00:00Z' + (current_date - date '2026-08-29') * interval '1 day'),
  ('doc-d1', 'p-deepak', 'report', 'Discharge_summary_knee.pdf', 'demo/Discharge_summary_knee.pdf', 'application/pdf', 120000, 'Sunita Kulkarni', timestamptz '2026-08-12T07:00:00Z' + (current_date - date '2026-08-29') * interval '1 day')
) as v (id, patient_id, label, file_name, storage_path, content_type, size_bytes, uploaded_by, uploaded_at)
join public.patients p on p.id = v.patient_id and p.org_id = 'org1'
on conflict (id) do nothing;
