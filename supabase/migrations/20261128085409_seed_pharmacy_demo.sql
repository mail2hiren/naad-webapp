-- 0016 — Demo pharmacy stock and ward vitals for org1 "Naad Demo Hospital" (fictional).
--
-- Why: v0.7.0 put pharmacy stock by batch, dispensing with billing and ward
-- vitals live, but the live demo hospital has 4 medicines with no batches
-- (so dispensing finds no stock) and no vitals. This loads what the demo
-- build shows: 8 more medicines so every prescribed demo medicine is
-- stocked, 15 batches for all 12 (some expiring within 90 days, one
-- expired, a few items at or below reorder level), and 9 vital-sign
-- readings for the three ward patients (Suresh with a rising fever).
--
-- Data only, no schema change. Only org1 is touched. The 4 existing
-- medicines keep their rows and stock totals (their new batches add up to the
-- same numbers); new medicines are matched by name and skipped if present.
-- Expiry and reading dates are shifted like the rest of the demo (relative to
-- 2026-08-29). Vitals are only added for patients still on the ward. Safe to
-- re-run: existing batch and reading ids are skipped.
--
-- Generated from src/mock/pharmacySeed.ts.
--
-- Rollback:
--   delete from public.vitals where org_id = 'org1' and id in ('vt-r1', 'vt-r2', 'vt-r3', 'vt-r4', 'vt-s1', 'vt-s2', 'vt-s3', 'vt-l1', 'vt-l2');
--   delete from public.stock_batches where org_id = 'org1' and id in ('sb-1', 'sb-2', 'sb-3', 'sb-4', 'sb-5', 'sb-6', 'sb-7', 'sb-8', 'sb-9', 'sb-10', 'sb-11', 'sb-12', 'sb-13', 'sb-14', 'sb-15');
--   delete from public.inventory where org_id = 'org1' and drug in ('Etoricoxib 90mg', 'Aspirin 75mg', 'Tramadol 50mg', 'Diclofenac Gel 1%', 'Paracetamol 650mg', 'Pantoprazole 40mg', 'Atorvastatin 20mg', 'Rabeprazole 20mg');

insert into public.inventory (org_id, drug, stock, unit, low, alternates)
select v.* from (values
  ('org1', 'Etoricoxib 90mg', 140, 'tablets', 20, array['Celecoxib 200mg']::text[]),
  ('org1', 'Aspirin 75mg', 300, 'tablets', 30, array[]::text[]),
  ('org1', 'Tramadol 50mg', 60, 'tablets', 20, array[]::text[]),
  ('org1', 'Diclofenac Gel 1%', 12, 'tubes', 5, array[]::text[]),
  ('org1', 'Paracetamol 650mg', 440, 'tablets', 50, array[]::text[]),
  ('org1', 'Pantoprazole 40mg', 25, 'tablets', 30, array['Rabeprazole 20mg']::text[]),
  ('org1', 'Atorvastatin 20mg', 90, 'tablets', 30, array[]::text[]),
  ('org1', 'Rabeprazole 20mg', 50, 'tablets', 20, array[]::text[])
) as v (org_id, drug, stock, unit, low, alternates)
where not exists (select 1 from public.inventory x where x.org_id = 'org1' and x.drug = v.drug);

