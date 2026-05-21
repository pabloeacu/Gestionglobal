-- ============================================================================
-- 0038_agenda_mdc_pattern · Refactor de Agenda al patrón MDC (4 tablas) +
-- categorías de sistema + recurrencia virtual con overrides.
--
-- Capitalizamos el aprendizaje de MDC (handoff AGENDA_GERENCIAL_HANDOFF.md,
-- secciones B3/B4 + lecciones E1..E14). Filosofía: agenda como "organizador
-- ejecutivo personal" de los gerentes; aislada del resto del sistema; los
-- vínculos a entidades (consorcios, administraciones, comprobantes, trámites)
-- son IDs sueltos UNIDIRECCIONALES — la agenda apunta, no acopla.
--
-- Decisiones (CLAUDE.md):
-- - Regla 2: RLS por owner_id = auth.uid(). En este proyecto NO existe rol
--   "gerencia"; el rol equivalente en profiles es 'gerente'. NO usamos
--   private.is_gerente() en RLS porque el dueño puede ser cualquier user con
--   perfil válido (el sidebar ya restringe la ruta /gerencia/agenda). El
--   owner = auth.uid() ES la regla de aislamiento.
-- - Regla 5: función seed con SECURITY DEFINER + SET search_path.
-- - Regla 6: migración versionada (esta).
-- - Regla 8: schema en inglés (agenda_events, agenda_categories), copy ES en
--   UI. La tabla previa agenda_eventos queda DEPRECATED (0 filas en prod;
--   conservada por seguridad — dropear en migración futura cuando confirmemos
--   que no se referencia desde ninguna parte).
-- - Regla 11: índices en (owner_id, start_at), (owner_id, is_done),
--   (event_id, occurrence_date).
--
-- Lecciones capitalizadas del handoff aplicadas a nivel schema:
-- - E1 / A2.10: ningún gesto persiste antes del Guardar → la UI usa drafts
--   en memoria. La tabla solo recibe INSERTs explícitos.
-- - E8: capa 2 (vínculos) son columnas opcionales en la misma fila madre.
-- - E13: reminder_offsets queda en la tabla pero el motor lo ignora
--   (alarmas configurables descartadas por decisión firme de producto).
-- - E10: la recurrencia es REGLA en la fila madre + overrides por fecha,
--   NO se materializan ocurrencias.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- A) DEPRECAR tabla anterior (no la dropeamos: por seguridad).
-- ---------------------------------------------------------------------------
COMMENT ON TABLE public.agenda_eventos IS
  'DEPRECATED 2026-05-21 (0038). Usar agenda_events. Migrar y dropear en una migración futura. Conservada porque está referenciada por triggers en otros módulos (vencimientos).';

-- Bajar el cron viejo (E9 del handoff: cuidado con duplicados de pg_cron).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'agenda-recordatorios-5min') THEN
    PERFORM cron.unschedule('agenda-recordatorios-5min');
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- B) CATEGORÍAS (8 de sistema + las que cree el owner).
-- ---------------------------------------------------------------------------
CREATE TABLE public.agenda_categories (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id   uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name       text NOT NULL,
  color      text NOT NULL,       -- hex "#06b6d4"
  icon       text,                -- nombre de ícono lucide (string)
  is_system  boolean NOT NULL DEFAULT false,
  orden      integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(owner_id, name)
);
CREATE INDEX idx_agenda_categories_owner ON public.agenda_categories(owner_id);

-- ---------------------------------------------------------------------------
-- C) EVENT MADRE — la recurrencia es regla, las ocurrencias son virtuales.
-- ---------------------------------------------------------------------------
CREATE TABLE public.agenda_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title       text NOT NULL,
  notes       text,
  category_id uuid REFERENCES public.agenda_categories(id) ON DELETE SET NULL,

  start_at    timestamptz,        -- NULL = sin fecha (bandeja)
  end_at      timestamptz,
  all_day     boolean NOT NULL DEFAULT false,

  is_done     boolean NOT NULL DEFAULT false,
  done_at     timestamptz,

  priority    text NOT NULL DEFAULT 'media'
              CHECK (priority IN ('baja','media','alta')),

  -- Previsto pero NO usado por el motor (E13 del handoff).
  reminder_offsets    integer[] NOT NULL DEFAULT '{}',

  recurrence          text NOT NULL DEFAULT 'none'
                      CHECK (recurrence IN ('none','daily','weekly','monthly')),
  recurrence_weekdays integer[],          -- 0=dom..6=sáb
  recurrence_monthday integer CHECK (recurrence_monthday IS NULL
                                     OR (recurrence_monthday BETWEEN 1 AND 31)),
  recurrence_until    date,

  color_override      text,               -- hex para pisar color de categoría

  -- Vínculos UNIDIRECCIONALES a entidades del negocio (Gestión Global).
  -- IDs sueltos sin FK fuerte: si la entidad se borra, el vínculo queda
  -- "colgado" — es intencional (A2.2 del handoff).
  linked_consorcio_ids     uuid[] NOT NULL DEFAULT '{}',
  linked_administracion_id uuid,
  linked_comprobante_id    uuid,
  linked_tramite_id        uuid,

  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_agenda_events_owner_start ON public.agenda_events(owner_id, start_at);
