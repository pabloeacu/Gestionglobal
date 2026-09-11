-- DGG-166 · §6 addendum: el aviso de egreso debe dispararse en EXACTAMENTE los
-- mismos puntos que la emisión del certificado, para no perder push/mail/campanita
-- en los caminos que la emisión sí cubre.
--
-- Hallazgos §6 (agentes A/B/C):
--  · A-#1 / C-H8: el trigger era `AFTER UPDATE` sin `OF cumplida` ni `WHEN` →
--    disparaba en toda UPDATE de la fila (ineficiente) e inconsistente con el trigger
--    de emisión (`AFTER INSERT OR UPDATE OF cumplida`).
--  · A-#2: como el egreso era sólo `AFTER UPDATE`, si la condición que completa el
--    egreso llega por la rama INSERT de `matricula_sync_*` (`INSERT … cumplida=true
--    ON CONFLICT DO UPDATE`, para una condición no seedeada), el aviso NO salía —
--    aunque para cert_emite_auto=true el cert sí se emitiría (su trigger es INSERT OR
--    UPDATE). Fix: alinear el trigger a `AFTER INSERT OR UPDATE OF cumplida`.
--  · B-H1: si la encuesta es requisito de cert por `curso_encuestas.requerida_para_cert`
--    y NO está modelada como condición `tipo='encuesta'`, al responderla ÚLTIMA
--    `matricula_sync_encuesta` no toca `matricula_condiciones` → ningún trigger →
--    aviso mudo. La emisión sí se cubre porque `matricula_sync_encuesta` llama a
--    `emitir_certificado_si_corresponde` al final. Fix: llamar también al aviso ahí
--    (best-effort), simétrico a la emisión.
--  · B-H3 / C-H9 (cosmético): `egreso_desde` usaba `updated_at`, que cualquier UPDATE
--    de la matrícula bumpea → el banner descartado (X) reaparecía como "nuevo". Usar
--    el instante estable en que se detectó el egreso (`egreso_sin_cert_avisado_at`).

-- (1) Trigger simétrico al de emisión: INSERT OR UPDATE OF cumplida, sólo cuando queda cumplida.
DROP TRIGGER IF EXISTS trg_matricula_condiciones_avisar_egreso ON public.matricula_condiciones;
CREATE TRIGGER trg_matricula_condiciones_avisar_egreso
  AFTER INSERT OR UPDATE OF cumplida ON public.matricula_condiciones
  FOR EACH ROW
  WHEN (NEW.cumplida IS TRUE)
  EXECUTE FUNCTION private.trg_condicion_cumplida_avisar_egreso();

-- (2) La respuesta de encuesta (que puede completar el egreso sin tocar
--     matricula_condiciones) también intenta avisar — simétrico al emit best-effort.
--     Cuerpo idéntico al vivo + el PERFORM del aviso.
CREATE OR REPLACE FUNCTION public.matricula_sync_encuesta(p_matricula_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_curso_id uuid; v_cond record; v_respondio boolean;
BEGIN
  SELECT curso_id INTO v_curso_id FROM public.curso_matriculas WHERE id = p_matricula_id;
  IF v_curso_id IS NULL THEN RETURN; END IF;
  FOR v_cond IN
    SELECT cc.id FROM public.curso_condiciones_config cc
     WHERE cc.curso_id = v_curso_id AND cc.tipo = 'encuesta' AND cc.activa = true
  LOOP
    SELECT EXISTS (
      SELECT 1 FROM public.curso_encuesta_respuestas r
       JOIN public.curso_encuestas e ON e.id = r.encuesta_id
      WHERE r.matricula_id = p_matricula_id AND e.curso_id = v_curso_id
    ) INTO v_respondio;
    IF v_respondio THEN
      INSERT INTO public.matricula_condiciones (matricula_id, condicion_id, cumplida, cumplida_at, cumplida_por)
      VALUES (p_matricula_id, v_cond.id, true, now(), NULL)
      ON CONFLICT (matricula_id, condicion_id) DO UPDATE
        SET cumplida = true, cumplida_at = COALESCE(public.matricula_condiciones.cumplida_at, now())
      WHERE public.matricula_condiciones.cumplida = false;
    END IF;
  END LOOP;
  -- Emisión best-effort: nunca debe romper la respuesta de la encuesta. Si el guard de
  -- emitir_certificado bloquea (alumno no-staff), el cron gg-campus-certificados emite.
  BEGIN
    PERFORM public.emitir_certificado_si_corresponde(p_matricula_id);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  -- DGG-166 §6 (B-H1): simétrico al emit — si el curso no emite cert auto y este
  -- fue el último paso del egreso, avisar a gerencia (best-effort).
  BEGIN
    PERFORM private.matricula_avisar_egreso_sin_cert_auto(p_matricula_id);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
END;
$function$;

-- (3) Banner: instante de egreso estable (no revive con updates no relacionados).
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
         COALESCE(m.egreso_sin_cert_avisado_at, m.updated_at, m.created_at)
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
   ORDER BY COALESCE(m.egreso_sin_cert_avisado_at, m.updated_at, m.created_at) DESC;
END;
$function$;
