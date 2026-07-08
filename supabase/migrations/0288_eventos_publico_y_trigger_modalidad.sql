-- 0288 · Eventos fase 3 (backend público):
-- (1) webinar_inscripcion_activa() devuelve modalidad/tipo/ubicación/arancel
--     (para que la landing muestre el lugar y el arancel). Misma firma → CREATE
--     OR REPLACE. Sólo agrega campos públicos (sin secretos Zoom).
-- (2) el trigger de inscripción desde submission pasa la preferencia de modalidad
--     (mixto) leída de los datos del formulario (clave 'modalidad_preferida').

CREATE OR REPLACE FUNCTION public.webinar_inscripcion_activa()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT to_jsonb(t) FROM (
    SELECT w.id,
           w.titulo,
           w.descripcion,
           w.banner_url,
           w.docentes,
           w.fecha_hora,
           w.duracion_min,
           w.plataforma,
           w.modalidad,
           w.tipo,
           w.ubicacion_lugar,
           w.ubicacion_direccion,
           w.ubicacion_localidad,
           w.ubicacion_mapa_url,
           w.ubicacion_instrucciones,
           w.es_arancelado,
           w.arancel_monto,
           w.arancel_nota,
           COALESCE(w.formulario_id, ev.id)     AS formulario_id,
           COALESCE(f.slug, ev.slug)            AS formulario_slug,
           COALESCE(f.activo, ev.activo)        AS formulario_activo
    FROM public.webinars w
    LEFT JOIN public.formularios f ON f.id = w.formulario_id
    LEFT JOIN LATERAL (
      SELECT fe.id, fe.slug, fe.activo
      FROM public.formularios fe
      WHERE fe.categoria = 'evento' AND fe.activo
      ORDER BY fe.created_at ASC
      LIMIT 1
    ) ev ON true
    WHERE w.id = private.webinar_vigente_id()
  ) t;
$function$;

CREATE OR REPLACE FUNCTION public.inscribir_webinar_desde_submission()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_categoria  text;
  v_webinar_id uuid;
  v_target     uuid;
  v_resultado  jsonb;
  v_pref       text;
BEGIN
  SELECT categoria, webinar_id INTO v_categoria, v_webinar_id
    FROM public.formularios
   WHERE id = NEW.formulario_id;

  IF v_categoria <> 'evento' THEN
    RETURN NEW;
  END IF;

  v_target := COALESCE(v_webinar_id, private.webinar_vigente_id());

  IF v_target IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.email_contacto IS NULL OR NEW.nombre_contacto IS NULL THEN
    RETURN NEW;
  END IF;

  -- Preferencia de modalidad en eventos mixtos (la inyecta el front en los datos).
  v_pref := NULLIF(trim(NEW.datos->>'modalidad_preferida'), '');

  BEGIN
    v_resultado := public.inscribir_a_webinar(
      v_target,
      NEW.email_contacto,
      NEW.nombre_contacto,
      NEW.telefono_contacto,
      NEW.id,
      v_pref
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'inscribir_webinar_desde_submission: %', SQLERRM;
  END;

  RETURN NEW;
END;
$function$;
