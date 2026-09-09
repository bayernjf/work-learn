-- =====================================================
-- Migration 004: Add codebuddy to source CHECK
-- File: 004_expand_source_codebuddy.sql
-- Date: 2026-08-20 03:17
-- Run: Supabase SQL Editor, execute once
-- =====================================================
-- Note: Adds 'codebuddy' to the source CHECK constraint on
--       sessions and learning_materials.
-- -----------------------------------------------------
-- Migration: 004_expand_source_codebuddy.sql
-- Date: 2026-08-20
alter table public.sessions
  drop constraint sessions_source_check,
  add constraint sessions_source_check check (source in ('claude', 'chatgpt', 'codebuddy', 'hermes', 'openclaw', 'opencode', 'codex', 'pi', 'terminal', 'manual'));

alter table public.learning_materials
  drop constraint learning_materials_source_check,
  add constraint learning_materials_source_check check (source in ('claude', 'chatgpt', 'codebuddy', 'hermes', 'openclaw', 'opencode', 'codex', 'pi', 'terminal', 'manual'));
