# Supabase setup

## 1. Fill local parameters

Edit the ignored root file `.env.local`:

```env
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_ANON_KEY=<publishable-or-anon-key>
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
SUPABASE_PROJECT_REF=<project-ref>
```

Never commit `.env.local` or expose `SUPABASE_SERVICE_ROLE_KEY` to the browser.

## 2. Link the project

Install the Supabase CLI, then authenticate locally:

```bash
supabase login
supabase link --project-ref "$SUPABASE_PROJECT_REF"
```

## 3. Apply the schema

```bash
supabase db push
```

The migration creates sessions, conversation events, learning materials, review items, indexes, and per-user RLS policies.
