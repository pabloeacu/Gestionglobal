-- ============================================================================
-- Migration: 0089_tracking_visible_cliente
-- Fecha: 2026-05-27
-- DGG-XX · Tracking: flag visible_cliente + notificación al cliente (push+email)
--
-- Contexto: hoy el gerente agrega líneas al tracking pero el cliente
-- (administrador) no se entera de los avances. Sus opciones son entrar al
-- portal o que alguien le mande WhatsApp. Esto cambia con:
--
--   1. Nueva columna `visible_cliente boolean` en `tracking_lineas`.
--      DEFAULT false → comportamiento previo (notas internas).
--      true = el cliente va a ver esta línea Y recibir notificación.
--
--   2. RPC `tracking_agregar_linea` acepta `p_visible_cliente boolean`.
--
--   3. Template email `tracking-avance-cliente` registrado.
--
--   4. Trigger AFTER INSERT en `tracking_lineas` ahora ADEMÁS de la alerta_en
--      futura, si `visible_cliente=true` encola:
--        - email al cliente (template tracking-avance-cliente)
--        - push web al user_id de la administración (si está vinculada)
--
-- Regla 6: migración versionada.
-- Regla 8 (E43): tracking_lineas es tabla pre-existente en español parcial
--   (categoria, descripcion, estado_asociado, archivos_urls, alerta_en).
--   Mantengo naming consistente → `visible_cliente boolean`.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Nueva columna en tracking_lineas
-- ---------------------------------------------------------------------------
ALTER TABLE public.tracking_lineas
  ADD COLUMN IF NOT EXISTS visible_cliente boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.tracking_lineas.visible_cliente IS
  'Si true, la línea es visible para el cliente en su portal y dispara '
  'notificación (push + email). Default false = nota interna del gerente.';

-- Index parcial para queries de avances visibles al cliente
CREATE INDEX IF NOT EXISTS idx_tracking_lineas_visible_cliente
  ON public.tracking_lineas(tramite_id, created_at DESC)
  WHERE visible_cliente = true;


-- ---------------------------------------------------------------------------
-- 2. Template email tracking-avance-cliente
-- ---------------------------------------------------------------------------
INSERT INTO public.email_templates
  (slug, nombre, asunto, body_html, body_text, from_casilla, descripcion, variables)
VALUES
  ('tracking-avance-cliente',
   'Avance visible al cliente',
   'Novedad en tu trámite: {{tipo}}',
   '<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1f2937">'
   '<h2 style="color:#0891b2;margin-bottom:8px">Hola {{destinatario_nombre}}</h2>'
   '<p style="margin-top:0">Tenemos un nuevo avance en tu trámite:</p>'
   '<div style="background:#f0fdfa;border-left:4px solid #14b8a6;padding:14px 16px;margin:18px 0;border-radius:6px">'
   '<p style="margin:0 0 6px 0;font-size:13px;color:#0f766e;text-transform:uppercase;letter-spacing:0.5px"><strong>{{tipo}}</strong></p>'
   '<p style="margin:0;white-space:pre-wrap">{{descripcion}}</p>'
   '</div>'
   '<p>Podés ver el detalle completo y los archivos adjuntos en tu portal:</p>'
   '<p style="margin:18px 0"><a href="{{portal_url}}" '
   'style="background:#0891b2;color:#fff;padding:10px 20px;border-radius:6px;'
   'text-decoration:none;display:inline-block">Ver en mi portal</a></p>'
   '<p style="color:#6b7280;font-size:13px;margin-top:24px">'
   'Si tenés alguna duda, podés responder este correo y te contactamos.</p>'
   '<p style="color:#6b7280;font-size:13px">— Equipo de Gestión Global</p>'
   '</div>',
   E'Hola {{destinatario_nombre}},\n\n'
   E'Tenemos un nuevo avance en tu trámite:\n\n'
   E'{{tipo}}\n'
   E'{{descripcion}}\n\n'
   E'Podés ver el detalle completo y los archivos adjuntos en tu portal:\n'
   E'{{portal_url}}\n\n'
   E'Si tenés alguna duda, podés responder este correo.\n\n'
   E'— Equipo de Gestión Global',
   'general',
   'Notifica al cliente cuando el gerente marca una línea de tracking como visible_cliente.',
   '["destinatario_nombre","tipo","descripcion","portal_url"]'::jsonb)
ON CONFLICT (slug) DO UPDATE
  SET nombre = EXCLUDED.nombre,
      asunto = EXCLUDED.asunto,
      body_html = EXCLUDED.body_html,
      body_text = EXCLUDED.body_text,
      descripcion = EXCLUDED.descripcion,
      variables = EXCLUDED.variables,
      updated_at = now();


-- ---------------------------------------------------------------------------
-- 3. Reescribir trigger tracking_linea_on_insert → además notifica al cliente
--    si visible_cliente=true (independiente del alerta_en para recordatorio).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tracking_linea_on_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tramite           record;
  v_servicio_nombre   text;
  v_to_email          text;
  v_to_nombre         text;
  v_admin_user_id     uuid;
  v_portal_url        text;
