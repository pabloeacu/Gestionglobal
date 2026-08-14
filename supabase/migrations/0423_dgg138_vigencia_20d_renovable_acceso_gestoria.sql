-- 0423 · DGG-138: vigencia del acceso externo a gestoría = 20 días RENOVABLES
--
-- Contexto (caso real 14/8: gestor360 con link vencido): la política anterior
-- era 14 días fijos desde la GENERACIÓN del token; los reavisos
-- ("gestoria-info-nueva-disponible") reutilizaban el token vivo SIN extenderlo,
-- y la visita del gestor tampoco lo extendía. Resultado: un link moría a los
-- 14 días de la derivación aunque la gestoría lo estuviera usando activamente
-- (el caso: 24 visitas, última el 10/8, vencido el 12/8).
--
-- Política nueva (decisión Pablo 2026-08-14, DGG-138):
--   · Al crear: 20 días de vigencia (antes 14; v3 tenía DEFAULT 7).
--   · Cada interacción renueva: vence_at = GREATEST(vence_at, now() + 20 días).
--     Interacción = (a) cada envío de email a la gestoría que contenga el link
--     (derivación y reavisos) y (b) cada visita del gestor al panel (la edge
--     acceso-externo registra la visita vía el RPC nuevo).
--   · GREATEST ⇒ renueva la ventana, nunca la acorta ni acumula sumas: el link
--     muere sólo tras 20 días SIN ningún movimiento.
--   · gestor_cargar_avance NO necesita extender: para llegar ahí el panel ya
--     pasó por la edge (que extendió) y la RPC valida vence_at vivo.
--
-- R16: todas las recreaciones mantienen firma idéntica (sólo defaults/cuerpo)
--      ⇒ CREATE OR REPLACE no genera overloads. Smoke al pie.
-- R18: smoke e2e (BEGIN/ROLLBACK) se ejercita post-mig vía MCP (DO $$ ... RAISE).

