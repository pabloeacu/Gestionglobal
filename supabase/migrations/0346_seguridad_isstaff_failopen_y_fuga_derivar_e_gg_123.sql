-- 0346 · WAVE 7 · E-GG-123: blindaje de seguridad crítico (auditoría exhaustiva 8 circuitos).
--
-- CAUSA RAÍZ SISTÉMICA (mega-fix): private.is_staff() devuelve NULL para anon
-- (auth.uid()=NULL → get_user_role()=NULL → NULL IN (...) = NULL). Decenas de RPC
-- usan `IF NOT private.is_staff() THEN RAISE` que FALLA-ABIERTO con NULL
-- (`NOT NULL`=NULL → el IF no dispara). Confirmado en BD que un ANÓNIMO con la
-- anon-key podía: (1) leer los datos financieros de TODOS los clientes vía
-- cuenta_corriente_resumen_global; (2) CERRAR cualquier trámite (tracking_cerrar);
-- (3) REABRIR cualquier trámite (tracking_reabrir). Es la clase E-GG-109b/119 pero
-- sistémica. Fix de mayor palanca: que is_staff() NUNCA devuelva NULL → cierra de
-- una vez TODOS los call-sites `IF NOT is_staff()` (es estrictamente más seguro:
-- para no-anon ya devolvía true/false, sólo cambia el caso anon NULL→false).

-- ── (1) ROOT FIX: is_staff() nunca NULL ──────────────────────────────────────
CREATE OR REPLACE FUNCTION private.is_staff()
 RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE(private.get_user_role() IN ('gerente','operador'), false);
$function$;

-- ── (2) FUGA de email del gestor al cliente (E-GG-111 no lo tapaba) ──────────
-- solicitud_derivar insertaba la línea "Envío a sector de gestoría — destinatario:
-- <mail del gestor>" con visible_cliente=TRUE → se filtraba al cliente por portal,
-- recordatorio, avance, push e in-app. Paridad con el resto: visible_cliente=false
-- (es una línea de seguimiento INTERNA de gerencia).
CREATE OR REPLACE FUNCTION public.solicitud_derivar(p_solicitud_id uuid, p_destinatario_email text, p_destinatario_nombre text, p_plantilla_slug text DEFAULT 'solicitud-derivada-gestoria'::text, p_observaciones text DEFAULT NULL::text, p_dias_validez integer DEFAULT 14)
 RETURNS uuid
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_sol     public.solicitudes%ROWTYPE;
  v_servicio_nombre text;
  v_token   text;
  v_url     text;
  v_email_id uuid;
  v_der_id  uuid;
  v_vars    jsonb;
  v_destinatario_label text;
  v_dias    int;
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo staff' USING ERRCODE = '42501';
  END IF;
  v_dias := COALESCE(p_dias_validez, 14);
  IF v_dias < 1 OR v_dias > 365 THEN
    RAISE EXCEPTION 'dias_validez fuera de rango (1..365)' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_sol FROM public.solicitudes WHERE id = p_solicitud_id;
  IF v_sol.id IS NULL THEN
    RAISE EXCEPTION 'Solicitud no encontrada' USING ERRCODE = 'P0002';
  END IF;
  IF v_sol.servicio_solicitado_id IS NOT NULL THEN
    SELECT nombre INTO v_servicio_nombre FROM public.servicios WHERE id = v_sol.servicio_solicitado_id;
  END IF;
  v_servicio_nombre := COALESCE(v_servicio_nombre, v_sol.servicio_slug, 'Servicio');
  BEGIN
    v_token := public.generar_acceso_externo(
      'solicitud'::text, p_solicitud_id, p_destinatario_email,
      p_destinatario_nombre, v_dias, NULL::text
    );
    v_url := 'https://gestionglobal.ar/externo/' || v_token;
  EXCEPTION WHEN OTHERS THEN
    v_token := NULL;
    v_url   := 'https://gestionglobal.ar/externo/pendiente?solicitud=' || p_solicitud_id::text;
  END;
  v_vars := jsonb_build_object(
    'destinatario_nombre', COALESCE(p_destinatario_nombre, split_part(p_destinatario_email,'@',1)),
    'servicio',            v_servicio_nombre,
    'solicitante_nombre',  COALESCE(v_sol.solicitante_nombre, ''),
    'solicitante_email',   COALESCE(v_sol.solicitante_email, ''),
    'observaciones',       COALESCE(p_observaciones, ''),
    'acceso_url',          v_url,
    'dias_validez',        v_dias::text
  );
  BEGIN
    v_email_id := public.encolar_email(
      p_plantilla_slug, p_destinatario_email, p_destinatario_nombre,
      v_vars, NULL, NULL, 'solicitudes', p_solicitud_id, 3::smallint
    );
  EXCEPTION WHEN OTHERS THEN
    v_email_id := NULL;
  END;
  INSERT INTO public.solicitud_derivaciones (
    solicitud_id, destinatario_email, destinatario_nombre,
    plantilla_email_slug, observaciones,
    acceso_externo_token, acceso_externo_url,
    email_queue_id, creada_por
  ) VALUES (
    p_solicitud_id, p_destinatario_email, p_destinatario_nombre,
    p_plantilla_slug, p_observaciones,
    v_token, v_url, v_email_id, auth.uid()
  ) RETURNING id INTO v_der_id;
  UPDATE public.solicitudes
     SET estado = 'derivada',
         derivada_at = COALESCE(derivada_at, now()),
         asignada_a = COALESCE(asignada_a, auth.uid())
   WHERE id = p_solicitud_id;
  IF v_sol.tramite_id IS NOT NULL THEN
    v_destinatario_label := COALESCE(NULLIF(p_destinatario_nombre, ''), p_destinatario_email);
    -- Línea de seguimiento INTERNA (E-GG-123: visible_cliente=false, no filtrar el
    -- mail del gestor al cliente). Arranca con alerta de 5 días hábiles.
    INSERT INTO public.tracking_lineas (
      tramite_id, categoria, descripcion, archivos_urls,
      autor_id, visible_cliente, alerta_en
    ) VALUES (
      v_sol.tramite_id, 'tramite_enviado',
      'Envío a sector de gestoría — destinatario: ' || v_destinatario_label
        || CASE WHEN COALESCE(p_observaciones, '') <> ''
                THEN E'\n\nObservaciones: ' || p_observaciones
                ELSE '' END,
      '{}'::text[], auth.uid(), false,
      private.dias_habiles_add(now(), 5)
    );
  END IF;
  RETURN v_der_id;
