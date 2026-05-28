-- ============================================================================
-- Migration: 0099_gestor_bypass_admin_assert
-- Fecha: 2026-05-28
-- DGG-XX · Fix #147: assert_administracion_access aceptaba sólo staff o el
-- admin propio. Como gestor_cargar_avance corre con role=anon (acceso por
-- token) y debe encolar email al cliente vía trigger, agregamos un bypass
-- controlado por GUC `app.skip_admin_assert='on'` que sólo se setea con
-- SET LOCAL dentro de RPCs trusted SECURITY DEFINER (que ya validaron
-- otro factor de autorización, ej: token vigente).
--
-- Riesgo: el GUC NO está expuesto en JWT, sólo se puede setear desde el
-- search_path interno de una función trusted. PostgREST + RLS no lo
-- exponen vía API directa.
-- ============================================================================

CREATE OR REPLACE FUNCTION private.assert_administracion_access(p_administracion_id uuid)
RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = 'public', 'pg_temp'
AS $$
BEGIN
  IF current_setting('app.skip_admin_assert', true) = 'on' THEN
    RETURN;
  END IF;
  IF private.is_staff() THEN
    RETURN;
  END IF;
  IF private.current_administracion_id() = p_administracion_id THEN
    RETURN;
  END IF;
  RAISE EXCEPTION USING
    ERRCODE = '42501',
    MESSAGE = 'Acceso denegado a la administración solicitada.';
END;
$$;

CREATE OR REPLACE FUNCTION public.gestor_cargar_avance(
  p_token         text,
  p_descripcion   text,
  p_archivos_urls text[] DEFAULT '{}'::text[]
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_acc public.accesos_externos%ROWTYPE;
  v_sol public.solicitudes%ROWTYPE;
  v_destinatario_label text;
  v_descripcion_final  text;
  v_linea_id uuid;
BEGIN
  IF COALESCE(trim(p_descripcion), '') = '' THEN
    RAISE EXCEPTION 'La descripción es obligatoria' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_acc FROM public.accesos_externos
   WHERE public.accesos_externos.token = p_token;
  IF v_acc.token IS NULL THEN
    RAISE EXCEPTION 'Token inválido' USING ERRCODE = 'P0002';
  END IF;
  IF v_acc.revocado_at IS NOT NULL THEN
    RAISE EXCEPTION 'Acceso revocado' USING ERRCODE = '42501';
  END IF;
  IF v_acc.vence_at < now() THEN
    RAISE EXCEPTION 'Acceso vencido' USING ERRCODE = '42501';
  END IF;
  IF v_acc.recurso_tipo <> 'solicitud' THEN
    RAISE EXCEPTION 'Token no corresponde a una solicitud' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_sol FROM public.solicitudes s
   WHERE s.id = v_acc.recurso_id;
  IF v_sol.id IS NULL THEN
    RAISE EXCEPTION 'Solicitud no encontrada' USING ERRCODE = 'P0002';
  END IF;
  IF v_sol.tramite_id IS NULL THEN
    RAISE EXCEPTION 'La solicitud aún no tiene trámite asociado'
      USING ERRCODE = '22023';
  END IF;

  v_destinatario_label := COALESCE(
    NULLIF(v_acc.nombre_destinatario, ''),
    v_acc.email_destinatario
  );
  v_descripcion_final := '✉️ Aporte de gestoría externa (' || v_destinatario_label
    || E'):\n\n' || trim(p_descripcion);

  -- Autorizamos el bypass del assert_administracion_access durante esta tx,
  -- dado que ya validamos el token + tipo + vigencia arriba.
  PERFORM set_config('app.skip_admin_assert', 'on', true);

  INSERT INTO public.tracking_lineas (
    tramite_id, categoria, descripcion, archivos_urls,
    autor_id, visible_cliente
  ) VALUES (
    v_sol.tramite_id,
    'gestor_avance',
    v_descripcion_final,
    COALESCE(p_archivos_urls, '{}'::text[]),
    NULL,
    true
  )
  RETURNING tracking_lineas.id INTO v_linea_id;

  UPDATE public.accesos_externos
     SET usado_at = COALESCE(usado_at, now()),
         ultima_visita_at = now(),
         total_visitas = COALESCE(total_visitas, 0) + 1
   WHERE public.accesos_externos.token = p_token;

  RETURN v_linea_id;
END;
$$;
