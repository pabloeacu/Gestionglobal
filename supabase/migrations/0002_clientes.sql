-- ============================================================================
-- 0002_clientes · administraciones + consorcios + administracion_emails
-- Cita el bagaje: D04/D06 (snapshot receptor + facturar_con_cuit_administracion),
-- D07 (DNI ficticio secuencial 99000001+), E41 (CHECK regex doc_formato 3 capas),
-- E48 (FK con su índice), P-DB-01 (tabla base), P-FE-04 / fuzzy con pg_trgm.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Extensiones requeridas (Supabase las pone en schema `extensions`).
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_trgm  WITH SCHEMA extensions;

-- Normaliza para fuzzy match: minúsculas + sin acentos + espacios compactados.
CREATE OR REPLACE FUNCTION public.normalizar_nombre(p text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = public, extensions, pg_temp
AS $$
  SELECT regexp_replace(
           lower(extensions.unaccent('extensions.unaccent', COALESCE(p,''))),
           '\s+', ' ', 'g'
         );
$$;
REVOKE EXECUTE ON FUNCTION public.normalizar_nombre(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.normalizar_nombre(text) TO authenticated;

-- ---------------------------------------------------------------------------
-- administraciones · el cliente contractual (administrador de consorcios).
-- ---------------------------------------------------------------------------
CREATE TABLE public.administraciones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Comercial / identificación
  codigo text NOT NULL,
  nombre text NOT NULL,
  nombre_normalizado text NOT NULL,
  responsable_nombre text,
  responsable_apellido text,

  -- Fiscal
  cuit text CHECK (cuit IS NULL OR cuit ~ '^\d{11}$'),
  condicion_iva text CHECK (
    condicion_iva IS NULL OR
    condicion_iva IN ('consumidor_final','responsable_inscripto','monotributo','exento')
  ),
  domicilio_fiscal text,

  -- Contacto comercial
  direccion text,
  localidad text,
  provincia text,
  codigo_postal text,
  telefono text,
  whatsapp text,
  email text,
  horarios text,
  foto_url text,

  -- Registral (matrículas)
  matricula_rpac text,
  matricula_rpac_fecha date,
  matricula_rpac_vencimiento date,
  matricula_rpa text,
  matricula_rpa_fecha date,
  matricula_rpa_vencimiento date,

  -- Operativa / portal
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  origen text,
  convenio text,
  descuento_porc numeric(5,2) NOT NULL DEFAULT 0
    CHECK (descuento_porc BETWEEN 0 AND 100),
  observaciones text,
  estado text NOT NULL DEFAULT 'activo'
    CHECK (estado IN ('prospecto','activo','suspendido','baja')),
  activo boolean NOT NULL DEFAULT true,

  -- Audit
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,

  CONSTRAINT uq_administraciones_codigo UNIQUE (codigo),
  CONSTRAINT uq_administraciones_nombre UNIQUE (nombre),
  CONSTRAINT uq_administraciones_user_id UNIQUE (user_id)
);

CREATE INDEX idx_administraciones_estado_activo
  ON public.administraciones(estado, activo);
CREATE INDEX idx_administraciones_created_by
  ON public.administraciones(created_by)
  WHERE created_by IS NOT NULL;
CREATE INDEX idx_administraciones_nombre_norm_trgm
  ON public.administraciones USING GIN (nombre_normalizado extensions.gin_trgm_ops);

CREATE TRIGGER trg_administraciones_touch
  BEFORE UPDATE ON public.administraciones
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Normaliza nombre_normalizado al insertar / actualizar nombre.
CREATE OR REPLACE FUNCTION public.normalize_administracion_nombre()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  NEW.nombre_normalizado := public.normalizar_nombre(NEW.nombre);
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_administraciones_normalize
  BEFORE INSERT OR UPDATE OF nombre ON public.administraciones
  FOR EACH ROW EXECUTE FUNCTION public.normalize_administracion_nombre();

-- Auditoría (D10)
CREATE TRIGGER trg_administraciones_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.administraciones
  FOR EACH ROW EXECUTE FUNCTION public.audit_row();

-- ---------------------------------------------------------------------------
-- FK diferida desde profiles.administracion_id → administraciones (definida
-- como columna en 0001 sin FK porque la tabla no existía aún).
-- ---------------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_administracion_id_fkey
  FOREIGN KEY (administracion_id) REFERENCES public.administraciones(id)
  ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- consorcios · el "edificio" del bagaje. Vinculado siempre a una administración.
-- Puede tener CUIT propio o DNI ficticio (D07 / E41).
-- ---------------------------------------------------------------------------
CREATE TABLE public.consorcios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  administracion_id uuid NOT NULL
    REFERENCES public.administraciones(id) ON DELETE RESTRICT,

  -- Identificación
  codigo text NOT NULL,
  nombre text NOT NULL,
  nombre_normalizado text NOT NULL,

  -- Composición
  unidades_funcionales int NOT NULL DEFAULT 0 CHECK (unidades_funcionales >= 0),
  cocheras int NOT NULL DEFAULT 0 CHECK (cocheras >= 0),
  bauleras int NOT NULL DEFAULT 0 CHECK (bauleras >= 0),
  empleados int NOT NULL DEFAULT 0 CHECK (empleados >= 0),

  -- Documento fiscal (capa DB de defensa en 3 capas — E41)
  tipo_documento text NOT NULL CHECK (tipo_documento IN ('cuit','dni_ficticio')),
  numero_documento text NOT NULL,
  condicion_iva text NOT NULL DEFAULT 'consumidor_final'
    CHECK (condicion_iva IN ('consumidor_final','responsable_inscripto')),

  -- Domicilio
  domicilio text,
  localidad text,
  provincia text,
  codigo_postal text,

  -- Facturación
  monto_abono numeric(12,2) NOT NULL DEFAULT 0 CHECK (monto_abono >= 0),
  facturar_con_cuit_administracion boolean NOT NULL DEFAULT false,

  -- Operativa
  observaciones text,
  activo boolean NOT NULL DEFAULT true,
  baja_motivo text,
  baja_fecha date,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,

  CONSTRAINT uq_consorcios_admin_codigo UNIQUE (administracion_id, codigo),
  CONSTRAINT chk_consorcios_documento_formato CHECK (
    (tipo_documento = 'cuit' AND numero_documento ~ '^\d{11}$')
    OR (tipo_documento = 'dni_ficticio' AND numero_documento ~ '^\d{7,8}$')
  )
);

