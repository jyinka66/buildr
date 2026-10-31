-- Saved conversations for the no-project AI Chat page.
-- One row per conversation; the messages live in a jsonb array so a reply is
-- saved atomically. Accessed only by the server-side service role (the
-- /api/chats routes), which always filters by user_id.
create table if not exists public.ai_chats (
  id          text primary key default gen_random_uuid(),
  user_id     text not null references public.users(id) on delete cascade,
  title       text not null default 'New chat',
  -- true until the user renames the chat; the server then derives the title
  -- from the first message.
  title_auto  boolean not null default true,
  messages    jsonb not null default '[]',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_ai_chats_user_updated on public.ai_chats(user_id, updated_at desc);

alter table public.ai_chats enable row level security;
revoke all privileges on table public.ai_chats from anon, authenticated;
