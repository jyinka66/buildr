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
revoke all on function public.release_usage_reservation(text, uuid) from public, anon, authenticated;
grant execute on function public.release_usage_reservation(text, uuid) to service_role;
