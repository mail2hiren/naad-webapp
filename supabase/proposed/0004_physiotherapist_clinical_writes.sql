-- 0004 — Let the Physiotherapist role do what the Doctor screen asks of it.
--         *** NEEDS A PRODUCT DECISION BEFORE "GO" — see notes ***
--
-- Gap: App.tsx routes role 'physio' to /doctor and /inpatient, but RLS only
-- lets 'surgeon' create/update encounters, and only receptionist/surgeon/admin
-- update patients. A physio signing in today can open the Doctor screen but
-- every save (start session, clinical note, queue/journey stage move) is
-- rejected or silently matches 0 rows.
--
-- This file grants physio: encounters insert/update and patients update.
-- It deliberately does NOT grant physio prescriptions / pharmacy_orders /
-- referrals-insert (physiotherapists do not prescribe drugs). If the Doctor
-- screen should hide the prescription panel for physio, that is a code change,
-- not a migration. Decide: is this the intended split?

alter policy encounters_write on public.encounters
  with check (org_id = public.current_org_id() and public.current_staff_role() in ('surgeon', 'physio'));

alter policy encounters_update on public.encounters
  using (org_id = public.current_org_id() and public.current_staff_role() in ('surgeon', 'physio'))
  with check (org_id = public.current_org_id());

alter policy patients_update_staff on public.patients
  using (org_id = public.current_org_id() and public.current_staff_role() in ('receptionist', 'surgeon', 'physio', 'admin'))
  with check (org_id = public.current_org_id());
