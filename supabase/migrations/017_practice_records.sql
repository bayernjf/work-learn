-- 017: practice records (practice loop + mistake book)
-- Persists each completed practice attempt so the user can review mistakes and
-- close the practice loop. Owned by auth.users via user_id, RLS-scoped.

create table if not exists practice_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  material_id uuid references learning_materials(id) on delete set null,
  question_id uuid references question_translations(id) on delete set null,
  exercise_type text not null
    check (exercise_type in ('reuse','recall','correction','apply','question','mcq','fill','scenario')),
  focus text not null default '',
  prompt text not null default '',
  user_answer text not null default '',
  is_correct boolean,
  status text not null default 'pending'
    check (status in ('pending','remembered','practice_again')),
  created_at timestamptz not null default now()
);

create index if not exists practice_records_user_created_idx
  on practice_records (user_id, created_at desc);
create index if not exists practice_records_user_mistakes_idx
  on practice_records (user_id, is_correct) where is_correct = false;

alter table practice_records enable row level security;

drop policy if exists "practice_records owner select" on practice_records;
create policy "practice_records owner select" on practice_records
  for select using (user_id = auth.uid());

drop policy if exists "practice_records owner insert" on practice_records;
create policy "practice_records owner insert" on practice_records
  for insert with check (user_id = auth.uid());

drop policy if exists "practice_records owner delete" on practice_records;
create policy "practice_records owner delete" on practice_records
  for delete using (user_id = auth.uid());
