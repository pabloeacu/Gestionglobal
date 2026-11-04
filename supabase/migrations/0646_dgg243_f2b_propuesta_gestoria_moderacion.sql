-- 0646 · DGG-243 · F2b — carril de PROPUESTA de gestoría + MODERACIÓN de credenciales regulatorias.
--
-- Misión (Pablo): "La carga de credenciales la puede hacer gestoría y gerencia. Tal y como sucede en
-- la carga del otorgamiento." F2a dio la carga DIRECTA de gerencia (credencial_reg_set → 'publicado').
-- F2b suma el carril de la GESTORÍA externa (sitio por-trámite, acceso por token): la gestoría PROPONE
-- usuario+contraseña y la GERENCIA modera (publicar / editar+publicar / descartar), igual que el
-- otorgamiento (mig 0448).
--
-- DIFERENCIA DE SEGURIDAD CLAVE vs otorgamiento: el otorgamiento viaja como jsonb DENTRO de la línea de
-- tracking (tracking_lineas.otorgamiento). La CONTRASEÑA jamás puede viajar al tracking (regla del
-- proyecto + copy del modal: "la contraseña nunca queda a la vista ni viaja al tracking"). Por eso el
-- secreto propuesto vive en el MISMO store cifrado dedicado (credenciales_regulatorias) en columnas
-- prop_* — nunca en tracking_lineas. La moderación lee de ahí por RPC SECURITY DEFINER.
--
-- MODELO propuesta-vs-publicada (Pablo: "una propuesta nueva nunca pisa las credenciales que el cliente
-- ya está usando"): una fila puede tener (a) sólo main publicado (estado 'publicado', sin prop), (b)
-- sólo prop (primera credencial que trae la gestoría, estado 'propuesto', main NULL → el cliente no ve
-- nada porque meta/revelar filtran estado='publicado'), o (c) main publicado + prop pendiente (el
-- cliente sigue viendo la publicada; gerencia modera la prop). Publicar: prop → main, se limpia prop.
-- Descartar: se limpia prop (main intacto); si la fila era prop-only, se borra.
--
-- Reglas: R2 (RLS ya activa sin policy — acceso sólo por estas RPCs SD), R5 (multi-estado → RPC SD),
-- R12 (tenancy: staff en moderación; el gestor valida token), R16 (RPCs net-new → cero overload;
-- gestor_obtener_info_solicitud se extiende con CREATE OR REPLACE misma firma, sólo suma claves al
-- jsonb → sin overload), R17 (audit RLS-only escrito por SD). Aditivo: no rompe el circuito de
-- otorgamiento ni la carga directa F2a.

-- ============================================================================
-- 1. Columnas de PROPUESTA en el store (prop_*) — nunca tocan main/estado al proponer
-- ============================================================================
ALTER TABLE public.credenciales_regulatorias
  ADD COLUMN IF NOT EXISTS prop_usuario          text,
  ADD COLUMN IF NOT EXISTS prop_password_cifrada bytea,
  ADD COLUMN IF NOT EXISTS prop_origen           text,          -- 'gestoria' (futuro: otros orígenes)
  ADD COLUMN IF NOT EXISTS prop_por              text,          -- etiqueta del proponente (nombre/email del acceso)
  ADD COLUMN IF NOT EXISTS prop_tramite_id       uuid,          -- trámite desde el que se informó (contexto/link)
  ADD COLUMN IF NOT EXISTS prop_at               timestamptz;   -- marca de propuesta pendiente (NULL = sin propuesta)

COMMENT ON COLUMN public.credenciales_regulatorias.prop_at IS
  'DGG-243 F2b · Marca de propuesta de gestoría PENDIENTE de moderación (NULL = sin propuesta). '
  'prop_password_cifrada = pgcrypto (igual que password_cifrada). Al publicar prop→main y se limpia; '
  'al descartar se limpia prop (main intacto). El secreto propuesto NUNCA viaja al tracking.';

CREATE INDEX IF NOT EXISTS idx_cred_reg_prop_pendiente
  ON public.credenciales_regulatorias(prop_at) WHERE prop_at IS NOT NULL;

-- ============================================================================
-- 2. gestor_obtener_info_solicitud: + tramite_categoria (misma firma, sólo suma clave jsonb)
--    Gatea en el front el bloque "Informar credenciales de DDJJ" igual que el botón F2a
--    (servicio rpac_ddjj O categoría 'dj'). El gate fuente-de-verdad vive en la RPC (abajo).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.gestor_obtener_info_solicitud(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_acc public.accesos_externos%ROWTYPE;
  v_sol public.solicitudes%ROWTYPE;
  v_servicio_nombre text;
  v_servicio_codigo text;
  v_tramite_categoria text;
  v_datos jsonb;
  v_form_titulo text;
  v_form_categoria text;
  v_form_schema jsonb;
  v_adjuntos jsonb;
  v_pedidos_doc jsonb;
BEGIN
  SELECT * INTO v_acc FROM public.accesos_externos WHERE token = p_token;
  IF v_acc.token IS NULL THEN
    RAISE EXCEPTION 'Token inválido' USING ERRCODE = '42501';
  END IF;
  IF v_acc.revocado_at IS NOT NULL OR v_acc.vence_at < now() THEN
    RAISE EXCEPTION 'Token revocado o vencido' USING ERRCODE = '42501';
  END IF;
  IF v_acc.recurso_tipo NOT IN ('solicitud','tramite') THEN
    RAISE EXCEPTION 'Token no asociado a una solicitud' USING ERRCODE = '22023';
  END IF;

  IF v_acc.recurso_tipo = 'solicitud' THEN
    SELECT * INTO v_sol FROM public.solicitudes WHERE id = v_acc.recurso_id;
  ELSE
    SELECT * INTO v_sol FROM public.solicitudes WHERE tramite_id = v_acc.recurso_id LIMIT 1;
  END IF;
  IF v_sol.id IS NULL THEN
    RAISE EXCEPTION 'Solicitud no encontrada' USING ERRCODE = 'P0002';
  END IF;

  SELECT s.nombre, s.codigo INTO v_servicio_nombre, v_servicio_codigo
    FROM public.servicios s
   WHERE s.id = COALESCE(
           v_sol.servicio_solicitado_id,
           (SELECT t.servicio_id FROM public.tramites t WHERE t.id = v_sol.tramite_id));

  -- E2b · categoría REAL del trámite (gatea credenciales DDJJ: categoría 'dj').
  SELECT t.categoria INTO v_tramite_categoria
    FROM public.tramites t WHERE t.id = v_sol.tramite_id;

  IF v_sol.formulario_submission_id IS NOT NULL THEN
    SELECT fs.datos, f.titulo, f.categoria, f.schema
      INTO v_datos, v_form_titulo, v_form_categoria, v_form_schema
      FROM public.formulario_submissions fs
      JOIN public.formularios f ON f.id = fs.formulario_id
     WHERE fs.id = v_sol.formulario_submission_id;
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'field_name', fa.field_name,
        'label', private.form_field_label(v_form_schema, fa.field_name),
        'filename_original', fa.filename_original,
        'storage_path', fa.storage_path
      ) ORDER BY fa.uploaded_at), '[]'::jsonb)
      INTO v_adjuntos
      FROM public.formulario_adjuntos fa
      WHERE fa.submission_id = v_sol.formulario_submission_id
        AND fa.visible_gestoria;
  ELSE
    v_datos := '{}'::jsonb;
    v_adjuntos := '[]'::jsonb;
  END IF;

  IF v_sol.tramite_id IS NOT NULL THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'descripcion', it.descripcion,
        'filename_original', COALESCE(it.archivo_nombre, 'archivo'),
        'storage_path', it.archivo_path,
        'respuesta_texto', it.respuesta_texto,
        'estado', it.estado,
        'subido_at', it.subido_at
      ) ORDER BY it.subido_at NULLS LAST), '[]'::jsonb)
      INTO v_pedidos_doc
      FROM public.tramite_pedidos_doc pd
      JOIN public.tramite_pedidos_doc_items it ON it.pedido_id = pd.id
     WHERE pd.tramite_id = v_sol.tramite_id
       AND (it.archivo_path IS NOT NULL OR it.respuesta_texto IS NOT NULL)
       AND it.estado IN ('subido','aprobado')
       AND it.visible_gestoria;
  ELSE
    v_pedidos_doc := '[]'::jsonb;
  END IF;

  RETURN jsonb_build_object(
    'solicitud_id', v_sol.id,
    'servicio',           COALESCE(v_servicio_nombre, v_sol.servicio_slug, 'Servicio'),
    'servicio_codigo',    v_servicio_codigo,
    'tramite_categoria',  v_tramite_categoria,
    'solicitante_nombre', COALESCE(v_sol.solicitante_nombre, ''),
    'solicitante_email',  COALESCE(v_sol.solicitante_email, ''),
    'solicitante_telefono', COALESCE(v_sol.solicitante_telefono, ''),
    'formulario_titulo',  v_form_titulo,
    'formulario_categoria', v_form_categoria,
    'datos',              COALESCE(v_datos, '{}'::jsonb),
    'adjuntos',           v_adjuntos,
    'pedidos_doc',        COALESCE(v_pedidos_doc, '[]'::jsonb),
    'created_at',         v_sol.created_at
  );
