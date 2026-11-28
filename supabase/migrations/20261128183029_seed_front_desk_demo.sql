-- 0021 — Demo data for the front-desk modules, demo hospital org1 only (data, no schema).
--
-- Why: so the new receptionist screens (0020) show a real working day on the
-- live demo: follow-ups due, enquiries to call back, the stays of the two
-- patients already on the ward (one on insurance, approved), a claim waiting
-- on the insurer, the physiotherapy packages on offer and Kavita's package
-- (her existing bill R-01002). Dates are written for 2026-08-29 and moved to
-- the day this runs, like the earlier demo loads. Fictional people only.
--
-- Rollback: delete from public.patient_packages where id = 'pp-kavita';
--   update public.appointments set patient_package_id = null where id = 'ap-p2';
--   delete from public.treatment_packages where id in ('pkg-physio8', 'pkg-physio12', 'pkg-dressing5');
--   delete from public.insurance_claims where id in ('clm-ramesh', 'clm-lata');
--   delete from public.admissions where id in ('adm-ramesh', 'adm-suresh');
--   delete from public.patient_contacts where id in ('ct-1', 'ct-2');
--   delete from public.enquiries where id in ('enq-1', 'enq-2', 'enq-3');
--   delete from public.follow_ups where id in ('fu-priya', 'fu-arjun', 'fu-neha', 'fu-farah');
--   update public.patients set insurer = null, insurance_policy_no = null, insurance_tpa = null where id in ('p-ramesh', 'p-lata');

with s as (select (current_date - date '2026-08-29') as d)
insert into public.follow_ups (id, org_id, patient_id, practitioner_id, due_on, reason, status, created_by, created_at)
select v.id, 'org1', v.p, v.doc, v.due + s.d, v.reason, 'open', v.by, timestamptz '2026-08-15 06:00+00' + s.d * interval '1 day'
from s, (values
  ('fu-priya', 'p-priya', 'pr-surgeon', date '2026-08-26', 'Shoulder review after 2 weeks of physio', 'Dr. Sagar Karvir'),
  ('fu-arjun', 'p-arjun', 'pr-namrata', date '2026-08-29', 'ECG and BP review', 'Dr. Namrata Rao'),
  ('fu-neha', 'p-neha', 'pr-surgeon', date '2026-09-02', 'Wrist X-ray review', 'Dr. Sagar Karvir'),
  ('fu-farah', 'p-farah', 'pr-namrata', date '2026-09-20', 'HbA1c after 3 months', 'Dr. Namrata Rao')
) as v(id, p, doc, due, reason, by);

with s as (select (current_date - date '2026-08-29') as d)
insert into public.enquiries (id, org_id, name, phone, source, interest, practitioner_id, status, next_follow_up_on, note, created_by, created_at)
select v.id, 'org1', v.name, v.phone, v.source, v.interest, v.doc, v.status, v.next + s.d, v.note, 'Sunita Kulkarni', v.at + s.d * interval '1 day'
from s, (values
  ('enq-1', 'Mahesh Kale', '98221 77654', 'phone', 'Knee replacement cost and Dr. Karvir''s days', 'pr-surgeon', 'open', date '2026-08-29', 'Mother, 68, both knees', timestamptz '2026-08-27 07:30+00'),
  ('enq-2', 'Sneha Joglekar', '99700 31245', 'website', 'Physio for frozen shoulder, evening times', 'pr-physio', 'open', date '2026-08-31', null, timestamptz '2026-08-28 12:10+00'),
  ('enq-3', 'Rahul Deo', '90110 45678', 'walk_in', 'Sports injury clinic', null, 'closed', null, 'Went elsewhere', timestamptz '2026-08-20 05:00+00')
) as v(id, name, phone, source, interest, doc, status, next, note, at);

