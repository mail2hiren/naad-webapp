-- 0013 — Hospital admin: service rates, wards and beds, audit-log integrity check.
--
-- Why: Phase 5 (part 1) gives the hospital admin their working day. Working
-- hours and slot length already live on practitioners (0011); this adds what
-- the admin still could not set up or check:
--
-- service_rates (new): the hospital's price list (registration, X-ray,
--   dressing, physio session, ward day, ...). Reception's billing offers these
--   as one-tap items, so prices are set once by the admin, not typed per bill.
-- beds (new): wards and beds with type and daily rate. Occupancy columns
--   (patient_id, occupied_since) are filled by ward admission in part 2.
-- audit_chain_check(): re-computes the audit log's hash chain (the
--   audit_events_hash_chain trigger) and reports how many entries were checked
--   and the first one that does not match, so the admin can show the log has
--   not been edited.
--
-- Access: every staff member of the hospital can read rates and beds; only
-- the hospital admin can add or change them. No deletes: retire a rate or a
-- bed by marking it inactive. audit_chain_check() runs as the caller (RLS
-- applies) and refuses anyone but a hospital admin.
--
-- Rollback:
--   drop function public.audit_chain_check();
--   alter publication supabase_realtime drop table public.service_rates;
--   alter publication supabase_realtime drop table public.beds;
--   drop table public.beds;
--   drop table public.service_rates;

create table public.service_rates (
  id text primary key,
  org_id text not null references public.organizations (id),
  name text not null,
  category text not null default 'other'
    check (category in ('consultation', 'procedure', 'investigation', 'therapy', 'ward', 'pharmacy', 'other')),
  amount numeric(10, 2) not null check (amount >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (org_id, name)
);

create table public.beds (
  id text primary key,
  org_id text not null references public.organizations (id),
  ward text not null,
  label text not null,
  kind text not null default 'general' check (kind in ('general', 'semi_private', 'private', 'icu', 'day_care')),
  daily_rate numeric(10, 2) not null default 0 check (daily_rate >= 0),
  active boolean not null default true,
  patient_id text references public.patients (id),
  occupied_since timestamptz,
  created_at timestamptz not null default now(),
  unique (org_id, ward, label)
);

create index beds_patient on public.beds (patient_id) where patient_id is not null;

alter table public.service_rates enable row level security;
alter table public.beds enable row level security;

create policy service_rates_read on public.service_rates for select to authenticated
  using (org_id = public.current_org_id() and public.current_staff_role() is not null);
create policy service_rates_insert on public.service_rates for insert to authenticated
  with check (org_id = public.current_org_id() and public.current_staff_role() = 'admin');
create policy service_rates_update on public.service_rates for update to authenticated
  using (org_id = public.current_org_id() and public.current_staff_role() = 'admin')
  with check (org_id = public.current_org_id());

create policy beds_read on public.beds for select to authenticated
  using (org_id = public.current_org_id() and public.current_staff_role() is not null);
create policy beds_insert on public.beds for insert to authenticated
  with check (org_id = public.current_org_id() and public.current_staff_role() = 'admin');
create policy beds_update on public.beds for update to authenticated
  using (org_id = public.current_org_id() and public.current_staff_role() = 'admin')
  with check (org_id = public.current_org_id());

alter publication supabase_realtime add table public.service_rates;
alter publication supabase_realtime add table public.beds;

create function public.audit_chain_check()
returns table (checked integer, broken_id text)
language plpgsql
stable
security invoker
set search_path = public
set timezone = 'UTC'
as $$
declare
  r record;
  prev text := null;
  n integer := 0;
begin
  if public.current_staff_role() is distinct from 'admin' then
    raise exception 'admins_only' using errcode = '42501';
  end if;
  for r in
    select * from public.audit_events where org_id = public.current_org_id() order by ts, id
  loop
    n := n + 1;
    if r.prev_hash is distinct from prev
       or r.hash is distinct from encode(extensions.digest(
            coalesce(prev, '') || coalesce(r.actor, '') || coalesce(r.action, '') || coalesce(r.detail, '') || r.ts::text,
            'sha256'), 'hex') then
      return query select n, r.id;
      return;
    end if;
    prev := r.hash;
  end loop;
  return query select n, null::text;
end;
$$;
