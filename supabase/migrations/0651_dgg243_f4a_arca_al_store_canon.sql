-- 0651 · DGG-243 · F4a (pivote) — ARCA migra al store credenciales_regulatorias (canon F1).
--
-- POR QUÉ (auditoría §6 de F4a, 3 agentes): la mig 0650 cifró la clave ARCA IN-PLACE en una columna
-- bytea de administraciones. Funciona, pero (G2) deja un CIRCUITO PARALELO que contradice el plan
-- ESCRITO de F1 (0644:9-14,22-23): "la clave NO va como columna de administraciones — ambas tienen
-- policy SELECT para el cliente dueño y el front usa select('*') → cualquier columna ahí (aun cifrada)
-- viajaría al browser del cliente. Por eso TABLA APARTE deny-all; la migración de ARCA al store va en
-- F4". Y (G1) el ciphertext de la columna es técnicamente select('*')-able por el cliente dueño. Este
-- pivote hace F4 como F1 lo diseñó: ARCA dentro del store genérico (plataforma='arca'), deny-all,
-- accedido sólo por las RPCs credencial_reg_*. Elimina G1 (nada sensible queda en administraciones),
-- G2 (una sola fuente/una sola familia de RPCs) y #17 (ya no viaja ciphertext en select('*')).
--
-- CÓMO sin tocar los triggers de sync de trámites (siguen escribiendo administraciones.clave_fiscal_arca
-- texto, que queda como LANDING transitorio, SIEMPRE NULL en reposo): se REUSA el trigger de absorción,
-- ahora AFTER INS/UPD (no BEFORE: en BEFORE INSERT la fila padre aún no existe y la FK del store fallaría)
-- que cifra el plaintext al store (fill-only) y auto-limpia el landing (recursión acotada a 1 no-op).
--   · Gerencia set/revelar/borrar/meta → RPCs credencial_reg_* (plataforma='arca').
--   · Autofill: cliente_perfil_datos_formulario descifra del store (subquery), no de la columna.
--   · Se dropean las RPCs paralelas admin_clave_arca_{revelar,set} y la columna bytea.
--
-- Reglas: R2/R5 (store deny-all por RPC SD), R6 (grants), R12 (credencial_reg_* ya gateadas staff/dueño),
-- R16 (credencial_reg_borrar net-new; autofill misma firma; DROP explícito de las 2 RPCs paralelas),
-- R17 (trigger SECDEF; el reveal audita en tabla RLS-only-escrita por SD). NO toca los 2 triggers de sync.