with s as (select (current_date - date '2026-08-29') as d)
insert into public.patient_contacts (id, org_id, patient_id, enquiry_id, follow_up_id, channel, purpose, outcome, note, contacted_by, contacted_at)
select v.id, 'org1', v.p, v.e, v.f, 'call', v.purpose, v.outcome, v.note, 'Sunita Kulkarni', v.at + s.d * interval '1 day'
from s, (values
  ('ct-1', 'p-priya', null, 'fu-priya', 'recall', 'no_answer', null, timestamptz '2026-08-27 05:00+00'),
  ('ct-2', null, 'enq-1', null, 'enquiry', 'call_later', 'Will discuss with family', timestamptz '2026-08-28 06:00+00')
) as v(id, p, e, f, purpose, outcome, note, at);

update public.patients set insurer = 'Star Health', insurance_policy_no = 'SH-2231-88710', insurance_tpa = 'Medi Assist' where id = 'p-ramesh' and org_id = 'org1';
update public.patients set insurer = 'HDFC ERGO', insurance_policy_no = 'HE-77812' where id = 'p-lata' and org_id = 'org1';

-- The two patients already on the ward get their stays (admitted when their beds were taken).
insert into public.admissions (id, org_id, patient_id, bed_id, practitioner_id, reason, admitted_at, expected_days, deposit, payer, status, created_by, created_at)
select v.id, 'org1', v.p, v.bed, 'pr-surgeon', v.reason, coalesce(b.occupied_since, now()), v.days, v.deposit, v.payer, 'admitted', 'Sunita Kulkarni', coalesce(b.occupied_since, now())
from (values
  ('adm-ramesh', 'p-ramesh', 'bed-g2', 'Right hip replacement', 6, 20000, 'insurance'),
  ('adm-suresh', 'p-suresh', 'bed-g5', 'Observation after a fall', 3, 0, 'self')
) as v(id, p, bed, reason, days, deposit, payer)
left join public.beds b on b.id = v.bed;

with s as (select (current_date - date '2026-08-29') as d)
insert into public.insurance_claims (id, org_id, patient_id, admission_id, insurer, tpa, policy_no, claim_no, kind, amount_requested, amount_approved, status, documents_pending, submitted_on, decided_on, note, updated_by, updated_at, created_at)
select v.id, 'org1', v.p, v.adm, v.insurer, v.tpa, v.policy, v.claim_no, 'preauth', v.asked, v.approved, v.status, v.docs, v.sub + s.d, v.dec + s.d, v.note, 'Sunita Kulkarni', v.upd + s.d * interval '1 day', v.cr + s.d * interval '1 day'
from s, (values
  ('clm-ramesh', 'p-ramesh', 'adm-ramesh', 'Star Health', 'Medi Assist', 'SH-2231-88710', 'MA-55120934', 245000, 210000, 'approved', '{}'::text[], date '2026-08-24', date '2026-08-25', 'Approved for hip replacement package', timestamptz '2026-08-25 10:00+00', timestamptz '2026-08-24 08:00+00'),
  ('clm-lata', 'p-lata', null, 'HDFC ERGO', null, 'HE-77812', null, 80000, null, 'query', '{Investigation reports}'::text[], date '2026-08-21', null, 'Insurer asked for the MRI report', timestamptz '2026-08-26 09:00+00', timestamptz '2026-08-21 08:00+00')
) as v(id, p, adm, insurer, tpa, policy, claim_no, asked, approved, status, docs, sub, dec, note, upd, cr);

insert into public.treatment_packages (id, org_id, name, sessions, price, valid_days, active) values
  ('pkg-physio8', 'org1', 'Physiotherapy, 8 sessions', 8, 4800, 60, true),
  ('pkg-physio12', 'org1', 'Physiotherapy, 12 sessions', 12, 6600, 90, true),
  ('pkg-dressing5', 'org1', 'Wound dressing, 5 visits', 5, 1500, 30, true);

insert into public.patient_packages (id, org_id, patient_id, package_id, name, sessions_total, price, bill_id, starts_on, expires_on, status, created_by, created_at)
select 'pp-kavita', 'org1', 'p-kavita', 'pkg-physio8', 'Physiotherapy, 8 sessions', 8, 4800, 'bill-2', b.created_at::date, b.created_at::date + 60, 'active', 'Sunita Kulkarni', b.created_at
from public.bills b where b.id = 'bill-2' and b.org_id = 'org1';

update public.appointments set patient_package_id = 'pp-kavita' where id = 'ap-p2' and org_id = 'org1';
