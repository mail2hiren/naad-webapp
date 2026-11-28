-- 0011 — Reception: doctor calendar, tokens, reschedule/cancel/no-show, bills and receipts.
--
-- Why: Phase 4 gives the front desk a real working day. Reception books into
-- a doctor's free slots, checks patients in with a token number, reschedules,
-- cancels or marks no-shows, and bills the visit with a printable receipt.
--
-- practitioners: optional working hours and slot length per doctor/physio.
--   working_hours is {"mon": [["09:30","13:30"],["16:00","19:00"]], ...};
--   null means the hospital default (Mon-Sat 09:30-13:30 and 16:00-19:00);
--   slot_minutes null means 15 minutes for doctors, 30 for physiotherapists.
-- appointments: token number and check-in time, cancel reason, visit type,
--   the original time when rescheduled, and who booked it.
-- bills (new): one bill per visit or package, with line items, discount,
--   amount paid and payment method. Numbered per hospital ("R-01001", "R-01002", ...).
--
-- Access: any staff member of the hospital can read its bills; only reception
-- and the hospital admin can create or update them; a patient can read their
-- own. Nobody can delete a bill: a wrong bill is voided with a reason.
-- Appointments: reception/admin and the patient keep their access. New: a
-- doctor or physio may update their own appointments, so finishing a consult
-- or recording a therapy session marks the visit "seen" for reception to bill.
--
-- Rollback:
--   drop policy appointments_update_clinician on public.appointments;
--   alter publication supabase_realtime drop table public.bills;
--   drop table public.bills;
--   alter table public.appointments drop column token_no, drop column checked_in_at,
--     drop column cancel_reason, drop column visit_type, drop column rescheduled_from,
--     drop column booked_by;
--   alter table public.practitioners drop column working_hours, drop column slot_minutes;

alter table public.practitioners
  add column working_hours jsonb,
  add column slot_minutes integer check (slot_minutes is null or slot_minutes between 5 and 120);

alter table public.appointments
  add column token_no integer check (token_no is null or token_no > 0),
  add column checked_in_at timestamptz,
  add column cancel_reason text,
  add column visit_type text not null default 'consultation'
    check (visit_type in ('consultation', 'follow_up', 'therapy', 'procedure')),
  add column rescheduled_from timestamptz,
  add column booked_by text;

create policy appointments_update_clinician on public.appointments for update to authenticated
  using (org_id = public.current_org_id() and public.current_staff_role() in ('surgeon', 'physio')
         and practitioner_id = public.current_practitioner_id())
  with check (org_id = public.current_org_id() and practitioner_id = public.current_practitioner_id());

create table public.bills (
  id text primary key,
  org_id text not null references public.organizations (id),
  number text not null,
  patient_id text not null references public.patients (id),
  appointment_id text references public.appointments (id),
  encounter_id text references public.encounters (id),
  items jsonb not null default '[]'::jsonb,
  subtotal numeric(10, 2) not null default 0 check (subtotal >= 0),
  discount numeric(10, 2) not null default 0 check (discount >= 0),
  total numeric(10, 2) not null default 0 check (total >= 0),
  paid numeric(10, 2) not null default 0 check (paid >= 0),
  payment_method text check (payment_method is null or payment_method in ('cash', 'upi', 'card', 'insurance')),
  status text not null default 'unpaid' check (status in ('unpaid', 'part_paid', 'paid', 'void')),
  void_reason text,
  created_by text,
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  unique (org_id, number)
);

create index bills_org_created on public.bills (org_id, created_at desc);
create index bills_patient on public.bills (patient_id);

alter table public.bills enable row level security;

create policy bills_read on public.bills for select to authenticated
  using ((org_id = public.current_org_id() and public.current_staff_role() is not null)
         or (public.current_patient_id() is not null and patient_id = public.current_patient_id()));

create policy bills_insert on public.bills for insert to authenticated
  with check (org_id = public.current_org_id() and public.current_staff_role() in ('receptionist', 'admin'));

create policy bills_update on public.bills for update to authenticated
  using (org_id = public.current_org_id() and public.current_staff_role() in ('receptionist', 'admin'))
  with check (org_id = public.current_org_id());

alter publication supabase_realtime add table public.bills;
