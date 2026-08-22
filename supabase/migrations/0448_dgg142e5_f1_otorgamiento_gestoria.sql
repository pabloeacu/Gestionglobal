-- 0448_dgg142e5_f1_otorgamiento_gestoria.sql
-- DGG-142 · Etapa 5 · F1 — "Inscripción/Renovación OTORGADA" desde la
-- gestoría externa (verbatim Pablo, punto 7): el gestor completa un modal
-- estructurado con Matrícula / Legajo / Fecha de emisión / Fecha de
-- vencimiento (todos OPCIONALES). Los datos viajan como PROPUESTA dentro del
-- aporte (tracking_lineas.otorgamiento->'propuesto', inmutable), pasan por
-- MODERACIÓN, y al PUBLICAR la gerencia los aplica —editables— a la ficha
-- (administraciones.matricula_rpac / legajo_rpac / matricula_rpac_fecha /
-- matricula_rpac_vencimiento). Escribir el vencimiento dispara el sync
-- ficha→agenda (mig 0444) → la alarma 45/30/15 se arma sola.
--
-- Seguridad: el gestor (superficie ANÓNIMA por token) jamás toca la ficha —
-- sólo propone; la escritura vive en la RPC staff. Sanitizador compartido
-- private.gg_sanitizar_otorgamiento (whitelist de claves, largo <=40,
-- fechas tipadas, vencimiento >= emisión) + gate de servicio RPAC en las
-- DOS puntas (un payload crafteado no puede adjuntar otorgamiento a un
-- trámite ajeno a matrícula).
--
-- R16 (dos firmas cambian de aridad): gestor_cargar_avance 3→4 params y
-- tracking_moderar_gestor_avance 6→7 → DROP + CREATE + re-GRANT. La cola
-- tracking_moderacion_pendientes cambia el RETURNS TABLE (+6 cols) → ídem
-- (precedente exacto: mig 0441). gestor_obtener_info_solicitud conserva
-- firma (sólo suma 'servicio_codigo' al jsonb) → CREATE OR REPLACE.
-- ⚠️ Deploy: aplicar esta mig ANTES del front (los DEFAULT NULL hacen que
-- el front viejo siga resolviendo contra las firmas nuevas).

-- (1) Columna de la propuesta -----------------------------------------------
ALTER TABLE public.tracking_lineas ADD COLUMN IF NOT EXISTS otorgamiento jsonb;
COMMENT ON COLUMN public.tracking_lineas.otorgamiento IS
  'DGG-142 E5 · Otorgamiento RPAC propuesto por la gestoría: {propuesto:{matricula,legajo,fecha_emision,fecha_vencimiento}} (inmutable) + {aplicado:{...}, aplicado_at, aplicado_por} cuando gerencia lo asienta en la ficha al publicar.';

