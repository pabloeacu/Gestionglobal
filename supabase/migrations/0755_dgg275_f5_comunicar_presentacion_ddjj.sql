-- 0755 · DGG-275 F5 (wiring) · Botón de gerencia "Comunicar al cliente"
-- ----------------------------------------------------------------------------
-- RPC que envía el mail premium `ddjj-presentacion-realizada` (mig 0754) al
-- cliente con el resumen escalar de la presentación. Disparo: botón explícito
-- de gerencia en el detalle del trámite (decisión de Pablo). GATEADO por el flag
-- config_global.ddjj_avisos_habilitados (F6, hoy OFF): mientras esté OFF, el RPC
-- rechaza con un mensaje claro y no envía nada.
--
-- Incluye los fixes de la auditoría §6 adversarial del wiring:
--   · #1 advisory xact lock por trámite → serializa clicks concurrentes de 2
--     gerentes (email_queue no tiene índice único) → evita el doble mail (race TOCTOU).
--   · #3 la idempotencia devuelve {enviado:false, ya_comunicado:true} en vez de
--     RAISE → el front ofrece el reenvío por un flag estructurado, no por matchear
--     el texto del error (acople frágil).
--   · #4 fallback del período (año actual) → evita "período  " vacío en el mail.
--   · #5 (helper 0754) NC-aware: el resumen excluye notas de crédito (NC_%) →
--     consistencia con el canon contable si un futuro path linkeara una NC por tramite_id.
--
-- Staff-only (is_staff; no alcanzable por rol 'administrador' → sin assert_administracion_access).
-- Registra una línea INTERNA (el mail es la comunicación; una línea visible dispararía
-- un 2º mail vía tracking-recordatorio). R5/R6/R12/R16/R17/R18.

