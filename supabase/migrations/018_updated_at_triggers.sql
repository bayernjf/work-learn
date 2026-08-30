-- Migration: 018_updated_at_triggers.sql
-- Date: 2026-08-30
-- Sync correctness: 012 built the set_updated_at() trigger for sessions,
-- learning_materials, question_translations and review_items, but the tables
-- added later (015 reuse tracking, 016 user settings) never got one. On those
-- tables every non-sync write left updated_at stale, so a later learn sync
-- push compared against an old timestamp and last-write-wins could overwrite
-- a newer edit or keep a stale row as the winner.
--
-- practice_records and reuse_events are append-only by design (no updated_at
-- column, 017/015) and deliberately stay untouched.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  -- Callers that explicitly set updated_at (sync clients using last-write-wins)
  -- keep their timestamp; ordinary updates omit it and get now().
  if new.updated_at is distinct from old.updated_at then
    return new;
  end if;
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists intents_set_updated_at on public.intents;
create trigger intents_set_updated_at
  before update on public.intents
  for each row execute function public.set_updated_at();

drop trigger if exists expressions_set_updated_at on public.saved_expressions;
create trigger expressions_set_updated_at
  before update on public.saved_expressions
  for each row execute function public.set_updated_at();

drop trigger if exists user_settings_set_updated_at on public.user_settings;
create trigger user_settings_set_updated_at
  before update on public.user_settings
  for each row execute function public.set_updated_at();
