-- DGG-244 · F2f — Suscriptores: supresión unificada + aviso a gerencia por nuevo confirmado
-- ---------------------------------------------------------------------------
-- Parte del "Frente A" del motor de audiencia LexPH (ver project_lexph_audiencia).
--
-- (1) SUPRESIÓN UNIFICADA (hallazgo del QA e2e): hoy `lexph_suscripcion_baja`
--     sólo setea estado='baja' y NO escribe en `email_suppression` global. Eso
--     deja un hueco en el modelo opt-out: un email dado de baja de LexPH podría
--     seguir recibiendo por otras vías (y clientes/captación del Frente B no se
--     cruzan con la baja de LexPH). Fix: espejar `prospecto_baja`/`administracion_baja`
--     → agregar a `email_suppression`. Como el newsletter ya filtra con NOT EXISTS
--     sobre esa tabla (0658/0659), una baja por cualquier vía corta TODAS las vías.
--
-- (2) AVISO A GERENCIA: cada nuevo suscriptor CONFIRMADO dispara una campanita
--     (+ push) a todos los gerentes/operadores vía el helper canónico
--     `private.notif_emitir_staff` (molde cobranza/tracking-cerrado, DGG-170).
--     Sirve para medir el éxito del proyecto (pedido de Pablo). Dispara en el
--     salto a 'confirmado' (web doble opt-in) y en alta directa como 'confirmado'
--     (futuro opt-in blando de formularios), nunca en re-confirmaciones idempotentes.

-- (1) baja de LexPH → también supresión global
create or replace function public.lexph_suscripcion_baja(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_id    uuid;
  v_email text;
begin
  select id, email into v_id, v_email
    from public.lexph_suscriptores where baja_token = p_token;
  if v_id is null then
    return jsonb_build_object('ok', false, 'estado', 'invalido');
  end if;

  update public.lexph_suscriptores
     set estado = 'baja', baja_at = now()
   where id = v_id;

  -- supresión global (opt-out unificado): corta el envío por toda vía.
  insert into public.email_suppression (email, motivo, origen)
  values (lower(btrim(v_email)), 'baja_usuario', 'lexph')
  on conflict (email) do nothing;

  return jsonb_build_object('ok', true, 'estado', 'baja');
end;
$$;

-- (2) trigger: nuevo suscriptor confirmado → aviso campanita+push a gerencia
create or replace function public.lexph_suscriptor_confirmado_trg()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if NEW.estado = 'confirmado'
     and (TG_OP = 'INSERT' or OLD.estado is distinct from 'confirmado') then
    perform private.notif_emitir_staff(
      'lexph_suscriptor',
      'Nuevo suscriptor de LexPH',
      NEW.email || ' se sumó al newsletter.',
      '/gerencia/contenidos/suscriptores',
      jsonb_build_object('suscriptor_id', NEW.id, 'email', NEW.email, 'origen', NEW.origen)
    );
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_lexph_suscriptor_confirmado on public.lexph_suscriptores;
create trigger trg_lexph_suscriptor_confirmado
  after insert or update of estado on public.lexph_suscriptores
  for each row execute function public.lexph_suscriptor_confirmado_trg();
