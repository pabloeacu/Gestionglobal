-- ============================================================================
-- 0040_agenda_unificada · Agenda como hub temporal único + alarmas
-- configurables por vencimiento + integración tracking↔vencimientos.
--
-- Cambios:
--  1. ALTER public.vencimientos:
--     - alarmas_offsets integer[] (días antes; reemplaza conceptualmente a
--       dias_alerta_1/2/3 que vivían en config — siguen como defaults globales).
--     - notificar_cliente boolean (default true).
--     - tracking_id uuid → tramites(id) ON DELETE SET NULL.
--       (Adaptación: spec original mencionaba tracking_lineas(id), pero un
--       "tracking" en este codebase ES un row de `tramites`, no una línea.
--       Link bidireccional: ese vencimiento fue creado por el cierre de ese
--       tracking.)
--  2. ALTER public.tramites:
--     - cycle_closed_at timestamptz (marca el cierre del ciclo del tracking).
--  3. VIEW public.vw_agenda_unificada — UNION de 5 fuentes.
--  4. RPC public.gg_agenda_listar_unificada(from, to, fuentes[]).
--  5. RPC public.tracking_cerrar_ciclo(tracking_id, proxima_fecha,
--     alarmas_offsets[], notificar_cliente bool).
--  6. Extensión del motor de dispatch_vencimientos: cron diario que respeta
--     alarmas_offsets per-vencimiento; idempotente vía dispatch_vencimientos_log.
--     (El dispatch real sigue corriéndose por la edge function existente; acá
--     dejamos la RPC `gg_vencimientos_planificar_alertas` que devuelve los
--     matches del día — la edge function puede invocarla.)
--
-- Notas:
--  - Spec usaba 'completado','cancelado' como estados a excluir de tramites,
--    pero el CHECK real es ('abierto','en_progreso','esperando_cliente',
--    'resuelto','cerrado','cancelado'). Excluimos 'cerrado' + 'cancelado'.
--  - 'tramites' no tiene fecha_objetivo: usamos vence_at (SLA timestamptz).
--  - 'solicitudes' no tiene fecha_objetivo: usamos created_at como start_at.
--  - 'comprobantes' usa columna `vencimiento` (no fecha_vencimiento) y
--    `estado_cobranza` (no estado) para el flag de pagado.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. ALTER vencimientos
-- ---------------------------------------------------------------------------
ALTER TABLE public.vencimientos
  ADD COLUMN IF NOT EXISTS alarmas_offsets integer[] NOT NULL DEFAULT '{30,7,2}',
  ADD COLUMN IF NOT EXISTS notificar_cliente boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS tracking_id uuid REFERENCES public.tramites(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_venc_tracking
  ON public.vencimientos(tracking_id)
  WHERE tracking_id IS NOT NULL;

-- Backfill (idempotente; los defaults ya lo cubren para filas nuevas, pero
-- garantizamos consistencia si por alguna razón quedaron NULL en filas
-- existentes que pre-existieran a este ALTER).
UPDATE public.vencimientos
   SET alarmas_offsets = '{30,7,2}'
 WHERE alarmas_offsets IS NULL;

-- ---------------------------------------------------------------------------
-- 2. ALTER tramites (cierre de ciclo)
-- ---------------------------------------------------------------------------
ALTER TABLE public.tramites
  ADD COLUMN IF NOT EXISTS cycle_closed_at timestamptz;

-- ---------------------------------------------------------------------------
-- 3. VIEW public.vw_agenda_unificada
--    Fuentes: personal, vencimiento, tramite, comprobante, solicitud.
--    Columnas comunes:
--      fuente, origen_id, owner_id, title, start_at, end_at, all_day,
--      category_hint, color, estado, editable, linked_admin_id, linked_consorcio_id.
-- ---------------------------------------------------------------------------
DROP VIEW IF EXISTS public.vw_agenda_unificada CASCADE;
CREATE VIEW public.vw_agenda_unificada AS
  -- a) Personal (agenda_events del owner)
  SELECT
    'personal'::text                                AS fuente,
    e.id                                            AS origen_id,
    e.owner_id                                      AS owner_id,
    e.title                                         AS title,
    e.start_at                                      AS start_at,
    e.end_at                                        AS end_at,
    e.all_day                                       AS all_day,
    'personal'::text                                AS category_hint,
    COALESCE(e.color_override, c.color, '#06b6d4')  AS color,
    CASE WHEN e.is_done THEN 'hecho' ELSE 'pendiente' END AS estado,
    true                                            AS editable,
    e.linked_administracion_id                      AS linked_admin_id,
    NULL::uuid                                      AS linked_consorcio_id
  FROM public.agenda_events e
  LEFT JOIN public.agenda_categories c ON c.id = e.category_id

  UNION ALL

  -- b) Vencimientos (vigentes o vencidos)
  SELECT
    'vencimiento'::text                             AS fuente,
    v.id                                            AS origen_id,
    NULL::uuid                                      AS owner_id,
    'Vencimiento: '
      || CASE v.tipo
           WHEN 'matricula_rpac'         THEN 'Matrícula RPAC'
           WHEN 'ddjj_anual'             THEN 'DDJJ Anual'
           WHEN 'certificado_arca'       THEN 'Certificado ARCA'
           WHEN 'seguro_consorcio'       THEN 'Seguro del consorcio'
           WHEN 'habilitacion_municipal' THEN 'Habilitación municipal'
           WHEN 'libro_actas'            THEN 'Libro de actas'
           WHEN 'libro_administracion'   THEN 'Libro de administración'
           WHEN 'revision_ascensor'      THEN 'Revisión de ascensor'
           ELSE 'Otro'
         END                                        AS title,
    (v.fecha_vencimiento::timestamptz + interval '9 hours') AS start_at,
    (v.fecha_vencimiento::timestamptz + interval '10 hours') AS end_at,
    true                                            AS all_day,
    'vencimiento'::text                             AS category_hint,
    '#f59e0b'::text                                 AS color,
    v.estado                                        AS estado,
    false                                           AS editable,
    v.administracion_id                             AS linked_admin_id,
    v.consorcio_id                                  AS linked_consorcio_id
  FROM public.vencimientos v
  WHERE v.estado IN ('vigente','vencido')

  UNION ALL

  -- c) Trámites con SLA (vence_at) que no estén cerrados/cancelados
  SELECT
    'tramite'::text                                 AS fuente,
    t.id                                            AS origen_id,
    NULL::uuid                                      AS owner_id,
    t.titulo                                        AS title,
    t.vence_at                                      AS start_at,
    t.vence_at + interval '30 minutes'              AS end_at,
    false                                           AS all_day,
    'tramite'::text                                 AS category_hint,
    '#8b5cf6'::text                                 AS color,
    t.estado                                        AS estado,
    false                                           AS editable,
    t.administracion_id                             AS linked_admin_id,
    t.consorcio_id                                  AS linked_consorcio_id
  FROM public.tramites t
  WHERE t.vence_at IS NOT NULL
    AND t.estado NOT IN ('cerrado','cancelado')

  UNION ALL

  -- d) Comprobantes con vencimiento (estado_cobranza != pagado)
  SELECT
    'comprobante'::text                             AS fuente,
    cp.id                                           AS origen_id,
    NULL::uuid                                      AS owner_id,
    'Cobranza: ' || cp.tipo
      || ' '
      || lpad(cp.punto_venta::text, 5, '0')
      || '-'
      || COALESCE(lpad(cp.numero::text, 8, '0'), '—')   AS title,
    (cp.vencimiento::timestamptz + interval '9 hours') AS start_at,
    (cp.vencimiento::timestamptz + interval '10 hours') AS end_at,
    true                                            AS all_day,
    'comprobante'::text                             AS category_hint,
    '#ef4444'::text                                 AS color,
    cp.estado_cobranza                              AS estado,
    false                                           AS editable,
    cp.administracion_id                            AS linked_admin_id,
    cp.consorcio_id                                 AS linked_consorcio_id
  FROM public.comprobantes cp
  WHERE cp.vencimiento IS NOT NULL
    AND cp.estado_cobranza <> 'pagado'

  UNION ALL

  -- e) Solicitudes activas (estados de bandeja). Usan created_at como ancla
  --    porque no hay fecha_objetivo explícita.
  SELECT
    'solicitud'::text                               AS fuente,
    s.id                                            AS origen_id,
    NULL::uuid                                      AS owner_id,
    COALESCE('Solicitud: ' || NULLIF(s.servicio_slug, ''), 'Solicitud nueva') AS title,
    s.created_at                                    AS start_at,
    s.created_at + interval '30 minutes'            AS end_at,
    false                                           AS all_day,
    'solicitud'::text                               AS category_hint,
    '#06b6d4'::text                                 AS color,
    s.estado                                        AS estado,
    false                                           AS editable,
    s.cliente_id                                    AS linked_admin_id,
    NULL::uuid                                      AS linked_consorcio_id
  FROM public.solicitudes s
  WHERE s.estado NOT IN ('activada','descartada')
