-- 0007 — Platform layer: DigiYaan super admins, a platform audit trail, and
-- hospital profile fields.
--
-- Why: there is no level above a hospital. New hospitals and their staff can
-- only be created by hand in the database. The Super admin console (Phase 2)
-- needs to know who the super admins are and to record what they change.
--
-- Security model: the browser never gets cross-hospital access. Both new
-- tables have RLS ON and NO policies, so anon/authenticated clients can read
-- or write nothing in them. Only the `platform-admin` edge function (service
-- role) reads them, and it checks the caller is a super admin (or a hospital
-- admin acting on their own hospital) before every action.
--
-- Rollback: drop table public.platform_audit; drop table public.platform_admins;
--           alter table public.organizations drop column address, drop column contact_phone, drop column logo_url;

create table public.platform_admins (
  auth_user_id uuid primary key references auth.users (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);
alter table public.platform_admins enable row level security;
revoke all on public.platform_admins from anon, authenticated;

create table public.platform_audit (
  id bigint generated always as identity primary key,
  ts timestamptz not null default now(),
  actor text not null,
  actor_role text not null check (actor_role in ('platform_admin', 'hospital_admin')),
  action text not null,
  org_id text references public.organizations (id),
  detail text
);
alter table public.platform_audit enable row level security;
revoke all on public.platform_audit from anon, authenticated;

alter table public.organizations
  add column address text,
  add column contact_phone text,
  add column logo_url text;

-- The first super admin is added in a separate, owner-approved step once the
-- owner has created their own login in Supabase (Authentication -> Add user):
--   insert into public.platform_admins (auth_user_id, name)
--   select id, '<name>' from auth.users where email = '<owner email>';