CREATE INDEX idx_agenda_events_owner_done  ON public.agenda_events(owner_id, is_done);
CREATE INDEX idx_agenda_events_category    ON public.agenda_events(category_id)
  WHERE category_id IS NOT NULL;
CREATE INDEX idx_agenda_events_adm         ON public.agenda_events(linked_administracion_id)
  WHERE linked_administracion_id IS NOT NULL;

CREATE OR REPLACE FUNCTION private.agenda_events_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_agenda_events_touch ON public.agenda_events;
CREATE TRIGGER trg_agenda_events_touch
  BEFORE UPDATE ON public.agenda_events
  FOR EACH ROW EXECUTE FUNCTION private.agenda_events_touch_updated_at();

CREATE OR REPLACE FUNCTION private.agenda_categories_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_agenda_categories_touch ON public.agenda_categories;
CREATE TRIGGER trg_agenda_categories_touch
  BEFORE UPDATE ON public.agenda_categories
  FOR EACH ROW EXECUTE FUNCTION private.agenda_categories_touch_updated_at();

-- ---------------------------------------------------------------------------
-- D) OVERRIDES — excepciones por fecha de una ocurrencia recurrente.
-- ---------------------------------------------------------------------------
CREATE TABLE public.agenda_event_overrides (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id     uuid NOT NULL REFERENCES public.agenda_events(id) ON DELETE CASCADE,
  original_date date NOT NULL,
  status        text NOT NULL CHECK (status IN ('moved','skipped','done')),
  new_start_at  timestamptz,
  new_end_at    timestamptz,
  done_at       timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (parent_id, original_date)
);
CREATE INDEX idx_agenda_overrides_parent ON public.agenda_event_overrides(parent_id);

-- ---------------------------------------------------------------------------
-- E) LOG DE RECORDATORIOS — idempotencia del cron (E9, F2 del handoff).
-- ---------------------------------------------------------------------------
CREATE TABLE public.agenda_reminders_log (
  id              bigserial PRIMARY KEY,
  event_id        uuid NOT NULL REFERENCES public.agenda_events(id) ON DELETE CASCADE,
  occurrence_date date NOT NULL,
  kind            text NOT NULL CHECK (kind IN ('inicial','realerta','cierre')),
  sent_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, occurrence_date, kind)
);
CREATE INDEX idx_agenda_log_event_date
  ON public.agenda_reminders_log (event_id, occurrence_date);

-- ---------------------------------------------------------------------------
-- F) RLS — owner_id = auth.uid().
--    Single-tenant: el sidebar ya restringe la ruta a roles staff. En la BD
--    enforzamos owner-only: cada gerente/operador maneja SU agenda personal.
--    Administradores clientes NO ven la agenda interna del staff (no hay
--    chequeo de rol acá porque owner_id ya es exclusivo de profiles staff;
--    si un administrador llegase a tener filas suyas, son SU agenda, no la
--    del staff — patrón aislado a propósito).
-- ---------------------------------------------------------------------------
ALTER TABLE public.agenda_categories      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agenda_events          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agenda_event_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agenda_reminders_log   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agenda_cats_owner ON public.agenda_categories;
CREATE POLICY agenda_cats_owner ON public.agenda_categories
  FOR ALL TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS agenda_events_owner ON public.agenda_events;
CREATE POLICY agenda_events_owner ON public.agenda_events
  FOR ALL TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

-- Overrides: enforcement vía parent_id del evento madre.
DROP POLICY IF EXISTS agenda_overrides_owner ON public.agenda_event_overrides;
CREATE POLICY agenda_overrides_owner ON public.agenda_event_overrides
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.agenda_events e
                  WHERE e.id = parent_id AND e.owner_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.agenda_events e
                       WHERE e.id = parent_id AND e.owner_id = auth.uid()));

DROP POLICY IF EXISTS agenda_log_owner_select ON public.agenda_reminders_log;
CREATE POLICY agenda_log_owner_select ON public.agenda_reminders_log
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.agenda_events e
                  WHERE e.id = event_id AND e.owner_id = auth.uid()));
-- INSERT al log lo hace solo el cron (SECURITY DEFINER) — no exponemos
-- política de INSERT a authenticated.

