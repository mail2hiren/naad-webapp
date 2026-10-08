-- SECURITY FIX. ward_billing_ledger had a policy "ward_billing_ledger_all"
-- (FOR ALL, TO public, USING true / WITH CHECK true): anyone holding the public
-- anon key could read, edit or delete every hospital's ward billing rows.
-- Verified before/after with `set local role anon; select count(*)` -> 8 rows, then 0.
-- Now: signed-in clinical staff of the SAME hospital only (read: any staff).

alter policy ward_billing_ledger_all on public.ward_billing_ledger
  to authenticated
  using (org_id = public.current_org_id() and public.current_staff_role() in ('surgeon','physio','admin'))
  with check (org_id = public.current_org_id() and public.current_staff_role() in ('surgeon','physio','admin'));

create policy ward_billing_read_staff on public.ward_billing_ledger for select to authenticated
  using (org_id = public.current_org_id() and public.current_staff_role() is not null);
create policy ward_billing_insert_clinical on public.ward_billing_ledger for insert to authenticated
  with check (org_id = public.current_org_id() and public.current_staff_role() in ('surgeon','physio','admin'));
create policy ward_billing_update_clinical on public.ward_billing_ledger for update to authenticated
  using (org_id = public.current_org_id() and public.current_staff_role() in ('surgeon','physio','admin'))
  with check (org_id = public.current_org_id());
