-- 0212 · F6 (Lista JL · DGG-63) · Webinars: inscripción "al vigente"
--
-- Decisión de Pablo (chunk 3): FORM COMPARTIDO + inscribe al vigente. Todos los
-- webinars usan el form 'webinarios' (categoria='evento'); la página de
-- inscripción (landing/portal) lo envuelve con la identidad del webinar
-- vigente. Para que enviar ese form inscriba SIEMPRE al webinar activo (y no a
-- uno estático), la resolución del "webinar vigente" pasa a ser una única
-- fuente de verdad reutilizada por:
--   1) la RPC pública webinar_inscripcion_activa() (qué se muestra), y
--   2) el trigger inscribir_webinar_desde_submission() (a quién se inscribe).
--
-- Así "el más próximo gana" queda consistente incluso con N webinars publicados
-- a la vez: lo que se muestra es lo que recibe la inscripción.
--
-- Aditivo / sin pérdida: el trigger conserva la semántica vieja
-- (formularios.webinar_id explícito) vía COALESCE — si algún form de evento
-- apunta a un webinar puntual, se respeta; si no (caso del form compartido),
-- resuelve el vigente.

-- ---------------------------------------------------------------------------
-- 1 · Única fuente de verdad: el id del webinar vigente ("el más próximo gana").
--     Espeja exactamente el WHERE/ORDER de la RPC del chunk 1.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.webinar_vigente_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT w.id
  FROM public.webinars w
  WHERE w.publicado
    AND w.status <> 'cancelado'
    AND now() < (w.fecha_hora + make_interval(mins => w.duracion_min))
  ORDER BY w.fecha_hora ASC          -- el más próximo / en curso primero
  LIMIT 1;
$function$;

REVOKE EXECUTE ON FUNCTION private.webinar_vigente_id() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2 · La RPC pública ahora delega la SELECCIÓN al helper (mismos campos
--     públicos que el chunk 1; misma firma → CREATE OR REPLACE, sin overload R16).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.webinar_inscripcion_activa()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
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
           w.formulario_id,
           f.slug   AS formulario_slug,
           f.activo AS formulario_activo
    FROM public.webinars w
    LEFT JOIN public.formularios f ON f.id = w.formulario_id
    WHERE w.id = private.webinar_vigente_id()
  ) t;
$function$;

GRANT EXECUTE ON FUNCTION public.webinar_inscripcion_activa() TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3 · El trigger de auto-inscripción desde submission resuelve el target como
--     COALESCE(formulario.webinar_id, webinar vigente). SECURITY DEFINER se
--     mantiene (R17: escribe en webinar_inscriptos vía inscribir_a_webinar).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.inscribir_webinar_desde_submission()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_categoria  text;
  v_webinar_id uuid;
  v_target     uuid;
  v_resultado  jsonb;
BEGIN
  SELECT categoria, webinar_id INTO v_categoria, v_webinar_id
    FROM public.formularios
   WHERE id = NEW.formulario_id;

  IF v_categoria <> 'evento' THEN
    RETURN NEW;
  END IF;

  -- Form compartido: si el form no apunta a un webinar puntual, inscribimos
  -- al webinar VIGENTE (el que se está mostrando). Si apunta a uno, se respeta.
  v_target := COALESCE(v_webinar_id, private.webinar_vigente_id());

  IF v_target IS NULL THEN
    RETURN NEW;  -- no hay webinar vigente: la submission queda como prospecto.
  END IF;
  IF NEW.email_contacto IS NULL OR NEW.nombre_contacto IS NULL THEN
    RETURN NEW;  -- no podemos inscribir sin email+nombre
  END IF;

  BEGIN
    v_resultado := public.inscribir_a_webinar(
      v_target,
      NEW.email_contacto,
      NEW.nombre_contacto,
      NEW.telefono_contacto,
      NEW.id
    );
  EXCEPTION WHEN OTHERS THEN
    -- No bloquear la submission si la inscripción falla (cupo / webinar cerrado).
    RAISE WARNING 'inscribir_webinar_desde_submission: %', SQLERRM;
  END;

  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.inscribir_webinar_desde_submission() FROM PUBLIC, anon, authenticated;

-- El trigger (trg_subm_inscribir_webinar) ya existe sobre formulario_submissions
-- (mig 0050); CREATE OR REPLACE de la función basta, no se recrea el trigger.

-- ---------------------------------------------------------------------------
-- 4 · Smoke NO mutante (R18 — el e2e mutante con submission real se corre
--     aparte, con BEGIN/ROLLBACK, y se reporta): hoy hay 0 webinars vigentes,
--     así que el helper devuelve NULL y la RPC NULL, sin reventar.
-- ---------------------------------------------------------------------------
DO $smoke$
DECLARE v_id uuid; v_rpc jsonb;
BEGIN
  SELECT private.webinar_vigente_id() INTO v_id;
  SELECT public.webinar_inscripcion_activa() INTO v_rpc;
  RAISE NOTICE 'smoke 0212 OK · vigente_id=% · rpc=%',
    COALESCE(v_id::text, 'NULL'), COALESCE(v_rpc::text, 'NULL');
END
$smoke$;
