-- =====================================================
-- Migration 020: Per-source OAuth registration attempts
-- File: 020_oauth_registration_attempts.sql
-- Date: 2026-11-03 12:00
-- Run: Supabase SQL Editor, execute once
-- =====================================================
-- Backs the dynamic client registration rate limit (RFC 7591 §4.2) with a
-- per-source dimension: counting oauth_clients globally let any ten requests
-- per hour deny registrations for everyone (review 2026-11-02 P1-4). Every
-- attempt is recorded before the budget decision, so concurrent bursts and
-- transient DB errors fail closed instead of open.
-- RLS enabled with no policies: only the service role can read or write,
-- matching the other OAuth tables (007).

create table if not exists public.oauth_registration_attempts (
  id bigint generated always as identity primary key,
  ip text not null,
  created_at timestamptz not null default now()
);

create index if not exists oauth_registration_attempts_ip_created_idx
  on public.oauth_registration_attempts (ip, created_at);

create index if not exists oauth_registration_attempts_created_idx
  on public.oauth_registration_attempts (created_at);

alter table public.oauth_registration_attempts enable row level security;
