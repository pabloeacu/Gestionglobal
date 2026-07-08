-- 0280 · E-GG-90 · Docs del cliente + de derivación en el detalle de trámite (gerencia)
-- ============================================================================
-- Reporte JL (audio 2): en el panel de gerencia "voy al trámite, no lo encuentro.
-- Dice que hay un adjunto pero no encuentro el documento". Causa: el detalle de
-- trámite (`TrackingDetailPage`) sólo listaba los archivos de las líneas de
-- tracking (`gestor-uploads`, público) y los del flujo PedidoDoc, pero NO los
-- documentos ORIGINALES del cliente (`form-adjuntos`) ni los que gerencia le
-- reenvió a la gestoría al derivar (`gestoria-adjuntos`). Esos sólo se veían en
-- el detalle de la SOLICITUD, no en el del trámite donde trabaja la gerencia; y
-- `gestoria-adjuntos` no tenía ningún lector en toda la app (E-GG-89 §barrido).
--
-- Esta RPC (staff-only) junta ambos orígenes para un trámite y devuelve
-- {bucket, path, nombre, origen}. El front firma cada uno con la sesión de
-- gerencia (las policies de storage `form_adj_select_staff` y
-- `gestoria_adjuntos_gerente_rw` ya permiten a staff leer esos buckets privados).
-- No se toca ninguna policy. R5 (multi-tabla → RPC), R12 (staff).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.tramite_docs_cliente(p_tramite_id uuid)
RETURNS TABLE(bucket text, path text, nombre text, origen text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  -- (a) Documentos ORIGINALES del cliente (form-adjuntos) via el submission del trámite.
  SELECT 'form-adjuntos'::text AS bucket,
         fa.storage_path       AS path,
         fa.filename_original   AS nombre,
         'cliente'::text        AS origen
    FROM public.tramites t
    JOIN public.formulario_adjuntos fa
      ON fa.submission_id = t.formulario_submission_id
   WHERE t.id = p_tramite_id
     AND private.is_staff()

  UNION ALL

  -- (b) Documentos que gerencia reenvió a la gestoría al derivar (gestoria-adjuntos).
  SELECT 'gestoria-adjuntos'::text,
         (a->>'path'),
         COALESCE(a->>'filename', a->>'path'),
         'derivacion'::text
    FROM public.solicitudes s
    JOIN public.solicitud_derivaciones d ON d.solicitud_id = s.id
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(d.adjuntos_jsonb, '[]'::jsonb)) AS a
   WHERE s.tramite_id = p_tramite_id
     AND private.is_staff()
     AND COALESCE(a->>'path','') <> '';
$function$;

GRANT EXECUTE ON FUNCTION public.tramite_docs_cliente(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.tramite_docs_cliente(uuid) FROM anon, public;
