-- 0670 · DGG-244 F2p — Hardening adversarial del sweep de resurrección (E-GG-264).
--
-- HALLAZGO (auditoría adversarial propia, post-0668): la resurrección single-shot
-- de la mig 0668 podría, en un caso MUY remoto, RE-ENVIAR un mail YA ENTREGADO.
-- Escenario: el hallazgo [1] (doble-envío por concurrencia, aún diferido) hace
-- que dos ticks procesen la misma fila; el tick A ENTREGA (status='sent',
-- sent_emails insertado) y el tick B falla transitorio DESPUÉS → failJob()
-- sobreescribe status='sent'→'failed' (UPDATE incondicional). La resurrección
-- vería esa fila 'failed' con error transitorio y la re-encolaría → 2da/3ra
-- entrega al mismo destinatario. Probabilidad ínfima (requiere la carrera [1] +
-- que B falle justo tras A entregar), pero el guard es barato y la elimina.
--
-- FIX: no resucitar si YA existe una entrega registrada en sent_emails para ese
-- destinatario + template (prueba positiva de entrega, independiente del status
-- de email_queue que failJob puede haber pisado). sent_emails sólo se inserta
-- tras un send exitoso (dispatch-emails :468) → es la fuente de verdad de
-- "¿llegó?". Verificado e2e abajo.

CREATE OR REPLACE FUNCTION private.lexph_newsletter_supresion_sweep()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  -- 1) Cancelar pendientes cuyo destinatario entró a supresión durante la campaña.
  update public.email_queue q
     set status = 'cancelled', enviado_at = now(),
         ultimo_error = 'suprimido durante la campaña (sweep cross-canal)'
   where q.enviado_at is null
     and q.status = 'pending'
     and q.template_slug like 'lexph-newsletter-e%'
     and exists (
       select 1 from public.email_suppression s
        where s.email = lower(btrim(q.to_email))
     );

  -- 2) Resucitar UNA sola vez los 'failed' por error TRANSITORIO (caída de Gmail/
  --    Workspace/red). El marcador '[reintento tras caída]' evita loops. No toca
  --    suprimidos, ni fallos permanentes (template/bounce), ni —guard E-GG-264—
  --    filas cuyo destinatario YA tiene entrega registrada en sent_emails.
  update public.email_queue q
     set status = 'pending', enviado_at = null, programado_para = now(),
         intento = greatest(q.intento - 2, 0),
         ultimo_error = coalesce(q.ultimo_error, '') || ' [reintento tras caída]'
   where q.template_slug like 'lexph-newsletter-e%'
     and q.status = 'failed'
     and q.enviado_at > now() - interval '36 hours'
     and position('[reintento tras caída]' in coalesce(q.ultimo_error, '')) = 0
     and q.ultimo_error ~* '(gmail|timeout|time out|fetch|network|econn|socket|\m50[234]\M|token endpoint)'
     and not exists (
       select 1 from public.email_suppression s
        where s.email = lower(btrim(q.to_email))
     )
     and not exists (
       select 1 from public.sent_emails se
        where lower(btrim(se.to_email)) = lower(btrim(q.to_email))
          and se.template_slug = q.template_slug
     );
end
$function$;
