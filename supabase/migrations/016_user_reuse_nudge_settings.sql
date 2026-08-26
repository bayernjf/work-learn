-- Migration: 016_user_reuse_nudge_settings.sql
-- Date: 2026-08-26
-- File: supabase/migrations/016_user_reuse_nudge_settings.sql
-- Persist per-user controls for same-intent reuse nudges.

create table if not exists public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  reuse_nudge_enabled boolean not null default true,
  reuse_nudge_cooldown_hours integer not null default 6 check (reuse_nudge_cooldown_hours between 0 and 168),
  reuse_nudge_daily_limit integer not null default 3 check (reuse_nudge_daily_limit between 0 and 20),
  updated_at timestamptz not null default now()
);

alter table public.user_settings enable row level security;

drop policy if exists "Users can view their own settings"
  on public.user_settings;
create policy "Users can view their own settings"
  on public.user_settings for select using (auth.uid() = user_id);

drop policy if exists "Users can update their own settings"
  on public.user_settings for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users can insert their own settings"
  on public.user_settings for insert with check (auth.uid() = user_id);

grant select, insert, update on public.user_settings to authenticated;
