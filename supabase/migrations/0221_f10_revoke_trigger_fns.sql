-- F10 §6 (hallazgo backend #7c): las funciones de trigger de la mig 0220 quedaron
-- ejecutables por anon/authenticated (sus hermanas de la familia condición/cert
-- sí están revocadas). Explotabilidad nula (Postgres bloquea funciones de trigger
-- fuera de contexto con 0A000), pero R7/convención local. Revocadas.
REVOKE EXECUTE ON FUNCTION public.tg_asistencia_recompute() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_encuentro_cond_recompute() FROM PUBLIC, anon, authenticated;
