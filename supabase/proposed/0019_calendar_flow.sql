-- 0019 — Calendar: full patient flow (with doctor, checked out), overbooking, repeat courses, blocked time.
--
-- Why: the reception calendar is being rebuilt to a complete product (see
-- docs/specs/calendar.md). The front desk needs to see each patient's step
-- with its time (arrived, with doctor, done), to overbook on purpose, to book a
-- course of repeat visits, and to block a doctor's time for leave, surgery or a
-- holiday.
--
-- appointments:
--   status 'in_consultation' (with the doctor), between checked in and done;
--   called_in_at and completed_at (when the doctor called the patient in, and
--   when the visit ended); overbooked (booked on purpose over another);
--   series_id (the visits of one repeat course share it).
-- calendar_blocks (new): time a doctor (or, with no doctor, the whole hospital)
--   cannot be booked, with a kind and a reason.
-- appointment_waitlist (new): patients who want an earlier or a specific time;
--   when a booking is cancelled the calendar offers the freed time to them.
-- my_queue_status() (new): a signed-in patient sees, for today's visits only,
--   their token, step, how many patients are ahead of them with the same
--   doctor and an estimated wait. It returns counts only, never other
--   patients' names.
-- appointments_patient_limits (0017 trigger) also refuses a patient setting
--   the new staff-only fields (called in, done, overbooked).
--
-- Access: all staff of the hospital read blocks; reception and the admin
-- create, change and remove them (a block is planning, not a clinical record).
-- Appointment access is unchanged; the patient trigger from 0017 still lets a
-- patient only request or cancel.
--
-- Rollback:
--   drop function public.my_queue_status();
--   alter publication supabase_realtime drop table public.appointment_waitlist;
--   drop table public.appointment_waitlist;
--   (restore appointments_patient_limits from 20261128091221_patient_app)
--   alter publication supabase_realtime drop table public.calendar_blocks;
--   drop table public.calendar_blocks;
--   alter table public.appointments drop column called_in_at, drop column completed_at,
--     drop column overbooked, drop column series_id;
--   alter table public.appointments drop constraint appointments_status_check;
--   alter table public.appointments add constraint appointments_status_check
--     check (status = any (array['requested', 'scheduled', 'checked_in', 'completed', 'cancelled', 'no_show']));

alter table public.appointments drop constraint appointments_status_check;
alter table public.appointments add constraint appointments_status_check
  check (status = any (array['requested', 'scheduled', 'checked_in', 'in_consultation', 'completed', 'cancelled', 'no_show']));

alter table public.appointments
  add column called_in_at timestamptz,
  add column completed_at timestamptz,
  add column overbooked boolean not null default false,
  add column series_id text;

create index appointments_series on public.appointments (series_id) where series_id is not null;

