-- 0357 · Compat del default POR TIPO (sigue a 0356 · chunk CONST)
-- 0356 introdujo un segundo es_default=true (tipo 'constancia'). Los fallbacks de
-- los resolutores del DIPLOMA hacían `WHERE es_default LIMIT 1` SIN ORDER BY →
-- con dos defaults el resultado era NO determinístico: un diploma podía recibir
-- el esquema de la constancia. Fix quirúrgico: `AND tipo='certificado'` en ambos
-- fallbacks (misma firma → CREATE OR REPLACE, R16 sin DROP; cero cambio de
-- comportamiento para el flujo del diploma, que vuelve a tener UN solo default).

CREATE OR REPLACE FUNCTION public.resolver_esquema_curso(p_curso_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_esquema_id uuid;
  v_row public.certificado_esquemas%ROWTYPE;
BEGIN
  SELECT cert_esquema_id INTO v_esquema_id FROM public.cursos WHERE id = p_curso_id;
  IF v_esquema_id IS NOT NULL THEN
    SELECT * INTO v_row FROM public.certificado_esquemas WHERE id = v_esquema_id;
    IF v_row.id IS NOT NULL THEN RETURN to_jsonb(v_row); END IF;
  END IF;
  -- Fallback: esquema default del sistema (SÓLO tipo certificado — mig 0357)
  SELECT * INTO v_row FROM public.certificado_esquemas
   WHERE es_default AND tipo = 'certificado' LIMIT 1;
  IF v_row.id IS NOT NULL THEN RETURN to_jsonb(v_row); END IF;
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.resolver_esquema_webinar(p_webinar_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_esquema_id uuid;
  v_row public.certificado_esquemas%ROWTYPE;
BEGIN
  SELECT cert_esquema_id INTO v_esquema_id FROM public.webinars WHERE id = p_webinar_id;
  IF v_esquema_id IS NOT NULL THEN
    SELECT * INTO v_row FROM public.certificado_esquemas WHERE id = v_esquema_id;
    IF v_row.id IS NOT NULL THEN RETURN to_jsonb(v_row); END IF;
  END IF;
  -- Fallback: esquema default del sistema (SÓLO tipo certificado — mig 0357)
  SELECT * INTO v_row FROM public.certificado_esquemas
   WHERE es_default AND tipo = 'certificado' LIMIT 1;
  IF v_row.id IS NOT NULL THEN RETURN to_jsonb(v_row); END IF;
  RETURN NULL;
END;
$function$;