END;
$function$;

-- Backfill defensivo: cerrar cualquier línea histórica de gestoría visible al cliente.
UPDATE public.tracking_lineas
   SET visible_cliente = false
 WHERE categoria = 'tramite_enviado'
   AND visible_cliente = true
   AND descripcion ILIKE '%sector de gestor%';

-- ── (3) REVOKE anon (defensa en profundidad) sobre RPC staff-only alcanzables ─
-- por anon. El front las llama SIEMPRE autenticado como staff (authenticated
-- conserva EXECUTE); ninguna superficie pública las usa.
REVOKE ALL ON FUNCTION public.cuenta_corriente_resumen_global(date, date) FROM anon, PUBLIC;
REVOKE ALL ON FUNCTION public.cuenta_corriente_resumen(uuid, date, date) FROM anon, PUBLIC;
REVOKE ALL ON FUNCTION public.tracking_cerrar(uuid, text, boolean, text, text) FROM anon, PUBLIC;
REVOKE ALL ON FUNCTION public.tracking_reabrir(uuid, text, boolean) FROM anon, PUBLIC;

-- ── (4) formulario_submissions/adjuntos: quitar INSERT directo de anon ───────
-- El alta pública pasa SIEMPRE por el edge submit-formulario (service_role), que
-- concentra validación de identidad + schema + rate-limit + safeStorageKey. El
-- INSERT directo de anon (RLS permisiva) bypassa todo eso y permitía envenenar la
-- ficha de un cliente (administracion_id arbitrario → trigger sync). El front sólo
-- LEE estas tablas (como staff). Sacamos el INSERT de anon.
REVOKE INSERT ON public.formulario_submissions FROM anon;
REVOKE INSERT ON public.formulario_adjuntos FROM anon;