END;
$function$;

-- ============================================================================
-- 3. PROPUESTA de la gestoría (superficie ANÓNIMA por token). NO toca main/estado publicado.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.credencial_reg_proponer_gestor(
  p_token      text,
  p_plataforma text,
  p_usuario    text,
  p_password   text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_acc public.accesos_externos%ROWTYPE;
  v_tramite_id uuid;
  v_admin_id uuid;
  v_serv_codigo text;
  v_categoria text;
  v_label text;
  v_key text;
  v_usuario text := NULLIF(btrim(p_usuario), '');
  v_password text := NULLIF(p_password, '');
BEGIN
  IF p_plataforma NOT IN ('ddjj','arca') THEN
    RAISE EXCEPTION 'plataforma inválida: %', p_plataforma USING ERRCODE = '22023';
  END IF;
  IF v_usuario IS NULL AND v_password IS NULL THEN
    RAISE EXCEPTION 'nada para proponer: usuario y contraseña vacíos' USING ERRCODE = '22023';
  END IF;

  -- (a) validar token (mismo candado que gestor_cargar_avance)
  SELECT * INTO v_acc FROM public.accesos_externos WHERE token = p_token;
  IF v_acc.token IS NULL THEN RAISE EXCEPTION 'Token inválido' USING ERRCODE = 'P0002'; END IF;
  IF v_acc.revocado_at IS NOT NULL THEN RAISE EXCEPTION 'Acceso revocado' USING ERRCODE = '42501'; END IF;
  IF v_acc.vence_at < now() THEN RAISE EXCEPTION 'Acceso vencido' USING ERRCODE = '42501'; END IF;

  -- (b) resolver trámite (acepta token de solicitud o de trámite)
  IF v_acc.recurso_tipo = 'solicitud' THEN
    SELECT tramite_id INTO v_tramite_id FROM public.solicitudes WHERE id = v_acc.recurso_id;
  ELSIF v_acc.recurso_tipo = 'tramite' THEN
    v_tramite_id := v_acc.recurso_id;
  ELSE
    RAISE EXCEPTION 'Token no corresponde a un trámite' USING ERRCODE = '22023';
  END IF;
  IF v_tramite_id IS NULL THEN
    RAISE EXCEPTION 'La solicitud aún no tiene trámite asociado' USING ERRCODE = '22023';
  END IF;

  -- (c) administración + gate de servicio/categoría DDJJ (espeja el botón F2a)
  SELECT t.administracion_id, s.codigo, t.categoria
    INTO v_admin_id, v_serv_codigo, v_categoria
    FROM public.tramites t
    LEFT JOIN public.servicios s ON s.id = t.servicio_id
   WHERE t.id = v_tramite_id;
  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'El trámite no tiene administración vinculada' USING ERRCODE = '22023';
  END IF;
  IF p_plataforma = 'ddjj'
     AND COALESCE(v_serv_codigo, '') <> 'rpac_ddjj'
     AND COALESCE(v_categoria, '') <> 'dj' THEN
    RAISE EXCEPTION 'Las credenciales de DDJJ sólo aplican a trámites de Declaraciones Juradas'
      USING ERRCODE = '22023';
  END IF;

  v_key := private.cred_reg_key();
  IF v_key IS NULL THEN
    RAISE EXCEPTION 'clave de cifrado no configurada (Vault: cred_reg_key)' USING ERRCODE = '55000';
  END IF;

  v_label := COALESCE(NULLIF(v_acc.nombre_destinatario, ''), v_acc.email_destinatario, 'gestoría');

  -- (d) upsert SÓLO columnas prop_* — main/estado publicado intactos (no pisa lo que ve el cliente).
  --     Fila nueva (sin main): nace estado='propuesto' (el cliente no la ve hasta publicar).
  INSERT INTO public.credenciales_regulatorias AS c
    (administracion_id, plataforma, estado,
     prop_usuario, prop_password_cifrada, prop_origen, prop_por, prop_tramite_id, prop_at,
     updated_at)
  VALUES (
    v_admin_id, p_plataforma, 'propuesto',
    v_usuario,
    CASE WHEN v_password IS NULL THEN NULL ELSE extensions.pgp_sym_encrypt(v_password, v_key) END,
    'gestoria', v_label, v_tramite_id, now(),
    now()
  )
  ON CONFLICT (administracion_id, plataforma) DO UPDATE SET
    prop_usuario          = v_usuario,
    prop_password_cifrada = CASE WHEN v_password IS NULL THEN NULL
                                 ELSE extensions.pgp_sym_encrypt(v_password, v_key) END,
    prop_origen           = 'gestoria',
    prop_por              = v_label,
    prop_tramite_id       = v_tramite_id,
    prop_at               = now();
    -- NOTA: NO se tocan c.usuario / c.password_cifrada / c.estado (la publicada sigue vigente).

  -- (e) marcar el acceso usado (telemetría, igual que gestor_cargar_avance)
  UPDATE public.accesos_externos
     SET usado_at = COALESCE(usado_at, now()), ultima_visita_at = now(),
         total_visitas = COALESCE(total_visitas, 0) + 1
   WHERE token = p_token;
END $fn$;
REVOKE ALL ON FUNCTION public.credencial_reg_proponer_gestor(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.credencial_reg_proponer_gestor(text, text, text, text) TO anon, authenticated;

-- ============================================================================
-- 4. Cola de moderación de propuestas (staff). SIN contraseñas (sólo "tiene_password").
-- ============================================================================
CREATE OR REPLACE FUNCTION public.credencial_reg_moderacion_pendientes()
RETURNS TABLE(
  administracion_id uuid, plataforma text, admin_nombre text,
  prop_tramite_id uuid, prop_tramite_codigo text,
  prop_usuario text, prop_tiene_password boolean,
  prop_origen text, prop_por text, prop_at timestamptz,
  actual_usuario text, actual_tiene_password boolean, actual_estado text
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT c.administracion_id, c.plataforma, a.nombre,
         c.prop_tramite_id, t.codigo,
         c.prop_usuario, (c.prop_password_cifrada IS NOT NULL),
         c.prop_origen, c.prop_por, c.prop_at,
         -- "actual" = lo PUBLICADO hoy (lo que ve el cliente); si no está publicado, nada.
         CASE WHEN c.estado = 'publicado' THEN c.usuario ELSE NULL END,
         CASE WHEN c.estado = 'publicado' THEN (c.password_cifrada IS NOT NULL) ELSE false END,
         c.estado
  FROM public.credenciales_regulatorias c
  JOIN public.administraciones a ON a.id = c.administracion_id
  LEFT JOIN public.tramites t ON t.id = c.prop_tramite_id
  WHERE c.prop_at IS NOT NULL AND private.is_staff()
  ORDER BY c.prop_at ASC;
$fn$;
REVOKE ALL ON FUNCTION public.credencial_reg_moderacion_pendientes() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.credencial_reg_moderacion_pendientes() TO authenticated;

-- ============================================================================
-- 5. Revelar la contraseña PROPUESTA (staff-only) — para que gerencia la verifique antes de publicar.
--    Auditado (accion='revelar_propuesta'). Independiente de credencial_reg_revelar (que revela la publicada).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.credencial_reg_revelar_propuesta(
  p_administracion_id uuid,
  p_plataforma        text
) RETURNS text
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE v_cipher bytea; v_key text; v_pwd text;
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'solo gerencia puede revelar propuestas' USING ERRCODE = '42501';
  END IF;
  IF p_plataforma NOT IN ('ddjj','arca') THEN
    RAISE EXCEPTION 'plataforma inválida: %', p_plataforma USING ERRCODE = '22023';
  END IF;
  SELECT prop_password_cifrada INTO v_cipher
    FROM public.credenciales_regulatorias
    WHERE administracion_id = p_administracion_id AND plataforma = p_plataforma;
  IF v_cipher IS NULL THEN RETURN NULL; END IF;
  v_key := private.cred_reg_key();
  IF v_key IS NULL THEN
    RAISE EXCEPTION 'clave de cifrado no configurada (Vault: cred_reg_key)' USING ERRCODE = '55000';
  END IF;
  v_pwd := extensions.pgp_sym_decrypt(v_cipher, v_key);
  INSERT INTO public.credenciales_regulatorias_accesos (administracion_id, plataforma, accedido_por, rol, accion)
  VALUES (p_administracion_id, p_plataforma, auth.uid(), 'staff', 'revelar_propuesta');
  RETURN v_pwd;
END $fn$;
REVOKE ALL ON FUNCTION public.credencial_reg_revelar_propuesta(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.credencial_reg_revelar_propuesta(uuid, text) TO authenticated;

-- ============================================================================
-- 6. MODERAR la propuesta (staff): publicar (con edición opcional) | descartar.
--    p_usuario/p_password NULL = usar la propuesta tal cual; no-NULL = gerencia la editó.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.credencial_reg_moderar(
  p_administracion_id uuid,
  p_plataforma        text,
  p_accion            text,
  p_usuario           text DEFAULT NULL,
  p_password          text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_key text;
  c public.credenciales_regulatorias%ROWTYPE;
  v_final_usuario text;
  v_final_cipher bytea;
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'solo gerencia puede moderar credenciales' USING ERRCODE = '42501';
  END IF;
  IF p_plataforma NOT IN ('ddjj','arca') THEN
    RAISE EXCEPTION 'plataforma inválida: %', p_plataforma USING ERRCODE = '22023';
  END IF;
  IF p_accion NOT IN ('publicar','descartar') THEN
    RAISE EXCEPTION 'acción inválida: %', p_accion USING ERRCODE = '22023';
  END IF;

  SELECT * INTO c FROM public.credenciales_regulatorias
   WHERE administracion_id = p_administracion_id AND plataforma = p_plataforma
   FOR UPDATE;
  IF NOT FOUND OR c.prop_at IS NULL THEN
    RAISE EXCEPTION 'no hay una propuesta pendiente para moderar' USING ERRCODE = '22023';
  END IF;

  IF p_accion = 'descartar' THEN
    -- Limpiar la propuesta; la publicada (si existe) queda intacta.
    IF c.usuario IS NULL AND c.password_cifrada IS NULL THEN
      -- Fila prop-only (nunca hubo publicada): se borra para no dejar fila hueca.
      DELETE FROM public.credenciales_regulatorias
        WHERE administracion_id = p_administracion_id AND plataforma = p_plataforma;
    ELSE
      UPDATE public.credenciales_regulatorias SET
        prop_usuario = NULL, prop_password_cifrada = NULL, prop_origen = NULL,
        prop_por = NULL, prop_tramite_id = NULL, prop_at = NULL,
        moderada_por = auth.uid(), moderada_at = now()
      WHERE administracion_id = p_administracion_id AND plataforma = p_plataforma;
    END IF;
    RETURN;
  END IF;

  -- p_accion = 'publicar': prop → main (con edición opcional de gerencia), se limpia prop.
  v_final_usuario := COALESCE(NULLIF(btrim(p_usuario), ''), c.prop_usuario, c.usuario);

  IF NULLIF(p_password, '') IS NOT NULL THEN
    -- Gerencia editó la contraseña → re-cifrar la nueva.
    v_key := private.cred_reg_key();
    IF v_key IS NULL THEN
      RAISE EXCEPTION 'clave de cifrado no configurada (Vault: cred_reg_key)' USING ERRCODE = '55000';
    END IF;
    v_final_cipher := extensions.pgp_sym_encrypt(p_password, v_key);
  ELSE
    -- Sin edición: la propuesta tal cual; si la prop no trae password, conserva la publicada.
    v_final_cipher := COALESCE(c.prop_password_cifrada, c.password_cifrada);
  END IF;

  UPDATE public.credenciales_regulatorias SET
    usuario          = v_final_usuario,
    password_cifrada = v_final_cipher,
    estado           = 'publicado',
    prop_usuario = NULL, prop_password_cifrada = NULL, prop_origen = NULL,
    prop_por = NULL, prop_tramite_id = NULL, prop_at = NULL,
    moderada_por = auth.uid(), moderada_at = now(),
    updated_by = auth.uid(), updated_at = now()
  WHERE administracion_id = p_administracion_id AND plataforma = p_plataforma;
END $fn$;
REVOKE ALL ON FUNCTION public.credencial_reg_moderar(uuid, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.credencial_reg_moderar(uuid, text, text, text, text) TO authenticated;

-- ----------------------------------------------------------------------------
-- SMOKES (MCP, DO $$ … RAISE EXCEPTION 'rollback' — ver reporte §6):
--   P1 gestor propone en trámite DDJJ (token válido) → fila prop_at set, main/estado intactos
--   P2 propuesta sobre una publicada existente → el cliente sigue viendo la publicada (meta)
--   P3 token vencido/revocado/plataforma inválida/servicio no-DDJJ → excepción (sin escribir)
--   M1 publicar → prop→main, estado='publicado', prop_* NULL, password descifra OK
--   M2 publicar editando usuario+password → main con los valores editados
--   M3 descartar sobre prop-only → fila borrada; sobre publicada+prop → prop limpio, main intacto
--   M4 moderar sin propuesta pendiente → 22023; no-staff → 42501
--   R16: cero overloads en las 4 funciones net-new + gestor_obtener_info_solicitud
-- ----------------------------------------------------------------------------
