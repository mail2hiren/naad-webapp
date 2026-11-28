-- 0012 — Demo front-desk day for org1 "Naad Demo Hospital" (fictional).
--
-- Why: v0.5.0 put the reception calendar, tokens and billing live, but the
-- live demo hospital has 2 appointments and no bills, so the screens look
-- empty. This loads the same day the demo build shows: by mid-morning two
-- patients seen (one billed), six checked in with tokens, one no-show, the
-- rest of the day booked, cancelled or requested from the patient app, two
-- follow-ups on the next working day, and three bills including a part-paid
-- physiotherapy package.
--
-- Data only, no schema change. Only org1 is touched. Adds 3 demo patients
-- (is_demo = true), 14 appointments and 3 bills. Existing rows are not
-- changed, except: the hospital's street address and phone are filled in for
-- the receipt header, only where they are empty.
--
-- Dates: the demo day becomes the day this runs (times are IST 09:30
-- onwards, stored as UTC); the follow-ups land on the next working day.
-- Run it on a working day (Mon-Sat). It is a snapshot: tomorrow it is
-- yesterday's clinic. Safe to re-run: existing ids are skipped.
--
-- Generated from src/mock/receptionSeed.ts.
--
-- Rollback:
--   delete from public.bills where org_id = 'org1' and id in ('bill-1', 'bill-2', 'bill-3');
--   delete from public.appointments where org_id = 'org1' and id in ('ap-s1', 'ap-s2', 'ap-s3', 'ap-s4', 'ap-s5', 'ap-s6', 'ap-s7', 'ap-s8', 'ap-n1', 'ap-n2', 'ap-p1', 'ap-p2', 'ap-m1', 'ap-m2');
--   delete from public.patients where org_id = 'org1' and id in ('p-anil', 'p-sunanda', 'p-imran');

update public.organizations
  set address = coalesce(nullif(address, ''), 'FC Road, Pune'), contact_phone = coalesce(nullif(contact_phone, ''), '+91 20 4000 1234')
  where id = 'org1';

insert into public.patients (id, org_id, mrn, name, age, gender, phone, queue_status, urgency_level, assigned_practitioner_id, phone_verified, triage, is_demo) values
  ('p-anil', 'org1', 'DGY-1012', 'Anil Gokhale', 47, 'Male', '98221 40551', 'done', 'routine', 'pr-surgeon', true, '{"complaints":"Low back pain after lifting, 1 week."}'::jsonb, true),
  ('p-sunanda', 'org1', 'DGY-1013', 'Sunanda Patil', 55, 'Female', '99600 21874', 'done', 'routine', 'pr-surgeon', true, '{"complaints":"Frozen shoulder review."}'::jsonb, true),
  ('p-imran', 'org1', 'DGY-1014', 'Imran Shaikh', 36, 'Male', '98500 66120', 'new', 'routine', 'pr-surgeon', true, '{"complaints":"Ankle sprain, playing football."}'::jsonb, true)
on conflict (id) do nothing;

