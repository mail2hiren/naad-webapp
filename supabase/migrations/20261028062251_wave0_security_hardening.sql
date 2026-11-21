revoke execute on function public.link_patient_by_phone(text) from public, anon, authenticated;

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

create policy prescriptions_update on public.prescriptions for update
  using (org_id = public.current_org_id() and public.current_staff_role() = 'surgeon')
  with check (org_id = public.current_org_id() and public.current_staff_role() = 'surgeon');

revoke truncate, trigger, references on all tables in schema public from anon, authenticated;
revoke all on all tables in schema public from anon;
alter default privileges in schema public revoke truncate, trigger, references on tables from anon, authenticated;
alter default privileges in schema public revoke all on tables from anon;