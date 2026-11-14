-- ============================================================================
-- 0693 · DGG-253 — Aviso "credenciales DDJJ listas" (mail + banner + push + campanita)
--
-- Cuando una credencial DDJJ queda LISTA (plataforma='ddjj', estado='publicado',
-- usuario + password cargados) por PRIMERA vez, se avisa al cliente por 4 canales,
-- UNA SOLA VEZ. Cubre las dos rutas que publican una credencial:
--   · credencial_reg_set      (carga directa de gerencia)
--   · credencial_reg_moderar  (aprobación de propuesta de gestoría)
-- …y también cualquier INSERT directo (como la carga masiva DGG-252). No se tocan
-- esas RPCs (R16: sin overloads nuevos) — el disparo cuelga de un trigger.
--
-- Idempotencia: columna-sello `aviso_lista_enviado_at` (NULL = aún no avisado). El
-- WHEN del trigger la exige NULL → nunca re-dispara al editar usuario/password.
-- CRÍTICO: filtra plataforma='ddjj' AND usuario IS NOT NULL → NO alcanza a las
-- credenciales ARCA (password sin usuario, otro flujo).
--
-- Reglas: R1 (persistencia), R5/R12 (RPC SECURITY DEFINER + tenancy), R17 (trigger
-- que escribe en tablas RLS sin policy de write = SECURITY DEFINER), R8 (naming).
-- ============================================================================

-- 1) Columnas-sello (aditivas) --------------------------------------------------
ALTER TABLE public.credenciales_regulatorias
  ADD COLUMN IF NOT EXISTS aviso_lista_enviado_at timestamptz,   -- fan-out one-time
  ADD COLUMN IF NOT EXISTS aviso_banner_visto_at  timestamptz;   -- dismiss del banner

COMMENT ON COLUMN public.credenciales_regulatorias.aviso_lista_enviado_at IS
  'DGG-253: sello del aviso one-time (mail+push+campanita). NULL = aún no avisado.';
COMMENT ON COLUMN public.credenciales_regulatorias.aviso_banner_visto_at IS
  'DGG-253: el cliente cerró el banner del dashboard (X) o entró a /portal/ddjj.';

-- 1-bis) ARM del circuito (OFF por defecto). El portal externo de DDJJ (misgestiones)
-- todavía NO está listo para 2026: dejamos TODO preparado pero nada se dispara ni se
-- muestra hasta que gerencia lo arme (Pablo: "disparemos los avisos de DDJJ").
-- Mientras está OFF: el trigger NO sella ni avisa (las credenciales quedan "pendientes
-- de aviso") y el banner del dashboard NO aparece.
ALTER TABLE public.config_global
  ADD COLUMN IF NOT EXISTS ddjj_avisos_habilitados boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.config_global.ddjj_avisos_habilitados IS
  'DGG-253: arma el circuito de avisos de credenciales DDJJ (mail+banner+push+campanita). OFF hasta que el portal externo esté listo.';

-- 2) Plantilla de email (manaxer-v1) · slug TRANSACCIONAL (no ofrecimiento-/engagement-)
INSERT INTO public.email_templates (
  slug, nombre, asunto, body_html, body_text, from_casilla, reply_to, descripcion,
  activo, variables, kicker, titulo_visual, color_acento, mostrar_logo,
  cuerpo_html_visual, firma, incluir_tabla_envio, cta_text, cta_url, layout_version
) VALUES (
  'ddjj-credenciales-cargadas',
  'DDJJ · Credenciales cargadas (aviso one-time)',
  'Tus accesos para la DDJJ ya están listos, {{nombre_administracion}}',
  '<p>Tu usuario y contraseña del Portal de DDJJ ya están cargados en tu ficha. Entrá a tu portal: {{link_portal}}</p>',
  'Tu usuario y contraseña del Portal de DDJJ ya están cargados en tu ficha. Entrá a tu portal: {{link_portal}}',
  'general', NULL,
  'Aviso transaccional one-time: credenciales DDJJ cargadas y disponibles en el portal.',
  true,
  '{"nombre_administracion":"nombre del cliente","link_portal":"URL a /portal/ddjj"}'::jsonb,
  'OBLIGACIÓN ANUAL · DDJJ',
  '',  -- el masthead PNG lleva el título; evitamos duplicar el h1
  '#009ECA',
  true,
  '<img src="https://www.gestionglobal.ar/email/ddjj-credenciales.png" alt="Tus accesos para la DDJJ ya están listos" width="576" style="display:block;width:100%;max-width:576px;height:auto;border-radius:12px;margin:2px 0 22px;" />'
  || '<p style="margin:0 0 14px;">Hola <strong>{{nombre_administracion}}</strong>,</p>'
  || '<p style="margin:0 0 14px;">Tu <strong>usuario y contraseña del Portal de DDJJ</strong> ya quedaron cargados en tu ficha. Dentro de tu portal te dejamos todo listo y a mano: los <strong>accesos directos</strong>, el botón para entrar al Portal de Declaraciones Juradas y el instructivo paso a paso.</p>'
  || '<p style="margin:0 0 14px;background:#E7F1F9;border-left:4px solid #009ECA;border-radius:10px;padding:12px 14px;color:#0B1F33;">La <strong>DDJJ anual vence el 31 de marzo</strong>. Con los accesos ya preparados podés ir cargando la información con calma y evitar el embudo de febrero y marzo.</p>'
  || '<p style="margin:0 0 4px;">Cuando quieras empezar, contá con nosotros en cada paso. Es un placer asistirte: somos <strong>aliados de tu tiempo</strong>.</p>',
  'El equipo de Gestión Global · Aliados de tu tiempo',
  false,
  'Ir a mis accesos',
  '{{link_portal}}',
  'manaxer-v1'
)
ON CONFLICT (slug) DO UPDATE SET
  asunto = EXCLUDED.asunto, body_html = EXCLUDED.body_html, body_text = EXCLUDED.body_text,
  from_casilla = EXCLUDED.from_casilla, activo = EXCLUDED.activo, variables = EXCLUDED.variables,
  kicker = EXCLUDED.kicker, titulo_visual = EXCLUDED.titulo_visual, color_acento = EXCLUDED.color_acento,
  mostrar_logo = EXCLUDED.mostrar_logo, cuerpo_html_visual = EXCLUDED.cuerpo_html_visual,
  firma = EXCLUDED.firma, incluir_tabla_envio = EXCLUDED.incluir_tabla_envio,
  cta_text = EXCLUDED.cta_text, cta_url = EXCLUDED.cta_url, layout_version = EXCLUDED.layout_version,
  descripcion = EXCLUDED.descripcion, updated_at = now();