;

COMMENT ON VIEW public.vw_agenda_unificada IS
  'Hub temporal: UNION ALL de 5 fuentes con fecha (agenda personal + vencimientos + trámites + comprobantes + solicitudes). Las RLS de cada tabla subyacente aplican via SECURITY INVOKER.';

-- ---------------------------------------------------------------------------
-- 4. RPC: listar unificada (filtra rango + fuentes opcionales)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.gg_agenda_listar_unificada(
  p_from timestamptz,
  p_to   timestamptz,
  p_fuentes text[] DEFAULT NULL
)
RETURNS SETOF public.vw_agenda_unificada
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT *
    FROM public.vw_agenda_unificada
   WHERE start_at >= p_from
     AND start_at <  p_to
     AND (p_fuentes IS NULL OR fuente = ANY(p_fuentes))
   ORDER BY start_at ASC;
$$;
REVOKE EXECUTE ON FUNCTION public.gg_agenda_listar_unificada(timestamptz, timestamptz, text[])
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gg_agenda_listar_unificada(timestamptz, timestamptz, text[])
  TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. RPC: tracking_cerrar_ciclo
--    Crea un nuevo vencimiento ligado al tracking con alarmas_offsets
--    personalizadas; marca el tracking actual como ciclo cerrado.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tracking_cerrar_ciclo(
  p_tracking_id uuid,
  p_proxima_fecha date,
  p_alarmas_offsets integer[],
  p_notificar_cliente boolean DEFAULT true
)
RETURNS TABLE (vencimiento_id uuid, alarmas_planificadas date[])
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tramite record;
  v_new_id  uuid;
  v_sujeto  text;
  v_sujeto_id uuid;
  v_offset int;
  v_alarmas date[] := '{}';
  v_offsets int[];
