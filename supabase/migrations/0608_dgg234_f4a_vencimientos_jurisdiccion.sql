-- 0608_dgg234_f4a_vencimientos_jurisdiccion.sql
-- DGG-234 · Fase 4a — Columna de jurisdicción en vencimientos (ADITIVA).
-- Ver DGG-234_matricula_multijurisdiccion.md
-- --------------------------------------------------------------------------
-- Para que dispatch-vencimientos pueda rotular/rutear el aviso por jurisdicción
-- (hoy TIPO_LABEL dice "Matrícula RPAC" para TODA matrícula). Columna nullable
-- (los consumidores SELECT * la ignoran; ningún código del front la referencia
-- aún). Backfill preciso de lo existente + trigger que fija default en NULL.
-- --------------------------------------------------------------------------

ALTER TABLE public.vencimientos
  ADD COLUMN IF NOT EXISTS jurisdiccion public.jurisdiccion_matricula;

-- Backfill: CABA = aniversario curso CABA + las declaradas CABA pausadas + tracking CABA; resto PBA.
UPDATE public.vencimientos SET jurisdiccion = CASE
    WHEN tipo = 'curso_rpa_caba' THEN 'caba'
    WHEN tipo = 'renovacion_matricula_declarada' AND pausado_at IS NOT NULL THEN 'caba'
    WHEN tipo = 'otro' AND descripcion ILIKE '%(CABA)%' THEN 'caba'
    ELSE 'pba'
  END::public.jurisdiccion_matricula
WHERE jurisdiccion IS NULL;

-- Default para filas futuras: curso_rpa_caba -> caba; el resto -> pba (los
-- materializadores de CABA/NEU setean jurisdiccion explícita y el trigger no pisa).
CREATE OR REPLACE FUNCTION public.venc_jurisdiccion_default_fn()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.jurisdiccion IS NULL THEN
    NEW.jurisdiccion := CASE WHEN NEW.tipo = 'curso_rpa_caba' THEN 'caba'::public.jurisdiccion_matricula
                             ELSE 'pba'::public.jurisdiccion_matricula END;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_venc_jurisdiccion_default ON public.vencimientos;
CREATE TRIGGER trg_venc_jurisdiccion_default
  BEFORE INSERT OR UPDATE OF tipo, jurisdiccion ON public.vencimientos
  FOR EACH ROW EXECUTE FUNCTION public.venc_jurisdiccion_default_fn();
