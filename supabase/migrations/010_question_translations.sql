-- Migration: 010_question_translations.sql
-- Date: 2026-08-23
-- New feature: save a user's original question together with the idiomatic
-- English translation the agent produced. This is a separate material type from
-- learning_materials -- it archives what the user actually asked (often in
-- Chinese) plus the natural English rendering. It is NOT linked to the review
-- queue; it exists for lookup and recall.
create table if not exists public.question_translations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid references public.sessions(id) on delete set null,
  -- Open label, consistent with learning_materials.source since 005: any agent
  -- works without a migration or redeploy.
  source text not null,
  -- The user's original question, verbatim (may be Chinese).
  question text not null,
  -- The idiomatic English rendering the agent produced for that question.
  translation text not null,
  -- Optional free-form label for this Q/A pair.
  topic text,
  created_at timestamptz not null default now()
);

create index if not exists qt_user_created_idx
  on public.question_translations(user_id, created_at desc);

alter table public.question_translations enable row level security;

create policy "Users can manage their own question translations"
  on public.question_translations for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
