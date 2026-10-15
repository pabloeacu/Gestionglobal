-- 0577 · DGG-224 — emails_rebotados_recientes: excluir casillas sintéticas de QA
-- (dominio .test), igual que el query legacy (§6 B#10). Sólo agrega el filtro;
-- el resto (7d, excluir suprimidos, enriquecer con admin) queda igual.
CREATE OR REPLACE FUNCTION public.emails_rebotados_recientes()
 RETURNS TABLE(id uuid, to_email text, asunto text, template_slug text, estado text,
               bounced_at timestamptz, error_msg text, administracion_id uuid, administracion_nombre text)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT se.id, se.to_email, se.asunto, se.template_slug, se.estado,
         se.bounced_at, se.error_msg, se.administracion_id, a.nombre
  FROM public.sent_emails se
  LEFT JOIN public.administraciones a ON a.id = se.administracion_id
  WHERE private.is_staff()
    AND se.estado IN ('bounced', 'complained')
    AND COALESCE(se.bounced_at, se.enviado_at) > now() - interval '7 days'
    AND se.to_email NOT ILIKE '%.test'
    AND NOT EXISTS (SELECT 1 FROM public.email_suppression s WHERE s.email = lower(btrim(se.to_email)))
  ORDER BY se.bounced_at DESC NULLS LAST
  LIMIT 50;
$function$;
