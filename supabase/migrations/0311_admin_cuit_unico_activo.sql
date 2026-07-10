-- 0311 · Reporte JL (punto 2, decisión Pablo "una persona = una cuenta por CUIT").
-- Enforcement sistémico a nivel BD: un CUIT (normalizado) sólo puede tener UNA
-- administración activa. Backstop de cualquier vía (solicitud_activar, import,
-- alta directa) contra la duplicación por "misma persona, otro email". Parcial:
-- sólo activas + con CUIT de 11 dígitos (los duplicados viejos de Lucía tienen
-- cuit NULL → excluidos, no rompen, respetando "prevenir nuevos" de Pablo).
CREATE UNIQUE INDEX IF NOT EXISTS uq_admin_cuit_activo
  ON public.administraciones (regexp_replace(cuit, '[^0-9]', '', 'g'))
  WHERE activo AND cuit IS NOT NULL
    AND length(regexp_replace(cuit, '[^0-9]', '', 'g')) = 11;
