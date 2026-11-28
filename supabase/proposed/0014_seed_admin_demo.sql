-- 0014 — Demo price list and wards/beds for org1 "Naad Demo Hospital" (fictional).
--
-- Why: v0.6.0 put the admin's price list and wards-and-beds screens live, but
-- the live demo hospital has no charges and no beds, so both screens start
-- empty and reception's bill falls back to a few built-in charges. This loads
-- the same set-up the demo build shows: 14 charges (1 retired) and 17 beds
-- in four wards, with the admitted demo patients (p-ramesh, p-suresh, p-lata) in their beds.
--
-- Data only, no schema change. Only org1 is touched; no existing row is
-- changed. A patient is only put in a bed if they are still admitted or
-- waiting for discharge clearance when this runs. Admission dates are shifted
-- like the rest of the demo (relative to 2026-08-29). Safe to re-run:
-- existing ids are skipped.
--
-- Generated from src/mock/adminSeed.ts.
--
-- Rollback:
--   delete from public.beds where org_id = 'org1' and id in ('bed-g1', 'bed-g2', 'bed-g3', 'bed-g4', 'bed-g5', 'bed-g6', 'bed-g7', 'bed-g8', 'bed-p1', 'bed-p2', 'bed-p3', 'bed-p4', 'bed-i1', 'bed-i2', 'bed-i3', 'bed-d1', 'bed-d2');
--   delete from public.service_rates where org_id = 'org1' and id in ('rt-reg', 'rt-xray', 'rt-mri', 'rt-ecg', 'rt-cbc', 'rt-dress', 'rt-plaster', 'rt-inj', 'rt-physio', 'rt-physio8', 'rt-ward', 'rt-private', 'rt-icu', 'rt-old');

insert into public.service_rates (id, org_id, name, category, amount, active) values
  ('rt-reg', 'org1', 'Registration', 'other', 100, true),
  ('rt-xray', 'org1', 'X-ray (2 views)', 'investigation', 450, true),
  ('rt-mri', 'org1', 'MRI, one joint', 'investigation', 5500, true),
  ('rt-ecg', 'org1', 'ECG', 'investigation', 300, true),
  ('rt-cbc', 'org1', 'Blood test, CBC', 'investigation', 350, true),
  ('rt-dress', 'org1', 'Dressing', 'procedure', 200, true),
  ('rt-plaster', 'org1', 'Plaster cast, below knee', 'procedure', 1800, true),
  ('rt-inj', 'org1', 'Joint injection', 'procedure', 1200, true),
  ('rt-physio', 'org1', 'Physiotherapy session', 'therapy', 600, true),
  ('rt-physio8', 'org1', 'Physiotherapy package, 8 sessions', 'therapy', 4400, true),
  ('rt-ward', 'org1', 'General ward, per day', 'ward', 1500, true),
  ('rt-private', 'org1', 'Private room, per day', 'ward', 3500, true),
  ('rt-icu', 'org1', 'ICU, per day', 'ward', 9000, true),
  ('rt-old', 'org1', 'Old X-ray rate (retired)', 'investigation', 400, false)
on conflict (id) do nothing;

insert into public.beds (id, org_id, ward, label, kind, daily_rate, active, patient_id, occupied_since)
select v.id, 'org1', v.ward, v.label, v.kind, v.daily_rate, true, p.id, case when p.id is not null then v.since end
from (values
  ('bed-g1', 'General Ward', 'G-1', 'general', 1500, null, null),
  ('bed-g2', 'General Ward', 'G-2', 'general', 1500, 'p-ramesh', timestamptz '2026-08-25T06:00:00Z' + (current_date - date '2026-08-29') * interval '1 day'),
  ('bed-g3', 'General Ward', 'G-3', 'general', 1500, null, null),
  ('bed-g4', 'General Ward', 'G-4', 'general', 1500, null, null),
  ('bed-g5', 'General Ward', 'G-5', 'general', 1500, 'p-suresh', timestamptz '2026-08-27T09:00:00Z' + (current_date - date '2026-08-29') * interval '1 day'),
  ('bed-g6', 'General Ward', 'G-6', 'general', 1500, null, null),
  ('bed-g7', 'General Ward', 'G-7', 'general', 1500, null, null),
  ('bed-g8', 'General Ward', 'G-8', 'general', 1500, null, null),
  ('bed-p1', 'Private Rooms', 'P-1', 'private', 3500, 'p-lata', timestamptz '2026-08-20T08:00:00Z' + (current_date - date '2026-08-29') * interval '1 day'),
  ('bed-p2', 'Private Rooms', 'P-2', 'private', 3500, null, null),
  ('bed-p3', 'Private Rooms', 'P-3', 'private', 3500, null, null),
  ('bed-p4', 'Private Rooms', 'P-4', 'private', 3500, null, null),
  ('bed-i1', 'ICU', 'ICU-1', 'icu', 9000, null, null),
  ('bed-i2', 'ICU', 'ICU-2', 'icu', 9000, null, null),
  ('bed-i3', 'ICU', 'ICU-3', 'icu', 9000, null, null),
  ('bed-d1', 'Day Care', 'D-1', 'day_care', 800, null, null),
  ('bed-d2', 'Day Care', 'D-2', 'day_care', 800, null, null)
) as v (id, ward, label, kind, daily_rate, patient_id, since)
left join public.patients p on p.id = v.patient_id and p.org_id = 'org1' and p.queue_status in ('admitted', 'pending_discharge_clearance')
on conflict (id) do nothing;
