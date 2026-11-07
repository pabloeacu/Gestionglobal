-- 0671 · DGG-244 F2p — REVERTIR la resurrección del sweep (E-GG-265).
--
-- La auditoría adversarial triple (3 revisores read-only, pedida por Pablo)
-- demostró que la resurrección single-shot que agregué en 0668/0670 es NETA
-- NEGATIVA: introduce más riesgo que el residuo que cubría. Hallazgos CRÍTICOS:
--
-- (1) El "single-shot" NO es durable. El marcador anti-loop '[reintento tras
--     caída]' se guardaba en email_queue.ultimo_error, pero failJob() de
--     dispatch-emails (index.ts:636-647) PISA ultimo_error en CADA reintento y
--     en la exhaustión. Secuencia: sweep resucita → dispatch reintenta → al
--     agotar, failJob setea ultimo_error='Gmail 503…' (SIN marcador) +
--     enviado_at=now() + status='failed' → el próximo tick */15 ve 'failed',
--     sin marcador, error que matchea el regex, sin entrega → RE-RESUCITA.
--     Loop infinito. Y el tope enviado_at>now()-36h NUNCA cierra porque failJob
--     refresca enviado_at=now() en cada exhaustión.
--
-- (2) Clasificación de "transitorio" por substring 'gmail' matchea TODO. failJob
--     escribe 'Gmail {status}: {body}' para TODA falla de envío → un 400 (dirección
--     inválida), 403, 429 (cupo diario) — PERMANENTES — se clasificaban como
--     transitorios y se resucitaban. El guard \m50[234]\M era código muerto (el
--     token 'gmail' ya hacía match). Una dirección inválida loopearía para siempre.
--
-- (3) Consecuencia: una fila en loop deja enviado_at=null → reporte_tick nunca ve
--     pendientes=0 → el 'Informe final' de la edición NUNCA se emite; y la fila
--     oscila pending↔failed, sin botón Cancelar en EmailQueuePage (sólo aparece
--     con estado='pendiente'). Un lector pre-existente roto por el nuevo writer.
--
-- DECISIÓN: remover la resurrección. El `max_intentos=10` (mig 0668, en las 3027
-- filas + en ambas RPCs) ya da ~5h de tolerancia a caídas de Gmail SIN piezas
-- móviles ni riesgo. Para el caso remoto de outage sostenido >5h, el fallback es
-- MANUAL: el informe final reporta los 'fallidos' y gerencia los reenvía por el
-- feature #4 (envío a mails específicos, ahora funcional tras E-GG-263). Menos
-- código, cero loop, cero lector roto. "Inmejorable" acá = el mínimo robusto,
-- no el gold-plating frágil.
--
-- Esto restaura private.lexph_newsletter_supresion_sweep a su estado de 0667
-- (supresión cross-canal SOLAMENTE, que es correcto y terminal). max_intentos=10
-- se conserva. El cron */15 sigue igual.

CREATE OR REPLACE FUNCTION private.lexph_newsletter_supresion_sweep()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  -- Cancelar pendientes del newsletter cuyo destinatario entró a supresión
  -- (cualquier canal/motivo) DESPUÉS de encolar y ANTES de enviarse (goteo
  -- multi-día). Terminal: no reintenta, no resucita. (E-GG-261 [4/6].)
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
end
$function$;

comment on function private.lexph_newsletter_supresion_sweep() is
  'DGG-244 F2 (E-GG-261 [4/6]): cancela filas PENDIENTES del newsletter LexPH cuyo '
  'destinatario entró a email_suppression durante el goteo (supresión cross-canal). '
  'Cron */15. La resurrección de fallos transitorios se retiró en 0671 (E-GG-265) por '
  'neta negativa; la tolerancia a caídas la da max_intentos=10 y el reenvío manual por #4.';