-- Wave 0: SEC01 (phone-link RPC), SEC02 (patient documents), CLN-01
-- (prescription update), SEC08 (API-role table grants).
begin;

insert into auth.users (id) values
  ('00000000-0000-0000-0000-0000000000d1'),  -- surgeon org1
  ('00000000-0000-0000-0000-0000000000d2'),  -- receptionist org1
  ('00000000-0000-0000-0000-0000000000d3'),  -- surgeon org2
  ('00000000-0000-0000-0000-0000000000e1'),  -- patient A org1
  ('00000000-0000-0000-0000-0000000000e2');  -- patient B org1
insert into public.organizations (id, name) values ('w-org1', 'W Hospital 1'), ('w-org2', 'W Hospital 2');
insert into public.practitioners (id, org_id, auth_user_id, name, role) values
  ('w-doc1', 'w-org1', '00000000-0000-0000-0000-0000000000d1', 'Doc 1', 'surgeon'),
  ('w-rec1', 'w-org1', '00000000-0000-0000-0000-0000000000d2', 'Rec 1', 'receptionist'),
  ('w-doc2', 'w-org2', '00000000-0000-0000-0000-0000000000d3', 'Doc 2', 'surgeon');
insert into public.patients (id, org_id, auth_user_id, name, phone) values
  ('w-pa', 'w-org1', '00000000-0000-0000-0000-0000000000e1', 'Patient A', '1111'),
  ('w-pb', 'w-org1', '00000000-0000-0000-0000-0000000000e2', 'Patient B', '2222'),
  ('w-pc', 'w-org1', null, 'Unclaimed', '9999999999');
insert into public.encounters (id, org_id, patient_id, practitioner_id)
  values ('w-enc', 'w-org1', 'w-pa', 'w-doc1');
insert into public.prescriptions (id, org_id, encounter_id, patient_id, items)
  values ('w-rx', 'w-org1', 'w-enc', 'w-pa', '[]'::jsonb);
insert into storage.objects (bucket_id, name) values
  ('patient-documents', 'w-org1/w-pa/scan.pdf'),
  ('patient-documents', 'w-org1/w-pb/scan.pdf');

-- SEC01: nobody who is not the service role may call the phone-link RPC.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000d3","role":"authenticated"}';
do $$
begin
  perform public.link_patient_by_phone('9999999999');
  raise exception 'SEC01: link_patient_by_phone is still callable by authenticated';
exception when insufficient_privilege then null;
end $$;

-- CLN-01: a surgeon in the hospital can update; others cannot.
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated"}';
do $$
declare n int;
begin
  update public.prescriptions set status = 'sent_to_pharmacy', approved_by = 'Doc 1' where id = 'w-rx';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'CLN-01: surgeon update touched % rows', n; end if;
end $$;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000d2","role":"authenticated"}';
do $$
declare n int;
begin
  update public.prescriptions set status = 'draft' where id = 'w-rx';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'CLN-01: receptionist updated a prescription'; end if;
end $$;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000d3","role":"authenticated"}';
do $$
declare n int;
begin
  update public.prescriptions set status = 'draft' where id = 'w-rx';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'CLN-01: other hospital updated a prescription'; end if;
end $$;

-- SEC02: documents.
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000e1","role":"authenticated"}';
do $$
declare names text;
begin
  select string_agg(name, ',' order by name) into names from storage.objects;
  if names is distinct from 'w-org1/w-pa/scan.pdf' then
    raise exception 'SEC02: patient A saw: %', names;
  end if;
end $$;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000d2","role":"authenticated"}';
do $$
declare c int;
begin
  select count(*) into c from storage.objects;
  if c <> 2 then raise exception 'SEC02: staff should see both files, saw %', c; end if;
end $$;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000d3","role":"authenticated"}';
do $$
begin
  if exists (select 1 from storage.objects) then
    raise exception 'SEC02: another hospital read documents';
  end if;
end $$;

-- SEC08: grants.
reset role;
do $$
begin
  if has_table_privilege('anon', 'public.patients', 'select') then
    raise exception 'SEC08: anon can select patients';
  end if;
  if has_table_privilege('authenticated', 'public.patients', 'truncate') then
    raise exception 'SEC08: authenticated can truncate patients';
  end if;
  if not has_table_privilege('authenticated', 'public.patients', 'select') then
    raise exception 'SEC08: authenticated lost select on patients';
  end if;
end $$;

rollback;
