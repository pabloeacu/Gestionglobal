-- 0506 · §6 hardening (Agent B-D / Agent C-#9): el helper de elegibilidad es SECURITY DEFINER
-- sin guarda de tenencia y quedaba EXECUTE a PUBLIC (default). No explotable vía REST (PostgREST
-- no expone `private`), pero belt-and-suspenders R12: se revoca de PUBLIC. Los wrappers
-- (gg_ofrecimientos_diario / gg_ofrecimientos_preview) son SECURITY DEFINER owned by postgres →
-- llaman al helper como owner y NO necesitan el grant (verificado: el preview sigue OK tras el revoke).
REVOKE ALL ON FUNCTION private.gg_ofrecimiento_elegible(uuid, text, date) FROM PUBLIC;