BEGIN
  -- Defaults sanos
  v_offsets := COALESCE(p_alarmas_offsets, ARRAY[30,7,2]::int[]);

  SELECT t.*
    INTO v_tramite
    FROM public.tramites t
   WHERE t.id = p_tracking_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tracking no encontrado' USING ERRCODE = 'P0002';
  END IF;

  -- Tenancy guard (regla 12). Si el tracking no tiene administracion_id
  -- asociada, solo staff lo puede cerrar.
  IF NOT private.is_staff() THEN
    IF v_tramite.administracion_id IS NULL THEN
      RAISE EXCEPTION 'Acceso denegado' USING ERRCODE = '42501';
    END IF;
    PERFORM private.assert_administracion_access(v_tramite.administracion_id);
  END IF;

  IF p_proxima_fecha IS NULL OR p_proxima_fecha <= CURRENT_DATE THEN
    RAISE EXCEPTION 'La próxima fecha debe ser futura'
      USING ERRCODE = '22023';
  END IF;

  -- Sujeto: si el tracking tiene consorcio_id, lo usamos; si no, la
  -- administración como sujeto del vencimiento (administrador del consorcio).
  IF v_tramite.consorcio_id IS NOT NULL THEN
    v_sujeto := 'consorcio';
    v_sujeto_id := v_tramite.consorcio_id;
  ELSE
    v_sujeto := 'administracion';
    v_sujeto_id := COALESCE(v_tramite.administracion_id, p_tracking_id);
  END IF;

  IF v_tramite.administracion_id IS NULL THEN
    RAISE EXCEPTION 'El tracking no tiene administración asociada'
      USING ERRCODE = '22023';
  END IF;

  -- Marcar ciclo cerrado en el tracking
  UPDATE public.tramites
     SET cycle_closed_at = now(),
         ultima_actividad_at = now()
   WHERE id = p_tracking_id;

  -- Crear el vencimiento
  INSERT INTO public.vencimientos (
    tipo, sujeto, sujeto_id,
    administracion_id, consorcio_id,
    fecha_vencimiento, fecha_emision,
    descripcion,
    estado,
    alarmas_offsets, notificar_cliente,
    tracking_id,
    origen
  ) VALUES (
    'otro', v_sujeto, v_sujeto_id,
    v_tramite.administracion_id, v_tramite.consorcio_id,
    p_proxima_fecha, CURRENT_DATE,
    COALESCE('Próximo vencimiento generado por tracking «' || v_tramite.titulo || '»', 'Próximo vencimiento'),
    'vigente',
    v_offsets, COALESCE(p_notificar_cliente, true),
    p_tracking_id,
    'tracking'
  )
  RETURNING id INTO v_new_id;

  -- Calcular fechas de alarmas (p_proxima_fecha - offset) para feedback al UI.
  FOREACH v_offset IN ARRAY v_offsets LOOP
    v_alarmas := array_append(v_alarmas, (p_proxima_fecha - v_offset)::date);
  END LOOP;

  RETURN QUERY SELECT v_new_id, v_alarmas;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.tracking_cerrar_ciclo(uuid, date, integer[], boolean)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tracking_cerrar_ciclo(uuid, date, integer[], boolean)
  TO authenticated;

