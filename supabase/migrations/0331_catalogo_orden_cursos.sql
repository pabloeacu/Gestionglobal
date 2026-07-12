-- 0331 · N2 del doc JL (2026-07-12): "¿se pueden ordenar para que aparezca
-- último el Curso de RAP (RPA · CABA)?"
--
-- Causa: `cliente_catalogo_formularios` ordenaba por categoría y luego por
-- TÍTULO alfabético ("...RPA (CABA)" < "...RPAC (Pcia..." ) e ignoraba la
-- columna `formularios.orden` que existe justo para esto.
--
-- Fix: (a) la RPC ordena por categoría → orden → título (misma firma →
-- CREATE OR REPLACE sin overload, R16); (b) seteamos `orden` en los 3
-- formularios de curso: RPAC (PBA) 10 · Capacitación Inicial (PBA) 20 ·
-- RPA (CABA) 30 (último, como pidió JL). El resto de los formularios queda
-- con su orden actual (el orden sólo desempata dentro de cada categoría).

CREATE OR REPLACE FUNCTION public.cliente_catalogo_formularios()
 RETURNS TABLE(formulario_id uuid, slug text, titulo text, descripcion text, categoria text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT id, slug, titulo, descripcion, categoria
  FROM public.formularios
  WHERE activo = true
    AND publico = true
    AND (cierre_at IS NULL OR cierre_at > now())
  ORDER BY
    CASE categoria
      WHEN 'tramite'  THEN 1
      WHEN 'servicio' THEN 2
      WHEN 'consulta' THEN 3
      WHEN 'curso'    THEN 4
      WHEN 'evento'   THEN 5
      ELSE 6
    END,
    orden,
    titulo;
$function$;

UPDATE public.formularios SET orden = 10 WHERE slug = 'curso-actualizacion';
UPDATE public.formularios SET orden = 20 WHERE slug = 'curso-formacion';
UPDATE public.formularios SET orden = 30 WHERE slug = 'curso-actualizacion-caba';