-- ── Helper 0754 · NC-aware (audit #5) ──
CREATE OR REPLACE FUNCTION public.tramite_ddjj_resumen_comprobantes(p_tramite_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  WITH comps AS (
    SELECT c.id, c.total
    FROM public.comprobantes c
    WHERE c.estado <> 'anulado'
      AND c.tipo NOT LIKE 'NC\_%'   -- excluye notas de crédito (canon contable 0702)
      AND (
        c.tramite_id = p_tramite_id
        OR c.id = (SELECT t.comprobante_id FROM public.tramites t WHERE t.id = p_tramite_id)
      )
  ), agg AS (
    SELECT count(*)::int AS cantidad, coalesce(sum(total), 0)::numeric(14,2) AS importe_total
    FROM comps
  )
  SELECT jsonb_build_object(
    'cantidad', cantidad,
    'importe_total', importe_total,
    'importe_total_fmt',
      '$'
      || regexp_replace(to_char(floor(importe_total)::numeric, 'FM999,999,999,990'), ',', '.', 'g')
      || ','
      || lpad((round((importe_total - floor(importe_total)) * 100))::int::text, 2, '0')
  )
  FROM agg;
$$;

-- ── RPC "Comunicar al cliente" ──
CREATE OR REPLACE FUNCTION public.tramite_ddjj_comunicar_presentacion(
  p_tramite_id uuid,
  p_forzar boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_habilitado boolean;
  v_admin uuid; v_categoria text; v_periodo text; v_serv_codigo text;
  v_email text; v_nombre text;
  v_resumen jsonb; v_cantidad int;
BEGIN
  IF NOT private.is_staff() THEN RAISE EXCEPTION 'Solo gerencia' USING ERRCODE = '42501'; END IF;

  -- #1 · serializa clicks concurrentes para el mismo trámite (anti doble envío).
  PERFORM pg_advisory_xact_lock(hashtextextended(p_tramite_id::text, 0));

  -- Gate: flag maestro de avisos DDJJ al cliente (F6).
  SELECT ddjj_avisos_habilitados INTO v_habilitado FROM public.config_global WHERE id = 1;
  IF NOT COALESCE(v_habilitado, false) THEN
    RAISE EXCEPTION 'Los avisos de DDJJ al cliente están desactivados. Activalos en configuración para poder comunicar la presentación.'
      USING ERRCODE = '22023';
  END IF;

  SELECT t.administracion_id, t.categoria, t.periodo, s.codigo
    INTO v_admin, v_categoria, v_periodo, v_serv_codigo
    FROM public.tramites t
    LEFT JOIN public.servicios s ON s.id = t.servicio_id
   WHERE t.id = p_tramite_id;

  IF v_admin IS NULL THEN
    RAISE EXCEPTION 'Trámite inexistente o sin cliente.' USING ERRCODE = '22023';
  END IF;
  IF NOT (v_categoria = 'dj' OR v_serv_codigo = 'rpac_ddjj') THEN
    RAISE EXCEPTION 'Este trámite no es una presentación de DDJJ.' USING ERRCODE = '22023';
  END IF;

  SELECT nullif(btrim(email), ''), nombre INTO v_email, v_nombre
    FROM public.administraciones WHERE id = v_admin;
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'El cliente no tiene email cargado; no se puede comunicar la presentación.' USING ERRCODE = '22023';
  END IF;

  v_resumen := public.tramite_ddjj_resumen_comprobantes(p_tramite_id);
  v_cantidad := COALESCE((v_resumen->>'cantidad')::int, 0);
  IF v_cantidad = 0 THEN
    RAISE EXCEPTION 'Todavía no hay comprobantes emitidos para este trámite; facturá la presentación antes de comunicarla.' USING ERRCODE = '22023';
  END IF;

  -- #3 · Idempotencia como RETORNO estructurado (no error): el front ofrece reenvío.
  IF NOT p_forzar AND EXISTS (
    SELECT 1 FROM public.email_queue
     WHERE template_slug = 'ddjj-presentacion-realizada'
       AND related_table = 'tramites' AND related_id = p_tramite_id
       AND status IN ('sent','pending')
  ) THEN
    RETURN jsonb_build_object(
      'enviado', false, 'ya_comunicado', true,
      'email', v_email, 'cantidad', v_cantidad,
      'importe_total_fmt', (v_resumen->>'importe_total_fmt'));
  END IF;

  -- Encolar el mail premium (carril transaccional: el slug no está en la allow-list de marketing).
  PERFORM public.encolar_email(
    'ddjj-presentacion-realizada', v_email, v_nombre,
    jsonb_build_object(
      'nombre', v_nombre,
      'periodo', COALESCE(NULLIF(btrim(v_periodo), ''), to_char(current_date, 'YYYY')),  -- #4 fallback
      'cantidad', v_cantidad::text,
      'importe_total', (v_resumen->>'importe_total_fmt'),
      'link_portal', 'https://www.gestionglobal.ar/portal'
    ),
    v_admin, NULL, 'tramites', p_tramite_id, 3::smallint);

  -- Línea INTERNA que deja constancia de la comunicación (no visible → no dispara otro mail).
  BEGIN
    PERFORM public.tracking_agregar_linea(
      p_tramite_id, 'seguimiento_interno',
      'Comunicamos al cliente la presentación de la DDJJ por mail ('
        || v_cantidad || ' comprobante(s), ' || (v_resumen->>'importe_total_fmt') || ').',
      NULL, '{}'::text[], NULL, false);
  EXCEPTION WHEN OTHERS THEN RAISE WARNING 'linea comunicar DDJJ falló: %', SQLERRM; END;

  RETURN jsonb_build_object(
    'enviado', true, 'ya_comunicado', false,
    'email', v_email,
    'cantidad', v_cantidad,
    'importe_total_fmt', (v_resumen->>'importe_total_fmt')
  );
END;
$$;

COMMENT ON FUNCTION public.tramite_ddjj_comunicar_presentacion(uuid, boolean)
  IS 'DGG-275 F5 · Envía el mail ddjj-presentacion-realizada al cliente (resumen escalar). Botón de gerencia, GATEADO por config_global.ddjj_avisos_habilitados. Idempotente (devuelve ya_comunicado=true si sent/pending, salvo p_forzar). advisory lock por trámite anti-race. Staff-only.';

GRANT EXECUTE ON FUNCTION public.tramite_ddjj_comunicar_presentacion(uuid, boolean) TO authenticated;
