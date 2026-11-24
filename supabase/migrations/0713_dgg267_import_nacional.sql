-- 0713 · DGG-267 — Captación nacional + alimentar LexPH desde los 2 Excel de GG.
-- Pablo: multiplicar el alcance de marketing con la info legítima recolectada en
-- congresos/convenciones/webinars/acuerdos. Universo unificado (12.433) ya cargado en
-- public.mkt_import_staging. Esta mig: (a) agrega jurisdicción a prospectos; (b) crea la
-- RPC que escribe los nuevos — captación resto-país + suscriptores LexPH — excluyendo
-- clientes, captación PBA existente y suprimidos (baja/rebote). La baja/rebote es GLOBAL
-- (email_suppression), así que el punto #4 ya queda cubierto.

-- (0) Tabla de staging del import (reusable: para re-correr con Excels actualizados).
--     El universo se carga por fuera (one-time: PostgREST bulk desde el CSV mergeado).
create table if not exists public.mkt_import_staging (
  email text primary key,
  nombre text,
  jurisdiccion text,
  matricula text,
  origen_fuente text,
  telefono text,
  cargado_at timestamptz not null default now()
);
alter table public.mkt_import_staging enable row level security;
revoke all on public.mkt_import_staging from anon, authenticated;
comment on table public.mkt_import_staging is 'DGG-267 · staging del import de contactos de marketing (Excel GG). Service-role only (RLS sin policy).';

-- (a) Jurisdicción en prospectos (para campañas targeteadas: CABA cursos RPA / PBA gestoría / nacional).
alter table public.prospectos add column if not exists jurisdiccion text;
update public.prospectos set jurisdiccion = 'PBA' where origen = 'padron_pba' and jurisdiccion is null;
create index if not exists prospectos_origen_juris_idx on public.prospectos (origen, jurisdiccion);

-- (b) Import idempotente desde el staging. Service-role (lo corre gerencia/ops, no el front).
create or replace function public.mkt_import_aplicar()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_prosp int := 0;
  v_lexph int := 0;
  v_univ int := 0;
begin
  select count(*) into v_univ from public.mkt_import_staging;

  -- Emails de clientes (por login auth + por email de la administración).
  create temp table _cli on commit drop as
    select distinct lower(btrim(au.email)) e
      from public.administraciones a join auth.users au on au.id = a.user_id
     where au.email is not null
    union
    select distinct lower(btrim(a.email))
      from public.administraciones a
     where a.email is not null and btrim(a.email) <> '';

  -- CAPTACIÓN RESTO PAÍS: nuevos que NO son cliente, NO están en captación, NO suprimidos.
  with nuevos as (
    select s.email, s.nombre, s.jurisdiccion, s.matricula, s.origen_fuente
      from public.mkt_import_staging s
     where not exists (select 1 from _cli c where c.e = s.email)
       and not exists (select 1 from public.prospectos p where lower(btrim(p.email)) = s.email)
       and not exists (select 1 from public.email_suppression x where x.email = s.email)
  )
  insert into public.prospectos (nombre, email, matricula, origen, jurisdiccion, observaciones, baja_token)
  select coalesce(nullif(btrim(nombre), ''), split_part(email, '@', 1)),  -- nombre NOT NULL: fallback al prefijo del email
         email, nullif(matricula, ''), 'import_nacional', jurisdiccion,
         nullif(left('Import GG · ' || coalesce(origen_fuente, ''), 300), 'Import GG · '),
         gen_random_uuid()::text
    from nuevos
  on conflict (email) do nothing;
  get diagnostics v_prosp = row_count;

  -- LEXPH: nuevos suscriptores (confirmado) que NO están suscriptos y NO suprimidos.
  with nuevos as (
    select s.email
      from public.mkt_import_staging s
     where not exists (select 1 from public.lexph_suscriptores l where l.email_norm = s.email)
       and not exists (select 1 from public.email_suppression x where x.email = s.email)
  )
  insert into public.lexph_suscriptores (email, email_norm, estado, origen, confirmed_at)
  select email, email, 'confirmado', 'import_nacional', now()
    from nuevos
  on conflict (email_norm) do nothing;
  get diagnostics v_lexph = row_count;

  return jsonb_build_object(
    'universo', v_univ,
    'nuevos_prospectos', v_prosp,
    'nuevos_lexph', v_lexph
  );
end
$fn$;

revoke all on function public.mkt_import_aplicar() from public, anon, authenticated;
grant execute on function public.mkt_import_aplicar() to service_role;
