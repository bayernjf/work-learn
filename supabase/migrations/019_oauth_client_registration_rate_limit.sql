-- =====================================================
-- Migration 019: Index oauth_clients for registration rate limit
-- File: 019_oauth_client_registration_rate_limit.sql
-- Date: 2026-08-31 10:51
-- Run: Supabase SQL Editor, execute once
-- =====================================================
-- Note: Adds an index on oauth_clients(created_at) so the
--       sliding-window count for dynamic client registration
--       rate limiting (RFC 7591 4.2) stays cheap.
-- -----------------------------------------------------
-- Migration: 019_oauth_client_registration_rate_limit.sql
-- Date: 2026-08-31
-- Backs the dynamic client registration rate limit (RFC 7591 §4.2):
-- oauth_clients.created_at already exists; the sliding-window count query
-- (`count(*) where created_at >= now() - interval`) needs an index so it stays
-- cheap as the table grows.

create index if not exists oauth_clients_created_at_idx
  on public.oauth_clients (created_at);
