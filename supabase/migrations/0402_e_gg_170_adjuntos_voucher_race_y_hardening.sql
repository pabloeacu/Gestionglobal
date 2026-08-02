-- ============================================================================
-- 0402 · E-GG-170 (caso Rodríguez) — hardening de adjuntos de formularios
--
-- 1. Voucher race (§6 B#1c): `crear_tramite_desde_submission_auto()` hacía
--    SELECT del voucher y, si NO lo encontraba (agotado/vencido entre el
--    pre-check del edge y el INSERT), seguía EN SILENCIO sin descuento →
--    solicitud a precio completo Y sin comprobante (el edge ya había salteado
--    el required del file por voucherEs100). Ahora: si viene _voucher_codigo
--    y el voucher no está disponible → RAISE EXCEPTION. El edge v13 devuelve
--    el error al usuario y limpia Storage (la submission no nace).
-- 2. Policy `form_adj_insert` (§6 B#2c): permitía INSERT en el bucket
--    form-adjuntos a anon+authenticated con solo el check del bucket —
--    cualquiera con la anon key podía plantar archivos en cualquier path.
--    El ÚNICO escritor legítimo es el edge submit-formulario (service_role,
--    bypassa RLS) → la policy se elimina. Verificado: ninguna superficie del
--    front inserta en ese bucket (solo SELECT staff vía signed URLs).
-- 3. Bucket `pedidos-doc-cliente` (barrido C#3): sin límite de tamaño ni
--    whitelist — un cliente podía subir cualquier cosa de cualquier tamaño.
--    Se alinea al estándar: 20 MB + whitelist amplia (docs e imágenes,
--    incluye HEIC como pagos-reportados). El front espeja estos límites.
--
-- Regla 18: smoke e2e obligatorio (se ejercita el trigger con INSERT
-- sintético + voucher agotado → excepción esperada; ver cierre del chunk).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Trigger: voucher no disponible → excepción (no silencio)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.crear_tramite_desde_submission_auto()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_form record; v_apellido text; v_nombre text; v_nombre_completo text; v_origen_canal text;
  v_voucher_codigo text; v_voucher record; v_servicio record; v_precio_apl numeric; v_precio_fin numeric;
  v_voucher_id uuid; v_voucher_pct numeric; v_es_cliente boolean; v_solicitud_id uuid; v_staff record;
BEGIN
  SELECT id, slug, titulo, categoria, servicio_id INTO v_form FROM public.formularios WHERE id = NEW.formulario_id;
  IF v_form.categoria = 'evento' THEN RETURN NEW; END IF;
  v_apellido := NULLIF(trim(COALESCE(NEW.datos->>'apellido', '')), '');
  v_nombre   := NULLIF(trim(COALESCE(NEW.datos->>'nombre', '')), '');
  v_nombre_completo := COALESCE(NEW.nombre_contacto, NULLIF(trim(concat_ws(' ', v_apellido, v_nombre)), ''), NEW.email_contacto, 'sin contacto');
  v_origen_canal := COALESCE(NULLIF(trim(NEW.datos->>'_origen_canal'), ''), 'publico');
  IF v_origen_canal NOT IN ('publico','cliente') THEN v_origen_canal := 'publico'; END IF;
  -- E-GG-134: canal 'cliente' sólo con identidad verificada (administracion_id ligada por JWT admin)
  IF NEW.administracion_id IS NULL THEN v_origen_canal := 'publico'; END IF;
  v_es_cliente := (v_origen_canal = 'cliente');
  IF v_form.servicio_id IS NOT NULL THEN
    SELECT id, precio_publico, precio_cliente INTO v_servicio FROM public.servicios WHERE id = v_form.servicio_id;
    IF v_origen_canal = 'cliente' THEN v_precio_apl := v_servicio.precio_cliente; ELSE v_precio_apl := v_servicio.precio_publico; END IF;
  END IF;
  v_precio_fin := v_precio_apl;
  v_voucher_codigo := NULLIF(trim(NEW.datos->>'_voucher_codigo'), '');
  IF v_voucher_codigo IS NOT NULL AND v_form.servicio_id IS NOT NULL THEN
    SELECT * INTO v_voucher FROM public.servicio_vouchers vv
     WHERE vv.servicio_id = v_form.servicio_id AND lower(vv.codigo) = lower(v_voucher_codigo) AND vv.activo
       AND (vv.expira_at IS NULL OR vv.expira_at > NOW()) AND (vv.max_usos IS NULL OR vv.usos_count < vv.max_usos)
       AND (vv.alcance = 'ambos' OR (vv.alcance = 'publico' AND NOT v_es_cliente) OR (vv.alcance = 'cliente' AND v_es_cliente)) LIMIT 1;
    IF FOUND THEN
      v_voucher_id := v_voucher.id; v_voucher_pct := v_voucher.descuento_pct;
      IF v_precio_apl IS NOT NULL THEN v_precio_fin := ROUND(v_precio_apl * (1 - v_voucher_pct / 100), 2); END IF;
      UPDATE public.servicio_vouchers SET usos_count = usos_count + 1, updated_at = NOW() WHERE id = v_voucher.id;
    ELSE
      -- E-GG-170 §6 B#1c: antes seguía en silencio sin descuento → solicitud
      -- a precio completo y (con voucher 100%) sin comprobante adjunto. La
      -- validación autoritaria es ESTA — el pre-check del edge puede quedar
      -- viejo si el último uso se consumió en el medio (race) o si el payload
      -- viene crafteado. Abortar deja al edge devolver un error claro y
      -- limpiar Storage; la submission no nace.
      RAISE EXCEPTION 'El voucher «%» ya no está disponible (agotado, vencido o inválido). Reintentá sin el voucher o con otro código.', v_voucher_codigo;
    END IF;
  END IF;
  INSERT INTO public.solicitudes (
    formulario_submission_id, servicio_solicitado_id, solicitante_nombre, solicitante_email, solicitante_telefono,
    servicio_slug, estado, cliente_id, origen_canal, precio_aplicado, precio_final, voucher_id, voucher_codigo, voucher_descuento_pct
  ) VALUES (
    NEW.id, v_form.servicio_id, v_nombre_completo, NEW.email_contacto, NEW.telefono_contacto,
    v_form.slug, 'recibida', NEW.administracion_id, v_origen_canal, v_precio_apl, v_precio_fin, v_voucher_id, v_voucher_codigo, v_voucher_pct
  ) RETURNING id INTO v_solicitud_id;
  IF NEW.email_contacto IS NOT NULL AND length(trim(NEW.email_contacto)) > 0 THEN
    BEGIN
      INSERT INTO public.email_queue (kind, template_slug, to_email, to_nombre, variables, prioridad, intento, max_intentos, programado_para, administracion_id, related_table, related_id)
      VALUES ('workflow', 'formulario-submission-recibido', NEW.email_contacto, v_nombre_completo,
        jsonb_build_object('nombre', COALESCE(v_nombre, v_nombre_completo)), 2, 0, 3, now(), NEW.administracion_id, 'solicitudes', v_solicitud_id);
    EXCEPTION WHEN OTHERS THEN RAISE WARNING 'No se pudo encolar acuse al solicitante: %', SQLERRM; END;
  END IF;
  FOR v_staff IN SELECT u.id, u.email FROM auth.users u JOIN public.profiles p ON p.id = u.id
     WHERE p.role IN ('gerente','operador') AND COALESCE(p.activo, true) = true AND u.email IS NOT NULL AND length(trim(u.email)) > 0
  LOOP
    BEGIN
      INSERT INTO public.email_queue (kind, template_slug, to_email, to_nombre, variables, prioridad, intento, max_intentos, programado_para, related_table, related_id)
      VALUES ('workflow', 'solicitud-nueva-gerencia', v_staff.email, NULL,
        jsonb_build_object('formulario_titulo', v_form.titulo, 'solicitante_nombre', v_nombre_completo,
          'solicitante_email', COALESCE(NEW.email_contacto, '—'), 'solicitante_telefono', COALESCE(NEW.telefono_contacto, '—'),
          'solicitud_url', '/gerencia/solicitudes/' || v_solicitud_id::text), 3, 0, 3, now(), 'solicitudes', v_solicitud_id);
    EXCEPTION WHEN OTHERS THEN RAISE WARNING 'No se pudo encolar aviso a gerencia (%): %', v_staff.email, SQLERRM; END;
  END LOOP;
  RETURN NEW;
END;
$function$;

-- ----------------------------------------------------------------------------
-- 2. form-adjuntos: fuera el INSERT anónimo (el edge escribe con service_role)
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS form_adj_insert ON storage.objects;

-- ----------------------------------------------------------------------------
-- 3. pedidos-doc-cliente: límites de tamaño y tipos (antes: sin ninguno)
-- ----------------------------------------------------------------------------
UPDATE storage.buckets
   SET file_size_limit = 20971520, -- 20 MB
       allowed_mime_types = ARRAY[
         'image/jpeg','image/png','image/webp','image/heic',
         'application/pdf',
         'application/msword',
         'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
         'application/vnd.ms-excel',
         'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
       ]
 WHERE id = 'pedidos-doc-cliente';
