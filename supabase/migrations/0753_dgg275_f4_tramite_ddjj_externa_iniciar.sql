-- 0753 · DGG-275 F4 · RPC "Iniciar presentación de DDJJ externa"
-- ----------------------------------------------------------------------------
-- Wizard autónomo de gerencia (plan DDJJ §5 / F4): identifica un cliente
-- existente o da de alta uno nuevo (ficha), y abre un trámite DDJJ (categoria
-- 'dj', servicio rpac_ddjj) SIN comprobante — la emisión se difiere al wizard
-- de cierre F3 (tramite_emitir_comprobantes_ddjj). No crea el usuario de auth:
-- eso lo hace el edge alta-cliente-portal (idempotente), que el front invoca
-- después con el administracion_id devuelto acá.
--
-- Reusa private.administracion_resolver_o_crear (mig 0752) → misma identidad
-- DGG-123 que solicitud_activar. R5 (multi-tabla → RPC SECURITY DEFINER +
-- search_path). Staff-only (is_staff): NO alcanzable por rol 'administrador',
-- por eso no aplica assert_administracion_access (R12, igual que solicitud_activar).
-- R16: función nueva, firma única → sin overload. R6: GRANT EXECUTE explícito.

CREATE OR REPLACE FUNCTION public.tramite_ddjj_externa_iniciar(
  p_cliente_id uuid DEFAULT NULL::uuid,
  p_crear_cliente_input jsonb DEFAULT NULL::jsonb,
  p_periodo text DEFAULT NULL::text,
  p_fecha_inicio date DEFAULT NULL::date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_cliente uuid; v_es_nuevo boolean; v_email_admin text; v_admin_nombre text;
  v_servicio_id uuid; v_servicio_nombre text;
  v_tramite_id uuid; v_parent_tramite uuid; v_titulo text;
BEGIN
  IF NOT private.is_staff() THEN RAISE EXCEPTION 'Solo staff' USING ERRCODE = '42501'; END IF;

  IF p_cliente_id IS NULL AND p_crear_cliente_input IS NULL THEN
    RAISE EXCEPTION 'Indicá un cliente existente o los datos para crear uno nuevo.' USING ERRCODE = '22023';
  END IF;

  -- Servicio DDJJ (fuente del precio del tabulador y del gate rpac_ddjj).
  SELECT id, nombre INTO v_servicio_id, v_servicio_nombre
    FROM public.servicios WHERE codigo = 'rpac_ddjj' AND activo
    ORDER BY created_at LIMIT 1;
  IF v_servicio_id IS NULL THEN
    RAISE EXCEPTION 'No existe el servicio rpac_ddjj (DDJJ anuales).' USING ERRCODE = 'P0002';
  END IF;

  -- Resolver / crear el cliente (dup-check DGG-123 fuente única, mig 0752).
  SELECT o_administracion_id, o_creado, o_email, o_nombre
    INTO v_cliente, v_es_nuevo, v_email_admin, v_admin_nombre
    FROM private.administracion_resolver_o_crear(
      p_cliente_id, p_crear_cliente_input,
      NULL, NULL, NULL,
      'AUTO-DDJJ-' || substring(gen_random_uuid()::text,1,8));

  IF v_cliente IS NULL THEN
    RAISE EXCEPTION 'No se pudo resolver el cliente.' USING ERRCODE = 'P0002';
  END IF;

  -- Continuidad: enganchar al último trámite 'dj' del cliente, si existe.
  SELECT t.id INTO v_parent_tramite FROM public.tramites t
   WHERE t.administracion_id = v_cliente AND t.categoria = 'dj'
   ORDER BY t.created_at DESC LIMIT 1;

  v_titulo := COALESCE(v_servicio_nombre, 'Declaraciones juradas anuales')
    || ' · ' || COALESCE(NULLIF(btrim(v_admin_nombre),''), 'cliente');

  INSERT INTO public.tramites (
    titulo, descripcion, categoria, prioridad, estado, administracion_id,
    solicitante_nombre, solicitante_email, servicio_id, periodo, fecha_inicio,
    parent_tracking_id, created_by
  ) VALUES (
    v_titulo,
    'Presentación de DDJJ externa iniciada por gerencia'
      || COALESCE(' · período ' || p_periodo, '')
      || COALESCE(' · inicio ' || p_fecha_inicio::text, '')
      || COALESCE(' · continuación de ' || v_parent_tramite::text, ''),
    'dj', 'normal', 'abierto', v_cliente,
    v_admin_nombre, NULLIF(btrim(v_email_admin),''),
    v_servicio_id, p_periodo, COALESCE(p_fecha_inicio, current_date),
    v_parent_tramite, auth.uid()
  ) RETURNING id INTO v_tramite_id;

  -- Línea semilla INTERNA (la comunicación al cliente es un paso aparte: F5/F6).
  BEGIN
    PERFORM public.tracking_agregar_linea(
      v_tramite_id, 'seguimiento_interno',
      'Presentación de DDJJ externa iniciada por gerencia.'
        || COALESCE(' · Período ' || p_periodo, '')
        || CASE WHEN v_es_nuevo THEN ' · Cliente dado de alta en este acto.' ELSE '' END,
      NULL, '{}'::text[], NULL, false);
  EXCEPTION WHEN OTHERS THEN RAISE WARNING 'seed tracking_linea DDJJ externa falló: %', SQLERRM; END;

  RETURN jsonb_build_object(
    'tramite_id', v_tramite_id,
    'administracion_id', v_cliente,
    'cliente_creado', v_es_nuevo,
    'servicio_id', v_servicio_id,
    'email_cliente', NULLIF(btrim(v_email_admin),''),
    'nombre_cliente', v_admin_nombre
  );
END;
$$;

COMMENT ON FUNCTION public.tramite_ddjj_externa_iniciar(uuid, jsonb, text, date)
  IS 'DGG-275 F4 · Abre un trámite DDJJ (categoria dj, servicio rpac_ddjj) resolviendo/creando el cliente vía private.administracion_resolver_o_crear (dup-check DGG-123). Sin comprobante (emisión diferida al cierre F3). Staff-only. Devuelve {tramite_id, administracion_id, cliente_creado, servicio_id, email_cliente, nombre_cliente}.';

GRANT EXECUTE ON FUNCTION public.tramite_ddjj_externa_iniciar(uuid, jsonb, text, date) TO authenticated;
