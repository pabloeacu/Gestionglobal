-- DGG-163 · B: la cola de moderación (host standalone ModeracionPage) necesita
-- la CATEGORÍA REAL del trámite para elegir los motivos de cierre correctos
-- ("Matrícula otorgada" vs "Renovación otorgada") al concatenar el cierre del
-- gerente. Hasta ahora se adivinaba desde `servicio_codigo` en el front
-- (rpac_renovacion → renovación, resto → matrícula): frágil para renovaciones
-- creadas sin código rpac_*. El detalle no tenía el problema (usa data.categoria),
-- pero la cola sí. Devolvemos `tramite_categoria` para eliminar la adivinanza.
--
-- R16: cambia el TABLE de retorno (agrega columna) → DROP + CREATE, no
-- CREATE OR REPLACE (Postgres rechaza el cambio de return type). Re-GRANT
-- explícito tras el DROP (R6): PostgREST la invoca como `authenticated`.
-- SELECT-only STABLE SECURITY DEFINER con gate private.is_staff() intacto.

DROP FUNCTION IF EXISTS public.tracking_moderacion_pendientes();

CREATE FUNCTION public.tracking_moderacion_pendientes()
RETURNS TABLE(
  linea_id uuid,
  tramite_id uuid,
  tramite_codigo text,
  tramite_categoria text,
  servicio_nombre text,
  cliente_nombre text,
  gestor_label text,
  descripcion text,
  archivos_urls text[],
  created_at timestamptz,
  administracion_id uuid,
  servicio_vigencia_meses integer,
  servicio_codigo text,
  otorgamiento jsonb,
  ficha_matricula_rpac text,
  ficha_legajo_rpac text,
  ficha_matricula_rpac_fecha date,
  ficha_matricula_rpac_vencimiento date
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT tl.id, t.id, t.codigo, t.categoria::text,
         COALESCE(s.nombre, t.titulo, 'Trámite'),
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
$function$;

-- Endurecimiento (patrón de migs 0215/0441/0448): sólo staff autenticado la
-- invoca vía PostgREST; el gate is_staff() ya devuelve 0 filas a anon, pero
-- revocamos EXECUTE de PUBLIC/anon para no reabrir la superficie tras el DROP.
REVOKE EXECUTE ON FUNCTION public.tracking_moderacion_pendientes() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tracking_moderacion_pendientes() TO authenticated, service_role;
