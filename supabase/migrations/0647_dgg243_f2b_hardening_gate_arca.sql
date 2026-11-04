-- 0647 · DGG-243 · F2b hardening — cierra la rama 'arca' sin gate en proponer_gestor (auditoría §6 A#10).
--
-- Hallazgo (auditor A, menor): en credencial_reg_proponer_gestor (0646) el gate de servicio/categoría
-- sólo corría `IF p_plataforma = 'ddjj'`. Para p_plataforma='arca' NO había gate → un token válido de
-- CUALQUIER trámite podía inyectar una propuesta 'arca' para la administración de ese token (acotado al
-- tenant, sin auto-publicar, y ARCA todavía no se consume — eso llega en F4). Igual rompe el principio
-- "el gate fuente-de-verdad vive en la RPC" (precedente otorgamiento 0448: un payload crafteado no puede
-- adjuntar a un trámite ajeno a su tipo).
--
-- Fix: el carril de PROPUESTA de gestoría es SÓLO DDJJ por ahora. ARCA entra por gerencia (F2a/F4), no
-- por el sitio externo. Se rechaza explícitamente p_plataforma<>'ddjj'. Cuando F4 habilite ARCA por
-- gestoría, se reemplaza este guard por el gate ARCA real (servicio/categoría). Misma firma (CREATE OR
-- REPLACE in-place, cero overload R16). El front ya manda siempre 'ddjj' → impacto cero en producción.

CREATE OR REPLACE FUNCTION public.credencial_reg_proponer_gestor(
  p_token text, p_plataforma text, p_usuario text, p_password text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_acc public.accesos_externos%ROWTYPE;
  v_tramite_id uuid; v_admin_id uuid; v_serv_codigo text; v_categoria text;
  v_label text; v_key text;
  v_usuario text := NULLIF(btrim(p_usuario), '');
  v_password text := NULLIF(p_password, '');
BEGIN
  -- F2b: la gestoría sólo informa credenciales del Portal de DDJJ. ARCA (F4) va por gerencia.
  IF p_plataforma <> 'ddjj' THEN
    RAISE EXCEPTION 'Por ahora la gestoría sólo puede informar credenciales del Portal de DDJJ'
      USING ERRCODE = '22023';
  END IF;
  IF v_usuario IS NULL AND v_password IS NULL THEN
    RAISE EXCEPTION 'nada para proponer: usuario y contraseña vacíos' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_acc FROM public.accesos_externos WHERE token = p_token;
  IF v_acc.token IS NULL THEN RAISE EXCEPTION 'Token inválido' USING ERRCODE = 'P0002'; END IF;
  IF v_acc.revocado_at IS NOT NULL THEN RAISE EXCEPTION 'Acceso revocado' USING ERRCODE = '42501'; END IF;
  IF v_acc.vence_at < now() THEN RAISE EXCEPTION 'Acceso vencido' USING ERRCODE = '42501'; END IF;
  IF v_acc.recurso_tipo = 'solicitud' THEN
    SELECT tramite_id INTO v_tramite_id FROM public.solicitudes WHERE id = v_acc.recurso_id;
  ELSIF v_acc.recurso_tipo = 'tramite' THEN
    v_tramite_id := v_acc.recurso_id;
  ELSE
    RAISE EXCEPTION 'Token no corresponde a un trámite' USING ERRCODE = '22023';
  END IF;
  IF v_tramite_id IS NULL THEN
    RAISE EXCEPTION 'La solicitud aún no tiene trámite asociado' USING ERRCODE = '22023';
  END IF;
  SELECT t.administracion_id, s.codigo, t.categoria
    INTO v_admin_id, v_serv_codigo, v_categoria
    FROM public.tramites t
    LEFT JOIN public.servicios s ON s.id = t.servicio_id
   WHERE t.id = v_tramite_id;
  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'El trámite no tiene administración vinculada' USING ERRCODE = '22023';
  END IF;
  -- Gate DDJJ (espeja el botón F2a y el gate del front): servicio 'rpac_ddjj' O categoría 'dj'.
  IF COALESCE(v_serv_codigo, '') <> 'rpac_ddjj' AND COALESCE(v_categoria, '') <> 'dj' THEN
    RAISE EXCEPTION 'Las credenciales de DDJJ sólo aplican a trámites de Declaraciones Juradas'
      USING ERRCODE = '22023';
  END IF;
  v_key := private.cred_reg_key();
  IF v_key IS NULL THEN
    RAISE EXCEPTION 'clave de cifrado no configurada (Vault: cred_reg_key)' USING ERRCODE = '55000';
  END IF;
  v_label := COALESCE(NULLIF(v_acc.nombre_destinatario, ''), v_acc.email_destinatario, 'gestoría');

  INSERT INTO public.credenciales_regulatorias AS c
    (administracion_id, plataforma, estado,
     prop_usuario, prop_password_cifrada, prop_origen, prop_por, prop_tramite_id, prop_at, updated_at)
  VALUES (
    v_admin_id, p_plataforma, 'propuesto',
    v_usuario,
    CASE WHEN v_password IS NULL THEN NULL ELSE extensions.pgp_sym_encrypt(v_password, v_key) END,
    'gestoria', v_label, v_tramite_id, now(), now()
  )
  ON CONFLICT (administracion_id, plataforma) DO UPDATE SET
    prop_usuario          = v_usuario,
    prop_password_cifrada = CASE WHEN v_password IS NULL THEN NULL
                                 ELSE extensions.pgp_sym_encrypt(v_password, v_key) END,
    prop_origen           = 'gestoria',
    prop_por              = v_label,
    prop_tramite_id       = v_tramite_id,
    prop_at               = now();

  UPDATE public.accesos_externos
     SET usado_at = COALESCE(usado_at, now()), ultima_visita_at = now(),
         total_visitas = COALESCE(total_visitas, 0) + 1
   WHERE token = p_token;
END $fn$;
REVOKE ALL ON FUNCTION public.credencial_reg_proponer_gestor(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.credencial_reg_proponer_gestor(text, text, text, text) TO anon, authenticated;
