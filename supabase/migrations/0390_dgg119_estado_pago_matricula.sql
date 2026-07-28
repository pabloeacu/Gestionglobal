-- ============================================================================
-- 0390 · DGG-119 Chunk B · Estado de pago de la matrícula (diseño de Pablo)
--
-- "Cualquier alumno tiene que matricularse para ingresar al curso. El gerente
--  señala si tiene el curso pago (Adeudado / Pago parcial / Pago completo),
--  autocompletado si el wizard registró el pago por el 100%. Si la matrícula
--  no está en pago completo, el certificado no se emite; se avisa a gerencia
--  (mail+banner+push) y el gerente decide."
--
-- Piezas:
--   A. curso_matriculas.estado_pago (adeudado|pago_parcial|pago_completo,
--      NOT NULL DEFAULT 'adeudado') + cert_retenido_avisado_at (anti-spam).
--   B. Seed de filas FALTANTES de matricula_condiciones (37 filas: las
--      condiciones se configuraron después de matricular → el gate de
--      emisión era más laxo que lo configurado; sin esto el gate de pago
--      sería salteable). Cumplida=false; el put-al-día lo hacen las syncs
--      canónicas del sistema (matricula_sync_examen/encuesta +
--      private.recompute_asistencia) — nada se adivina.
--   C. Backfill ONE-SHOT de estado_pago con la verdad contable de HOY
--      (cada administración matriculada tiene exactamente el comprobante de
--      su curso — verificado a mano las 11): saldo 0 → pago_completo,
--      cobrado parcial → pago_parcial, resto → adeudado. NO es un mecanismo
--      permanente: de acá en más el estado lo declara gerencia/wizard.
--   D. Sync estado_pago → condición 'pago' del checklist (una sola verdad):
--      pago_completo tilda (cumplida_por NULL = sistema); salir de
--      pago_completo destilda SOLO tildes del sistema (respeta manuales).
--      Trigger en curso_matriculas + sync inversa en matricula_tildar_condicion
--      y curso_registrar_pago (mismas firmas → sin overload, R16 ok).
--   E. curso_asignar_alumno: + p_estado_pago (firma NUEVA → DROP + CREATE,
--      R16). Si la matrícula ya existía y viene estado, lo actualiza.
--   F. Aviso a gerencia (notify_all_gerentes: campanita+push+mail) cuando un
--      alumno queda con TODO cumplido salvo el pago — 1 sola vez por
--      matrícula. + RPC curso_certs_retenidos() para el banner del Inicio.
--
-- El gate de emisión NO se toca: emitir_certificado_si_corresponde ya cuenta
-- condiciones; con la condición de pago sembrada y sincronizada, retiene solo.
-- La emisión manual/forzada del gerente = cambiar el estado de pago o tildar
-- la condición a mano (ambas quedan auditadas).
-- ============================================================================

-- ---------------------------------------------------------------- A · columnas
ALTER TABLE public.curso_matriculas
  ADD COLUMN IF NOT EXISTS estado_pago text NOT NULL DEFAULT 'adeudado'
    CONSTRAINT chk_matricula_estado_pago CHECK (estado_pago IN ('adeudado','pago_parcial','pago_completo')),
  ADD COLUMN IF NOT EXISTS cert_retenido_avisado_at timestamptz;

COMMENT ON COLUMN public.curso_matriculas.estado_pago IS
  'DGG-119: estado del pago del curso declarado por gerencia (o autocompletado por el wizard si cobró el 100%). pago_completo tilda sola la condición de pago del checklist; los otros la destildan si la había tildado el sistema.';
COMMENT ON COLUMN public.curso_matriculas.cert_retenido_avisado_at IS
  'DGG-119: cuándo se avisó a gerencia que el certificado quedó retenido solo por el pago (1 aviso por matrícula).';

-- ------------------------------------------------- B · seed de filas faltantes
INSERT INTO public.matricula_condiciones (matricula_id, condicion_id, cumplida)
SELECT cm.id, cc.id, false
FROM public.curso_matriculas cm
JOIN public.curso_condiciones_config cc ON cc.curso_id = cm.curso_id AND cc.activa
LEFT JOIN public.matricula_condiciones mc ON mc.matricula_id = cm.id AND mc.condicion_id = cc.id
WHERE mc.id IS NULL
ON CONFLICT (matricula_id, condicion_id) DO NOTHING;