insert into public.stock_batches (id, org_id, inventory_id, batch_no, expiry, qty, mrp, supplier, received_at, received_by)
select v.id, 'org1', i.id, v.batch_no, v.expiry, v.qty, v.mrp, v.supplier, v.received_at, v.received_by
from (values
  ('sb-1', 'Ibuprofen 400mg', 'IBU-2611', date '2026-11-10' + (current_date - date '2026-08-29'), 30, 3, 'Pune Pharma Distributors', timestamptz '2026-02-11T05:00:00Z' + (current_date - date '2026-08-29') * interval '1 day', 'Vikram Shah'),
  ('sb-2', 'Ibuprofen 400mg', 'IBU-2705', date '2027-05-31' + (current_date - date '2026-08-29'), 10, 3, 'Pune Pharma Distributors', timestamptz '2026-03-12T05:00:00Z' + (current_date - date '2026-08-29') * interval '1 day', 'Vikram Shah'),
  ('sb-3', 'Salbutamol Nebulization 2.5mg', 'SAL-2612', date '2026-12-31' + (current_date - date '2026-08-29'), 3, 22, 'Pune Pharma Distributors', timestamptz '2026-04-13T05:00:00Z' + (current_date - date '2026-08-29') * interval '1 day', 'Vikram Shah'),
  ('sb-4', 'Amoxicillin 500mg', 'AMX-2703', date '2027-03-31' + (current_date - date '2026-08-29'), 60, 9, 'Pune Pharma Distributors', timestamptz '2026-05-14T05:00:00Z' + (current_date - date '2026-08-29') * interval '1 day', 'Vikram Shah'),
  ('sb-5', 'Calcium + Vitamin D3', 'CAD-2610', date '2026-10-15' + (current_date - date '2026-08-29'), 2, 18, 'Pune Pharma Distributors', timestamptz '2026-06-15T05:00:00Z' + (current_date - date '2026-08-29') * interval '1 day', 'Vikram Shah'),
  ('sb-6', 'Etoricoxib 90mg', 'ETO-2702', date '2027-02-28' + (current_date - date '2026-08-29'), 100, 12, 'Pune Pharma Distributors', timestamptz '2026-07-16T05:00:00Z' + (current_date - date '2026-08-29') * interval '1 day', 'Vikram Shah'),
  ('sb-7', 'Etoricoxib 90mg', 'ETO-2610', date '2026-10-31' + (current_date - date '2026-08-29'), 40, 12, 'Pune Pharma Distributors', timestamptz '2026-01-17T05:00:00Z' + (current_date - date '2026-08-29') * interval '1 day', 'Vikram Shah'),
  ('sb-8', 'Aspirin 75mg', 'ASP-2709', date '2027-09-30' + (current_date - date '2026-08-29'), 300, 5, 'Pune Pharma Distributors', timestamptz '2026-02-18T05:00:00Z' + (current_date - date '2026-08-29') * interval '1 day', 'Vikram Shah'),
  ('sb-9', 'Tramadol 50mg', 'TRM-2704', date '2027-04-30' + (current_date - date '2026-08-29'), 60, 10, 'Pune Pharma Distributors', timestamptz '2026-03-10T05:00:00Z' + (current_date - date '2026-08-29') * interval '1 day', 'Vikram Shah'),
  ('sb-10', 'Diclofenac Gel 1%', 'DCG-2611', date '2026-11-30' + (current_date - date '2026-08-29'), 12, 90, 'Pune Pharma Distributors', timestamptz '2026-04-11T05:00:00Z' + (current_date - date '2026-08-29') * interval '1 day', 'Vikram Shah'),
  ('sb-11', 'Paracetamol 650mg', 'PCM-2608', date '2026-08-15' + (current_date - date '2026-08-29'), 40, 2, 'Pune Pharma Distributors', timestamptz '2026-05-12T05:00:00Z' + (current_date - date '2026-08-29') * interval '1 day', 'Vikram Shah'),
  ('sb-12', 'Paracetamol 650mg', 'PCM-2706', date '2027-06-30' + (current_date - date '2026-08-29'), 400, 2, 'Pune Pharma Distributors', timestamptz '2026-06-13T05:00:00Z' + (current_date - date '2026-08-29') * interval '1 day', 'Vikram Shah'),
  ('sb-13', 'Pantoprazole 40mg', 'PAN-2703', date '2027-03-31' + (current_date - date '2026-08-29'), 25, 8, 'Pune Pharma Distributors', timestamptz '2026-07-14T05:00:00Z' + (current_date - date '2026-08-29') * interval '1 day', 'Vikram Shah'),
  ('sb-14', 'Atorvastatin 20mg', 'ATV-2801', date '2028-01-31' + (current_date - date '2026-08-29'), 90, 11, 'Pune Pharma Distributors', timestamptz '2026-01-15T05:00:00Z' + (current_date - date '2026-08-29') * interval '1 day', 'Vikram Shah'),
  ('sb-15', 'Rabeprazole 20mg', 'RAB-2709', date '2027-09-30' + (current_date - date '2026-08-29'), 50, 9, 'Pune Pharma Distributors', timestamptz '2026-02-16T05:00:00Z' + (current_date - date '2026-08-29') * interval '1 day', 'Vikram Shah')
) as v (id, drug, batch_no, expiry, qty, mrp, supplier, received_at, received_by)
join public.inventory i on i.org_id = 'org1' and i.drug = v.drug
on conflict (id) do nothing;

