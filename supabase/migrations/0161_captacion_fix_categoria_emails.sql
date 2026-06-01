-- 0161 · CAPTACION-FIX · re-incorporar emails perdidos en mig 0135 + denylist
--                       por categoría (E-GG-26 regresión silenciosa)
--
-- Aplicada el 2026-06-01 (via apply_migration).
--
-- Origen del bug: José Luis (segundo gerente) reportó que se inscribió una
-- persona al servicio "Curso inicial de formación de administradores" con
-- el mail estudio.saveriano@gmail.com. La submission entró a
-- formulario_submissions PERO:
--   - NO se generó solicitud en public.solicitudes.
--   - NO se encoló email de acuse al solicitante.
--   - NO se encoló email de aviso a gerencia.
--   - NO apareció nada en el panel de gerencia.
--
-- Diagnóstico:
--   - Bug 1: el trigger crear_tramite_desde_submission_auto tenía
--     IF v_form.categoria NOT IN ('tramite','servicio','consulta') → exit.
--     Los 2 formularios de cursos (categoría 'curso') quedaban huérfanos.
--   - Bug 2: la mig 0074 había agregado INSERTs a email_queue para acuse al
--     solicitante + aviso a cada gerente. La mig 0135 (voucher pipeline)
--     redefinió la función con CREATE OR REPLACE y PERDIÓ esos INSERTs.
--     Es una REGRESIÓN SILENCIOSA: nada falló, simplemente dejaron de
--     enviarse emails sin que nadie se diera cuenta hasta que un gerente
--     hizo testing real con una inscripción.
--
-- Fix:
--   1. Categoría: pasar de allowlist a denylist. Sólo 'evento' (webinars,
--      que tiene su propio trigger inscribir_webinar_desde_submission)
--      queda fuera. Toda categoría presente o futura genera solicitud por
--      default. Defensa contra futuras categorías huérfanas.
--   2. Re-incorporar acuse 'formulario-submission-recibido' al solicitante.
--   3. Re-incorporar email 'solicitud-nueva-gerencia' a cada gerente activo.
--   4. Conservar la lógica de voucher/precio de mig 0135.
--
-- Backfill: se ejecutó manualmente para la submission de Saveriano
-- (id 36007898-120b-494c-8360-42dae1a1bace) creando su solicitud
-- (af95214f-bb69-4458-b101-89ff1ce1d8e8) y encolando los 3 emails.

CREATE OR REPLACE FUNCTION public.crear_tramite_desde_submission_auto()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_form         record;
  v_apellido     text;
  v_nombre       text;
  v_nombre_completo text;
  v_origen_canal text;
  v_voucher_codigo text;
  v_voucher      record;
  v_servicio     record;
  v_precio_apl   numeric;
  v_precio_fin   numeric;
  v_voucher_id   uuid;
  v_voucher_pct  numeric;
  v_es_cliente   boolean;
  v_solicitud_id uuid;
  v_staff        record;
