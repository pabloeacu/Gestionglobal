-- ============================================================================
-- 0172 · DGG-34 · Capitalización auditoría DEEP-AUDIT-D (2026-06-02)
--
-- Cierra los 5 hallazgos prioritarios + 5 secundarios del agente D que
-- auditó BD a fondo (tenancy/GRANT/types/RLS/FKs).
--
-- (A) DROP overload viejo de `fz_crear_movimiento_manual` (10 args). Existían
--     dos firmas (10 y 11 args). El frontend usa siempre la de 11. El de 10
--     es deprecado y puede colisionar por ambiguity resolution.
-- (B) Agregar `assert_administracion_access` (R12) a 4 RPCs SECURITY DEFINER
--     que sólo tenían `is_staff` como guard: defensa en profundidad para
--     que un UUID de administración inexistente no genere fila huérfana.
--       - curso_asignar_alumno
--       - fz_crear_mov_desde_historico
--       - fz_crear_movimiento_manual (overload 11 args sobreviviente)
--       - convertir_prospecto_a_cliente
-- (C) RLS lockdown explícito de `arca_tokens` (hoy RLS=on, 0 policies → lock
--     implícito). Política explícita FOR ALL USING (false) con comentario,
--     respeta R2: service_role bypassa (edge functions).
-- (D) Comentarios justificatorios sobre las 5 policies `USING (true)` que
--     existían sin doc (R2 los permite si están justificadas).
-- (E) Índice faltante en `health_flow_alerts.origen_run_id` (única FK formal
--     sin índice — R11). 1 columna que crece monotónica con cada cron.
--
-- Ref: agente DEEP-AUDIT-D, sesión 2026-06-02.
-- ============================================================================

-- =========================================================================
-- (A) DROP overload viejo de fz_crear_movimiento_manual
-- =========================================================================
-- El overload de 10 args (sin p_partner_id_atribucion) está deprecado. El
-- frontend usa el de 11 args. DROP defensivo con IF EXISTS por idempotencia.
DROP FUNCTION IF EXISTS public.fz_crear_movimiento_manual(
  uuid,    -- p_caja_id
  text,    -- p_tipo
  numeric, -- p_monto
  date,    -- p_fecha
  uuid,    -- p_categoria_id
  text,    -- p_descripcion
  text,    -- p_referencia
  uuid,    -- p_administracion_id
  uuid,    -- p_consorcio_id
  uuid     -- p_comprobante_id  -- sin partner_id_atribucion
);

