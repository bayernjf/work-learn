-- =====================================================
-- Migration 002: Expand source CHECK constraint
-- File: 002_expand_source_check.sql
-- Date: 2026-08-17 08:54
-- Run: Supabase SQL Editor, execute once
-- =====================================================
-- Note: Adds 'opencode', 'codex' and 'pi' to the source
--       CHECK constraint on sessions and learning_materials.
-- -----------------------------------------------------
-- Migration: 002_expand_source_check.sql
-- Date: 2026-08-17
alter table public.sessions
  drop constraint sessions_source_check,
  add constraint sessions_source_check check (source in ('claude', 'chatgpt', 'hermes', 'openclaw', 'opencode', 'codex', 'pi', 'terminal', 'manual'));

alter table public.learning_materials
  drop constraint learning_materials_source_check,
  add constraint learning_materials_source_check check (source in ('claude', 'chatgpt', 'hermes', 'openclaw', 'opencode', 'codex', 'pi', 'terminal', 'manual'));