BEGIN
  SELECT id, slug, titulo, categoria, servicio_id
    INTO v_form
    FROM public.formularios
   WHERE id = NEW.formulario_id;

  -- DENYLIST: sólo 'evento' (webinars) queda fuera — tiene su propio
  -- trigger inscribir_webinar_desde_submission. Cualquier otra categoría
  -- (tramite, servicio, consulta, curso, y futuras) genera solicitud.
  IF v_form.categoria = 'evento' THEN
    RETURN NEW;
  END IF;

  v_apellido := NULLIF(trim(COALESCE(NEW.datos->>'apellido', '')), '');
  v_nombre   := NULLIF(trim(COALESCE(NEW.datos->>'nombre', '')), '');
  v_nombre_completo := COALESCE(
    NEW.nombre_contacto,
    NULLIF(trim(concat_ws(' ', v_apellido, v_nombre)), ''),
    NEW.email_contacto,
    'sin contacto'
  );

  v_origen_canal := COALESCE(NULLIF(trim(NEW.datos->>'_origen_canal'), ''), 'publico');
  IF v_origen_canal NOT IN ('publico','cliente') THEN v_origen_canal := 'publico'; END IF;
  v_es_cliente := (v_origen_canal = 'cliente');

  IF v_form.servicio_id IS NOT NULL THEN
    SELECT id, precio_publico, precio_cliente
      INTO v_servicio
      FROM public.servicios
     WHERE id = v_form.servicio_id;
    IF v_origen_canal = 'cliente' THEN
      v_precio_apl := v_servicio.precio_cliente;
    ELSE
      v_precio_apl := v_servicio.precio_publico;
    END IF;
  END IF;
  v_precio_fin := v_precio_apl;

  v_voucher_codigo := NULLIF(trim(NEW.datos->>'_voucher_codigo'), '');
  IF v_voucher_codigo IS NOT NULL AND v_form.servicio_id IS NOT NULL THEN
    SELECT * INTO v_voucher
      FROM public.servicio_vouchers vv
     WHERE vv.servicio_id = v_form.servicio_id
       AND lower(vv.codigo) = lower(v_voucher_codigo)
       AND vv.activo
       AND (vv.expira_at IS NULL OR vv.expira_at > NOW())
       AND (vv.max_usos IS NULL OR vv.usos_count < vv.max_usos)
       AND (
         vv.alcance = 'ambos'
         OR (vv.alcance = 'publico' AND NOT v_es_cliente)
         OR (vv.alcance = 'cliente' AND v_es_cliente)
       )
     LIMIT 1;
    IF FOUND THEN
      v_voucher_id  := v_voucher.id;
      v_voucher_pct := v_voucher.descuento_pct;
      IF v_precio_apl IS NOT NULL THEN
        v_precio_fin := ROUND(v_precio_apl * (1 - v_voucher_pct / 100), 2);
      END IF;
      UPDATE public.servicio_vouchers
         SET usos_count = usos_count + 1, updated_at = NOW()
       WHERE id = v_voucher.id;
    END IF;
  END IF;

  INSERT INTO public.solicitudes (
    formulario_submission_id, servicio_solicitado_id,
    solicitante_nombre, solicitante_email, solicitante_telefono,
    servicio_slug, estado, cliente_id,
    origen_canal, precio_aplicado, precio_final,
    voucher_id, voucher_codigo, voucher_descuento_pct
  )
  VALUES (
    NEW.id, v_form.servicio_id,
    v_nombre_completo, NEW.email_contacto, NEW.telefono_contacto,
    v_form.slug, 'recibida', NEW.administracion_id,
    v_origen_canal, v_precio_apl, v_precio_fin,
    v_voucher_id, v_voucher_codigo, v_voucher_pct
  )
  RETURNING id INTO v_solicitud_id;

  -- ACUSE al solicitante (re-incorporado de mig 0074, perdido en mig 0135).
  IF NEW.email_contacto IS NOT NULL AND length(trim(NEW.email_contacto)) > 0 THEN
    BEGIN
      INSERT INTO public.email_queue (
        kind, template_slug, to_email, to_nombre, variables,
        prioridad, intento, max_intentos, programado_para,
        administracion_id, related_table, related_id
      )
      VALUES (
        'workflow', 'formulario-submission-recibido',
        NEW.email_contacto, v_nombre_completo,
        jsonb_build_object('nombre', COALESCE(v_nombre, v_nombre_completo)),
        2, 0, 3, now(),
        NEW.administracion_id, 'solicitudes', v_solicitud_id
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'No se pudo encolar acuse al solicitante: %', SQLERRM;
    END;
  END IF;

  -- AVISO A GERENCIA (re-incorporado de mig 0074, perdido en mig 0135).
  FOR v_staff IN
    SELECT u.id, u.email
      FROM auth.users u
      JOIN public.profiles p ON p.id = u.id
     WHERE p.role IN ('gerente','operador')
       AND COALESCE(p.activo, true) = true
       AND u.email IS NOT NULL AND length(trim(u.email)) > 0
  LOOP
    BEGIN
      INSERT INTO public.email_queue (
        kind, template_slug, to_email, to_nombre, variables,
        prioridad, intento, max_intentos, programado_para,
        related_table, related_id
      )
      VALUES (
        'workflow', 'solicitud-nueva-gerencia',
        v_staff.email, NULL,
        jsonb_build_object(
          'formulario_titulo', v_form.titulo,
          'solicitante_nombre', v_nombre_completo,
          'solicitante_email',  COALESCE(NEW.email_contacto, '—'),
          'solicitante_telefono', COALESCE(NEW.telefono_contacto, '—'),
          'solicitud_url', '/gerencia/solicitudes/' || v_solicitud_id::text
        ),
        3, 0, 3, now(),
        'solicitudes', v_solicitud_id
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'No se pudo encolar aviso a gerencia (%): %', v_staff.email, SQLERRM;
    END;
  END LOOP;

  RETURN NEW;
END;
$function$;
