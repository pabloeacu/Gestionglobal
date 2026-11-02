-- ============================================================================
-- Mig 0153 · FIX-V2 · Vencimientos = management de alertas
--
-- Decisión del usuario: la renovación de un vencimiento SIEMPRE viene del
-- cliente (con el form correspondiente), no de un click del gerente. La
-- sección Vencimientos sirve para gestionar las alertas:
--   - Pausar/reanudar las notificaciones manualmente.
--   - Marcar "trámite en curso" cuando el cliente ya inició el camino por
--     otro lado → suspende las alertas hasta que se concluya el nuevo
--     trámite, que generará la próxima alarma.
--
-- Cambios:
--   1. Agregar columnas `pausado_at`, `pausado_por`, `motivo_pausa` en
--      vencimientos.
--   2. Cambiar default de `alarmas_offsets` a `{30,20,10,5,0}` (decisión
--      del usuario: 30/20/10/5/día). Vencimientos existentes mantienen
--      su array.
--   3. Modificar `gg_vencimientos_planificar_alertas` para EXCLUIR
--      vencimientos pausados (no dispara ni push ni email durante pausa).
--   4. RPC `vencimiento_pausar(p_id, p_motivo)` y `vencimiento_reanudar(p_id)`
--      (staff only · tenancy guard por administración del vencimiento).
--   5. RPC `vencimiento_eliminar(p_id)` para borrar definitivamente
--      (estado='eliminado' soft delete; ya no se proyecta en agenda).
-- ============================================================================

-- 1. Columnas nuevas
ALTER TABLE public.vencimientos
  ADD COLUMN IF NOT EXISTS pausado_at timestamptz,
  ADD COLUMN IF NOT EXISTS pausado_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS motivo_pausa text;

CREATE INDEX IF NOT EXISTS idx_venc_pausado
  ON public.vencimientos (pausado_at)
  WHERE pausado_at IS NOT NULL;

-- 2. Nuevo default de alarmas_offsets
ALTER TABLE public.vencimientos
  ALTER COLUMN alarmas_offsets SET DEFAULT '{30,20,10,5,0}'::integer[];

-- 3. Excluir pausados del dispatch
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
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  SELECT
    v.id,
    o::int AS offset_dias,
    v.fecha_vencimiento,
    v.administracion_id,
    v.consorcio_id,
    v.notificar_cliente,
    v.tipo,
    v.descripcion
  FROM public.vencimientos v
  CROSS JOIN LATERAL unnest(v.alarmas_offsets) AS o
  WHERE v.estado IN ('vigente','vencido')
    AND v.pausado_at IS NULL  -- 0153: excluir pausados
    AND p_fecha = (v.fecha_vencimiento - o * INTERVAL '1 day')::date;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.gg_vencimientos_planificar_alertas(date)
  FROM PUBLIC, anon, authenticated;

