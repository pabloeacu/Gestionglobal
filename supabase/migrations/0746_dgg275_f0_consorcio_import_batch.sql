-- 0746 · DGG-275 / DDJJ F0 — Importador de consorcios (Excel) con dedup + re-point.
--
-- Fundación de datos para la facturación DDJJ por-consorcio (plan DDJJ §4.2, F0).
-- El wizard de cierre (F3) y el autónomo (F4) materializan consorcios desde el
-- Excel de rendición. Esta migración provee la capacidad reutilizable:
--   consorcio_import_batch(p_administracion_id, p_archivo, p_filas jsonb)
--
-- Reglas de dominio capitalizadas (Pablo 2026-11-26, [[project_ddjj_consorcios_snapshot]]):
--   · Un consorcio puede cambiar de administración (cambio de administrador del
--     edificio). La clave de identidad GLOBAL es el CUIT (uq_consorcios_cuit).
--   · Dedup: (1) por CUIT global; si el consorcio ya existe bajo OTRA administración
--     ⇒ CAMBIO DE ADMINISTRADOR ⇒ se RE-APUNTA `administracion_id` a la actual
--     (resultado 'repunteado'), SIN tocar comprobantes históricos (su deudor vive
--     congelado en comprobantes.administracion_id — snapshot nativo 0004:63-64).
--     (2) sin CUIT ⇒ dedup por (administracion_id, codigo) dentro de la admin.
--   · Nunca duplica: si matchea, actualiza; si no, inserta (sin documento ⇒ el
--     trigger asignar_dni_ficticio completa el DNI ficticio, D07).
--
-- R5 (multi-tabla → RPC SECURITY DEFINER), R6 (RLS + GRANT a authenticated),
-- R12 (gerencia-only: is_staff gate; gerentes bypassan tenancy), R16 (firma única).
-- El Excel se parsea en el browser; sólo filas validadas llegan acá (no toca Storage ⇒ R20 n/a).

-- ───────────── Log de importaciones (auditoría, R9) ─────────────
CREATE TABLE IF NOT EXISTS public.consorcio_import_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  administracion_id uuid NOT NULL REFERENCES public.administraciones(id) ON DELETE CASCADE,
  archivo text,
  total int NOT NULL DEFAULT 0 CHECK (total >= 0),
  creados int NOT NULL DEFAULT 0 CHECK (creados >= 0),
  actualizados int NOT NULL DEFAULT 0 CHECK (actualizados >= 0),
  repunteados int NOT NULL DEFAULT 0 CHECK (repunteados >= 0),
  errores int NOT NULL DEFAULT 0 CHECK (errores >= 0),
  detalle jsonb NOT NULL DEFAULT '[]'::jsonb,
  autor uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_consorcio_import_log_admin
  ON public.consorcio_import_log(administracion_id, created_at DESC);

ALTER TABLE public.consorcio_import_log ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.consorcio_import_log TO authenticated;

-- Lectura sólo gerencia/operación. Las escrituras van SÓLO por la RPC SECURITY
-- DEFINER (bypassa RLS, R17 cubierto) — sin policy de write intencionalmente.
DROP POLICY IF EXISTS consorcio_import_log_select_staff ON public.consorcio_import_log;
CREATE POLICY consorcio_import_log_select_staff ON public.consorcio_import_log
  FOR SELECT TO authenticated
  USING (private.is_staff());

COMMENT ON TABLE public.consorcio_import_log IS
  'DGG-275 F0: registro de cada importación de consorcios desde Excel (creados/actualizados/repunteados/errores).';

-- ───────────── RPC · consorcio_import_batch ─────────────
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
  v_codigo text;
  v_nombre text;
  v_cuit text;
  v_domicilio text;
  v_localidad text;
  v_provincia text;
  v_cp text;
  v_uf int;
  v_abono numeric(12,2);
  v_cond_iva text;
  v_fact_admin boolean;
  v_found_id uuid;
  v_found_admin uuid;
  v_target_existing uuid;
  v_outcome text;
