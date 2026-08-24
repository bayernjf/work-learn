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

For the Vite app, copy the project URL and anon/publishable key into `apps/web/.env.local`:

```env
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<publishable-or-anon-key>
VITE_WORK_LEARN_API_URL=http://localhost:3000
```

`VITE_WORK_LEARN_API_URL` is for local development only. It gets inlined into the
bundle, so a production build carrying it points every request at localhost —
production reads the API origin at runtime instead. See [../docs/deployment.md](../docs/deployment.md).

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

The migrations create sessions, conversation events, learning materials, review
items, personal access tokens, the OAuth client/grant tables, a trigram-indexed
search function, indexes and per-user RLS policies.

Remote MCP OAuth also needs `WORK_LEARN_PUBLIC_API_URL` and `WORK_LEARN_WEB_URL`
in the API environment. Without them the OAuth routes fail; personal access
tokens keep working.
