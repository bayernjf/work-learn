-- Migration: 001_initial_learning_schema.sql
-- Date: 2026-08-16
create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source text not null check (source in ('claude', 'chatgpt', 'hermes', 'openclaw', 'terminal', 'manual')),
  topic text,
  created_at timestamptz not null default now()
);

create table if not exists public.conversation_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'tool')),
  content text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.learning_materials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid references public.sessions(id) on delete set null,
  source text not null check (source in ('claude', 'chatgpt', 'hermes', 'openclaw', 'terminal', 'manual')),
  topic text not null,
  original_text text not null,
  useful_expressions jsonb not null default '[]'::jsonb,
  corrections jsonb not null default '[]'::jsonb,
  vocabulary jsonb not null default '[]'::jsonb,
  practice_prompts jsonb not null default '[]'::jsonb,
  tags jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.review_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  material_id uuid not null references public.learning_materials(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'completed', 'snoozed')),
  due_at timestamptz not null default now(),
  interval_days integer not null default 0 check (interval_days >= 0),
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists sessions_user_created_idx on public.sessions(user_id, created_at desc);
create index if not exists events_session_created_idx on public.conversation_events(session_id, created_at);
create index if not exists materials_user_created_idx on public.learning_materials(user_id, created_at desc);
create index if not exists reviews_user_due_idx on public.review_items(user_id, due_at) where status = 'pending';

alter table public.sessions enable row level security;
alter table public.conversation_events enable row level security;
alter table public.learning_materials enable row level security;
alter table public.review_items enable row level security;

create policy "Users can manage their own sessions"
  on public.sessions for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "Users can manage their own conversation events"
  on public.conversation_events for all
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.sessions
      where sessions.id = conversation_events.session_id
        and sessions.user_id = auth.uid()
    )
  );

create policy "Users can manage their own learning materials"
  on public.learning_materials for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "Users can manage their own review items"
  on public.review_items for all
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.learning_materials
      where learning_materials.id = review_items.material_id
        and learning_materials.user_id = auth.uid()
    )
  );
