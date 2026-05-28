-- ============================================================================
-- Migration: 0103_arca_emisores_partner_role_schema
-- Fecha: 2026-05-28
-- DGG-XX · #149 parte 1 (schema): segundo emisor ARCA + columnas + role 'partner'.
-- Decisión del usuario: nueva tabla arca_emisores; selección por partner
-- participante; role 'partner' con vista propia.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.arca_emisores (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre          text NOT NULL,
  razon_social    text NOT NULL,
  cuit            text NOT NULL UNIQUE,
  condicion_iva   text NOT NULL DEFAULT 'monotributo',
  domicilio_fiscal text,
  logo_url        text,
  ambiente        text NOT NULL DEFAULT 'test'
                  CHECK (ambiente IN ('test','prod')),
  cert_p12_b64    text,
  cert_password   text,
  activo          boolean NOT NULL DEFAULT true,
  es_default      boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_arca_emisores_default
  ON public.arca_emisores(es_default) WHERE es_default = true;

ALTER TABLE public.arca_emisores ENABLE ROW LEVEL SECURITY;

-- Seed emisor default desde config_global (idempotente)
INSERT INTO public.arca_emisores (
  nombre, razon_social, cuit, condicion_iva, domicilio_fiscal, logo_url,
  ambiente, activo, es_default
)
SELECT
  COALESCE(cg.nombre_fantasia, cg.razon_social, 'Gestión Global'),
  cg.razon_social, cg.cuit, cg.condicion_iva, cg.domicilio_fiscal, cg.logo_url,
  'test', true, true
FROM public.config_global cg
WHERE cg.cuit IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.arca_emisores WHERE es_default = true)
LIMIT 1;

ALTER TABLE public.partners
  ADD COLUMN IF NOT EXISTS emisor_id uuid
    REFERENCES public.arca_emisores(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_partners_emisor ON public.partners(emisor_id)
  WHERE emisor_id IS NOT NULL;

ALTER TABLE public.comprobantes
  ADD COLUMN IF NOT EXISTS emisor_id uuid
    REFERENCES public.arca_emisores(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_comprobantes_emisor ON public.comprobantes(emisor_id)
  WHERE emisor_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.comprobantes_set_emisor_default()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.emisor_id IS NULL THEN
    SELECT id INTO NEW.emisor_id FROM public.arca_emisores
      WHERE es_default = true AND activo = true LIMIT 1;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_comprobantes_emisor_default ON public.comprobantes;
CREATE TRIGGER trg_comprobantes_emisor_default
  BEFORE INSERT ON public.comprobantes
  FOR EACH ROW EXECUTE FUNCTION public.comprobantes_set_emisor_default();

UPDATE public.comprobantes c
   SET emisor_id = (SELECT id FROM public.arca_emisores WHERE es_default = true LIMIT 1)
 WHERE c.emisor_id IS NULL;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS partner_id uuid
    REFERENCES public.partners(id) ON DELETE SET NULL;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check
    CHECK (role = ANY (ARRAY['gerente','operador','administrador','partner']));