BEGIN
  -- R12: gerencia-only. Los gerentes bypassan tenancy (single-tenant).
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
    v_codigo := NULL;
    v_nombre := NULL;
    BEGIN
      v_nombre := nullif(btrim(v_row->>'nombre'), '');
      v_codigo := nullif(btrim(v_row->>'codigo'), '');
      v_cuit := regexp_replace(coalesce(v_row->>'cuit', ''), '[^0-9]', '', 'g');
      IF v_cuit = '' THEN v_cuit := NULL; END IF;
      v_domicilio := nullif(btrim(v_row->>'domicilio'), '');
      v_localidad := nullif(btrim(v_row->>'localidad'), '');
      v_provincia := nullif(btrim(v_row->>'provincia'), '');
      v_cp := nullif(btrim(v_row->>'codigo_postal'), '');
      v_uf := coalesce(nullif(v_row->>'unidades_funcionales', '')::int, 0);
      v_abono := coalesce(nullif(v_row->>'monto_abono', '')::numeric, 0);
      v_cond_iva := coalesce(nullif(v_row->>'condicion_iva', ''), 'consumidor_final');
      v_fact_admin := coalesce((v_row->>'facturar_con_cuit_administracion')::boolean, false);

      IF v_nombre IS NULL THEN
        RAISE EXCEPTION 'Nombre vacío';
      END IF;
      IF v_cuit IS NOT NULL AND v_cuit !~ '^\d{11}$' THEN
        RAISE EXCEPTION 'CUIT inválido (% dígitos)', length(v_cuit);
      END IF;
      -- Código fallback estable si el Excel no lo trae (la tabla lo exige NOT NULL).
      IF v_codigo IS NULL THEN
        v_codigo := coalesce(v_cuit, left(public.normalizar_nombre(v_nombre), 40));
        IF v_codigo IS NULL OR v_codigo = '' THEN
          v_codigo := 'C-' || v_idx::text;
        END IF;
      END IF;

      v_found_id := NULL;
      v_found_admin := NULL;

      -- (1) Dedup GLOBAL por CUIT.
      IF v_cuit IS NOT NULL THEN
        SELECT id, administracion_id INTO v_found_id, v_found_admin
          FROM public.consorcios
         WHERE tipo_documento = 'cuit' AND numero_documento = v_cuit
         LIMIT 1;
      END IF;

      IF v_found_id IS NOT NULL THEN
        -- Existe por CUIT. Update de campos + RE-APUNTA admin si cambió de administrador.
        -- NO se toca `codigo` (cosmético por-admin) para no chocar con uq_consorcios_admin_codigo.
        UPDATE public.consorcios SET
          administracion_id                = p_administracion_id,
          nombre                           = v_nombre,
          unidades_funcionales             = v_uf,
          monto_abono                      = v_abono,
          condicion_iva                    = v_cond_iva,
          facturar_con_cuit_administracion = v_fact_admin,
          domicilio                        = coalesce(v_domicilio, domicilio),
          localidad                        = coalesce(v_localidad, localidad),
          provincia                        = coalesce(v_provincia, provincia),
          codigo_postal                    = coalesce(v_cp, codigo_postal)
        WHERE id = v_found_id;

        IF v_found_admin IS DISTINCT FROM p_administracion_id THEN
          v_outcome := 'repunteado';
          v_repunteados := v_repunteados + 1;
        ELSE
          v_outcome := 'actualizado';
          v_actualizados := v_actualizados + 1;
        END IF;
      ELSE
        -- (2) Sin match por CUIT: dedup por (admin, código) dentro de esta administración.
        SELECT id INTO v_target_existing
          FROM public.consorcios
         WHERE administracion_id = p_administracion_id AND codigo = v_codigo
         LIMIT 1;

        IF v_target_existing IS NOT NULL THEN
          UPDATE public.consorcios SET
            nombre                           = v_nombre,
            unidades_funcionales             = v_uf,
            monto_abono                      = v_abono,
            condicion_iva                    = v_cond_iva,
            facturar_con_cuit_administracion = v_fact_admin,
            domicilio                        = coalesce(v_domicilio, domicilio),
            localidad                        = coalesce(v_localidad, localidad),
            provincia                        = coalesce(v_provincia, provincia),
            codigo_postal                    = coalesce(v_cp, codigo_postal),
            tipo_documento                   = CASE WHEN v_cuit IS NOT NULL THEN 'cuit' ELSE tipo_documento END,
            numero_documento                 = CASE WHEN v_cuit IS NOT NULL THEN v_cuit ELSE numero_documento END
          WHERE id = v_target_existing;
          v_found_id := v_target_existing;
          v_outcome := 'actualizado';
          v_actualizados := v_actualizados + 1;
        ELSE
          -- Nuevo. Sin CUIT ⇒ tipo/numero NULL y el trigger asignar_dni_ficticio los completa (D07).
          INSERT INTO public.consorcios (
            administracion_id, codigo, nombre, nombre_normalizado,
            unidades_funcionales, monto_abono, condicion_iva,
            facturar_con_cuit_administracion,
            domicilio, localidad, provincia, codigo_postal,
            tipo_documento, numero_documento, created_by
          ) VALUES (
            p_administracion_id, v_codigo, v_nombre, '',
            v_uf, v_abono, v_cond_iva,
            v_fact_admin,
            v_domicilio, v_localidad, v_provincia, v_cp,
            CASE WHEN v_cuit IS NOT NULL THEN 'cuit' ELSE NULL END,
            v_cuit, v_uid
          ) RETURNING id INTO v_found_id;
          v_outcome := 'creado';
          v_creados := v_creados + 1;
        END IF;
      END IF;

      v_detalle := v_detalle || jsonb_build_object(
        'fila', v_idx, 'codigo', v_codigo, 'nombre', v_nombre,
        'resultado', v_outcome, 'consorcio_id', v_found_id);

    EXCEPTION WHEN OTHERS THEN
      v_errores := v_errores + 1;
      v_detalle := v_detalle || jsonb_build_object(
        'fila', v_idx, 'codigo', v_codigo, 'nombre', v_nombre,
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
  'DGG-275 F0: importa/materializa consorcios desde Excel. Dedup por CUIT global y por (admin,codigo); '
  're-apunta administración si cambió de administrador (sin tocar comprobantes históricos). Sólo gerencia.';
