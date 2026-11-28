-- 0020 — Front desk modules: follow-ups, contact log, day-end cash closing and refunds,
-- admissions by reception, insurance, enquiries, treatment packages.
--
-- Why: the receptionist's sidebar grows from the calendar to the whole front
-- desk of a clinic or nursing home (owner's go, 2026-11-28). Each table below
-- backs one screen.
--
-- follow_ups (new): a patient is due back (set by the doctor or the desk) on a
--   day; the desk calls them and books, or records why not.
-- patient_contacts (new): every call or message the desk makes or takes about
--   a patient or an enquiry (reminders, recalls, payment, reports), with the outcome.
-- bills: refunded, refund_reason, refunded_at, refund_method (money given back
--   on a paid bill; the bill keeps its total, the refund is recorded beside it).
-- cash_closings (new): the day-end count per person: expected by payment
--   method (from bills), cash counted, the difference and a note; one per person per day.
-- admissions (new): a hospital stay (bed, admitting doctor, reason, deposit,
--   insurance, admitted and discharged times). Reception may now admit: it may
--   change who is in a bed (as doctors already may, occupancy only) and add
--   bed-day charges.
-- patients: insurer, insurance_policy_no, insurance_tpa, insurance_valid_till.
-- insurance_claims (new): pre-authorisation and claim tracking per patient or stay.
-- enquiries (new): calls and walk-in questions from people who are not yet
--   patients (or are), with a next follow-up day, until booked or closed.
-- treatment_packages (new): the hospital's packages (e.g. 8 physio sessions).
-- patient_packages (new): a package sold to a patient; appointments.patient_package_id
--   marks the visits it covers, so sessions used = finished visits on it.
--
-- Access: all staff of the hospital read these. Reception and the admin write
-- them; doctors and physiotherapists may also add follow-ups (they decide when
-- a patient should come back). Cash closings: each person closes their own
-- day; nobody edits or deletes a closing (the admin sees all).
-- No delete policies: records are cancelled or closed, never removed.
--
-- Rollback (reverse order):
--   drop table public.patient_packages, public.treatment_packages, public.enquiries,
--     public.insurance_claims, public.admissions, public.cash_closings,
--     public.patient_contacts, public.follow_ups;   (after removing them from supabase_realtime)
--   alter table public.appointments drop column patient_package_id;
--   alter table public.patients drop column insurer, drop column insurance_policy_no,
--     drop column insurance_tpa, drop column insurance_valid_till;
--   alter table public.bills drop column refunded, drop column refund_reason,
--     drop column refunded_at, drop column refund_method;
--   restore beds_update_clinical, beds_clinical_occupancy_only and
--   ward_billing_insert_clinical from 20261128084529_pharmacy_ward.

-- ---------------------------------------------------------------- follow-ups
create table public.follow_ups (
  id text primary key,
  org_id text not null references public.organizations (id),
  patient_id text not null references public.patients (id),
  practitioner_id text references public.practitioners (id),
  due_on date not null,
  reason text,
  status text not null default 'open' check (status in ('open', 'booked', 'done', 'declined')),
  appointment_id text references public.appointments (id),
  created_by text,
  created_at timestamptz not null default now()
);
create index follow_ups_due on public.follow_ups (org_id, status, due_on);

-- ---------------------------------------------------------------- enquiries
create table public.enquiries (
  id text primary key,
  org_id text not null references public.organizations (id),
  name text not null,
  phone text,
  source text not null default 'phone' check (source in ('phone', 'walk_in', 'website', 'referral', 'other')),
  interest text,
  practitioner_id text references public.practitioners (id),
  status text not null default 'open' check (status in ('open', 'booked', 'closed')),
  next_follow_up_on date,
  note text,
  patient_id text references public.patients (id),
  created_by text,
  created_at timestamptz not null default now()
);
create index enquiries_open on public.enquiries (org_id, status, next_follow_up_on);

-- ---------------------------------------------------------------- contact log
create table public.patient_contacts (
  id text primary key,
  org_id text not null references public.organizations (id),
  patient_id text references public.patients (id),
  enquiry_id text references public.enquiries (id),
  follow_up_id text references public.follow_ups (id),
  channel text not null default 'call' check (channel in ('call', 'sms', 'whatsapp', 'in_person', 'email')),
  purpose text not null default 'recall' check (purpose in ('reminder', 'recall', 'enquiry', 'payment', 'report', 'insurance', 'other')),
  outcome text not null check (outcome in ('booked', 'no_answer', 'call_later', 'declined', 'wrong_number', 'informed', 'other')),
  note text,
  contacted_by text,
  contacted_at timestamptz not null default now(),
  check (patient_id is not null or enquiry_id is not null)
);
create index patient_contacts_patient on public.patient_contacts (org_id, patient_id, contacted_at desc);

-- ---------------------------------------------------------------- refunds and cash closing
alter table public.bills
  add column refunded numeric not null default 0 check (refunded >= 0),
  add column refund_reason text,
  add column refunded_at timestamptz,
  add column refund_method text check (refund_method is null or refund_method in ('cash', 'upi', 'card', 'insurance'));

create table public.cash_closings (
  id text primary key,
  org_id text not null references public.organizations (id),
  day date not null,
  closed_by text not null,
  expected_cash numeric not null default 0,
  counted_cash numeric not null check (counted_cash >= 0),
  expected_upi numeric not null default 0,
  expected_card numeric not null default 0,
  expected_insurance numeric not null default 0,
  refunds_cash numeric not null default 0,
  difference numeric not null,
  note text,
  closed_at timestamptz not null default now(),
  unique (org_id, day, closed_by)
);

-- ---------------------------------------------------------------- insurance
alter table public.patients
  add column insurer text,
  add column insurance_policy_no text,
  add column insurance_tpa text,
  add column insurance_valid_till date;

-- ---------------------------------------------------------------- admissions
create table public.admissions (
  id text primary key,
  org_id text not null references public.organizations (id),
  patient_id text not null references public.patients (id),
  bed_id text references public.beds (id),
  practitioner_id text references public.practitioners (id),
  reason text,
  admitted_at timestamptz not null default now(),
  expected_days integer check (expected_days is null or expected_days > 0),
  deposit numeric not null default 0 check (deposit >= 0),
  deposit_bill_id text references public.bills (id),
  payer text not null default 'self' check (payer in ('self', 'insurance', 'corporate', 'government')),
  status text not null default 'admitted' check (status in ('admitted', 'discharged', 'cancelled')),
  discharged_at timestamptz,
  created_by text,
  created_at timestamptz not null default now()
);
create index admissions_open on public.admissions (org_id, status);

create table public.insurance_claims (
  id text primary key,
  org_id text not null references public.organizations (id),
  patient_id text not null references public.patients (id),
  admission_id text references public.admissions (id),
  bill_id text references public.bills (id),
  insurer text not null,
  tpa text,
  policy_no text,
  claim_no text,
  kind text not null default 'preauth' check (kind in ('preauth', 'final', 'reimbursement')),
  amount_requested numeric not null default 0 check (amount_requested >= 0),
  amount_approved numeric check (amount_approved is null or amount_approved >= 0),
  amount_settled numeric check (amount_settled is null or amount_settled >= 0),
  status text not null default 'draft' check (status in ('draft', 'submitted', 'query', 'approved', 'partly_approved', 'rejected', 'settled')),
  documents_pending text[] not null default '{}',
  submitted_on date,
  decided_on date,
  settled_on date,
  note text,
  updated_by text,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index insurance_claims_open on public.insurance_claims (org_id, status);

-- ---------------------------------------------------------------- packages
create table public.treatment_packages (
  id text primary key,
  org_id text not null references public.organizations (id),
  name text not null,
  sessions integer not null check (sessions > 0),
  price numeric not null check (price >= 0),
  valid_days integer check (valid_days is null or valid_days > 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.patient_packages (
  id text primary key,
  org_id text not null references public.organizations (id),
  patient_id text not null references public.patients (id),
  package_id text references public.treatment_packages (id),
  name text not null,
  sessions_total integer not null check (sessions_total > 0),
  price numeric not null check (price >= 0),
  bill_id text references public.bills (id),
  starts_on date not null,
  expires_on date,
  status text not null default 'active' check (status in ('active', 'finished', 'expired', 'cancelled')),
  created_by text,
  created_at timestamptz not null default now()
);
create index patient_packages_patient on public.patient_packages (org_id, patient_id);

alter table public.appointments add column patient_package_id text references public.patient_packages (id);

-- ---------------------------------------------------------------- access
do $rls$
declare t text;
begin
  foreach t in array array['follow_ups', 'enquiries', 'patient_contacts', 'cash_closings', 'admissions', 'insurance_claims', 'treatment_packages', 'patient_packages'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select to authenticated using (org_id = public.current_org_id() and public.current_staff_role() is not null)', t || '_read', t);
    execute format('alter publication supabase_realtime add table public.%I', t);
  end loop;
  -- Written by reception and the admin.
  foreach t in array array['enquiries', 'patient_contacts', 'admissions', 'insurance_claims', 'patient_packages'] loop
    execute format('create policy %I on public.%I for insert to authenticated with check (org_id = public.current_org_id() and public.current_staff_role() in (''receptionist'', ''admin''))', t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (org_id = public.current_org_id() and public.current_staff_role() in (''receptionist'', ''admin'')) with check (org_id = public.current_org_id())', t || '_update', t);
  end loop;
end $rls$;

-- Follow-ups: doctors and physiotherapists decide when a patient comes back; the desk books it.
create policy follow_ups_insert on public.follow_ups for insert to authenticated
  with check (org_id = public.current_org_id() and public.current_staff_role() in ('receptionist', 'admin', 'surgeon', 'physio'));
create policy follow_ups_update on public.follow_ups for update to authenticated
  using (org_id = public.current_org_id() and public.current_staff_role() in ('receptionist', 'admin', 'surgeon', 'physio'))
  with check (org_id = public.current_org_id());

-- Packages on sale: the admin keeps the list (like the price list).
create policy treatment_packages_insert on public.treatment_packages for insert to authenticated
  with check (org_id = public.current_org_id() and public.current_staff_role() = 'admin');
create policy treatment_packages_update on public.treatment_packages for update to authenticated
  using (org_id = public.current_org_id() and public.current_staff_role() = 'admin')
  with check (org_id = public.current_org_id());

-- Cash closings: each person records their own count; nobody changes it afterwards.
create policy cash_closings_insert on public.cash_closings for insert to authenticated
  with check (org_id = public.current_org_id() and public.current_staff_role() in ('receptionist', 'admin', 'pharmacist')
              and closed_by = public.current_actor_name());

-- Reception admits patients: it may change who is in a bed (occupancy only, like doctors)
-- and add bed-day charges.
drop policy beds_update_clinical on public.beds;
create policy beds_update_clinical on public.beds for update to authenticated
  using (org_id = public.current_org_id() and public.current_staff_role() in ('surgeon', 'physio', 'receptionist'))
  with check (org_id = public.current_org_id());

create or replace function public.beds_clinical_occupancy_only()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
declare
  occupancy constant text[] := array['patient_id', 'occupied_since'];
begin
  if public.current_staff_role() in ('surgeon', 'physio', 'receptionist')
     and (to_jsonb(new) - occupancy) is distinct from (to_jsonb(old) - occupancy) then
    raise exception 'beds_occupancy_only'
      using errcode = '42501',
            hint = 'Clinicians and reception may change only who is in a bed and since when.';
  end if;
  return new;
end;
$function$;

drop policy ward_billing_insert_clinical on public.ward_billing_ledger;
create policy ward_billing_insert_clinical on public.ward_billing_ledger for insert to authenticated
  with check (org_id = public.current_org_id() and public.current_staff_role() in ('surgeon', 'physio', 'admin', 'receptionist'));
