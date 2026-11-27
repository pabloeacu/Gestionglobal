-- 0747 · DGG-275 / DDJJ F0 — Fix de la auditoría §6 del importador de consorcios (0746).
--
-- Hallazgos corregidos (auditoría §6, 3 agentes):
--   #1 CRÍTICA — clobber de facturación: el UPDATE/re-point escribía
--      condicion_iva/facturar_con_cuit_administracion/monto_abono/unidades_funcionales
--      INCONDICIONALMENTE. Como el Excel (y el front) no siempre traen esos campos,
--      cada actualización/re-point reseteaba condicion_iva→'consumidor_final',
--      facturar→false, monto_abono→0, UF→0 en silencio (corrompe la base de
--      facturación DDJJ por-consorcio). FIX: coalesce-preserve en UPDATE (sólo
--      sobrescribe si el valor viene en la fila; NULL = "no tocar"); defaults
--      SÓLO en INSERT.
--   #2 CRÍTICA — re-point viola uq_consorcios_admin_codigo: al reasignar un
--      consorcio por CUIT a otra administración se conservaba el código viejo;
--      si la admin destino ya tenía ese código, el UPDATE chocaba con el UNIQUE
--      y el cambio de administrador se PERDÍA en silencio (fila-error). FIX:
--      resolver un código LIBRE en la admin destino antes del UPDATE.
--   #3 MENOR — merge por código-fallback de nombre: filas sin CUIT ni código
--      se deduplicaban por left(normalizar_nombre,40) → dos edificios distintos
--      con nombre parecido se fusionaban. FIX: para filas sin CUIT y sin código
--      explícito, dedup por nombre_normalizado COMPLETO dentro de la admin
--      (estable e idempotente, sin truncado); el código se materializa único.
--   #4 MENOR — índice de FK autor (R11/E48).
--   #5-residual — promoción de documento sólo dni_ficticio→cuit (nunca pisa un
--      CUIT existente distinto): guard `tipo_documento IS DISTINCT FROM 'cuit'`.
--
-- R16: misma firma (CREATE OR REPLACE, sin overload). R5/R6/R12/R17 intactos.
-- Smoke e2e (R18) se re-ejercita fuera de la migración (BEGIN/import x2/ROLLBACK)
-- cubriendo no-clobber + re-point con colisión de código + dedup por nombre.

-- #4 · índice de FK autor.
CREATE INDEX IF NOT EXISTS idx_consorcio_import_log_autor
  ON public.consorcio_import_log(autor) WHERE autor IS NOT NULL;

