-- 0203 · Fix: tracking_reabrir con "notificar cliente" tildado estaba ROTO (E-GG-55)
--
-- Descubierto por el smoke e2e del fix E-GG-54 (la doble auditoría ejercitando,
-- no leyendo). `tracking_reabrir(..., p_notificar_cliente => true)` lanzaba
-- error y abortaba TODA la reapertura por dos bugs en el bloque de notificación:
--   1) `encolar_email(..., 1)` pasa `1` (integer) donde la firma única de
--      `encolar_email` espera `smallint` → 42883 "function does not exist".
--      Drift tipo E-GG-42: `encolar_email` se redefinió a smallint y este caller
--      (mig 0188) quedó desfasado. plpgsql no lo valida al aplicar la migración.
--   2) El push hacía `INSERT ... SELECT FROM profiles WHERE p.rol = 'cliente'`,
--      pero `profiles` NO tiene columna `rol` (es `role`) y NO existe el rol
--      'cliente' (los clientes son role='administrador') → 42703.
-- Efecto en prod: el gerente que reabría desde el modal con el check
-- "notificar al cliente" tildado obtenía un error y la reapertura NO se hacía.
--
-- Fix:
--   - `encolar_email(..., 1::smallint)`.
--   - Push vía `public.encolar_push(v_admin.user_id, ...)` (el user_id de la
--     administración es el perfil del cliente en el portal), igual que
--     `tracking_linea_on_insert`. Sin el INSERT roto.
--   - Cada notificación envuelta en BEGIN/EXCEPTION: un fallo de email/push NO
--     debe abortar la reapertura (la acción de negocio es prioritaria).
--
-- R16: CREATE OR REPLACE de misma firma → sin overloads nuevos.
-- R17: ya es SECURITY DEFINER con search_path fijo.
-- R18: smoke e2e BEGIN/ROLLBACK (reabrir modal notify=true ya no falla; no
--      duplica con el trigger de 0202).

CREATE OR REPLACE FUNCTION public.tracking_reabrir(p_tramite_id uuid, p_motivo text, p_notificar_cliente boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tramite     record;
  v_admin       record;
  v_email_to    text;
  v_email_name  text;
  v_motivo_clean text;
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'solo_staff_puede_reabrir' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_tramite FROM public.tramites WHERE id = p_tramite_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'tramite_inexistente' USING ERRCODE = 'P0002';
  END IF;

  IF v_tramite.estado <> 'cerrado' THEN
    RAISE EXCEPTION 'tramite_no_cerrado_no_se_reabre' USING ERRCODE = '22023';
  END IF;

  v_motivo_clean := COALESCE(trim(p_motivo), '');
  IF length(v_motivo_clean) = 0 THEN
    RAISE EXCEPTION 'motivo_reapertura_requerido' USING ERRCODE = '23502';
  END IF;

  UPDATE public.tramites
    SET estado                  = 'en_progreso',
        fecha_fin               = NULL,
        motivo_cierre           = NULL,
        cierre_satisfactorio    = NULL,
        resuelto_at             = NULL,
        resuelto_por            = NULL,
        reabierto_count         = reabierto_count + 1,
        ultima_reapertura_at    = now(),
        ultima_reapertura_motivo= v_motivo_clean,
        ultima_actividad_at     = now()
   WHERE id = p_tramite_id;

  INSERT INTO public.tracking_lineas (
    tramite_id, categoria, descripcion, estado_asociado,
    archivos_urls, autor_id, visible_cliente
  ) VALUES (
    p_tramite_id,
    'reapertura',
    'Trámite reabierto. Motivo: ' || v_motivo_clean,
    'reabierto',
    '{}'::text[],
    auth.uid(),
    true
  );

  IF p_notificar_cliente THEN
    SELECT a.* INTO v_admin FROM public.administraciones a
      WHERE a.id = v_tramite.administracion_id;

    IF v_admin.id IS NOT NULL THEN
      v_email_to := v_admin.email;
      v_email_name := v_admin.nombre;

      IF v_email_to IS NOT NULL AND length(trim(v_email_to)) > 0 THEN
        BEGIN
          PERFORM public.encolar_email(
            'tramite-reabierto',
            v_email_to,
            v_email_name,
            jsonb_build_object(
              'cliente_nombre',    v_email_name,
              'tramite_codigo',    v_tramite.codigo,
              'tramite_titulo',    v_tramite.titulo,
              'tramite_id',        v_tramite.id::text,
              'motivo_reapertura', v_motivo_clean
            ),
            v_admin.id,
            NULL,
            'tramites',
            v_tramite.id,
            1::smallint
          );
        EXCEPTION WHEN OTHERS THEN NULL; END;
      END IF;

      IF v_admin.user_id IS NOT NULL THEN
        BEGIN
          PERFORM public.encolar_push(
            v_admin.user_id,
            'Reabrimos tu gestión',
            v_tramite.titulo || ' · Motivo: ' || left(v_motivo_clean, 120),
            NULL,
            '/portal/gestiones/' || v_tramite.id::text
          );
        EXCEPTION WHEN OTHERS THEN NULL; END;
      END IF;
    END IF;
  END IF;
END;
$function$;
