-- Wave 0 security fixes (backlog SEC01, SEC02, SEC08, CLN-01). Each was
-- reproduced against the live catalog on 2026-10-10 before this was written.

-- SEC01: link_patient_by_phone is SECURITY DEFINER and let ANY signed-in user
-- (including staff of another hospital) attach themselves to any unclaimed
-- patient whose phone matched, in any hospital. The app does not call it
-- (patient login goes through the patient-pin function with the service role).
revoke execute on function public.link_patient_by_phone(text) from public, anon, authenticated;

-- SEC02: patient documents. The old read rule matched the hospital folder for
-- everyone, and current_org_id() also resolves for patients, so any linked
-- patient could read every document in their hospital's folder. Staff keep
-- hospital-wide read; a patient reads only <org>/<own patient id>/...
do $$
begin
  if to_regclass('storage.objects') is not null then
    if exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'patient_documents_read') then
      alter policy patient_documents_read on storage.objects using (
        bucket_id = 'patient-documents'
        and (storage.foldername(name))[1] = public.current_org_id()
        and (
          public.current_staff_role() is not null
          or (storage.foldername(name))[2] = public.current_patient_id()
        )
      );
    else
      create policy patient_documents_read on storage.objects for select using (
        bucket_id = 'patient-documents'
        and (storage.foldername(name))[1] = public.current_org_id()
        and (
          public.current_staff_role() is not null
          or (storage.foldername(name))[2] = public.current_patient_id()
        )
      );
    end if;
  end if;
end $$;

-- CLN-01: prescriptions had INSERT and SELECT policies but no UPDATE policy, so
-- the doctor's Authorize step and the autosave updated zero rows without any
-- error. Surgeons may update prescriptions in their own hospital only.
create policy prescriptions_update on public.prescriptions for update
  using (org_id = public.current_org_id() and public.current_staff_role() = 'surgeon')
  with check (org_id = public.current_org_id() and public.current_staff_role() = 'surgeon');

-- SEC08: the API roles held every privilege on every table, including
-- TRUNCATE (which ignores row security), TRIGGER and REFERENCES. Signed-out
-- visitors (anon) have no business with tables at all: every screen reads
-- after sign-in.
revoke truncate, trigger, references on all tables in schema public from anon, authenticated;
revoke all on all tables in schema public from anon;
alter default privileges in schema public revoke truncate, trigger, references on tables from anon, authenticated;
alter default privileges in schema public revoke all on tables from anon;
