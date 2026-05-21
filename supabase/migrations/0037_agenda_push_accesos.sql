-- ============================================================================
-- 0037_agenda_push_accesos · Agenda operativa + Push notifications VAPID +
-- Accesos externos seguros (sin login). Cubre puntos 23–25 y 7 del Flujo
-- Maestro (#30 del backlog de 38 mejoras).
--
-- Decisiones (regla 1, 5, 11, 12):
-- - Single-tenant: NO empresa_id. cliente_id apunta a administraciones.
-- - accesos_externos: token aleatorio 32 bytes hex (256 bits), una sola tabla
--   indiferente al recurso (recurso_tipo + recurso_id). RLS deniega lectura
--   anónima; la edge function `acceso-externo` consulta vía service_role.
-- - agenda_eventos: NO depende del subsistema de tracking de G2 — usamos FKs
--   blandas (uuid sin REFERENCES a tracking_lineas, que aún no existe). Los
--   triggers desde tracking se agregarán cuando G2 deje su migración.
-- - push_subscriptions: una fila por (user_id, endpoint). Endpoint se trata
--   como secreto razonable (incluye token efímero), por eso revoca con DELETE.
-- - push_notifications_queue: patrón idéntico a email_queue (intento + error).
-- - Cron */2 min para `dispatch-push` (web push es barato y queremos UX viva).
-- - Sin ALTER DATABASE (regla 0026): URL hardcoded + service_role_key
--   preset por Supabase en `app.service_role_key`.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- A) ACCESOS EXTERNOS · URLs firmadas sin login
-- ---------------------------------------------------------------------------
CREATE TABLE public.accesos_externos (
  token text PRIMARY KEY,
  recurso_tipo text NOT NULL CHECK (recurso_tipo IN (
    'tramite','solicitud','tracking','documento'
  )),
  recurso_id uuid NOT NULL,
  email_destinatario text NOT NULL,
  nombre_destinatario text,
  vence_at timestamptz NOT NULL,
  usado_at timestamptz,
  ultima_visita_at timestamptz,
  total_visitas int NOT NULL DEFAULT 0,
  revocado_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  observaciones text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_accesos_externos_recurso
  ON public.accesos_externos(recurso_tipo, recurso_id);
CREATE INDEX idx_accesos_externos_vivos
  ON public.accesos_externos(vence_at)
  WHERE revocado_at IS NULL;

ALTER TABLE public.accesos_externos ENABLE ROW LEVEL SECURITY;

-- Sólo staff puede ver/escribir accesos. La consulta pública por token la
-- hace la edge function con service_role (bypass RLS).
DROP POLICY IF EXISTS accesos_externos_select_staff ON public.accesos_externos;
CREATE POLICY accesos_externos_select_staff ON public.accesos_externos
  FOR SELECT TO authenticated USING (private.is_staff());
DROP POLICY IF EXISTS accesos_externos_insert_staff ON public.accesos_externos;
CREATE POLICY accesos_externos_insert_staff ON public.accesos_externos
  FOR INSERT TO authenticated WITH CHECK (private.is_staff());
DROP POLICY IF EXISTS accesos_externos_update_staff ON public.accesos_externos;
CREATE POLICY accesos_externos_update_staff ON public.accesos_externos
  FOR UPDATE TO authenticated
  USING (private.is_staff()) WITH CHECK (private.is_staff());
DROP POLICY IF EXISTS accesos_externos_delete_staff ON public.accesos_externos;
CREATE POLICY accesos_externos_delete_staff ON public.accesos_externos
  FOR DELETE TO authenticated USING (private.is_staff());

-- RPC consumida por G1 (Solicitudes/Wizard): genera token, devuelve hex.
CREATE OR REPLACE FUNCTION public.generar_acceso_externo(
  p_recurso_tipo text,
  p_recurso_id uuid,
  p_email_destinatario text,
  p_nombre_destinatario text DEFAULT NULL,
  p_dias_validez int DEFAULT 14,
  p_observaciones text DEFAULT NULL
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_token text;
  v_dias int;
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_recurso_tipo NOT IN ('tramite','solicitud','tracking','documento') THEN
    RAISE EXCEPTION 'recurso_tipo inválido: %', p_recurso_tipo
      USING ERRCODE = '22023';
  END IF;
  v_dias := COALESCE(p_dias_validez, 14);
  IF v_dias < 1 OR v_dias > 365 THEN
    RAISE EXCEPTION 'dias_validez fuera de rango (1..365)'
      USING ERRCODE = '22023';
  END IF;

  v_token := encode(gen_random_bytes(32), 'hex');

  INSERT INTO public.accesos_externos(
    token, recurso_tipo, recurso_id, email_destinatario, nombre_destinatario,
    vence_at, created_by, observaciones
  ) VALUES (
    v_token, p_recurso_tipo, p_recurso_id, p_email_destinatario,
    p_nombre_destinatario,
    now() + (v_dias || ' days')::interval,
    auth.uid(), p_observaciones
  );

  RETURN v_token;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.generar_acceso_externo(text, uuid, text, text, int, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generar_acceso_externo(text, uuid, text, text, int, text)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.revocar_acceso_externo(p_token text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  UPDATE public.accesos_externos
     SET revocado_at = now()
   WHERE token = p_token
     AND revocado_at IS NULL;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.revocar_acceso_externo(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revocar_acceso_externo(text) TO authenticated;

-- ---------------------------------------------------------------------------
-- B) AGENDA OPERATIVA · vistas día/semana/mes, filtrable
-- ---------------------------------------------------------------------------
CREATE TABLE public.agenda_eventos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  titulo text NOT NULL,
  descripcion text,
  fecha_inicio timestamptz NOT NULL,
  fecha_fin timestamptz,
  todo_el_dia boolean NOT NULL DEFAULT false,

  categoria text NOT NULL DEFAULT 'general'
    CHECK (categoria IN ('general','seguimiento','vencimiento','recordatorio','reunion','tarea')),
  prioridad text NOT NULL DEFAULT 'normal'
    CHECK (prioridad IN ('baja','normal','alta','urgente')),

  responsable_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  cliente_id uuid REFERENCES public.administraciones(id) ON DELETE SET NULL,
  servicio_id uuid REFERENCES public.servicios(id) ON DELETE SET NULL,
  tramite_id uuid REFERENCES public.tramites(id) ON DELETE SET NULL,
  vencimiento_id uuid REFERENCES public.vencimientos(id) ON DELETE SET NULL,

  -- Recordatorio: si recordatorio_minutos_antes > 0, encolaremos push N min
  -- antes de fecha_inicio (resuelto por cron + edge function).
  recordatorio_minutos_antes int NOT NULL DEFAULT 0,
  recordatorio_enviado_at timestamptz,

  completado_at timestamptz,
  cancelado_at timestamptz,

  origen text NOT NULL DEFAULT 'manual'
    CHECK (origen IN ('manual','tracking','vencimiento','submission','sistema')),

  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_agenda_eventos_fecha_vivos
  ON public.agenda_eventos(fecha_inicio)
  WHERE completado_at IS NULL AND cancelado_at IS NULL;
CREATE INDEX idx_agenda_eventos_responsable ON public.agenda_eventos(responsable_id);
CREATE INDEX idx_agenda_eventos_cliente ON public.agenda_eventos(cliente_id);
CREATE INDEX idx_agenda_eventos_tramite ON public.agenda_eventos(tramite_id);
CREATE INDEX idx_agenda_eventos_vencimiento ON public.agenda_eventos(vencimiento_id);

CREATE OR REPLACE FUNCTION private.agenda_eventos_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_agenda_eventos_updated_at ON public.agenda_eventos;
CREATE TRIGGER trg_agenda_eventos_updated_at
BEFORE UPDATE ON public.agenda_eventos
FOR EACH ROW EXECUTE FUNCTION private.agenda_eventos_touch_updated_at();

ALTER TABLE public.agenda_eventos ENABLE ROW LEVEL SECURITY;

-- Staff: full. Administrador: SELECT eventos de su administración.
DROP POLICY IF EXISTS agenda_eventos_select ON public.agenda_eventos;
CREATE POLICY agenda_eventos_select ON public.agenda_eventos
  FOR SELECT TO authenticated USING (
    private.is_staff()
    OR (
      private.is_administrador()
      AND cliente_id = private.current_administracion_id()
    )
  );
DROP POLICY IF EXISTS agenda_eventos_insert_staff ON public.agenda_eventos;
CREATE POLICY agenda_eventos_insert_staff ON public.agenda_eventos
  FOR INSERT TO authenticated WITH CHECK (private.is_staff());
DROP POLICY IF EXISTS agenda_eventos_update_staff ON public.agenda_eventos;
CREATE POLICY agenda_eventos_update_staff ON public.agenda_eventos
  FOR UPDATE TO authenticated
  USING (private.is_staff()) WITH CHECK (private.is_staff());
DROP POLICY IF EXISTS agenda_eventos_delete_staff ON public.agenda_eventos;
CREATE POLICY agenda_eventos_delete_staff ON public.agenda_eventos
  FOR DELETE TO authenticated USING (private.is_staff());

-- Trigger desde vencimientos: cuando se acerca un umbral (alerta_30d/20d/10d
-- _enviada se setea), espejamos un evento en agenda (idempotente: si ya hay
-- evento con vencimiento_id + categoría='vencimiento', no duplicamos).
CREATE OR REPLACE FUNCTION private.agenda_from_vencimiento_threshold()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_already_at timestamptz;
  v_titulo text;
BEGIN
  -- Solo cuando se setea por primera vez (NULL → NOT NULL) uno de los flags.
  IF NEW.estado <> 'vigente' THEN RETURN NEW; END IF;
  IF (NEW.alerta_30d_enviada IS NOT NULL AND OLD.alerta_30d_enviada IS NULL)
     OR (NEW.alerta_20d_enviada IS NOT NULL AND OLD.alerta_20d_enviada IS NULL)
     OR (NEW.alerta_10d_enviada IS NOT NULL AND OLD.alerta_10d_enviada IS NULL)
  THEN
    SELECT created_at INTO v_already_at
      FROM public.agenda_eventos
     WHERE vencimiento_id = NEW.id
       AND categoria = 'vencimiento'
     LIMIT 1;
    IF v_already_at IS NULL THEN
      v_titulo := COALESCE(NEW.descripcion, NEW.tipo) || ' — vence ' || NEW.fecha_vencimiento::text;
      INSERT INTO public.agenda_eventos(
        titulo, descripcion, fecha_inicio, todo_el_dia,
        categoria, prioridad,
        cliente_id, vencimiento_id, origen
      ) VALUES (
        v_titulo,
        'Vencimiento próximo. Renová antes de la fecha límite.',
        NEW.fecha_vencimiento::timestamptz,
        true,
        'vencimiento',
        CASE
          WHEN (NEW.fecha_vencimiento - CURRENT_DATE) <= 10 THEN 'urgente'
          WHEN (NEW.fecha_vencimiento - CURRENT_DATE) <= 20 THEN 'alta'
          ELSE 'normal'
        END,
        NEW.administracion_id,
        NEW.id,
        'vencimiento'
      );
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_agenda_from_vencimiento ON public.vencimientos;
CREATE TRIGGER trg_agenda_from_vencimiento
AFTER UPDATE ON public.vencimientos
FOR EACH ROW EXECUTE FUNCTION private.agenda_from_vencimiento_threshold();

-- ---------------------------------------------------------------------------
-- C) PUSH NOTIFICATIONS · suscripciones + cola
-- ---------------------------------------------------------------------------
CREATE TABLE public.push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint text NOT NULL,
  keys_p256dh text NOT NULL,
  keys_auth text NOT NULL,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  UNIQUE(user_id, endpoint)
);
CREATE INDEX idx_push_subscriptions_user ON public.push_subscriptions(user_id);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS push_sub_owner_select ON public.push_subscriptions;
CREATE POLICY push_sub_owner_select ON public.push_subscriptions
  FOR SELECT TO authenticated USING (user_id = auth.uid() OR private.is_staff());
DROP POLICY IF EXISTS push_sub_owner_insert ON public.push_subscriptions;
CREATE POLICY push_sub_owner_insert ON public.push_subscriptions
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS push_sub_owner_delete ON public.push_subscriptions;
CREATE POLICY push_sub_owner_delete ON public.push_subscriptions
  FOR DELETE TO authenticated USING (user_id = auth.uid() OR private.is_staff());

CREATE TABLE public.push_notifications_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  titulo text NOT NULL,
  cuerpo text,
  icono_url text,
  click_url text,
  enviada_at timestamptz,
  intento smallint NOT NULL DEFAULT 0,
  max_intentos smallint NOT NULL DEFAULT 3,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_push_queue_pending
  ON public.push_notifications_queue(created_at)
  WHERE enviada_at IS NULL;
CREATE INDEX idx_push_queue_user ON public.push_notifications_queue(user_id);

ALTER TABLE public.push_notifications_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS push_queue_owner_select ON public.push_notifications_queue;
CREATE POLICY push_queue_owner_select ON public.push_notifications_queue
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR private.is_staff());

-- Encolar push: cualquier RPC del backend puede llamarla; el front la usa
-- para "probar" un push de muestra.
CREATE OR REPLACE FUNCTION public.encolar_push(
  p_user_id uuid,
  p_titulo text,
  p_cuerpo text DEFAULT NULL,
  p_icono_url text DEFAULT NULL,
  p_click_url text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id uuid;
BEGIN
  -- Solo el usuario o staff puede encolar pushes para alguien.
  IF NOT (auth.uid() = p_user_id OR private.is_staff()) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.push_notifications_queue(
    user_id, titulo, cuerpo, icono_url, click_url
  ) VALUES (
    p_user_id, p_titulo, p_cuerpo, p_icono_url, p_click_url
  ) RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE EXECUTE ON FUNCTION public.encolar_push(uuid, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.encolar_push(uuid, text, text, text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- D) CRON · dispatch-push cada 2 minutos
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'dispatch-push-2min') THEN
    PERFORM cron.unschedule('dispatch-push-2min');
  END IF;
END $$;

SELECT cron.schedule(
  'dispatch-push-2min',
  '*/2 * * * *',
  $cron$
    SELECT net.http_post(
      url := 'https://kaoyhkebnidzqjixvchh.supabase.co/functions/v1/dispatch-push',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.service_role_key', true)
      ),
      body := '{}'::jsonb
    );
  $cron$
);

-- Cron para recordatorios de agenda: cada 5 min revisa eventos con
-- recordatorio_minutos_antes > 0 que entran en ventana, encola push y marca.
CREATE OR REPLACE FUNCTION private.encolar_recordatorios_agenda()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_count int := 0;
  r record;
BEGIN
  FOR r IN
    SELECT id, titulo, descripcion, responsable_id, fecha_inicio, recordatorio_minutos_antes
      FROM public.agenda_eventos
     WHERE completado_at IS NULL
       AND cancelado_at IS NULL
       AND recordatorio_enviado_at IS NULL
       AND recordatorio_minutos_antes > 0
       AND responsable_id IS NOT NULL
       AND fecha_inicio - (recordatorio_minutos_antes || ' minutes')::interval <= now()
       AND fecha_inicio > now() - interval '1 day'
  LOOP
    INSERT INTO public.push_notifications_queue(user_id, titulo, cuerpo, click_url)
    VALUES (
      r.responsable_id,
      'Recordatorio: ' || r.titulo,
      COALESCE(r.descripcion, 'Tu evento se acerca.'),
      '/gerencia/agenda'
    );
    UPDATE public.agenda_eventos SET recordatorio_enviado_at = now() WHERE id = r.id;
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'agenda-recordatorios-5min') THEN
    PERFORM cron.unschedule('agenda-recordatorios-5min');
  END IF;
