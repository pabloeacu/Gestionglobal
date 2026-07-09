-- 0304 · Etapa B (B6-DB) · Celebración del certificado ORIGEN-AWARE (curso vs
-- evento). Hoy el trigger y la RPC del banner están cableados a cursos:
--   · el trigger usa curso_id → para un cert de evento cae al fallback "el curso"
--     + link /portal/mis-cursos (copy y ruta incorrectos);
--   · cliente_certs_celebrar hace INNER JOIN cursos → DESCARTA los certs de evento.
-- Se hace ambos origen-aware SIN tocar el flujo de cursos (rama curso idéntica).
--
-- Decisión (Pablo): para EVENTOS el aviso es push + banner + badge (dashboard);
-- el certificado en sí llega por mail con PDF adjunto vía edge fn dedicada (B3),
-- así que la rama evento del trigger NO encola el 'curso-felicitacion' (evita el
-- doble email — gap G5). Prospectos: el trigger ya los skipea (sin profile).

-- 1) Trigger celebración ----------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_certificado_celebrar_fn()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_alumno_email   text;
  v_alumno_nombre  text;
  v_curso_titulo   text;
  v_link_portal    text := 'https://gestionglobal.ar/portal/mis-cursos';
  v_link_verif     text;
  v_es_evento      boolean := (NEW.webinar_id IS NOT NULL);
BEGIN
  -- Sin destinatario con cuenta (prospecto) → no hay push/banner/email de
  -- celebración; el cert le llega por mail con PDF (edge fn B3).
  SELECT au.email, COALESCE(p.full_name, 'Alumno')
    INTO v_alumno_email, v_alumno_nombre
  FROM public.profiles p
  LEFT JOIN auth.users au ON au.id = p.id
  WHERE p.id = NEW.alumno_profile_id;

  IF v_alumno_email IS NULL THEN
    RETURN NEW;  -- prospecto o alumno sin email → nada acá
  END IF;

  v_link_verif := 'https://gestionglobal.ar/verificar/' || NEW.codigo;

  IF v_es_evento THEN
    -- ===== Rama EVENTO: push a la ficha del evento; SIN email (lo manda B3) =====
    SELECT titulo INTO v_curso_titulo FROM public.webinars WHERE id = NEW.webinar_id;
    IF v_curso_titulo IS NULL THEN v_curso_titulo := 'el evento'; END IF;
    v_link_portal := 'https://gestionglobal.ar/portal/eventos/' || NEW.webinar_id::text;

    BEGIN
      INSERT INTO public.push_notifications_queue (user_id, titulo, cuerpo, click_url)
      VALUES (
        NEW.alumno_profile_id,
        '🎓 ¡Felicitaciones!',
        'Ya tenés tu certificado de ' || v_curso_titulo || '. Descargalo desde tu portal.',
        v_link_portal
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'trg_certificado_celebrar push(evento) fallo: %', SQLERRM;
    END;
    -- No se encola 'curso-felicitacion' para eventos (evita doble email; el cert
    -- llega por la edge fn con PDF adjunto).
  ELSE
    -- ===== Rama CURSO: comportamiento histórico intacto =====
    SELECT titulo INTO v_curso_titulo FROM public.cursos WHERE id = NEW.curso_id;
    IF v_curso_titulo IS NULL THEN v_curso_titulo := 'el curso'; END IF;

    BEGIN
      INSERT INTO public.push_notifications_queue (user_id, titulo, cuerpo, click_url)
      VALUES (
        NEW.alumno_profile_id,
        '🎓 ¡Felicitaciones!',
        'Terminaste ' || v_curso_titulo || '. Tu certificado está listo para descargar.',
        v_link_portal
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'trg_certificado_celebrar push fallo: %', SQLERRM;
    END;

    BEGIN
      PERFORM public.encolar_email(
        'curso-felicitacion', v_alumno_email, v_alumno_nombre,
        jsonb_build_object(
          'nombre', v_alumno_nombre, 'curso_titulo', v_curso_titulo,
          'link_portal', v_link_portal, 'link_verificacion', v_link_verif
        ),
        NEW.administracion_id, NULL, 'certificados', NEW.id, 1::smallint
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'trg_certificado_celebrar email fallo: %', SQLERRM;
    END;
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'trg_certificado_celebrar fallo top-level: %', SQLERRM;
  RETURN NEW;
END;
$function$;

-- 2) RPC del banner celebratorio: LEFT JOIN a ambas tablas + origen ---------
-- Cambia la firma (agrega webinar_id, origen, link_portal) → DROP+CREATE (R16).
DROP FUNCTION IF EXISTS public.cliente_certs_celebrar();
CREATE FUNCTION public.cliente_certs_celebrar()
 RETURNS TABLE(cert_id uuid, codigo text, curso_id uuid, webinar_id uuid, origen text,
               curso_titulo text, emitido_at timestamptz, link_verificacion text, link_portal text)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  RETURN QUERY
    SELECT c.id, c.codigo, c.curso_id, c.webinar_id,
           CASE WHEN c.webinar_id IS NOT NULL THEN 'evento' ELSE 'curso' END,
           COALESCE(cu.titulo, w.titulo, 'tu formación'),
           c.emitido_at,
           'https://gestionglobal.ar/verificar/' || c.codigo,
           CASE WHEN c.webinar_id IS NOT NULL
                THEN 'https://gestionglobal.ar/portal/eventos/' || c.webinar_id::text
                ELSE 'https://gestionglobal.ar/portal/mis-cursos' END
    FROM public.certificados c
    LEFT JOIN public.cursos cu    ON cu.id = c.curso_id
    LEFT JOIN public.webinars w   ON w.id  = c.webinar_id
    WHERE c.alumno_profile_id = auth.uid()
      AND c.celebracion_vista_at IS NULL
      AND c.revocado_at IS NULL
    ORDER BY c.emitido_at DESC;
END;
$function$;
REVOKE ALL ON FUNCTION public.cliente_certs_celebrar() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cliente_certs_celebrar() TO authenticated;