CREATE OR REPLACE FUNCTION public.consorcio_import_batch(
  p_administracion_id uuid,
  p_archivo text,
  p_filas jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_total int := 0;
  v_creados int := 0;
  v_actualizados int := 0;
  v_repunteados int := 0;
  v_errores int := 0;
  v_detalle jsonb := '[]'::jsonb;
  v_log_id uuid;
  v_row jsonb;
  v_idx int := 0;
  v_codigo_excel text;
  v_nombre text;
  v_cuit text;
  v_domicilio text;
  v_localidad text;
  v_provincia text;
  v_cp text;
  v_uf int;                    -- NULL = "no tocar" (coalesce-preserve en UPDATE)
  v_abono numeric(12,2);       -- NULL = "no tocar"
  v_cond_iva text;             -- NULL = "no tocar"
  v_fact_admin boolean;        -- NULL = "no tocar"
  v_found_id uuid;
  v_found_admin uuid;
  v_found_codigo text;
  v_found_tipo text;
  v_outcome text;
  v_candidate text;
  v_codigo_dest text;          -- código resuelto (libre) para UPDATE/INSERT
  v_try text;
  v_n int;
  v_promote boolean;
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo gerencia' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.administraciones WHERE id = p_administracion_id) THEN
    RAISE EXCEPTION 'Administración inexistente' USING ERRCODE = '22023';
  END IF;

  v_total := coalesce(jsonb_array_length(p_filas), 0);

  FOR v_row IN SELECT * FROM jsonb_array_elements(p_filas) LOOP
    v_idx := v_idx + 1;
    v_outcome := NULL;
    v_codigo_excel := NULL;
    v_nombre := NULL;
    BEGIN
      v_nombre := nullif(btrim(v_row->>'nombre'), '');
      v_codigo_excel := nullif(btrim(v_row->>'codigo'), '');
      v_cuit := regexp_replace(coalesce(v_row->>'cuit', ''), '[^0-9]', '', 'g');
      IF v_cuit = '' THEN v_cuit := NULL; END IF;
      v_domicilio := nullif(btrim(v_row->>'domicilio'), '');
      v_localidad := nullif(btrim(v_row->>'localidad'), '');
      v_provincia := nullif(btrim(v_row->>'provincia'), '');
      v_cp := nullif(btrim(v_row->>'codigo_postal'), '');
      -- NULL cuando la clave no viene / viene vacía (NO 0) → coalesce-preserve.
      v_uf := nullif(v_row->>'unidades_funcionales', '')::int;
      v_abono := nullif(v_row->>'monto_abono', '')::numeric;
      v_cond_iva := nullif(v_row->>'condicion_iva', '');
      v_fact_admin := (nullif(v_row->>'facturar_con_cuit_administracion', ''))::boolean;

      IF v_nombre IS NULL THEN
        RAISE EXCEPTION 'Nombre vacío';
      END IF;
      IF v_cuit IS NOT NULL AND v_cuit !~ '^\d{11}$' THEN
        RAISE EXCEPTION 'CUIT inválido (% dígitos)', length(v_cuit);
      END IF;

      v_found_id := NULL; v_found_admin := NULL; v_found_codigo := NULL; v_found_tipo := NULL;

      -- Match: (1) CUIT global → (2) código explícito dentro de la admin →
      --        (3) sin CUIT ni código: nombre_normalizado dentro de la admin.
      IF v_cuit IS NOT NULL THEN
        SELECT id, administracion_id, codigo, tipo_documento
          INTO v_found_id, v_found_admin, v_found_codigo, v_found_tipo
          FROM public.consorcios
         WHERE tipo_documento = 'cuit' AND numero_documento = v_cuit
         LIMIT 1;
      END IF;

      IF v_found_id IS NULL AND v_codigo_excel IS NOT NULL THEN
        SELECT id, administracion_id, codigo, tipo_documento
          INTO v_found_id, v_found_admin, v_found_codigo, v_found_tipo
          FROM public.consorcios
         WHERE administracion_id = p_administracion_id AND codigo = v_codigo_excel
         LIMIT 1;
      END IF;

      IF v_found_id IS NULL AND v_codigo_excel IS NULL AND v_cuit IS NULL THEN
        SELECT id, administracion_id, codigo, tipo_documento
          INTO v_found_id, v_found_admin, v_found_codigo, v_found_tipo
          FROM public.consorcios
         WHERE administracion_id = p_administracion_id
           AND nombre_normalizado = public.normalizar_nombre(v_nombre)
         LIMIT 1;
      END IF;

      IF v_found_id IS NOT NULL THEN
        -- ── UPDATE (match) ──
        v_promote := (v_cuit IS NOT NULL AND v_found_tipo IS DISTINCT FROM 'cuit');

        IF v_found_admin IS DISTINCT FROM p_administracion_id THEN
          -- RE-POINT (cambio de administrador): resolver código libre en destino.
          v_candidate := coalesce(v_codigo_excel, v_found_codigo, 'C-' || v_idx::text);
          v_try := v_candidate; v_n := 1;
          WHILE EXISTS (
            SELECT 1 FROM public.consorcios
             WHERE administracion_id = p_administracion_id AND codigo = v_try AND id <> v_found_id
          ) LOOP
            v_n := v_n + 1;
            v_try := left(v_candidate, 36) || '-' || v_n::text;
            IF v_n > 200 THEN RAISE EXCEPTION 'No se pudo resolver un código libre para %', v_candidate; END IF;
          END LOOP;
          v_codigo_dest := v_try;
        ELSE
          v_codigo_dest := NULL;  -- misma admin: no se toca el código
        END IF;

        UPDATE public.consorcios SET
          administracion_id                = p_administracion_id,
          nombre                           = v_nombre,
          codigo                           = coalesce(v_codigo_dest, codigo),
          unidades_funcionales             = coalesce(v_uf, unidades_funcionales),
          monto_abono                      = coalesce(v_abono, monto_abono),
          condicion_iva                    = coalesce(v_cond_iva, condicion_iva),
          facturar_con_cuit_administracion = coalesce(v_fact_admin, facturar_con_cuit_administracion),
          domicilio                        = coalesce(v_domicilio, domicilio),
          localidad                        = coalesce(v_localidad, localidad),
          provincia                        = coalesce(v_provincia, provincia),
          codigo_postal                    = coalesce(v_cp, codigo_postal),
          tipo_documento                   = CASE WHEN v_promote THEN 'cuit' ELSE tipo_documento END,
          numero_documento                 = CASE WHEN v_promote THEN v_cuit ELSE numero_documento END
        WHERE id = v_found_id;

        IF v_found_admin IS DISTINCT FROM p_administracion_id THEN
          v_outcome := 'repunteado'; v_repunteados := v_repunteados + 1;
        ELSE
          v_outcome := 'actualizado'; v_actualizados := v_actualizados + 1;
        END IF;
      ELSE
        -- ── INSERT (nuevo) ── código único dentro de la admin.
        v_candidate := coalesce(v_codigo_excel, v_cuit, left(public.normalizar_nombre(v_nombre), 36), 'C-' || v_idx::text);
        IF v_candidate IS NULL OR v_candidate = '' THEN v_candidate := 'C-' || v_idx::text; END IF;
        v_try := v_candidate; v_n := 1;
        WHILE EXISTS (
          SELECT 1 FROM public.consorcios
           WHERE administracion_id = p_administracion_id AND codigo = v_try
        ) LOOP
          v_n := v_n + 1;
          v_try := left(v_candidate, 36) || '-' || v_n::text;
          IF v_n > 200 THEN RAISE EXCEPTION 'No se pudo resolver un código libre para %', v_candidate; END IF;
        END LOOP;
        v_codigo_dest := v_try;

        INSERT INTO public.consorcios (
          administracion_id, codigo, nombre, nombre_normalizado,
          unidades_funcionales, monto_abono, condicion_iva,
          facturar_con_cuit_administracion,
          domicilio, localidad, provincia, codigo_postal,
          tipo_documento, numero_documento, created_by
        ) VALUES (
          p_administracion_id, v_codigo_dest, v_nombre, '',
          coalesce(v_uf, 0), coalesce(v_abono, 0), coalesce(v_cond_iva, 'consumidor_final'),
          coalesce(v_fact_admin, false),
          v_domicilio, v_localidad, v_provincia, v_cp,
          CASE WHEN v_cuit IS NOT NULL THEN 'cuit' ELSE NULL END,
          v_cuit, v_uid
        ) RETURNING id INTO v_found_id;
        v_outcome := 'creado'; v_creados := v_creados + 1;
      END IF;

      v_detalle := v_detalle || jsonb_build_object(
        'fila', v_idx, 'codigo', coalesce(v_codigo_dest, v_codigo_excel), 'nombre', v_nombre,
        'resultado', v_outcome, 'consorcio_id', v_found_id);

    EXCEPTION WHEN OTHERS THEN
      v_errores := v_errores + 1;
      v_detalle := v_detalle || jsonb_build_object(
        'fila', v_idx, 'codigo', v_codigo_excel, 'nombre', v_nombre,
        'resultado', 'error', 'motivo', SQLERRM);
    END;
  END LOOP;

  INSERT INTO public.consorcio_import_log (
    administracion_id, archivo, total, creados, actualizados, repunteados, errores, detalle, autor
  ) VALUES (
    p_administracion_id, p_archivo, v_total, v_creados, v_actualizados, v_repunteados, v_errores, v_detalle, v_uid
  ) RETURNING id INTO v_log_id;

  RETURN jsonb_build_object(
    'log_id', v_log_id,
    'total', v_total,
    'creados', v_creados,
    'actualizados', v_actualizados,
    'repunteados', v_repunteados,
    'errores', v_errores,
    'detalle', v_detalle
  );
END;
$$;

REVOKE ALL ON FUNCTION public.consorcio_import_batch(uuid, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consorcio_import_batch(uuid, text, jsonb) TO authenticated;

COMMENT ON FUNCTION public.consorcio_import_batch(uuid, text, jsonb) IS
  'DGG-275 F0 (fix 0747): importa/materializa consorcios. Dedup por CUIT global, por (admin,codigo) explícito, y por nombre_normalizado (sin cuit/codigo). Re-apunta administración resolviendo código libre; coalesce-preserve en UPDATE (no pisa facturación). Sólo gerencia.';