insert into public.vitals (id, org_id, patient_id, taken_at, bp_systolic, bp_diastolic, pulse, temp_c, spo2, resp_rate, pain, note, recorded_by)
select v.id, 'org1', p.id, v.taken_at, v.sys, v.dia, v.pulse, v.temp, v.spo2, v.rr, v.pain, v.note, v.recorded_by
from (values
  ('vt-r1', 'p-ramesh', timestamptz '2026-08-26T03:00:00Z' + (current_date - date '2026-08-29') * interval '1 day', 142, 88, 96, 37.9, 95, 20, 6, 'Day 1 after surgery', 'Dr. Sagar Karvir'),
  ('vt-r2', 'p-ramesh', timestamptz '2026-08-27T03:00:00Z' + (current_date - date '2026-08-29') * interval '1 day', 136, 84, 88, 37.4, 96, 18, 5, null, 'Dr. Sagar Karvir'),
  ('vt-r3', 'p-ramesh', timestamptz '2026-08-28T03:00:00Z' + (current_date - date '2026-08-29') * interval '1 day', 130, 82, 82, 37, 97, 16, 4, null, 'Dr. Sagar Karvir'),
  ('vt-r4', 'p-ramesh', timestamptz '2026-08-29T03:00:00Z' + (current_date - date '2026-08-29') * interval '1 day', 128, 80, 78, 36.8, 98, 16, 3, 'Walking with walker', 'Dr. Sagar Karvir'),
  ('vt-s1', 'p-suresh', timestamptz '2026-08-28T03:00:00Z' + (current_date - date '2026-08-29') * interval '1 day', 134, 86, 92, 37.6, 96, 18, 5, null, 'Dr. Sagar Karvir'),
  ('vt-s2', 'p-suresh', timestamptz '2026-08-28T13:00:00Z' + (current_date - date '2026-08-29') * interval '1 day', 138, 88, 104, 38.1, 95, 20, 6, 'Low-grade fever, wound reviewed', 'Dr. Sagar Karvir'),
  ('vt-s3', 'p-suresh', timestamptz '2026-08-29T03:00:00Z' + (current_date - date '2026-08-29') * interval '1 day', 140, 90, 112, 38.4, 93, 24, 6, 'Fever persisting; blood cultures sent', 'Dr. Sagar Karvir'),
  ('vt-l1', 'p-lata', timestamptz '2026-08-28T03:00:00Z' + (current_date - date '2026-08-29') * interval '1 day', 124, 78, 76, 36.7, 98, 16, 2, null, 'Dr. Sagar Karvir'),
  ('vt-l2', 'p-lata', timestamptz '2026-08-29T03:00:00Z' + (current_date - date '2026-08-29') * interval '1 day', 122, 76, 74, 36.6, 98, 15, 1, 'Ready for discharge', 'Dr. Sagar Karvir')
) as v (id, patient_id, taken_at, sys, dia, pulse, temp, spo2, rr, pain, note, recorded_by)
join public.patients p on p.id = v.patient_id and p.org_id = 'org1' and p.queue_status in ('admitted', 'pending_discharge_clearance')
on conflict (id) do nothing;
