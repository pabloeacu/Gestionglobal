-- ============================================================================
-- 0388 · DGG-119 Chunk A · Transparencia del certificado en gerencia
--
-- Pedido de Pablo (27/07): (1) la nota del examen visible en el reporte de
-- alumnos, (2) fecha de emisión + mail de destino del certificado visibles,
-- (3) señal de si el ALUMNO ya descargó su certificado. Todo aditivo y de
-- lectura — nada del circuito de emisión cambia.
--
-- Piezas BD:
--   a) certificados.descargado_alumno_at — primera descarga del alumno
--      (el PDF se genera client-side; el propio click la marca vía RPC).
--   b) RPC cert_marcar_descarga_alumno(p_cert_id) — SECURITY DEFINER, la
--      llama el alumno dueño; sólo setea la PRIMERA vez (no pisa histórico).
--      El UPDATE directo está vedado por RLS (certificados sólo tiene
--      SELECT para el dueño), por eso RPC (regla 17 en espíritu).
--   c) RPC curso_alumnos_emails(p_curso_id) — staff-only: expone el email
--      de LOGIN (auth.users, invisible para PostgREST) de los alumnos del
--      curso, para mostrar a qué casilla fue el mail del certificado.
--      Guard is_staff (regla 12 no aplica: no recibe administracion_id y
--      los gerentes bypassan; un administrador/alumno recibe 42501).
--
-- R16: ambas RPCs son firmas NUEVAS (verificado: no existen overloads
-- previos) → CREATE FUNCTION directo. Smoke de overloads en el cierre.
-- ============================================================================

ALTER TABLE public.certificados
  ADD COLUMN IF NOT EXISTS descargado_alumno_at timestamptz;

COMMENT ON COLUMN public.certificados.descargado_alumno_at IS
  'DGG-119: primera vez que el ALUMNO descargó su certificado desde el campus (NULL = todavía no lo bajó). Lo marca cert_marcar_descarga_alumno(); las descargas de gerencia NO lo tocan.';

CREATE FUNCTION public.cert_marcar_descarga_alumno(p_cert_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.certificados
     SET descargado_alumno_at = now(),
         updated_at = now()
   WHERE id = p_cert_id
     AND alumno_profile_id = auth.uid()
     AND descargado_alumno_at IS NULL
     AND revocado_at IS NULL;
  -- Sin filas afectadas = ya estaba marcada, no es su cert o está revocado.
  -- Best-effort deliberado: la descarga del alumno jamás debe fallar por esto.
END;
$$;

REVOKE ALL ON FUNCTION public.cert_marcar_descarga_alumno(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cert_marcar_descarga_alumno(uuid) TO authenticated;

CREATE FUNCTION public.curso_alumnos_emails(p_curso_id uuid)
RETURNS TABLE(profile_id uuid, email text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo gerencia' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT cm.profile_id, au.email::text
    FROM public.curso_matriculas cm
    JOIN auth.users au ON au.id = cm.profile_id
   WHERE cm.curso_id = p_curso_id;
END;
$$;

REVOKE ALL ON FUNCTION public.curso_alumnos_emails(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.curso_alumnos_emails(uuid) TO authenticated;
