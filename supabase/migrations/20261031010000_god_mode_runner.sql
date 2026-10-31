-- God Mode runner: a lease so only one request advances a goal at a time.
-- The runner takes the lease with a conditional update (lease_until null or in
-- the past), runs one task, then clears it. A request that dies leaves a lease
-- that simply expires, after which the goal can be picked up again.
alter table public.god_mode_goals add column if not exists lease_until timestamptz;
create index if not exists idx_godmode_running on public.god_mode_goals(status, lease_until)
  where status = 'running';
