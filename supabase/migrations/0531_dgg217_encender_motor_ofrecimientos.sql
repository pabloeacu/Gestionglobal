-- 0531_dgg217_encender_motor_ofrecimientos.sql
-- DGG-217 · ENCENDIDO DEFINITIVO del motor de ofrecimientos (Pablo: "Encendé el
-- motor! Activemos todo!"), ahora sobre DATOS REALES (backfill DGG-216: de 9 a
-- 113 clientes con vencimiento real → el motor manda recordatorios regulatorios
-- útiles, no publicidad).
--
-- Mecanismo: la cron pasa de la variante SOMBRA (simula, no envía) a la REAL.
--   gg_ofrecimientos_diario() = sender real (email + push + banner vía
--   _gg_ofrecimiento_tocar). Auto-paceado: tope 40 toques/día, gracia 7 días
--   (1 toque por cliente por semana), cooldown por regla, prioridad
--   matriculación > DDJJ > curso > renovación > certificado > consultoría.
--   Respeta administraciones.ofrecimientos_habilitados.
--
-- Dry-run previo (BEGIN/ROLLBACK, nada enviado) de la 1ª jornada: 40 toques =
--   12 renovación + 6 matriculación (regulatorio) + 16 certificado + 6 consultoría.
--
-- GATE DGG-199 satisfecho por autorización explícita y enfática de Pablo.
-- Para PAUSAR en cualquier momento: SELECT cron.unschedule('gg-ofrecimientos-real');

SELECT cron.unschedule('gg-ofrecimientos-sombra');
SELECT cron.schedule('gg-ofrecimientos-real', '0 12 * * *', 'SELECT public.gg_ofrecimientos_diario();');
