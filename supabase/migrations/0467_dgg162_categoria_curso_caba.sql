-- ============================================================================
-- 0467 · DGG-162 — Fix: el Curso de Actualización RPA (CABA) quedaba con
-- categoria='otro' → la matriculación fallaba ("El trámite no existe, no es de
-- curso o no pertenece a este cliente").
-- ----------------------------------------------------------------------------
-- CAUSA RAÍZ: solicitud_activar mapea servicio_slug→categoria con un CASE que
-- sólo tenía 'curso-formacion' y 'curso-actualizacion' (RPAC/PBA) como 'curso'.
-- El curso de actualización CABA usa el slug 'curso-actualizacion-caba' (servicio
-- rpa_actualizacion) → caía en ELSE 'otro'. El guard de curso_asignar_alumno
-- (mig 0434) exige categoria='curso' → rechazaba la matrícula. (No tenía nada que
-- ver con estar en 2 cursos a la vez.)
--
-- FIX: (1) agregar el slug CABA al CASE; (2) DEFENSA por CÓDIGO de servicio de
-- curso (rpa_actualizacion / curso_actualizacion_rpac / curso_formacion_rpac) para
-- no depender sólo del slug ante cursos nuevos. Se parchea la definición VIVA
-- (patrón de 0457, con guardas fail-safe) y se backfillea el trámite roto.
--
-- DEUDA anotada: el mapeo slug→categoria es una lista hardcodeada; lo robusto sería
-- una bandera `es_curso` en `servicios`. Por ahora, dos redes (slug + código).
-- ============================================================================
DO $mig$
DECLARE d text; d2 text; v_new text;
BEGIN
  d := pg_get_functiondef('public.solicitud_activar(uuid,uuid,jsonb,text,date)'::regprocedure);

  -- (1) slug del Curso de Actualización RPA (CABA)
  d2 := regexp_replace(d,
    $q$WHEN\s+'curso-actualizacion'\s+THEN\s+'curso'\s+ELSE\s+'otro'\s+END;$q$,
    $q$WHEN 'curso-actualizacion' THEN 'curso' WHEN 'curso-actualizacion-caba' THEN 'curso' ELSE 'otro' END;$q$
  );
  IF d2 = d OR position('curso-actualizacion-caba' in d2) = 0 THEN
    RAISE EXCEPTION 'DGG-162: no se pudo inyectar el slug CABA (cambio la forma del CASE).';
  END IF;
  d := d2;

  -- (2) defensa por codigo de servicio de curso (ancla: la asignacion de v_titulo)
  d2 := replace(d,
    $q$v_titulo := COALESCE(v_servicio.nombre$q$,
    $q$IF v_categoria = 'otro' AND v_servicio.codigo IN ('rpa_actualizacion','curso_actualizacion_rpac','curso_formacion_rpac') THEN v_categoria := 'curso'; END IF;
  v_titulo := COALESCE(v_servicio.nombre$q$
  );
  IF d2 = d THEN
    RAISE EXCEPTION 'DGG-162: no se pudo anclar la defensa por codigo (no se hallo v_titulo).';
  END IF;
  d := d2;

  EXECUTE d;

  v_new := pg_get_functiondef('public.solicitud_activar(uuid,uuid,jsonb,text,date)'::regprocedure);
  IF position('curso-actualizacion-caba' in v_new) = 0
     OR position($q$IN ('rpa_actualizacion'$q$ in v_new) = 0 THEN
    RAISE EXCEPTION 'DGG-162: verificacion post-EXECUTE fallo.';
  END IF;
END $mig$;

-- Backfill: trámites de curso que hayan quedado con categoria='otro' (hoy: sólo
-- ffae2ad9, el de rpa_actualizacion). Scope estricto por código de servicio de curso.
UPDATE public.tramites t
   SET categoria = 'curso', updated_at = now()
  FROM public.servicios s
 WHERE s.id = t.servicio_id
   AND s.codigo IN ('rpa_actualizacion','curso_actualizacion_rpac','curso_formacion_rpac')
   AND t.categoria = 'otro';
