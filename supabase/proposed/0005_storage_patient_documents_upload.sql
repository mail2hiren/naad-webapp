-- 0005 — Allow staff to upload into the patient-documents bucket; cap size/types.
--         Apply together with the code change that does real uploads.
--
-- Gap: bucket 'patient-documents' (private) exists with a READ policy only.
-- The app today does not upload at all: ReceptionView writes a documents row
-- with storage_path 'mock/<file>' and no file. When real upload is wired, it
-- will need an INSERT policy. Path convention (matches the read policy):
--   <org_id>/<patient_id>/<document_id>-<file name>
-- Free tier storage is 1 GB, so cap file size and types.

create policy patient_documents_insert_staff on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'patient-documents'
    and (storage.foldername(name))[1] = public.current_org_id()
    and public.current_staff_role() is not null
  );

update storage.buckets
   set file_size_limit = 10485760,  -- 10 MB
       allowed_mime_types = array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic']
 where id = 'patient-documents';
