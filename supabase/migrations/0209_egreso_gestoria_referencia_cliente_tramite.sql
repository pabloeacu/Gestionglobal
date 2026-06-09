-- 0209 · F2 (Lista JL) · Referencia del egreso a gestoría: cliente · trámite
--
-- JL: el movimiento de egreso a gestoría (origen='derivacion_gestoria') sólo
-- mostraba la gestoría + un id opaco de la solicitud → en Cajas/Movimientos no
-- se sabía a qué CLIENTE ni a qué TRÁMITE correspondía el pago. Además el
-- administracion_id quedaba NULL si se derivaba antes de vincular el cliente.
--
-- Fix: helper compartido `private.egreso_gestoria_ref` que arma una descripción
-- CLARA y NO REITERATIVA (Pablo: un mismo cliente puede pedir el mismo trámite
-- más de una vez en el tiempo). El distinguidor único es el código TRM-XXXX del
-- trámite (o, si todavía no hay trámite, la solicitud corta). Formato:
--   Egreso gestoría · <Cliente> · <TRM-XXXX — Detalle> · <Gestoría>
--   referencia: SOL:<uuid> [· TRM:<codigo>]
-- `solicitud_derivar_v3` (misma firma → R16 ok) usa el helper; backfill del
-- egreso histórico; smoke al cierre (R18).