BEGIN
  -- Actualizar actividad del tramite
  UPDATE public.tramites
    SET ultima_actividad_at = now()
   WHERE id = NEW.tramite_id;

  -- Si no hay alerta futura y la línea no es visible al cliente, no hay
  -- nada que encolar. Salimos rápido.
  IF (NEW.alerta_en IS NULL OR NEW.alerta_en <= now())
     AND NEW.visible_cliente = false THEN
    RETURN NEW;
  END IF;

  -- Cargar info del tramite + servicio (común a ambos caminos)
  SELECT t.*, s.nombre AS svc_nombre
    INTO v_tramite
    FROM public.tramites t
    LEFT JOIN public.servicios s ON s.id = t.servicio_id
   WHERE t.id = NEW.tramite_id;

  v_servicio_nombre := COALESCE(v_tramite.svc_nombre, v_tramite.titulo, 'Trámite');

  -- Resolver destinatario email + nombre
  v_to_email := v_tramite.solicitante_email;
  v_to_nombre := COALESCE(v_tramite.solicitante_nombre, '');
  IF v_to_email IS NULL AND v_tramite.administracion_id IS NOT NULL THEN
    SELECT email, nombre INTO v_to_email, v_to_nombre
      FROM public.administraciones
     WHERE id = v_tramite.administracion_id;
  END IF;

  -- Resolver user_id de la administración (para push web)
  IF v_tramite.administracion_id IS NOT NULL THEN
    SELECT user_id INTO v_admin_user_id
      FROM public.administraciones
     WHERE id = v_tramite.administracion_id;
  END IF;

  -- ===== CAMINO A: alerta futura → email recordatorio interno =====
  IF NEW.alerta_en IS NOT NULL AND NEW.alerta_en > now() AND v_to_email IS NOT NULL THEN
    PERFORM public.encolar_email(
      'tracking-recordatorio',
      v_to_email,
      v_to_nombre,
      jsonb_build_object(
        'tipo', v_servicio_nombre,
        'descripcion', NEW.descripcion,
        'fecha', to_char(NEW.alerta_en AT TIME ZONE 'America/Argentina/Buenos_Aires', 'DD/MM/YYYY HH24:MI')
      ),
      v_tramite.administracion_id,
      v_tramite.consorcio_id,
      'tracking_lineas',
      NEW.id,
      5::smallint
    );
  END IF;

  -- ===== CAMINO B: visible al cliente → email aviso + push web =====
  IF NEW.visible_cliente = true THEN
    v_portal_url := 'https://www.gestionglobal.ar/portal/mis-gestiones/' || NEW.tramite_id::text;

    -- Email al cliente con template tracking-avance-cliente
    IF v_to_email IS NOT NULL THEN
      PERFORM public.encolar_email(
        'tracking-avance-cliente',
        v_to_email,
        v_to_nombre,
        jsonb_build_object(
          'destinatario_nombre', COALESCE(NULLIF(v_to_nombre, ''), 'cliente'),
          'tipo', v_servicio_nombre,
          'descripcion', NEW.descripcion,
          'portal_url', v_portal_url
        ),
        v_tramite.administracion_id,
        v_tramite.consorcio_id,
        'tracking_lineas',
        NEW.id,
        3::smallint  -- prioridad mayor que recordatorio (es feedback en vivo)
      );
    END IF;

    -- Push web al usuario asociado a la administración (si existe)
    IF v_admin_user_id IS NOT NULL THEN
      PERFORM public.encolar_push(
        v_admin_user_id,
        'Nuevo avance: ' || v_servicio_nombre,
        substring(NEW.descripcion, 1, 140),
        NULL,
        v_portal_url
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.tracking_linea_on_insert() FROM PUBLIC, anon, authenticated;

-- (Trigger ya existe desde 0036, no hace falta DROP+CREATE — solo reemplazamos
-- el body de la función. El trigger sigue apuntando al mismo nombre.)


-- ---------------------------------------------------------------------------
-- 4. RPC tracking_agregar_linea: drop+create con nuevo parámetro
--    (no podemos sólo "CREATE OR REPLACE" porque cambia la firma)
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.tracking_agregar_linea(uuid, text, text, text, text[], timestamptz);

CREATE OR REPLACE FUNCTION public.tracking_agregar_linea(
  p_tramite_id uuid,
  p_categoria text,
  p_descripcion text,
  p_estado_asociado text DEFAULT NULL,
  p_archivos_urls text[] DEFAULT '{}',
  p_alerta_en timestamptz DEFAULT NULL,
  p_visible_cliente boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin uuid;
  v_id uuid;
BEGIN
  SELECT administracion_id INTO v_admin FROM public.tramites WHERE id = p_tramite_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tracking no encontrado' USING ERRCODE = 'P0002';
  END IF;

  -- Tenancy guard (regla 12)
  IF NOT private.is_staff() THEN
    IF v_admin IS NULL THEN
      RAISE EXCEPTION 'Acceso denegado' USING ERRCODE = '42501';
    END IF;
    PERFORM private.assert_administracion_access(v_admin);
  END IF;

  -- Validar categoría
  IF NOT EXISTS (
    SELECT 1 FROM public.tracking_categorias_config WHERE slug = p_categoria
  ) THEN
    RAISE EXCEPTION 'Categoría inválida: %', p_categoria USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.tracking_lineas (
    tramite_id, categoria, descripcion, estado_asociado, archivos_urls,
    alerta_en, autor_id, visible_cliente
  ) VALUES (
    p_tramite_id, p_categoria, p_descripcion, p_estado_asociado,
    COALESCE(p_archivos_urls, '{}'::text[]), p_alerta_en, auth.uid(),
    COALESCE(p_visible_cliente, false)
  )
  RETURNING id INTO v_id;

  -- Propagar estado_asociado al tramite (solo staff)
  IF p_estado_asociado IS NOT NULL AND private.is_staff() THEN
    UPDATE public.tramites
      SET estado = CASE
        WHEN p_estado_asociado IN ('abierto','en_progreso','esperando_cliente','resuelto','cerrado','cancelado')
          THEN p_estado_asociado
        ELSE estado
      END,
      ultima_actividad_at = now()
     WHERE id = p_tramite_id;
  END IF;

  RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.tracking_agregar_linea(uuid, text, text, text, text[], timestamptz, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tracking_agregar_linea(uuid, text, text, text, text[], timestamptz, boolean) TO authenticated;
