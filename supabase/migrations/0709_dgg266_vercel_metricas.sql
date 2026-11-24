-- 0709 · DGG-266 — Enriquecimiento del tráfico de Vercel adentro de la plataforma.
-- Pablo: "no voy a ir a Vercel a chequear nada... traé por API toda la info que puedas
-- para hacer un análisis interesante adentro de nuestra plataforma."
--
-- Tabla genérica (dimension × valor × ventana) que el edge `vercel-trafico-snapshot`
-- puebla desde Vercel Web Analytics (visits/aggregate by <dim>), para que el reporte
-- semanal y el panel de gerencia lean todo sin salir de la app.
--   dimension: 'campaign'|'source'|'medium'|'path'|'referrer'|'device'|'country'
--   valor: el bucket (p.ej. 'lexph-newsletter-e3', '/lexph', 'google.com', 'mobile')
--   ventana: 'hoy'|'7d'|'30d'
-- Igual que vercel_trafico: medición honesta (medicion_estado; si Vercel falla NO se
-- inventa un 0 — la fila no se escribe o queda marcada).

create table if not exists public.vercel_metricas (
  dimension        text        not null,
  valor            text        not null,
  ventana          text        not null,
  visitantes       int         not null default 0,
  vistas           int         not null default 0,
  actualizado_at   timestamptz not null default now(),
  primary key (dimension, valor, ventana)
);

alter table public.vercel_metricas enable row level security;
grant select on public.vercel_metricas to authenticated;
revoke insert, update, delete on public.vercel_metricas from authenticated, anon;

drop policy if exists vercel_metricas_staff_read on public.vercel_metricas;
create policy vercel_metricas_staff_read on public.vercel_metricas
  for select using (private.is_staff());

comment on table public.vercel_metricas is
  'DGG-266 · Métricas de Vercel Web Analytics por dimensión×valor×ventana (campaign/source/medium/path/referrer/device/country), pobladas por el edge vercel-trafico-snapshot cada 3h. Lectura staff. Para el reporte semanal integral y el panel de analytics de gerencia.';

create index if not exists vercel_metricas_dim_ventana_idx
  on public.vercel_metricas (dimension, ventana, visitantes desc);
