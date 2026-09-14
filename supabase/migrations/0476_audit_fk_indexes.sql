-- 0476 · Auditoría 2026-09 · MEJORA (R11): índices faltantes en FKs.
--
-- El advisor de performance (unindexed_foreign_keys) marcó 4 FKs sin índice de
-- soporte en su columna origen. Postgres NO crea índices para FKs automáticamente;
-- sin ellos, los DELETE/UPDATE en la tabla padre y los JOINs por la FK hacen seq
-- scan. Hoy las 4 tablas hijas son chicas (≤24 kB, ≤14 filas) → CREATE INDEX es
-- instantáneo y no bloquea nada relevante (no hace falta CONCURRENTLY). Es puramente
-- aditivo: no cambia lógica, datos ni comportamiento; sólo agrega estructura de
-- acceso. Cumple R11 ("toda FK debe tener su índice").
--
-- FKs cubiertas:
--   solicitud_derivaciones.caja_id              -> cajas
--   solicitud_derivaciones.categoria_finanzas_id-> categorias_finanzas
--   movimiento_adjuntos.subido_por              -> profiles
--   disertantes.created_by                      -> auth.users

CREATE INDEX IF NOT EXISTS idx_solicitud_derivaciones_caja_id
  ON public.solicitud_derivaciones (caja_id);

CREATE INDEX IF NOT EXISTS idx_solicitud_derivaciones_categoria_finanzas_id
  ON public.solicitud_derivaciones (categoria_finanzas_id);

CREATE INDEX IF NOT EXISTS idx_movimiento_adjuntos_subido_por
  ON public.movimiento_adjuntos (subido_por);

CREATE INDEX IF NOT EXISTS idx_disertantes_created_by
  ON public.disertantes (created_by);
