-- 0444_dgg142e4_f3_fechas_limite_y_push_cliente.sql
-- DGG-142 · Etapa 4 · F3 — Riel de FECHAS LÍMITE de la matriz DGG-143.
--
-- (1) `dispatch_vencimientos_log.canal` admite 'push_cliente' (canal nuevo).
-- (2) `vencimientos.tipo` admite 'curso_rpa_caba' (aniversario CABA). NOTA de
--     drift: el CHECK VIVO es ('renovacion_rpac','curso_actualizacion',
--     'ddjj_anual','otro') — distinto del archivo 0025; el sync de matrícula
--     usa el tipo vivo `renovacion_rpac`.
-- (3) Sync ficha → agenda: trigger sobre administraciones que mantiene UNA
--     fila `vencimientos` tipo 'renovacion_rpac' vigente espejando
--     `matricula_rpac_vencimiento`, con offsets {45,30,15} (matriz DGG-143).
--     Cambio de fecha → supersede ('renovado') + fila nueva. La Regla B
--     (trigger de cierre, 0439) actualiza la ficha → este trigger anida y la
--     agenda queda sincronizada sola en cada cierre de renovación.
-- (4) Switch `ofrecimientos_habilitados` → espeja `notificar_cliente` en las
--     filas vigentes de los tipos del motor.
-- (5) Backfill de las fichas que ya tienen fecha.
-- (6) `public.gg_notif_emitir_cliente` (SOLO service_role): wrapper de
--     `private.notif_emitir` para que la edge dispatch-vencimientos dé
--     campanita + push al CLIENTE (el pipeline existía; faltaba el acceso).

-- (1) ---------------------------------------------------------------------
ALTER TABLE public.dispatch_vencimientos_log
  DROP CONSTRAINT dispatch_vencimientos_log_canal_check;
ALTER TABLE public.dispatch_vencimientos_log
  ADD CONSTRAINT dispatch_vencimientos_log_canal_check
  CHECK (canal IS NULL OR canal IN ('push','email_cliente','push_cliente'));

-- (2) ---------------------------------------------------------------------
ALTER TABLE public.vencimientos DROP CONSTRAINT vencimientos_tipo_check;
ALTER TABLE public.vencimientos ADD CONSTRAINT vencimientos_tipo_check
  CHECK (tipo IN ('renovacion_rpac','curso_actualizacion','ddjj_anual','curso_rpa_caba','otro'));

-- (3) ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_admin_matricula_venc_sync_fn()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.matricula_rpac_vencimiento IS DISTINCT FROM OLD.matricula_rpac_vencimiento THEN
    -- Supersede: la fecha cambió (o se vació) → los vigentes previos del tipo
    -- pasan a 'renovado' (mismo patrón que tracking_cerrar_ciclo, 0441).
    UPDATE public.vencimientos
       SET estado = 'renovado'
     WHERE administracion_id = NEW.id
       AND tipo = 'renovacion_rpac'
       AND estado = 'vigente'
       AND (NEW.matricula_rpac_vencimiento IS NULL
            OR fecha_vencimiento <> NEW.matricula_rpac_vencimiento);

    IF NEW.matricula_rpac_vencimiento IS NOT NULL THEN
      INSERT INTO public.vencimientos
        (tipo, sujeto, sujeto_id, administracion_id, fecha_vencimiento,
         fecha_emision, descripcion, estado, alarmas_offsets, notificar_cliente)
      SELECT 'renovacion_rpac', 'administracion', NEW.id, NEW.id,
             NEW.matricula_rpac_vencimiento,
             (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date,
             'Vencimiento de matrícula RPAC', 'vigente',
             '{45,30,15}'::int[], COALESCE(NEW.ofrecimientos_habilitados, true)
      WHERE NOT EXISTS (
        SELECT 1 FROM public.vencimientos
        WHERE administracion_id = NEW.id AND tipo = 'renovacion_rpac'
          AND estado = 'vigente'
          AND fecha_vencimiento = NEW.matricula_rpac_vencimiento
      );
    END IF;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'trg_admin_matricula_venc_sync fallo admin=%: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_admin_matricula_venc_sync ON public.administraciones;
CREATE TRIGGER trg_admin_matricula_venc_sync
  AFTER INSERT OR UPDATE OF matricula_rpac_vencimiento ON public.administraciones
  FOR EACH ROW EXECUTE FUNCTION public.trg_admin_matricula_venc_sync_fn();

-- (4) ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_admin_ofrecimientos_switch_fn()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NEW.ofrecimientos_habilitados IS DISTINCT FROM OLD.ofrecimientos_habilitados THEN
    UPDATE public.vencimientos
       SET notificar_cliente = NEW.ofrecimientos_habilitados
     WHERE administracion_id = NEW.id
       AND tipo IN ('renovacion_rpac','curso_rpa_caba')
       AND estado = 'vigente';
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'trg_admin_ofrecimientos_switch fallo admin=%: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_admin_ofrecimientos_switch ON public.administraciones;
CREATE TRIGGER trg_admin_ofrecimientos_switch
  AFTER UPDATE OF ofrecimientos_habilitados ON public.administraciones
  FOR EACH ROW EXECUTE FUNCTION public.trg_admin_ofrecimientos_switch_fn();

-- (5) Backfill de fichas con fecha ya cargada ------------------------------
INSERT INTO public.vencimientos
  (tipo, sujeto, sujeto_id, administracion_id, fecha_vencimiento,
   fecha_emision, descripcion, estado, alarmas_offsets, notificar_cliente)
SELECT 'renovacion_rpac', 'administracion', a.id, a.id,
       a.matricula_rpac_vencimiento,
       (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date,
       'Vencimiento de matrícula RPAC', 'vigente',
       '{45,30,15}'::int[], a.ofrecimientos_habilitados
FROM public.administraciones a
WHERE a.matricula_rpac_vencimiento IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.vencimientos v
    WHERE v.administracion_id = a.id AND v.tipo = 'renovacion_rpac'
      AND v.estado = 'vigente'
      AND v.fecha_vencimiento = a.matricula_rpac_vencimiento
  );

-- (6) ---------------------------------------------------------------------
CREATE FUNCTION public.gg_notif_emitir_cliente(
  p_user uuid, p_titulo text, p_cuerpo text, p_url text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF p_user IS NULL THEN RETURN; END IF;
  PERFORM private.notif_emitir(p_user, 'ofrecimiento', p_titulo, p_cuerpo, p_url, '{}'::jsonb);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.gg_notif_emitir_cliente(uuid, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gg_notif_emitir_cliente(uuid, text, text, text)
  TO service_role;
