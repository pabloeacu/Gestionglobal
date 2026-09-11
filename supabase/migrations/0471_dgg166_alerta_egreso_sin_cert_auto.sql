-- DGG-166 · Alerta a GERENCIA cuando un alumno EGRESA de un curso cuyo certificado
-- NO se emite automáticamente (pedido Pablo).
--
-- Algunos cursos tienen `cursos.cert_emite_auto = false` a propósito: p. ej. el
-- "Curso de Actualización RPA (CABA)" — damos el curso pero la certificación
-- depende de terceros (Fundplata/Gestar) y se gestiona por afuera. Cuando el alumno
-- cumple TODAS las condiciones (egresa), `emitir_certificado_si_corresponde` no emite
-- nada (guard `cert_emite_auto`), así que el egreso podía pasar desapercibido.
--
-- Fix: avisar a todos los gerentes por los 3 canales (campanita in-app + push web +
-- mail, todo vía `notify_all_gerentes`) con "Egresó del curso el alumno X · gestioná
-- el certificado". Espejo EXACTO del patrón `matricula_avisar_cert_retenido` (cert
-- retenido por pago), pero para el caso `cert_emite_auto = false` + todo cumplido.
-- Idempotente (una sola vez por matrícula) vía `egreso_sin_cert_avisado_at`.
-- Además, un banner persistente en el dashboard (RPC `dashboard_egresados_sin_cert`,
-- consumido por EgresadosSinCertWidget) para que no se pase.

ALTER TABLE public.curso_matriculas
  ADD COLUMN IF NOT EXISTS egreso_sin_cert_avisado_at timestamptz;

-- ── Aviso (campanita + push + mail) ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION private.matricula_avisar_egreso_sin_cert_auto(p_matricula_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_mat record;
  v_auto boolean;
  v_curso text;
  v_total int;
  v_pend int;
  v_alumno text;
BEGIN
  SELECT m.* INTO v_mat FROM public.curso_matriculas m WHERE m.id = p_matricula_id;
  -- Ya avisado, o el cert ya existe → nada que hacer.
  IF v_mat.id IS NULL OR v_mat.egreso_sin_cert_avisado_at IS NOT NULL THEN
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM public.certificados ct WHERE ct.matricula_id = p_matricula_id) THEN
    RETURN;
  END IF;

  -- Sólo cursos SIN emisión automática (los que sí emiten no necesitan gestión manual).
  SELECT c.cert_emite_auto, c.titulo INTO v_auto, v_curso FROM public.cursos c WHERE c.id = v_mat.curso_id;
  IF COALESCE(v_auto, true) THEN
    RETURN;
  END IF;

  -- Egresó = TODAS las condiciones activas cumplidas (+ gate de encuesta, igual que
  -- emitir_certificado_si_corresponde).
  SELECT count(*) FILTER (WHERE cc.activa),
         count(*) FILTER (WHERE cc.activa AND NOT mc.cumplida)
    INTO v_total, v_pend
    FROM public.matricula_condiciones mc
    JOIN public.curso_condiciones_config cc ON cc.id = mc.condicion_id
   WHERE mc.matricula_id = p_matricula_id;
  IF v_total IS NULL OR v_total = 0 OR v_pend <> 0 THEN
    RETURN;
  END IF;
  IF NOT public.matricula_cumple_encuesta(p_matricula_id) THEN
    RETURN;
  END IF;

  SELECT p.full_name INTO v_alumno FROM public.profiles p WHERE p.id = v_mat.profile_id;

  PERFORM public.notify_all_gerentes(
    'egreso_sin_cert_auto',
    '🎓 Egresó del curso · ' || COALESCE(v_alumno, 'Alumno'),
    'Egresó del curso el alumno ' || COALESCE(v_alumno, '—') || ' («' || COALESCE(v_curso, 'su curso')
      || '»). La configuración del curso no emite el certificado automáticamente. Es tiempo de '
      || 'gestionarlo para completar el ciclo de la graduación.',
    '/gerencia/campus/' || v_mat.curso_id::text,
    jsonb_build_object('matricula_id', p_matricula_id, 'curso_id', v_mat.curso_id),
    true,
    'gerencia-notif-generica',
    NULL, 2::smallint,
    'curso_matriculas', p_matricula_id
  );

  UPDATE public.curso_matriculas
     SET egreso_sin_cert_avisado_at = now()
   WHERE id = p_matricula_id;
END;
$function$;

CREATE OR REPLACE FUNCTION private.trg_condicion_cumplida_avisar_egreso()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.cumplida = true AND COALESCE(OLD.cumplida, false) = false THEN
    BEGIN
      PERFORM private.matricula_avisar_egreso_sin_cert_auto(NEW.matricula_id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'avisar_egreso_sin_cert falló (best-effort): %', SQLERRM;
    END;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_matricula_condiciones_avisar_egreso ON public.matricula_condiciones;
CREATE TRIGGER trg_matricula_condiciones_avisar_egreso
  AFTER UPDATE ON public.matricula_condiciones
  FOR EACH ROW EXECUTE FUNCTION private.trg_condicion_cumplida_avisar_egreso();

-- ── Banner del dashboard: egresados de cursos sin cert automático, sin cert emitido ──
CREATE OR REPLACE FUNCTION public.dashboard_egresados_sin_cert()
 RETURNS TABLE(matricula_id uuid, curso_id uuid, curso_titulo text, alumno_nombre text, egreso_desde timestamptz)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT private.is_staff() THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT m.id, m.curso_id, c.titulo,
         COALESCE(p.full_name, a.nombre, 'Alumno'),
         COALESCE(m.updated_at, m.created_at)
    FROM public.curso_matriculas m
    JOIN public.cursos c ON c.id = m.curso_id AND c.cert_emite_auto = false
    LEFT JOIN public.profiles p ON p.id = m.profile_id
    LEFT JOIN public.administraciones a ON a.id = m.administracion_id
    JOIN LATERAL (
      SELECT count(*) FILTER (WHERE cc.activa) AS total,
             count(*) FILTER (WHERE cc.activa AND NOT mc.cumplida) AS pend
        FROM public.matricula_condiciones mc
        JOIN public.curso_condiciones_config cc ON cc.id = mc.condicion_id
       WHERE mc.matricula_id = m.id
    ) k ON k.total > 0 AND k.pend = 0
   WHERE NOT EXISTS (SELECT 1 FROM public.certificados ct WHERE ct.matricula_id = m.id)
     AND public.matricula_cumple_encuesta(m.id)
   ORDER BY COALESCE(m.updated_at, m.created_at) DESC;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.dashboard_egresados_sin_cert() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dashboard_egresados_sin_cert() TO authenticated, service_role;
