-- 0650 · DGG-243 · F4a — Cifrado at-rest de la clave fiscal ARCA de administraciones + cierre de fuga.
--
-- Misión (Pablo): "respecto de las claves, debe sumarse seguridad, pero no limitarse la funcionalidad
-- para ninguna de las partes" (gestoría, autofill, gerencia, cliente). Hoy administraciones.clave_fiscal_arca
-- es TEXTO PLANO (E-GG-32) y se filtra al browser del cliente (getAdministracion select('*') en PortalLayout,
-- aunque sólo usa .nombre) + la devuelve el RPC de autofill. Recon (2 agentes): la columna la consumen SÓLO
-- autofill (RPC server) + gerencia (display/edit) + la fuga; la GESTORÍA lee otra fuente (el jsonb de la
-- submission, F4b aparte). Los ~18 campos de los 2 triggers de sync son trámite-críticos.
--
-- DISEÑO (bajo riesgo, NO toca los triggers de sync): se cifra la clave IN-PLACE en una columna bytea
-- (misma cripto que DDJJ: extensions.pgp_sym_encrypt + Vault cred_reg_key). Un BEFORE INS/UPD trigger
-- en administraciones intercepta cualquier escritura de clave_fiscal_arca (plaintext) y la MUEVE a
-- clave_fiscal_arca_cifrada + anula el plaintext → los 2 triggers de sync siguen escribiendo el plaintext
-- SIN CAMBIOS (fill-only preservado contra la cifrada); el plaintext NUNCA persiste en reposo.
--   · Gerencia edita por RPC admin_clave_arca_set (escribe cifrada directo → overwrite intencional).
--   · Gerencia revela por admin_clave_arca_revelar (descifra on-demand + auditado).
--   · Autofill: el RPC cliente_perfil_datos_formulario descifra la cifrada antes de devolverla (el cliente
--     logueado sigue autollenando su propia clave, sin cambio de UX).
--   · Fuga: la columna plaintext queda siempre NULL → getAdministracion ya no la filtra; el portal pasa
--     a una query de sólo-nombre (front).
-- La clave viaja en claro SÓLO server-side (descifrada en el RPC de autofill para el dueño, y en el reveal
-- para staff) — nunca en reposo ni en un select('*') del cliente.
--
-- Reglas: R2/R5 (acceso al secreto por RPC SD), R6 (grants), R12 (reveal/set gateados staff), R16 (RPCs
-- net-new + CREATE OR REPLACE misma firma del autofill), R17 (trigger SECDEF). NO cambia los 2 triggers de
-- sync (sync_submission_a_administracion / backfill_admin_desde_tramite_submission) → cero riesgo sobre su
-- lógica de 18 campos. El jsonb de submissions se trata en F4b.

-- ============================================================================
-- 1. Columna cifrada + backfill (ANTES de crear el trigger, para que el backfill no lo dispare)
-- ============================================================================
ALTER TABLE public.administraciones ADD COLUMN IF NOT EXISTS clave_fiscal_arca_cifrada bytea;
COMMENT ON COLUMN public.administraciones.clave_fiscal_arca_cifrada IS
  'DGG-243 F4a · Clave fiscal ARCA cifrada (pgcrypto pgp_sym_encrypt, clave Vault cred_reg_key). Reemplaza '
  'a clave_fiscal_arca (texto plano, E-GG-32), que ahora queda SIEMPRE NULL en reposo (un BEFORE trigger la '
  'mueve acá). Acceso al valor sólo por RPC SD (autofill descifra para el dueño; admin_clave_arca_revelar '
  'para staff, auditado). El select(*) del cliente ya no filtra la clave.';

