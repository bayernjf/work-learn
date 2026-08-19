-- Migration: 005_relax_source_check.sql
-- Date: 2026-08-20
-- Source is now an open label maintained in packages/shared-schema/src/agents.ts.
-- Drop the CHECK constraints so new agents can be used without a migration.
alter table public.sessions drop constraint if exists sessions_source_check;
alter table public.learning_materials drop constraint if exists learning_materials_source_check;
