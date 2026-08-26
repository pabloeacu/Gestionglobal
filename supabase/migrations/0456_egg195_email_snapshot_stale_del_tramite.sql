-- ============================================================================
-- 0456 · E-GG-195 — El avance del trámite rebotaba al email VIEJO pese a la
-- corrección del wizard (reporte JL, caso TABOADA + Gnanni + Nogueira).
-- ----------------------------------------------------------------------------
-- SÍNTOMA: un cliente se registró con su email mal escrito. Se detectó por el
-- rebote del 1er mail; informó el correcto; en el wizard de admisión se corrigió.
-- Los mails de bienvenida/servicio empezaron a llegar (leen administraciones.email
-- = canónico corregido), PERO el "Avance visible al cliente" rebotó porque se
-- mandó al email viejo.
--
-- CAUSA RAÍZ (en solicitud_activar): al admitir, la ADMINISTRACIÓN se crea con
-- el email corregido que tipea el operador (p_crear_cliente_input->>'email'),
-- pero el TRÁMITE snapshotea `solicitante_email` desde `v_sol.solicitante_email`
-- (= el email de la SOLICITUD = el ORIGINAL errado del formulario). Así quedaba
-- administraciones.email=correcto y tramites.solicitante_email=viejo. La
-- resolución del destinatario del avance (mig 0319) es
-- `admin_login_email → tramites.solicitante_email → administraciones.email`:
-- cuando el cliente aún no tiene usuario de portal, admin_login_email da vacío y
-- cae al SNAPSHOT VIEJO, que tapa el canónico corregido → rebote.
--
-- FIX (3 piezas, "que ningún otro caso similar suceda" — pedido JL):
--   1. solicitud_activar: el trámite snapshotea el email CANÓNICO del admin
--      (v_email_admin), con fallback al de la solicitud sólo si el admin no tiene.
--   2. Trigger de sync: si administraciones.email se CORRIGE después (edición en
--      la ficha), propagar a los snapshots tramites.solicitante_email de ese
--      cliente. Cubre las correcciones post-admisión.
--   3. Backfill: los trámites ya rotos (snapshot ≠ canónico) → canónico.
-- ============================================================================

-- 1) solicitud_activar: trámite ← email canónico del admin (no el de la solicitud)
do $$
declare d text; n text;
begin
  d := pg_get_functiondef('public.solicitud_activar(uuid,uuid,jsonb,text,date)'::regprocedure);
  n := replace(d,
    'v_sol.solicitante_nombre, v_sol.solicitante_email, v_sol.solicitante_telefono',
    'v_sol.solicitante_nombre, COALESCE(NULLIF(btrim(v_email_admin),''''), v_sol.solicitante_email), v_sol.solicitante_telefono');
  if n = d then raise exception 'E-GG-195: token del INSERT del trámite no encontrado en solicitud_activar'; end if;
  execute n;
end $$;

-- 2) Trigger de sync: administraciones.email corregido → snapshots de trámites.
--    SECURITY DEFINER porque tramites tiene RLS con policy de write (R17) y el
--    invoker (gerente que edita la ficha) podría no poder escribir el snapshot.
--    Sin recursión: el UPDATE a tramites dispara backfill_admin (tramites→admin)
--    pero ése NO toca la columna email → este trigger (AFTER UPDATE OF email) no
--    re-dispara.
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
  end if;
  return NEW;
end $fn$;

drop trigger if exists trg_sync_tramite_email_admin on public.administraciones;
create trigger trg_sync_tramite_email_admin
  after update of email on public.administraciones
  for each row
  execute function public.sync_tramite_email_on_admin_email_change();

-- 3) Backfill de los trámites ya desincronizados (snapshot viejo → canónico).
update public.tramites t
   set solicitante_email = a.email
  from public.administraciones a
 where t.administracion_id = a.id
   and t.administracion_id is not null
   and nullif(btrim(a.email), '') is not null
   and nullif(btrim(t.solicitante_email), '') is not null
   and lower(btrim(t.solicitante_email)) <> lower(btrim(a.email));