-- ============================================================================
-- 0. GUARD de Vault (sin cred_reg_key no se puede mover/cifrar sin perder datos — §6 C#16)
-- ============================================================================
DO $guard$ BEGIN
  IF private.cred_reg_key() IS NULL THEN
    RAISE EXCEPTION 'cred_reg_key ausente en Vault — abortando pivote ARCA para no perder claves';
  END IF;
END $guard$;

-- ============================================================================
-- 1. MOVER las claves ARCA cifradas de la columna al store (ciphertext DIRECTO: misma clave/algoritmo,
--    no hace falta descifrar/re-cifrar). Fill-only por si ya existiera una fila 'arca'.
-- ============================================================================
INSERT INTO public.credenciales_regulatorias AS c
  (administracion_id, plataforma, usuario, password_cifrada, estado, updated_by, updated_at)
SELECT a.id, 'arca', NULL, a.clave_fiscal_arca_cifrada, 'publicado', NULL, now()
  FROM public.administraciones a
 WHERE a.clave_fiscal_arca_cifrada IS NOT NULL
ON CONFLICT (administracion_id, plataforma) DO UPDATE SET
  password_cifrada = COALESCE(c.password_cifrada, EXCLUDED.password_cifrada),
  estado = CASE WHEN c.password_cifrada IS NULL AND c.estado IS DISTINCT FROM 'propuesto'
                THEN 'publicado' ELSE c.estado END,
  updated_at = CASE WHEN c.password_cifrada IS NULL THEN now() ELSE c.updated_at END
WHERE c.password_cifrada IS NULL;

-- ============================================================================
-- 2. Trigger de absorción → ahora drena al STORE (fill-only) y auto-limpia el landing.
--    AFTER INS/UPD: en AFTER la fila de administraciones ya existe → la FK del store es satisfacible.
-- ============================================================================
CREATE OR REPLACE FUNCTION private.admin_clave_arca_cifrar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE v_key text; v_val text := NULLIF(btrim(NEW.clave_fiscal_arca), '');
BEGIN
  -- Early-exit (corta también la recursión del auto-limpiado de abajo: ese UPDATE deja clave NULL).
  IF v_val IS NULL THEN RETURN NULL; END IF;
  -- RESILIENCIA Vault (los 2 triggers de sync envuelven su write en EXCEPTION WHEN OTHERS THEN NULL:
  -- si acá lanzáramos, se tragarían el error y perderían sus 18 campos). Ante Vault-missing NO rompemos:
  -- limpiamos igual el plaintext (no persiste en claro) y avisamos; un write posterior con Vault lo cifra.
  v_key := private.cred_reg_key();
  IF v_key IS NOT NULL THEN
    -- Fill-only al store (preserva la semántica COALESCE de los triggers de sync y no pisa una clave
    -- cargada por gerencia ni una propuesta en curso): sólo escribe si no hay password publicada.
    INSERT INTO public.credenciales_regulatorias AS c
      (administracion_id, plataforma, password_cifrada, estado, updated_at)
    VALUES (NEW.id, 'arca', extensions.pgp_sym_encrypt(v_val, v_key), 'publicado', now())
    ON CONFLICT (administracion_id, plataforma) DO UPDATE SET
      password_cifrada = EXCLUDED.password_cifrada,
      estado = CASE WHEN c.estado IS DISTINCT FROM 'propuesto' THEN 'publicado' ELSE c.estado END,
      updated_at = now()
    WHERE c.password_cifrada IS NULL;
  ELSE
    RAISE WARNING '[admin_clave_arca_cifrar] Vault cred_reg_key no disponible — clave ARCA de admin % no persistida (reintento en el próximo write)', NEW.id;
  END IF;
  -- El landing (columna plaintext) NUNCA persiste. Self-UPDATE → re-dispara el trigger con clave NULL
  -- → early-exit (recursión acotada a 1 no-op). Sólo si quedó algo que limpiar.
  IF NEW.clave_fiscal_arca IS NOT NULL THEN
    UPDATE public.administraciones SET clave_fiscal_arca = NULL WHERE id = NEW.id;
  END IF;
  RETURN NULL;  -- AFTER trigger: el valor de retorno se ignora
END $fn$;

DROP TRIGGER IF EXISTS trg_admin_clave_arca_cifrar ON public.administraciones;
CREATE TRIGGER trg_admin_clave_arca_cifrar
  AFTER INSERT OR UPDATE OF clave_fiscal_arca ON public.administraciones
  FOR EACH ROW EXECUTE FUNCTION private.admin_clave_arca_cifrar();

-- ============================================================================
-- 3. credencial_reg_borrar — borra el secreto PUBLICADO de una credencial (staff-only). Repone la
--    capacidad de LIMPIAR que gerencia tenía antes de F4a (R15), de forma genérica para la familia F1.
--    (El drawer trata "vacío = conservar"; borrar es una acción explícita desde la ficha.)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.credencial_reg_borrar(
  p_administracion_id uuid,
  p_plataforma        text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'solo gerencia puede borrar credenciales' USING ERRCODE = '42501';
  END IF;
  IF p_plataforma NOT IN ('ddjj','arca') THEN
    RAISE EXCEPTION 'plataforma inválida: %', p_plataforma USING ERRCODE = '22023';
  END IF;
  -- Nula el secreto publicado + usuario; conserva la fila y una eventual propuesta (prop_*).
  UPDATE public.credenciales_regulatorias
     SET password_cifrada = NULL, usuario = NULL, updated_by = auth.uid(), updated_at = now()
   WHERE administracion_id = p_administracion_id AND plataforma = p_plataforma;
END $fn$;
REVOKE ALL ON FUNCTION public.credencial_reg_borrar(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.credencial_reg_borrar(uuid, text) TO authenticated;

-- ============================================================================
-- 4. Autofill: la clave ARCA se descifra del STORE (no de la columna, que se dropea). Misma firma.
--    Sólo cambia el origen de clave_fiscal_arca; todo lo demás queda byte-equivalente a 0650.
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
      -- F4a (pivote): la clave ARCA vive cifrada en el store credenciales_regulatorias (plataforma='arca',
      -- estado='publicado'). Se descifra server-side para el DUEÑO logueado (autollena su propia clave, sin
      -- cambio de UX). Guards: Vault presente + password no-NULL (pgp_sym_decrypt es STRICT) → NULL limpio.
      (SELECT CASE WHEN private.cred_reg_key() IS NOT NULL AND cr.password_cifrada IS NOT NULL
                   THEN extensions.pgp_sym_decrypt(cr.password_cifrada, private.cred_reg_key())
                   ELSE NULL END
         FROM public.credenciales_regulatorias cr
        WHERE cr.administracion_id = a.id AND cr.plataforma = 'arca' AND cr.estado = 'publicado'
        LIMIT 1) AS clave_fiscal_arca,
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

-- ============================================================================
-- 5. Retirar el circuito paralelo: RPCs admin_clave_arca_* (0650) y la columna bytea.
--    (Ya nada las referencia: autofill repunteado, front pasa a credencial_reg_*.)
-- ============================================================================
DROP FUNCTION IF EXISTS public.admin_clave_arca_revelar(uuid);
DROP FUNCTION IF EXISTS public.admin_clave_arca_set(uuid, text);
ALTER TABLE public.administraciones DROP COLUMN IF EXISTS clave_fiscal_arca_cifrada;

-- La columna landing clave_fiscal_arca (text) SE CONSERVA: los 2 triggers de sync la escriben sin
-- cambios; el trigger de arriba la drena al store y la deja SIEMPRE NULL en reposo.
COMMENT ON COLUMN public.administraciones.clave_fiscal_arca IS
  'DGG-243 F4a (pivote 0651) · LANDING transitorio. Los triggers de sync escriben acá el plaintext desde el '
  'jsonb de submission; el trigger AFTER trg_admin_clave_arca_cifrar lo cifra al store credenciales_regulatorias '
  '(plataforma=arca) y lo deja SIEMPRE NULL en reposo. La clave NO vive acá: fuente de verdad = el store deny-all.';

-- ----------------------------------------------------------------------------
-- SMOKES (MCP, DO $$ … ROLLBACK) — ver cierre del chunk:
--   M1 move: 48 filas 'arca' en el store con password_cifrada que descifra == original; columna dropeada
--   T1 trigger drain (UPDATE): set clave en admin sin 'arca' → store fill + landing NULL
--   T1b trigger drain (INSERT): nueva admin con clave → store 'arca' publicado + landing NULL (FK OK en AFTER)
--   T2 fill-only: 2º write con otra clave (vía sync, sin RPC) → NO pisa el store
--   S1 set (credencial_reg_set 'arca', staff): pisa; B1 borrar (credencial_reg_borrar): deja tiene_password=false
--   R1 revelar (credencial_reg_revelar 'arca', staff): descifra + audita; no-staff → 42501
--   A1 autofill: devuelve la clave DESCIFRADA del store para el dueño; A1b dueño sin 'arca' → prefill sin clave, sin error
--   SYNC e2e: INSERT/UPDATE sintético submission→admin (triggers de sync intactos) deja la clave en el store, landing NULL
--   R16: SELECT proname ... HAVING count(*)>1 → 0 filas
-- ----------------------------------------------------------------------------
