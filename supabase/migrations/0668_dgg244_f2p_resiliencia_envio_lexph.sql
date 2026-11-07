-- 0668 · DGG-244 F2p — Resiliencia del envío del newsletter LexPH (E-GG-262).
-- Capitaliza 2 de los 3 hallazgos DIFERIDOS de la auditoría §6 de F2o que NO
-- requieren tocar la edge money-crítica `dispatch-emails` (gate R7): son DB-only.
-- El 3ero (claim atómico contra doble-envío) SÍ vive en la edge y queda como
-- decisión de Pablo (riesgo de deploy R7, no de lógica).
--
-- [5] RESILIENCIA ANTE CAÍDA DE GMAIL/WORKSPACE.
--   failJob() en dispatch-emails usa backoff min(2^intento,60)min y marca
--   status='failed' (definitivo, enviado_at seteado) al llegar a max_intentos.
--   Con max_intentos=5 la ventana de reintentos es ~30min: una caída de Gmail
--   > ~30min deja esas filas en 'failed' para siempre (el informe las cuenta
--   como 'fallidos', pero nadie las reintenta). Fix DB-only en dos capas:
--     (a) max_intentos=10 en las filas ya encoladas + en el origen (ambas RPCs
--         de envío) → la ventana pasa a ~5h (backoff cap 60min × más intentos).
--     (b) El sweep de mantenimiento de campaña (ya existente, cron */15) ahora
--         ADEMÁS resucita UNA sola vez las filas 'failed' por error TRANSITORIO
--         (gmail 5xx / timeout / red / token), extendiendo la cobertura a ~10h
--         sin intervención. Marca '[reintento tras caída]' = anti-loop (single
--         shot). No toca filas de destinatarios suprimidos.
--
-- [3] ETA HONESTO. El `dias=ceil(count/1500)` que devuelve la RPC asume el tope
--   de 1500/día; el throughput real es menor cuando compite el transaccional
--   (prioridad ≤5 pasa adelante). No se muestra en la UI (el toast ya dice "de
--   a poco"), así que es cosmético: se refuerza la expectativa en el toast
--   (frontend, fuera de esta mig). Acá no cambia la lógica de split (el split
--   ≤1500/día es correcto y es la pauta de deliverability de Frente A/B).
--
-- R16: ambas RPCs son CREATE OR REPLACE con firma IDÉNTICA → no hay overload.
-- R18: smoke e2e del INSERT de ambas RPCs al cierre (BEGIN/ROLLBACK).
-- R17: el sweep escribe en email_queue (RLS con policies de write gated) y es
--   trigger-less (cron → SECURITY DEFINER ya declarado). OK.

-- ---------------------------------------------------------------------------
-- (a.1) Filas YA encoladas de la campaña viva: subir tolerancia 5 → 10.
-- ---------------------------------------------------------------------------
update public.email_queue
   set max_intentos = 10
 where template_slug like 'lexph-newsletter-e%'
   and enviado_at is null
   and max_intentos < 10;

-- ---------------------------------------------------------------------------
-- (a.2) Origen: lexph_newsletter_enviar — idéntica, + max_intentos=10 al INSERT.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lexph_newsletter_enviar(p_edicion_id uuid, p_programado_desde timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_intro   text;
  v_seq     int;
  v_already timestamptz;
  v_html    text;
  v_slug    text;
  v_count   int := 0;
  v_desde   timestamptz := greatest(p_programado_desde, now());
  c_cap_dia constant int := 1500;
begin
  if not (select private.is_staff()) then
    raise exception 'Sólo el staff de gerencia puede enviar el newsletter.' using errcode = '42501';
  end if;

  select e.intro, e.seq, e.newsletter_enviado_at
    into v_intro, v_seq, v_already
    from public.lexph_ediciones e where e.id = p_edicion_id;
  if not found then
    raise exception 'Edición no encontrada (id=%).', p_edicion_id using errcode = 'P0002';
  end if;
  if coalesce(btrim(v_intro), '') = '' then
    raise exception 'Completá al menos la intro del digest antes de enviar el newsletter.' using errcode = '22023';
  end if;

  v_slug := 'lexph-newsletter-e' || coalesce(v_seq::text, replace(p_edicion_id::text, '-', ''));

  if exists (
    select 1 from public.email_queue
     where template_slug = v_slug and enviado_at is null and status = 'pending'
  ) then
    raise exception 'La edición N°% ya tiene un envío en curso (quedan correos pendientes en la cola). Esperá a que termine antes de reenviar.', coalesce(v_seq::text, '?')
      using errcode = '55000';
  end if;

  v_html := public.lexph_newsletter_html(p_edicion_id);
  if v_html is null then
    raise exception 'No se pudo generar el HTML del newsletter.' using errcode = 'P0002';
  end if;

  insert into public.email_templates (slug, nombre, asunto, body_html, from_casilla, layout_version, activo)
  values (v_slug,
          'LexPH Newsletter · Edición ' || coalesce(v_seq::text, '') || ' (auto-generado)',
          'Novedades de propiedad horizontal · LexPH',
          v_html, 'general', 'legacy', true)
  on conflict (slug) do update
    set body_html = excluded.body_html, asunto = excluded.asunto,
        layout_version = 'legacy', from_casilla = 'general', activo = true, updated_at = now();

  insert into public.email_queue
    (kind, template_slug, to_email, variables, prioridad, related_table, related_id, programado_para, max_intentos)
  select 'workflow', v_slug, s.email,
         jsonb_build_object('baja_url', 'https://www.gestionglobal.ar/lexph/baja?token=' || s.baja_token),
         8,
         'lexph_suscriptores', s.id,
         v_desde + (floor((row_number() over (order by s.created_at, s.id) - 1) / c_cap_dia))::int * interval '1 day',
         10
    from public.lexph_suscriptores s
   where s.estado = 'confirmado'
     and not exists (select 1 from public.email_suppression sup where lower(btrim(sup.email)) = s.email_norm);
  get diagnostics v_count = row_count;

  update public.lexph_ediciones
     set newsletter_enviado_at = now(), newsletter_reporte_at = null
   where id = p_edicion_id;

  return jsonb_build_object(
    'ok', true, 'enviados', v_count,
    'dias', ceil(v_count::numeric / c_cap_dia),
    'desde', v_desde,
    'reenvio', v_already is not null
  );
end
$function$;

-- ---------------------------------------------------------------------------
-- (a.3) Origen: lexph_newsletter_enviar_especifico — idéntica, + max_intentos=10.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lexph_newsletter_enviar_especifico(p_edicion_id uuid, p_emails text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_intro   text;
  v_seq     int;
  v_html    text;
  v_slug    text;
  v_count   int := 0;
  c_cap_dia constant int := 1500;
begin
  if not (select private.is_staff()) then
    raise exception 'Sólo el staff de gerencia puede enviar el newsletter.' using errcode = '42501';
  end if;
  if p_emails is null or array_length(p_emails, 1) is null then
    raise exception 'No pasaste ningún mail.' using errcode = '22023';
  end if;

  select e.intro, e.seq into v_intro, v_seq from public.lexph_ediciones e where e.id = p_edicion_id;
  if not found then raise exception 'Edición no encontrada.' using errcode = 'P0002'; end if;
  if coalesce(btrim(v_intro), '') = '' then
    raise exception 'Completá al menos la intro del digest antes de enviar.' using errcode = '22023';
  end if;

  v_html := public.lexph_newsletter_html(p_edicion_id);
  if v_html is null then raise exception 'No se pudo generar el HTML.' using errcode = 'P0002'; end if;
  v_slug := 'lexph-newsletter-e' || coalesce(v_seq::text, replace(p_edicion_id::text, '-', ''));

  insert into public.email_templates (slug, nombre, asunto, body_html, from_casilla, layout_version, activo)
  values (v_slug, 'LexPH Newsletter · Edición ' || coalesce(v_seq::text, '') || ' (auto-generado)',
          'Novedades de propiedad horizontal · LexPH', v_html, 'general', 'legacy', true)
  on conflict (slug) do update
    set body_html = excluded.body_html, asunto = excluded.asunto,
        layout_version = 'legacy', from_casilla = 'general', activo = true, updated_at = now();

  insert into public.lexph_suscriptores (email, email_norm, estado, origen, confirmed_at)
  select distinct on (lower(btrim(e))) btrim(e), lower(btrim(e)), 'confirmado', 'manual', now()
    from unnest(p_emails) e
   where lower(btrim(e)) ~ '^[^@[:space:]]+@[^@[:space:]]+\\.[^@[:space:]]+$'
     and not exists (select 1 from public.email_suppression s where s.email = lower(btrim(e)))
   order by lower(btrim(e))
  on conflict (email_norm) do nothing;

  insert into public.email_queue
    (kind, template_slug, to_email, variables, prioridad, related_table, related_id, programado_para, max_intentos)
  select 'workflow', v_slug, s.email,
         jsonb_build_object('baja_url', 'https://www.gestionglobal.ar/lexph/baja?token=' || s.baja_token),
         8, 'lexph_suscriptores', s.id,
         now() + (floor((row_number() over (order by s.email) - 1) / c_cap_dia))::int * interval '1 day',
         10
    from public.lexph_suscriptores s
   where s.email_norm = any (select distinct lower(btrim(e)) from unnest(p_emails) e
                             where lower(btrim(e)) ~ '^[^@[:space:]]+@[^@[:space:]]+\\.[^@[:space:]]+$')
     and s.estado = 'confirmado'
     and not exists (select 1 from public.email_suppression sup where sup.email = s.email_norm)
     and not exists (select 1 from public.email_queue q2
                      where q2.template_slug = v_slug and q2.enviado_at is null
                        and lower(btrim(q2.to_email)) = s.email_norm);
  get diagnostics v_count = row_count;

  return jsonb_build_object('ok', true, 'enviados', v_count);
end
$function$;

-- ---------------------------------------------------------------------------
-- (b) Sweep de mantenimiento de campaña: supresión (ya existía) + resurrección
--     single-shot de fallos transitorios. Mismo cron (*/15), mismo nombre.
-- ---------------------------------------------------------------------------
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
  --    destinatarios suprimidos ni fallos por causa permanente (template/bounce).
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
     );
end
$function$;

comment on function private.lexph_newsletter_supresion_sweep() is
  'DGG-244 F2p (E-GG-262): mantenimiento de campaña LexPH. (1) cancela pendientes '
  'suprimidos cross-canal; (2) resucita single-shot fallos transitorios (caída de '
  'Gmail) extendiendo la cobertura a ~10h sin intervención. Cron */15.';
