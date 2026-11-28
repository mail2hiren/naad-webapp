-- 0009 — Physiotherapy plans: details, home exercise programme; editable sessions.
--
-- Why: the tables for therapy plans, sessions and the exercise library already
-- exist (baseline) but no screen uses them. Phase 3 builds the physio module:
-- a caseload of plans, a session-by-session record with progress, an
-- exercise library and a home exercise programme the patient sees.
-- A plan needs to know who is treating, for what, how often and until when;
-- the home programme is a short list stored on the plan.
--
-- Access is unchanged: plans/sessions are read by the hospital's staff and by
-- the patient they belong to; physios create and update them (existing
-- policies). New: a physio may correct a session record in their hospital
-- (there was no UPDATE policy on therapy_sessions, so typos were permanent).
--
-- Rollback:
--   drop policy sessions_update on public.therapy_sessions;
--   alter table public.exercise_library drop column instructions;
--   alter table public.physiotherapy_plans drop column practitioner_id, drop column condition,
--     drop column start_date, drop column planned_sessions, drop column sessions_per_week,
--     drop column review_date, drop column home_programme;

alter table public.physiotherapy_plans
  add column practitioner_id text references public.practitioners (id),
  add column condition text,
  add column start_date date not null default current_date,
  add column planned_sessions integer check (planned_sessions is null or planned_sessions between 1 and 200),
  add column sessions_per_week integer check (sessions_per_week is null or sessions_per_week between 1 and 14),
  add column review_date date,
  add column home_programme jsonb not null default '[]'::jsonb;

alter table public.exercise_library
  add column instructions text;

create policy sessions_update on public.therapy_sessions for update to authenticated
  using (org_id = public.current_org_id() and public.current_staff_role() = 'physio')
  with check (org_id = public.current_org_id());
