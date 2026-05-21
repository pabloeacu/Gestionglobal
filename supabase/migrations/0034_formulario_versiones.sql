-- 0034_formulario_versiones · snapshots de schema antes de cada save
-- Permite "deshacer" cambios sin romper submissions previas (que mantienen
-- referencia al formulario_id pero al schema vigente al momento del envío).
-- Regla 11: índice sobre la FK; regla 5: trigger en plpgsql con search_path.

CREATE TABLE IF NOT EXISTS public.formulario_versiones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  formulario_id uuid NOT NULL REFERENCES public.formularios(id) ON DELETE CASCADE,
  version_num int NOT NULL,
  schema jsonb NOT NULL,
  guardado_por uuid REFERENCES auth.users(id),
  guardado_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(formulario_id, version_num)
);

CREATE INDEX IF NOT EXISTS idx_formulario_versiones_formulario
  ON public.formulario_versiones(formulario_id, version_num DESC);

ALTER TABLE public.formularios
  ADD COLUMN IF NOT EXISTS version_actual int NOT NULL DEFAULT 1;

-- Trigger BEFORE UPDATE: si cambió el schema, snapshotea el VIEJO en
-- formulario_versiones bajo version_actual y bumpea version_actual en +1.
CREATE OR REPLACE FUNCTION public.formulario_versionado()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.schema IS DISTINCT FROM NEW.schema THEN
    INSERT INTO public.formulario_versiones (
      formulario_id, version_num, schema, guardado_por
    )
    VALUES (
      OLD.id, COALESCE(OLD.version_actual, 1), OLD.schema, auth.uid()
    )
    ON CONFLICT (formulario_id, version_num) DO NOTHING;
    NEW.version_actual := COALESCE(OLD.version_actual, 1) + 1;
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_formulario_versionado ON public.formularios;
CREATE TRIGGER trg_formulario_versionado
  BEFORE UPDATE ON public.formularios
  FOR EACH ROW EXECUTE FUNCTION public.formulario_versionado();

-- RLS: gerencia/operador full; sin acceso anon.
ALTER TABLE public.formulario_versiones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS formulario_versiones_staff_all ON public.formulario_versiones;
CREATE POLICY formulario_versiones_staff_all ON public.formulario_versiones
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role IN ('gerente','operador')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role IN ('gerente','operador')
    )
  );

-- RPC para restaurar una versión: copia el schema de la versión seleccionada
-- al formulario (lo que dispara el trigger y crea otro snapshot del estado
-- previo, así nunca se pierde nada).
CREATE OR REPLACE FUNCTION public.restaurar_formulario_version(
  p_formulario_id uuid,
  p_version_num int
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role text;
  v_schema jsonb;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF v_role NOT IN ('gerente','operador') THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  SELECT schema INTO v_schema
  FROM public.formulario_versiones
  WHERE formulario_id = p_formulario_id AND version_num = p_version_num;

  IF v_schema IS NULL THEN
    RAISE EXCEPTION 'Versión no encontrada';
  END IF;

  UPDATE public.formularios
    SET schema = v_schema
    WHERE id = p_formulario_id;

  RETURN p_formulario_id;
END
$$;

GRANT EXECUTE ON FUNCTION public.restaurar_formulario_version(uuid, int)
  TO authenticated;
