-- ============================================================================
-- 0182 · DGG-38 EXT · Cierre de trámite con motivo + satisfactorio + observaciones
--
-- José Luis (2026-06-02): el cierre debe poder ocurrir aunque NO haya
-- certificado, con motivos específicos según categoría. Resultados pueden
-- ser satisfactorios o frustrados, con observaciones que pasan a constituir
-- la última línea de tracking.
--
-- Cambios:
--   1. ALTER public.tramites: add `motivo_cierre text`,
--      `cierre_satisfactorio boolean` (NULL hasta que se cierre).
--   2. DROP+CREATE public.tracking_cerrar con firma extendida (R16):
--        (p_tramite_id, p_motivo_cierre, p_satisfactorio,
--         p_observaciones DEFAULT NULL, p_documento_final_url DEFAULT NULL).
--      El frontend pasa el motivo + observaciones + el doc opcional, y la
--      RPC se encarga de actualizar tramites + insertar línea automática
--      formateada como "Trámite cerrado: <motivo>. <observaciones>" con
--      estado_asociado = 'finalizado' (satisfactorio) o 'frustrado'
--      (no satisfactorio).
--   3. Actualizar trg_certificado_cierra_tramite_curso_fn para usar motivo
--      "Concluyó el curso" + satisfactorio=true.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- (1) Columnas nuevas en tramites
-- ----------------------------------------------------------------------------
ALTER TABLE public.tramites
  ADD COLUMN IF NOT EXISTS motivo_cierre text,
  ADD COLUMN IF NOT EXISTS cierre_satisfactorio boolean;

COMMENT ON COLUMN public.tramites.motivo_cierre IS
  'Etiqueta del motivo seleccionado al cerrar (DGG-38 EXT). Texto libre, '
  'pero el frontend ofrece un catálogo predeterminado según la categoría '
  '(curso → Concluyó / Abandonó / Desaprobó / Se arrepintió). NULL hasta '
  'el cierre.';
COMMENT ON COLUMN public.tramites.cierre_satisfactorio IS
  'Resultado del cierre. TRUE = trámite resuelto con éxito; FALSE = '
  'cerrado sin éxito (abandono, rechazo, etc.). NULL hasta el cierre.';

-- ----------------------------------------------------------------------------
-- (2) DROP firma vieja + CREATE firma nueva (R16)
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.tracking_cerrar(uuid, text);
DROP FUNCTION IF EXISTS public.tracking_cerrar(uuid, text, text, boolean, text);