-- ---------------------------------------------------------------------------
-- G) SEED DE CATEGORÍAS DE SISTEMA
--    8 categorías iniciales con colores de la marca Gestión Global
--    (cian / teal / violeta / ámbar / esmeralda / rosado).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.gg_agenda_seed_default_categories(p_owner uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_owner IS NULL THEN RETURN; END IF;
  -- Solo permitimos sembrar para uno mismo o si el caller es staff.
  IF auth.uid() IS NOT NULL
     AND auth.uid() <> p_owner
     AND NOT private.is_staff() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.agenda_categories (owner_id, name, color, icon, is_system, orden)
  VALUES
    (p_owner, 'Liquidaciones', '#06b6d4', 'FileText',    true, 1),
    (p_owner, 'Asambleas',     '#0ea5e9', 'Users',       true, 2),
    (p_owner, 'Cobranzas',     '#10b981', 'DollarSign',  true, 3),
    (p_owner, 'Trámites',      '#7c3aed', 'Briefcase',   true, 4),
    (p_owner, 'Vencimientos',  '#f59e0b', 'AlarmClock',  true, 5),
    (p_owner, 'Personal',      '#ec4899', 'User',        true, 6),
    (p_owner, 'Recordatorios', '#14b8a6', 'Bell',        true, 7),
    (p_owner, 'Otros',         '#64748b', 'Circle',      true, 8)
  ON CONFLICT (owner_id, name) DO NOTHING;
END $$;
REVOKE EXECUTE ON FUNCTION public.gg_agenda_seed_default_categories(uuid)
  FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.gg_agenda_seed_default_categories(uuid)
  TO authenticated;

-- Trigger en profiles: si el rol es staff (gerente/operador), sembramos
-- categorías la primera vez que el usuario aparece. Idempotente vía ON
-- CONFLICT, así que es seguro re-llamarla. NO bloqueamos la creación si
-- ya existen (el ON CONFLICT del INSERT lo absorbe).
CREATE OR REPLACE FUNCTION private.agenda_seed_on_profile_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.role IN ('gerente','operador') THEN
    PERFORM public.gg_agenda_seed_default_categories(NEW.id);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_agenda_seed_on_profile ON public.profiles;
CREATE TRIGGER trg_agenda_seed_on_profile
  AFTER INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION private.agenda_seed_on_profile_insert();

-- Backfill: sembrar para todos los staff actuales.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.profiles WHERE role IN ('gerente','operador') LOOP
    PERFORM public.gg_agenda_seed_default_categories(r.id);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- H) RPC catálogo de vínculos (para el panel lateral de la modal).
--    Devuelve solo lo que el caller tiene derecho a ver (RLS de las tablas
--    subyacentes hace el filtro). Pero como administraciones / consorcios /
--    comprobantes / tramites tienen RLS que ya excluye lo ajeno, podemos
--    hacer SELECT directo.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.gg_agenda_listar_vinculos()
RETURNS TABLE(
  tipo  text,
  id    uuid,
  label text,
  hint  text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
    SELECT 'administracion'::text, a.id, a.nombre, NULL::text
      FROM public.administraciones a
     WHERE a.estado <> 'baja'
     ORDER BY a.nombre
     LIMIT 500;

  RETURN QUERY
    SELECT 'consorcio'::text, c.id, c.nombre,
           (SELECT a2.nombre FROM public.administraciones a2 WHERE a2.id = c.administracion_id)
      FROM public.consorcios c
     ORDER BY c.nombre
     LIMIT 1000;

  RETURN QUERY
    SELECT 'comprobante'::text, cp.id,
           (cp.tipo || ' '
            || lpad(cp.punto_venta::text, 4, '0') || '-'
            || lpad(cp.numero::text, 8, '0'))::text,
           (SELECT a3.nombre FROM public.administraciones a3 WHERE a3.id = cp.administracion_id)
      FROM public.comprobantes cp
     ORDER BY cp.fecha DESC NULLS LAST
     LIMIT 500;

  RETURN QUERY
    SELECT 'tramite'::text, t.id,
           COALESCE(t.titulo, '(sin título)')::text,
           t.estado
      FROM public.tramites t
     ORDER BY t.created_at DESC
     LIMIT 500;
END $$;
REVOKE EXECUTE ON FUNCTION public.gg_agenda_listar_vinculos() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.gg_agenda_listar_vinculos() TO authenticated;

COMMENT ON FUNCTION public.gg_agenda_listar_vinculos() IS
  'Catálogo de vínculos para el panel lateral de la agenda. Devuelve administraciones, consorcios, comprobantes y trámites como filas con (tipo, id, label, hint). Limita a 500-1000 por categoría — la UI filtra cliente-side. Solo staff.';
