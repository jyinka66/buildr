-- Atomic quota reservations and distributed rate limits.
-- These internal tables intentionally have RLS enabled without client policies:
-- only the server-side service_role may use the narrowly granted RPC functions.
create table if not exists public.quota_reservations (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null references public.users(id) on delete cascade,
  metric text not null check (metric in ('projects','llm_tokens','businesses','godmode_goals','images','deployments')),
  quantity integer not null check (quantity > 0),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '10 minutes')
);
create index if not exists idx_quota_reservations_owner_metric_expiry on public.quota_reservations(owner_id, metric, expires_at);
alter table public.quota_reservations enable row level security;
revoke all on public.quota_reservations from public, anon, authenticated;
grant all on public.quota_reservations to service_role;

create table if not exists public.rate_limit_counters (
  key_hash text primary key check (length(key_hash) = 64),
  window_started_at timestamptz not null,
  request_count integer not null check (request_count >= 0),
  updated_at timestamptz not null default now()
);
alter table public.rate_limit_counters enable row level security;
revoke all on public.rate_limit_counters from public, anon, authenticated;
grant all on public.rate_limit_counters to service_role;

create or replace function public.reserve_usage(
  p_owner_id text, p_metric text, p_quantity integer, p_limit integer
) returns table(ok boolean, used integer, limit_value integer, reserved_quantity integer, reservation_id uuid)
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_used integer := 0;
  v_reserved integer := 0;
  v_quantity integer := p_quantity;
  v_reservation_id uuid;
  v_month_start timestamptz := date_trunc('month', now() at time zone 'UTC') at time zone 'UTC';
begin
  if p_owner_id is null or p_owner_id = '' or p_metric not in ('projects','llm_tokens','businesses','godmode_goals','images','deployments') or p_quantity < 0 or p_limit < -1 then
    return query select false, 0, p_limit, 0, null::uuid; return;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_owner_id || ':' || p_metric || ':' || v_month_start::text, 0));
  delete from public.quota_reservations where owner_id = p_owner_id and metric = p_metric and expires_at <= now();
  select coalesce(sum(quantity),0)::integer into v_used from public.usage_events
    where owner_id = p_owner_id and metric = p_metric and created_at >= v_month_start;
  select coalesce(sum(quantity),0)::integer into v_reserved from public.quota_reservations
    where owner_id = p_owner_id and metric = p_metric and expires_at > now();
  if p_limit = -1 then return query select true, v_used + v_reserved, p_limit, 0, null::uuid; return; end if;
  if p_quantity = 0 then v_quantity := p_limit - v_used - v_reserved; end if;
  if v_quantity <= 0 or v_used + v_reserved + v_quantity > p_limit then
    return query select false, v_used + v_reserved, p_limit, 0, null::uuid; return;
  end if;
  insert into public.quota_reservations(owner_id, metric, quantity) values (p_owner_id, p_metric, v_quantity) returning id into v_reservation_id;
  return query select true, v_used + v_reserved, p_limit, v_quantity, v_reservation_id;
end;
$$;

create or replace function public.commit_usage_reservation(
  p_owner_id text, p_metric text, p_quantity integer, p_limit integer,
  p_project_id text default null, p_metadata jsonb default '{}'::jsonb, p_reservation_id uuid default null
) returns boolean
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_reservation public.quota_reservations%rowtype;
  v_has_reservation boolean := false;
  v_month_start timestamptz := date_trunc('month', now() at time zone 'UTC') at time zone 'UTC';
  v_used integer := 0;
  v_reserved integer := 0;