CREATE FUNCTION public.tracking_cerrar(
  p_tramite_id          uuid,
  p_motivo_cierre       text,
  p_satisfactorio       boolean,
  p_observaciones       text DEFAULT NULL,
  p_documento_final_url text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_admin uuid;
  v_descripcion text;
  v_archivos text[];
  v_estado_linea text;
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Solo staff puede cerrar trámites' USING ERRCODE = '42501';
  END IF;

  SELECT administracion_id INTO v_admin FROM public.tramites WHERE id = p_tramite_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Trámite no encontrado' USING ERRCODE = 'P0002';
  END IF;

  IF p_motivo_cierre IS NULL OR length(trim(p_motivo_cierre)) = 0 THEN
    RAISE EXCEPTION 'El motivo de cierre es obligatorio' USING ERRCODE = '23502';
  END IF;
  IF p_satisfactorio IS NULL THEN
    RAISE EXCEPTION 'Debés indicar si el cierre fue satisfactorio o no' USING ERRCODE = '23502';
  END IF;

  -- Update trámite
  UPDATE public.tramites
    SET estado = 'cerrado',
        fecha_fin = CURRENT_DATE,
        documento_final_url = p_documento_final_url,
        motivo_cierre = p_motivo_cierre,
        cierre_satisfactorio = p_satisfactorio,
        resuelto_at = COALESCE(resuelto_at, now()),
        resuelto_por = COALESCE(resuelto_por, auth.uid()),
        ultima_actividad_at = now()
   WHERE id = p_tramite_id;

  -- Descripcion formateada de la línea final
  v_descripcion := 'Trámite cerrado: ' || p_motivo_cierre || '.';
  IF p_observaciones IS NOT NULL AND length(trim(p_observaciones)) > 0 THEN
    v_descripcion := v_descripcion || ' ' || trim(p_observaciones);
  END IF;

  -- archivos_urls: opcional, solo si vino el documento
  IF p_documento_final_url IS NOT NULL AND length(trim(p_documento_final_url)) > 0 THEN
    v_archivos := ARRAY[p_documento_final_url]::text[];
  ELSE
    v_archivos := '{}'::text[];
  END IF;

  v_estado_linea := CASE WHEN p_satisfactorio THEN 'finalizado' ELSE 'frustrado' END;

  -- Línea final automática del cierre
  INSERT INTO public.tracking_lineas (
    tramite_id, categoria, descripcion, estado_asociado, archivos_urls, autor_id, visible_cliente
  ) VALUES (
    p_tramite_id,
    CASE WHEN p_satisfactorio THEN 'certificado_emitido' ELSE 'cierre_frustrado' END,
    v_descripcion,
    v_estado_linea,
    v_archivos,
    auth.uid(),
    true
  );
END;
$function$;

COMMENT ON FUNCTION public.tracking_cerrar(uuid, text, boolean, text, text) IS
  'DGG-38 EXT (2026-06-02 · José Luis): cierre de trámite con motivo + '
  'satisfactorio + observaciones + documento opcional. Reemplaza la firma '
  'vieja tracking_cerrar(uuid, text). La línea final lleva descripcion = '
  '"Trámite cerrado: <motivo>. <observaciones>", estado_asociado = '
  '"finalizado" si satisfactorio o "frustrado" si no, y archivos_urls '
  'solo si el motivo justificaba adjuntar documento.';

-- ----------------------------------------------------------------------------
-- (3) Trigger auto-cierre cert Campus: usar motivo "Concluyó el curso"
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_certificado_cierra_tramite_curso_fn()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_submission_id uuid;
  v_tramite_id    uuid;
  v_url           text;
BEGIN
  SELECT submission_origen INTO v_submission_id
  FROM public.curso_matriculas WHERE id = NEW.matricula_id;

  IF v_submission_id IS NULL THEN RETURN NEW; END IF;

  SELECT id INTO v_tramite_id
  FROM public.tramites
  WHERE formulario_submission_id = v_submission_id
    AND categoria = 'curso'
    AND estado NOT IN ('cerrado', 'cancelado')
  ORDER BY created_at DESC LIMIT 1;

  IF v_tramite_id IS NULL THEN RETURN NEW; END IF;

  v_url := 'https://gestionglobal.ar/verificar/' || NEW.codigo;

  UPDATE public.tramites
     SET estado = 'cerrado',
         fecha_fin = CURRENT_DATE,
         documento_final_url = v_url,
         motivo_cierre = 'Concluyó el curso',         -- DGG-38 EXT
         cierre_satisfactorio = true,                  -- DGG-38 EXT
         resuelto_at = COALESCE(resuelto_at, now()),
         resuelto_por = COALESCE(resuelto_por, NULL),
         ultima_actividad_at = now()
   WHERE id = v_tramite_id;

  INSERT INTO public.tracking_lineas (
    tramite_id, categoria, descripcion, estado_asociado,
    archivos_urls, autor_id, visible_cliente
  ) VALUES (
    v_tramite_id,
    'certificado_emitido',
    'Trámite cerrado: Concluyó el curso. Aprobación exitosa con emisión de certificado.',
    'finalizado',
    ARRAY[v_url]::text[],
    NULL, true
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'trg_certificado_cierra_tramite_curso fallo: %', SQLERRM;
  RETURN NEW;
END;
$$;
