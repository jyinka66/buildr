-- Buildr — Supabase schema (PostgreSQL)
-- Run this in the Supabase SQL Editor or via: supabase db push

create extension if not exists "pgcrypto";

-- users ---------------------------------------------------------------------
create table if not exists public.users (
  id               text primary key default gen_random_uuid(),
  email            text unique not null,
  name             text,
  password         text not null,
  email_verified   boolean not null default false,
  verify_token     text,
  reset_token      text,
  reset_expires    timestamptz,
  is_admin         boolean not null default false,
  is_disabled      boolean not null default false,
  totp_secret      text,
  totp_enabled     boolean not null default false,
  totp_backup_codes text,
  onboarding_completed boolean not null default false,
  onboarding_step  text not null default 'welcome',
  onboarding_skipped_at timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- projects ------------------------------------------------------------------
create table if not exists public.projects (
  id            text primary key default gen_random_uuid(),
  name          text not null,
  slug          text unique not null,
  description   text not null default '',
  stack         text not null default 'nextjs',
  styling       text not null default 'tailwind',
  prompt        text not null default '',
  provider_id   text,
  integrations  jsonb not null default '[]',
  db_config     jsonb not null default '{}',
  status        text not null default 'draft',
  preview_url   text,
  deployment_url text,
  owner_id      text not null references public.users(id) on delete cascade,
  workspace_id  text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_projects_owner on public.projects(owner_id);
create index if not exists idx_projects_slug on public.projects(slug);

-- project_files -------------------------------------------------------------
create table if not exists public.project_files (
  id          text primary key default gen_random_uuid(),
  project_id  text not null references public.projects(id) on delete cascade,
  path        text not null,
  content     text not null default '',
  language    text not null default 'text',
  generated   boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (project_id, path)
);
create index if not exists idx_project_files_project on public.project_files(project_id);

-- generations ---------------------------------------------------------------
create table if not exists public.generations (
  id           text primary key default gen_random_uuid(),
  project_id   text not null references public.projects(id) on delete cascade,
  role         text not null,
  content      text not null default '',
  file_ops     jsonb not null default '[]',
  provider_id  text,
  tokens       integer not null default 0,
  duration_ms  integer not null default 0,
  created_at   timestamptz not null default now()
);
create index if not exists idx_generations_project on public.generations(project_id);

-- llm_providers -------------------------------------------------------------
create table if not exists public.llm_providers (
  id          text primary key default gen_random_uuid(),
  key         text unique not null,
  name        text not null,
  model       text not null,
  api_key     text not null default '',
  base_url    text,
  enabled     boolean not null default true,
  weight      integer not null default 1,
  speciality  text not null default 'general',
  health      text not null default 'healthy',
  last_checked timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- integrations --------------------------------------------------------------
create table if not exists public.integrations (
  id          text primary key default gen_random_uuid(),
  key         text unique not null,
  name        text not null,
  description text not null default '',
  category    text not null default 'general',
  icon        text not null default 'boxes',
  env_vars    jsonb not null default '[]',
  enabled     boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- deployments ---------------------------------------------------------------
create table if not exists public.deployments (
  id          text primary key default gen_random_uuid(),
  project_id  text not null references public.projects(id) on delete cascade,
  environment text not null default 'preview',
  status      text not null default 'queued',
  url         text,
  repo        text,
  branch      text,
  commit_sha  text,
  logs        text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_deployments_project on public.deployments(project_id);

-- businesses ----------------------------------------------------------------
create table if not exists public.businesses (
  id              text primary key default gen_random_uuid(),
  owner_id        text not null references public.users(id) on delete cascade,
  name            text not null,
  slug            text unique not null,
  description     text not null default '',
  idea            text not null,
  mission         text not null default '',
  vision          text not null default '',
  value_prop      text not null default '',
  target_audience text not null default '',
  competitors     jsonb not null default '[]',
  business_model  jsonb not null default '{}',
  brand_colors    jsonb not null default '{}',
  brand_fonts     jsonb not null default '{}',
  pricing_plans   jsonb not null default '[]',
  project_id      text,
  status          text not null default 'planning',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_businesses_owner on public.businesses(owner_id);

-- jobs ----------------------------------------------------------------------
create table if not exists public.jobs (
  id              text primary key default gen_random_uuid(),
  owner_id        text not null references public.users(id) on delete cascade,
  title           text not null,
  description     text not null,
  job_type        text not null default 'website',
  client_name     text,
  client_email    text,
  scope           jsonb not null default '{}',
  tasks           jsonb not null default '[]',
  deliverables    jsonb not null default '[]',
  project_id      text,
  status          text not null default 'intake',
  budget          numeric,
  deadline        timestamptz,
  client_portal_token_hash text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_jobs_owner on public.jobs(owner_id);
create index if not exists idx_jobs_status on public.jobs(status);
alter table public.jobs add column if not exists client_portal_token_hash text;
create unique index if not exists idx_jobs_client_portal_token_hash on public.jobs(client_portal_token_hash) where client_portal_token_hash is not null;

-- god_mode_goals ------------------------------------------------------------
create table if not exists public.god_mode_goals (
  id              text primary key default gen_random_uuid(),
  owner_id        text not null references public.users(id) on delete cascade,
  goal            text not null,
  timeframe_hours integer not null default 24,
  task_graph      jsonb not null default '[]',
  progress        jsonb not null default '{}',
  current_task    text,
  status          text not null default 'queued',
  project_id      text,
  result_summary  text not null default '',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_godmode_owner on public.god_mode_goals(owner_id);
create index if not exists idx_godmode_status on public.god_mode_goals(status);

-- marketing_campaigns --------------------------------------------------------
create table if not exists public.marketing_campaigns (
  id            text primary key default gen_random_uuid(),
  owner_id      text not null references public.users(id) on delete cascade,
  business_id   text,
  project_id    text,
  campaign_type text not null default 'social',
  platform      text not null default 'all',
  content       jsonb not null default '{}',
  schedule      jsonb not null default '{}',
  status        text not null default 'draft',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_campaigns_owner on public.marketing_campaigns(owner_id);

-- subscriptions -------------------------------------------------------------
create table if not exists public.subscriptions (
  id                  text primary key default gen_random_uuid(),
  owner_id            text not null unique references public.users(id) on delete cascade,
  plan_id             text not null default 'free',
  status              text not null default 'active',
  current_period_start timestamptz,
  current_period_end  timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists idx_subscriptions_owner on public.subscriptions(owner_id);

-- usage_events --------------------------------------------------------------
create table if not exists public.usage_events (
  id          text primary key default gen_random_uuid(),
  owner_id    text not null references public.users(id) on delete cascade,
  metric      text not null,
  quantity    integer not null default 1,
  project_id  text,
  metadata    jsonb not null default '{}',
  created_at  timestamptz not null default now()
);
create index if not exists idx_usage_owner_metric on public.usage_events(owner_id, metric, created_at desc);

-- notifications --------------------------------------------------------------
create table if not exists public.notifications (
  id          text primary key default gen_random_uuid(),
  owner_id    text not null references public.users(id) on delete cascade,
  source      text not null default 'system',
  severity    text not null default 'info',
  title       text not null,
  message     text not null default '',
  link_type   text,
  link_id     text,
  action_url  text,
  metadata    jsonb not null default '{}',
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists idx_notifications_owner on public.notifications(owner_id);
create index if not exists idx_notifications_unread on public.notifications(owner_id) where read_at is null;

-- cron_jobs -----------------------------------------------------------------
create table if not exists public.cron_jobs (
  id            text primary key default gen_random_uuid(),
  owner_id      text not null references public.users(id) on delete cascade,
  project_id    text,
  name          text not null,
  description   text not null default '',
  prompt        text not null,
  schedule      text not null default 'daily',
  schedule_cron text,
  enabled       boolean not null default true,
  last_run_at   timestamptz,
  next_run_at   timestamptz,
  last_status   text not null default 'idle',
  last_output   text not null default '',
  run_count     integer not null default 0,
  fail_count    integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_cron_jobs_owner on public.cron_jobs(owner_id);

-- monitoring_events ---------------------------------------------------------
create table if not exists public.monitoring_events (
  id            text primary key default gen_random_uuid(),
  owner_id      text not null references public.users(id) on delete cascade,
  project_id    text,
  kind          text not null default 'ping',
  status        text not null default 'ok',
  message       text not null default '',
  response_ms   integer,
  status_code   integer,
  url           text,
  metadata      jsonb not null default '{}',
  checked_at    timestamptz not null default now()
);
create index if not exists idx_monitoring_owner on public.monitoring_events(owner_id);
create index if not exists idx_monitoring_checked on public.monitoring_events(checked_at desc);

-- heal_actions --------------------------------------------------------------
create table if not exists public.heal_actions (
  id            text primary key default gen_random_uuid(),
  owner_id      text not null references public.users(id) on delete cascade,
  project_id    text not null,
  trigger_event text not null default 'manual',
  diagnosis     jsonb not null default '{}',
  fix_applied   jsonb not null default '{}',
  status        text not null default 'analyzing',
  summary       text not null default '',
  before_state  jsonb not null default '{}',
  after_state   jsonb not null default '{}',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_heal_owner on public.heal_actions(owner_id);
create index if not exists idx_heal_status on public.heal_actions(status);

-- support_tickets -----------------------------------------------------------
create table if not exists public.support_tickets (
  id              text primary key default gen_random_uuid(),
  owner_id        text not null references public.users(id) on delete cascade,
  project_id      text,
  business_id     text,
  subject         text not null,
  message         text not null,
  customer_email  text not null,
  customer_name   text,
  status          text not null default 'new',
  priority        text not null default 'normal',
  category        text not null default 'general',
  ai_response     text not null default '',
  ai_confidence   numeric,
  csat_rating     integer,
  csat_comment    text,
  tags            text not null default '[]',
  resolved_at     timestamptz,
  escalated_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_tickets_owner on public.support_tickets(owner_id);
create index if not exists idx_tickets_status on public.support_tickets(status);

-- support_messages ----------------------------------------------------------
create table if not exists public.support_messages (
  id          text primary key default gen_random_uuid(),
  ticket_id   text not null references public.support_tickets(id) on delete cascade,
  role        text not null,
  content     text not null default '',
  metadata    jsonb not null default '{}',
  created_at  timestamptz not null default now()
);
create index if not exists idx_messages_ticket on public.support_messages(ticket_id);

-- api_keys ------------------------------------------------------------------
create table if not exists public.api_keys (
  id            text primary key default gen_random_uuid(),
  owner_id      text not null references public.users(id) on delete cascade,
  name          text not null,
  token_hash    text not null unique,
  token_prefix  text not null,
  scopes        jsonb not null default '[]',
  last_used_at  timestamptz,
  last_used_ip  text,
  request_count integer not null default 0,
  expires_at    timestamptz,
  revoked_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_api_keys_owner on public.api_keys(owner_id);

-- webhooks ------------------------------------------------------------------
create table if not exists public.webhooks (
  id              text primary key default gen_random_uuid(),
  owner_id        text not null references public.users(id) on delete cascade,
  url             text not null,
  secret          text not null,
  events          jsonb not null default '[]',
  description     text not null default '',
  enabled         boolean not null default true,
  last_triggered_at timestamptz,
  last_status     text,
  last_status_code integer,
  delivery_count  integer not null default 0,
  fail_count      integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_webhooks_owner on public.webhooks(owner_id);

-- webhook_deliveries --------------------------------------------------------
create table if not exists public.webhook_deliveries (
  id              text primary key default gen_random_uuid(),
  owner_id        text not null references public.users(id) on delete cascade,
  webhook_id      text not null references public.webhooks(id) on delete cascade,
  event_type      text not null,
  payload         jsonb not null default '{}',
  status          text not null default 'pending',
  status_code     integer,
  response_body   text,
  attempt         integer not null default 0,
  next_retry_at   timestamptz,
  delivered_at    timestamptz,
  created_at      timestamptz not null default now()
);
create index if not exists idx_webhook_deliveries_owner on public.webhook_deliveries(owner_id);
create index if not exists idx_webhook_deliveries_webhook on public.webhook_deliveries(webhook_id);

-- workspaces ----------------------------------------------------------------
create table if not exists public.workspaces (
  id          text primary key default gen_random_uuid(),
  slug        text unique not null,
  name        text not null,
  description text not null default '',
  owner_id    text not null references public.users(id) on delete cascade,
  plan_id     text not null default 'free',
  status      text not null default 'active',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_workspaces_owner on public.workspaces(owner_id);

-- workspace_members ---------------------------------------------------------
create table if not exists public.workspace_members (
  id            text primary key default gen_random_uuid(),
  workspace_id  text not null references public.workspaces(id) on delete cascade,
  user_id       text not null references public.users(id) on delete cascade,
  role          text not null default 'member',
  invited_by    text,
  invited_email text,
  status        text not null default 'active',
  joined_at     timestamptz not null default now(),
  unique (workspace_id, user_id)
);
create index if not exists idx_workspace_members_workspace on public.workspace_members(workspace_id);
create index if not exists idx_workspace_members_user on public.workspace_members(user_id);

-- audit_log -----------------------------------------------------------------
create table if not exists public.audit_log (
  id          text primary key default gen_random_uuid(),
  user_id     text,
  action      text not null,
  details     jsonb not null default '{}',
  project_id  text,
  created_at  timestamptz not null default now()
);
create index if not exists idx_audit_user on public.audit_log(user_id);
create index if not exists idx_audit_action on public.audit_log(action);
create index if not exists idx_audit_created on public.audit_log(created_at desc);

-- snapshots -----------------------------------------------------------------
create table if not exists public.snapshots (
  id            text primary key default gen_random_uuid(),
  project_id    text not null references public.projects(id) on delete cascade,
  generation_id text,
  files         jsonb not null default '[]',
  created_at    timestamptz not null default now()
);
create index if not exists idx_snapshots_project on public.snapshots(project_id);

-- project_secrets -----------------------------------------------------------
create table if not exists public.project_secrets (
  id          text primary key default gen_random_uuid(),
  project_id  text not null references public.projects(id) on delete cascade,
  key         text not null,
  value       text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (project_id, key)
);
create index if not exists idx_secrets_project on public.project_secrets(project_id);

-- project_environments ------------------------------------------------------
create table if not exists public.project_environments (
  id          text primary key default gen_random_uuid(),
  project_id  text not null references public.projects(id) on delete cascade,
  name        text not null default 'development',
  config      jsonb not null default '{}',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_environments_project on public.project_environments(project_id);

-- project_members -----------------------------------------------------------
create table if not exists public.project_members (
  id          text primary key default gen_random_uuid(),
  project_id  text not null references public.projects(id) on delete cascade,
  user_id     text not null references public.users(id) on delete cascade,
  role        text not null default 'viewer',
  created_at  timestamptz not null default now(),
  unique (project_id, user_id)
);
create index if not exists idx_project_members_project on public.project_members(project_id);

-- snippets ------------------------------------------------------------------
create table if not exists public.snippets (
  id          text primary key default gen_random_uuid(),
  user_id     text not null references public.users(id) on delete cascade,
  title       text not null,
  description text not null default '',
  code        text not null,
  language    text not null default 'tsx',
  tags        text not null default '[]',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_snippets_user on public.snippets(user_id);

-- Restrict the pre-existing SECURITY DEFINER helper to database administrators.
-- The app's server-side service role can manage schema; public clients must not invoke this helper.
REVOKE ALL ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;

-- Enable RLS on all tables --------------------------------------------------
alter table public.users enable row level security;
alter table public.projects enable row level security;
alter table public.project_files enable row level security;
alter table public.generations enable row level security;
alter table public.deployments enable row level security;
alter table public.businesses enable row level security;
alter table public.jobs enable row level security;
alter table public.god_mode_goals enable row level security;
alter table public.marketing_campaigns enable row level security;
alter table public.subscriptions enable row level security;
alter table public.usage_events enable row level security;
alter table public.notifications enable row level security;
alter table public.cron_jobs enable row level security;
alter table public.monitoring_events enable row level security;
alter table public.heal_actions enable row level security;
alter table public.support_tickets enable row level security;
alter table public.support_messages enable row level security;
alter table public.api_keys enable row level security;
alter table public.webhooks enable row level security;
alter table public.webhook_deliveries enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.audit_log enable row level security;
alter table public.snapshots enable row level security;
alter table public.project_secrets enable row level security;
alter table public.project_environments enable row level security;
alter table public.project_members enable row level security;
alter table public.snippets enable row level security;

-- ============================================================================
-- EXPANSION TABLES — Paystack, Social Scheduler, ROI, Brand Voice, Leads
-- ============================================================================

-- paystack_payments ---------------------------------------------------------
-- Tracks Paystack payment links + verification for freelance jobs.
create table if not exists public.paystack_payments (
  id              text primary key default gen_random_uuid(),
  job_id          text not null references public.jobs(id) on delete cascade,
  owner_id        text not null references public.users(id) on delete cascade,
  paystack_ref    text unique not null,        -- payment reference from Paystack
  access_code     text,                          -- Paystack access code
  amount_kobo     integer not null,             -- amount in kobo (100 kobo = 1 NGN)
  currency        text not null default 'NGN',
  status          text not null default 'pending', -- pending | success | failed | cancelled
  type            text not null default 'deposit', -- deposit | milestone | final
  milestone_index integer,                       -- which milestone this pays for
  customer_email  text,
  customer_name   text,
  paid_at         timestamptz,
  metadata        jsonb not null default '{}',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_paystack_job on public.paystack_payments(job_id);
create index if not exists idx_paystack_owner on public.paystack_payments(owner_id);
create index if not exists idx_paystack_ref on public.paystack_payments(paystack_ref);

-- Invalidate records created by the old mock-checkout path. These were not
-- real provider-confirmed transactions and must never remain successful.
update public.paystack_payments
set status = 'failed', paid_at = null, updated_at = now()
where status = 'success'
  and (access_code = 'mock' or metadata->>'authorization_url' like '%/api/jobs/mock-payment%');

-- Atomic Paystack confirmation. The caller must first verify the transaction
-- directly with Paystack; this function enforces database invariants and makes
-- payment confirmation + milestone completion one transaction.
create or replace function public.confirm_paystack_payment(
  p_payment_id text,
  p_reference text,
  p_amount_kobo integer,
  p_paid_at timestamptz
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_payment public.paystack_payments%rowtype;
  v_tasks jsonb;
  v_updated_tasks jsonb := '[]'::jsonb;
  v_task jsonb;
  v_task_index bigint;
begin
  select * into v_payment
  from public.paystack_payments
  where id = p_payment_id
  for update;

  if not found then return false; end if;
  if v_payment.paystack_ref <> p_reference or v_payment.amount_kobo <> p_amount_kobo then return false; end if;
  if v_payment.currency <> 'NGN' then return false; end if;
  if v_payment.status = 'success' then return true; end if;
  if v_payment.status <> 'pending' then return false; end if;

  update public.paystack_payments
  set status = 'success', paid_at = coalesce(p_paid_at, now()), updated_at = now()
  where id = v_payment.id;

  if v_payment.type = 'milestone' and v_payment.milestone_index is not null then
    select tasks into v_tasks from public.jobs where id = v_payment.job_id for update;
    if found and jsonb_typeof(v_tasks) = 'array' then
      for v_task, v_task_index in
        select value, ordinality from jsonb_array_elements(v_tasks) with ordinality
      loop
        if v_task_index > (v_payment.milestone_index * 3)
           and v_task_index <= (v_payment.milestone_index * 3 + 3)
           and jsonb_typeof(v_task) = 'object' then
          v_task := jsonb_set(v_task, '{status}', '"completed"'::jsonb, true);
        end if;
        v_updated_tasks := v_updated_tasks || jsonb_build_array(v_task);
      end loop;
      update public.jobs set tasks = v_updated_tasks, updated_at = now() where id = v_payment.job_id;
    end if;
  end if;

  return true;
end;
$$;

revoke all on function public.confirm_paystack_payment(text, text, integer, timestamptz) from public, anon, authenticated;
grant execute on function public.confirm_paystack_payment(text, text, integer, timestamptz) to service_role;

-- social_accounts ----------------------------------------------------------
-- Connected social media accounts (Meta, X, LinkedIn, etc).
create table if not exists public.social_accounts (
  id            text primary key default gen_random_uuid(),
  owner_id      text not null references public.users(id) on delete cascade,
  platform      text not null,                 -- meta | x | linkedin | instagram | tiktok
  account_name  text not null,                 -- display name / handle
  account_id    text,                          -- platform-specific user ID
  access_token  text,                          -- encrypted OAuth token
  refresh_token text,                          -- encrypted refresh token
  token_expires timestamptz,
  is_connected  boolean not null default true,
  follower_count integer default 0,
  metadata      jsonb not null default '{}',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (owner_id, platform, account_id)
);
create index if not exists idx_social_owner on public.social_accounts(owner_id);

-- scheduled_posts ----------------------------------------------------------
-- Social media posts scheduled for auto-posting.
create table if not exists public.scheduled_posts (
  id              text primary key default gen_random_uuid(),
  owner_id        text not null references public.users(id) on delete cascade,
  project_id      text references public.projects(id) on delete set null,
  campaign_id     text references public.marketing_campaigns(id) on delete set null,
  title           text not null,
  content         text not null,               -- the post body / caption
  platforms       jsonb not null default '[]', -- ["meta","x","linkedin"]
  media_urls      jsonb not null default '[]', -- attached images/videos
  hashtags        jsonb not null default '[]',
  scheduled_at    timestamptz not null,         -- when to post
  posted_at       timestamptz,                  -- when actually posted
  status          text not null default 'scheduled', -- scheduled | posting | posted | failed | draft
  post_results    jsonb not null default '{}',  -- per-platform post IDs / errors
  utm_campaign    text,                          -- for ROI tracking
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_scheduled_owner on public.scheduled_posts(owner_id);
create index if not exists idx_scheduled_status on public.scheduled_posts(status);
create index if not exists idx_scheduled_at on public.scheduled_posts(scheduled_at);

-- campaign_tracking --------------------------------------------------------
-- Tracks clicks + conversions for marketing campaigns (ROI).
create table if not exists public.campaign_tracking (
  id              text primary key default gen_random_uuid(),
  owner_id        text not null references public.users(id) on delete cascade,
  campaign_id     text references public.marketing_campaigns(id) on delete set null,
  post_id         text references public.scheduled_posts(id) on delete set null,
  utm_source      text,
  utm_medium      text,
  utm_campaign    text,
  utm_content     text,
  short_code      text unique not null,         -- short URL code
  destination_url text not null,                -- where the link points
  clicks         integer not null default 0,
  conversions    integer not null default 0,
  revenue_kobo   integer not null default 0,    -- attributed revenue
  created_at     timestamptz not null default now()
);
create index if not exists idx_tracking_short on public.campaign_tracking(short_code);
create index if not exists idx_tracking_owner on public.campaign_tracking(owner_id);
create index if not exists idx_tracking_campaign on public.campaign_tracking(campaign_id);

-- brand_voice_profiles ----------------------------------------------------
-- AI-analyzed brand voice profiles for consistent content generation.
create table if not exists public.brand_voice_profiles (
  id            text primary key default gen_random_uuid(),
  owner_id      text not null references public.users(id) on delete cascade,
  project_id    text references public.projects(id) on delete cascade,
  name          text not null,                 -- profile name
  tone          text,                          -- e.g. "professional yet warm"
  vocabulary    jsonb not null default '[]',   -- signature words / phrases
  sentence_style text,                         -- "short punchy sentences" etc.
  emoji_usage   text,                          -- "minimal" | "moderate" | "heavy"
  hashtags     jsonb not null default '[]',
  do_list      jsonb not null default '[]',    -- what to do
  dont_list    jsonb not null default '[]',    -- what to avoid
  sample_text  text,                           -- raw sample content analyzed
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists idx_voice_owner on public.brand_voice_profiles(owner_id);

-- leads -------------------------------------------------------------------
-- Marketing leads captured from landing pages / forms.
create table if not exists public.leads (
  id              text primary key default gen_random_uuid(),
  owner_id        text not null references public.users(id) on delete cascade,
  project_id      text references public.projects(id) on delete set null,
  name            text not null,
  email           text not null,
  phone           text,
  company         text,
  source          text not null default 'organic', -- organic | ad | social | referral | form
  campaign_id     text references public.marketing_campaigns(id) on delete set null,
  tracking_id     text references public.campaign_tracking(id) on delete set null,
  utm_data        jsonb not null default '{}',
  requirements    text,                         -- what the lead is looking for
  budget          integer,                      -- estimated budget in kobo
  status          text not null default 'new',  -- new | contacted | qualified | converted | lost
  converted_job_id text references public.jobs(id) on delete set null,
  converted_at    timestamptz,
  notes           jsonb not null default '[]',  -- array of {at, text, author}
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_leads_owner on public.leads(owner_id);
create index if not exists idx_leads_status on public.leads(status);
create index if not exists idx_leads_source on public.leads(source);

-- Enable RLS on all new tables
alter table public.paystack_payments enable row level security;
alter table public.social_accounts enable row level security;
alter table public.scheduled_posts enable row level security;
alter table public.campaign_tracking enable row level security;
alter table public.brand_voice_profiles enable row level security;
alter table public.leads enable row level security;