-- 3) Helper de fan-out (R17: SECURITY DEFINER owner postgres) --------------------
CREATE OR REPLACE FUNCTION private.credencial_ddjj_aviso_fanout(p_administracion_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'pg_temp'
AS $fn$
DECLARE
  v_email  text;
  v_nombre text;
  v_uid    uuid;
BEGIN
  SELECT a.email, a.nombre INTO v_email, v_nombre
    FROM public.administraciones a WHERE a.id = p_administracion_id;

  -- (1) EMAIL — slug transaccional; sólo si hay destino.
  IF v_email IS NOT NULL AND btrim(v_email) <> '' THEN
    PERFORM public.encolar_email(
      'ddjj-credenciales-cargadas',
      v_email,
      COALESCE(v_nombre, 'administrador'),
      jsonb_build_object(
        'nombre_administracion', COALESCE(v_nombre, 'administrador'),
        'link_portal', 'https://www.gestionglobal.ar/portal/ddjj'
      ),
      p_administracion_id, NULL, 'credenciales_regulatorias', p_administracion_id,
      2::smallint   -- prioridad alta (transaccional)
    );
  END IF;

  -- (2+3) CAMPANITA + PUSH (una sola llamada) para cada usuario administrador del cliente.
  FOR v_uid IN
    SELECT p.id FROM public.profiles p
     WHERE p.administracion_id = p_administracion_id
       AND p.role = 'administrador'
       AND COALESCE(p.activo, true)
  LOOP
    PERFORM private.notif_emitir(
      v_uid,
      'ddjj_credencial_lista',
      'Tus accesos de DDJJ ya están listos',
      'Usuario y contraseña cargados en tu ficha. Entrá a tu portal cuando quieras.',
      '/portal/ddjj',
      jsonb_build_object('administracion_id', p_administracion_id)
    );
  END LOOP;
END;
$fn$;

REVOKE ALL ON FUNCTION private.credencial_ddjj_aviso_fanout(uuid) FROM public, anon, authenticated;

-- 4) Trigger function + trigger (R17: SECURITY DEFINER) --------------------------
CREATE OR REPLACE FUNCTION public.trg_credencial_ddjj_aviso()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'pg_temp'
AS $fn$
BEGIN
  -- ARM: si el circuito no está habilitado, NO sellar ni avisar. La credencial
  -- queda "pendiente de aviso" (aviso_lista_enviado_at NULL) para dispararse cuando
  -- gerencia arme el circuito. Esto cubre el pedido de Pablo (portal 2026 no listo).
  IF NOT COALESCE((SELECT ddjj_avisos_habilitados FROM public.config_global LIMIT 1), false) THEN
    RETURN NEW;
  END IF;

  -- Sello primero (el WHEN exige NULL → el UPDATE no re-dispara el trigger).
  UPDATE public.credenciales_regulatorias
     SET aviso_lista_enviado_at = now()
   WHERE administracion_id = NEW.administracion_id
     AND plataforma = NEW.plataforma;

  -- Fan-out best-effort: un problema de plantilla/canal NUNCA debe abortar el
  -- guardado de la credencial (R17 / patrón alta-cliente-portal).
  BEGIN
    PERFORM private.credencial_ddjj_aviso_fanout(NEW.administracion_id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'DGG-253: fan-out aviso DDJJ falló (adm %): %', NEW.administracion_id, SQLERRM;
  END;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS credencial_ddjj_aviso ON public.credenciales_regulatorias;
CREATE TRIGGER credencial_ddjj_aviso
  AFTER INSERT OR UPDATE ON public.credenciales_regulatorias
  FOR EACH ROW
  WHEN (
    NEW.plataforma = 'ddjj'
    AND NEW.estado = 'publicado'
    AND NEW.usuario IS NOT NULL
    AND NEW.password_cifrada IS NOT NULL
    AND NEW.aviso_lista_enviado_at IS NULL
  )
  EXECUTE FUNCTION public.trg_credencial_ddjj_aviso();

-- 5) credencial_reg_meta: sumar banner_pendiente (misma firma → sin overload, R16)
CREATE OR REPLACE FUNCTION public.credencial_reg_meta(p_administracion_id uuid, p_plataforma text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = 'public', 'pg_temp'
AS $fn$
DECLARE v_staff boolean := private.is_staff(); r record;
BEGIN
  IF p_plataforma NOT IN ('ddjj','arca') THEN
    RAISE EXCEPTION 'plataforma inválida: %', p_plataforma USING ERRCODE = '22023';
  END IF;
  PERFORM private.assert_administracion_access(p_administracion_id);
  IF NOT v_staff AND private.current_administracion_id() IS DISTINCT FROM p_administracion_id THEN
    RAISE EXCEPTION 'acceso denegado' USING ERRCODE = '42501';
  END IF;
  SELECT usuario,
         (password_cifrada IS NOT NULL) AS tiene_password,
         estado, updated_at,
         (prop_at IS NOT NULL) AS pendiente,
         (aviso_banner_visto_at IS NULL) AS banner_no_visto
    INTO r
    FROM public.credenciales_regulatorias
   WHERE administracion_id = p_administracion_id AND plataforma = p_plataforma;
  IF NOT FOUND THEN RETURN jsonb_build_object('existe', false, 'pendiente', false, 'banner_pendiente', false); END IF;
  IF NOT v_staff AND r.estado <> 'publicado' THEN
    RETURN jsonb_build_object('existe', false, 'pendiente', r.pendiente, 'banner_pendiente', false);
  END IF;
  RETURN jsonb_build_object(
    'existe', true, 'usuario', r.usuario, 'tiene_password', r.tiene_password,
    'estado', r.estado, 'updated_at', r.updated_at, 'pendiente', r.pendiente,
    -- el banner del dashboard se muestra sólo si el circuito está ARMADO, la credencial
    -- está lista y el cliente no la descartó (coherencia aviso↔display, §6-e).
    'banner_pendiente', (
      COALESCE((SELECT ddjj_avisos_habilitados FROM public.config_global LIMIT 1), false)
      AND r.estado = 'publicado' AND r.usuario IS NOT NULL AND r.tiene_password AND r.banner_no_visto
    )
  );
END;
$fn$;

-- 6) RPC para descartar el banner (X o primer ingreso a /portal/ddjj) · R12 tenancy
CREATE OR REPLACE FUNCTION public.credencial_ddjj_banner_descartar(p_administracion_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'pg_temp'
AS $fn$
BEGIN
  PERFORM private.assert_administracion_access(p_administracion_id);
  IF NOT private.is_staff() AND private.current_administracion_id() IS DISTINCT FROM p_administracion_id THEN
    RAISE EXCEPTION 'acceso denegado' USING ERRCODE = '42501';
  END IF;
  UPDATE public.credenciales_regulatorias
     SET aviso_banner_visto_at = COALESCE(aviso_banner_visto_at, now())
   WHERE administracion_id = p_administracion_id AND plataforma = 'ddjj';
END;
$fn$;

REVOKE ALL ON FUNCTION public.credencial_ddjj_banner_descartar(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.credencial_ddjj_banner_descartar(uuid) TO authenticated;

-- 7) Supresión de la entidad INTERNA "GG Cursos" (no es cliente): marcarla como
--    ya avisada sin disparar (el SET deja aviso_lista_enviado_at NOT NULL → WHEN false).
UPDATE public.credenciales_regulatorias
   SET aviso_lista_enviado_at = now()
 WHERE plataforma = 'ddjj'
   AND administracion_id = '49527761-4c5f-4950-b3f9-bc5c1293c29e'
   AND aviso_lista_enviado_at IS NULL;

-- NOTA: el backfill de los 19 clientes reales (el "disparar ahora") se corre
-- aparte, impersonando gerente, tras el visto bueno del preview del mail (ver DGG-253).
