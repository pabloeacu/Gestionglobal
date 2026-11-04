-- 0649 · DGG-243 · F3 — cliente_tramites_listar expone servicio_codigo (coherencia del gate DDJJ).
--
-- Hallazgo §6 F3 (C#1, menor): la sección DDJJ del portal detecta "solicitud en curso" por
-- categoria='dj', pero el gate server-side de DDJJ es `servicio_codigo='rpac_ddjj' OR categoria='dj'`
-- (botón F2a, RPC proponer 0646/0647). Como cliente_tramites_listar no exponía el código de servicio,
-- un trámite DDJJ cargado a mano con servicio rpac_ddjj pero categoría distinta de 'dj' (y sin
-- propuesta de credencial aún) hacía que el cliente viera el CTA comercial pese a tener gestión en curso.
--
-- Fix: agregar servicio_codigo al RETURNS (LEFT JOIN servicios). RETURNS TABLE cambia → DROP + CREATE
-- (no CREATE OR REPLACE). 100% aditivo para los consumidores (mapean campos puntuales; ignoran la
-- columna nueva). Grants preservados (authenticated + service_role). Cero overload (misma firma de
-- parámetros; es la única definición — R16).

DROP FUNCTION IF EXISTS public.cliente_tramites_listar(boolean);

CREATE FUNCTION public.cliente_tramites_listar(p_solo_abiertos boolean DEFAULT false)
RETURNS TABLE(
  id uuid, codigo text, titulo text, categoria text, prioridad text, estado text,
  vence_at timestamptz, ultima_actividad_at timestamptz, horas_desde_actividad numeric,
  total_comentarios integer, total_adjuntos integer, consorcio_id uuid, servicio_id uuid,
  servicio_codigo text, created_at timestamptz
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT
    t.id, t.codigo, t.titulo, t.categoria, t.prioridad, t.estado,
    t.vence_at, t.ultima_actividad_at,
    EXTRACT(EPOCH FROM (now() - t.ultima_actividad_at)) / 3600 AS horas_desde_actividad,
    t.total_comentarios, t.total_adjuntos,
    t.consorcio_id, t.servicio_id, s.codigo AS servicio_codigo, t.created_at
  FROM public.tramites t
  LEFT JOIN public.servicios s ON s.id = t.servicio_id
  WHERE t.administracion_id = private.current_administracion_id()
    AND (NOT p_solo_abiertos OR t.estado IN ('abierto','en_progreso','esperando_cliente'))
  ORDER BY
    CASE t.estado
      WHEN 'esperando_cliente' THEN 1
      WHEN 'en_progreso'       THEN 2
      WHEN 'abierto'           THEN 3
      ELSE 4
    END,
    t.ultima_actividad_at DESC;
$function$;
REVOKE ALL ON FUNCTION public.cliente_tramites_listar(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cliente_tramites_listar(boolean) TO authenticated, service_role;
