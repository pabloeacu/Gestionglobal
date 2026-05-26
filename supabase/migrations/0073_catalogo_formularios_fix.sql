-- 0073 · Auditoría QA-E2E · fix EGG-QA-01
-- Bug: servicios.formulario_publico_slug declaraba slugs que NO existían como
-- formularios. Y simétricamente formularios.servicio_id estaba NULL.
-- Resultado: vínculo catálogo ↔ formulario público completamente roto.
-- El trigger crear_tramite_desde_submission_auto() usa formularios.servicio_id
-- para asignar el servicio en la solicitud — si está NULL el wizard de
-- activación recibe solicitudes huérfanas.
--
-- Fix:
--   1. Unifico el naming a slugs con guión simple (el formato que tienen los
--      formularios). Updateo servicios.formulario_publico_slug.
--   2. Setteo formularios.servicio_id apuntando al servicio correcto.
--   3. Agrego trigger de integridad: prohíbe activar un servicio con
--      formulario_publico_slug que no exista.
--   4. Seedeo precios ficticios realistas para tests e2e (todos estaban en 0).

-- =====================================================================
-- 1) Re-normalizar slugs del catálogo para que matcheen los formularios
-- =====================================================================

UPDATE public.servicios SET formulario_publico_slug = 'matriculacion-rpac'   WHERE codigo = 'rpac_inscripcion';
UPDATE public.servicios SET formulario_publico_slug = 'renovacion-rpac'      WHERE codigo = 'rpac_renovacion';
UPDATE public.servicios SET formulario_publico_slug = 'certificado-rpac'     WHERE codigo = 'rpac_certificado';
UPDATE public.servicios SET formulario_publico_slug = 'ddjj-anual'           WHERE codigo = 'rpac_ddjj';
UPDATE public.servicios SET formulario_publico_slug = 'consultoria-juridica' WHERE codigo = 'juridico_consulta';
UPDATE public.servicios SET formulario_publico_slug = 'curso-formacion'      WHERE codigo = 'curso_formacion_rpac';
UPDATE public.servicios SET formulario_publico_slug = 'curso-actualizacion'  WHERE codigo = 'curso_actualizacion_rpac';

-- Servicios sin formulario público propio: NULL (no usaba slug fake)
UPDATE public.servicios SET formulario_publico_slug = NULL WHERE codigo IN ('rpa_actualizacion', 'administracion_global');

-- =====================================================================
-- 2) Setear servicio_id en formularios (la columna autoritativa que usa
--    el trigger crear_tramite_desde_submission_auto)
-- =====================================================================

UPDATE public.formularios f
SET servicio_id = s.id
FROM public.servicios s
WHERE f.slug = 'matriculacion-rpac'   AND s.codigo = 'rpac_inscripcion';

UPDATE public.formularios f
SET servicio_id = s.id
FROM public.servicios s
WHERE f.slug = 'renovacion-rpac'      AND s.codigo = 'rpac_renovacion';

UPDATE public.formularios f
SET servicio_id = s.id
FROM public.servicios s
WHERE f.slug = 'certificado-rpac'     AND s.codigo = 'rpac_certificado';

UPDATE public.formularios f
SET servicio_id = s.id
FROM public.servicios s
WHERE f.slug = 'ddjj-anual'           AND s.codigo = 'rpac_ddjj';

UPDATE public.formularios f
SET servicio_id = s.id
FROM public.servicios s
WHERE f.slug = 'consultoria-juridica' AND s.codigo = 'juridico_consulta';

UPDATE public.formularios f
SET servicio_id = s.id
FROM public.servicios s
WHERE f.slug = 'curso-formacion'      AND s.codigo = 'curso_formacion_rpac';

UPDATE public.formularios f
SET servicio_id = s.id
FROM public.servicios s
WHERE f.slug = 'curso-actualizacion'  AND s.codigo = 'curso_actualizacion_rpac';

-- `webinarios` (categoria='evento') no genera solicitud → no requiere servicio_id

-- =====================================================================
-- 3) Trigger de integridad: prohíbe formulario_publico_slug huérfano
-- =====================================================================

CREATE OR REPLACE FUNCTION private.servicios_check_formulario_slug()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.formulario_publico_slug IS NULL THEN RETURN NEW; END IF;
  -- Permitir slugs sin formulario sólo si el servicio está inactivo.
  IF COALESCE(NEW.activo, false) = false THEN RETURN NEW; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.formularios WHERE slug = NEW.formulario_publico_slug) THEN
    RAISE EXCEPTION 'formulario_publico_slug % no existe como formulario (servicio %).',
      NEW.formulario_publico_slug, NEW.codigo
      USING ERRCODE = '23514'; -- check_violation
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_servicios_check_formulario_slug ON public.servicios;
CREATE TRIGGER trg_servicios_check_formulario_slug
  BEFORE INSERT OR UPDATE OF formulario_publico_slug, activo ON public.servicios
  FOR EACH ROW EXECUTE FUNCTION private.servicios_check_formulario_slug();

-- =====================================================================
-- 4) Seedeo de precios ficticios realistas (entorno QA, todos estaban en 0)
--    Valores de orientación; el gerente los puede modificar desde catálogo.
-- =====================================================================

UPDATE public.servicios SET precio_base =  80000 WHERE codigo = 'rpac_inscripcion'      AND precio_base = 0;
UPDATE public.servicios SET precio_base =  80000 WHERE codigo = 'rpac_renovacion'       AND precio_base = 0;
UPDATE public.servicios SET precio_base =  35000 WHERE codigo = 'rpac_certificado'      AND precio_base = 0;
UPDATE public.servicios SET precio_base =  45000 WHERE codigo = 'rpac_ddjj'             AND precio_base = 0; -- por_consorcio
UPDATE public.servicios SET precio_base =  25000 WHERE codigo = 'juridico_consulta'     AND precio_base = 0;
UPDATE public.servicios SET precio_base = 180000 WHERE codigo = 'curso_formacion_rpac'  AND precio_base = 0;
UPDATE public.servicios SET precio_base =  95000 WHERE codigo = 'curso_actualizacion_rpac' AND precio_base = 0;
UPDATE public.servicios SET precio_base =  65000 WHERE codigo = 'rpa_actualizacion'     AND precio_base = 0;
UPDATE public.servicios SET precio_base =  12000 WHERE codigo = 'administracion_global' AND precio_base = 0; -- por_unidad_funcional
-- capacitacion_gratuita queda en $0 (es gratuita por definición).

COMMENT ON FUNCTION private.servicios_check_formulario_slug() IS
  'Auditoría QA-E2E 2026-05-26: previene que un servicio activo declare un formulario_publico_slug huérfano (EGG-QA-01).';
