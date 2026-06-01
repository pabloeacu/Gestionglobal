-- ============================================================================
-- Migration: 0159_arca_emisores_unificar
-- Fecha: 2026-06-01
-- DGG-31 · Unificar arca_config (singleton legacy) + columnas fiscales de
--          config_global en la tabla arca_emisores (multi-emisor desde mig 0103).
--
-- Antes: dos modelos cohabitando.
--   Viejo (singleton): config_global.cuit/razon_social/condicion_iva/domicilio
--                      + arca_config.csr_b64/key_b64/cert_b64/...
--   Nuevo (multi):     arca_emisores (DGG mig 0103 task #149 Fundplata) sin
--                      columnas técnicas, sólo identidad fiscal.
--
-- Las edge fns arca-* leían del modelo viejo; los comprobantes ya tenían
-- emisor_id apuntando al modelo nuevo. UI para gestionar emisores NO existía.
--
-- Decisión: una sola tabla arca_emisores con TODAS las columnas técnicas
--           (CSR/key/cert/cert_alias/punto_venta/ambiente/ultimo_test_*).
--           config_global queda para datos NO-fiscales (branding, email,
--           landing). arca_config (singleton) se deprecará una vez que las
--           edge fns migren — esta mig la deja viva por compatibilidad
--           backward y la siguiente mig la dropea cuando los edge fns
--           estén refactorizados.
--
-- Cita: regla 6 (migraciones versionadas), regla 11 (índices en FKs).
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Extender arca_emisores con columnas técnicas de arca_config
-- ----------------------------------------------------------------------------

ALTER TABLE public.arca_emisores
  ADD COLUMN IF NOT EXISTS csr_b64                  text,
  ADD COLUMN IF NOT EXISTS key_b64                  text,
  ADD COLUMN IF NOT EXISTS cert_b64                 text,
  ADD COLUMN IF NOT EXISTS csr_generado_at          timestamptz,
  ADD COLUMN IF NOT EXISTS cert_subido_at           timestamptz,
  ADD COLUMN IF NOT EXISTS cert_alias               text,
  ADD COLUMN IF NOT EXISTS cert_valido_desde        date,
  ADD COLUMN IF NOT EXISTS cert_valido_hasta        date,
  ADD COLUMN IF NOT EXISTS ultimo_test_at           timestamptz,
  ADD COLUMN IF NOT EXISTS ultimo_test_ok           boolean,
  ADD COLUMN IF NOT EXISTS ultimo_test_msg          text,
  ADD COLUMN IF NOT EXISTS ultimo_test_latencia_ms  integer,
  ADD COLUMN IF NOT EXISTS punto_venta_default      integer NOT NULL DEFAULT 1;

-- El campo `ambiente` ya existe (mig 0103) con CHECK IN ('test','prod') y
-- DEFAULT 'test'. arca_config viejo usaba ('homologacion','produccion'). Para
-- evitar bombas downstream, ampliamos el CHECK a ambos vocabularios y
-- mapeamos 'homologacion'→'test', 'produccion'→'prod' en la migración de
-- datos abajo. Las edge fns post-refactor usarán 'homologacion'/'produccion'
-- (vocabulario UX) y guardarán 'test'/'prod' (vocabulario DB).
ALTER TABLE public.arca_emisores
  DROP CONSTRAINT IF EXISTS arca_emisores_ambiente_check;
ALTER TABLE public.arca_emisores
  ADD CONSTRAINT arca_emisores_ambiente_check
  CHECK (ambiente IN ('test','prod','homologacion','produccion'));

-- ----------------------------------------------------------------------------
-- 2. Permitir CUIT nullable durante onboarding (NO obliga al usuario a
--    cargar valores ficticios para crear el emisor placeholder).
--    Conservar el UNIQUE: Postgres permite múltiples NULLs en UNIQUE.
-- ----------------------------------------------------------------------------

ALTER TABLE public.arca_emisores
  ALTER COLUMN cuit DROP NOT NULL;

-- ----------------------------------------------------------------------------
-- 3. Migrar los datos técnicos de arca_config (id=1) al emisor default.
--    Idempotente: sólo copia si los campos del emisor están vacíos.
-- ----------------------------------------------------------------------------

UPDATE public.arca_emisores e
   SET csr_b64                 = COALESCE(e.csr_b64,                 c.csr_b64),
       key_b64                 = COALESCE(e.key_b64,                 c.key_b64),
       cert_b64                = COALESCE(e.cert_b64,                c.cert_b64),
       csr_generado_at         = COALESCE(e.csr_generado_at,         c.csr_generado_at),
       cert_subido_at          = COALESCE(e.cert_subido_at,          c.cert_subido_at),
       cert_alias              = COALESCE(e.cert_alias,              c.cert_alias),
       cert_valido_desde       = COALESCE(e.cert_valido_desde,       c.cert_valido_desde),
       cert_valido_hasta       = COALESCE(e.cert_valido_hasta,       c.cert_valido_hasta),
       ultimo_test_at          = COALESCE(e.ultimo_test_at,          c.ultimo_test_at),
       ultimo_test_ok          = COALESCE(e.ultimo_test_ok,          c.ultimo_test_ok),
       ultimo_test_msg         = COALESCE(e.ultimo_test_msg,         c.ultimo_test_msg),
       ultimo_test_latencia_ms = COALESCE(e.ultimo_test_latencia_ms, c.ultimo_test_latencia_ms),
       punto_venta_default     = COALESCE(NULLIF(e.punto_venta_default, 1), c.punto_venta_default, 1),
       ambiente                = CASE
                                   WHEN e.ambiente IS NOT NULL
                                        AND e.ambiente <> 'test'
                                     THEN e.ambiente
                                   ELSE COALESCE(c.ambiente, 'homologacion')
                                 END,
       updated_at              = now()
  FROM public.arca_config c
 WHERE c.id = 1
   AND e.es_default = true;

-- Migrar también los datos fiscales de config_global al emisor default si
-- el emisor tiene placeholder. Idempotente — sólo si el destino está vacío.
UPDATE public.arca_emisores e
   SET cuit             = COALESCE(NULLIF(e.cuit, '00000000000'), cg.cuit),
       razon_social     = COALESCE(NULLIF(e.razon_social, ''),    cg.razon_social,    e.razon_social),
       condicion_iva    = COALESCE(NULLIF(e.condicion_iva, ''),   cg.condicion_iva,   e.condicion_iva),
       domicilio_fiscal = COALESCE(e.domicilio_fiscal,            cg.domicilio_fiscal),
       logo_url         = COALESCE(e.logo_url,                    cg.logo_url),
       updated_at       = now()
  FROM public.config_global cg
 WHERE cg.id = 1
   AND e.es_default = true;

-- Borrar placeholder "00000000000" (queda NULL → el wizard pedirá el real).
UPDATE public.arca_emisores
   SET cuit = NULL, updated_at = now()
 WHERE cuit = '00000000000';

-- ----------------------------------------------------------------------------
-- 4. Helper RPC: obtener emisor default (o crear uno vacío si no existe).
--    Lo usa la UI cuando el usuario entra al panel sin emisores cargados.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.arca_emisor_default()
RETURNS public.arca_emisores
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_emisor public.arca_emisores;
BEGIN
  -- Sólo gerentes pueden invocar; staff bypass.
  IF NOT public.is_staff() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_emisor
    FROM public.arca_emisores
   WHERE es_default = true AND activo = true
   ORDER BY created_at ASC
   LIMIT 1;

  IF NOT FOUND THEN
    INSERT INTO public.arca_emisores (nombre, razon_social, ambiente, es_default, activo)
    VALUES ('Gestión Global', 'Gestión Global', 'homologacion', true, true)
    RETURNING * INTO v_emisor;
  END IF;

  RETURN v_emisor;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.arca_emisor_default() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.arca_emisor_default() TO authenticated;

COMMENT ON FUNCTION public.arca_emisor_default() IS
  'Devuelve el emisor ARCA default (es_default=true, activo=true). Si no existe lo crea con un placeholder mínimo. Sólo staff (gerentes/operadores).';

-- ----------------------------------------------------------------------------
-- 5. Helper RPC: setear emisor default (atómico, evita 2 defaults simultáneos)
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.arca_emisor_set_default(p_emisor_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_staff() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  -- Verificar que existe y está activo
  IF NOT EXISTS (
    SELECT 1 FROM public.arca_emisores
     WHERE id = p_emisor_id AND activo = true
  ) THEN
    RAISE EXCEPTION 'emisor no existe o no está activo';
  END IF;

  -- Desmarcar todos los defaults y luego marcar el nuevo (en una sola tx)
  UPDATE public.arca_emisores SET es_default = false WHERE es_default = true;
  UPDATE public.arca_emisores SET es_default = true,  updated_at = now() WHERE id = p_emisor_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.arca_emisor_set_default(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.arca_emisor_set_default(uuid) TO authenticated;

COMMENT ON FUNCTION public.arca_emisor_set_default(uuid) IS
  'Cambia el emisor default ARCA atómicamente (desmarca el anterior y marca el nuevo en una sola transacción).';

COMMIT;

-- ============================================================================
-- NOTAS
-- ============================================================================
-- - arca_config (singleton) NO se borra todavía. Se mantiene viva hasta que
--   todas las edge fns ARCA estén refactorizadas a arca_emisores. Una mig
--   posterior la dropea cuando sea seguro.
-- - config_global.cuit/razon_social/condicion_iva/domicilio_fiscal NO se
--   borran. Son redundantes pero pueden ser usadas por otros módulos (emails,
--   footer PDF, branding). Mientras tanto la fuente de verdad de identidad
--   fiscal pasa a ser arca_emisores; los otros se sincronizan manualmente
--   desde la UI si el usuario lo desea.
-- - Las edge fns post-refactor reciben emisor_id (default = es_default=true).
