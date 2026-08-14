-- 0424 · DGG-138 §6: el UPDATE de extensión del reaviso re-chequea revocado_at
--
-- Hallazgo de la auditoría de cierre (nota, carrera teórica): en
-- derivacion_reavisar_gestoria la rama "token vivo" lee vence_at/revocado_at
-- con un SELECT y luego extiende con un UPDATE separado. Si otro gerente
-- revoca el token en esa ventana de milisegundos, la extensión pisaría un
-- token recién revocado (la revocación seguiría ganando en la VALIDACIÓN de
-- lectura — revocado_at manda — pero el vence_at quedaría extendido, sucio).
-- Fix de una línea: el UPDATE re-chequea revocado_at IS NULL, igual que
-- acceso_externo_registrar_visita. Patrón DO-replace con assert (cero drift).

DO $$
DECLARE
  v_def text;
  v_patron text := $p$UPDATE public.accesos_externos
       SET vence_at = GREATEST(vence_at, now() + interval '20 days')
     WHERE token = v_token
    RETURNING vence_at INTO v_vence_nuevo;$p$;
  v_reemplazo text := $p$UPDATE public.accesos_externos
       SET vence_at = GREATEST(vence_at, now() + interval '20 days')
     WHERE token = v_token
       AND revocado_at IS NULL
    RETURNING vence_at INTO v_vence_nuevo;$p$;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'derivacion_reavisar_gestoria';
  IF position(v_patron IN v_def) = 0 THEN
    RAISE EXCEPTION 'DGG-138 0424: patrón del UPDATE de extensión no encontrado — revisar manualmente';
  END IF;
  v_def := replace(v_def, v_patron, v_reemplazo);
  EXECUTE v_def;
  RAISE NOTICE 'DGG-138 0424: extensión del reaviso ahora respeta revocado_at';
END $$;

-- Smoke R16: sin overloads tras la recreación.
DO $$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM (
    SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname='public' AND p.proname='derivacion_reavisar_gestoria'
    GROUP BY p.proname HAVING count(*) > 1
  ) t;
  IF v_n > 0 THEN RAISE EXCEPTION 'DGG-138 0424: overload ambiguo (R16)'; END IF;
END $$;
