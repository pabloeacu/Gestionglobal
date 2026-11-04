-- 0645 · DGG-243 · F1 hardening — capitaliza la auditoría adversarial §6 de la mig 0644.
--
-- Los 3 auditores dieron VEREDICTO=LISTO (0 críticos); esto cierra los hallazgos bajos/defensa-en-
-- profundidad para dejar el store de secretos "inmejorable" (premisa #0):
--   · revelar: agrega el guard `v_key IS NULL` que faltaba (simetría con set) → si Vault pierde la
--     clave, falla claro (55000) en vez de devolver NULL silencioso + loguear un acceso espurio.
--   · set: rechaza un alta totalmente vacía (usuario y password NULL en fila nueva) → no crea filas
--     'publicado' huecas.
--   · meta/revelar: chequeo de tenencia INLINE (private.current_administracion_id() = p_administracion_id)
--     en la rama no-staff, INDEPENDIENTE del bypass por GUC `app.skip_admin_assert` de
--     assert_administracion_access → defensa en profundidad para un store de secretos.
--   · meta/revelar: validan `p_plataforma` (consistencia con set).
--
-- Mismas firmas (CREATE OR REPLACE in-place, cero overload R16). 100% aditivo/correctivo.
--
-- ROTACIÓN DE CLAVE (deuda documentada, hallazgo §6 #2): el secret Vault `cred_reg_key` NO se puede
-- rotar en caliente — reemplazarlo vuelve indescifrables las passwords ya guardadas. Procedimiento de
-- rotación: (1) agregar el nuevo secret, (2) re-cifrar fila por fila leyendo con la clave vieja y
-- escribiendo con la nueva (actualizando key_version), (3) recién entonces retirar la vieja. El carril
-- multi-key (elegir secret por key_version) se implementa si/ cuando haga falta (F4).

-- ── set: guard de alta vacía ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.credencial_reg_set(
  p_administracion_id uuid, p_plataforma text, p_usuario text, p_password text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
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
  -- nada para guardar en un alta nueva (no pisa una fila existente vía COALESCE)
  IF NULLIF(btrim(p_usuario), '') IS NULL AND NULLIF(p_password, '') IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.credenciales_regulatorias
                     WHERE administracion_id = p_administracion_id AND plataforma = p_plataforma) THEN
    RAISE EXCEPTION 'nada para guardar: usuario y contraseña vacíos' USING ERRCODE = '22023';
  END IF;
  v_key := private.cred_reg_key();
  IF v_key IS NULL THEN
    RAISE EXCEPTION 'clave de cifrado no configurada (Vault: cred_reg_key)' USING ERRCODE = '55000';
  END IF;

  INSERT INTO public.credenciales_regulatorias AS c
    (administracion_id, plataforma, usuario, password_cifrada, estado, updated_by, updated_at)
  VALUES (
    p_administracion_id, p_plataforma, NULLIF(btrim(p_usuario), ''),
    CASE WHEN NULLIF(p_password, '') IS NULL THEN NULL ELSE extensions.pgp_sym_encrypt(p_password, v_key) END,
    'publicado', auth.uid(), now()
  )
  ON CONFLICT (administracion_id, plataforma) DO UPDATE SET
    usuario          = COALESCE(NULLIF(btrim(EXCLUDED.usuario), ''), c.usuario),
    password_cifrada = COALESCE(EXCLUDED.password_cifrada, c.password_cifrada),
    estado           = 'publicado', updated_by = auth.uid(), updated_at = now();
END $fn$;

-- ── meta: plataforma + tenencia inline (defensa en profundidad) ──────────────
CREATE OR REPLACE FUNCTION public.credencial_reg_meta(p_administracion_id uuid, p_plataforma text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE v_staff boolean := private.is_staff(); r record;
BEGIN
  IF p_plataforma NOT IN ('ddjj','arca') THEN
    RAISE EXCEPTION 'plataforma inválida: %', p_plataforma USING ERRCODE = '22023';
  END IF;
  PERFORM private.assert_administracion_access(p_administracion_id);                       -- gate primario (R12)
  IF NOT v_staff AND private.current_administracion_id() IS DISTINCT FROM p_administracion_id THEN
    RAISE EXCEPTION 'acceso denegado' USING ERRCODE = '42501';                             -- defensa en profundidad (sin GUC)
  END IF;
  SELECT usuario, (password_cifrada IS NOT NULL) AS tiene_password, estado, updated_at
    INTO r FROM public.credenciales_regulatorias
    WHERE administracion_id = p_administracion_id AND plataforma = p_plataforma;
  IF NOT FOUND THEN RETURN jsonb_build_object('existe', false); END IF;
  IF NOT v_staff AND r.estado <> 'publicado' THEN RETURN jsonb_build_object('existe', false); END IF;
  RETURN jsonb_build_object('existe', true, 'usuario', r.usuario, 'tiene_password', r.tiene_password,
                            'estado', r.estado, 'updated_at', r.updated_at);
END $fn$;

-- ── revelar: v_key guard + plataforma + tenencia inline; audit DESPUÉS del descifrado válido ──
CREATE OR REPLACE FUNCTION public.credencial_reg_revelar(p_administracion_id uuid, p_plataforma text)
RETURNS text LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE v_staff boolean := private.is_staff(); v_cipher bytea; v_estado text; v_key text; v_pwd text;
BEGIN
  IF p_plataforma NOT IN ('ddjj','arca') THEN
    RAISE EXCEPTION 'plataforma inválida: %', p_plataforma USING ERRCODE = '22023';
  END IF;
  PERFORM private.assert_administracion_access(p_administracion_id);                       -- gate primario (R12)
  IF NOT v_staff AND private.current_administracion_id() IS DISTINCT FROM p_administracion_id THEN
    RAISE EXCEPTION 'acceso denegado' USING ERRCODE = '42501';                             -- defensa en profundidad (sin GUC)
  END IF;
  SELECT password_cifrada, estado INTO v_cipher, v_estado
    FROM public.credenciales_regulatorias
    WHERE administracion_id = p_administracion_id AND plataforma = p_plataforma;
  IF v_cipher IS NULL THEN RETURN NULL; END IF;
  IF NOT v_staff AND v_estado <> 'publicado' THEN RETURN NULL; END IF;
  v_key := private.cred_reg_key();
  IF v_key IS NULL THEN
    RAISE EXCEPTION 'clave de cifrado no configurada (Vault: cred_reg_key)' USING ERRCODE = '55000';
  END IF;
  v_pwd := extensions.pgp_sym_decrypt(v_cipher, v_key);
  INSERT INTO public.credenciales_regulatorias_accesos (administracion_id, plataforma, accedido_por, rol)
  VALUES (p_administracion_id, p_plataforma, auth.uid(), CASE WHEN v_staff THEN 'staff' ELSE 'cliente' END);
  RETURN v_pwd;
END $fn$;
