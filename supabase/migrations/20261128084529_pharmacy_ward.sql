-- 0015 — Pharmacy stock by batch and pharmacy billing; ward vitals and bed occupancy.
--
-- Why: Phase 5 (part 2) gives the pharmacist and the ward their working day.
--
-- stock_batches (new): each delivery of a medicine with its batch number,
--   expiry date, quantity left and selling price (MRP). The pharmacist sees
--   what expires soon, dispenses the earliest expiry first, and writes off
--   expired stock with a reason. inventory.stock stays the total on hand.
-- bills: a source (front desk, pharmacy, ward) and the pharmacy order a
--   pharmacy bill is for. The pharmacist may now create and update bills, so
--   medicines are billed when dispensed.
-- vitals (new): BP, pulse, temperature, SpO2, breathing rate and pain, taken
--   on the ward. Readings are never edited or deleted; a wrong one is followed
--   by a correct one.
-- beds: a doctor or physio may now admit a patient to a bed, move them and
--   free the bed at discharge. A trigger lets them change only who is in the
--   bed and since when; rates, type and labels stay the admin's.
--
-- Access: all staff of the hospital read batches and vitals; the pharmacist
-- and admin manage batches; doctors, physios and the admin record vitals; a
-- patient can read their own vitals. No deletes anywhere.
--
-- Rollback:
--   drop trigger beds_clinical_occupancy_only on public.beds;
--   drop function public.beds_clinical_occupancy_only();
--   drop policy beds_update_clinical on public.beds;
--   drop policy bills_insert on public.bills; drop policy bills_update on public.bills;
--   create policy bills_insert on public.bills for insert to authenticated
--     with check (org_id = public.current_org_id() and public.current_staff_role() in ('receptionist', 'admin'));
--   create policy bills_update on public.bills for update to authenticated
--     using (org_id = public.current_org_id() and public.current_staff_role() in ('receptionist', 'admin'))
--     with check (org_id = public.current_org_id());
--   alter table public.bills drop column source, drop column pharmacy_order_id;
--   alter publication supabase_realtime drop table public.stock_batches;
--   alter publication supabase_realtime drop table public.vitals;
--   drop table public.vitals;
--   drop table public.stock_batches;

create table public.stock_batches (
  id text primary key,
  org_id text not null references public.organizations (id),
  inventory_id bigint not null references public.inventory (id),
  batch_no text not null,
  expiry date not null,
  qty integer not null check (qty >= 0),
  mrp numeric(10, 2) not null default 0 check (mrp >= 0),
  supplier text,
  received_at timestamptz not null default now(),
  received_by text,
  written_off_at timestamptz,
  write_off_reason text,
  unique (org_id, inventory_id, batch_no)
);

create index stock_batches_item on public.stock_batches (inventory_id, expiry);

alter table public.stock_batches enable row level security;

create policy stock_batches_read on public.stock_batches for select to authenticated
  using (org_id = public.current_org_id() and public.current_staff_role() is not null);
create policy stock_batches_insert on public.stock_batches for insert to authenticated
  with check (org_id = public.current_org_id() and public.current_staff_role() in ('pharmacist', 'admin'));
create policy stock_batches_update on public.stock_batches for update to authenticated
  using (org_id = public.current_org_id() and public.current_staff_role() in ('pharmacist', 'admin'))
  with check (org_id = public.current_org_id());

create table public.vitals (
  id text primary key,
  org_id text not null references public.organizations (id),
  patient_id text not null references public.patients (id),
  taken_at timestamptz not null default now(),
  bp_systolic integer check (bp_systolic is null or bp_systolic between 50 and 300),
  bp_diastolic integer check (bp_diastolic is null or bp_diastolic between 20 and 200),
  pulse integer check (pulse is null or pulse between 20 and 250),
  temp_c numeric(4, 1) check (temp_c is null or temp_c between 30 and 45),
  spo2 integer check (spo2 is null or spo2 between 50 and 100),
  resp_rate integer check (resp_rate is null or resp_rate between 4 and 60),
  pain integer check (pain is null or pain between 0 and 10),
  note text,
  recorded_by text
);

create index vitals_patient on public.vitals (patient_id, taken_at desc);

alter table public.vitals enable row level security;

create policy vitals_read on public.vitals for select to authenticated
  using ((org_id = public.current_org_id() and public.current_staff_role() is not null)
         or (public.current_patient_id() is not null and patient_id = public.current_patient_id()));
create policy vitals_insert on public.vitals for insert to authenticated
  with check (org_id = public.current_org_id() and public.current_staff_role() in ('surgeon', 'physio', 'admin'));

alter table public.bills
  add column source text not null default 'front_desk' check (source in ('front_desk', 'pharmacy', 'ward')),
  add column pharmacy_order_id text references public.pharmacy_orders (id);

drop policy bills_insert on public.bills;
drop policy bills_update on public.bills;
create policy bills_insert on public.bills for insert to authenticated
  with check (org_id = public.current_org_id() and public.current_staff_role() in ('receptionist', 'admin', 'pharmacist'));
create policy bills_update on public.bills for update to authenticated
  using (org_id = public.current_org_id() and public.current_staff_role() in ('receptionist', 'admin', 'pharmacist'))
  with check (org_id = public.current_org_id());

create policy beds_update_clinical on public.beds for update to authenticated
  using (org_id = public.current_org_id() and public.current_staff_role() in ('surgeon', 'physio'))
  with check (org_id = public.current_org_id());

create function public.beds_clinical_occupancy_only()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  occupancy constant text[] := array['patient_id', 'occupied_since'];
begin
  if public.current_staff_role() in ('surgeon', 'physio')
     and (to_jsonb(new) - occupancy) is distinct from (to_jsonb(old) - occupancy) then
    raise exception 'beds_occupancy_only'
      using errcode = '42501',
            hint = 'A doctor or physiotherapist may change only who is in a bed and since when.';
  end if;
  return new;
end;
$$;

create trigger beds_clinical_occupancy_only before update on public.beds
  for each row execute function public.beds_clinical_occupancy_only();

alter publication supabase_realtime add table public.stock_batches;
alter publication supabase_realtime add table public.vitals;
