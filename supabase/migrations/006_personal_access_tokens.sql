-- Migration: 006_personal_access_tokens.sql
-- Date: 2026-08-21
create table if not exists public.personal_access_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  token_prefix text not null,
  token_hash text not null,
  last_used_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists pat_user_created_idx
  on public.personal_access_tokens(user_id, created_at desc);
create unique index if not exists pat_token_hash_idx
  on public.personal_access_tokens(token_hash);

alter table public.personal_access_tokens enable row level security;

create policy "Users can view their own tokens"
  on public.personal_access_tokens for select
  using (auth.uid() = user_id);

create policy "Users can create their own tokens"
  on public.personal_access_tokens for insert
  with check (auth.uid() = user_id);

create policy "Users can revoke their own tokens"
  on public.personal_access_tokens for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete their own tokens"
  on public.personal_access_tokens for delete
  using (auth.uid() = user_id);