-- (2) Sanitizador compartido (una sola definición de validez) ----------------
CREATE OR REPLACE FUNCTION private.gg_sanitizar_otorgamiento(p_in jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_mat text; v_leg text; v_fe date; v_fv date; v_out jsonb := '{}'::jsonb;
BEGIN
  IF p_in IS NULL OR jsonb_typeof(p_in) <> 'object' THEN RETURN NULL; END IF;

  v_mat := NULLIF(trim(COALESCE(p_in->>'matricula', '')), '');
  v_leg := NULLIF(trim(COALESCE(p_in->>'legajo', '')), '');
  IF length(COALESCE(v_mat, '')) > 40 OR length(COALESCE(v_leg, '')) > 40 THEN
    RAISE EXCEPTION 'Matrícula/legajo demasiado largos (máx 40)' USING ERRCODE = '22023';
  END IF;

  BEGIN
    v_fe := NULLIF(trim(COALESCE(p_in->>'fecha_emision', '')), '')::date;
    v_fv := NULLIF(trim(COALESCE(p_in->>'fecha_vencimiento', '')), '')::date;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Fecha de otorgamiento inválida' USING ERRCODE = '22023';
  END;
  IF v_fe IS NOT NULL AND v_fv IS NOT NULL AND v_fv < v_fe THEN
    RAISE EXCEPTION 'El vencimiento no puede ser anterior a la emisión' USING ERRCODE = '22023';
  END IF;

  IF v_mat IS NOT NULL THEN v_out := v_out || jsonb_build_object('matricula', v_mat); END IF;
  IF v_leg IS NOT NULL THEN v_out := v_out || jsonb_build_object('legajo', v_leg); END IF;
  IF v_fe  IS NOT NULL THEN v_out := v_out || jsonb_build_object('fecha_emision', v_fe); END IF;
  IF v_fv  IS NOT NULL THEN v_out := v_out || jsonb_build_object('fecha_vencimiento', v_fv); END IF;

  RETURN CASE WHEN v_out = '{}'::jsonb THEN NULL ELSE v_out END;
END;
$$;

-- (3) gestor_obtener_info_solicitud: + servicio_codigo (misma firma) ---------
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

  -- E5: código estable del servicio (solicitud, con fallback al trámite —
  -- pueden divergir) para gatear el modal de otorgamiento en el panel.
  SELECT s.nombre, s.codigo INTO v_servicio_nombre, v_servicio_codigo
    FROM public.servicios s
   WHERE s.id = COALESCE(
           v_sol.servicio_solicitado_id,
           (SELECT t.servicio_id FROM public.tramites t WHERE t.id = v_sol.tramite_id));

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

-- (4) gestor_cargar_avance v2: + p_otorgamiento (3→4 params, R16) ------------
DROP FUNCTION IF EXISTS public.gestor_cargar_avance(text, text, text[]);

CREATE FUNCTION public.gestor_cargar_avance(
  p_token text, p_descripcion text,
  p_archivos_urls text[] DEFAULT '{}'::text[],
  p_otorgamiento jsonb DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_acc public.accesos_externos%ROWTYPE; v_sol public.solicitudes%ROWTYPE;
  v_label text; v_raw text; v_linea_id uuid;
  v_prop jsonb; v_serv_codigo text;
BEGIN
  IF COALESCE(trim(p_descripcion), '') = '' THEN
    RAISE EXCEPTION 'La descripción es obligatoria' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_acc FROM public.accesos_externos WHERE public.accesos_externos.token = p_token;
  IF v_acc.token IS NULL THEN RAISE EXCEPTION 'Token inválido' USING ERRCODE = 'P0002'; END IF;
  IF v_acc.revocado_at IS NOT NULL THEN RAISE EXCEPTION 'Acceso revocado' USING ERRCODE = '42501'; END IF;
  IF v_acc.vence_at < now() THEN RAISE EXCEPTION 'Acceso vencido' USING ERRCODE = '42501'; END IF;
  IF v_acc.recurso_tipo <> 'solicitud' THEN RAISE EXCEPTION 'Token no corresponde a una solicitud' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_sol FROM public.solicitudes s WHERE s.id = v_acc.recurso_id;
  IF v_sol.id IS NULL THEN RAISE EXCEPTION 'Solicitud no encontrada' USING ERRCODE = 'P0002'; END IF;
  IF v_sol.tramite_id IS NULL THEN RAISE EXCEPTION 'La solicitud aún no tiene trámite asociado' USING ERRCODE = '22023'; END IF;

  -- E5 · propuesta de otorgamiento: sanitizar + gate de servicio RPAC.
  v_prop := private.gg_sanitizar_otorgamiento(p_otorgamiento);
  IF v_prop IS NOT NULL THEN
    SELECT s.codigo INTO v_serv_codigo
      FROM public.servicios s
     WHERE s.id = COALESCE(
             v_sol.servicio_solicitado_id,
             (SELECT t.servicio_id FROM public.tramites t WHERE t.id = v_sol.tramite_id));
    IF v_serv_codigo IS NULL
       OR v_serv_codigo NOT IN ('rpac_inscripcion','rpac_inscripcion_juridica','rpac_renovacion') THEN
      RAISE EXCEPTION 'El otorgamiento sólo aplica a trámites de matrícula RPAC' USING ERRCODE = '22023';
    END IF;
  END IF;

  v_label := COALESCE(NULLIF(v_acc.nombre_destinatario, ''), v_acc.email_destinatario);
  v_raw := trim(p_descripcion);
  PERFORM set_config('app.skip_admin_assert', 'on', true);
  INSERT INTO public.tracking_lineas (
    tramite_id, categoria, descripcion, archivos_urls, autor_id, visible_cliente,
    moderacion_estado, gestor_descripcion_original, gestor_label, otorgamiento
  ) VALUES (
    v_sol.tramite_id, 'gestor_avance', v_raw, COALESCE(p_archivos_urls, '{}'::text[]),
    NULL, false, 'pendiente', v_raw, v_label,
    CASE WHEN v_prop IS NULL THEN NULL ELSE jsonb_build_object('propuesto', v_prop) END
  ) RETURNING tracking_lineas.id INTO v_linea_id;
  UPDATE public.accesos_externos
     SET usado_at = COALESCE(usado_at, now()), ultima_visita_at = now(),
         total_visitas = COALESCE(total_visitas, 0) + 1
   WHERE public.accesos_externos.token = p_token;
  RETURN v_linea_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.gestor_cargar_avance(text, text, text[], jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.gestor_cargar_avance(text, text, text[], jsonb) TO anon, authenticated;

-- (5) tracking_moderar_gestor_avance v2: + p_otorgamiento (6→7, R16) ---------
DROP FUNCTION IF EXISTS public.tracking_moderar_gestor_avance(uuid, text, text, text[], text, text);

CREATE FUNCTION public.tracking_moderar_gestor_avance(
  p_linea_id uuid, p_accion text,
  p_descripcion text DEFAULT NULL,
  p_archivos_urls text[] DEFAULT NULL,
  p_estado_asociado text DEFAULT NULL,
  p_motivo text DEFAULT NULL,
  p_otorgamiento jsonb DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_linea public.tracking_lineas%ROWTYPE;
  v_ap jsonb;
  v_serv_codigo text;
  v_admin_id uuid;
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Sólo gerencia puede moderar' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_linea FROM public.tracking_lineas WHERE id = p_linea_id;
  IF v_linea.id IS NULL THEN
    RAISE EXCEPTION 'Línea no encontrada' USING ERRCODE = 'P0002';
  END IF;
  IF v_linea.categoria <> 'gestor_avance' OR v_linea.moderacion_estado <> 'pendiente' THEN
    RAISE EXCEPTION 'La línea no está pendiente de moderación' USING ERRCODE = '22023';
  END IF;

  IF p_estado_asociado IS NOT NULL
     AND p_estado_asociado NOT IN ('abierto','en_progreso','esperando_cliente','resuelto','cerrado','cancelado') THEN
    RAISE EXCEPTION 'Estado asociado inválido: %', p_estado_asociado USING ERRCODE = '22023';
  END IF;
  IF p_descripcion IS NOT NULL AND trim(p_descripcion) = '' THEN
    RAISE EXCEPTION 'La descripción no puede quedar vacía' USING ERRCODE = '22023';
  END IF;

  -- E5 · el otorgamiento SOLO se aplica al publicar (interno/descartar jamás
  -- tocan la ficha).
  v_ap := private.gg_sanitizar_otorgamiento(p_otorgamiento);
  IF v_ap IS NOT NULL AND p_accion <> 'publicar' THEN
    RAISE EXCEPTION 'El otorgamiento sólo puede aplicarse al publicar' USING ERRCODE = '22023';
  END IF;
  IF v_ap IS NOT NULL THEN
    SELECT t.administracion_id, s.codigo INTO v_admin_id, v_serv_codigo
      FROM public.tramites t
      LEFT JOIN public.servicios s ON s.id = t.servicio_id
     WHERE t.id = v_linea.tramite_id;
    IF v_admin_id IS NULL THEN
      RAISE EXCEPTION 'El trámite no tiene administración asociada' USING ERRCODE = '22023';
    END IF;
    IF v_serv_codigo IS NULL
       OR v_serv_codigo NOT IN ('rpac_inscripcion','rpac_inscripcion_juridica','rpac_renovacion') THEN
      RAISE EXCEPTION 'El otorgamiento sólo aplica a trámites de matrícula RPAC' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF p_descripcion IS NOT NULL THEN
    UPDATE public.tracking_lineas SET descripcion = trim(p_descripcion) WHERE id = p_linea_id;
  END IF;
  IF p_archivos_urls IS NOT NULL THEN
    UPDATE public.tracking_lineas SET archivos_urls = p_archivos_urls WHERE id = p_linea_id;
  END IF;

  IF p_accion = 'publicar' THEN
    UPDATE public.tracking_lineas
       SET visible_cliente = true, moderacion_estado = 'publicado',
           estado_asociado = COALESCE(p_estado_asociado, estado_asociado),
           moderada_at = now(), moderada_por = auth.uid()
     WHERE id = p_linea_id;
    IF p_estado_asociado = 'cancelado' THEN
      -- DGG-95 backstop: cancelar cascadea (anula comprobante no-fiscal → saldo a favor).
      PERFORM public.tramite_cancelar(v_linea.tramite_id, true, 'Cancelado desde moderación');
    ELSIF p_estado_asociado IS NOT NULL THEN
      UPDATE public.tramites SET estado = p_estado_asociado, ultima_actividad_at = now()
       WHERE id = v_linea.tramite_id;
    END IF;

    -- E5 · aplicar el otorgamiento DESPUÉS del cambio de estado: si el cierre
    -- disparó la Regla B (0439), el valor explícito aprobado por gerencia
    -- PISA la heurística. Sólo se escriben las claves presentes. El UPDATE
    -- de matricula_rpac_vencimiento dispara el sync 0444 → alarma {45,30,15}
    -- automática. Diff old/new queda en auditoria_cambios (trigger existente).
    IF v_ap IS NOT NULL THEN
      UPDATE public.administraciones a
         SET matricula_rpac = COALESCE(v_ap->>'matricula', a.matricula_rpac),
             legajo_rpac = COALESCE(v_ap->>'legajo', a.legajo_rpac),
             matricula_rpac_fecha = COALESCE((v_ap->>'fecha_emision')::date, a.matricula_rpac_fecha),
             matricula_rpac_vencimiento = COALESCE((v_ap->>'fecha_vencimiento')::date, a.matricula_rpac_vencimiento),
             updated_at = now()
       WHERE a.id = v_admin_id;

      UPDATE public.tracking_lineas
         SET otorgamiento = COALESCE(otorgamiento, '{}'::jsonb)
               || jsonb_build_object('aplicado', v_ap, 'aplicado_at', now(), 'aplicado_por', auth.uid())
       WHERE id = p_linea_id;
    END IF;

    PERFORM private.tracking_notificar_avance_cliente(p_linea_id);

  ELSIF p_accion = 'interno' THEN
    UPDATE public.tracking_lineas
       SET visible_cliente = false, moderacion_estado = 'interno',
           moderada_at = now(), moderada_por = auth.uid()
     WHERE id = p_linea_id;

  ELSIF p_accion = 'descartar' THEN
    UPDATE public.tracking_lineas
       SET visible_cliente = false, moderacion_estado = 'descartado',
           descarte_motivo = NULLIF(trim(COALESCE(p_motivo, '')), ''),
           moderada_at = now(), moderada_por = auth.uid()
     WHERE id = p_linea_id;

  ELSE
    RAISE EXCEPTION 'Acción inválida: %', p_accion USING ERRCODE = '22023';
  END IF;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.tracking_moderar_gestor_avance(uuid, text, text, text[], text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tracking_moderar_gestor_avance(uuid, text, text, text[], text, text, jsonb) TO authenticated;

-- (6) Cola de moderación v3: + otorgamiento + servicio + ficha actual --------
DROP FUNCTION IF EXISTS public.tracking_moderacion_pendientes();

CREATE FUNCTION public.tracking_moderacion_pendientes()
RETURNS TABLE(
  linea_id uuid, tramite_id uuid, tramite_codigo text, servicio_nombre text,
  cliente_nombre text, gestor_label text, descripcion text,
  archivos_urls text[], created_at timestamptz,
  administracion_id uuid, servicio_vigencia_meses integer,
  servicio_codigo text, otorgamiento jsonb,
  ficha_matricula_rpac text, ficha_legajo_rpac text,
  ficha_matricula_rpac_fecha date, ficha_matricula_rpac_vencimiento date
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT tl.id, t.id, t.codigo, COALESCE(s.nombre, t.titulo, 'Trámite'),
         COALESCE(a.nombre, t.solicitante_nombre), tl.gestor_label, tl.descripcion, tl.archivos_urls, tl.created_at,
         t.administracion_id, s.vigencia_meses,
         s.codigo, tl.otorgamiento,
         a.matricula_rpac, a.legajo_rpac, a.matricula_rpac_fecha, a.matricula_rpac_vencimiento
  FROM public.tracking_lineas tl
  JOIN public.tramites t ON t.id = tl.tramite_id
  LEFT JOIN public.servicios s ON s.id = t.servicio_id
  LEFT JOIN public.administraciones a ON a.id = t.administracion_id
  WHERE tl.categoria = 'gestor_avance' AND tl.moderacion_estado = 'pendiente' AND private.is_staff()
  ORDER BY tl.created_at ASC;
$$;

REVOKE EXECUTE ON FUNCTION public.tracking_moderacion_pendientes() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tracking_moderacion_pendientes() TO authenticated;

-- ----------------------------------------------------------------------------
-- SMOKES (MCP tras aplicar, DO $$ ... ROLLBACK):
--   G1 gestor propone otorgamiento en trámite RPAC → linea.otorgamiento.propuesto
--   G2 otorgamiento en servicio NO RPAC → 22023
--   G3 fechas inválidas / venc<emisión / strings >40 → 22023
--   M1 publicar con otorgamiento (editado) → ficha actualizada + alarma
--      'renovacion_rpac' {45,30,15} vigente (sync 0444) + linea.aplicado
--   M2 interno/descartar con otorgamiento → 22023 (ficha intacta)
--   M3 publicar con cierre + otorgamiento → valor explícito pisa Regla B
--   R16: 0 overloads en las 4 funciones
-- ----------------------------------------------------------------------------