-- GUARD de Vault (§6 C#16): pgp_sym_encrypt es STRICT → encrypt(clave, NULL)=NULL. Si cred_reg_key
-- faltara al aplicar (branch/preview/restore/rename del secret), el backfill nulearía la cifrada Y el
-- plaintext a la vez → PÉRDIDA irreversible de las 48 claves. Abortar antes de tocar una sola fila.
DO $guard$ BEGIN
  IF private.cred_reg_key() IS NULL THEN
    RAISE EXCEPTION 'cred_reg_key ausente en Vault — abortando backfill F4a para no destruir claves ARCA';
  END IF;
END $guard$;

-- Backfill: cifrar las 48 existentes y anular el plaintext. (Sin trigger aún → UPDATE directo.)
UPDATE public.administraciones
   SET clave_fiscal_arca_cifrada = extensions.pgp_sym_encrypt(btrim(clave_fiscal_arca), private.cred_reg_key()),
       clave_fiscal_arca = NULL
 WHERE clave_fiscal_arca IS NOT NULL AND btrim(clave_fiscal_arca) <> '';
-- Normalizar cualquier string vacío remanente a NULL.
UPDATE public.administraciones SET clave_fiscal_arca = NULL
 WHERE clave_fiscal_arca IS NOT NULL AND btrim(clave_fiscal_arca) = '';

-- ============================================================================
-- 2. BEFORE trigger: mueve plaintext → cifrada (fill-only), anula el plaintext. Absorbe los triggers de sync.
-- ============================================================================
CREATE OR REPLACE FUNCTION private.admin_clave_arca_cifrar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE v_key text; v_val text := NULLIF(btrim(NEW.clave_fiscal_arca), '');
BEGIN
  -- Sólo actúa si esta escritura trae un valor de clave plaintext (99% de los writes de
  -- administraciones NO tocan la clave → no-op, cero costo).
  IF v_val IS NULL THEN
    NEW.clave_fiscal_arca := NULL;  -- normaliza '' → NULL
    RETURN NEW;
  END IF;
  -- RESILIENCIA: los 2 triggers de sync envuelven su UPDATE en EXCEPTION WHEN OTHERS THEN NULL.
  -- Si acá lanzáramos (Vault caído), el sync se tragaría el error y perdería los 18 campos en silencio.
  -- Por eso ante Vault-missing NO rompemos: dejamos el plaintext tal cual (comportamiento viejo, degradación
  -- temporal) — un write posterior con Vault disponible lo cifra. Vault es confiable (DDJJ F1-F3 lo usan en prod).
  v_key := private.cred_reg_key();
  IF v_key IS NULL THEN
    RAISE WARNING '[admin_clave_arca_cifrar] Vault cred_reg_key no disponible — clave ARCA queda en claro temporalmente (admin %)', NEW.id;
    RETURN NEW;  -- no toca el plaintext; no rompe el sync
  END IF;
  -- Fill-only (preserva la semántica de los triggers de sync): si ya hay cifrada, NO se pisa.
  -- La gerencia que quiere pisar usa admin_clave_arca_set (escribe cifrada directo, NEW.clave_fiscal_arca NULL).
  IF (TG_OP = 'INSERT') OR (OLD.clave_fiscal_arca_cifrada IS NULL) THEN
    NEW.clave_fiscal_arca_cifrada := extensions.pgp_sym_encrypt(v_val, v_key);
  END IF;
  NEW.clave_fiscal_arca := NULL;  -- el plaintext NUNCA persiste (salvo Vault-missing, arriba)
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_admin_clave_arca_cifrar ON public.administraciones;
CREATE TRIGGER trg_admin_clave_arca_cifrar
  BEFORE INSERT OR UPDATE OF clave_fiscal_arca ON public.administraciones
  FOR EACH ROW EXECUTE FUNCTION private.admin_clave_arca_cifrar();

-- ============================================================================
-- 3. RPC reveal (staff, descifra on-demand + auditado). Reusa el log de accesos de credenciales.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.admin_clave_arca_revelar(p_administracion_id uuid)
RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE v_cipher bytea; v_key text; v_pwd text;
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'solo gerencia puede revelar la clave ARCA' USING ERRCODE = '42501';
  END IF;
  SELECT clave_fiscal_arca_cifrada INTO v_cipher
    FROM public.administraciones WHERE id = p_administracion_id;
  IF v_cipher IS NULL THEN RETURN NULL; END IF;
  v_key := private.cred_reg_key();
  IF v_key IS NULL THEN
    RAISE EXCEPTION 'clave de cifrado no configurada (Vault: cred_reg_key)' USING ERRCODE = '55000';
  END IF;
  v_pwd := extensions.pgp_sym_decrypt(v_cipher, v_key);
  INSERT INTO public.credenciales_regulatorias_accesos (administracion_id, plataforma, accedido_por, rol, accion)
  VALUES (p_administracion_id, 'arca', auth.uid(), 'staff', 'revelar_columna_arca');
  RETURN v_pwd;
END $fn$;
REVOKE ALL ON FUNCTION public.admin_clave_arca_revelar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_clave_arca_revelar(uuid) TO authenticated;

-- ============================================================================
-- 4. RPC set (staff, escribe cifrada directo → overwrite intencional de gerencia). Vacío = borra la clave.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.admin_clave_arca_set(p_administracion_id uuid, p_clave text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE v_key text; v_val text := NULLIF(btrim(p_clave), '');
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'solo gerencia puede cargar la clave ARCA' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.administraciones WHERE id = p_administracion_id) THEN
    RAISE EXCEPTION 'administración inexistente' USING ERRCODE = '23503';
  END IF;
  IF v_val IS NULL THEN
    -- Borrado explícito de la clave por gerencia.
    UPDATE public.administraciones
       SET clave_fiscal_arca_cifrada = NULL, clave_fiscal_arca = NULL, updated_at = now()
     WHERE id = p_administracion_id;
    RETURN;
  END IF;
  v_key := private.cred_reg_key();
  IF v_key IS NULL THEN
    RAISE EXCEPTION 'clave de cifrado no configurada (Vault: cred_reg_key)' USING ERRCODE = '55000';
  END IF;
  -- Escribe la cifrada DIRECTO (clave_fiscal_arca queda NULL → el BEFORE trigger es no-op → overwrite real).
  UPDATE public.administraciones
     SET clave_fiscal_arca_cifrada = extensions.pgp_sym_encrypt(v_val, v_key),
         clave_fiscal_arca = NULL, updated_at = now()
   WHERE id = p_administracion_id;
END $fn$;
REVOKE ALL ON FUNCTION public.admin_clave_arca_set(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_clave_arca_set(uuid, text) TO authenticated;

-- ============================================================================
-- 5. Autofill: descifrar la cifrada antes de devolver (cliente logueado autollena su propia clave, sin cambio de UX).
--    Misma firma (CREATE OR REPLACE), sólo cambia el origen de clave_fiscal_arca (de columna plaintext → descifrado).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.cliente_perfil_datos_formulario()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id uuid; v_email text; v_profile record; v_admin record; v_dni_previo text; v_cuit_previo text;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RETURN '{}'::jsonb; END IF;
  SELECT email INTO v_email FROM auth.users WHERE id = v_user_id;
  SELECT full_name, phone, administracion_id, role INTO v_profile FROM public.profiles WHERE id = v_user_id;
  IF v_profile.administracion_id IS NOT NULL THEN
    SELECT a.nombre, a.responsable_nombre, a.responsable_apellido, a.responsable_dni, a.cuit,
      a.condicion_iva, a.domicilio_fiscal, a.direccion, a.localidad, a.provincia, a.codigo_postal,
      a.telefono AS admin_telefono, a.whatsapp, a.email AS admin_email, a.matricula_rpac, a.matricula_rpa,
      a.padre_apellido_nombre, a.madre_apellido_nombre, a.legajo_rpac,
      -- F4a: la clave ARCA ya no está en texto plano en la columna → se descifra de la cifrada.
      -- Guard Vault-missing: si no hay clave de cifrado, devuelve NULL (sólo ese campo) sin romper el prefill.
      CASE WHEN private.cred_reg_key() IS NOT NULL
           THEN extensions.pgp_sym_decrypt(a.clave_fiscal_arca_cifrada, private.cred_reg_key())
           ELSE NULL END AS clave_fiscal_arca,
      a.matricula_rpac_vencimiento
    INTO v_admin FROM public.administraciones a WHERE a.id = v_profile.administracion_id;
  END IF;
  SELECT COALESCE(datos->>'dni', datos->>'dni_solicitante', datos->>'dni_persona_fisica', datos->>'documento') AS dni,
    COALESCE(datos->>'cuit', datos->>'cuit_persona_juridica', datos->>'cuit_solicitante') AS cuit
  INTO v_dni_previo, v_cuit_previo
  FROM public.formulario_submissions fs WHERE fs.email_contacto = v_email ORDER BY fs.created_at DESC LIMIT 1;
  RETURN jsonb_strip_nulls(jsonb_build_object(
    'nombre', COALESCE(v_admin.responsable_nombre, v_profile.full_name),
    'apellido', v_admin.responsable_apellido, 'apellido_nombre', v_profile.full_name,
    'nombre_completo', v_profile.full_name, 'nombre_apellido', v_profile.full_name,
    'email', v_email, 'correo', v_email, 'correo_electronico', v_email, 'mail', v_email,
    'telefono', COALESCE(v_profile.phone, v_admin.admin_telefono),
    'tel', COALESCE(v_profile.phone, v_admin.admin_telefono),
    'celular', COALESCE(v_profile.phone, v_admin.admin_telefono),
    'whatsapp', COALESCE(v_admin.whatsapp, v_profile.phone),
    'dni', COALESCE(v_admin.responsable_dni, v_dni_previo),
    'documento', COALESCE(v_admin.responsable_dni, v_dni_previo),
    'cuit', COALESCE(v_admin.cuit, v_cuit_previo), 'cuit_cuil', COALESCE(v_admin.cuit, v_cuit_previo),
    'cuit_persona_juridica', COALESCE(v_admin.cuit, v_cuit_previo),
    'razon_social', v_admin.nombre, 'condicion_iva', v_admin.condicion_iva,
    'domicilio_fiscal', v_admin.domicilio_fiscal, 'direccion', v_admin.direccion,
    'localidad', v_admin.localidad, 'provincia', v_admin.provincia,
    'codigo_postal', v_admin.codigo_postal, 'cp', v_admin.codigo_postal,
    'matricula', COALESCE(v_admin.matricula_rpac, v_admin.matricula_rpa),
    'matricula_rpac', v_admin.matricula_rpac, 'numero_matricula_rpac', v_admin.matricula_rpac,
    'matricula_rpa', v_admin.matricula_rpa,
    'matricula_rpac_vencimiento', to_char(v_admin.matricula_rpac_vencimiento, 'YYYY-MM-DD'),
    'responsable_nombre', v_admin.responsable_nombre, 'responsable_apellido', v_admin.responsable_apellido,
    'padre_apellido_nombre', v_admin.padre_apellido_nombre, 'apellido_nombre_padre', v_admin.padre_apellido_nombre,
    'madre_apellido_nombre', v_admin.madre_apellido_nombre, 'apellido_nombre_madre', v_admin.madre_apellido_nombre,
    'legajo_rpac', v_admin.legajo_rpac, 'numero_legajo_rpac', v_admin.legajo_rpac, 'numero_legajo', v_admin.legajo_rpac,
    'clave_fiscal_arca', v_admin.clave_fiscal_arca,
    '_cuit_ficha', v_admin.cuit, '_user_id', v_user_id, '_origen', 'portal'
  ));
END;
$function$;

-- ----------------------------------------------------------------------------
-- SMOKES (MCP, DO $$ … ROLLBACK):
--   B1 backfill: 48 admins con clave → cifrada no-null + plaintext NULL; descifra == original
--   T1 trigger fill: UPDATE clave_fiscal_arca='x' en admin sin cifrada → cifrada set, plaintext NULL
--   T2 trigger fill-only: 2º UPDATE con otra clave (sin pasar por set) → NO pisa la cifrada
--   S1 set (staff): admin_clave_arca_set pisa la cifrada; '' borra; no-staff → 42501
--   R1 revelar (staff): descifra + audita; no-staff → 42501
--   A1 autofill: cliente_perfil_datos_formulario devuelve la clave DESCIFRADA para el dueño
--   SYNC: un INSERT/UPDATE sintético de submission→admin (trigger sync intacto) deja la clave cifrada
--   FUGA: getAdministracion select('*') devuelve clave_fiscal_arca NULL (plaintext ya no existe)
-- ----------------------------------------------------------------------------
