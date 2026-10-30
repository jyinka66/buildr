create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to service_role;
alter table public.quota_reservations set schema private;
alter table public.rate_limit_counters set schema private;
revoke all on private.quota_reservations from public, anon, authenticated;
revoke all on private.rate_limit_counters from public, anon, authenticated;
grant all on private.quota_reservations to service_role;
grant all on private.rate_limit_counters to service_role;
do $$
declare v_def text;
begin
  select pg_get_functiondef('public.reserve_usage(text,text,integer,integer)'::regprocedure) into v_def;
  execute replace(v_def, 'public.quota_reservations', 'private.quota_reservations');
  select pg_get_functiondef('public.commit_usage_reservation(text,text,integer,integer,text,jsonb,uuid)'::regprocedure) into v_def;
  execute replace(v_def, 'public.quota_reservations', 'private.quota_reservations');
  select pg_get_functiondef('public.release_usage_reservation(text,uuid)'::regprocedure) into v_def;
  execute replace(v_def, 'public.quota_reservations', 'private.quota_reservations');
  select pg_get_functiondef('public.consume_rate_limit(text,integer,integer)'::regprocedure) into v_def;
  execute replace(v_def, 'public.rate_limit_counters', 'private.rate_limit_counters');
end $$;
revoke all on function public.reserve_usage(text,text,integer,integer) from public, anon, authenticated;
revoke all on function public.commit_usage_reservation(text,text,integer,integer,text,jsonb,uuid) from public, anon, authenticated;
revoke all on function public.release_usage_reservation(text,uuid) from public, anon, authenticated;
revoke all on function public.consume_rate_limit(text,integer,integer) from public, anon, authenticated;
grant execute on function public.reserve_usage(text,text,integer,integer) to service_role;
grant execute on function public.commit_usage_reservation(text,text,integer,integer,text,jsonb,uuid) to service_role;
grant execute on function public.release_usage_reservation(text,uuid) to service_role;
grant execute on function public.consume_rate_limit(text,integer,integer) to service_role;
