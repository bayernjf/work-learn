-- Migration: 009_material_search.sql
-- Date: 2026-08-23
--
-- Search was `ilike '%' || p_query || '%'` across four columns with no index, so:
--   * every search sequentially scanned the corpus, and `%x%` cannot use a btree
--     index even if one existed;
--   * a multi-word query only matched when those words appeared as one literal
--     substring, so "roll back deploy" found nothing;
--   * explanation, corrections, practice_prompts and tags were never searched;
--   * results were ordered by created_at alone, so an exact topic hit sorted
--     below any newer row;
--   * a query containing % or _ was silently treated as a wildcard.
--
-- Trigrams rather than tsvector: topics and notes here are frequently Chinese,
-- and to_tsvector collapses a CJK run into a single token, so '部署' would never
-- match '讨论部署脚本'. Trigrams also preserve the partial-word matching that
-- ILIKE gave users.
create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;

-- Supabase keeps extensions out of public, so both this migration and the search
-- function below have to say where to find word_similarity and gin_trgm_ops.
set search_path = public, extensions;

alter table public.learning_materials
  add column if not exists search_text text not null default '';

comment on column public.learning_materials.search_text is
  'Internal: lowercased concatenation of every searchable field, maintained by trigger. Not exposed by the API.';

-- A trigger rather than GENERATED ALWAYS: flattening the jsonb arrays needs a
-- ::text cast, and a generated column would require that cast to be provably
-- immutable. A trigger carries no such restriction.
create or replace function public.learning_materials_search_text()
returns trigger
language plpgsql
as $$
begin
  new.search_text := lower(concat_ws(' ',
    new.topic,
    new.original_text,
    new.explanation,
    -- jsonb arrays render as ["a","b"]; that punctuation is noise when matching.
    translate(new.useful_expressions::text, '[]",', '    '),
    translate(new.corrections::text, '[]",', '    '),
    translate(new.vocabulary::text, '[]",', '    '),
    translate(new.practice_prompts::text, '[]",', '    '),
    translate(new.tags::text, '[]",', '    ')
  ));
  return new;
end;
$$;

drop trigger if exists learning_materials_search_text on public.learning_materials;
create trigger learning_materials_search_text
  before insert or update on public.learning_materials
  for each row execute function public.learning_materials_search_text();

-- Backfill existing rows. The assigned value is irrelevant: the trigger fires on
-- any update and overwrites it. Do not narrow the trigger to a column list
-- without revisiting this statement.
update public.learning_materials set search_text = '';

create index if not exists learning_materials_search_text_trgm
  on public.learning_materials using gin (search_text gin_trgm_ops);

create or replace function public.search_learning_materials(p_user uuid, p_query text)
returns setof public.learning_materials
language sql
stable
set search_path = public, extensions
as $$
  select m.*
  from public.learning_materials m
  where m.user_id = p_user
    -- Every word has to appear somewhere, instead of the whole query appearing
    -- verbatim. % and _ are escaped so a query is never read as a wildcard.
    -- A blank query matches everything, which is what the old '%%' did.
    and m.search_text like all (
      select '%' || regexp_replace(lower(word), '([%_\\])', '\\\1', 'g') || '%'
      from regexp_split_to_table(btrim(coalesce(p_query, '')), '\s+') as word
      where word <> ''
    )
  order by word_similarity(lower(btrim(coalesce(p_query, ''))), m.search_text) desc,
           m.created_at desc,
           m.id desc;
$$;
