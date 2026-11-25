-- 0727 · Gate híbrido SES (Ángulo 5 · seguridad) — least-privilege sobre la red de opt-out GLOBAL.
--
-- Hallazgo de la auditoría integral: public.email_suppression otorgaba a `authenticated`
-- TRUNCATE (+ REFERENCES, TRIGGER). TRUNCATE **ignora RLS** → un vaciado de la tabla
-- reabriría el envío a TODOS los que rebotaron/se dieron de baja (daño reputacional/legal).
-- NO alcanzable hoy (PostgREST no expone TRUNCATE; anon sin grant; RLS staff-only para DML),
-- pero viola "permisos mínimos" (gate pt.8) y el propio precedente del equipo (mig 0503).
-- Se conservan SELECT/INSERT/UPDATE/DELETE (gated por la policy is_staff()).

revoke truncate, references, trigger on public.email_suppression from authenticated;
