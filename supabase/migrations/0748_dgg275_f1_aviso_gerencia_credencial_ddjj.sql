-- 0748 · DGG-275 / DDJJ F1 — Aviso a gerencia al proponerse una credencial de DDJJ.
--
-- GAP (relevamiento + auditoría §6 del flujo DDJJ): `credencial_reg_proponer_gestor`
-- sólo hacía el upsert de `prop_*` y marcaba el acceso usado — NO avisaba a nadie.
-- Gerencia sólo veía la propuesta si abría la cola de moderación (pull). En un trámite
-- que puede tardar semanas (depende del administrador), eso es un pendiente invisible.
--
-- Fix: tras el upsert, `PERFORM notify_all_gerentes(...)` → campanita + push + MAIL
-- (carril transaccional, por el slug 'gerencia-notif-generica') a cada gerente/operador.
-- El cuerpo NO incluye usuario/contraseña (el secreto vive cifrado en el store; nunca
-- viaja en una notificación). Envuelto en BEGIN/EXCEPTION para que un fallo del aviso
-- NUNCA bloquee la propuesta (la propuesta es el camino crítico). R16: misma firma
-- (CREATE OR REPLACE in-place, cero overload). R17 cubierto (ambas SECURITY DEFINER).
-- El caller puede ser anon (gestor por token) → OK, notify_all_gerentes corre como owner.

CREATE OR REPLACE FUNCTION public.credencial_reg_proponer_gestor(
  p_token text, p_plataforma text, p_usuario text, p_password text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_acc public.accesos_externos%ROWTYPE;
  v_tramite_id uuid; v_admin_id uuid; v_serv_codigo text; v_categoria text;
  v_admin_nombre text;
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
  SELECT t.administracion_id, s.codigo, t.categoria, a.nombre
    INTO v_admin_id, v_serv_codigo, v_categoria, v_admin_nombre
    FROM public.tramites t
    LEFT JOIN public.servicios s ON s.id = t.servicio_id
    LEFT JOIN public.administraciones a ON a.id = t.administracion_id
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

  -- F1 · aviso a gerencia (campanita + push + mail). Sin secretos en el cuerpo.
  -- No debe bloquear la propuesta si el fan-out falla.
  BEGIN
    PERFORM public.notify_all_gerentes(
      'credencial_ddjj_propuesta',
      'Credenciales de DDJJ para revisar',
      v_label || ' informó las credenciales del Portal de DDJJ de '
        || COALESCE(v_admin_nombre, 'un cliente') || '. Revisá y publicá lo que ve el cliente.',
      '/gerencia/moderacion',
      jsonb_build_object('administracion_id', v_admin_id, 'plataforma', p_plataforma),
      true,
      'gerencia-notif-generica',
      NULL,
      4::smallint,
      'credenciales_regulatorias',
      v_admin_id
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'credencial_reg_proponer_gestor: notify_all_gerentes falló: %', SQLERRM;
  END;
END $fn$;
REVOKE ALL ON FUNCTION public.credencial_reg_proponer_gestor(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.credencial_reg_proponer_gestor(text, text, text, text) TO anon, authenticated;

COMMENT ON FUNCTION public.credencial_reg_proponer_gestor(text, text, text, text) IS
  'DGG-275 F1: la gestoría propone credenciales de DDJJ (moderación) y AHORA avisa a gerencia '
  '(campanita + push + mail, sin secretos). Carril transaccional. Misma firma (R16).';
