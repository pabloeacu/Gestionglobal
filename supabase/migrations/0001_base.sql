-- ============================================================================
-- 0001_base · profiles + config_global + helpers RLS + auditoría
-- Plataforma Gestión Global · single-tenant (DGG-01).
-- Cita el bagaje: D10 (auditoría día 1), P-DB-01 (tabla base), P-DB-05 (helpers
-- SECURITY DEFINER STABLE), P-DB-06 (migración segura). La regla 12 / E45 / E49
-- se reorienta del eje empresa al eje administracion (CLAUDE.md §3).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- helpers genéricos
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- config_global · fila singleton (sin tabla `empresas` por DGG-01).
-- Datos institucionales, fiscales, contador DNI ficticio (D07) y constantes
-- operativas (intervalo ARCA — D02).
-- ---------------------------------------------------------------------------
CREATE TABLE public.config_global (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  razon_social text NOT NULL DEFAULT 'Gestión Global',
  nombre_fantasia text NOT NULL DEFAULT 'Gestión Global',
  cuit text CHECK (cuit IS NULL OR cuit ~ '^\d{11}$'),
  condicion_iva text NOT NULL DEFAULT 'responsable_inscripto'
    CHECK (condicion_iva IN ('responsable_inscripto','monotributo','exento')),
  domicilio_fiscal text,
  localidad text,
  provincia text,
  codigo_postal text,
  email_contacto text,
  email_reply_to text,
  email_remitente_nombre text DEFAULT 'Gestión Global',
  telefono text,
  whatsapp text,
  logo_url text,
  sitio_web text DEFAULT 'gestionglobal.ar',
  proximo_dni_ficticio bigint NOT NULL DEFAULT 99000001
    CHECK (proximo_dni_ficticio BETWEEN 99000001 AND 99999999),
  arca_intervalo_emision_seg integer NOT NULL DEFAULT 15
    CHECK (arca_intervalo_emision_seg BETWEEN 5 AND 120),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_config_global_touch
  BEFORE UPDATE ON public.config_global
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

INSERT INTO public.config_global (id) VALUES (1)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- profiles · espejo de auth.users con rol y vínculo opcional a administracion.
-- La FK profiles.administracion_id → administraciones se agrega en 0002.
-- Roles (CLAUDE.md §3 / adaptación de doc 01 a single-tenant):
--   gerente       → los 2 socios, acceso total
--   operador      → granular (futuro)
--   administrador → cliente, ve sólo su administración
-- ---------------------------------------------------------------------------
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'administrador'
    CHECK (role IN ('gerente','operador','administrador')),
  administracion_id uuid,
  full_name text,
  phone text,
  avatar_url text,
  activo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_profiles_role ON public.profiles(role);
CREATE INDEX idx_profiles_administracion_id
  ON public.profiles(administracion_id)
  WHERE administracion_id IS NOT NULL;

CREATE TRIGGER trg_profiles_touch
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Trigger: crea profile al insertar auth.users (rol default 'administrador').
-- Si user_metadata trae role/full_name, los usa; sino, defaults.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.profiles (id, role, full_name)
  VALUES (
    NEW.id,
    COALESCE(NULLIF(NEW.raw_user_meta_data->>'role',''), 'administrador'),
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email)
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ---------------------------------------------------------------------------
-- helpers RLS · SECURITY DEFINER STABLE (P-DB-05). Evitan recursión RLS.
-- Eje de aislamiento en single-tenant: `administracion` para el rol cliente.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.is_gerente()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$ SELECT public.get_user_role() = 'gerente'; $$;

CREATE OR REPLACE FUNCTION public.is_operador()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$ SELECT public.get_user_role() = 'operador'; $$;

CREATE OR REPLACE FUNCTION public.is_administrador()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$ SELECT public.get_user_role() = 'administrador'; $$;

CREATE OR REPLACE FUNCTION public.is_staff()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$ SELECT public.get_user_role() IN ('gerente','operador'); $$;

CREATE OR REPLACE FUNCTION public.current_administracion_id()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT administracion_id FROM public.profiles WHERE id = auth.uid();
$$;

-- Tenancy guard reorientado al eje administracion (regla 12 / E45 / E49).
-- Llamar al inicio de TODA RPC SECURITY DEFINER que reciba p_administracion_id
-- y sea alcanzable por rol 'administrador'. Gerentes/operadores bypassan.
CREATE OR REPLACE FUNCTION public.assert_administracion_access(p_administracion_id uuid)
RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF public.is_staff() THEN
    RETURN;
  END IF;
  IF public.current_administracion_id() = p_administracion_id THEN
    RETURN;
  END IF;
  RAISE EXCEPTION USING
    ERRCODE = '42501',
    MESSAGE = 'Acceso denegado a la administración solicitada.';
END;
$$;

-- ---------------------------------------------------------------------------
-- RLS sobre profiles.
-- ---------------------------------------------------------------------------
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS profiles_select ON public.profiles;
CREATE POLICY profiles_select ON public.profiles
  FOR SELECT TO authenticated
  USING (public.is_staff() OR id = auth.uid());

-- El usuario puede tocar solo sus campos personales. El rol y administracion_id
-- los cambia un gerente vía RPC (a definir en 0002+).
DROP POLICY IF EXISTS profiles_update_self ON public.profiles;
CREATE POLICY profiles_update_self ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- ---------------------------------------------------------------------------
-- RLS sobre config_global. Lectura para todo autenticado, edición sólo gerente.
-- ---------------------------------------------------------------------------
ALTER TABLE public.config_global ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS config_global_select ON public.config_global;
CREATE POLICY config_global_select ON public.config_global
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS config_global_update_gerente ON public.config_global;
CREATE POLICY config_global_update_gerente ON public.config_global
  FOR UPDATE TO authenticated
  USING (public.is_gerente())
  WITH CHECK (public.is_gerente());

-- ---------------------------------------------------------------------------
-- Auditoría desde el día 1 (D10). Tabla insert-only + trigger genérico.
-- ---------------------------------------------------------------------------
CREATE TABLE public.auditoria_cambios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  entidad text NOT NULL,
  entidad_id uuid,
  operacion text NOT NULL CHECK (operacion IN ('INSERT','UPDATE','DELETE')),
  diff jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_auditoria_entidad
  ON public.auditoria_cambios(entidad, entidad_id, created_at DESC);
CREATE INDEX idx_auditoria_user
  ON public.auditoria_cambios(user_id, created_at DESC)
  WHERE user_id IS NOT NULL;

ALTER TABLE public.auditoria_cambios ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS auditoria_select_staff ON public.auditoria_cambios;
CREATE POLICY auditoria_select_staff ON public.auditoria_cambios
  FOR SELECT TO authenticated USING (public.is_staff());

CREATE OR REPLACE FUNCTION public.audit_row()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_entidad_id uuid;
  v_diff jsonb;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_entidad_id := (to_jsonb(OLD) ->> 'id')::uuid;
    v_diff := jsonb_build_object('old', to_jsonb(OLD));
  ELSIF TG_OP = 'UPDATE' THEN
    v_entidad_id := (to_jsonb(NEW) ->> 'id')::uuid;
    v_diff := jsonb_build_object('old', to_jsonb(OLD), 'new', to_jsonb(NEW));
  ELSE
    v_entidad_id := (to_jsonb(NEW) ->> 'id')::uuid;
    v_diff := jsonb_build_object('new', to_jsonb(NEW));
  END IF;

  INSERT INTO public.auditoria_cambios (user_id, entidad, entidad_id, operacion, diff)
  VALUES (auth.uid(), TG_TABLE_NAME, v_entidad_id, TG_OP, v_diff);

  RETURN COALESCE(NEW, OLD);
END;
$$;
