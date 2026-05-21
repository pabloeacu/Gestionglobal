-- ============================================================================
-- 0027_recupero · Recupero / Cobranzas con niveles R1 / R2 / R3 (MDC-17).
--
-- Subsistema que recupera el bagaje MANAXER de "gestión de mora": un flujo
-- progresivo de comunicaciones al cliente con TONOS diferenciados según los
-- días vencidos:
--   · R1 (amistoso)    → 7 días vencido    (default)
--   · R2 (firme)       → 30 días vencido   (default)
--   · R3 (prejudicial) → 60 días vencido   (default)
--
-- Cada acción de recupero queda persistida en `recupero_acciones` y dispara
-- (vía `encolar_email`) un mail al cliente usando una plantilla de
-- `email_templates` con slug homónimo al nivel (recupero-r1-amistoso, etc.).
--
-- Citas:
--   · regla 1 (persistencia BD) — toda acción se guarda; el setState NUNCA
--     reemplaza la fila.
--   · regla 2 (RLS día 1) — `ENABLE ROW LEVEL SECURITY` + policies por rol.
--   · regla 5 (RPC SD para multi-tabla) — disparar_recupero_manual toca
--     `recupero_acciones` + `email_queue` (vía encolar_email).
--   · regla 8 / E43 — antes de tocar `comprobantes` chequeamos columnas con
--     information_schema (saldo_pendiente / estado_cobranza / vencimiento).
--   · regla 11 — índices sobre cada FK (Postgres NO los crea solo).
--   · regla 12 / E45 / E49 — tenancy guard `assert_administracion_access`
--     en toda RPC SD que reciba `p_administracion_id`.
--   · D05 / E42 — el throttle global de email_workflow se respeta por la
--     vía del dispatcher; este módulo sólo encola.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- recupero_plantillas · catálogo de las 3 plantillas R1/R2/R3 (no es lo mismo
-- que `email_templates`: acá guardamos el contenido editable por el usuario
-- de GerenciaGlobal y la metadata del nivel; el mail real se renderea con la
-- plantilla de email_templates con mismo slug — D10).
-- ---------------------------------------------------------------------------
CREATE TABLE public.recupero_plantillas (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          text UNIQUE NOT NULL,
  nivel         smallint NOT NULL CHECK (nivel BETWEEN 1 AND 3),
  asunto        text NOT NULL,
  body          text NOT NULL,
  dias_desde_vencimiento_min smallint NOT NULL DEFAULT 0,
  activo        boolean NOT NULL DEFAULT true,
  descripcion   text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_recupero_plantillas_nivel ON public.recupero_plantillas(nivel);
CREATE INDEX idx_recupero_plantillas_activo
  ON public.recupero_plantillas(activo) WHERE activo = true;

CREATE TRIGGER trg_recupero_plantillas_touch
  BEFORE UPDATE ON public.recupero_plantillas
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- recupero_config · ventana por administración (NULL = global default).
-- Permite que la gerencia ajuste por cliente (clientes premium / heavy
-- pueden tener R1 más temprano o R3 inactivo, etc.).
-- ---------------------------------------------------------------------------
CREATE TABLE public.recupero_config (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  administracion_id           uuid
    REFERENCES public.administraciones(id) ON DELETE CASCADE,

  dias_r1                     smallint NOT NULL DEFAULT 7
                                CHECK (dias_r1 BETWEEN 1 AND 365),
  dias_r2                     smallint NOT NULL DEFAULT 30
                                CHECK (dias_r2 BETWEEN 1 AND 365),
  dias_r3                     smallint NOT NULL DEFAULT 60
                                CHECK (dias_r3 BETWEEN 1 AND 365),

  activo_r1                   boolean NOT NULL DEFAULT true,
  activo_r2                   boolean NOT NULL DEFAULT true,
  activo_r3                   boolean NOT NULL DEFAULT true,

  -- Si está seteado, los emails se mandan a esta dirección en vez de la
  -- de la administración (útil para clientes que prefieren contacto centralizado).
  email_destinatario_override text,

  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT chk_recupero_cfg_orden
    CHECK (dias_r1 < dias_r2 AND dias_r2 < dias_r3)
);

-- Unicidad: una fila por administracion_id; la "global" (NULL) también única.
CREATE UNIQUE INDEX uq_recupero_cfg_admin
  ON public.recupero_config(administracion_id)
  WHERE administracion_id IS NOT NULL;
-- partial unique sobre constante para forzar fila única "global" (admin NULL).
CREATE UNIQUE INDEX uq_recupero_cfg_global
  ON public.recupero_config ((true))
  WHERE administracion_id IS NULL;

CREATE INDEX idx_recupero_cfg_admin
  ON public.recupero_config(administracion_id)
  WHERE administracion_id IS NOT NULL;

CREATE TRIGGER trg_recupero_cfg_touch
  BEFORE UPDATE ON public.recupero_config
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- recupero_acciones · log de cada gestión disparada (manual o por cron).
-- ---------------------------------------------------------------------------
CREATE TABLE public.recupero_acciones (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  comprobante_id   uuid NOT NULL
    REFERENCES public.comprobantes(id) ON DELETE CASCADE,
  administracion_id uuid NOT NULL
    REFERENCES public.administraciones(id) ON DELETE CASCADE,
  consorcio_id     uuid
    REFERENCES public.consorcios(id) ON DELETE SET NULL,

  nivel            smallint NOT NULL CHECK (nivel BETWEEN 1 AND 3),
  plantilla_slug   text REFERENCES public.recupero_plantillas(slug)
                     ON UPDATE CASCADE ON DELETE SET NULL,

  email_queue_id   uuid REFERENCES public.email_queue(id) ON DELETE SET NULL,

  enviado_at       timestamptz NOT NULL DEFAULT now(),
  autor            uuid REFERENCES public.profiles(id) ON DELETE SET NULL,

  observaciones    text,
  monto_adeudado   numeric(14,2),
  dias_vencido     smallint,

  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_racc_comprobante     ON public.recupero_acciones(comprobante_id);
CREATE INDEX idx_racc_admin           ON public.recupero_acciones(administracion_id);
CREATE INDEX idx_racc_consorcio       ON public.recupero_acciones(consorcio_id)
  WHERE consorcio_id IS NOT NULL;
CREATE INDEX idx_racc_plantilla_slug  ON public.recupero_acciones(plantilla_slug)
  WHERE plantilla_slug IS NOT NULL;
CREATE INDEX idx_racc_email_queue     ON public.recupero_acciones(email_queue_id)
  WHERE email_queue_id IS NOT NULL;
CREATE INDEX idx_racc_autor           ON public.recupero_acciones(autor)
  WHERE autor IS NOT NULL;
CREATE INDEX idx_racc_nivel_enviado   ON public.recupero_acciones(nivel, enviado_at DESC);

-- ---------------------------------------------------------------------------
-- Trigger anti-spam: si ya hay una acción del MISMO nivel para ese
-- comprobante en los últimos 7 días, abortamos. Evita re-disparos del cron y
-- doble-clicks del operador. (regla 9 / E42 análogo: throttle de evento.)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.recupero_no_duplicar()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count int;
BEGIN
  SELECT COUNT(*) INTO v_count
    FROM public.recupero_acciones
   WHERE comprobante_id = NEW.comprobante_id
     AND nivel = NEW.nivel
     AND enviado_at > now() - interval '7 days';

  IF v_count > 0 THEN
    RAISE EXCEPTION
      'Ya existe una acción de recupero nivel R% para este comprobante en los últimos 7 días', NEW.nivel
      USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.recupero_no_duplicar() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_recupero_no_duplicar
  BEFORE INSERT ON public.recupero_acciones
  FOR EACH ROW EXECUTE FUNCTION public.recupero_no_duplicar();

-- ---------------------------------------------------------------------------
-- dispatch_recupero_log · auditoría del cron diario (P-CRON-LOG).
-- ---------------------------------------------------------------------------
CREATE TABLE public.dispatch_recupero_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  corrida_at    timestamptz NOT NULL DEFAULT now(),
  procesados    int NOT NULL DEFAULT 0,
  encolados     int NOT NULL DEFAULT 0,
  errores       jsonb NOT NULL DEFAULT '[]'::jsonb,
  duracion_ms   int
);
CREATE INDEX idx_dispatch_recupero_corrida
  ON public.dispatch_recupero_log(corrida_at DESC);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.recupero_plantillas    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recupero_config        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recupero_acciones      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dispatch_recupero_log  ENABLE ROW LEVEL SECURITY;

-- recupero_plantillas: staff full; administrador SELECT (puede ver el copy
-- pero no editarlo).
DROP POLICY IF EXISTS recupero_plt_staff_all ON public.recupero_plantillas;
CREATE POLICY recupero_plt_staff_all ON public.recupero_plantillas
  FOR ALL TO authenticated
  USING (private.is_staff())
  WITH CHECK (private.is_staff());

DROP POLICY IF EXISTS recupero_plt_admin_select ON public.recupero_plantillas;
CREATE POLICY recupero_plt_admin_select ON public.recupero_plantillas
  FOR SELECT TO authenticated
  USING (private.is_administrador());

-- recupero_config: staff full; administrador SELECT (su propia + global).
DROP POLICY IF EXISTS recupero_cfg_staff_all ON public.recupero_config;
CREATE POLICY recupero_cfg_staff_all ON public.recupero_config
  FOR ALL TO authenticated
  USING (private.is_staff())
  WITH CHECK (private.is_staff());

DROP POLICY IF EXISTS recupero_cfg_admin_select ON public.recupero_config;
CREATE POLICY recupero_cfg_admin_select ON public.recupero_config
  FOR SELECT TO authenticated
  USING (
    private.is_administrador()
    AND (administracion_id IS NULL
         OR administracion_id = private.current_administracion_id())
  );

-- recupero_acciones: staff full; administrador SELECT solo de su admin.
DROP POLICY IF EXISTS recupero_acc_staff_all ON public.recupero_acciones;
CREATE POLICY recupero_acc_staff_all ON public.recupero_acciones
  FOR ALL TO authenticated
  USING (private.is_staff())
  WITH CHECK (private.is_staff());

DROP POLICY IF EXISTS recupero_acc_admin_select ON public.recupero_acciones;
CREATE POLICY recupero_acc_admin_select ON public.recupero_acciones
  FOR SELECT TO authenticated
  USING (
    private.is_administrador()
    AND administracion_id = private.current_administracion_id()
  );

-- dispatch_recupero_log: sólo staff.
DROP POLICY IF EXISTS drl_staff_all ON public.dispatch_recupero_log;
CREATE POLICY drl_staff_all ON public.dispatch_recupero_log
  FOR ALL TO authenticated
  USING (private.is_staff())
  WITH CHECK (private.is_staff());

-- ---------------------------------------------------------------------------
-- RPC · disparar_recupero_manual
-- Crea una acción de nivel N para un comprobante específico y encola el
-- email correspondiente. Sólo staff (gerentes/operadores) puede disparar
-- esto manualmente — el administrador NO autodispara sus propios recuperos.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.disparar_recupero_manual(
  p_comprobante_id uuid,
  p_nivel          smallint,
  p_observaciones  text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_comp          record;
  v_admin         public.administraciones%ROWTYPE;
  v_cfg           public.recupero_config%ROWTYPE;
  v_plantilla     public.recupero_plantillas%ROWTYPE;
  v_email_dest    text;
  v_email_queue   uuid;
  v_accion_id     uuid;
  v_dias_vencido  int;
  v_nombre_contacto text;
  v_consorcio_nombre text;
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo gerentes/operadores pueden disparar recupero manual'
      USING ERRCODE = '42501';
  END IF;

  IF p_nivel NOT BETWEEN 1 AND 3 THEN
    RAISE EXCEPTION 'Nivel inválido: debe ser 1, 2 o 3' USING ERRCODE = '22023';
  END IF;

  -- Cargar comprobante.
  SELECT
    c.id, c.administracion_id, c.consorcio_id,
    c.tipo, c.numero, c.punto_venta,
    c.total, c.saldo_pendiente, c.estado_cobranza,
    c.fecha, c.vencimiento, c.estado
  INTO v_comp
  FROM public.comprobantes c
  WHERE c.id = p_comprobante_id;

  IF v_comp.id IS NULL THEN
    RAISE EXCEPTION 'Comprobante no encontrado' USING ERRCODE = 'P0002';
  END IF;

  IF v_comp.estado IN ('anulado','borrador') THEN
    RAISE EXCEPTION 'Comprobante en estado % no admite recupero', v_comp.estado
      USING ERRCODE = '22023';
  END IF;

  IF COALESCE(v_comp.saldo_pendiente, 0) <= 0 THEN
    RAISE EXCEPTION 'Comprobante sin saldo pendiente' USING ERRCODE = '22023';
  END IF;

  v_dias_vencido := CASE
    WHEN v_comp.vencimiento IS NULL THEN 0
    WHEN v_comp.vencimiento < CURRENT_DATE THEN (CURRENT_DATE - v_comp.vencimiento)::int
    ELSE 0
  END;

  -- Plantilla por nivel (slug fijo del seed).
  SELECT * INTO v_plantilla
  FROM public.recupero_plantillas
  WHERE nivel = p_nivel AND activo = true
  ORDER BY id
  LIMIT 1;

  IF v_plantilla.slug IS NULL THEN
    RAISE EXCEPTION 'No hay plantilla activa para nivel R%', p_nivel
      USING ERRCODE = 'P0002';
  END IF;

  -- Destinatario (override en config o email de la administración).
  SELECT * INTO v_cfg
  FROM public.recupero_config
  WHERE administracion_id = v_comp.administracion_id;

  SELECT * INTO v_admin FROM public.administraciones
  WHERE id = v_comp.administracion_id;

  v_email_dest := COALESCE(
    NULLIF(trim(v_cfg.email_destinatario_override), ''),
    NULLIF(trim(v_admin.email), '')
  );

  IF v_email_dest IS NULL THEN
    RAISE EXCEPTION 'La administración no tiene email cargado'
      USING ERRCODE = '23502';
  END IF;

  v_nombre_contacto := COALESCE(
    NULLIF(trim(concat_ws(' ', v_admin.responsable_nombre, v_admin.responsable_apellido)), ''),
    v_admin.nombre
  );

  IF v_comp.consorcio_id IS NOT NULL THEN
    SELECT nombre INTO v_consorcio_nombre
    FROM public.consorcios WHERE id = v_comp.consorcio_id;
  END IF;

  -- Encolar email (mismo slug que email_templates seedeado abajo).
  v_email_queue := public.encolar_email(
    v_plantilla.slug,
    v_email_dest,
    v_nombre_contacto,
    jsonb_build_object(
      'nombre',                v_nombre_contacto,
      'nombre_administracion', v_admin.nombre,
      'consorcio_nombre',      v_consorcio_nombre,
      'comprobante_tipo',      v_comp.tipo,
      'comprobante_numero',    lpad(v_comp.punto_venta::text, 5, '0') || '-' || lpad(COALESCE(v_comp.numero, 0)::text, 8, '0'),
      'comprobante_total',     v_comp.total,
      'saldo_pendiente',       v_comp.saldo_pendiente,
      'fecha_vencimiento',     v_comp.vencimiento,
      'dias_vencido',          v_dias_vencido,
      'nivel',                 p_nivel,
      'observaciones',         p_observaciones
    ),
    v_comp.administracion_id,
    v_comp.consorcio_id,
    'recupero_acciones',
    NULL,                       -- p_related_id se updatea después con el id de la acción
    CASE WHEN p_nivel = 3 THEN 1::smallint WHEN p_nivel = 2 THEN 2::smallint ELSE 3::smallint END
  );

  -- Insertar la acción (el trigger anti-dup chequea 7 días).
  INSERT INTO public.recupero_acciones (
    comprobante_id, administracion_id, consorcio_id,
    nivel, plantilla_slug, email_queue_id,
    autor, observaciones, monto_adeudado, dias_vencido
  ) VALUES (
    v_comp.id, v_comp.administracion_id, v_comp.consorcio_id,
    p_nivel, v_plantilla.slug, v_email_queue,
    auth.uid(), p_observaciones,
    v_comp.saldo_pendiente, v_dias_vencido::smallint
  )
  RETURNING id INTO v_accion_id;

  -- Linkear el email_queue al id de la acción (related_id) para auditoría.
  UPDATE public.email_queue
     SET related_id = v_accion_id
   WHERE id = v_email_queue;

  -- Marcamos el comprobante en estado en_recupero (idempotente).
  UPDATE public.comprobantes
     SET estado_cobranza = 'en_recupero'
   WHERE id = v_comp.id
     AND estado_cobranza IN ('pendiente','parcial','vencido');

  RETURN v_accion_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.disparar_recupero_manual(uuid, smallint, text)
  FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.disparar_recupero_manual(uuid, smallint, text)
  TO authenticated;

-- ---------------------------------------------------------------------------
-- RPC · comprobantes_morosos
-- Devuelve los comprobantes con saldo > 0 y vencimiento pasado, con el
-- nivel SUGERIDO según la config (override por admin o global).
-- Para staff: todos (o filtrado por p_administracion_id).
-- Para administrador: sólo los de su administración (tenancy guard).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.comprobantes_morosos(
  p_administracion_id uuid DEFAULT NULL
)
RETURNS TABLE (
  comprobante_id        uuid,
  comprobante_tipo      text,
  comprobante_numero    int,
  punto_venta           int,
  fecha                 date,
  vencimiento           date,
  total                 numeric,
  saldo_pendiente       numeric,
  estado_cobranza       text,
  administracion_id     uuid,
  administracion_nombre text,
  consorcio_id          uuid,
  consorcio_nombre      text,
  dias_vencido          int,
  nivel_sugerido        smallint,
  ultima_accion_at      timestamptz,
  ultima_accion_nivel   smallint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin_filter uuid := p_administracion_id;
BEGIN
  IF NOT private.is_staff() THEN
    -- Administrador: forzamos su id (regla 12).
    v_admin_filter := private.current_administracion_id();
    IF v_admin_filter IS NULL THEN
      RAISE EXCEPTION 'Sin administración asociada' USING ERRCODE = '42501';
    END IF;
  ELSIF p_administracion_id IS NOT NULL THEN
    PERFORM private.assert_administracion_access(p_administracion_id);
  END IF;

  RETURN QUERY
  WITH cfg_global AS (
    SELECT dias_r1, dias_r2, dias_r3, activo_r1, activo_r2, activo_r3
    FROM public.recupero_config
    WHERE administracion_id IS NULL
    LIMIT 1
  ),
  ultimas AS (
    SELECT DISTINCT ON (ra.comprobante_id)
      ra.comprobante_id, ra.enviado_at, ra.nivel
    FROM public.recupero_acciones ra
    ORDER BY ra.comprobante_id, ra.enviado_at DESC
  )
  SELECT
    c.id,
    c.tipo,
    c.numero,
    c.punto_venta,
    c.fecha,
    c.vencimiento,
    c.total::numeric,
    c.saldo_pendiente::numeric,
    c.estado_cobranza,
    a.id,
    a.nombre,
    cs.id,
    cs.nombre,
    GREATEST(0, (CURRENT_DATE - c.vencimiento))::int AS dias_vencido,
    CASE
      WHEN c.vencimiento IS NULL OR c.vencimiento >= CURRENT_DATE THEN NULL
      WHEN (CURRENT_DATE - c.vencimiento) >=
           COALESCE(cfg_admin.dias_r3, cfg_g.dias_r3, 60)
           AND COALESCE(cfg_admin.activo_r3, cfg_g.activo_r3, true)
        THEN 3::smallint
      WHEN (CURRENT_DATE - c.vencimiento) >=
           COALESCE(cfg_admin.dias_r2, cfg_g.dias_r2, 30)
           AND COALESCE(cfg_admin.activo_r2, cfg_g.activo_r2, true)
        THEN 2::smallint
      WHEN (CURRENT_DATE - c.vencimiento) >=
           COALESCE(cfg_admin.dias_r1, cfg_g.dias_r1, 7)
           AND COALESCE(cfg_admin.activo_r1, cfg_g.activo_r1, true)
        THEN 1::smallint
      ELSE NULL
    END AS nivel_sugerido,
    u.enviado_at,
    u.nivel
  FROM public.comprobantes c
  JOIN public.administraciones a ON a.id = c.administracion_id
  LEFT JOIN public.consorcios   cs ON cs.id = c.consorcio_id
  LEFT JOIN public.recupero_config cfg_admin
    ON cfg_admin.administracion_id = c.administracion_id
  LEFT JOIN cfg_global cfg_g ON true
  LEFT JOIN ultimas u ON u.comprobante_id = c.id
  WHERE c.estado NOT IN ('anulado','borrador')
    AND c.saldo_pendiente > 0
    AND c.vencimiento IS NOT NULL
    AND c.vencimiento < CURRENT_DATE
    AND (v_admin_filter IS NULL OR c.administracion_id = v_admin_filter)
  ORDER BY (CURRENT_DATE - c.vencimiento) DESC NULLS LAST, c.id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.comprobantes_morosos(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.comprobantes_morosos(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- Seed · recupero_plantillas (3 niveles) + email_templates con mismo slug
-- (el dispatcher renderea desde email_templates).
-- ---------------------------------------------------------------------------
INSERT INTO public.recupero_plantillas (slug, nivel, asunto, body, dias_desde_vencimiento_min, descripcion)
VALUES
  ('recupero-r1-amistoso', 1,
   'Recordatorio amistoso · comprobante {{comprobante_tipo}} {{comprobante_numero}}',
   E'Hola {{nombre}},\n\nQueríamos recordarte amablemente que el comprobante {{comprobante_tipo}} {{comprobante_numero}} por ${{saldo_pendiente}} (venció el {{fecha_vencimiento}}, hace {{dias_vencido}} días) figura como pendiente en nuestra cuenta corriente.\n\nSi ya hiciste el pago, ignorá este mensaje — puede que estemos cruzando información. Si no, sería un gran favor que regularices a la brevedad.\n\n¡Gracias!\nGestión Global',
   7, 'R1 · Tono amistoso. Default 7 días vencido.'),

  ('recupero-r2-firme', 2,
   'Aviso de mora · {{nombre_administracion}}',
   E'Hola {{nombre}},\n\nTe escribimos porque el comprobante {{comprobante_tipo}} {{comprobante_numero}} por ${{saldo_pendiente}} sigue pendiente. Venció el {{fecha_vencimiento}} y ya pasaron {{dias_vencido}} días.\n\nNecesitamos regularizar la situación a la brevedad para evitar costos adicionales y la suspensión temporal de servicios. Por favor, comunicate con nosotros para acordar el pago o respondé este correo si hay algún inconveniente.\n\nQuedamos atentos.\nGestión Global · Cobranzas',
   30, 'R2 · Tono firme. Default 30 días vencido.'),

  ('recupero-r3-prejudicial', 3,
   'Intimación prejudicial · comprobante {{comprobante_tipo}} {{comprobante_numero}}',
   E'Estimado/a {{nombre}},\n\nPor medio de la presente intimamos a {{nombre_administracion}} a regularizar en un plazo perentorio de 5 (cinco) días hábiles el saldo pendiente correspondiente al comprobante {{comprobante_tipo}} {{comprobante_numero}}, por un total de ${{saldo_pendiente}}, vencido el {{fecha_vencimiento}} ({{dias_vencido}} días de mora).\n\nDe no recibir el pago o un descargo formal dentro de dicho plazo, derivaremos el caso a nuestra área legal para iniciar las acciones judiciales correspondientes, con los costos asociados a cargo del deudor.\n\nEsperamos resolverlo amistosamente.\n\nGestión Global · Departamento Legal y Cobranzas',
   60, 'R3 · Tono prejudicial / intimación. Default 60 días vencido.')
ON CONFLICT (slug) DO NOTHING;

-- Plantillas equivalentes en email_templates (el dispatcher renderea desde acá).
INSERT INTO public.email_templates (slug, nombre, asunto, body_html, body_text, from_casilla, descripcion, variables)
VALUES
  ('recupero-r1-amistoso',
   'Recupero R1 — amistoso',
   'Recordatorio amistoso · comprobante {{comprobante_tipo}} {{comprobante_numero}}',
   '<p>Hola {{nombre}},</p><p>Queríamos recordarte amablemente que el comprobante <strong>{{comprobante_tipo}} {{comprobante_numero}}</strong> por <strong>${{saldo_pendiente}}</strong> (venció el {{fecha_vencimiento}}, hace {{dias_vencido}} días) figura como pendiente en nuestra cuenta corriente.</p><p>Si ya hiciste el pago, ignorá este mensaje — puede que estemos cruzando información. Si no, sería un gran favor que regularices a la brevedad.</p><p>¡Gracias!<br/><strong>Gestión Global</strong></p>',
   'Hola {{nombre}}, te recordamos que el comprobante {{comprobante_tipo}} {{comprobante_numero}} por ${{saldo_pendiente}} vencido el {{fecha_vencimiento}} sigue pendiente. ¡Gracias!',
   'recupero', 'R1 · Tono amistoso (default 7 días vencido).',
   '["nombre","nombre_administracion","comprobante_tipo","comprobante_numero","saldo_pendiente","fecha_vencimiento","dias_vencido"]'::jsonb),

  ('recupero-r2-firme',
   'Recupero R2 — firme',
   'Aviso de mora · {{nombre_administracion}}',
   '<p>Hola {{nombre}},</p><p>Te escribimos porque el comprobante <strong>{{comprobante_tipo}} {{comprobante_numero}}</strong> por <strong>${{saldo_pendiente}}</strong> sigue pendiente. Venció el {{fecha_vencimiento}} y ya pasaron {{dias_vencido}} días.</p><p>Necesitamos regularizar la situación a la brevedad para evitar costos adicionales y la suspensión temporal de servicios. Por favor, comunicate con nosotros para acordar el pago o respondé este correo si hay algún inconveniente.</p><p>Quedamos atentos.<br/><strong>Gestión Global · Cobranzas</strong></p>',
   'Comprobante {{comprobante_tipo}} {{comprobante_numero}} por ${{saldo_pendiente}} sigue impago ({{dias_vencido}} días). Regularizar a la brevedad.',
   'recupero', 'R2 · Tono firme (default 30 días vencido).',
   '["nombre","nombre_administracion","comprobante_tipo","comprobante_numero","saldo_pendiente","fecha_vencimiento","dias_vencido"]'::jsonb),

  ('recupero-r3-prejudicial',
   'Recupero R3 — prejudicial',
   'Intimación prejudicial · comprobante {{comprobante_tipo}} {{comprobante_numero}}',
   '<p>Estimado/a {{nombre}},</p><p>Por medio de la presente <strong>intimamos a {{nombre_administracion}}</strong> a regularizar en un plazo perentorio de 5 (cinco) días hábiles el saldo pendiente correspondiente al comprobante <strong>{{comprobante_tipo}} {{comprobante_numero}}</strong>, por un total de <strong>${{saldo_pendiente}}</strong>, vencido el {{fecha_vencimiento}} ({{dias_vencido}} días de mora).</p><p>De no recibir el pago o un descargo formal dentro de dicho plazo, derivaremos el caso a nuestra área legal para iniciar las acciones judiciales correspondientes, con los costos asociados a cargo del deudor.</p><p>Esperamos resolverlo amistosamente.</p><p><strong>Gestión Global · Departamento Legal y Cobranzas</strong></p>',
   'INTIMACIÓN: comprobante {{comprobante_tipo}} {{comprobante_numero}} por ${{saldo_pendiente}} ({{dias_vencido}} días vencido). Plazo: 5 días hábiles.',
   'recupero', 'R3 · Tono prejudicial (default 60 días vencido).',
   '["nombre","nombre_administracion","comprobante_tipo","comprobante_numero","saldo_pendiente","fecha_vencimiento","dias_vencido"]'::jsonb)
ON CONFLICT (slug) DO NOTHING;

-- Seed config global (administracion_id NULL). Idempotente: solo inserta si no
-- existe la fila global. (Partial unique index `uq_recupero_cfg_global` ya
-- evita duplicados, pero ON CONFLICT requiere arbiter inferable; usamos un
-- guard explícito.)
INSERT INTO public.recupero_config (
  administracion_id, dias_r1, dias_r2, dias_r3,
  activo_r1, activo_r2, activo_r3
)
SELECT NULL::uuid, 7, 30, 60, true, true, true
WHERE NOT EXISTS (
  SELECT 1 FROM public.recupero_config WHERE administracion_id IS NULL
);

-- ---------------------------------------------------------------------------
-- Cron · 09:30 AR = 12:30 UTC. URL hardcoded (no current_setting).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'dispatch-recupero-diario') THEN
    PERFORM cron.unschedule('dispatch-recupero-diario');
  END IF;
END $$;

SELECT cron.schedule(
  'dispatch-recupero-diario',
  '30 12 * * *',
  $cron$
    SELECT net.http_post(
      url := 'https://kaoyhkebnidzqjixvchh.supabase.co/functions/v1/dispatch-recupero',
      headers := jsonb_build_object('Content-Type','application/json'),
      body := '{}'::jsonb
    );
  $cron$
);