-- --------------------------------------------------- C · backfill fiel one-shot
UPDATE public.curso_matriculas cm
   SET estado_pago = calc.estado
  FROM (
    SELECT cm2.id,
      CASE
        WHEN s.total_cargos > 0 AND s.pendiente <= 0.009 THEN 'pago_completo'
        WHEN s.cobrado > 0.009 THEN 'pago_parcial'
        ELSE 'adeudado'
      END AS estado
    FROM public.curso_matriculas cm2
    LEFT JOIN LATERAL (
      SELECT COALESCE(SUM(c.total),0) AS total_cargos,
             COALESCE(SUM(c.saldo_pendiente),0) AS pendiente,
             COALESCE(SUM(c.total - c.saldo_pendiente),0) AS cobrado
        FROM public.comprobantes c
       WHERE c.administracion_id = cm2.administracion_id
         AND c.estado NOT IN ('anulado','borrador')
    ) s ON true
  ) calc
 WHERE calc.id = cm.id;

-- --------------------------------- put-al-día con las syncs canónicas (examen,
-- encuesta, asistencia sincrónica). Cero adivinanza: tildan solo lo que consta.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.curso_matriculas LOOP
    PERFORM public.matricula_sync_examen(r.id);
    PERFORM public.matricula_sync_encuesta(r.id);
  END LOOP;
  FOR r IN
    SELECT cm.id AS mat, cc.id AS cond
      FROM public.curso_matriculas cm
      JOIN public.curso_condiciones_config cc ON cc.curso_id = cm.curso_id
       AND cc.activa AND cc.tipo = 'asistencia' AND cc.modalidad IS NOT NULL
  LOOP
    PERFORM private.recompute_asistencia(r.mat, r.cond);
  END LOOP;
END $$;