-- FK con su índice (E48)
CREATE INDEX idx_consorcios_administracion ON public.consorcios(administracion_id);
CREATE INDEX idx_consorcios_administracion_activo
  ON public.consorcios(administracion_id, activo);
CREATE INDEX idx_consorcios_nombre_norm_trgm
  ON public.consorcios USING GIN (nombre_normalizado extensions.gin_trgm_ops);

-- CUIT único cuando el consorcio tiene CUIT propio.
CREATE UNIQUE INDEX uq_consorcios_cuit
  ON public.consorcios(numero_documento)
  WHERE tipo_documento = 'cuit';
-- DNI ficticio único globalmente (el contador es secuencial pero blindamos).
CREATE UNIQUE INDEX uq_consorcios_dni_ficticio
  ON public.consorcios(numero_documento)
  WHERE tipo_documento = 'dni_ficticio';

CREATE TRIGGER trg_consorcios_touch
  BEFORE UPDATE ON public.consorcios
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Normaliza nombre_normalizado.
CREATE OR REPLACE FUNCTION public.normalize_consorcio_nombre()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  NEW.nombre_normalizado := public.normalizar_nombre(NEW.nombre);
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_consorcios_normalize
  BEFORE INSERT OR UPDATE OF nombre ON public.consorcios
  FOR EACH ROW EXECUTE FUNCTION public.normalize_consorcio_nombre();

