-- 0307 · Cierre §6 Etapa B (hallazgo Agente B #21, R11) · índice faltante en la FK
-- `webinar_inscriptos.profile_id`. Postgres NO crea índices para FKs (regla 11).
-- Impacto real bajo (el loop de emisión y los joins filtran primero por
-- `webinar_id`, que sí está indexado), pero cerramos la deuda de R11 para que
-- los lookups por cliente (p. ej. "mis eventos" del portal, o el match
-- cert↔inscripto por profile_id) no escaneen. Parcial: sólo filas con profile.
CREATE INDEX IF NOT EXISTS idx_webinar_inscriptos_profile
  ON public.webinar_inscriptos (profile_id)
  WHERE profile_id IS NOT NULL;