-- ---------------------------------------------------------------------------
-- 1 · generar_acceso_externo: default 14 → 20
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.generar_acceso_externo(
  p_recurso_tipo text, p_recurso_id uuid, p_email_destinatario text,
  p_nombre_destinatario text DEFAULT NULL::text,
  p_dias_validez integer DEFAULT 20,
  p_observaciones text DEFAULT NULL::text
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE v_token text; v_dias int;
BEGIN
  IF NOT private.is_staff() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF p_recurso_tipo NOT IN ('tramite','solicitud','tracking','documento') THEN
    RAISE EXCEPTION 'recurso_tipo invalido: %', p_recurso_tipo USING ERRCODE='22023'; END IF;
  -- DGG-138: política 20 días renovables.
  v_dias := COALESCE(p_dias_validez, 20);
  IF v_dias < 1 OR v_dias > 365 THEN
    RAISE EXCEPTION 'dias_validez fuera de rango' USING ERRCODE='22023'; END IF;
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  INSERT INTO public.accesos_externos(token, recurso_tipo, recurso_id, email_destinatario, nombre_destinatario, vence_at, created_by, observaciones)
  VALUES (v_token, p_recurso_tipo, p_recurso_id, p_email_destinatario, p_nombre_destinatario,
          now() + (v_dias || ' days')::interval, auth.uid(), p_observaciones);
  RETURN v_token;
END $function$;

-- ---------------------------------------------------------------------------
-- 2 · NUEVO acceso_externo_registrar_visita: la visita del gestor renueva +20d
--     (la llama la edge acceso-externo con service_role; reemplaza su UPDATE
--     inline de ultima_visita_at/total_visitas/usado_at y suma la extensión).
--     Devuelve el vence_at resultante (NULL si token inválido/vencido/revocado).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.acceso_externo_registrar_visita(p_token text)
RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_vence timestamptz;
BEGIN
  IF p_token IS NULL OR p_token !~ '^[a-f0-9]{32,128}$' THEN
    RETURN NULL;
  END IF;
  -- Atómico: sólo toca tokens vivos; GREATEST nunca acorta la vigencia.
  UPDATE public.accesos_externos
     SET ultima_visita_at = now(),
         total_visitas    = COALESCE(total_visitas, 0) + 1,
         usado_at         = COALESCE(usado_at, now()),
         vence_at         = GREATEST(vence_at, now() + interval '20 days')
   WHERE token = p_token
     AND revocado_at IS NULL
     AND vence_at > now()
  RETURNING vence_at INTO v_vence;
  RETURN v_vence; -- NULL si no matcheó (vencido/revocado/inexistente)
END $function$;

-- R6: grants explícitos. Es un endpoint interno de la edge (service_role);
-- ni anon ni authenticated deben poder inflar visitas/vigencia.
REVOKE ALL ON FUNCTION public.acceso_externo_registrar_visita(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.acceso_externo_registrar_visita(text) TO service_role;

COMMENT ON FUNCTION public.acceso_externo_registrar_visita(text) IS
  'DGG-138: registra la visita del gestor (visitas/usado) y renueva la vigencia a GREATEST(vence_at, now()+20d). Sólo service_role (edge acceso-externo).';

-- ---------------------------------------------------------------------------
-- 3 · derivacion_reavisar_gestoria: (a) si regenera, 20 días (antes 14);
--     (b) si el token está VIVO, ahora lo EXTIENDE (antes lo reusaba sin tocar).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.derivacion_reavisar_gestoria(
  p_tramite_id uuid, p_mensaje text DEFAULT NULL::text, p_adjuntos jsonb DEFAULT '[]'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_deriv public.solicitud_derivaciones%ROWTYPE;
  v_tramite public.tramites%ROWTYPE;
  v_vence timestamptz; v_revocado timestamptz;
  v_token text; v_url text; v_mensaje text;
  v_servicio text;
  v_solicitante text;
  v_adjuntos jsonb;
  v_adj_nuevos jsonb;
  v_adj_count int;
  v_elem jsonb;
  v_total_bytes bigint := 0;
  v_vence_nuevo timestamptz;
  c_max_total_bytes CONSTANT bigint := 4718592; -- 4,5 MB (espejo del techo real del despachador)
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  IF NOT private.is_staff() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;

  IF jsonb_typeof(COALESCE(p_adjuntos, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'p_adjuntos debe ser un array' USING ERRCODE = '22023';
  END IF;
  v_adj_count := jsonb_array_length(COALESCE(p_adjuntos, '[]'::jsonb));
  IF v_adj_count > 10 THEN
    RAISE EXCEPTION 'Hasta 10 adjuntos por aviso (recibidos: %)', v_adj_count USING ERRCODE = '22023';
  END IF;
  v_adjuntos := '[]'::jsonb;
  FOR v_elem IN SELECT * FROM jsonb_array_elements(COALESCE(p_adjuntos, '[]'::jsonb)) LOOP
    IF COALESCE(NULLIF(trim(v_elem->>'path'), ''), NULL) IS NULL
       OR COALESCE(NULLIF(trim(v_elem->>'filename'), ''), NULL) IS NULL THEN
      RAISE EXCEPTION 'Cada adjunto necesita path y filename' USING ERRCODE = '22023';
    END IF;
    v_total_bytes := v_total_bytes + GREATEST(COALESCE((v_elem->>'size')::bigint, 0), 0);
    v_adjuntos := v_adjuntos || jsonb_build_array(jsonb_build_object(
      'path', trim(v_elem->>'path'),
      'filename', trim(v_elem->>'filename'),
      'mime', COALESCE(NULLIF(trim(v_elem->>'mime'), ''), 'application/octet-stream'),
      'size', COALESCE((v_elem->>'size')::bigint, 0)
    ));
  END LOOP;
  IF v_total_bytes > c_max_total_bytes THEN
    RAISE EXCEPTION 'Los adjuntos superan el máximo de 4,5 MB en total del email (recibidos: % bytes)', v_total_bytes
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_tramite FROM public.tramites WHERE id = p_tramite_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Trámite no existe'; END IF;
  IF v_tramite.estado IN ('cerrado','cancelado') THEN
    RAISE EXCEPTION 'El trámite está % — no se puede reavisar a la gestoría ni reabrir su acceso.', v_tramite.estado
      USING ERRCODE = 'check_violation';
  END IF;
  SELECT d.* INTO v_deriv
    FROM public.solicitud_derivaciones d
    JOIN public.solicitudes s ON s.id = d.solicitud_id
   WHERE s.tramite_id = p_tramite_id
   ORDER BY d.enviada_at DESC LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Este trámite no fue derivado a una gestoría' USING ERRCODE = 'P0002';
  END IF;

  SELECT COALESCE(sv.nombre, s.servicio_slug, v_tramite.titulo, 'Trámite'),
         COALESCE(NULLIF(v_tramite.solicitante_nombre, ''), s.solicitante_nombre, '')
    INTO v_servicio, v_solicitante
    FROM public.solicitudes s
    LEFT JOIN public.servicios sv ON sv.id = s.servicio_solicitado_id
   WHERE s.id = v_deriv.solicitud_id;
  v_servicio := COALESCE(v_servicio, v_tramite.titulo, 'Trámite');
  v_solicitante := COALESCE(NULLIF(v_solicitante, ''), 'Cliente');

  SELECT vence_at, revocado_at INTO v_vence, v_revocado
    FROM public.accesos_externos WHERE token = v_deriv.acceso_externo_token;
  IF v_deriv.acceso_externo_token IS NULL OR v_vence IS NULL OR v_vence <= now() OR v_revocado IS NOT NULL THEN
    -- Token muerto/inexistente → regenerar con la política nueva (20 días).
    v_token := public.generar_acceso_externo('solicitud', v_deriv.solicitud_id,
                 v_deriv.destinatario_email, v_deriv.destinatario_nombre, 20, 'Reaviso: info nueva');
    v_url := 'https://www.gestionglobal.ar/externo/' || v_token;
    UPDATE public.solicitud_derivaciones
       SET acceso_externo_token = v_token, acceso_externo_url = v_url WHERE id = v_deriv.id;
    v_vence_nuevo := now() + interval '20 days';
  ELSE
    -- DGG-138: token vivo → este envío RENUEVA la vigencia (antes se reusaba
    -- sin extender y el link moría a los 14 días de la generación original).
    v_token := v_deriv.acceso_externo_token;
    v_url := COALESCE(v_deriv.acceso_externo_url, 'https://www.gestionglobal.ar/externo/' || v_token);
    UPDATE public.accesos_externos
       SET vence_at = GREATEST(vence_at, now() + interval '20 days')
     WHERE token = v_token
    RETURNING vence_at INTO v_vence_nuevo;
  END IF;

  v_mensaje := COALESCE(NULLIF(btrim(p_mensaje), ''),
    'El cliente completó la documentación que faltaba. Ya podés retomar el trámite con la información actualizada.');
  IF v_adj_count > 0 THEN
    v_mensaje := v_mensaje || E'\n\nTe adjuntamos ' || v_adj_count || ' archivo'
      || CASE WHEN v_adj_count = 1 THEN '' ELSE 's' END || ' en este email.';
  END IF;

  INSERT INTO public.email_queue (
    to_email, to_nombre, subject, kind, template_slug, variables,
    attachments_jsonb, prioridad, programado_para, related_table, related_id
  ) VALUES (
    v_deriv.destinatario_email, v_deriv.destinatario_nombre,
    v_solicitante || ': ' || v_servicio,
    'workflow', 'gestoria-info-nueva-disponible',
    jsonb_build_object('nombre', coalesce(v_deriv.destinatario_nombre, 'gestoría'),
      'tramite_codigo', v_tramite.codigo, 'tramite_titulo', v_tramite.titulo,
      'solicitante_nombre', v_solicitante, 'servicio', v_servicio,
      'mensaje', v_mensaje, 'acceso_url', v_url,
      'adjuntos_count', v_adj_count::text),
    v_adjuntos, 2, now(), 'tramites', p_tramite_id
  );

  IF v_adj_count > 0 THEN
    SELECT COALESCE(jsonb_agg(e), '[]'::jsonb) INTO v_adj_nuevos
      FROM jsonb_array_elements(v_adjuntos) e
     WHERE NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements(COALESCE(v_deriv.adjuntos_jsonb, '[]'::jsonb)) x
        WHERE x->>'path' = e->>'path');
    IF jsonb_array_length(v_adj_nuevos) > 0 THEN
      UPDATE public.solicitud_derivaciones
         SET adjuntos_jsonb = COALESCE(adjuntos_jsonb, '[]'::jsonb) || v_adj_nuevos
       WHERE id = v_deriv.id;
    END IF;
  END IF;

  INSERT INTO public.tracking_lineas (
    tramite_id, categoria, descripcion, archivos_urls, autor_id, visible_cliente, created_at
  ) VALUES (
    p_tramite_id, 'tramite_enviado',
    'Reaviso a la gestoría (' || v_deriv.destinatario_email || '): hay información nueva para retomar el trámite.'
      || CASE WHEN coalesce(btrim(p_mensaje), '') <> '' THEN ' · ' || btrim(p_mensaje) ELSE '' END
      || CASE WHEN v_adj_count > 0
              THEN ' · ' || v_adj_count || ' archivo' || CASE WHEN v_adj_count = 1 THEN '' ELSE 's' END || ' adjunto' || CASE WHEN v_adj_count = 1 THEN '' ELSE 's' END || ' en el email'
              ELSE '' END,
    '{}'::text[], v_user, false, now()
  );

  RETURN jsonb_build_object('ok', true, 'email', v_deriv.destinatario_email,
    'adjuntos', v_adj_count,
    'token_regenerado', (v_token <> COALESCE(v_deriv.acceso_externo_token,'')),
    'vence_at', v_vence_nuevo);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 4 · solicitud_derivar / _v2 / _v3: defaults 14/14/7 → 20 SIN tocar el cuerpo.
--     Se recrea cada función desde su definición VIGENTE en la BD reemplazando
--     sólo los literales de default (cero drift de transcripción). El assert
--     corta la migración si el patrón esperado no está (def cambió por otra mig).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_def text;
  r record;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname,
           CASE p.proname
             WHEN 'solicitud_derivar_v3' THEN 'p_dias_validez integer DEFAULT 7'
             ELSE 'p_dias_validez integer DEFAULT 14'
           END AS patron_default
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('solicitud_derivar','solicitud_derivar_v2','solicitud_derivar_v3')
  LOOP
    v_def := pg_get_functiondef(r.oid);
    IF position(r.patron_default IN v_def) = 0 THEN
      RAISE EXCEPTION 'DGG-138: % no contiene el patrón esperado "%": revisar manualmente', r.proname, r.patron_default;
    END IF;
    v_def := replace(v_def, r.patron_default, 'p_dias_validez integer DEFAULT 20');
    v_def := replace(v_def, 'COALESCE(p_dias_validez, 14)', 'COALESCE(p_dias_validez, 20)');
    EXECUTE v_def;
    RAISE NOTICE 'DGG-138: % → default 20 días', r.proname;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 5 · Smoke R16: cero overloads tras las recreaciones.
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM (
    SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('generar_acceso_externo','acceso_externo_registrar_visita',
                        'derivacion_reavisar_gestoria','solicitud_derivar',
                        'solicitud_derivar_v2','solicitud_derivar_v3')
    GROUP BY p.proname HAVING count(*) > 1
  ) t;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'DGG-138: % funciones con overloads ambiguos (R16)', v_n;
  END IF;
END $$;
