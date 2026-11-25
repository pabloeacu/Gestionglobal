-- 0723 · DGG-268 — Helper de rebote del harvester de Gmail: suprime + baja la entidad +
-- detecta si es cliente, para que el aviso a gerencia NO sea client-framing en prospectos fríos.
--
-- Capitaliza E-GG-298 (incidente rebotes 25/11): el harvester avisaba a gerencia por CADA
-- rebote — incluso prospectos fríos del import nacional — con copy de "cliente/ficha", lo que
-- generó la falsa alarma de "clientes reales rebotando". Ahora:
--   · marketing (prospecto/lexph) que rebota → supresión GLOBAL (origen='webhook') + baja de la
--     entidad (prospectos.estado_captacion / lexph_suscriptores.estado), coherente con el panel (R19);
--   · a un CLIENTE puro NO se lo suprime (su transaccional sigue; lo protege el carve-out de
--     email_bloqueado_total) — se devuelve es_cliente=true para que el edge avise con copy honesto.
--
-- R5 (multi-tabla) · R6 (grant explícito) · R16 (nombre net-new, sin overload).

create or replace function public.bounce_feedback_apply(p_email text, p_complaint boolean default false)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_norm      text := lower(btrim(coalesce(p_email, '')));
  v_motivo    text := case when p_complaint then 'queja' else 'bounce' end;
  v_prospecto uuid;
  v_is_lexph  boolean;
  v_suprimido boolean := false;
  v_admin_id  uuid;
  v_nombre    text;
begin
  if v_norm = '' or position('@' in v_norm) = 0 then
    return jsonb_build_object('suprimido', false, 'es_cliente', false);
  end if;

  select id into v_prospecto from public.prospectos where email = v_norm;
  v_is_lexph := exists(select 1 from public.lexph_suscriptores where email_norm = v_norm);
  select id, nombre into v_admin_id, v_nombre
    from public.administraciones where lower(btrim(email)) = v_norm and estado <> 'baja' limit 1;

  -- Suprimir SÓLO audiencias de marketing (prospecto/lexph). Cliente puro: no se suprime.
  if v_prospecto is not null or v_is_lexph then
    insert into public.email_suppression (email, motivo, origen, prospecto_id)
    values (v_norm, v_motivo, 'webhook', v_prospecto)
    on conflict (email) do update set
      motivo = case when excluded.motivo = 'queja' then 'queja'
                    when private.motivo_es_hard(email_suppression.motivo) then email_suppression.motivo
                    else excluded.motivo end,
      origen = case when excluded.motivo = 'queja' then 'webhook'
                    when private.motivo_es_hard(email_suppression.motivo) then email_suppression.origen
                    else 'webhook' end,
      prospecto_id = coalesce(email_suppression.prospecto_id, excluded.prospecto_id);
    v_suprimido := true;

    if v_prospecto is not null then
      update public.prospectos
         set estado_captacion = 'baja', baja_at = coalesce(baja_at, now()), updated_at = now()
       where id = v_prospecto;
    end if;
    update public.lexph_suscriptores
       set estado = 'baja', baja_at = coalesce(baja_at, now())
     where email_norm = v_norm and estado <> 'baja';
  end if;

  return jsonb_build_object(
    'suprimido', v_suprimido,
    'es_cliente', v_admin_id is not null,
    'administracion_id', v_admin_id,
    'nombre', v_nombre,
    'motivo', v_motivo);
end
$fn$;

revoke all on function public.bounce_feedback_apply(text, boolean) from public, anon, authenticated;
grant execute on function public.bounce_feedback_apply(text, boolean) to service_role;

comment on function public.bounce_feedback_apply(text, boolean) is
  'DGG-268 E-GG-298: aplica un rebote/queja del harvester de Gmail. Suprime (origen=webhook) + baja la entidad de marketing (prospecto/lexph); al cliente puro no lo suprime. Devuelve es_cliente para que el aviso a gerencia sea sólo por clientes (no prospectos fríos).';
