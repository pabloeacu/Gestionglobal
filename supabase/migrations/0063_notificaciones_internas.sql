-- ============================================================================
-- 0063_notificaciones_internas · DGG-30 / P5-7.C
--
-- Centro de notificaciones in-app (campana en header). Hasta ahora teníamos
-- `push_notifications_queue` (Web Push, transient — se borra después de
-- enviar) pero no había historial in-app navegable. Acá agregamos:
--
--   • Tabla `notificaciones_internas` (per-user, persistente, leído/no leído).
--   • RPCs: notif_listar, notif_no_leidas_count, notif_marcar_leida,
--           notif_marcar_todas_leidas, notif_archivar.
--   • Helper privado `private.notif_emitir(user_id, tipo, titulo, cuerpo,
--           url, payload)` para que triggers o edge functions encolen.
--   • Trigger sobre `solicitudes` INSERT → emitir notif a todos los staff
--           (gerente + operador) con link al detail.
--
-- Roadmap (siguientes hooks, queda preparado pero no encadenado todavía):
--   • Trigger sobre `tramites` cuando estado pasa a cerrado/resuelto.
--   • Trigger sobre `vencimientos` cuando dias_restantes <= 3.
--   • Hook desde dispatch-vencimientos edge function (espejar push).
--
-- Regla 1 (persistencia BD), 2 (RLS por user_id), 5 (RPCs SECURITY DEFINER
-- multi-tabla), 8 (naming inglés en schema), 12 (no aplica directo — es
-- per-user, no per-administracion).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Tabla
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notificaciones_internas (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tipo         text NOT NULL,  -- 'solicitud_nueva' | 'tracking_cerrado' | 'vencimiento_proximo' | 'comprobante_pagado' | 'sistema' | ...
  titulo       text NOT NULL,
  cuerpo       text,
  url          text,           -- ruta interna a la cual navegar al click
  payload      jsonb DEFAULT '{}'::jsonb,
  leido_at     timestamptz,
  archivado_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notif_internas_user_created
  ON public.notificaciones_internas(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notif_internas_user_no_leidas
  ON public.notificaciones_internas(user_id, created_at DESC)
  WHERE leido_at IS NULL AND archivado_at IS NULL;

ALTER TABLE public.notificaciones_internas ENABLE ROW LEVEL SECURITY;

-- Cada user sólo ve y manipula las propias. Staff bypassea via SECURITY
-- DEFINER en las RPCs.
DROP POLICY IF EXISTS notif_internas_owner_select ON public.notificaciones_internas;
CREATE POLICY notif_internas_owner_select
  ON public.notificaciones_internas
  FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS notif_internas_owner_update ON public.notificaciones_internas;
CREATE POLICY notif_internas_owner_update
  ON public.notificaciones_internas
  FOR UPDATE USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- INSERT y DELETE sólo via SECURITY DEFINER (sin policy = nadie con
-- credenciales de cliente puede). Las RPCs corren con privilegios.

COMMENT ON TABLE public.notificaciones_internas IS
  'DGG-30 / P5-7.C. Notificaciones in-app per-user (campana). Persistente, leído/no leído. Complementa push_notifications_queue (transient).';

-- ---------------------------------------------------------------------------
-- Helper privado para encolar
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.notif_emitir(
  p_user_id uuid,
  p_tipo text,
  p_titulo text,
  p_cuerpo text DEFAULT NULL,
  p_url text DEFAULT NULL,
  p_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.notificaciones_internas(user_id, tipo, titulo, cuerpo, url, payload)
  VALUES (p_user_id, p_tipo, p_titulo, p_cuerpo, p_url, COALESCE(p_payload, '{}'::jsonb))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION private.notif_emitir IS
  'Encola una notificación in-app para un usuario. Llamable desde triggers/RPCs.';

-- Versión "broadcast" a todos los staff (gerente + operador).
CREATE OR REPLACE FUNCTION private.notif_emitir_staff(
  p_tipo text,
  p_titulo text,
  p_cuerpo text DEFAULT NULL,
  p_url text DEFAULT NULL,
  p_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_count int := 0;
  r record;
BEGIN
  FOR r IN
    SELECT id AS user_id FROM public.profiles
    WHERE role IN ('gerente', 'operador') AND COALESCE(activo, true)
  LOOP
    PERFORM private.notif_emitir(r.user_id, p_tipo, p_titulo, p_cuerpo, p_url, p_payload);
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION private.notif_emitir_staff IS
  'Broadcast: emite notif a todos los gerentes + operadores.';

-- ---------------------------------------------------------------------------
-- RPCs públicas (autenticadas)
-- ---------------------------------------------------------------------------

-- Listar — paginación por offset/limit. Por default trae las últimas 30,
-- mezclando leídas y no leídas pero priorizando no-leídas arriba.
CREATE OR REPLACE FUNCTION public.notif_listar(
  p_limit int DEFAULT 30,
  p_offset int DEFAULT 0,
  p_solo_no_leidas boolean DEFAULT false
)
RETURNS TABLE(
  id uuid,
  tipo text,
  titulo text,
  cuerpo text,
  url text,
  payload jsonb,
  leido_at timestamptz,
  created_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT n.id, n.tipo, n.titulo, n.cuerpo, n.url, n.payload, n.leido_at, n.created_at
  FROM public.notificaciones_internas n
  WHERE n.user_id = auth.uid()
    AND n.archivado_at IS NULL
    AND (NOT p_solo_no_leidas OR n.leido_at IS NULL)
  ORDER BY
    (n.leido_at IS NOT NULL) ASC,  -- no leídas primero
    n.created_at DESC
  LIMIT GREATEST(LEAST(p_limit, 100), 1)
  OFFSET GREATEST(p_offset, 0);
$$;

CREATE OR REPLACE FUNCTION public.notif_no_leidas_count()
RETURNS int
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COUNT(*)::int
  FROM public.notificaciones_internas n
  WHERE n.user_id = auth.uid()
    AND n.leido_at IS NULL
    AND n.archivado_at IS NULL;
$$;

CREATE OR REPLACE FUNCTION public.notif_marcar_leida(p_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE public.notificaciones_internas
     SET leido_at = COALESCE(leido_at, now())
   WHERE id = p_id AND user_id = auth.uid();
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.notif_marcar_todas_leidas()
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_count int;
BEGIN
  WITH upd AS (
    UPDATE public.notificaciones_internas
       SET leido_at = now()
     WHERE user_id = auth.uid()
       AND leido_at IS NULL
       AND archivado_at IS NULL
    RETURNING 1
  )
  SELECT COUNT(*)::int INTO v_count FROM upd;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.notif_archivar(p_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE public.notificaciones_internas
     SET archivado_at = now(),
         leido_at = COALESCE(leido_at, now())
   WHERE id = p_id AND user_id = auth.uid();
  RETURN FOUND;
END;
$$;

GRANT EXECUTE ON FUNCTION public.notif_listar(int, int, boolean)         TO authenticated;
GRANT EXECUTE ON FUNCTION public.notif_no_leidas_count()                  TO authenticated;
GRANT EXECUTE ON FUNCTION public.notif_marcar_leida(uuid)                 TO authenticated;
GRANT EXECUTE ON FUNCTION public.notif_marcar_todas_leidas()              TO authenticated;
GRANT EXECUTE ON FUNCTION public.notif_archivar(uuid)                     TO authenticated;

-- ---------------------------------------------------------------------------
-- Trigger sobre solicitudes (alta de solicitud → notif a todos los staff)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._notif_solicitud_nueva_trg()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_titulo text;
  v_cuerpo text;
BEGIN
  v_titulo := 'Nueva solicitud · ' || COALESCE(NEW.solicitante_nombre, 'sin nombre');
  v_cuerpo :=
    COALESCE(NULLIF(NEW.servicio_slug, ''), 'servicio')
    || COALESCE(' · ' || NEW.solicitante_email, '');
  PERFORM private.notif_emitir_staff(
    'solicitud_nueva',
    v_titulo,
    v_cuerpo,
    '/gerencia/solicitudes/' || NEW.id::text,
    jsonb_build_object('solicitud_id', NEW.id, 'estado', NEW.estado)
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notif_solicitud_nueva ON public.solicitudes;
CREATE TRIGGER trg_notif_solicitud_nueva
  AFTER INSERT ON public.solicitudes
  FOR EACH ROW
  EXECUTE FUNCTION public._notif_solicitud_nueva_trg();

-- ---------------------------------------------------------------------------
-- Trigger sobre tramites (cierre del ciclo → notif a staff)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._notif_tracking_cerrado_trg()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  -- Sólo si pasó a cerrado/resuelto.
  IF (OLD.estado IS DISTINCT FROM NEW.estado)
     AND NEW.estado IN ('cerrado', 'resuelto') THEN
    PERFORM private.notif_emitir_staff(
      'tracking_cerrado',
      'Tracking cerrado · ' || COALESCE(NEW.titulo, NEW.codigo),
      'Estado: ' || NEW.estado,
      '/gerencia/trackings/' || NEW.id::text,
      jsonb_build_object('tracking_id', NEW.id, 'estado_nuevo', NEW.estado)
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notif_tracking_cerrado ON public.tramites;
CREATE TRIGGER trg_notif_tracking_cerrado
  AFTER UPDATE OF estado ON public.tramites
  FOR EACH ROW
  EXECUTE FUNCTION public._notif_tracking_cerrado_trg();

-- ---------------------------------------------------------------------------
-- Notif de bienvenida (semilla manual cuando se aplica esta migración —
-- útil para que aparezca al menos algo en la campana de primera).
-- ---------------------------------------------------------------------------
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT id AS user_id FROM public.profiles
    WHERE role IN ('gerente', 'operador') AND COALESCE(activo, true)
  LOOP
    PERFORM private.notif_emitir(
      r.user_id,
      'sistema',
      'Centro de notificaciones activado',
      'A partir de ahora vas a ver acá las alertas del sistema: solicitudes nuevas, trámites cerrados, vencimientos próximos, etc.',
      NULL,
      jsonb_build_object('release', 'DGG-30')
    );
  END LOOP;
END $$;
