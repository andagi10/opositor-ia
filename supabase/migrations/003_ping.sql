-- Función mínima para mantener activo un proyecto del plan gratuito.
-- La llama cada día el workflow .github/workflows/mantener-supabase-activo.yml
-- No expone ningún dato: solo devuelve la hora del servidor tras consultar la base de datos.
create or replace function public.ping()
returns timestamptz language sql stable security definer set search_path = public as $$
  select now() where exists (select 1 from public.perfiles limit 1) or true;
$$;
revoke all on function public.ping() from public;
grant execute on function public.ping() to anon, authenticated;
