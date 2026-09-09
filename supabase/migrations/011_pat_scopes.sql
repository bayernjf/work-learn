-- =====================================================
-- Migration 011: Add scopes to personal access tokens
-- File: 011_pat_scopes.sql
-- Date: 2026-08-24 07:02
-- Run: Supabase SQL Editor, execute once
-- =====================================================
-- Note: Adds an explicit permission scope array. Empty array
--       (value of all pre-existing tokens) means full access;
--       new tokens carry at least ['read'].
-- -----------------------------------------------------
-- Migration: 011_pat_scopes.sql
-- Date: 2026-08-23
--
-- Personal access tokens get an explicit permission scope. An empty array
-- (the value every pre-existing token gets on this migration) means "full
-- access", so tokens created before scoping existed keep working unchanged.
-- New tokens carry at least ["read"], or ["read","write"].
alter table public.personal_access_tokens
  add column if not exists scopes text[] not null default '{}';
