drop policy if exists quota_reservations_service_role_access on private.quota_reservations;
create policy quota_reservations_service_role_access on private.quota_reservations
  for all to service_role using (true) with check (true);
drop policy if exists rate_limit_counters_service_role_access on private.rate_limit_counters;
create policy rate_limit_counters_service_role_access on private.rate_limit_counters
  for all to service_role using (true) with check (true);
