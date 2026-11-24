-- 0708 · DGG-265 — Observabilidad honesta del tráfico atribuido + atribución
-- general de emails de marketing (no solo newsletter).
--
-- Contexto (Pablo 2026-11-24): "no quiero que me mienta nunca" sobre
-- desde_newsletter + "aplicá el UTM a TODOS los correos de captación".
--
-- Problema que cierra (E-GG-295): el edge vercel-trafico-snapshot trataba un
-- 402 de Vercel (dimensión UTM sin el add-on "Web Analytics Plus") como
-- desde_newsletter=0 EN SILENCIO. Si el add-on se cae, el panel mostraría "0"
-- como si fuera un cero real → mentira. Fix: desde_newsletter pasa a NULLABLE
-- (NULL = "no medible en esta corrida") y se agrega medicion_estado para
-- explicitar por qué. El edge guarda NULL+estado en 402/error, nunca un 0 falso.
--
-- Además, ahora el dispatcher etiqueta con UTM a TODO el marketing (captación,
-- ofrecimiento, engagement, además del newsletter), todos con utm_medium='email'.
-- Para medir ese universo se agrega desde_email (visitantes atribuidos a CUALQUIER
-- email de marketing). OJO: desde_newsletter y desde_email se calculan a NIVEL
-- PROYECTO (Vercel atribuye el UTM a la visita, no por ruta) y se guardan el MISMO
-- valor en ambas filas de superficie (landing y lexph). NO sumar desde_* entre
-- superficies (sería doble conteo); leer de una sola fila.

-- desde_newsletter: ahora puede ser NULL ("no medible"), ya no 0-por-defecto.
alter table public.vercel_trafico alter column desde_newsletter drop not null;
alter table public.vercel_trafico alter column desde_newsletter drop default;

-- Nueva métrica: visitas atribuidas a cualquier email de marketing (utm_medium='email').
alter table public.vercel_trafico add column if not exists desde_email int;

-- Estado de la medición UTM de esta corrida. Cuando != 'ok', las columnas
-- desde_* quedan en NULL (no se inventa un cero).
alter table public.vercel_trafico add column if not exists medicion_estado text not null default 'ok';

alter table public.vercel_trafico drop constraint if exists vercel_trafico_medicion_estado_chk;
alter table public.vercel_trafico add constraint vercel_trafico_medicion_estado_chk
  check (medicion_estado in ('ok', 'sin_addon', 'error'));

comment on column public.vercel_trafico.desde_newsletter is
  'Visitas con utm_source=newsletter en la ventana. NULL = no medible (ver medicion_estado). 0 = medido y cero.';
comment on column public.vercel_trafico.desde_email is
  'Visitas con utm_medium=email (cualquier campaña de marketing) en la ventana. NULL = no medible.';
comment on column public.vercel_trafico.medicion_estado is
  'ok = medición UTM válida (desde_* reales). sin_addon = Vercel devolvió 402 (Web Analytics Plus caído) → desde_* NULL. error = otra falla de la API → desde_* NULL. E-GG-295.';

-- GRANT: el SELECT a authenticated a nivel tabla (mig 0677) ya cubre las columnas nuevas.
