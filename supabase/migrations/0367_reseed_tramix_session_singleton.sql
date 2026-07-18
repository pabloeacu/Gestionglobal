-- 0367 · re-seed del singleton de tramix_session (hallazgo crítico de la
-- auditoría post-purga DGG-111). La purga vació la tabla y el edge fn
-- tramix-consulta renovaba la cookie con UPDATE ... WHERE id='singleton'
-- (0 filas afectadas en silencio) → cada consulta TRAMIX re-establecía la
-- sesión completa contra el sitio del gobierno, anulando el diseño
-- anti-martilleo. Se re-siembra la fila y las edge fns tramix-consulta /
-- tramix-doc-proxy pasan a upsert (auto-sanantes, mismo patrón que
-- tramix_gate / tramix_throttle).
INSERT INTO public.tramix_session (id) VALUES ('singleton')
ON CONFLICT (id) DO NOTHING;
