-- Migration: 013_sync_tombstones.sql
-- Date: 2026-08-25
-- Tombstones propagate deletions across devices using last-write-wins: a
-- tombstone wins against a row whose updated_at is older than deleted_at.

create table if not exists public.sync_tombstones (
  id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  entity text not null check (entity in ('session', 'material', 'question', 'review')),
  deleted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  primary key (user_id, entity, id)
);

create index if not exists tombstones_user_deleted_idx
  on public.sync_tombstones(user_id, deleted_at desc);

alter table public.sync_tombstones enable row level security;

create policy "Users can manage their own tombstones"
  on public.sync_tombstones for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
