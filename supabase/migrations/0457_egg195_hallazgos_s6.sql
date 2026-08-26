-- ============================================================================
-- 0457 · E-GG-195 — hallazgos §6 (3 agentes) sobre el fix 0456.
-- ----------------------------------------------------------------------------
-- El núcleo (0456) quedó correcto y verificado e2e. Se cierran los residuales:
--   A#1 · rama ELSE de solicitud_activar (p_cliente_id NULL y crear_cliente NULL,
--         pero la solicitud ya tiene cliente_id): v_email_admin nunca se poblaba
--         → el trámite snapshoteaba el email viejo de la solicitud. Edge casi
--         inalcanzable por el wizard, pero mismo patrón (regla 15).
--   A#2/B#1 · solicitudes.solicitante_email quedaba VIEJO tras activar → el modal
--         "Responder" de gerencia escribía a la dirección errada. Se corrige al
--         activar (RPC) + se sincroniza en ediciones posteriores (trigger) +
--         backfill de las ya activadas.
-- (C#1 — el campo Email de la ficha deja el LOGIN viejo para clientes con portal
--  — se cierra en el frontend, no acá.)
-- ============================================================================

-- A#1 + A#2 · solicitud_activar: poblar v_email_admin en la rama ELSE + corregir
-- también el email de la solicitud al activar. Replace verificado sobre la def.
do $$
declare d text; n text;
begin
  d := pg_get_functiondef('public.solicitud_activar(uuid,uuid,jsonb,text,date)'::regprocedure);
  -- A#1: rama ELSE poblá el email canónico del admin ya vinculado
  n := replace(d,
    'v_cliente := v_sol.cliente_id;',
    'v_cliente := v_sol.cliente_id;'||chr(10)||
    '    SELECT email, nombre INTO v_email_admin, v_admin_nombre FROM public.administraciones WHERE id = v_cliente;');
  if n = d then raise exception 'E-GG-195 A#1: rama ELSE no encontrada'; end if;
  d := n;
  -- A#2: el UPDATE de activación también pisa el email de la solicitud con el canónico
  n := replace(d,
    'SET estado = ''activada'', tramite_id = v_tramite_id, cliente_id = v_cliente,',
    'SET estado = ''activada'', tramite_id = v_tramite_id, cliente_id = v_cliente,'||chr(10)||
    '         solicitante_email = COALESCE(NULLIF(btrim(v_email_admin),''''), solicitante_email),');
  if n = d then raise exception 'E-GG-195 A#2: UPDATE final de solicitudes no encontrado'; end if;
  execute n;
end $$;

-- A#2/B#1 · extender el trigger de sync para cubrir también solicitudes.
-- Sin recursión: ninguna función escribe administraciones.email (verificado §6-B),
-- así que un UPDATE a solicitudes no puede re-disparar este AFTER UPDATE OF email.
create or replace function public.sync_tramite_email_on_admin_email_change()
returns trigger
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $fn$
begin
  if NEW.email is distinct from OLD.email
     and nullif(btrim(NEW.email), '') is not null then
    update public.tramites
       set solicitante_email = NEW.email
     where administracion_id = NEW.id
       and lower(btrim(coalesce(solicitante_email, ''))) is distinct from lower(btrim(NEW.email));
    update public.solicitudes
       set solicitante_email = NEW.email
     where cliente_id = NEW.id
       and lower(btrim(coalesce(solicitante_email, ''))) is distinct from lower(btrim(NEW.email));
  end if;
  return NEW;
end $fn$;

-- Backfill de solicitudes ya activadas cuyo email quedó viejo (incl. TABOADA).
update public.solicitudes s
   set solicitante_email = a.email
  from public.administraciones a
 where s.cliente_id = a.id
   and s.cliente_id is not null
   and nullif(btrim(a.email), '') is not null
   and nullif(btrim(s.solicitante_email), '') is not null
   and lower(btrim(s.solicitante_email)) <> lower(btrim(a.email));