begin
  if p_owner_id is null or p_owner_id = '' or p_metric not in ('projects','llm_tokens','businesses','godmode_goals','images','deployments') or p_quantity <= 0 or p_limit < -1 then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_owner_id || ':' || p_metric || ':' || v_month_start::text, 0));
  if p_reservation_id is not null then
    select * into v_reservation from public.quota_reservations
    where id = p_reservation_id and owner_id = p_owner_id and metric = p_metric and expires_at > now()
    for update;
    v_has_reservation := found;
    if not v_has_reservation then return false; end if;
  else
    -- Existing callers may omit the reservation ID; consume one matching
    -- reservation under the same advisory lock rather than double-counting it.
    select * into v_reservation from public.quota_reservations
    where owner_id = p_owner_id and metric = p_metric and expires_at > now()
    order by created_at limit 1 for update skip locked;
    v_has_reservation := found;
  end if;
  if p_limit <> -1 then
    select coalesce(sum(quantity),0)::integer into v_used from public.usage_events
      where owner_id = p_owner_id and metric = p_metric and created_at >= v_month_start;
    select coalesce(sum(quantity),0)::integer into v_reserved from public.quota_reservations
      where owner_id = p_owner_id and metric = p_metric and expires_at > now();
    if v_has_reservation then v_reserved := greatest(0, v_reserved - v_reservation.quantity); end if;
    if v_used + v_reserved + p_quantity > p_limit then return false; end if;
  end if;
  if v_has_reservation then delete from public.quota_reservations where id = v_reservation.id; end if;
  insert into public.usage_events(owner_id, metric, quantity, project_id, metadata)
  values (p_owner_id, p_metric, p_quantity, p_project_id, coalesce(p_metadata, '{}'::jsonb));
  return true;
end;
$$;

create or replace function public.release_usage_reservation(p_owner_id text, p_reservation_id uuid)
returns boolean
language plpgsql
set search_path = public, pg_temp
as $$
declare v_deleted integer;
begin
  if p_owner_id is null or p_reservation_id is null then return false; end if;
  delete from public.quota_reservations where id = p_reservation_id and owner_id = p_owner_id;
  get diagnostics v_deleted = row_count;
  return v_deleted = 1;
end;
$$;

create or replace function public.consume_rate_limit(p_key_hash text, p_limit integer, p_window_seconds integer)
returns table(allowed boolean, remaining integer, reset_ms bigint)
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_count integer;
  v_started timestamptz;
  v_now timestamptz := clock_timestamp();
begin
  if p_key_hash is null or length(p_key_hash) <> 64 or p_limit < 1 or p_window_seconds < 1 then
    return query select false, 0, greatest(coalesce(p_window_seconds,1),1)::bigint * 1000; return;
  end if;
  if random() < 0.01 then delete from public.rate_limit_counters where updated_at < v_now - interval '1 day'; end if;
  insert into public.rate_limit_counters(key_hash, window_started_at, request_count, updated_at)
  values (p_key_hash, v_now, 1, v_now)
  on conflict (key_hash) do update set
    window_started_at = case when public.rate_limit_counters.window_started_at + make_interval(secs => p_window_seconds) <= v_now then v_now else public.rate_limit_counters.window_started_at end,
    request_count = case when public.rate_limit_counters.window_started_at + make_interval(secs => p_window_seconds) <= v_now then 1 else public.rate_limit_counters.request_count + 1 end,
    updated_at = v_now
  returning public.rate_limit_counters.request_count, public.rate_limit_counters.window_started_at into v_count, v_started;
  return query select v_count <= p_limit, greatest(p_limit - v_count,0),
    greatest(0, ceil(extract(epoch from (v_started + make_interval(secs => p_window_seconds) - v_now)) * 1000))::bigint;
end;
$$;

revoke all on function public.reserve_usage(text,text,integer,integer) from public, anon, authenticated;
revoke all on function public.commit_usage_reservation(text,text,integer,integer,text,jsonb,uuid) from public, anon, authenticated;
revoke all on function public.release_usage_reservation(text,uuid) from public, anon, authenticated;
revoke all on function public.consume_rate_limit(text,integer,integer) from public, anon, authenticated;
grant execute on function public.reserve_usage(text,text,integer,integer) to service_role;
grant execute on function public.commit_usage_reservation(text,text,integer,integer,text,jsonb,uuid) to service_role;
grant execute on function public.release_usage_reservation(text,uuid) to service_role;
grant execute on function public.consume_rate_limit(text,integer,integer) to service_role;
