-- 0644 · DGG-243 · F1 — Base cifrada de credenciales regulatorias (store + cripto + RPCs).
--
-- Misión DDJJ (Pablo): guardar usuario+contraseña del Portal de DDJJ (misgestiones.com.ar) para
-- que gestoría/gerencia las carguen (gemelo de "Cargar otorgamiento") y el cliente las vea en su
-- portal. La CONTRASEÑA es un secreto REVERSIBLE (hay que mostrársela al cliente) → NO hash.
-- Se diseña un store GENÉRICO (plataforma: 'ddjj' hoy, 'arca' en F4) para absorber a futuro la
-- clave fiscal ARCA sin circuito paralelo (valor-prop DGG-243).
--
-- DECISIÓN DE SEGURIDAD (recon DGG-243, verificada por SQL): la clave NO va como columna de
-- perfil_regulatorio ni de administraciones — ambas tienen policy SELECT para el cliente dueño y
-- el front usa select('*') (p. ej. getPerfilRegulatorioDeclarado, getAdministracion) → cualquier
-- columna ahí (aun cifrada) viajaría al browser del cliente. Por eso: TABLA APARTE, RLS activa
-- SIN policy permisiva (deny-all a acceso directo), y TODO acceso por RPC SECURITY DEFINER
-- (owner=postgres), gateado por private.is_staff() / private.assert_administracion_access() (R12).
-- Cifrado: pgcrypto extensions.pgp_sym_encrypt con clave simétrica en Vault (receta private.cron_bearer,
-- mig 0494). La clave de Vault (secret `cred_reg_key`) se seedea FUERA de esta migración (igual que
-- `cron_secret`) para no commitearla.
--
-- Alcance F1: STORE + RPC de carga directa de GERENCIA (estado 'publicado') + lectura (meta sin
-- password / revelar con password on-demand + auditoría de reveals). El carril de PROPUESTA de
-- gestoría + moderación (publicar / guardar-sin-publicar / descartar), el modal y la sección del
-- portal van en F2/F3; la migración de ARCA al store va en F4 (con regresión total sobre gestoría +
-- rellenado automático de formularios, sin quitar funcionalidad).
--
-- Reglas: R2 (RLS), R3 (secretos fuera del front), R5 (multi-tabla → RPC SD), R6 (store sensible: NO
-- grant a authenticated — desviación consciente y documentada; sólo RPC), R12 (tenancy guard), R16
-- (RPCs net-new, cero overload), R17 (audit RLS-only-escrito por SD). 100% ADITIVO: no modifica
-- ningún objeto existente.

-- ============================================================================
-- 1. STORE cifrado (genérico: ddjj | arca)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.credenciales_regulatorias (
  administracion_id uuid NOT NULL REFERENCES public.administraciones(id) ON DELETE CASCADE,
  plataforma        text NOT NULL CHECK (plataforma IN ('ddjj','arca')),
  usuario           text,                 -- NO secreto (usuario/CUIT del portal externo)
  password_cifrada  bytea,                -- pgcrypto pgp_sym_encrypt (reversible); NUNCA en texto plano
  key_version       int  NOT NULL DEFAULT 1,
  estado            text NOT NULL DEFAULT 'publicado'
                         CHECK (estado IN ('borrador','propuesto','publicado','descartado')),
  moderada_por      uuid, moderada_at timestamptz,
  updated_by        uuid, updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (administracion_id, plataforma)
);
COMMENT ON TABLE public.credenciales_regulatorias IS
  'DGG-243 · Store cifrado de credenciales de portales externos (ddjj=misgestiones.com.ar, arca, …). '
  'password_cifrada = pgcrypto pgp_sym_encrypt con clave en Vault (secret cred_reg_key). '
  'RLS ON sin policy permisiva (deny-all a acceso directo) — DESVIACIÓN CONSCIENTE de R6: NO se otorga a '
  'authenticated/anon; TODO acceso por RPC SECURITY DEFINER (owner postgres) gateado por '
  'is_staff()/assert_administracion_access(). Así la contraseña (aun cifrada) nunca viaja a un select(*) '
  'del front. Fuente ÚNICA para carga (gerencia/gestoría) y lectura (portal del cliente).';

ALTER TABLE public.credenciales_regulatorias ENABLE ROW LEVEL SECURITY;
-- Sin policy permisiva a propósito: deny-all al acceso directo. Acceso solo por RPCs SECURITY DEFINER.
-- (R2 OK: RLS activa; no existe USING(true).) service_role (uso interno) bypassa RLS por rol.

CREATE INDEX IF NOT EXISTS idx_cred_reg_admin ON public.credenciales_regulatorias(administracion_id);

