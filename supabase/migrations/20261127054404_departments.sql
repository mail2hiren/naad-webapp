-- 0008 — Departments per hospital.
--
-- Why: departments (Orthopaedics, Physiotherapy, Critical Care, ...) drive the
-- calendar, queues and patient routing in later phases. Today the only notion
-- is a fixed `practitioners.specialty` list, the same for every hospital.
--
-- Access: staff read their own hospital's departments; a hospital admin
-- creates and edits them for their own hospital; the super admin manages any
-- hospital's departments through the `platform-admin` edge function.
-- `practitioners.department_id` links a doctor or physio to a department
-- (optional; existing rows stay null until assigned).
--
-- Rollback: alter table public.practitioners drop column department_id;
--           drop table public.departments;

create table public.departments (
  id text primary key,
  org_id text not null references public.organizations (id),
  name text not null,
  specialty text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (org_id, name)
);
alter table public.departments enable row level security;

create policy departments_read_staff on public.departments for select to authenticated
  using (org_id = public.current_org_id() and public.current_staff_role() is not null);

create policy departments_write_admin on public.departments for insert to authenticated
  with check (org_id = public.current_org_id() and public.current_staff_role() = 'admin');

create policy departments_update_admin on public.departments for update to authenticated
  using (org_id = public.current_org_id() and public.current_staff_role() = 'admin')
  with check (org_id = public.current_org_id());

revoke all on public.departments from anon;
revoke truncate, trigger, references, delete on public.departments from authenticated;

alter table public.practitioners
  add column department_id text references public.departments (id);

alter publication supabase_realtime add table public.departments;
