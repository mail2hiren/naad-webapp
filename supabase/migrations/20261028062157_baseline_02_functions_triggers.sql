CREATE OR REPLACE FUNCTION public.audit_events_hash_chain()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  prev text;
begin
  select hash into prev from audit_events
   where org_id = new.org_id
   order by ts desc, id desc
   limit 1;
  new.prev_hash := prev;
  new.hash := encode(
    extensions.digest(coalesce(prev,'') || coalesce(new.actor,'') || coalesce(new.action,'') || coalesce(new.detail,'') || new.ts::text, 'sha256'),
    'hex'
  );
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.current_actor_name()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(
    (select name from practitioners where auth_user_id = auth.uid()),
    (select name || ' (Patient)' from patients where auth_user_id = auth.uid())
  );
$function$
;

CREATE OR REPLACE FUNCTION public.current_org_id()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(
    (select org_id from practitioners where auth_user_id = auth.uid()),
    (select org_id from patients where auth_user_id = auth.uid())
  );
$function$
;

CREATE OR REPLACE FUNCTION public.current_patient_id()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select id from patients where auth_user_id = auth.uid();
$function$
;

CREATE OR REPLACE FUNCTION public.current_practitioner_id()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select id from practitioners where auth_user_id = auth.uid();
$function$
;

CREATE OR REPLACE FUNCTION public.current_staff_role()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select role::text from practitioners where auth_user_id = auth.uid();
$function$
;

CREATE OR REPLACE FUNCTION public.enforce_seat_limit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  org record;
  used integer;
begin
  if tg_op = 'UPDATE' and (old.active is not distinct from new.active) and (old.org_id = new.org_id) then
    return new;
  end if;
  if not new.active then
    return new;
  end if;
  select seat_limit, subscription_status into org from public.organizations where id = new.org_id;
  if not found then
    raise exception 'organization not found: %', new.org_id;
  end if;
  if org.subscription_status = 'canceled' then
    raise exception 'subscription_canceled' using errcode = 'check_violation';
  end if;
  select count(*) into used from public.practitioners where org_id = new.org_id and active and id is distinct from new.id;
  if used >= org.seat_limit then
    raise exception 'seat_limit_reached' using errcode = 'check_violation', hint = 'All user seats on this plan are in use. Deactivate a user or upgrade the plan.';
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.link_patient_by_phone(p_phone text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  uid_ uuid;
  matched_id text;
begin
  uid_ := auth.uid();
  if uid_ is null then
    raise exception 'not_authenticated';
  end if;

  select id into matched_id from patients where auth_user_id = uid_;
  if matched_id is not null then
    update patients set phone_verified = true where id = matched_id;
    return matched_id;
  end if;

  select id into matched_id from patients
    where auth_user_id is null
      and phone is not null
      and regexp_replace(phone, '[\s-]', '', 'g') = regexp_replace(p_phone, '[\s-]', '', 'g')
    limit 1;

  if matched_id is null then
    raise exception 'no_matching_patient';
  end if;

  update patients set auth_user_id = uid_, phone_verified = true where id = matched_id;
  return matched_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.org_seat_usage()
 RETURNS TABLE(plan text, subscription_status text, seat_limit integer, seats_used integer, trial_ends_at timestamp with time zone, current_period_end timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ select o.plan, o.subscription_status, o.seat_limit, (select count(*)::integer from public.practitioners p where p.org_id = o.id and p.active), o.trial_ends_at, o.current_period_end from public.organizations o where o.id = public.current_org_id(); $function$
;

CREATE OR REPLACE FUNCTION public.rls_auto_enable()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$
;

revoke execute on function public.enforce_seat_limit() from public, anon, authenticated;
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
revoke execute on function public.link_patient_by_phone(text) from public, anon;
revoke execute on function public.org_seat_usage() from public, anon;
grant execute on function public.link_patient_by_phone(text) to authenticated;
grant execute on function public.org_seat_usage() to authenticated;

CREATE TRIGGER trg_audit_hash_chain BEFORE INSERT ON public.audit_events FOR EACH ROW EXECUTE FUNCTION public.audit_events_hash_chain();
CREATE TRIGGER practitioners_enforce_seat_limit BEFORE INSERT OR UPDATE OF active, org_id ON public.practitioners FOR EACH ROW EXECUTE FUNCTION public.enforce_seat_limit();

alter table public.ai_usage_log enable row level security;
alter table public.appointments enable row level security;
alter table public.audit_events enable row level security;
alter table public.documents enable row level security;
alter table public.encounters enable row level security;
alter table public.exercise_library enable row level security;
alter table public.inventory enable row level security;
alter table public.lab_orders enable row level security;
alter table public.notifications enable row level security;
alter table public.organizations enable row level security;
alter table public.patients enable row level security;
alter table public.pharmacy_orders enable row level security;
alter table public.physiotherapy_plans enable row level security;
alter table public.practitioners enable row level security;
alter table public.prescriptions enable row level security;
alter table public.referrals enable row level security;
alter table public.therapy_sessions enable row level security;
alter table public.transcripts enable row level security;
alter table public.ward_billing_ledger enable row level security;
