alter policy patients_read on public.patients
  using (
    (org_id = public.current_org_id() and public.current_staff_role() is not null)
    or id = public.current_patient_id()
  );