insert into public.appointments (id, org_id, patient_id, practitioner_id, specialty, date, start_time, duration_minutes, status, reason, requested_by_patient, token_no, checked_in_at, cancel_reason, visit_type, rescheduled_from, booked_by) values
  ('ap-s1', 'org1', 'p-anil', 'pr-surgeon', 'Orthopedics', timestamptz '2026-08-29T04:00:00Z' + (current_date - date '2026-08-29') * interval '1 day', timestamptz '2026-08-29T04:00:00Z' + (current_date - date '2026-08-29') * interval '1 day', 15, 'completed', 'Low back pain after lifting', false, 1, timestamptz '2026-08-29T03:52:00Z' + (current_date - date '2026-08-29') * interval '1 day', null, 'consultation', null, 'Sunita Kulkarni'),
  ('ap-s2', 'org1', 'p-sunanda', 'pr-surgeon', 'Orthopedics', timestamptz '2026-08-29T04:15:00Z' + (current_date - date '2026-08-29') * interval '1 day', timestamptz '2026-08-29T04:15:00Z' + (current_date - date '2026-08-29') * interval '1 day', 15, 'completed', 'Frozen shoulder review', false, 2, timestamptz '2026-08-29T04:10:00Z' + (current_date - date '2026-08-29') * interval '1 day', null, 'follow_up', null, 'Sunita Kulkarni'),
  ('ap-s3', 'org1', 'p-meera', 'pr-surgeon', 'Orthopedics', timestamptz '2026-08-29T04:30:00Z' + (current_date - date '2026-08-29') * interval '1 day', timestamptz '2026-08-29T04:30:00Z' + (current_date - date '2026-08-29') * interval '1 day', 15, 'checked_in', 'Pre-operative assessment', false, 3, timestamptz '2026-08-29T04:22:00Z' + (current_date - date '2026-08-29') * interval '1 day', null, 'consultation', null, 'Sunita Kulkarni'),
  ('ap-s4', 'org1', 'p-neha', 'pr-surgeon', 'Orthopedics', timestamptz '2026-08-29T04:45:00Z' + (current_date - date '2026-08-29') * interval '1 day', timestamptz '2026-08-29T04:45:00Z' + (current_date - date '2026-08-29') * interval '1 day', 15, 'checked_in', 'Wrist pain', false, 4, timestamptz '2026-08-29T04:40:00Z' + (current_date - date '2026-08-29') * interval '1 day', null, 'consultation', null, 'Sunita Kulkarni'),
  ('ap-s5', 'org1', 'p-imran', 'pr-surgeon', 'Orthopedics', timestamptz '2026-08-29T05:15:00Z' + (current_date - date '2026-08-29') * interval '1 day', timestamptz '2026-08-29T05:15:00Z' + (current_date - date '2026-08-29') * interval '1 day', 15, 'no_show', 'Ankle sprain', false, null, null, null, 'consultation', null, 'Sunita Kulkarni'),
  ('ap-s6', 'org1', 'p-deepak', 'pr-surgeon', 'Orthopedics', timestamptz '2026-08-29T06:00:00Z' + (current_date - date '2026-08-29') * interval '1 day', timestamptz '2026-08-29T06:00:00Z' + (current_date - date '2026-08-29') * interval '1 day', 15, 'scheduled', 'Knee replacement review, 10 weeks', false, null, null, null, 'follow_up', null, 'Sunita Kulkarni'),
  ('ap-s7', 'org1', 'p-ramesh', 'pr-surgeon', 'Orthopedics', timestamptz '2026-08-29T11:00:00Z' + (current_date - date '2026-08-29') * interval '1 day', timestamptz '2026-08-29T11:00:00Z' + (current_date - date '2026-08-29') * interval '1 day', 15, 'cancelled', 'Hip review', false, null, null, 'Admitted on the ward; reviewed there', 'follow_up', null, 'Sunita Kulkarni'),
  ('ap-s8', 'org1', 'p-lata', 'pr-surgeon', 'Orthopedics', timestamptz '2026-08-29T11:30:00Z' + (current_date - date '2026-08-29') * interval '1 day', timestamptz '2026-08-29T11:30:00Z' + (current_date - date '2026-08-29') * interval '1 day', 15, 'requested', 'Requested from the patient app', true, null, null, null, 'follow_up', null, null),
  ('ap-n1', 'org1', 'p-arjun', 'pr-namrata', 'Critical Care', timestamptz '2026-08-29T04:30:00Z' + (current_date - date '2026-08-29') * interval '1 day', timestamptz '2026-08-29T04:30:00Z' + (current_date - date '2026-08-29') * interval '1 day', 15, 'checked_in', 'Palpitations', false, 1, timestamptz '2026-08-29T04:25:00Z' + (current_date - date '2026-08-29') * interval '1 day', null, 'consultation', null, 'Sunita Kulkarni'),
  ('ap-n2', 'org1', 'p-farah', 'pr-namrata', 'Critical Care', timestamptz '2026-08-29T04:45:00Z' + (current_date - date '2026-08-29') * interval '1 day', timestamptz '2026-08-29T04:45:00Z' + (current_date - date '2026-08-29') * interval '1 day', 15, 'checked_in', 'Breathlessness, diabetic', false, 2, timestamptz '2026-08-29T04:41:00Z' + (current_date - date '2026-08-29') * interval '1 day', null, 'consultation', null, 'Sunita Kulkarni'),
  ('ap-p1', 'org1', 'p-rohan', 'pr-physio', 'Physiotherapy', timestamptz '2026-08-29T04:00:00Z' + (current_date - date '2026-08-29') * interval '1 day', timestamptz '2026-08-29T04:00:00Z' + (current_date - date '2026-08-29') * interval '1 day', 30, 'checked_in', 'ACL rehab session', false, 1, timestamptz '2026-08-29T03:58:00Z' + (current_date - date '2026-08-29') * interval '1 day', null, 'therapy', null, 'Sunita Kulkarni'),
  ('ap-p2', 'org1', 'p-kavita', 'pr-physio', 'Physiotherapy', timestamptz '2026-08-29T04:30:00Z' + (current_date - date '2026-08-29') * interval '1 day', timestamptz '2026-08-29T04:30:00Z' + (current_date - date '2026-08-29') * interval '1 day', 30, 'checked_in', 'Low back pain session', false, 2, timestamptz '2026-08-29T04:26:00Z' + (current_date - date '2026-08-29') * interval '1 day', null, 'therapy', null, 'Sunita Kulkarni'),
  ('ap-m1', 'org1', 'p-suresh', 'pr-surgeon', 'Orthopedics', ((current_date + 2 + case when extract(dow from current_date + 2) = 0 then 1 else 0 end)::timestamp + time '04:30:00') at time zone 'UTC', ((current_date + 2 + case when extract(dow from current_date + 2) = 0 then 1 else 0 end)::timestamp + time '04:30:00') at time zone 'UTC', 15, 'scheduled', 'Post-discharge review', false, null, null, null, 'follow_up', null, 'Sunita Kulkarni'),
  ('ap-m2', 'org1', 'p-anil', 'pr-surgeon', 'Orthopedics', ((current_date + 2 + case when extract(dow from current_date + 2) = 0 then 1 else 0 end)::timestamp + time '05:00:00') at time zone 'UTC', ((current_date + 2 + case when extract(dow from current_date + 2) = 0 then 1 else 0 end)::timestamp + time '05:00:00') at time zone 'UTC', 15, 'scheduled', 'Back pain review', false, null, null, null, 'follow_up', null, 'Sunita Kulkarni')
