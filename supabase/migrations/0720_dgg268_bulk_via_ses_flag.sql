-- 0720 · DGG-268 F3 — kill-switch del carril SES para el marketing masivo.
-- Cuando ON (y hay credenciales IAM en los secrets de la edge dispatch-emails), el marketing
-- (allow-list marketingUtmFor: newsletter/captacion/federal/ofrecimiento/engagement) sale por
-- Amazon SES desde envios.gestionglobal.ar en vez de Gmail API. OFF por defecto (kill-switch).
-- NO prender sin pasar la auditoría integral obligatoria (knowledge-base/AUDITORIA_HIBRIDO_SES.md).

alter table public.config_global
  add column if not exists bulk_via_ses boolean not null default false;

comment on column public.config_global.bulk_via_ses is
  'DGG-268: cuando ON (y hay credenciales IAM en los secrets de la edge dispatch-emails), el marketing (allow-list marketingUtmFor: newsletter/captacion/federal/ofrecimiento/engagement) sale por Amazon SES desde envios.gestionglobal.ar en vez de Gmail API. OFF por defecto (kill-switch). No prender sin la auditoría integral obligatoria.';
