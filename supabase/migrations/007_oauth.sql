-- Migration: 007_oauth.sql
-- Date: 2026-08-21
-- MCP OAuth 2.1 authorization server storage.
-- Clients registered dynamically by MCP agents; codes and tokens are short-lived.

create table if not exists public.oauth_clients (
  client_id text primary key,
  client_secret text,
  redirect_uris jsonb not null default '[]'::jsonb,
  client_name text,
  client_uri text,
  logo_uri text,
  scope text,
  grant_types jsonb not null default '["authorization_code","refresh_token"]'::jsonb,
  response_types jsonb not null default '["code"]'::jsonb,
  token_endpoint_auth_method text not null default 'none',
  created_at timestamptz not null default now()
);

create table if not exists public.oauth_authorization_codes (
  code text primary key,
  client_id text not null references public.oauth_clients(client_id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  redirect_uri text not null,
  code_challenge text not null,
  code_challenge_method text not null default 'S256',
  scope text,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.oauth_tokens (
  access_token_hash text primary key,
  refresh_token_hash text,
  client_id text not null references public.oauth_clients(client_id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  scope text,
  access_expires_at timestamptz not null,
  refresh_expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists oauth_codes_client_idx on public.oauth_authorization_codes(client_id);
create index if not exists oauth_tokens_user_idx on public.oauth_tokens(user_id);
create index if not exists oauth_tokens_refresh_idx on public.oauth_tokens(refresh_token_hash);

alter table public.oauth_clients enable row level security;
alter table public.oauth_authorization_codes enable row level security;
alter table public.oauth_tokens enable row level security;
-- Server-only tables; the API uses the service-role key. No user-facing policies.
