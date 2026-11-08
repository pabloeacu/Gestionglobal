-- 0677 · DGG-245 — Snapshot de tráfico web (Vercel Web Analytics) para las cards de
-- gerencia (Landing / vs LexPH /lexph*), discriminadas. Pedido de Pablo 2026-11-08.
--
-- Arquitectura: un edge (`vercel-trafico-snapshot`) consulta la API de Web Analytics
-- de Vercel SERVER-SIDE con el secret VERCEL_ANALYTICS_TOKEN (nunca en el front, R3) y
-- hace UPSERT de los totales por (superficie, ventana) acá. Un cron lo dispara cada 3h.
-- Las cards leen esta tabla (staff-only). Cadencia 3h = la card "Hoy" no queda vieja.

create table if not exists public.vercel_trafico (
  superficie        text        not null check (superficie in ('landing','lexph')),
  ventana           text        not null check (ventana in ('hoy','7d','30d')),
  visitantes        int         not null default 0,
  vistas            int         not null default 0,
  desde_newsletter  int         not null default 0,   -- sólo lexph (UTM utm_source=newsletter)
  actualizado_at    timestamptz not null default now(),
  primary key (superficie, ventana)
);

alter table public.vercel_trafico enable row level security;
grant select on public.vercel_trafico to authenticated;
-- (el edge escribe con service_role, que bypassa RLS)

drop policy if exists vercel_trafico_staff_read on public.vercel_trafico;
create policy vercel_trafico_staff_read on public.vercel_trafico
  for select to authenticated using (private.is_staff());

comment on table public.vercel_trafico is
  'DGG-245 · Snapshot de tráfico web (Vercel Web Analytics) por superficie (landing/lexph) '
  'y ventana (hoy/7d/30d). Lo escribe el edge vercel-trafico-snapshot cada 3h; lo leen las '
  'cards de gerencia. Staff-only.';

-- Cron cada 3 horas → dispara el edge (patrón net.http_post + cron_bearer, como 0637).
do $$ begin perform cron.unschedule('vercel-trafico-snapshot'); exception when others then null; end $$;
select cron.schedule('vercel-trafico-snapshot', '0 */3 * * *', $cron$
  select net.http_post(
    url     := 'https://kaoyhkebnidzqjixvchh.supabase.co/functions/v1/vercel-trafico-snapshot',
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'Authorization', private.cron_bearer()),
    body    := jsonb_build_object('origen', 'cron'),
    timeout_milliseconds := 55000
  );
$cron$);
