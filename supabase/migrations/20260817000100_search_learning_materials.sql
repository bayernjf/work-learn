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
      or useful_expressions::text ilike '%' || p_query || '%'
      or vocabulary::text ilike '%' || p_query || '%'
    )
  order by created_at desc;
$$;