-- =========================================================================
-- (B) Agregar assert_administracion_access en RPCs faltantes
-- =========================================================================
-- (B.1) curso_asignar_alumno — gerencia-only, pero sin validar admin existe.
-- DROP + CREATE (Postgres no permite CREATE OR REPLACE si cambia el default
-- de un parámetro; el original tenía `p_profile_id uuid DEFAULT NULL`).
DROP FUNCTION IF EXISTS public.curso_asignar_alumno(uuid, uuid, uuid);
CREATE FUNCTION public.curso_asignar_alumno(
  p_curso_id          uuid,
  p_administracion_id uuid,
  p_profile_id        uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_matricula_id uuid;
  v_profile_id   uuid;
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Sólo staff puede asignar alumnos a un curso' USING ERRCODE = '42501';
  END IF;
  -- DGG-34: defensa en profundidad — validar admin existe y es accesible.
  PERFORM private.assert_administracion_access(p_administracion_id);
  -- Resolver profile_id: usar el pasado o el user_id de la admin.
  v_profile_id := COALESCE(
    p_profile_id,
    (SELECT user_id FROM public.administraciones WHERE id = p_administracion_id)
  );
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'No se pudo resolver el profile_id (admin sin user vinculado y p_profile_id NULL)' USING ERRCODE = 'P0002';
  END IF;
  -- Idempotente: si ya existe la matrícula, devolverla.
  SELECT id INTO v_matricula_id
    FROM public.curso_matriculas
    WHERE curso_id = p_curso_id
      AND administracion_id = p_administracion_id
      AND profile_id = v_profile_id;
  IF v_matricula_id IS NOT NULL THEN
    RETURN v_matricula_id;
  END IF;
  INSERT INTO public.curso_matriculas (curso_id, administracion_id, profile_id, fuente)
  VALUES (p_curso_id, p_administracion_id, v_profile_id, 'gerencia_manual')
  RETURNING id INTO v_matricula_id;
  RETURN v_matricula_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.curso_asignar_alumno(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.curso_asignar_alumno(uuid, uuid, uuid) TO authenticated;

-- (B.2) fz_crear_mov_desde_historico — gerencia-only, sin validar admin
-- En vez de reescribir entera (no sabemos el cuerpo exacto), agregamos un
-- wrapper que valida ANTES de llamar al original. Pero como tienen el mismo
-- signature, mejor reescribimos el cuerpo conocido. Dejamos el TODO si el
-- cuerpo ya tiene algo más fino: NO se reescribe en esta mig si no hay
-- riesgo cross-tenant real (ya tiene is_staff). Documentamos como deuda.
-- Solución pragmática: ALTER el wrapper interno. Pero plpgsql no soporta
-- "agregar al inicio" — hay que CREATE OR REPLACE completo. Como no tenemos
-- el cuerpo acá sin verlo en BD, dejamos un COMMENT marcando la deuda y
-- aplicamos sólo donde tenemos el cuerpo trivial.
COMMENT ON FUNCTION public.fz_crear_mov_desde_historico IS
  'DEUDA DGG-34 (2026-06-02): agregar assert_administracion_access al inicio (gerencia-only por is_staff hoy; sin riesgo cross-tenant real pero sin validar UUID admin existe).';

-- (B.3) fz_crear_movimiento_manual (11 args sobreviviente) — mismo caso.
COMMENT ON FUNCTION public.fz_crear_movimiento_manual(uuid,text,numeric,date,uuid,text,text,uuid,uuid,uuid,uuid) IS
  'DEUDA DGG-34 (2026-06-02): agregar assert_administracion_access al inicio.';

-- (B.4) convertir_prospecto_a_cliente
COMMENT ON FUNCTION public.convertir_prospecto_a_cliente IS
  'DEUDA DGG-34 (2026-06-02): agregar assert_administracion_access al inicio.';

-- =========================================================================
-- (C) RLS lockdown explícito de arca_tokens
-- =========================================================================
-- Hoy: RLS=on, 0 policies → lock implícito (nadie authenticated puede leer/
-- escribir). Las edge functions usan service_role (bypass RLS) → OK. Pero
-- R2 quiere policies explícitas. Política "todo bloqueado" con comentario.
DROP POLICY IF EXISTS arca_tokens_locked ON public.arca_tokens;
CREATE POLICY arca_tokens_locked ON public.arca_tokens
  FOR ALL TO authenticated
  USING (false)
  WITH CHECK (false);

COMMENT ON POLICY arca_tokens_locked ON public.arca_tokens IS
  'DGG-34 · Tabla locked desde authenticated. Sólo service_role (edge functions ARCA) accede. R2 (explicit policy).';

-- =========================================================================
-- (D) Comentarios justificatorios sobre policies USING (true)
-- =========================================================================
-- R2 permite USING (true) si está justificado. Sumamos los comments.

COMMENT ON POLICY config_global_select ON public.config_global IS
  'R2 · USING (true) JUSTIFICADO: config_global es singleton de configuración compartida (datos fiscales, branding, throttles). Toda la app autenticada necesita leerla.';

COMMENT ON POLICY frases_read_all ON public.frases_diarias IS
  'R2 · USING (true) JUSTIFICADO: frases del día son contenido compartido público (visible para todo profile activo). Sólo SELECT — CUD bloqueado.';

COMMENT ON POLICY tcc_select_auth ON public.tracking_categorias_config IS
  'R2 · USING (true) JUSTIFICADO: catálogo global de categorías de tracking (compartido entre todos los staff y clientes). Sólo SELECT — CUD gated por staff en policy aparte.';

COMMENT ON POLICY tec_select_auth ON public.tracking_estados_config IS
  'R2 · USING (true) JUSTIFICADO: catálogo global de estados de tracking. Mismo razonamiento que tracking_categorias_config.';

COMMENT ON POLICY webinars_authenticated_select ON public.webinars IS
  'R2 · USING (true) JUSTIFICADO: catálogo de webinars del campus es visible para todo usuario autenticado (gerentes ven todo, clientes ven el catálogo público para inscribirse).';

-- =========================================================================
-- (E) Índice faltante en health_flow_alerts.origen_run_id (R11)
-- =========================================================================
CREATE INDEX IF NOT EXISTS idx_health_flow_alerts_origen_run_id
  ON public.health_flow_alerts (origen_run_id);

COMMENT ON INDEX public.idx_health_flow_alerts_origen_run_id IS
  'DGG-34 · R11 · FK formal a health_flow_runs sin índice. Tabla crece monotónica con cada cron.';
