-- ============================================================================
-- Migration: 0123_frases_dia_schema_dispatch
-- Fecha: 2026-05-28
-- Frase del día — push + campanita para TODOS los usuarios activos,
-- cíclico por mes_dia (DD/MM). Cron diario 08:00 ART (11:00 UTC).
-- Cumple regla 2 (RLS), regla 5 (RPC SECURITY DEFINER), regla 6 (versionada).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Catálogo de frases (clave cíclica DD/MM, igual al Excel original)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.frases_diarias (
  mes_dia text PRIMARY KEY,                      -- 'DD/MM'
  frase   text NOT NULL,
  autor   text
);

ALTER TABLE public.frases_diarias ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS frases_read_all ON public.frases_diarias;
CREATE POLICY frases_read_all ON public.frases_diarias
  FOR SELECT TO authenticated USING (true);

-- ---------------------------------------------------------------------------
-- 2. Log diario para evitar doble envío si el cron se reintenta
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.frases_dispatch_log (
  fecha          date PRIMARY KEY,
  mes_dia        text NOT NULL,
  total_users    integer NOT NULL,
  dispatched_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 3. RPC dispatcher — encolará campanita + push para todos los activos
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.dispatch_frase_dia()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_mes_dia text;
  v_frase   text;
  v_autor   text;
  v_count   int := 0;
  v_user_id uuid;
BEGIN
  -- Idempotencia: si ya se disparó hoy, salimos
  IF EXISTS (SELECT 1 FROM public.frases_dispatch_log WHERE fecha = CURRENT_DATE) THEN
    RETURN 0;
  END IF;

  v_mes_dia := to_char(CURRENT_DATE, 'DD/MM');

  SELECT frase, autor
    INTO v_frase, v_autor
    FROM public.frases_diarias
   WHERE mes_dia = v_mes_dia;

  IF v_frase IS NULL THEN
    RAISE NOTICE 'dispatch_frase_dia: no hay frase para %', v_mes_dia;
    RETURN 0;
  END IF;

  FOR v_user_id IN
    SELECT id FROM public.profiles WHERE activo = true
  LOOP
    BEGIN
      -- Campanita (in-app)
      INSERT INTO public.notificaciones_internas
        (user_id, tipo, titulo, cuerpo, url, payload)
      VALUES
        (v_user_id,
         'frase_dia',
         'Frase del día',
         v_frase || COALESCE(' — ' || v_autor, ''),
         NULL,
         jsonb_build_object('mes_dia', v_mes_dia, 'autor', v_autor));

      -- Push web (la edge function drena la cola)
      INSERT INTO public.push_notifications_queue
        (user_id, titulo, cuerpo, click_url)
      VALUES
        (v_user_id,
         'Frase del día',
         v_frase || COALESCE(' — ' || v_autor, ''),
         NULL);

      v_count := v_count + 1;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'dispatch_frase_dia: error user=%: %', v_user_id, SQLERRM;
    END;
  END LOOP;

  INSERT INTO public.frases_dispatch_log (fecha, mes_dia, total_users)
    VALUES (CURRENT_DATE, v_mes_dia, v_count);

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION private.dispatch_frase_dia() FROM public;

-- ---------------------------------------------------------------------------
-- 4. Cron 08:00 ART = 11:00 UTC, todos los días
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'dispatch_frase_dia') THEN
    PERFORM cron.schedule(
      'dispatch_frase_dia',
      '0 11 * * *',
      $cron$SELECT private.dispatch_frase_dia();$cron$
    );
  END IF;
END $$;