-- ----------------------------------------------- D · sync estado_pago ↔ checklist
CREATE OR REPLACE FUNCTION private.matricula_sync_estado_pago(p_matricula_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_estado text;
  v_curso uuid;
  r record;
BEGIN
  SELECT m.estado_pago, m.curso_id INTO v_estado, v_curso
    FROM public.curso_matriculas m WHERE m.id = p_matricula_id;
  IF v_estado IS NULL THEN RETURN; END IF;

  FOR r IN
    SELECT cc.id FROM public.curso_condiciones_config cc
     WHERE cc.curso_id = v_curso AND cc.tipo = 'pago' AND cc.activa
  LOOP
    IF v_estado = 'pago_completo' THEN
      -- upsert: la fila puede no existir aún (matrícula recién insertada).
      INSERT INTO public.matricula_condiciones (matricula_id, condicion_id, cumplida, cumplida_at, cumplida_por, observaciones)
      VALUES (p_matricula_id, r.id, true, now(), NULL, 'Pago completo (estado de pago de la matrícula)')
      ON CONFLICT (matricula_id, condicion_id) DO UPDATE
        SET cumplida = true, cumplida_at = now(), cumplida_por = NULL,
            observaciones = 'Pago completo (estado de pago de la matrícula)'
        WHERE NOT matricula_condiciones.cumplida;
    ELSE
      -- destildar SOLO si la tildó el sistema (cumplida_por NULL); un tilde
      -- manual del gerente (auth.uid()) nunca se pisa desde acá.
      UPDATE public.matricula_condiciones mc
         SET cumplida = false, cumplida_at = NULL,
             observaciones = 'Destildada: estado de pago pasó a ' || v_estado
       WHERE mc.matricula_id = p_matricula_id AND mc.condicion_id = r.id
         AND mc.cumplida AND mc.cumplida_por IS NULL;
    END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION private.trg_matricula_estado_pago_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' OR OLD.estado_pago IS DISTINCT FROM NEW.estado_pago THEN
    PERFORM private.matricula_sync_estado_pago(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_matricula_estado_pago_sync ON public.curso_matriculas;
CREATE TRIGGER trg_matricula_estado_pago_sync
AFTER INSERT OR UPDATE OF estado_pago ON public.curso_matriculas
FOR EACH ROW EXECUTE FUNCTION private.trg_matricula_estado_pago_sync();

-- tilde retroactivo de los pago_completo del backfill (dispara emisión SOLO
-- si además todo lo demás cumple — verificado en simulación: únicamente
-- Selalle, cuyo certificado corresponde emitir).
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.curso_matriculas WHERE estado_pago = 'pago_completo' LOOP
    PERFORM private.matricula_sync_estado_pago(r.id);
  END LOOP;
END $$;

-- sync inversa: tildar/destildar la condición pago a mano actualiza el estado.
-- (misma firma que 0045 → CREATE OR REPLACE sin overload)
CREATE OR REPLACE FUNCTION public.matricula_tildar_condicion(
  p_matricula_condicion_id uuid,
  p_cumplida boolean,
  p_observaciones text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_tipo text;
  v_matricula uuid;
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo gerencia puede tildar condiciones' USING ERRCODE = '42501';
  END IF;

  SELECT cc.tipo, mc.matricula_id INTO v_tipo, v_matricula
    FROM public.matricula_condiciones mc
    JOIN public.curso_condiciones_config cc ON cc.id = mc.condicion_id
   WHERE mc.id = p_matricula_condicion_id;
  IF v_tipo IS NULL THEN
    RAISE EXCEPTION 'Condición inexistente' USING ERRCODE = '22023';
  END IF;
  IF v_tipo = 'examen' THEN
    RAISE EXCEPTION 'La condición de examen se acredita automáticamente al aprobar'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.matricula_condiciones
     SET cumplida = p_cumplida,
         cumplida_at = CASE WHEN p_cumplida THEN now() ELSE NULL END,
         cumplida_por = CASE WHEN p_cumplida THEN auth.uid() ELSE NULL END,
         observaciones = COALESCE(p_observaciones, observaciones)
   WHERE id = p_matricula_condicion_id;

  -- DGG-119: la condición de pago y el estado de pago son la misma verdad.
  IF v_tipo = 'pago' THEN
    UPDATE public.curso_matriculas
       SET estado_pago = CASE WHEN p_cumplida THEN 'pago_completo' ELSE 'adeudado' END
     WHERE id = v_matricula
       AND estado_pago IS DISTINCT FROM (CASE WHEN p_cumplida THEN 'pago_completo' ELSE 'adeudado' END);
  END IF;
END;
$$;

-- curso_registrar_pago: además del asiento + tilde, fija estado_pago completo.
-- (misma firma que 0045 → CREATE OR REPLACE; el cuerpo previo se conserva y
-- solo se agrega el UPDATE del estado)
CREATE OR REPLACE FUNCTION public.curso_registrar_pago(
  p_matricula_id uuid,
  p_monto numeric,
  p_caja_id uuid,
  p_observaciones text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_matricula record;
  v_curso record;
  v_categoria_id uuid;
  v_movimiento_id uuid;
  v_cond_id uuid;
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo gerencia puede registrar pagos' USING ERRCODE = '42501';
  END IF;
  IF p_monto IS NULL OR p_monto <= 0 THEN
    RAISE EXCEPTION 'El monto debe ser positivo' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_matricula FROM public.curso_matriculas WHERE id = p_matricula_id;
  IF v_matricula.id IS NULL THEN
    RAISE EXCEPTION 'Matrícula inexistente' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_curso FROM public.cursos WHERE id = v_matricula.curso_id;

  -- Categoría de ingreso "Cursos / Campus" (idempotente).
  SELECT id INTO v_categoria_id
    FROM public.categorias_finanzas WHERE nombre = 'Cursos / Campus';
  IF v_categoria_id IS NULL THEN
    INSERT INTO public.categorias_finanzas (nombre, tipo, icono)
    VALUES ('Cursos / Campus', 'ingreso', 'graduation-cap')
    ON CONFLICT (nombre) DO UPDATE SET nombre = EXCLUDED.nombre
    RETURNING id INTO v_categoria_id;
  END IF;

  INSERT INTO public.movimientos (
    caja_id, fecha, tipo, monto, categoria_id, descripcion, referencia,
    administracion_id, estado, origen, created_by
  ) VALUES (
    p_caja_id, CURRENT_DATE, 'ingreso', p_monto, v_categoria_id,
    'Campus · pago curso ' || COALESCE(v_curso.titulo, ''),
    COALESCE(p_observaciones, NULL),
    v_matricula.administracion_id, 'identificado', 'manual', auth.uid()
  ) RETURNING id INTO v_movimiento_id;

  UPDATE public.matricula_condiciones mc
     SET cumplida = true, cumplida_at = now(), cumplida_por = auth.uid(),
         observaciones = COALESCE(p_observaciones, mc.observaciones)
    FROM public.curso_condiciones_config cc
   WHERE mc.condicion_id = cc.id
     AND mc.matricula_id = p_matricula_id
     AND cc.tipo = 'pago'
  RETURNING mc.id INTO v_cond_id;

  -- DGG-119: registrar el pago desde el modal = pago completo declarado.
  UPDATE public.curso_matriculas
     SET estado_pago = 'pago_completo'
   WHERE id = p_matricula_id AND estado_pago <> 'pago_completo';

  RETURN jsonb_build_object(
    'movimiento_id', v_movimiento_id,
    'condicion_pago_id', v_cond_id
  );
END;
$$;

-- ------------------------------------------- E · curso_asignar_alumno + estado
-- R16: la firma CAMBIA (se agrega p_estado_pago) → DROP explícito de la vieja.
DROP FUNCTION IF EXISTS public.curso_asignar_alumno(uuid, uuid, uuid);

CREATE FUNCTION public.curso_asignar_alumno(
  p_curso_id uuid,
  p_administracion_id uuid,
  p_profile_id uuid DEFAULT NULL::uuid,
  p_estado_pago text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_profile_id uuid;
  v_matricula_id uuid;
  v_estado text;
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo staff puede asignar alumnos a un curso' USING ERRCODE = '42501';
  END IF;
  PERFORM private.assert_administracion_access(p_administracion_id);

  IF p_estado_pago IS NOT NULL
     AND p_estado_pago NOT IN ('adeudado','pago_parcial','pago_completo') THEN
    RAISE EXCEPTION 'Estado de pago inválido' USING ERRCODE = '22023';
  END IF;

  SELECT private.curso_estado_publicacion(activo, publicar_at, despublicar_at)
    INTO v_estado FROM public.cursos WHERE id = p_curso_id;
  IF v_estado IS NULL THEN
    RAISE EXCEPTION 'Curso inexistente' USING ERRCODE = 'P0002';
  END IF;
  IF v_estado = 'finalizado' THEN
    RAISE EXCEPTION 'El curso está finalizado; no admite nuevas matrículas' USING ERRCODE = '22023';
  END IF;

  v_profile_id := COALESCE(p_profile_id,
    (SELECT user_id FROM public.administraciones WHERE id = p_administracion_id));
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'La administración no tiene usuario de portal; creá el acceso primero'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT id INTO v_matricula_id FROM public.curso_matriculas
   WHERE curso_id = p_curso_id AND administracion_id = p_administracion_id
     AND profile_id = v_profile_id;
  IF v_matricula_id IS NOT NULL THEN
    -- idempotente; si viene un estado de pago, se actualiza (el trigger sincroniza).
    IF p_estado_pago IS NOT NULL THEN
      UPDATE public.curso_matriculas SET estado_pago = p_estado_pago
       WHERE id = v_matricula_id AND estado_pago IS DISTINCT FROM p_estado_pago;
    END IF;
    RETURN v_matricula_id;
  END IF;

  INSERT INTO public.curso_matriculas (curso_id, administracion_id, profile_id, fuente, estado_pago)
  VALUES (p_curso_id, p_administracion_id, v_profile_id, 'gerencia_manual',
          COALESCE(p_estado_pago, 'adeudado'))
  RETURNING id INTO v_matricula_id;

  RETURN v_matricula_id;
END;
$$;

REVOKE ALL ON FUNCTION public.curso_asignar_alumno(uuid, uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.curso_asignar_alumno(uuid, uuid, uuid, text) TO authenticated;

-- ------------------------------------ RPC para el selector rápido de gerencia
CREATE FUNCTION public.matricula_set_estado_pago(p_matricula_id uuid, p_estado text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo gerencia' USING ERRCODE = '42501';
  END IF;
  IF p_estado NOT IN ('adeudado','pago_parcial','pago_completo') THEN
    RAISE EXCEPTION 'Estado de pago inválido' USING ERRCODE = '22023';
  END IF;
  UPDATE public.curso_matriculas
     SET estado_pago = p_estado
   WHERE id = p_matricula_id AND estado_pago IS DISTINCT FROM p_estado;
  IF NOT FOUND THEN
    -- o no existe, o ya estaba en ese estado: ambas benignas para la UI.
    NULL;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.matricula_set_estado_pago(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.matricula_set_estado_pago(uuid, text) TO authenticated;

-- ------------------------------------------------- F · aviso "cert retenido"
CREATE OR REPLACE FUNCTION private.matricula_avisar_cert_retenido(p_matricula_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_mat record;
  v_total int; v_ok int; v_pend_pago int;
  v_alumno text; v_curso text;
BEGIN
  SELECT m.* INTO v_mat FROM public.curso_matriculas m WHERE m.id = p_matricula_id;
  IF v_mat.id IS NULL OR v_mat.cert_retenido_avisado_at IS NOT NULL
     OR v_mat.estado_pago = 'pago_completo' THEN
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM public.certificados ct WHERE ct.matricula_id = p_matricula_id) THEN
    RETURN;
  END IF;

  SELECT count(*) FILTER (WHERE cc.activa),
         count(*) FILTER (WHERE cc.activa AND mc.cumplida),
         count(*) FILTER (WHERE cc.activa AND NOT mc.cumplida AND cc.tipo = 'pago')
    INTO v_total, v_ok, v_pend_pago
    FROM public.matricula_condiciones mc
    JOIN public.curso_condiciones_config cc ON cc.id = mc.condicion_id
   WHERE mc.matricula_id = p_matricula_id;

  -- "todo cumplido salvo el pago": lo único pendiente son condiciones de pago.
  IF v_total IS NULL OR v_total = 0 OR v_pend_pago = 0 OR (v_total - v_ok) <> v_pend_pago THEN
    RETURN;
  END IF;

  SELECT p.full_name INTO v_alumno FROM public.profiles p WHERE p.id = v_mat.profile_id;
  SELECT c.titulo INTO v_curso FROM public.cursos c WHERE c.id = v_mat.curso_id;

  PERFORM public.notify_all_gerentes(
    'cert_retenido_pago',
    '🎓 Certificado retenido por pago · ' || COALESCE(v_alumno, 'Alumno'),
    COALESCE(v_alumno, 'El alumno') || ' completó todas las condiciones de «'
      || COALESCE(v_curso, 'su curso') || '» pero su estado de pago es «'
      || replace(v_mat.estado_pago, '_', ' ')
      || '». Cambiá el estado de pago o acreditá la condición para que el certificado se emita.',
    '/gerencia/campus/' || v_mat.curso_id::text,
    jsonb_build_object('matricula_id', p_matricula_id, 'curso_id', v_mat.curso_id),
    true,
    'gerencia-notif-generica',
    NULL, 2::smallint,
    'curso_matriculas', p_matricula_id
  );

  UPDATE public.curso_matriculas
     SET cert_retenido_avisado_at = now()
   WHERE id = p_matricula_id;
END;
$$;

-- trigger best-effort: cada vez que una condición SE CUMPLE, chequear si la
-- matrícula quedó "completa salvo pago" y avisar (una vez). Jamás rompe el
-- tilde (patrón E-GG-38/0229: EXCEPTION → WARNING).
CREATE OR REPLACE FUNCTION private.trg_condicion_cumplida_avisar_retenido()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  BEGIN
    PERFORM private.matricula_avisar_cert_retenido(NEW.matricula_id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'avisar_cert_retenido falló (best-effort): %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_condicion_cumplida_avisar_retenido ON public.matricula_condiciones;
CREATE TRIGGER trg_condicion_cumplida_avisar_retenido
AFTER UPDATE OF cumplida ON public.matricula_condiciones
FOR EACH ROW
WHEN (NEW.cumplida AND OLD.cumplida IS DISTINCT FROM NEW.cumplida)
EXECUTE FUNCTION private.trg_condicion_cumplida_avisar_retenido();

-- ------------------------------------- RPC del banner "Certificados retenidos"
CREATE FUNCTION public.curso_certs_retenidos()
RETURNS TABLE(
  matricula_id uuid,
  curso_id uuid,
  curso_titulo text,
  alumno_nombre text,
  estado_pago text,
  detectado_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo gerencia' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT cm.id, cm.curso_id, c.titulo, p.full_name, cm.estado_pago,
         COALESCE(cm.cert_retenido_avisado_at, now())
    FROM public.curso_matriculas cm
    JOIN public.cursos c ON c.id = cm.curso_id
    JOIN public.profiles p ON p.id = cm.profile_id
   WHERE cm.estado_pago <> 'pago_completo'
     AND cm.estado = 'activa'
     AND NOT EXISTS (SELECT 1 FROM public.certificados ct WHERE ct.matricula_id = cm.id)
     AND (
       SELECT count(*) FILTER (WHERE cc.activa AND NOT mc.cumplida)
            = count(*) FILTER (WHERE cc.activa AND NOT mc.cumplida AND cc.tipo = 'pago')
          AND count(*) FILTER (WHERE cc.activa AND NOT mc.cumplida AND cc.tipo = 'pago') > 0
         FROM public.matricula_condiciones mc
         JOIN public.curso_condiciones_config cc ON cc.id = mc.condicion_id
        WHERE mc.matricula_id = cm.id
     );
END;
$$;

REVOKE ALL ON FUNCTION public.curso_certs_retenidos() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.curso_certs_retenidos() TO authenticated;
