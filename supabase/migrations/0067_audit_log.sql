-- ============================================================================
-- 0067_audit_log · DGG-35 / P2-#34
--
-- Bitácora unificada de cambios en tablas críticas. Cada INSERT/UPDATE/DELETE
-- en las tablas hookeadas genera una fila acá, capturando:
--   • table_name + action (insert/update/delete)
--   • row_pk (el id de la fila afectada)
--   • actor_id + actor_email (quien hizo el cambio)
--   • payload_before / payload_after (snapshots jsonb)
--   • created_at
--
-- Diseño:
--   • RLS: sólo staff (gerente + operador) puede leer.
--   • Sólo INSERT desde triggers SECURITY DEFINER (sin INSERT desde clientes).
--   • Sin DELETE (la bitácora es append-only — auditoría real).
--   • RPC `audit_log_listar` con filtros y paginación.
--
-- Tablas hookeadas en esta migración (las core de negocio):
--   administraciones, comprobantes, tramites, vencimientos, formularios,
--   solicitudes, partners, servicios.
--
-- Ampliable: para sumar una tabla nueva basta hacer
--   CREATE TRIGGER trg_audit_<tabla>
--     AFTER INSERT OR UPDATE OR DELETE ON public.<tabla>
--     FOR EACH ROW EXECUTE FUNCTION public._audit_log_trg();
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.audit_log (
  id           bigserial PRIMARY KEY,
  table_name   text NOT NULL,
  action       text NOT NULL CHECK (action IN ('insert','update','delete')),
  row_pk       text,                       -- typically the uuid as text
  actor_id     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_email  text,
  payload_before jsonb,
  payload_after  jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_table_created
  ON public.audit_log(table_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_actor_created
  ON public.audit_log(actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_row_pk
  ON public.audit_log(row_pk);

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

-- Lectura: sólo staff. (private.is_staff() ya existe — chequea profile.role)
DROP POLICY IF EXISTS audit_log_staff_select ON public.audit_log;
CREATE POLICY audit_log_staff_select ON public.audit_log
  FOR SELECT USING (private.is_staff());

-- NO INSERT / UPDATE / DELETE desde clientes. Sólo triggers SECURITY DEFINER.

COMMENT ON TABLE public.audit_log IS
  'DGG-35 / P2-#34. Bitácora unificada de cambios. Append-only. Sólo staff lee.';

-- ---------------------------------------------------------------------------
-- Trigger genérico
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._audit_log_trg()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_pk text;
  v_actor uuid;
  v_email text;
  v_before jsonb;
  v_after jsonb;
  v_action text;
BEGIN
  v_actor := auth.uid();
  BEGIN
    SELECT email INTO v_email FROM auth.users WHERE id = v_actor;
  EXCEPTION WHEN OTHERS THEN
    v_email := NULL;
  END;

  IF TG_OP = 'INSERT' THEN
    v_action := 'insert';
    v_after := to_jsonb(NEW);
    v_pk := COALESCE((v_after->>'id')::text, NEW::text);
  ELSIF TG_OP = 'UPDATE' THEN
    v_action := 'update';
    v_before := to_jsonb(OLD);
    v_after := to_jsonb(NEW);
    v_pk := COALESCE((v_after->>'id')::text, NEW::text);
    -- Si nada cambió realmente, no anotamos. Evita ruido por updated_at puro.
    IF v_before - 'updated_at' = v_after - 'updated_at' THEN
      RETURN NEW;
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    v_action := 'delete';
    v_before := to_jsonb(OLD);
    v_pk := COALESCE((v_before->>'id')::text, OLD::text);
  END IF;

  INSERT INTO public.audit_log(
    table_name, action, row_pk, actor_id, actor_email,
    payload_before, payload_after
  ) VALUES (
    TG_TABLE_NAME, v_action, v_pk, v_actor, v_email,
    v_before, v_after
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;

COMMENT ON FUNCTION public._audit_log_trg IS
  'Trigger genérico de auditoría. Hookear con AFTER INSERT OR UPDATE OR DELETE.';

-- ---------------------------------------------------------------------------
-- Aplicar a tablas core
-- ---------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT unnest(ARRAY[
      'administraciones', 'comprobantes', 'tramites', 'vencimientos',
      'formularios', 'solicitudes', 'partners', 'servicios'
    ])
  LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_audit_%I ON public.%I; '
      'CREATE TRIGGER trg_audit_%I '
      '  AFTER INSERT OR UPDATE OR DELETE ON public.%I '
      '  FOR EACH ROW EXECUTE FUNCTION public._audit_log_trg();',
      t, t, t, t
    );
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- RPCs públicas
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.audit_log_listar(
  p_limit int DEFAULT 50,
  p_offset int DEFAULT 0,
  p_table_filter text DEFAULT NULL,
  p_action_filter text DEFAULT NULL,
  p_actor_filter uuid DEFAULT NULL,
  p_desde timestamptz DEFAULT NULL,
  p_hasta timestamptz DEFAULT NULL
)
RETURNS TABLE(
  id bigint, table_name text, action text, row_pk text,
  actor_id uuid, actor_email text,
  payload_before jsonb, payload_after jsonb, created_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT a.id, a.table_name, a.action, a.row_pk, a.actor_id, a.actor_email,
         a.payload_before, a.payload_after, a.created_at
  FROM public.audit_log a
  WHERE private.is_staff()
    AND (p_table_filter IS NULL OR a.table_name = p_table_filter)
    AND (p_action_filter IS NULL OR a.action = p_action_filter)
    AND (p_actor_filter IS NULL OR a.actor_id = p_actor_filter)
    AND (p_desde IS NULL OR a.created_at >= p_desde)
    AND (p_hasta IS NULL OR a.created_at <= p_hasta)
  ORDER BY a.created_at DESC
  LIMIT GREATEST(LEAST(p_limit, 200), 1)
  OFFSET GREATEST(p_offset, 0);
$$;

CREATE OR REPLACE FUNCTION public.audit_log_resumen()
RETURNS TABLE(
  table_name text, total bigint, ultimos_7d bigint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT a.table_name, COUNT(*) total,
         COUNT(*) FILTER (WHERE a.created_at >= now() - INTERVAL '7 days') ultimos_7d
  FROM public.audit_log a
  WHERE private.is_staff()
  GROUP BY a.table_name
  ORDER BY total DESC;
$$;

GRANT EXECUTE ON FUNCTION public.audit_log_listar(int, int, text, text, uuid, timestamptz, timestamptz)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.audit_log_resumen()
  TO authenticated;
