-- DGG-244 · F2k — Importar audiencia inicial (clientes + captación) como suscriptores
-- ---------------------------------------------------------------------------
-- Frente B: Pablo decidió el modelo opt-out → los clientes y la base de captación
-- PBA se asumen suscriptos ('confirmado'), salvo baja/supresión/opt-out. Se marcan
-- una vez (idempotente); las bajas sucesivas se dan a medida que rechacen.
--
-- Hermeticidad (requisito de Pablo): ON CONFLICT (email_norm) DO NOTHING → NUNCA
-- pisa ni duplica un suscriptor existente (un cliente que ya se suscribió por la
-- web mantiene su origen/estado). Respeta: supresión global, baja de cliente
-- (estado='baja' / ofrecimientos_habilitados=false), baja de captación
-- (estado_captacion='baja' / baja_at). Dedup por email_norm (DISTINCT ON).
--
-- (1) El trigger de aviso a gerencia NO dispara para la base importada
--     (origen 'cliente'/'captacion') — si no, el import generaría ~3.000 campanitas.
--     Gerencia sí recibe aviso por los suscriptores ORGÁNICOS (web/formulario).

create or replace function public.lexph_suscriptor_confirmado_trg()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if NEW.estado = 'confirmado'
     and (TG_OP = 'INSERT' or OLD.estado is distinct from 'confirmado')
     and coalesce(NEW.origen, '') not in ('cliente', 'captacion')  -- no avisar por la base importada
  then
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

-- (2) RPC idempotente de importación (staff-only).
create or replace function public.lexph_importar_audiencia_inicial()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_clientes  int := 0;
  v_captacion int := 0;
  c_email_re  constant text := '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$';
begin
  if not (select private.is_staff()) then
    raise exception 'Sólo el staff de gerencia puede importar la audiencia.' using errcode = '42501';
  end if;

  -- Clientes: administraciones activas, con marketing habilitado y email válido.
  with src as (
    select distinct on (lower(btrim(a.email)))
           btrim(a.email) as email, lower(btrim(a.email)) as email_norm
      from public.administraciones a
     where coalesce(a.email, '') <> ''
       and lower(btrim(a.email)) ~ c_email_re
       and a.estado is distinct from 'baja'
       and coalesce(a.ofrecimientos_habilitados, true) = true
     order by lower(btrim(a.email)), a.created_at
  ),
  ins as (
    insert into public.lexph_suscriptores (email, email_norm, estado, origen, confirmed_at)
    select s.email, s.email_norm, 'confirmado', 'cliente', now()
      from src s
     where not exists (select 1 from public.email_suppression x where x.email = s.email_norm)
    on conflict (email_norm) do nothing
    returning 1
  )
  select count(*) into v_clientes from ins;

  -- Captación: prospectos no dados de baja, con email válido. (ON CONFLICT saltea
  -- los que ya quedaron como cliente arriba o ya eran suscriptores.)
  with src as (
    select distinct on (lower(btrim(p.email)))
           btrim(p.email) as email, lower(btrim(p.email)) as email_norm
      from public.prospectos p
     where coalesce(p.email, '') <> ''
       and lower(btrim(p.email)) ~ c_email_re
       and coalesce(p.estado_captacion, '') <> 'baja'
       and p.baja_at is null
     order by lower(btrim(p.email)), p.created_at
  ),
  ins as (
    insert into public.lexph_suscriptores (email, email_norm, estado, origen, confirmed_at)
    select s.email, s.email_norm, 'confirmado', 'captacion', now()
      from src s
     where not exists (select 1 from public.email_suppression x where x.email = s.email_norm)
    on conflict (email_norm) do nothing
    returning 1
  )
  select count(*) into v_captacion from ins;

  return jsonb_build_object('ok', true, 'clientes', v_clientes, 'captacion', v_captacion);
end;
$fn$;

revoke all on function public.lexph_importar_audiencia_inicial() from public;
grant execute on function public.lexph_importar_audiencia_inicial() to authenticated;