-- 4. Pausar / reanudar
CREATE OR REPLACE FUNCTION public.vencimiento_pausar(
  p_id uuid,
  p_motivo text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin uuid;
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Sólo staff' USING ERRCODE = '42501';
  END IF;
  SELECT administracion_id INTO v_admin FROM public.vencimientos WHERE id = p_id;
  IF v_admin IS NULL THEN
    RAISE EXCEPTION 'Vencimiento no encontrado' USING ERRCODE = 'no_data_found';
  END IF;
  -- Tenancy guard (regla 12 adaptada).
  PERFORM private.assert_administracion_access(v_admin);

  UPDATE public.vencimientos
  SET pausado_at = now(),
      pausado_por = auth.uid(),
      motivo_pausa = NULLIF(trim(coalesce(p_motivo, '')), '')
  WHERE id = p_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.vencimiento_pausar(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vencimiento_pausar(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.vencimiento_reanudar(p_id uuid) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin uuid;
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Sólo staff' USING ERRCODE = '42501';
  END IF;
  SELECT administracion_id INTO v_admin FROM public.vencimientos WHERE id = p_id;
  IF v_admin IS NULL THEN
    RAISE EXCEPTION 'Vencimiento no encontrado' USING ERRCODE = 'no_data_found';
  END IF;
  PERFORM private.assert_administracion_access(v_admin);

  UPDATE public.vencimientos
  SET pausado_at = NULL,
      pausado_por = NULL,
      motivo_pausa = NULL
  WHERE id = p_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.vencimiento_reanudar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vencimiento_reanudar(uuid) TO authenticated;

-- 5. Eliminar (soft delete usando 'cancelado' que ya estaba en el CHECK)
-- No agregamos un estado nuevo para no romper UIs existentes; reutilizamos
-- 'cancelado' que ya excluía de vw_agenda_unificada y RPCs.
CREATE OR REPLACE FUNCTION public.vencimiento_eliminar(p_id uuid) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin uuid;
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Sólo staff' USING ERRCODE = '42501';
  END IF;
  SELECT administracion_id INTO v_admin FROM public.vencimientos WHERE id = p_id;
  IF v_admin IS NULL THEN
    RAISE EXCEPTION 'Vencimiento no encontrado' USING ERRCODE = 'no_data_found';
  END IF;
  PERFORM private.assert_administracion_access(v_admin);

  UPDATE public.vencimientos
  SET estado = 'cancelado'
  WHERE id = p_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.vencimiento_eliminar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vencimiento_eliminar(uuid) TO authenticated;

-- 6. Exponer pausado_at en proximos_vencimientos para UI.
DROP FUNCTION IF EXISTS public.proximos_vencimientos(uuid, smallint);
CREATE OR REPLACE FUNCTION public.proximos_vencimientos(
  p_administracion_id uuid DEFAULT NULL,
  p_dias smallint DEFAULT 90
)
RETURNS TABLE (
  id uuid,
  tipo text,
  sujeto text,
  sujeto_id uuid,
  administracion_id uuid,
  administracion_nombre text,
  consorcio_id uuid,
  consorcio_nombre text,
  fecha_vencimiento date,
  fecha_emision date,
  dias_restantes int,
  descripcion text,
  observaciones text,
  estado text,
  sugerencia_servicio_slug text,
  alerta_30d_enviada timestamptz,
  alerta_20d_enviada timestamptz,
  alerta_10d_enviada timestamptz,
  tracking_id uuid,
  pausado_at timestamptz,
  motivo_pausa text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin_filter uuid := p_administracion_id;
BEGIN
  IF NOT private.is_staff() THEN
    v_admin_filter := private.current_administracion_id();
    IF v_admin_filter IS NULL THEN
      RAISE EXCEPTION 'Sin administración asociada' USING ERRCODE = '42501';
    END IF;
  ELSIF p_administracion_id IS NOT NULL THEN
    PERFORM private.assert_administracion_access(p_administracion_id);
  END IF;

  RETURN QUERY
  SELECT
    v.id, v.tipo, v.sujeto, v.sujeto_id,
    v.administracion_id, a.nombre AS administracion_nombre,
    v.consorcio_id, c.nombre AS consorcio_nombre,
    v.fecha_vencimiento, v.fecha_emision,
    (v.fecha_vencimiento - CURRENT_DATE)::int AS dias_restantes,
    v.descripcion, v.observaciones, v.estado,
    COALESCE(cfg_override.sugerencia_servicio_slug, cfg_global.sugerencia_servicio_slug),
    v.alerta_30d_enviada, v.alerta_20d_enviada, v.alerta_10d_enviada,
    v.tracking_id,
    v.pausado_at, v.motivo_pausa
  FROM public.vencimientos v
  JOIN public.administraciones a ON a.id = v.administracion_id
  LEFT JOIN public.consorcios c ON c.id = v.consorcio_id
  LEFT JOIN public.vencimientos_config cfg_override
    ON cfg_override.administracion_id = v.administracion_id
   AND cfg_override.tipo = v.tipo
  LEFT JOIN public.vencimientos_config cfg_global
    ON cfg_global.administracion_id IS NULL
   AND cfg_global.tipo = v.tipo
  WHERE v.estado IN ('vigente','vencido')
    AND v.fecha_vencimiento <= CURRENT_DATE + p_dias
    AND (v_admin_filter IS NULL OR v.administracion_id = v_admin_filter)
  ORDER BY v.fecha_vencimiento ASC, v.id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.proximos_vencimientos(uuid, smallint)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.proximos_vencimientos(uuid, smallint)
  TO authenticated;