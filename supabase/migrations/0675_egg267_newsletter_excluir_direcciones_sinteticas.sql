-- 0675 · DGG-244 F2 / E-GG-267 — El newsletter LexPH estaba enviando a direcciones
-- SINTÉTICAS 'no-figura-<matricula>@padron.invalid' (matriculados "NO FIGURA" del
-- padrón PBA, sin email real). Rebotan siempre y floodean a gerencia con avisos
-- "Rebotó un email a ...". Pablo recibió un montón de estos. Causa raíz + guarda + limpieza.
--
-- ── CAUSA RAÍZ ──────────────────────────────────────────────────────────────
-- `lexph_importar_audiencia_inicial()` (mig 0664, Frente B opt-out) importó la base
-- de captación (prospectos) a `lexph_suscriptores` validando el email SÓLO por
-- SINTAXIS (regex local@dominio.tld). Las direcciones que el import del padrón
-- (DGG-220) generó para los matriculados SIN email —`no-figura-NNNNNN@padron.invalid`—
-- son sintácticamente válidas, pero el TLD `.invalid` (RFC 2606) NUNCA resuelve.
-- Se colaron como suscriptores `estado='confirmado'`, y el goteo
-- `lexph_newsletter_enviar(uuid, timestamptz)` (mig 0663/0665) las encoló (sólo filtra
-- estado='confirmado' + no-suprimido). 153 en la lista → 153 en cola (6 enviadas →
-- rebotadas, 147 pendientes). El 100% del ruido de rebotes de hoy (6 avisos) son estas
-- sintéticas; 0 rebotes reales.
--
-- `.invalid` es el sentinela correcto (jamás mailea a una persona real por error),
-- PERO nunca debió entrar a la lista NI encolarse.
--
-- ── FIX (todo DB-layer) ─────────────────────────────────────────────────────
--  (1) GUARD en el IMPORT: `lexph_importar_audiencia_inicial()` excluye '%.invalid'
--      → raíz de la prevención: ninguna sintética vuelve a entrar como suscriptor.
--  (2) LIMPIEZA idempotente de lo ya cargado/encolado:
--      (a) supresión universal de las .invalid (email_suppression, motivo='invalida'
--          — NO 'bounce', para no inflar la tasa de rebote de reputación);
--      (b) baja de los suscriptores .invalid (estado='baja');
--      (c) cancelación de las filas pendientes en la cola (stop-the-bleed);
--      (d) archivado de las campanitas de rebote sintético ya emitidas (de-clutter).
--
-- NOTA DE DISEÑO (por qué NO se toca el send-path `lexph_newsletter_enviar`):
--   El goteo ya filtra `not exists email_suppression`. Con las 153 en supresión (2a)
--   + en baja (2b), NINGÚN path de envío (goteo 0663/0665, específico 0666) las vuelve
--   a encolar. Tocar esa función viva `(uuid, timestamptz)` durante la campaña activa
--   sólo agregaría riesgo de overload ambiguo (R16/E-GG-37) por marginal beneficio.
--   Guardas independientes vigentes: import + supresión + baja. Inmejorable sin riesgo.
--
-- NOTA HARVESTER (flaggeado aparte, R7): el aviso "Rebotó un email a ..." lo emite el
--   edge `email-bounce-harvester` por CADA rebote, con copy transaccional ("Verificá la
--   casilla del cliente"), inadecuado para un envío masivo. Hoy el ruido queda en 0
--   (sintéticas cortadas en origen, 0 rebotes reales), pero el roll-up de rebotes de
--   campaña masiva al informe de la edición (en vez de 1 aviso/dirección) es mejora
--   pendiente que requiere el procedimiento R7 (bajar/diff/deploy/observar). Ver
--   PROJECT_STATUS §5 + ERRORES E-GG-267.

-- ============================================================================
-- (1) GUARD en el import de audiencia: nunca importar un sentinela .invalid
--     (reproducción verbatim del cuerpo VIVO + una línea de guarda por src)
-- ============================================================================
create or replace function public.lexph_importar_audiencia_inicial()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_clientes  int := 0;
  v_captacion int := 0;
  c_email_re  constant text := '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$';
begin
  if not (select private.is_staff()) then
    raise exception 'Sólo el staff de gerencia puede importar la audiencia.' using errcode = '42501';
  end if;

  with src as (
    select distinct on (lower(btrim(a.email)))
           btrim(a.email) as email, lower(btrim(a.email)) as email_norm
      from public.administraciones a
     where coalesce(a.email, '') <> ''
       and lower(btrim(a.email)) ~ c_email_re
       and lower(btrim(a.email)) not like '%.invalid'   -- E-GG-267
       and a.estado is distinct from 'baja'
       and coalesce(a.ofrecimientos_habilitados, true) = true
     order by lower(btrim(a.email)), a.created_at
  ),
  ins as (
    insert into public.lexph_suscriptores (email, email_norm, estado, origen, confirmed_at)
    select s.email, s.email_norm, 'confirmado', 'cliente', now()
      from src s
     where not exists (select 1 from public.email_suppression x where x.email = s.email_norm)
    on conflict (email_norm) do nothing
    returning 1
  )
  select count(*) into v_clientes from ins;

  with src as (
    select distinct on (lower(btrim(p.email)))
           btrim(p.email) as email, lower(btrim(p.email)) as email_norm
      from public.prospectos p
     where coalesce(p.email, '') <> ''
       and lower(btrim(p.email)) ~ c_email_re
       and lower(btrim(p.email)) not like '%.invalid'   -- E-GG-267: excluye 'no-figura-*@padron.invalid'
       and coalesce(p.estado_captacion, '') <> 'baja'
       and p.baja_at is null
     order by lower(btrim(p.email)), p.created_at
  ),
  ins as (
    insert into public.lexph_suscriptores (email, email_norm, estado, origen, confirmed_at)
    select s.email, s.email_norm, 'confirmado', 'captacion', now()
      from src s
     where not exists (select 1 from public.email_suppression x where x.email = s.email_norm)
    on conflict (email_norm) do nothing
    returning 1
  )
  select count(*) into v_captacion from ins;

  return jsonb_build_object('ok', true, 'clientes', v_clientes, 'captacion', v_captacion);
end;
$fn$;

revoke all on function public.lexph_importar_audiencia_inicial() from public;
grant execute on function public.lexph_importar_audiencia_inicial() to authenticated;

-- ============================================================================
-- (2) LIMPIEZA idempotente de lo ya contaminado (ya ejecutada en vivo como
--     stop-the-bleed; acá queda versionada y reproducible — R6).
-- ============================================================================

-- (2a) Supresión universal (motivo='invalida', NO 'bounce'). Respeta las que el
--      harvester ya suprimió como 'bounce' (ON CONFLICT DO NOTHING).
insert into public.email_suppression (email, motivo, origen, prospecto_id)
select distinct lower(btrim(p.email)), 'invalida', 'sistema_padron_sin_email', p.id
  from public.prospectos p
 where lower(p.email) like '%.invalid'
on conflict (email) do nothing;

-- (2b) Baja de los suscriptores sintéticos (fuera de la audiencia mailable).
--      Ir a 'baja' no dispara el trigger de aviso (sólo mira estado='confirmado').
update public.lexph_suscriptores
   set estado = 'baja', baja_at = now()
 where lower(email) like '%.invalid'
   and estado <> 'baja';

-- (2c) Stop-the-bleed: cancelar las pendientes en la cola del newsletter.
update public.email_queue
   set status = 'cancelled', enviado_at = now(),
       ultimo_error = 'dirección sintética sin email real (NO FIGURA en padrón); excluida del envío (E-GG-267)'
 where template_slug like 'lexph-newsletter%'
   and lower(to_email) like '%.invalid'
   and status = 'pending'
   and enviado_at is null;

-- (2d) De-clutter: archivar las campanitas "Rebotó un email a ...@padron.invalid".
update public.notificaciones_internas
   set archivado_at = now()
 where archivado_at is null
   and titulo ilike 'Rebotó un email a %@padron.invalid';