-- Asignar DNI ficticio si no se provee documento (D07).
-- Consume config_global.proximo_dni_ficticio de forma atómica (UPDATE ... RETURNING).
CREATE OR REPLACE FUNCTION public.asignar_dni_ficticio()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_dni bigint;
BEGIN
  IF NEW.tipo_documento IS NULL
     OR NEW.numero_documento IS NULL
     OR length(trim(NEW.numero_documento)) = 0 THEN
    UPDATE public.config_global
       SET proximo_dni_ficticio = proximo_dni_ficticio + 1
     WHERE id = 1
     RETURNING proximo_dni_ficticio - 1 INTO v_dni;

    IF v_dni IS NULL THEN
      RAISE EXCEPTION 'config_global no inicializada (contador DNI ficticio)';
    END IF;

    NEW.tipo_documento  := 'dni_ficticio';
    NEW.numero_documento := v_dni::text;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.asignar_dni_ficticio() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_consorcios_asignar_dni
  BEFORE INSERT ON public.consorcios
  FOR EACH ROW EXECUTE FUNCTION public.asignar_dni_ficticio();

-- Auditoría
CREATE TRIGGER trg_consorcios_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.consorcios
  FOR EACH ROW EXECUTE FUNCTION public.audit_row();

-- ---------------------------------------------------------------------------
-- administracion_emails · bandejas adicionales (facturación, cobranzas, ...)
-- ---------------------------------------------------------------------------
CREATE TABLE public.administracion_emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  administracion_id uuid NOT NULL
    REFERENCES public.administraciones(id) ON DELETE CASCADE,
  email text NOT NULL,
  es_principal boolean NOT NULL DEFAULT false,
  recibe_facturacion boolean NOT NULL DEFAULT false,
  recibe_cobranzas boolean NOT NULL DEFAULT false,
  recibe_tramites boolean NOT NULL DEFAULT false,
  nota text,
  activo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_admin_emails UNIQUE (administracion_id, email)
);

CREATE INDEX idx_admin_emails_admin ON public.administracion_emails(administracion_id);
CREATE INDEX idx_admin_emails_facturacion
  ON public.administracion_emails(administracion_id)
  WHERE recibe_facturacion AND activo;

CREATE TRIGGER trg_admin_emails_touch
  BEFORE UPDATE ON public.administracion_emails
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Solo un email principal por administración.
CREATE UNIQUE INDEX uq_admin_emails_principal
  ON public.administracion_emails(administracion_id)
  WHERE es_principal;

-- ---------------------------------------------------------------------------
-- RLS · administraciones + consorcios + administracion_emails
-- ---------------------------------------------------------------------------

-- administraciones
ALTER TABLE public.administraciones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS administraciones_select ON public.administraciones;
CREATE POLICY administraciones_select ON public.administraciones
  FOR SELECT TO authenticated USING (
    private.is_staff()
    OR (private.is_administrador() AND id = private.current_administracion_id())
  );

DROP POLICY IF EXISTS administraciones_write_staff ON public.administraciones;
CREATE POLICY administraciones_write_staff ON public.administraciones
  FOR ALL TO authenticated
  USING (private.is_staff())
  WITH CHECK (private.is_staff());

-- consorcios
ALTER TABLE public.consorcios ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS consorcios_select ON public.consorcios;
CREATE POLICY consorcios_select ON public.consorcios
  FOR SELECT TO authenticated USING (
    private.is_staff()
    OR (private.is_administrador() AND administracion_id = private.current_administracion_id())
  );

DROP POLICY IF EXISTS consorcios_write_staff ON public.consorcios;
CREATE POLICY consorcios_write_staff ON public.consorcios
  FOR ALL TO authenticated
  USING (private.is_staff())
  WITH CHECK (private.is_staff());

-- administracion_emails
ALTER TABLE public.administracion_emails ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admin_emails_select ON public.administracion_emails;
CREATE POLICY admin_emails_select ON public.administracion_emails
  FOR SELECT TO authenticated USING (
    private.is_staff()
    OR (private.is_administrador() AND administracion_id = private.current_administracion_id())
  );

DROP POLICY IF EXISTS admin_emails_write_staff ON public.administracion_emails;
CREATE POLICY admin_emails_write_staff ON public.administracion_emails
  FOR ALL TO authenticated
  USING (private.is_staff())
  WITH CHECK (private.is_staff());
