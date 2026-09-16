-- 0493 · Fase A · Etapa 3: quitar EXECUTE a anon de 6 funciones que son de gerencia/authenticated pero
-- quedaron alcanzables por anon (default Supabase). Todas tienen guard de rol (is_staff/auth.uid), así que
-- anon ya no podía hacer daño, pero se reduce la superficie (defensa en profundidad). El front las llama como
-- authenticated (gerencia/campus logueado), que NO se toca → cero impacto funcional. No son flujos anónimos
-- ni con token (verificado en §6: sólo se invocan desde src/services/api/* en superficies logueadas).
REVOKE EXECUTE ON FUNCTION public.arca_emisor_default() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.arca_emisor_set_default(p_emisor_id uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.curso_encuentro_registrar_acceso(p_encuentro_id uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.db_health_metrics() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.solicitud_pedir_docs_revision(p_solicitud_id uuid, p_mensaje text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.tracking_reenviar_avance_cliente(p_linea_id uuid) FROM PUBLIC, anon;
