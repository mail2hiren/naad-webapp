-- A02: a patient login reads exactly its own patients row; staff still read
-- every patient in their own hospital and none in another.
begin;

insert into auth.users (id) values
  ('00000000-0000-0000-0000-0000000000a1'),  -- patient A (org1)
  ('00000000-0000-0000-0000-0000000000b1'),  -- receptionist (org1)
  ('00000000-0000-0000-0000-0000000000c1');  -- patient C (org2)
insert into public.organizations (id, name) values ('t-org1', 'Test Hospital 1'), ('t-org2', 'Test Hospital 2');
insert into public.practitioners (id, org_id, auth_user_id, name, role)
  values ('t-recep', 't-org1', '00000000-0000-0000-0000-0000000000b1', 'Reception', 'receptionist');
insert into public.patients (id, org_id, auth_user_id, name) values
  ('t-pa', 't-org1', '00000000-0000-0000-0000-0000000000a1', 'Patient A'),
  ('t-pb', 't-org1', null, 'Patient B'),
  ('t-pc', 't-org2', '00000000-0000-0000-0000-0000000000c1', 'Patient C');

set local role authenticated;

-- Patient A
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
do $$
declare ids text;
begin
  select string_agg(id, ',' order by id) into ids from public.patients;
  if ids is distinct from 't-pa' then
    raise exception 'patient login should see only its own row, saw: %', ids;
  end if;
  -- The portal's own query (filtering by hospital) must not widen it either.
  select string_agg(id, ',' order by id) into ids from public.patients where org_id = 't-org1';
  if ids is distinct from 't-pa' then
    raise exception 'patient login filtering by its hospital saw: %', ids;
  end if;
end $$;

-- Receptionist in org1
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}';
do $$
declare ids text;
begin
  select string_agg(id, ',' order by id) into ids from public.patients;
  if ids is distinct from 't-pa,t-pb' then
    raise exception 'staff should see their hospital''s patients only, saw: %', ids;
  end if;
end $$;

-- Signed out (anon key only)
reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
do $$
begin
  if exists (select 1 from public.patients) then
    raise exception 'anon can read patients';
  end if;
end $$;

rollback;
