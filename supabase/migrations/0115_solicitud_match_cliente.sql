-- ============================================================================
-- Migration: 0115_solicitud_match_cliente
-- Fecha: 2026-05-28
-- DGG-XX · Bloque J / obs 14: cross-match de solicitudes anónimas contra
-- administraciones existentes por email / CUIT / DNI (nunca por nombre,
-- pueden ser homónimos). Si un cliente existente subió una solicitud desde
-- la landing pública por confusión (en vez del portal), el wizard de
-- activación detecta el match y propone añadir el servicio al cliente X.
-- ============================================================================

-- DNI del responsable para poder cruzar por DNI (no existía como columna)
ALTER TABLE public.administraciones
  ADD COLUMN IF NOT EXISTS responsable_dni text;

CREATE INDEX IF NOT EXISTS idx_admin_email_lower
  ON public.administraciones (lower(email)) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_admin_cuit
  ON public.administraciones (cuit) WHERE cuit IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_admin_responsable_dni
  ON public.administraciones (responsable_dni) WHERE responsable_dni IS NOT NULL;

CREATE OR REPLACE FUNCTION public.solicitud_match_cliente(
  p_submission_id uuid
) RETURNS TABLE(
  administracion_id uuid,
  administracion_nombre text,
  cuit text,
  email text,
  match_por text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_datos jsonb;
  v_email text;
  v_cuit  text;
  v_dni   text;
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo staff puede consultar matches'
      USING ERRCODE = '42501';
  END IF;

  SELECT fs.datos INTO v_datos
    FROM public.formulario_submissions fs
   WHERE fs.id = p_submission_id;
  IF v_datos IS NULL THEN
    RETURN;
  END IF;

  -- Tolerante a nombres de campos variados — los formularios viejos usan
  -- 'apellido_nombre', 'cuit_cuil', etc. Normalizamos.
  v_email := lower(trim(COALESCE(
    v_datos->>'email',
    v_datos->>'correo',
    v_datos->>'correo_electronico'
  )));
  v_cuit  := regexp_replace(COALESCE(
    v_datos->>'cuit',
    v_datos->>'cuit_cuil',
    v_datos->>'cuil',
    ''
  ), '[^0-9]', '', 'g');
  v_dni   := regexp_replace(COALESCE(
    v_datos->>'dni',
    v_datos->>'documento',
    v_datos->>'numero_documento',
    ''
  ), '[^0-9]', '', 'g');

  -- Prioridad: email > cuit > dni. Sin nombre.
  IF v_email <> '' THEN
    RETURN QUERY
      SELECT a.id, a.nombre, a.cuit, a.email, 'email'::text
        FROM public.administraciones a
       WHERE a.activo
         AND a.email IS NOT NULL
         AND lower(a.email) = v_email
       LIMIT 1;
    IF FOUND THEN RETURN; END IF;
  END IF;

  IF v_cuit <> '' AND length(v_cuit) >= 8 THEN
    RETURN QUERY
      SELECT a.id, a.nombre, a.cuit, a.email, 'cuit'::text
        FROM public.administraciones a
       WHERE a.activo
         AND a.cuit IS NOT NULL
         AND regexp_replace(a.cuit, '[^0-9]', '', 'g') = v_cuit
       LIMIT 1;
    IF FOUND THEN RETURN; END IF;
  END IF;

  IF v_dni <> '' AND length(v_dni) >= 7 THEN
    RETURN QUERY
      SELECT a.id, a.nombre, a.cuit, a.email, 'dni'::text
        FROM public.administraciones a
       WHERE a.activo
         AND a.responsable_dni IS NOT NULL
         AND regexp_replace(a.responsable_dni, '[^0-9]', '', 'g') = v_dni
       LIMIT 1;
    IF FOUND THEN RETURN; END IF;
  END IF;
  RETURN;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.solicitud_match_cliente(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.solicitud_match_cliente(uuid) TO authenticated;
