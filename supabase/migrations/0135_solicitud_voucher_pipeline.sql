-- ============================================================================
-- Migration: 0135_solicitud_voucher_pipeline
-- Fecha: 2026-05-29
-- DGG-XX · Cierra la cadena del voucher en el pipeline de submission →
-- solicitud. El trigger `crear_tramite_desde_submission_auto` (mig 0035)
-- ahora también:
--   1. Lee `_origen_canal` y `_voucher_codigo` desde NEW.datos (los inyecta
--      el edge function `submit-formulario` cuando vienen en el payload).
--   2. Si el formulario tiene servicio_id, calcula precio_aplicado =
--      precio_publico (si origen=publico) o precio_cliente (si =cliente).
--   3. Si hay voucher_codigo: lo valida con la misma lógica que voucher_validar.
--      Si es válido: guarda voucher_id, codigo y descuento_pct, calcula
--      precio_final = precio_aplicado * (1 - desc/100), e incrementa el
--      contador de usos. Si no es válido: deja precio_final = precio_aplicado
--      (la gerencia ve el código intentado en datos pero no se aplica).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.crear_tramite_desde_submission_auto()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
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
BEGIN
  SELECT id, slug, titulo, categoria, servicio_id
    INTO v_form
    FROM public.formularios
   WHERE id = NEW.formulario_id;

  IF v_form.categoria NOT IN ('tramite','servicio','consulta') THEN
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

  -- Origen del canal (publico|cliente). Default: publico (landing).
  v_origen_canal := COALESCE(
    NULLIF(trim(NEW.datos->>'_origen_canal'), ''),
    'publico'
  );
  IF v_origen_canal NOT IN ('publico','cliente') THEN
    v_origen_canal := 'publico';
  END IF;
  v_es_cliente := (v_origen_canal = 'cliente');

  -- Precio aplicado · sólo si el formulario tiene servicio asociado.
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

  -- Voucher · si vino código y hay servicio, validar.
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
      -- Incrementar el contador de uso (idempotente sólo a nivel del registro).
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
  );

  RETURN NEW;
END;
$fn$;

COMMENT ON FUNCTION public.crear_tramite_desde_submission_auto() IS
  '0135 (extiende 0035): además del alta de la solicitud, procesa origen_canal, '
  'precio_aplicado (público/cliente), voucher_codigo (valida + aplica descuento + '
  'incrementa contador), y precio_final. El edge function `submit-formulario` '
  'inyecta _origen_canal y _voucher_codigo en datos cuando corresponde.';
