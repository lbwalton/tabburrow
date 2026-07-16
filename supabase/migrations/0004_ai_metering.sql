-- T19: race-safe AI-organize metering.
--
-- Design: the ai-organize Edge Function must check-and-increment
-- `profiles.ai_uses_count` atomically: a naive "SELECT count, then
-- UPDATE count+1 from the function" is a classic TOCTOU race: two
-- concurrent requests from the same user could both read count=29 (limit
-- 30) and both proceed. Instead, the check+increment lives entirely in
-- this one SQL function, which takes a row lock (`for update`) on the
-- caller's `profiles` row for the duration of the call, so a second
-- concurrent call for the SAME user blocks until the first one's
-- increment (or non-increment) has committed. Different users never
-- contend with each other since the lock is per-row.
--
-- Consequence: because the increment happens BEFORE the Anthropic call
-- (the function needs to know "did this attempt already spend a use" up
-- front, deciding whether to call Anthropic at all), a downstream failure
-- (Anthropic errors, or the model's output fails shape validation twice)
-- must be compensated with an explicit decrement: `refund_ai_use`. This
-- keeps "count untouched on failure" true (per task-19-brief.md) without
-- reintroducing a check-then-act race: increment-then-maybe-refund is the
-- atomic unit here, not a single unconditional increment.
--
-- Both functions are SECURITY DEFINER (run with the table owner's
-- privileges, bypassing RLS; profiles has no user-facing write policy
-- at all, see 0001_init.sql) and granted to `service_role` ONLY: the
-- ai-organize function calls them with its service-role client, never the
-- caller's own (anon-key) JWT, so an authenticated user can never invoke
-- these directly over PostgREST and manipulate their own quota.

create or replace function public.consume_ai_use(p_user_id uuid, p_free_limit int, p_soft_cap int)
returns table(allowed boolean, used int, plan text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan text;
  v_period_start date;
  v_count int;
  v_limit int;
  v_allowed boolean;
  v_current_month date := date_trunc('month', now())::date;
begin
  select p.plan, p.ai_uses_period_start, p.ai_uses_count
    into v_plan, v_period_start, v_count
    from public.profiles p
    where p.user_id = p_user_id
    for update;

  if not found then
    raise exception 'consume_ai_use: no profile for user %', p_user_id;
  end if;

  -- Month rollover: a stored period start older than the current calendar
  -- month means this is the first use this month; reset the counter.
  if v_current_month > v_period_start then
    v_period_start := v_current_month;
    v_count := 0;
  end if;

  v_limit := case when v_plan = 'pro' then p_soft_cap else p_free_limit end;
  v_allowed := v_count < v_limit;

  if v_allowed then
    v_count := v_count + 1;
  end if;

  update public.profiles
    set ai_uses_period_start = v_period_start,
        ai_uses_count = v_count
    where user_id = p_user_id;

  return query select v_allowed, v_count, v_plan;
end;
$$;

-- This local/hosted Supabase stack's own `ALTER DEFAULT PRIVILEGES` (set
-- up by Supabase's project bootstrap, not this repo) grants EXECUTE on
-- every NEW function in `public` to anon/authenticated/service_role
-- automatically at creation time: `revoke ... from public` alone does
-- NOT undo that, since those are direct per-role grants, not grants to
-- the PUBLIC pseudo-role. Both `anon` and `authenticated` must be revoked
-- explicitly for "service_role only" to actually hold.
revoke all on function public.consume_ai_use(uuid, int, int) from public, anon, authenticated;
grant execute on function public.consume_ai_use(uuid, int, int) to service_role;

-- Decrements ai_uses_count by 1, floored at 0 (never goes negative even if
-- called more than once for the same failed attempt, or racing a rollover
-- that already reset the counter to 0). No row lock needed beyond the
-- UPDATE's own row-level lock: this is a single unconditional statement,
-- there's no read-then-decide step to race.
create or replace function public.refund_ai_use(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
    set ai_uses_count = greatest(ai_uses_count - 1, 0)
    where user_id = p_user_id;
end;
$$;

revoke all on function public.refund_ai_use(uuid) from public, anon, authenticated;
grant execute on function public.refund_ai_use(uuid) to service_role;
