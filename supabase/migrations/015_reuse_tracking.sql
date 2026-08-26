-- Migration: 015_reuse_tracking.sql
-- Date: 2026-08-26
-- File: supabase/migrations/015_reuse_tracking.sql
-- Reuse tracking: save expression entities and append-only reuse events.
-- Multiple expressions can share an intent. The product treats them as
-- alternatives with different register/scene, not as one correct answer.

create table if not exists public.intents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  label text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.saved_expressions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  material_id uuid references public.learning_materials(id) on delete set null,
  intent_id uuid references public.intents(id) on delete set null,
  text text not null,
  text_norm text not null,
  register text check (register in ('formal', 'neutral', 'casual')),
  scene text,
  note text,
  reuse_count integer not null default 0 check (reuse_count >= 0),
  first_reused_at timestamptz,
  last_reused_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, text_norm)
);

create table if not exists public.reuse_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  expression_id uuid not null references public.saved_expressions(id) on delete cascade,
  session_id uuid references public.sessions(id) on delete set null,
  source text,
  matched_text text not null,
  context_snippet text,
  match_kind text not null default 'exact' check (match_kind in ('exact', 'variant', 'nudge')),
  confidence numeric not null default 1 check (confidence between 0 and 1),
  created_at timestamptz not null default now()
);

create index if not exists intents_user_updated_idx on public.intents(user_id, updated_at desc);
create index if not exists expressions_user_updated_idx on public.saved_expressions(user_id, updated_at desc);
create index if not exists expressions_user_norm_idx on public.saved_expressions(user_id, text_norm);
create index if not exists reuse_events_user_created_idx on public.reuse_events(user_id, created_at desc);
create index if not exists reuse_events_expression_created_idx on public.reuse_events(expression_id, created_at desc);

alter table public.intents enable row level security;
alter table public.saved_expressions enable row level security;
alter table public.reuse_events enable row level security;

create policy "Users can manage their own intents"
  on public.intents for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "Users can manage their own saved expressions"
  on public.saved_expressions for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "Users can manage their own reuse events"
  on public.reuse_events for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

do $$
begin
  alter table public.sync_tombstones drop constraint if exists sync_tombstones_entity_check;
  alter table public.sync_tombstones
    add check (entity in ('session', 'material', 'question', 'review', 'intent', 'expression', 'reuse_event'));
end $$;

create or replace function public.increment_saved_expression_reuse(
  p_expression_id uuid,
  p_user_id uuid,
  p_used_at timestamptz
) returns void
language sql
security invoker
as $$
  update public.saved_expressions
  set reuse_count = reuse_count + 1,
      first_reused_at = coalesce(first_reused_at, p_used_at),
      last_reused_at = p_used_at,
      updated_at = greatest(updated_at, p_used_at)
  where id = p_expression_id and user_id = p_user_id;
$$;

grant execute on function public.increment_saved_expression_reuse(uuid, uuid, timestamptz) to authenticated;
