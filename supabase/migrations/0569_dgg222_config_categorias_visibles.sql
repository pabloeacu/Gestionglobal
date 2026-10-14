-- 0569_dgg222_config_categorias_visibles.sql
-- =============================================================================
-- DGG-222 · Pulido del portal: config para las 3 categorías VISIBLES AL CLIENTE
-- que no la tenían y mostraban el slug crudo (p.ej. "pendiente_revision",
-- "aprobado", "resuelto") en el portal y la gerencia. Sólo datos de presentación
-- (label/icono/color globales) — cero cambio de lógica. Idempotente.
--   · pendiente_revision : "Cliente envió N archivo(s) para revisión" → en revisión.
--   · aprobado           : "Documentación aprobada · …" → positivo.
--   · resuelto           : "Tu trámite fue resuelto." → hito positivo.
-- Íconos dentro del ICON_MAP (file-check/user-clock) y colores soportados
-- (emerald/amber/cyan). Labels ajustables por gerencia (copy de config).
-- =============================================================================
INSERT INTO public.tracking_categorias_config (servicio_id, slug, label, icono, color, orden)
SELECT NULL, v.slug, v.label, v.icono, v.color, v.orden
FROM (VALUES
  ('pendiente_revision', 'Documentación en revisión', 'user-clock', 'amber',   40::smallint),
  ('aprobado',           'Documentación aprobada',    'file-check', 'emerald', 60::smallint),
  ('resuelto',           'Trámite resuelto',          'file-check', 'cyan',    105::smallint)
) AS v(slug, label, icono, color, orden)
WHERE NOT EXISTS (
  SELECT 1 FROM public.tracking_categorias_config cc
  WHERE cc.slug = v.slug AND cc.servicio_id IS NULL
);
