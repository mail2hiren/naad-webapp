-- Subscription foundation: per-hospital plan + seat (user) limit.
--
-- Model: one hospital = one `organizations` row. A *seat* is an active staff
-- account (a `practitioners` row with active = true; patients are free).
-- Plan/seat columns are writable only by the service role (no UPDATE policy
-- exists on organizations), so a hospital can never raise its own limit --
-- your billing webhook (Stripe/Razorpay) or an SQL console update changes
-- them. The trigger below enforces the limit at the database, so it cannot be
-- bypassed from the client.

alter table public.organizations
  add column if not exists plan text not null default 'trial',
  add column if not exists subscription_status text not null default 'trialing'
    check (subscription_status in ('trialing','active','past_due','canceled')),
  add column if not exists seat_limit integer not null default 10 check (seat_limit >= 0),
  add column if not exists billing_email text,
  add column if not exists trial_ends_at timestamptz default (now() + interval '30 days'),
  add column if not exists current_period_end timestamptz;

-- Existing pilot hospital: active, with headroom.
update public.organizations
   set plan = 'pilot', subscription_status = 'active', seat_limit = 25
 where id = 'org1' and plan = 'trial';

create or replace function public.enforce_seat_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  org record;
  used integer;
begin
  -- Only matters when the row will count as an active seat.
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

  select count(*) into used from public.practitioners
   where org_id = new.org_id and active and id is distinct from new.id;
  if used >= org.seat_limit then
    raise exception 'seat_limit_reached' using errcode = 'check_violation',
      hint = 'All user seats on this plan are in use. Deactivate a user or upgrade the plan.';
  end if;
  return new;
end;
$$;

drop trigger if exists practitioners_enforce_seat_limit on public.practitioners;
create trigger practitioners_enforce_seat_limit
  before insert or update of active, org_id on public.practitioners
  for each row execute function public.enforce_seat_limit();

-- Read-only usage summary for the signed-in hospital's admin screen.
create or replace function public.org_seat_usage()
returns table (plan text, subscription_status text, seat_limit integer, seats_used integer,
               trial_ends_at timestamptz, current_period_end timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select o.plan, o.subscription_status, o.seat_limit,
         (select count(*)::integer from public.practitioners p where p.org_id = o.id and p.active),
         o.trial_ends_at, o.current_period_end
    from public.organizations o
   where o.id = public.current_org_id();
$$;
revoke all on function public.org_seat_usage() from public, anon;
grant execute on function public.org_seat_usage() to authenticated;
revoke all on function public.enforce_seat_limit() from public, anon, authenticated;