-- Auditoría append-only de REVELADOS de contraseña (trazabilidad; valor-prop DGG-243).
CREATE TABLE IF NOT EXISTS public.credenciales_regulatorias_accesos (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  administracion_id uuid NOT NULL,
  plataforma        text NOT NULL,
  accedido_por      uuid,
  rol               text,
  accion            text NOT NULL DEFAULT 'revelar',
  at                timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.credenciales_regulatorias_accesos IS
  'DGG-243 · Log append-only de accesos (reveal) a contraseñas de credenciales_regulatorias. '
  'RLS ON sin policy (deny-all directo); sólo escribe la RPC credencial_reg_revelar (SECURITY DEFINER, R17).';
ALTER TABLE public.credenciales_regulatorias_accesos ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_cred_reg_accesos_admin ON public.credenciales_regulatorias_accesos(administracion_id, at DESC);

-- Supabase otorga por default-privileges ALL a anon/authenticated en tablas nuevas de public
-- (gotcha pre-mig-0130). Para un store de secretos eso NO va → REVOCAR: sólo postgres/service_role
-- (server-side, bypass RLS) + las RPCs SECURITY DEFINER acceden. Cliente/anon: cero acceso directo.
REVOKE ALL ON public.credenciales_regulatorias          FROM authenticated, anon;
REVOKE ALL ON public.credenciales_regulatorias_accesos  FROM authenticated, anon;

-- ============================================================================
-- 2. Lector de la clave simétrica desde Vault (receta private.cron_bearer, mig 0494)
-- ============================================================================
CREATE OR REPLACE FUNCTION private.cred_reg_key()
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cred_reg_key' LIMIT 1;
$fn$;
REVOKE ALL ON FUNCTION private.cred_reg_key() FROM PUBLIC, anon, authenticated;

-- ============================================================================
-- 3. RPCs (SECURITY DEFINER, owner postgres). F1: carga directa gerencia + lectura.
-- ============================================================================

-- 3.1 Carga/edición directa por GERENCIA (staff-only) → estado 'publicado'. COALESCE: no pisa lo
--     existente si no se manda el campo (misma semántica que tracking_cargar_otorgamiento).
CREATE OR REPLACE FUNCTION public.credencial_reg_set(
  p_administracion_id uuid,
  p_plataforma        text,
  p_usuario           text,
  p_password          text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE v_key text;
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'solo gerencia puede cargar credenciales' USING ERRCODE = '42501';
  END IF;
  IF p_plataforma NOT IN ('ddjj','arca') THEN
    RAISE EXCEPTION 'plataforma inválida: %', p_plataforma USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.administraciones WHERE id = p_administracion_id) THEN
    RAISE EXCEPTION 'administración inexistente' USING ERRCODE = '23503';
  END IF;
  v_key := private.cred_reg_key();
  IF v_key IS NULL THEN
    RAISE EXCEPTION 'clave de cifrado no configurada (Vault: cred_reg_key)' USING ERRCODE = '55000';
  END IF;

  INSERT INTO public.credenciales_regulatorias AS c
    (administracion_id, plataforma, usuario, password_cifrada, estado, updated_by, updated_at)
  VALUES (
    p_administracion_id,
    p_plataforma,
    NULLIF(btrim(p_usuario), ''),
    CASE WHEN NULLIF(p_password, '') IS NULL THEN NULL
         ELSE extensions.pgp_sym_encrypt(p_password, v_key) END,
    'publicado',
    auth.uid(),
    now()
  )
  ON CONFLICT (administracion_id, plataforma) DO UPDATE SET
    usuario          = COALESCE(NULLIF(btrim(EXCLUDED.usuario), ''), c.usuario),
    password_cifrada = COALESCE(EXCLUDED.password_cifrada, c.password_cifrada),
    estado           = 'publicado',
    updated_by       = auth.uid(),
    updated_at       = now();
END $fn$;
REVOKE ALL ON FUNCTION public.credencial_reg_set(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.credencial_reg_set(uuid, text, text, text) TO authenticated;

-- 3.2 Metadata (SIN password): usuario + si tiene password + estado + updated_at. Tenancy R12.
--     El cliente sólo ve metadata de credenciales 'publicado'.
CREATE OR REPLACE FUNCTION public.credencial_reg_meta(
  p_administracion_id uuid,
  p_plataforma        text
) RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE v_staff boolean := private.is_staff(); r record;
BEGIN
  PERFORM private.assert_administracion_access(p_administracion_id);  -- R12: staff o dueño
  SELECT usuario, (password_cifrada IS NOT NULL) AS tiene_password, estado, updated_at
    INTO r
    FROM public.credenciales_regulatorias
    WHERE administracion_id = p_administracion_id AND plataforma = p_plataforma;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('existe', false);
  END IF;
  IF NOT v_staff AND r.estado <> 'publicado' THEN
    RETURN jsonb_build_object('existe', false);   -- borrador/propuesto no se muestra al cliente
  END IF;
  RETURN jsonb_build_object(
    'existe', true,
    'usuario', r.usuario,
    'tiene_password', r.tiene_password,
    'estado', r.estado,
    'updated_at', r.updated_at
  );
END $fn$;
REVOKE ALL ON FUNCTION public.credencial_reg_meta(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.credencial_reg_meta(uuid, text) TO authenticated;

-- 3.3 Revelar password (descifra on-demand). Única puerta de salida del secreto. Tenancy R12 +
--     auditoría (R17). El cliente sólo revela 'publicado'.
CREATE OR REPLACE FUNCTION public.credencial_reg_revelar(
  p_administracion_id uuid,
  p_plataforma        text
) RETURNS text
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE v_staff boolean := private.is_staff(); v_cipher bytea; v_estado text; v_key text; v_pwd text;
BEGIN
  PERFORM private.assert_administracion_access(p_administracion_id);  -- R12
  SELECT password_cifrada, estado INTO v_cipher, v_estado
    FROM public.credenciales_regulatorias
    WHERE administracion_id = p_administracion_id AND plataforma = p_plataforma;
  IF v_cipher IS NULL THEN RETURN NULL; END IF;
  IF NOT v_staff AND v_estado <> 'publicado' THEN RETURN NULL; END IF;

  v_key := private.cred_reg_key();
  v_pwd := extensions.pgp_sym_decrypt(v_cipher, v_key);

  INSERT INTO public.credenciales_regulatorias_accesos (administracion_id, plataforma, accedido_por, rol)
  VALUES (p_administracion_id, p_plataforma, auth.uid(), CASE WHEN v_staff THEN 'staff' ELSE 'cliente' END);

  RETURN v_pwd;
END $fn$;
REVOKE ALL ON FUNCTION public.credencial_reg_revelar(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.credencial_reg_revelar(uuid, text) TO authenticated;