END $$;

SELECT cron.schedule(
  'agenda-recordatorios-5min',
  '*/5 * * * *',
  $cron$ SELECT private.encolar_recordatorios_agenda(); $cron$
);

-- ---------------------------------------------------------------------------
-- E) RPCs de lectura para el front
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.listar_eventos_agenda(
  p_desde timestamptz,
  p_hasta timestamptz,
  p_responsable uuid DEFAULT NULL,
  p_cliente uuid DEFAULT NULL,
  p_servicio uuid DEFAULT NULL,
  p_categoria text DEFAULT NULL,
  p_prioridad text DEFAULT NULL,
  p_incluir_completados boolean DEFAULT false
) RETURNS TABLE (
  id uuid,
  titulo text,
  descripcion text,
  fecha_inicio timestamptz,
  fecha_fin timestamptz,
  todo_el_dia boolean,
  categoria text,
  prioridad text,
  responsable_id uuid,
  responsable_nombre text,
  cliente_id uuid,
  cliente_nombre text,
  servicio_id uuid,
  servicio_nombre text,
  tramite_id uuid,
  vencimiento_id uuid,
  recordatorio_minutos_antes int,
  completado_at timestamptz,
  cancelado_at timestamptz,
  origen text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT e.id, e.titulo, e.descripcion, e.fecha_inicio, e.fecha_fin, e.todo_el_dia,
           e.categoria, e.prioridad,
           e.responsable_id, p.full_name,
           e.cliente_id, a.nombre,
           e.servicio_id, s.nombre,
           e.tramite_id, e.vencimiento_id,
           e.recordatorio_minutos_antes, e.completado_at, e.cancelado_at, e.origen
      FROM public.agenda_eventos e
      LEFT JOIN public.profiles p ON p.id = e.responsable_id
      LEFT JOIN public.administraciones a ON a.id = e.cliente_id
      LEFT JOIN public.servicios s ON s.id = e.servicio_id
     WHERE e.fecha_inicio >= p_desde
       AND e.fecha_inicio < p_hasta
       AND (p_responsable IS NULL OR e.responsable_id = p_responsable)
       AND (p_cliente IS NULL OR e.cliente_id = p_cliente)
       AND (p_servicio IS NULL OR e.servicio_id = p_servicio)
       AND (p_categoria IS NULL OR e.categoria = p_categoria)
       AND (p_prioridad IS NULL OR e.prioridad = p_prioridad)
       AND (p_incluir_completados OR e.completado_at IS NULL)
       AND e.cancelado_at IS NULL
     ORDER BY e.fecha_inicio ASC;
END $$;
REVOKE EXECUTE ON FUNCTION public.listar_eventos_agenda(timestamptz, timestamptz, uuid, uuid, uuid, text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.listar_eventos_agenda(timestamptz, timestamptz, uuid, uuid, uuid, text, text, boolean) TO authenticated;
