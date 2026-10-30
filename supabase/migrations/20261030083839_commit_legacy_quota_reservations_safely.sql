create or replace function public.commit_usage_reservation(
  p_owner_id text, p_metric text, p_quantity integer, p_limit integer,
  p_project_id text default null, p_metadata jsonb default '{}'::jsonb, p_reservation_id uuid default null
) returns boolean
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_reservation private.quota_reservations%rowtype;
  v_has_reservation boolean := false;
  v_month_start timestamptz := date_trunc('month', now() at time zone 'UTC') at time zone 'UTC';
  v_used integer := 0;
  v_reserved integer := 0;
begin
  if p_owner_id is null or p_owner_id = '' or p_metric not in ('projects','llm_tokens','businesses','godmode_goals','images','deployments') or p_quantity <= 0 or p_limit < -1 then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_owner_id || ':' || p_metric || ':' || v_month_start::text, 0));
  if p_reservation_id is not null then
    select * into v_reservation from private.quota_reservations where id = p_reservation_id and owner_id = p_owner_id and metric = p_metric and expires_at > now() for update;
    v_has_reservation := found;
    if not v_has_reservation then return false; end if;
  else
    select * into v_reservation from private.quota_reservations
    where owner_id = p_owner_id and metric = p_metric and expires_at > now()
    order by created_at limit 1 for update skip locked;
    v_has_reservation := found;
  end if;
  if p_limit <> -1 then
    select coalesce(sum(quantity),0)::integer into v_used from public.usage_events where owner_id = p_owner_id and metric = p_metric and created_at >= v_month_start;
    select coalesce(sum(quantity),0)::integer into v_reserved from private.quota_reservations where owner_id = p_owner_id and metric = p_metric and expires_at > now();
    if v_has_reservation then v_reserved := greatest(0, v_reserved - v_reservation.quantity); end if;
    if v_used + v_reserved + p_quantity > p_limit then return false; end if;
  end if;
  if v_has_reservation then delete from private.quota_reservations where id = v_reservation.id; end if;
  insert into public.usage_events(owner_id, metric, quantity, project_id, metadata) values (p_owner_id, p_metric, p_quantity, p_project_id, coalesce(p_metadata, '{}'::jsonb));
  return true;
end;
$$;
revoke all on function public.commit_usage_reservation(text,text,integer,integer,text,jsonb,uuid) from public, anon, authenticated;
grant execute on function public.commit_usage_reservation(text,text,integer,integer,text,jsonb,uuid) to service_role;