-- ---------------------------------------------------------------------------
-- 1 · Helper compartido (DRY entre la RPC y el backfill).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.egreso_gestoria_ref(
  p_solicitud_id uuid,
  p_gestoria     text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_cliente_id    uuid;
  v_tramite_id    uuid;
  v_solicitante   text;
  v_servicio_slug text;
  v_servicio_id   uuid;
  v_cliente       text;
  v_tram_codigo   text;
  v_servicio      text;
  v_tram_ref      text;
  v_gestoria      text;
BEGIN
  SELECT s.cliente_id, s.tramite_id, s.solicitante_nombre,
         s.servicio_slug, s.servicio_solicitado_id
    INTO v_cliente_id, v_tramite_id, v_solicitante, v_servicio_slug, v_servicio_id
    FROM public.solicitudes s
   WHERE s.id = p_solicitud_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- Cliente: nombre de la administración vinculada; si todavía no hay, el
  -- nombre del solicitante (la administración futura).
  v_cliente := COALESCE(
    (SELECT nombre FROM public.administraciones WHERE id = v_cliente_id),
    NULLIF(trim(v_solicitante), ''),
    'Cliente sin identificar'
  );

  -- Trámite: código TRM-XXXX (si la solicitud ya tiene trámite).
  IF v_tramite_id IS NOT NULL THEN
    SELECT t.codigo INTO v_tram_codigo
      FROM public.tramites t WHERE t.id = v_tramite_id;
  END IF;

  -- Servicio LIMPIO (sin el cliente embebido, como sí lo trae el título del
  -- trámite "<servicio> · <cliente>") → evita REITERAR el nombre del cliente.
  v_servicio := COALESCE(
    (SELECT nombre FROM public.servicios WHERE id = v_servicio_id),
    NULLIF(v_servicio_slug, ''),
    'Servicio'
  );

  -- Distinguidor ÚNICO: el código del trámite (no se reitera). Si aún no hay
  -- trámite, la solicitud corta (también única por derivación).
  v_tram_ref := COALESCE(v_tram_codigo, 'Sol. ' || upper(left(p_solicitud_id::text, 8)));
  v_gestoria := COALESCE(NULLIF(trim(p_gestoria), ''), 'gestoría');

  RETURN jsonb_build_object(
    'descripcion',
      'Egreso gestoría · ' || v_cliente
        || ' · ' || v_tram_ref || ' — ' || v_servicio
        || ' · ' || v_gestoria,
    'referencia',
      'SOL:' || p_solicitud_id::text
        || COALESCE(' · TRM:' || v_tram_codigo, ''),
    'admin_id', v_cliente_id
  );
END;
$function$;

-- Least-privilege (§6 F2 · Agente B): el helper SÓLO lo invoca solicitud_derivar_v3
-- (SECURITY DEFINER → corre como owner) y el backfill/smoke (también owner). Ningún
-- contexto `authenticated` lo llama directo, y `private` no se expone por PostgREST.
-- Revocamos el EXECUTE default-a-PUBLIC para cerrar el IDOR latente (defense-in-depth).
REVOKE EXECUTE ON FUNCTION private.egreso_gestoria_ref(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION private.egreso_gestoria_ref(uuid, text) FROM authenticated;

-- ---------------------------------------------------------------------------
-- 2 · solicitud_derivar_v3 usa el helper para la descripción/referencia del
--     egreso (misma firma → CREATE OR REPLACE, R16 ok).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.solicitud_derivar_v3(
  p_solicitud_id uuid,
  p_destinatario_email text,
  p_destinatario_nombre text,
  p_plantilla_slug text DEFAULT 'solicitud-derivada-gestoria'::text,
  p_observaciones text DEFAULT NULL::text,
  p_dias_validez integer DEFAULT 7,
  p_monto_pago numeric DEFAULT NULL::numeric,
  p_adjuntos jsonb DEFAULT '[]'::jsonb,
  p_caja_id uuid DEFAULT NULL::uuid,
  p_categoria_id uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_derivacion_id  uuid;
  v_movimiento_id  uuid;
  v_categoria_id   uuid := p_categoria_id;
  v_admin_id       uuid;
  v_descripcion    text;
  v_referencia     text;
  v_ref_obj        jsonb;
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'solo_staff_puede_derivar' USING ERRCODE = '42501';
  END IF;
  IF p_destinatario_email IS NULL OR length(trim(p_destinatario_email)) = 0 THEN
    RAISE EXCEPTION 'destinatario_email_requerido' USING ERRCODE = '23502';
  END IF;

  SELECT public.solicitud_derivar_v2(
    p_solicitud_id, p_destinatario_email, p_destinatario_nombre,
    p_plantilla_slug, p_observaciones, p_dias_validez,
    p_monto_pago, p_adjuntos
  ) INTO v_derivacion_id;

  IF p_monto_pago IS NOT NULL AND p_monto_pago > 0 AND p_caja_id IS NOT NULL THEN
    -- DGG-43 v2 · default a la categoría EXISTENTE "Servicios de Gestoría".
    IF v_categoria_id IS NULL THEN
      SELECT id INTO v_categoria_id FROM public.categorias_finanzas
       WHERE nombre = 'Servicios de Gestoría' AND tipo = 'egreso' AND activo
       LIMIT 1;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.cajas WHERE id = p_caja_id AND activo) THEN
      RAISE EXCEPTION 'caja_inexistente_o_inactiva' USING ERRCODE = 'P0002';
    END IF;

    SELECT s.cliente_id INTO v_admin_id
      FROM public.solicitudes s WHERE s.id = p_solicitud_id;

    -- F2 · referencia clara con cliente + trámite (única vía TRM-XXXX).
    v_ref_obj := private.egreso_gestoria_ref(
      p_solicitud_id,
      COALESCE(NULLIF(trim(p_destinatario_nombre), ''), p_destinatario_email)
    );
    v_descripcion := v_ref_obj->>'descripcion';
    v_referencia  := v_ref_obj->>'referencia';

    INSERT INTO public.movimientos (
      caja_id, fecha, tipo, monto, descripcion, referencia,
      administracion_id, estado, origen, categoria_id, created_by
    ) VALUES (
      p_caja_id, CURRENT_DATE, 'egreso', p_monto_pago, v_descripcion,
      v_referencia, v_admin_id, 'identificado', 'derivacion_gestoria',
      v_categoria_id, auth.uid()
    )
    RETURNING id INTO v_movimiento_id;

    UPDATE public.solicitud_derivaciones
       SET caja_id               = p_caja_id,
           categoria_finanzas_id = v_categoria_id,
           movimiento_id         = v_movimiento_id
     WHERE id = v_derivacion_id;
  END IF;

  RETURN jsonb_build_object(
    'derivacion_id', v_derivacion_id,
    'movimiento_id', v_movimiento_id,
    'tiene_egreso',  v_movimiento_id IS NOT NULL
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- 3 · Backfill: egresos a gestoría existentes → descripción/referencia nuevas
--     + administracion_id resuelto (si quedó NULL al derivar antes del cliente).
-- ---------------------------------------------------------------------------
WITH eg AS (
  SELECT m.id AS mov_id,
         private.egreso_gestoria_ref(
           sd.solicitud_id,
           COALESCE(NULLIF(trim(sd.destinatario_nombre), ''), sd.destinatario_email)
         ) AS ref
    FROM public.movimientos m
    JOIN public.solicitud_derivaciones sd ON sd.movimiento_id = m.id
   WHERE m.origen = 'derivacion_gestoria'
)
UPDATE public.movimientos m
   SET descripcion       = eg.ref->>'descripcion',
       referencia        = eg.ref->>'referencia',
       administracion_id = COALESCE(m.administracion_id, NULLIF(eg.ref->>'admin_id','')::uuid)
  FROM eg
 WHERE m.id = eg.mov_id AND eg.ref IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 4 · Smoke (R18): el helper no referencia columnas inexistentes y arma la
--     descripción esperada sobre una solicitud real (si existe alguna).
-- ---------------------------------------------------------------------------
DO $smoke$
DECLARE
  v_sol uuid;
  v_desc text;
BEGIN
  SELECT id INTO v_sol FROM public.solicitudes ORDER BY created_at DESC LIMIT 1;
  IF v_sol IS NOT NULL THEN
    v_desc := private.egreso_gestoria_ref(v_sol, 'Gestoría QA')->>'descripcion';
    IF v_desc IS NULL OR v_desc NOT LIKE 'Egreso gestoría · %' THEN
      RAISE EXCEPTION 'smoke F2: descripción inesperada: %', v_desc;
    END IF;
    RAISE NOTICE 'smoke F2 OK · %', v_desc;
  END IF;
END;
$smoke$;
