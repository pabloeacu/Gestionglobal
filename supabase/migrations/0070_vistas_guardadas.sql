-- ============================================================================
-- 0070_vistas_guardadas · DGG-37 / P2-#26
--
-- Filtros guardados por usuario y por módulo. Permite al gerente armar
-- "Mis vistas" — combos de filtros nombrados, con opción a marcar uno
-- como default que se aplica automáticamente al entrar al listado.
--
-- Tabla:
--   • user_id + modulo + nombre = único (no permite duplicar nombre dentro
--     de un mismo módulo del mismo user).
--   • filtros = jsonb arbitrario (forma libre · cada listado define su shape).
--   • es_default = sólo UNO por (user, módulo) — partial unique index.
--
-- RPCs SECURITY DEFINER:
--   • vistas_listar(modulo)
--   • vistas_guardar(modulo, nombre, filtros, es_default) — upsert por (u,m,n)
--   • vistas_borrar(id)
--   • vistas_set_default(id)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.vistas_guardadas (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  modulo      text NOT NULL,
  nombre      text NOT NULL,
  filtros     jsonb NOT NULL DEFAULT '{}'::jsonb,
  es_default  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, modulo, nombre)
);

CREATE INDEX IF NOT EXISTS idx_vistas_user_modulo
  ON public.vistas_guardadas(user_id, modulo, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_vistas_default
  ON public.vistas_guardadas(user_id, modulo)
  WHERE es_default;

ALTER TABLE public.vistas_guardadas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vistas_owner_all ON public.vistas_guardadas;
CREATE POLICY vistas_owner_all ON public.vistas_guardadas
  FOR ALL USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.vistas_listar(p_modulo text)
RETURNS TABLE(id uuid, nombre text, filtros jsonb, es_default boolean, created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT v.id, v.nombre, v.filtros, v.es_default, v.created_at
  FROM public.vistas_guardadas v
  WHERE v.user_id = auth.uid() AND v.modulo = p_modulo
  ORDER BY v.es_default DESC, v.created_at DESC;
$$;

CREATE OR REPLACE FUNCTION public.vistas_guardar(
  p_modulo text, p_nombre text, p_filtros jsonb, p_es_default boolean DEFAULT false
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  IF p_es_default THEN
    UPDATE public.vistas_guardadas SET es_default = false
     WHERE user_id = auth.uid() AND modulo = p_modulo AND es_default;
  END IF;
  INSERT INTO public.vistas_guardadas(user_id, modulo, nombre, filtros, es_default)
  VALUES (auth.uid(), p_modulo, p_nombre, COALESCE(p_filtros, '{}'::jsonb), p_es_default)
  ON CONFLICT (user_id, modulo, nombre) DO UPDATE
    SET filtros = EXCLUDED.filtros,
        es_default = EXCLUDED.es_default,
        updated_at = now()
  RETURNING id INTO v_id;
  RETURN v_id;
END; $$;

CREATE OR REPLACE FUNCTION public.vistas_borrar(p_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  DELETE FROM public.vistas_guardadas WHERE id = p_id AND user_id = auth.uid();
  RETURN FOUND;
END; $$;

CREATE OR REPLACE FUNCTION public.vistas_set_default(p_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_modulo text;
BEGIN
  SELECT modulo INTO v_modulo FROM public.vistas_guardadas
   WHERE id = p_id AND user_id = auth.uid();
  IF v_modulo IS NULL THEN RAISE EXCEPTION 'Vista no encontrada'; END IF;
  UPDATE public.vistas_guardadas SET es_default = false
   WHERE user_id = auth.uid() AND modulo = v_modulo;
  UPDATE public.vistas_guardadas SET es_default = true, updated_at = now()
   WHERE id = p_id;
  RETURN TRUE;
END; $$;

GRANT EXECUTE ON FUNCTION public.vistas_listar(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.vistas_guardar(text, text, jsonb, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.vistas_borrar(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.vistas_set_default(uuid) TO authenticated;
