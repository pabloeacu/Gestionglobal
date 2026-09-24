-- 0513 · Fix E-GG-214 recurrente en `gg_admin_es_rpac` (cazado por el live-test de DGG-200).
--
-- BUG: el helper contaba trámites RPAC sólo con `estado='cerrado'`, pero el estado TERMINAL de
-- `tramites` es `resuelto` (E-GG-214). Un admin con inscripción RPAC RESUELTA (matrícula otorgada)
-- daba `es_rpac=false` → el motor le ofrecía MATRICULACIÓN pese a estar matriculado (viola C3).
-- Detectado en vivo: Catelli Federico (inscripción resuelta, matrícula otorgada) mostraba
-- "Matriculación · Le corresponde" en el panorama. 4 admins afectados.
--
-- FIX: contar cualquier trámite RPAC NO cancelado con cierre no-insatisfactorio (mismo criterio
-- robusto que el hermano `gg_admin_es_solo_caba`: `<> 'cancelado'`, inmune a resuelto/cerrado).
-- Así: en-progreso o resuelto-satisfactorio → es_rpac=true (no se ofrece matriculación);
-- resuelto-INSATISFACTORIO (falló) → no cuenta → matriculación se ofrece (reintento). Correcto.
--
-- Único caller: el motor de ofrecimientos (real DORMIDO + sombra). Ningún otro flujo lo usa.

CREATE OR REPLACE FUNCTION private.gg_admin_es_rpac(p_admin uuid)
 RETURNS boolean LANGUAGE sql STABLE SET search_path TO 'public','pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.administraciones a
    WHERE a.id = p_admin
      AND (a.matricula_rpac IS NOT NULL OR a.matricula_rpac_vencimiento IS NOT NULL)
  ) OR EXISTS (
    SELECT 1 FROM public.tramites t
    JOIN public.servicios s ON s.id = t.servicio_id
    WHERE t.administracion_id = p_admin
      AND t.estado <> 'cancelado'
      AND t.cierre_satisfactorio IS NOT FALSE
      AND s.codigo IN ('rpac_inscripcion','rpac_inscripcion_juridica','rpac_renovacion')
  );
$function$;

-- Mantener el least-privilege de 0512 (CREATE OR REPLACE preserva grants, pero por las dudas).
REVOKE EXECUTE ON FUNCTION private.gg_admin_es_rpac(uuid) FROM PUBLIC;