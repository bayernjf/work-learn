-- Migration: 012_sync_timestamps.sql
-- Date: 2026-08-25
-- Add updated_at timestamps for bidirectional sync. Sync uses stable UUIDs and
-- last-write-wins by updated_at; review status is part of the synced dataset.

alter table public.sessions
  add column if not exists updated_at timestamptz not null default now();

alter table public.learning_materials
  add column if not exists updated_at timestamptz not null default now();

alter table public.question_translations
  add column if not exists updated_at timestamptz not null default now();

alter table public.review_items
  add column if not exists updated_at timestamptz not null default now();

create index if not exists sessions_user_updated_idx
  on public.sessions(user_id, updated_at desc);
create index if not exists materials_user_updated_idx
  on public.learning_materials(user_id, updated_at desc);
create index if not exists qt_user_updated_idx
  on public.question_translations(user_id, updated_at desc);
create index if not exists reviews_user_updated_idx
  on public.review_items(user_id, updated_at desc);
create unique index if not exists reviews_one_per_material_idx
  on public.review_items(material_id);

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

drop trigger if exists sessions_set_updated_at on public.sessions;
create trigger sessions_set_updated_at
  before update on public.sessions
  for each row execute function public.set_updated_at();

drop trigger if exists materials_set_updated_at on public.learning_materials;
create trigger materials_set_updated_at
  before update on public.learning_materials
  for each row execute function public.set_updated_at();

drop trigger if exists question_translations_set_updated_at on public.question_translations;
create trigger question_translations_set_updated_at
  before update on public.question_translations
  for each row execute function public.set_updated_at();

drop trigger if exists reviews_set_updated_at on public.review_items;
create trigger reviews_set_updated_at
  before update on public.review_items
  for each row execute function public.set_updated_at();
