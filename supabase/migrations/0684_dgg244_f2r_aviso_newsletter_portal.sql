-- 0684 · DGG-244 F2r · Aviso in-app del newsletter LexPH en el portal del cliente.
--
-- GAP reportado por un cliente (2026-11-12): al lanzarse una edición del
-- newsletter LexPH, el cliente recibe el EMAIL (modelo opt-out: clientes +
-- captación como presuntos suscriptos), pero en el home de su portal NO tiene
-- ningún acceso directo para leer la edición. Se había hablado de banner +
-- campanita + push + email; sólo se construyó el email (F2d-B). Faltan las
-- superficies in-app del cliente.
--
-- Decisión de Pablo (2026-11-12): banner + campanita + push, el banner
-- "hasta clic o X" (por edición/cliente), retroactivo a la edición vigente.
--
-- SOLUCIÓN (aditiva, reusa el sistema de Comunicaciones de gerencia, que ya
-- hace banner + campanita + push + dismiss por cliente — CERO frontend nuevo):
-- el lanzamiento crea+envía una `comunicaciones` con canal_email=FALSE (el
-- newsletter ya manda su propio mail, no duplicar), push+campanita según
-- p_con_push, cta_url='/lexph' (teaser→web), apuntada por audiencia 'manual' a
-- los CLIENTES que son suscriptores confirmados del newsletter (los mismos que
-- reciben el mail), menos suprimidos → coherencia aviso↔display (§6e).
-- Idempotente por edición vía lexph_ediciones.portal_comunicacion_id.

ALTER TABLE public.lexph_ediciones
  ADD COLUMN IF NOT EXISTS portal_comunicacion_id uuid
    REFERENCES public.comunicaciones(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.lexph_edicion_avisar_portal(
  p_edicion_id uuid,
  p_con_push boolean DEFAULT true
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_edicion record;
  v_ids     jsonb;
  v_com_id  uuid;
  v_titulo  text;
  v_cuerpo  text;
  v_res     jsonb;
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Sólo el staff de gerencia puede avisar al portal.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_edicion FROM public.lexph_ediciones WHERE id = p_edicion_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Edición no encontrada (id=%).', p_edicion_id USING ERRCODE = 'P0002';
  END IF;

  -- idempotente: una sola comunicación de portal por edición.
  IF v_edicion.portal_comunicacion_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'ya_avisado', true,
                              'comunicacion_id', v_edicion.portal_comunicacion_id);
  END IF;

  -- audiencia = clientes activos que SON suscriptores confirmados del newsletter
  -- (exactamente los que reciben el mail), menos suprimidos. Opt-out respetado:
  -- un cliente en baja NO está 'confirmado' → no entra.
  SELECT jsonb_agg(a.id) INTO v_ids
  FROM public.administraciones a
  WHERE a.estado = 'activo' AND a.activo = true
    AND a.email IS NOT NULL AND btrim(a.email) <> ''
    AND EXISTS (
      SELECT 1 FROM public.lexph_suscriptores s
       WHERE s.email_norm = lower(btrim(a.email)) AND s.estado = 'confirmado')
    AND NOT EXISTS (
      SELECT 1 FROM public.email_suppression sup
       WHERE lower(btrim(sup.email)) = lower(btrim(a.email)));

  IF v_ids IS NULL OR jsonb_array_length(v_ids) = 0 THEN
    RETURN jsonb_build_object('ok', true, 'enviados', 0, 'motivo', 'sin_clientes_suscriptos');
  END IF;

  v_titulo := 'Nueva edición de LexPH';
  v_cuerpo := left(
    COALESCE(NULLIF(btrim(v_edicion.intro), ''),
             'Ya está disponible una nueva edición de LexPH con las últimas novedades de propiedad horizontal.'),
    240);

  INSERT INTO public.comunicaciones
    (titulo, cuerpo_md, cta_label, cta_url, banner_estilo,
     canal_banner, canal_email, canal_push, canal_campanita, audiencia, estado, created_by)
  VALUES
    (v_titulo, v_cuerpo, 'Leer la edición', '/lexph', 'novedad',
     true, false, p_con_push, true,
     jsonb_build_object('type', 'manual', 'administracion_ids', v_ids),
     'borrador', auth.uid())
  RETURNING id INTO v_com_id;

  v_res := public.comunicacion_enviar(v_com_id);

  UPDATE public.lexph_ediciones SET portal_comunicacion_id = v_com_id WHERE id = p_edicion_id;

  RETURN jsonb_build_object('ok', true, 'comunicacion_id', v_com_id, 'envio', v_res);
END
$function$;

GRANT EXECUTE ON FUNCTION public.lexph_edicion_avisar_portal(uuid, boolean) TO authenticated;

-- Wire: al enviar el newsletter, disparar también el aviso al portal (guarded:
-- un fallo del aviso NUNCA rompe el envío de mails). Idéntico a lexph_newsletter_enviar
-- vigente salvo el bloque final marcado DGG-244 F2r.
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

  -- DGG-244 F2r: aviso in-app al portal de los clientes suscriptos (banner +
  -- campanita + push), en simultáneo con el lanzamiento del mail. Guarded: un
  -- fallo acá NO rompe el envío de correos (ya encolados arriba).
  begin
    perform public.lexph_edicion_avisar_portal(p_edicion_id, true);
  exception when others then
    raise warning 'lexph_edicion_avisar_portal falló para edición %: %', p_edicion_id, sqlerrm;
  end;

  return jsonb_build_object(
    'ok', true, 'enviados', v_count,
    'dias', ceil(v_count::numeric / c_cap_dia),
    'desde', v_desde,
    'reenvio', v_already is not null
  );
end
$function$;
