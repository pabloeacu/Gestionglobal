-- 0324 · Memoria de destinatarios de gestoría (finding D · reporte JL).
--
-- JL pidió: "si no es complicado estaría bueno que recuerde los mails del
-- Gestor" (paso 4 del wizard de activación · Derivación a gestoría).
--
-- La memoria YA existe: cada derivación persiste `destinatario_email` +
-- `destinatario_nombre` en `solicitud_derivaciones`. Esta RPC expone los
-- destinatarios distintos (email normalizado por lower, más recientes
-- primero) para autocompletar el campo "Email del gestor" con un <datalist>.
--
-- Reglas aplicadas:
--  · R5  — no toca 2+ tablas, pero se expone como RPC SECURITY DEFINER para
--          poder leer solicitud_derivaciones sin abrir RLS a lecturas amplias.
--  · R11 — sólo lee; el volumen es mínimo (LIMIT 30). Sin FK nueva.
--  · R16 — función nueva de nombre único: CREATE OR REPLACE no genera overload.
--  · staff-only: el wizard de activación sólo lo corre gerencia (is_staff =
--    gerente|operador). Un cliente que la invoque recibe 42501.

CREATE OR REPLACE FUNCTION public.gestoria_destinatarios_recientes()
 RETURNS TABLE(email text, nombre text)
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- Sólo gerencia (gerente/operador) corre el wizard de activación.
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo gerencia' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT sub.email, sub.nombre
  FROM (
    SELECT DISTINCT ON (lower(d.destinatario_email))
           d.destinatario_email                     AS email,
           NULLIF(btrim(d.destinatario_nombre), '') AS nombre,
           d.enviada_at                             AS ord
    FROM public.solicitud_derivaciones d
    WHERE d.destinatario_email IS NOT NULL
      AND btrim(d.destinatario_email) <> ''
    ORDER BY lower(d.destinatario_email), d.enviada_at DESC NULLS LAST
  ) sub
  ORDER BY sub.ord DESC NULLS LAST
  LIMIT 30;
END
$function$;

REVOKE ALL ON FUNCTION public.gestoria_destinatarios_recientes() FROM anon, public;
GRANT EXECUTE ON FUNCTION public.gestoria_destinatarios_recientes() TO authenticated;

COMMENT ON FUNCTION public.gestoria_destinatarios_recientes() IS
  'Finding D · autocompletar "Email del gestor" en el wizard. Destinatarios '
  'distintos de solicitud_derivaciones, más recientes primero. Staff-only.';
