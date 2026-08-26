-- Migration: 014_question_norm_dedupe.sql
-- Date: 2026-08-26
-- Add question_norm for exact-dedupe, matching the local SQLite store.
-- Cloud saveQuestionTranslation now skips duplicate re-asks within a session.

alter table public.question_translations
  add column if not exists question_norm text;

-- Backfill existing rows from question.
update public.question_translations
set question_norm = lower(trim(regexp_replace(question, '\s+', ' ', 'g')))
where question_norm is null;

alter table public.question_translations
  alter column question_norm set not null;

create index if not exists qt_session_norm_idx
  on public.question_translations(session_id, question_norm);