on conflict (id) do nothing;

insert into public.bills (id, org_id, number, patient_id, appointment_id, items, subtotal, discount, total, paid, payment_method, status, created_by, created_at, paid_at) values
  ('bill-1', 'org1', 'R-01001', 'p-deepak', null, '[{"description":"Consultation, Dr. Sagar Karvir","qty":1,"rate":800},{"description":"X-ray, knee (2 views)","qty":1,"rate":450}]'::jsonb, 1250, 0, 1250, 1250, 'card', 'paid', 'Sunita Kulkarni', timestamptz '2026-08-27T06:10:00Z' + (current_date - date '2026-08-29') * interval '1 day', timestamptz '2026-08-27T06:11:00Z' + (current_date - date '2026-08-29') * interval '1 day'),
  ('bill-2', 'org1', 'R-01002', 'p-kavita', null, '[{"description":"Physiotherapy package, 8 sessions","qty":8,"rate":600}]'::jsonb, 4800, 400, 4400, 2000, 'cash', 'part_paid', 'Sunita Kulkarni', timestamptz '2026-08-28T11:40:00Z' + (current_date - date '2026-08-29') * interval '1 day', timestamptz '2026-08-28T11:41:00Z' + (current_date - date '2026-08-29') * interval '1 day'),
  ('bill-3', 'org1', 'R-01003', 'p-anil', 'ap-s1', '[{"description":"Consultation, Dr. Sagar Karvir","qty":1,"rate":800}]'::jsonb, 800, 0, 800, 800, 'upi', 'paid', 'Sunita Kulkarni', timestamptz '2026-08-29T04:20:00Z' + (current_date - date '2026-08-29') * interval '1 day', timestamptz '2026-08-29T04:21:00Z' + (current_date - date '2026-08-29') * interval '1 day')
on conflict (id) do nothing;