-- ---------------------------------------------------------------------------
-- 6. RPC auxiliar: gg_vencimientos_planificar_alertas
--    Devuelve los pares (vencimiento, offset) que matchean HOY según
--    alarmas_offsets per-vencimiento. El edge function dispatch-vencimientos
--    puede consumirla para emitir push + email. Idempotente: cliente filtra
--    contra dispatch_vencimientos_log (lo escribe el edge function).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.gg_vencimientos_planificar_alertas(
  p_fecha date DEFAULT CURRENT_DATE
)
RETURNS TABLE (
  vencimiento_id uuid,
  offset_dias int,
  fecha_vencimiento date,
  administracion_id uuid,
  consorcio_id uuid,
  notificar_cliente boolean,
  tipo text,
  descripcion text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    v.id,
    o::int                          AS offset_dias,
    v.fecha_vencimiento,
    v.administracion_id,
    v.consorcio_id,
    v.notificar_cliente,
    v.tipo,
    v.descripcion
  FROM public.vencimientos v
  CROSS JOIN LATERAL unnest(COALESCE(v.alarmas_offsets, ARRAY[30,7,2]::int[])) AS o
  WHERE v.estado IN ('vigente','vencido')
    AND p_fecha = (v.fecha_vencimiento - o);
$$;
REVOKE EXECUTE ON FUNCTION public.gg_vencimientos_planificar_alertas(date)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gg_vencimientos_planificar_alertas(date)
  TO authenticated;

-- ============================================================================
-- Fin 0040_agenda_unificada
-- ============================================================================