create table public.calendar_blocks (
  id text primary key,
  org_id text not null references public.organizations (id),
  practitioner_id text references public.practitioners (id),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  kind text not null default 'other' check (kind in ('leave', 'surgery', 'meeting', 'holiday', 'other')),
  reason text,
  created_by text,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create index calendar_blocks_time on public.calendar_blocks (org_id, starts_at);

alter table public.calendar_blocks enable row level security;

create policy calendar_blocks_read on public.calendar_blocks for select to authenticated
  using (org_id = public.current_org_id() and public.current_staff_role() is not null);
create policy calendar_blocks_insert on public.calendar_blocks for insert to authenticated
  with check (org_id = public.current_org_id() and public.current_staff_role() in ('receptionist', 'admin'));
create policy calendar_blocks_update on public.calendar_blocks for update to authenticated
  using (org_id = public.current_org_id() and public.current_staff_role() in ('receptionist', 'admin'))
  with check (org_id = public.current_org_id());
create policy calendar_blocks_delete on public.calendar_blocks for delete to authenticated
  using (org_id = public.current_org_id() and public.current_staff_role() in ('receptionist', 'admin'));

alter publication supabase_realtime add table public.calendar_blocks;

create table public.appointment_waitlist (
  id text primary key,
  org_id text not null references public.organizations (id),
  patient_id text not null references public.patients (id),
  practitioner_id text references public.practitioners (id),
  from_day date not null,
  to_day date not null,
  part_of_day text not null default 'any' check (part_of_day in ('any', 'morning', 'evening')),
  visit_type text not null default 'consultation' check (visit_type in ('consultation', 'follow_up', 'therapy', 'procedure')),
  note text,
  status text not null default 'waiting' check (status in ('waiting', 'booked', 'removed')),
  appointment_id text references public.appointments (id),
  created_by text,
  created_at timestamptz not null default now(),
  check (to_day >= from_day)
);

create index appointment_waitlist_open on public.appointment_waitlist (org_id, status, from_day);

alter table public.appointment_waitlist enable row level security;

create policy appointment_waitlist_read on public.appointment_waitlist for select to authenticated
  using (org_id = public.current_org_id() and public.current_staff_role() is not null);
create policy appointment_waitlist_insert on public.appointment_waitlist for insert to authenticated
  with check (org_id = public.current_org_id() and public.current_staff_role() in ('receptionist', 'admin'));
create policy appointment_waitlist_update on public.appointment_waitlist for update to authenticated
  using (org_id = public.current_org_id() and public.current_staff_role() in ('receptionist', 'admin'))
  with check (org_id = public.current_org_id());

alter publication supabase_realtime add table public.appointment_waitlist;

create or replace function public.appointments_patient_limits()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
begin
  if public.current_staff_role() is null and public.current_patient_id() is not null then
    if tg_op = 'INSERT' then
      if new.status is distinct from 'requested' or new.token_no is not null or new.checked_in_at is not null
         or new.called_in_at is not null or new.completed_at is not null or new.overbooked then
        raise exception 'patients_can_only_request'
          using errcode = '42501', hint = 'A patient can ask for an appointment; the front desk confirms it.';
      end if;
      new.requested_by_patient := true;
    elsif tg_op = 'UPDATE' then
      if new.status is distinct from 'cancelled' or old.status not in ('requested', 'scheduled')
         or (to_jsonb(new) - array['status', 'cancel_reason']) is distinct from (to_jsonb(old) - array['status', 'cancel_reason']) then
        raise exception 'patients_can_only_cancel'
          using errcode = '42501', hint = 'A patient can cancel their own request or booking, nothing else.';
      end if;
    end if;
  end if;
  return new;
end;
$function$;

-- Today's visits of the signed-in patient, with their place in the queue.
-- "ahead" = patients of the same doctor today who arrived earlier and are
-- still waiting, plus anyone with the doctor now. The wait estimate uses the
-- doctor's slot length per patient ahead.
create or replace function public.my_queue_status()
 returns table (appointment_id text, practitioner_id text, start_time timestamptz, status text,
                token_no integer, ahead integer, est_wait_minutes integer)
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  with mine as (
    select a.* from public.appointments a
    where public.current_patient_id() is not null
      and a.patient_id = public.current_patient_id()
      and a.status in ('scheduled', 'checked_in', 'in_consultation')
      and (a.start_time at time zone 'Asia/Kolkata')::date = (now() at time zone 'Asia/Kolkata')::date
  ), counted as (
    select m.*,
      (select count(*)::int from public.appointments b
        where b.org_id = m.org_id and b.practitioner_id = m.practitioner_id and b.id <> m.id
          and (b.start_time at time zone 'Asia/Kolkata')::date = (m.start_time at time zone 'Asia/Kolkata')::date
          and m.status <> 'in_consultation'
          and (b.status = 'in_consultation'
               or (b.status = 'checked_in' and (m.status = 'scheduled' or b.checked_in_at < m.checked_in_at)))) as n_ahead
    from mine m
  )
  select c.id, c.practitioner_id, c.start_time, c.status, c.token_no, c.n_ahead,
    c.n_ahead * coalesce(p.slot_minutes, case when p.role = 'physio' then 30 else 15 end)
  from counted c left join public.practitioners p on p.id = c.practitioner_id
  order by c.start_time;
$function$;

revoke all on function public.my_queue_status() from public, anon;
grant execute on function public.my_queue_status() to authenticated;
