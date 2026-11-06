-- 0006 — First hospital + staff accounts (TEMPLATE: fill the <placeholders>).
--
-- Gap: the Naad database has 0 organizations, 0 practitioners, 0 auth users.
-- Nobody can sign in: AuthContext requires an active practitioners row linked
-- to the auth user, and every RLS policy keys off it.
--
-- Step 1 (free, no SQL): Supabase Dashboard → Authentication → Users →
--   "Add user" → email + password, tick "Auto confirm" — one per person.
-- Step 2: fill in below and apply. Rows whose email has no auth user are
--   skipped (the join), so it is safe to re-run after adding users.
--
-- ai_monthly_budget_usd is the hard stop for paid AI (Deepgram + Claude).
-- The column default is 45. With a $0/month budget, decide this number
-- deliberately: 0 = AI calls refused with HTTP 402 and the app falls back to
-- typing; live mic capture still records, but nothing is transcribed.

insert into public.organizations (id, name, city, plan, subscription_status, seat_limit, ai_monthly_budget_usd)
values ('<org-id e.g. org-hospital1>', '<Hospital name>', '<City>', 'pilot', 'active', 10, <budget USD>)
on conflict (id) do nothing;

insert into public.practitioners (id, org_id, auth_user_id, name, role, title, specialty)
select v.id, '<org-id e.g. org-hospital1>', u.id, v.name, v.role::public.staff_role, v.title, v.specialty
  from (values
    ('pr-surgeon-1',  '<surgeon email>',      '<Dr Name>', 'surgeon',      'Orthopaedic Surgeon', 'Orthopedics'),
    ('pr-physio-1',   '<physio email>',       '<Name>',    'physio',       'Physiotherapist',     'Physiotherapy'),
    ('pr-recept-1',   '<receptionist email>', '<Name>',    'receptionist', 'Front Desk',          null),
    ('pr-pharm-1',    '<pharmacist email>',   '<Name>',    'pharmacist',   'Pharmacist',          null),
    ('pr-admin-1',    '<admin email>',        '<Name>',    'admin',        'Hospital Admin',      null)
  ) as v(id, email, name, role, title, specialty)
  join auth.users u on lower(u.email) = lower(v.email)
on conflict (id) do nothing;

-- Patient role: patient rows are created by Reception. To give a patient a
-- portal login, create their auth user (step 1), then:
--   update public.patients set auth_user_id = (select id from auth.users where lower(email) = lower('<patient email>'))
--    where id = '<patient id>';
