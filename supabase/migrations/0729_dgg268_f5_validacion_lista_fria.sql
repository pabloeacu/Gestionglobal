-- 0729 · DGG-268 F5 — Validación de la lista fría (Chunk 3). Prerequisito del encendido
-- del carril SES para los 9.974 import_nacional (decisión de Pablo: "Validar + rampa SES").
--
-- La validación tiene DOS niveles:
--   · DOMINIO muerto (sin MX ni A): la dirección NO puede recibir correo → suprimir YA
--     (motivo 'invalida', HARD). La resuelve una capa que hace DNS (edge/script) y llama a
--     cold_list_suprimir_dominios con los dominios muertos.
--   · BUZÓN muerto (dominio vivo, casilla inexistente, p.ej. el typo 'samchez'): NO se puede
--     saber por DNS; lo caza el freno (private.ses_freno_check) con los rebotes reales de SES
--     durante la rampa. Por eso la rampa arranca baja y con auto-pausa.
--
-- Acá van sólo las RPCs (lectura de dominios + supresión). El DNS lo hace quien las orquesta
-- (una corrida controlada con `dig`/Deno.resolveDns). email_suppression es GLOBAL, así que
-- suprimir un email muerto protege a la vez el newsletter LexPH y las campañas federales.

-- (1) Dominios distintos (+ nº de direcciones) de la lista fría aún NO suprimida.
create or replace function public.cold_list_dominios(p_origen text default 'import_nacional')
returns table(dom text, n int)
language sql stable security definer set search_path to 'public', 'pg_temp'
as $$
  select split_part(lower(btrim(s.email)), '@', 2) as dom, count(*)::int as n
  from public.lexph_suscriptores s
  where s.origen = p_origen and s.estado = 'confirmado'
    and not exists (select 1 from public.email_suppression x where x.email = lower(btrim(s.email)))
  group by 1
  order by 2 desc;
$$;
revoke all on function public.cold_list_dominios(text) from public, anon, authenticated;
grant execute on function public.cold_list_dominios(text) to service_role;

-- (2) Suprime (HARD, motivo 'invalida') las direcciones de la lista fría cuyo dominio está en
--     p_doms (los dominios muertos que detectó la capa DNS). Idempotente (on conflict do nothing).
create or replace function public.cold_list_suprimir_dominios(p_origen text, p_doms text[])
returns int
language plpgsql security definer set search_path to 'public', 'pg_temp'
as $fn$
declare v_n int;
begin
  if p_doms is null or array_length(p_doms, 1) is null then
    return 0;
  end if;
  with cand as (
    select distinct lower(btrim(s.email)) as email
    from public.lexph_suscriptores s
    where s.origen = p_origen and s.estado = 'confirmado'
      and split_part(lower(btrim(s.email)), '@', 2) = any(p_doms)
      and not exists (select 1 from public.email_suppression x where x.email = lower(btrim(s.email)))
  ), ins as (
    insert into public.email_suppression (email, motivo, origen)
    select email, 'invalida', 'validacion_mx' from cand
    on conflict (email) do nothing
    returning 1
  )
  select count(*)::int into v_n from ins;
  return v_n;
end $fn$;
revoke all on function public.cold_list_suprimir_dominios(text, text[]) from public, anon, authenticated;
grant execute on function public.cold_list_suprimir_dominios(text, text[]) to service_role;
