-- 0351 · WAVE 7 · E-GG-130..134: fix de 5 bugs del circuito de CONTRATACIÓN
-- descubiertos por el barrido e2e exhaustivo (workflow 46 agentes) de la matriz
-- servicios×canales×cliente×pago×doc×gestoría×estados. Todos ejercitados e2e.

-- ── E-GG-130 (línea semilla del tracking nace muerta) + E-GG-133 (email a cliente
--    nuevo) : solicitud_activar ──────────────────────────────────────────────
-- (130) El seed de la línea inicial usaba `EXECUTE 'SELECT tracking_agregar_linea
-- ($1..$5)'` con una firma OBSOLETA de 5 args → 42883 tragado por `EXCEPTION WHEN
-- OTHERS THEN NULL` → el timeline visible del cliente NACÍA VACÍO en el 100% de las
-- activaciones (anti-patrón R16/R18). Fix: PERFORM con la firma real (7 args) +
-- categoría válida 'seguimiento_interno' + visible_cliente=true (el cliente ve
-- "Trámite iniciado") + WARNING en vez de NULL silencioso.
-- (133) El email 'nuevo-servicio-activado' NO se encolaba para el cliente creado
-- en la misma activación (gate `AND NOT v_es_nuevo`) — justo el caso más común
-- (landing → cliente nuevo). Fix: quitar la exclusión; el email del admin nuevo ya
-- viene en v_email_admin (INSERT ... RETURNING email).
CREATE OR REPLACE FUNCTION public.solicitud_activar(p_solicitud_id uuid, p_cliente_id uuid DEFAULT NULL::uuid, p_crear_cliente_input jsonb DEFAULT NULL::jsonb, p_periodo text DEFAULT NULL::text, p_fecha_inicio date DEFAULT NULL::date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_sol public.solicitudes%ROWTYPE;
  v_cliente uuid;
  v_servicio public.servicios%ROWTYPE;
  v_tramite_id uuid;
  v_categoria text;
  v_titulo text;
  v_parent_tramite uuid;
  v_email_admin text;
  v_admin_nombre text;
  v_es_nuevo boolean := false;
  v_new_email text;
  v_new_cuit  text;
  v_dup_id uuid;
  v_dup_nombre text;
BEGIN
  IF NOT private.is_staff() THEN RAISE EXCEPTION 'Solo staff' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_sol FROM public.solicitudes WHERE id = p_solicitud_id;
  IF v_sol.id IS NULL THEN RAISE EXCEPTION 'Solicitud no encontrada' USING ERRCODE = 'P0002'; END IF;
  IF v_sol.estado = 'activada' THEN RAISE EXCEPTION 'La solicitud ya está activada' USING ERRCODE = '22023'; END IF;

  IF p_cliente_id IS NOT NULL THEN
    v_cliente := p_cliente_id;
    SELECT email, nombre INTO v_email_admin, v_admin_nombre FROM public.administraciones WHERE id = v_cliente;
  ELSIF p_crear_cliente_input IS NOT NULL THEN
    v_es_nuevo := true;

    v_new_email := lower(btrim(COALESCE(NULLIF(p_crear_cliente_input->>'email',''), v_sol.solicitante_email, '')));
    v_new_cuit  := regexp_replace(COALESCE(p_crear_cliente_input->>'cuit',''), '[^0-9]', '', 'g');
    v_dup_id := NULL;
    IF v_new_email <> '' THEN
      SELECT id, nombre INTO v_dup_id, v_dup_nombre
        FROM public.administraciones
       WHERE activo AND email IS NOT NULL AND lower(email) = v_new_email
       LIMIT 1;
    END IF;
    IF v_dup_id IS NULL AND length(v_new_cuit) >= 8 THEN
      SELECT id, nombre INTO v_dup_id, v_dup_nombre
        FROM public.administraciones
       WHERE activo AND cuit IS NOT NULL AND regexp_replace(cuit, '[^0-9]', '', 'g') = v_new_cuit
       LIMIT 1;
    END IF;
    IF v_dup_id IS NOT NULL THEN
      RAISE EXCEPTION 'Ya existe el cliente "%" con ese email o CUIT. Vinculá la solicitud a ese cliente existente en vez de crear uno nuevo (así evitás duplicar el cliente y que el portal no muestre sus trámites).', v_dup_nombre
        USING ERRCODE = '23505';
    END IF;

    INSERT INTO public.administraciones (
      codigo, nombre, nombre_normalizado, cuit, email, telefono, direccion,
      localidad, provincia, codigo_postal, condicion_iva, domicilio_fiscal, observaciones, estado, activo
    ) VALUES (
      COALESCE(p_crear_cliente_input->>'codigo', 'AUTO-' || substring(p_solicitud_id::text,1,8)),
      COALESCE(p_crear_cliente_input->>'nombre', v_sol.solicitante_nombre, 'Cliente sin nombre'),
      '',
      NULLIF(p_crear_cliente_input->>'cuit',''),
      COALESCE(NULLIF(p_crear_cliente_input->>'email',''), v_sol.solicitante_email),
      COALESCE(NULLIF(p_crear_cliente_input->>'telefono',''), v_sol.solicitante_telefono),
      NULLIF(p_crear_cliente_input->>'direccion',''), NULLIF(p_crear_cliente_input->>'localidad',''),
      NULLIF(p_crear_cliente_input->>'provincia',''), NULLIF(p_crear_cliente_input->>'codigo_postal',''),
      NULLIF(p_crear_cliente_input->>'condicion_iva',''), NULLIF(p_crear_cliente_input->>'domicilio_fiscal',''),
      NULLIF(p_crear_cliente_input->>'observaciones',''), 'activo', true
    ) RETURNING id, email, nombre INTO v_cliente, v_email_admin, v_admin_nombre;
  ELSE
    v_cliente := v_sol.cliente_id;
  END IF;

  IF v_sol.servicio_solicitado_id IS NOT NULL THEN
    SELECT * INTO v_servicio FROM public.servicios WHERE id = v_sol.servicio_solicitado_id;
  END IF;

  v_categoria := CASE COALESCE(v_sol.servicio_slug,'')
    WHEN 'matriculacion-rpac' THEN 'matricula' WHEN 'renovacion-rpac' THEN 'renovacion'
    WHEN 'certificado-rpac' THEN 'matricula' WHEN 'ddjj-anual' THEN 'dj'
    WHEN 'consultoria-juridica' THEN 'consulta_juridica' WHEN 'curso-formacion' THEN 'curso'
    WHEN 'curso-actualizacion' THEN 'curso' ELSE 'otro'
  END;

  v_titulo := COALESCE(v_servicio.nombre, v_sol.servicio_slug, 'Servicio')
    || ' · ' || COALESCE(v_sol.solicitante_nombre, v_admin_nombre, v_sol.solicitante_email, 'sin contacto');

  IF v_cliente IS NOT NULL AND v_sol.servicio_solicitado_id IS NOT NULL THEN
    SELECT t.id INTO v_parent_tramite FROM public.tramites t
     WHERE t.administracion_id = v_cliente AND t.categoria = v_categoria
     ORDER BY t.created_at DESC LIMIT 1;
  END IF;

  INSERT INTO public.tramites (
    titulo, descripcion, categoria, prioridad, estado,
    formulario_submission_id, administracion_id,
    solicitante_nombre, solicitante_email, solicitante_telefono,
    servicio_id, periodo, fecha_inicio, parent_tracking_id, created_by
  ) VALUES (
    v_titulo,
    'Tracking activado desde solicitud ' || p_solicitud_id::text
      || COALESCE(' · período ' || p_periodo, '') || COALESCE(' · inicio ' || p_fecha_inicio::text, '')
      || COALESCE(' · continuación de ' || v_parent_tramite::text, ''),
    v_categoria, 'normal', 'abierto',
    v_sol.formulario_submission_id, v_cliente,
    v_sol.solicitante_nombre, v_sol.solicitante_email, v_sol.solicitante_telefono,
    v_sol.servicio_solicitado_id, p_periodo, p_fecha_inicio, v_parent_tramite, auth.uid()
  ) RETURNING id INTO v_tramite_id;

  -- E-GG-130: línea semilla del tracking con la FIRMA REAL (7 args) + categoría
  -- válida + visible al cliente. Antes era una llamada muerta (5 args) tragada.
  BEGIN
    PERFORM public.tracking_agregar_linea(
      v_tramite_id,
      'seguimiento_interno',
      'Trámite iniciado desde tu solicitud. Vamos a ir cargando acá cada avance.'
        || COALESCE(' · Período ' || p_periodo, '')
        || COALESCE(' · Inicio ' || p_fecha_inicio::text, ''),
      NULL, '{}'::text[], NULL, true);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'seed tracking_linea al activar falló: %', SQLERRM;
  END;

  IF v_sol.formulario_submission_id IS NOT NULL THEN
    UPDATE public.formulario_submissions SET estado = 'procesado', procesado_at = now(), procesado_por = auth.uid()
     WHERE id = v_sol.formulario_submission_id AND estado <> 'procesado';
  END IF;

  -- E-GG-133: encolar el email de activación TAMBIÉN al cliente nuevo (se quitó
  -- la exclusión NOT v_es_nuevo). El email del admin nuevo viene en v_email_admin.
  IF v_cliente IS NOT NULL AND v_email_admin IS NOT NULL AND v_email_admin <> '' THEN
    BEGIN
      PERFORM public.encolar_email('nuevo-servicio-activado', v_email_admin, v_admin_nombre,
        jsonb_build_object('nombre', v_admin_nombre,
          'servicio', COALESCE(v_servicio.nombre, v_sol.servicio_slug, 'Servicio'),
          'link_portal', 'https://gestionglobal.ar/portal'),
        v_cliente, NULL, 'tramites', v_tramite_id, 3::smallint);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'encolar email nuevo-servicio-activado falló: %', SQLERRM;
    END;
  END IF;

  UPDATE public.solicitudes
     SET estado = 'activada', tramite_id = v_tramite_id, cliente_id = v_cliente,
         activada_at = now(), asignada_a = COALESCE(asignada_a, auth.uid())
   WHERE id = p_solicitud_id;

  RETURN v_tramite_id;
END;
$function$;

-- ── E-GG-131: UNIQUE(nombre) rompe activar un cliente HOMÓNIMO ──────────────────
-- El nombre de una administración NO es clave natural (dos "Juan Pérez" / "Consorcio
-- San Martín" son legítimos y distintos). El dedup real es por email/CUIT (ya en
-- solicitud_activar). El UNIQUE(nombre) hacía fallar la activación del 2º homónimo
-- con 23505 CRUDO. Se dropea el unique y se reemplaza por índice NO único (búsqueda).
ALTER TABLE public.administraciones DROP CONSTRAINT IF EXISTS uq_administraciones_nombre;
CREATE INDEX IF NOT EXISTS idx_administraciones_nombre ON public.administraciones (nombre);

-- ── E-GG-132: cierre de trámite ARANCELADO con CERO facturación (hueco contable) ─
-- tramite_cerrar_exige_cobrado sólo bloqueaba si había un comprobante IMPAGO. Si
-- nunca se emitió comprobante, EXISTS=false y el cierre pasaba → ingreso arancelado
-- que nunca se registra, sin alarma. Fix: además, si el SERVICIO es arancelado
-- (precio>0) y NO hay ningún comprobante no-anulado con total>0 ligado, bloquear el
-- cierre con mensaje accionable. Trámites sin servicio o de servicio gratuito pasan
-- (no se rompe el cierre legítimo). La cancelación (estado<>'cerrado') no se afecta.
CREATE OR REPLACE FUNCTION public.tramite_cerrar_exige_cobrado()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.estado = 'cerrado' AND OLD.estado IS DISTINCT FROM 'cerrado' THEN
    -- (a) comprobante impago (comportamiento previo)
    IF public.cobro_pendiente(NEW) THEN
      IF public.cobro_estado(NEW) = 'parcial' THEN
        RAISE EXCEPTION 'No se puede cerrar: el trámite tiene un pago a cuenta y queda saldo pendiente. Completá la cobranza (o anulá/bonificá el comprobante) antes de cerrar.'
          USING ERRCODE = 'check_violation';
      ELSE
        RAISE EXCEPTION 'No se puede cerrar: el trámite no tiene ninguna cobranza registrada (está impago). Registrá la cobranza (o anulá/bonificá el comprobante) antes de cerrar.'
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    -- (b) E-GG-132: servicio arancelado sin NINGÚN comprobante emitido
    IF EXISTS (
         SELECT 1 FROM public.servicios sv WHERE sv.id = NEW.servicio_id
           AND GREATEST(COALESCE(sv.precio_publico,0), COALESCE(sv.precio_cliente,0), COALESCE(sv.precio_base,0)) > 0
       )
       AND NOT EXISTS (
         SELECT 1 FROM public.comprobantes c
          WHERE c.estado <> 'anulado' AND COALESCE(c.total,0) > 0
            AND (
              c.id = NEW.comprobante_id
              OR c.id IN (SELECT s.comprobante_id FROM public.solicitudes s
                          WHERE s.tramite_id = NEW.id AND s.comprobante_id IS NOT NULL)
            )
       )
    THEN
      RAISE EXCEPTION 'No se puede cerrar: es un servicio arancelado y no se emitió ningún comprobante. Emití y cobrá el comprobante (o emití uno bonificado), o cancelá el trámite, antes de cerrar.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- ── E-GG-134: precio/canal derivado de flag NO autenticado del body ─────────────
-- crear_tramite_desde_submission_auto tomaba el canal (y por ende precio_cliente vs
-- precio_publico) de NEW.datos->>'_origen_canal', un flag del body que un actor
-- público puede inyectar. Fix: el canal 'cliente' sólo vale si hay identidad
-- verificada (NEW.administracion_id ligada por el edge con JWT admin). Sin admin →
-- forzar 'publico'/precio_publico ignorando el flag.
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
  -- E-GG-134: el canal 'cliente' (y el precio_cliente) requiere identidad verificada.
  -- Un submit sin administracion_id (no ligado por JWT admin) es SIEMPRE público,
  -- aunque el body traiga _origen_canal='cliente'.
  IF NEW.administracion_id IS NULL THEN v_origen_canal := 'publico'; END IF;
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
