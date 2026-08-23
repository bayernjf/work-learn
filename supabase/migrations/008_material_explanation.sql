-- Migration: 008_material_explanation.sql
-- Date: 2026-08-23
-- The Skill asks the user to confirm a "Why:" line explaining each item, but
-- there was nowhere to store it, so it was dropped after confirmation. Default
-- '' rather than null so older Skill copies that omit it keep saving.
alter table public.learning_materials
  add column if not exists explanation text not null default '';

-- Recreate the search function: the row type changed, and an explanation is
-- exactly the kind of prose a user searches for.
create or replace function public.search_learning_materials(p_user uuid, p_query text)
returns setof public.learning_materials
language sql
stable
as $$
  select *
  from public.learning_materials
  where user_id = p_user
    and (
      topic ilike '%' || p_query || '%'
      or original_text ilike '%' || p_query || '%'
      or explanation ilike '%' || p_query || '%'
      or useful_expressions::text ilike '%' || p_query || '%'
      or vocabulary::text ilike '%' || p_query || '%'
    )
  order by created_at desc;
$$;
