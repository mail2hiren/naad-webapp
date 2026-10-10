-- SECURITY FIX (backlog A02). patients_read was `org_id = current_org_id()`,
-- and current_org_id() also resolves for patient logins -- so a patient
-- signed in to the portal could read every patient row in their hospital
-- (names, phones, conditions, allergies, medications).
-- Now: staff read their own hospital's patients; a patient reads only their
-- own row. Covered by supabase/tests/patients_own_row.test.sql.

alter policy patients_read on public.patients
  using (
    (org_id = public.current_org_id() and public.current_staff_role() is not null)
    or id = public.current_patient_id()
  );
