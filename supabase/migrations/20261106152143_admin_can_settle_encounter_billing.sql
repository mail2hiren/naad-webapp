-- 0003 — Let Hospital Admin settle encounter billing (billing fields only).
--
-- Gap (live bug): AdminView "clear for discharge" runs
--   update encounters set payment_status = 'paid' where patient_id = ...
-- but the only UPDATE policy on encounters is surgeon-only. Under RLS that
-- update matches 0 rows and returns NO error, so the screen reports success,
-- moves the patient to active_follow_up, and the encounters stay 'unpaid'.
--
-- Fix: an admin UPDATE policy, plus a trigger that rejects an admin change to
-- anything other than the billing columns (RLS cannot restrict columns).

create policy encounters_update_admin_billing on public.encounters
  for update to authenticated
  using (org_id = public.current_org_id() and public.current_staff_role() = 'admin')
  with check (org_id = public.current_org_id());

create or replace function public.encounters_admin_billing_only()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  billing constant text[] := array['payment_status', 'billing_notes', 'consultation_fee'];
begin
  if public.current_staff_role() = 'admin'
     and (to_jsonb(new) - billing) is distinct from (to_jsonb(old) - billing) then
    raise exception 'admin_billing_fields_only'
      using errcode = '42501',
            hint = 'A Hospital Admin may change only payment_status, billing_notes and consultation_fee on an encounter.';
  end if;
  return new;
end;
$$;

revoke all on function public.encounters_admin_billing_only() from public, anon, authenticated;

create trigger encounters_admin_billing_only
  before update on public.encounters
  for each row execute function public.encounters_admin_billing_only();
