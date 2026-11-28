-- 0017 — Patient app: booking from a doctor's free times; patients may only request or cancel.
--
-- Why: Phase 6 gives patients their own app: upcoming visits, booking,
-- medicines, bills, reports and exercises. To offer real free times a patient
-- must know when a doctor is busy, but must never see who else is booked.
--
-- doctor_busy_times(practitioner, day): the start and length of every
--   appointment holding a slot for that doctor around that day, in the
--   caller's own hospital. No names, reasons or ids. Runs as the database
--   owner (it reads appointments the caller may not), so it returns only
--   times, only for the caller's hospital, and anonymous users cannot call it.
-- appointments_patient_limits (trigger): when a patient (not staff) writes an
--   appointment, they may only create a request (status 'requested', no token,
--   no check-in) and may only cancel a request or booking of their own,
--   changing nothing but the status and the cancel reason. Before this, the
--   row-level policies let a patient set any status, for example "checked in".
--
-- Access is otherwise unchanged.
--
-- Rollback:
--   drop trigger appointments_patient_limits on public.appointments;
--   drop function public.appointments_patient_limits();
--   drop function public.doctor_busy_times(text, date);

create function public.doctor_busy_times(p_practitioner text, p_day date)
returns table (start_time timestamptz, duration_minutes integer)
language sql
stable
security definer
set search_path = public
as $$
  select a.start_time, a.duration_minutes
  from public.appointments a
  where a.org_id = public.current_org_id()
    and a.practitioner_id = p_practitioner
    and a.status in ('requested', 'scheduled', 'checked_in', 'completed')
    and a.start_time >= p_day - interval '1 day'
    and a.start_time < p_day + interval '2 days';
$$;

revoke execute on function public.doctor_busy_times(text, date) from public, anon;
grant execute on function public.doctor_busy_times(text, date) to authenticated;

create function public.appointments_patient_limits()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if public.current_staff_role() is null and public.current_patient_id() is not null then
    if tg_op = 'INSERT' then
      if new.status is distinct from 'requested' or new.token_no is not null or new.checked_in_at is not null then
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
$$;

create trigger appointments_patient_limits before insert or update on public.appointments
  for each row execute function public.appointments_patient_limits();
