-- 0216 · F4 — fixes capitalizados de la DOBLE AUDITORÍA §6 (post live-test 3 roles).
-- ============================================================================
-- Hallazgos corregidos (ver knowledge-base/ERRORES.md E-GG-63):
--
--  C1 (CRÍTICA · privacidad cliente): la RLS de tracking_lineas tenía una policy
--      de SELECT del cliente (tl_admin_select) que NO filtraba `visible_cliente`,
--      y authenticated/anon tienen GRANT SELECT directo sobre la tabla. Un cliente
--      logueado podía SALTEAR la RPC `cliente_tracking_lineas` vía PostgREST
--      (/rest/v1/tracking_lineas?select=gestor_descripcion_original,descarte_motivo)
--      y leer, de SUS propios trámites, las filas 'interno'/'descartado'/'pendiente'
--      + el texto crudo del gestor + el motivo de descarte. Confirmado e2e
--      impersonando al cliente real: 4/4 filas (2 que no debía ver), 1 motivo.
--      F4 introdujo el concepto de filas ocultas → F4 debe taparlo.
--      FIX: el cliente lee los avances EXCLUSIVAMENTE por la RPC SECURITY DEFINER
--      `cliente_tracking_lineas` (filtra visible_cliente=true + tenancy); no existe
--      ningún `from('tracking_lineas')` de cliente en el front. Se ELIMINA la policy
--      de SELECT del cliente → sin lectura directa, no hay bypass. Gerencia
--      (tl_staff_all) y el INSERT del cliente (tl_admin_insert) quedan intactos.
--
--  A1 (bug menor): tracking_moderar_gestor_avance persistía `estado_asociado` en la
--      línea SIN validar contra el whitelist (publicar con p_estado_asociado='banana'
--      lo guardaba). FIX: validar el estado temprano + rechazar texto vacío al editar.
--
--  A2 (R11): la FK tracking_lineas.moderada_por no tenía índice → índice parcial.
--
--  D1: backfill de aportes de gestoría legacy (pre-F4: moderacion_estado NULL pero
--      ya visible_cliente=true) → 'publicado'. No cambia visibilidad (ya se veían);
--      sólo normaliza la etiqueta para consistencia con el nuevo modelo.
-- ============================================================================

-- C1 -------------------------------------------------------------------------
-- El cliente NO necesita lectura directa de tracking_lineas: el único camino
-- cliente es la RPC cliente_tracking_lineas (SECURITY DEFINER). Sin policy de
-- SELECT para el rol administrador, PostgREST deniega el acceso directo y se
-- cierra el bypass de las filas ocultas + columnas sensibles.
DROP POLICY IF EXISTS tl_admin_select ON public.tracking_lineas;

-- A1 -------------------------------------------------------------------------
-- Misma firma (uuid,text,text,text[],text,text) → CREATE OR REPLACE NO crea
-- overload (R16 OK). Sólo se agregan validaciones tempranas.
CREATE OR REPLACE FUNCTION public.tracking_moderar_gestor_avance(
  p_linea_id uuid,
  p_accion text,
  p_descripcion text DEFAULT NULL,
  p_archivos_urls text[] DEFAULT NULL,
  p_estado_asociado text DEFAULT NULL,
  p_motivo text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_linea public.tracking_lineas%ROWTYPE;
BEGIN
  IF NOT private.is_staff() THEN
    RAISE EXCEPTION 'Sólo gerencia puede moderar' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_linea FROM public.tracking_lineas WHERE id = p_linea_id;
  IF v_linea.id IS NULL THEN
    RAISE EXCEPTION 'Línea no encontrada' USING ERRCODE = 'P0002';
  END IF;
  IF v_linea.categoria <> 'gestor_avance' OR v_linea.moderacion_estado <> 'pendiente' THEN
    RAISE EXCEPTION 'La línea no está pendiente de moderación' USING ERRCODE = '22023';
  END IF;

  -- (A1) Validar estado asociado contra el whitelist ANTES de persistir nada:
  -- antes se escribía en la línea sin validar (sólo el cambio de tramites.estado
  -- filtraba), dejando pasar labels basura como 'banana'.
  IF p_estado_asociado IS NOT NULL
     AND p_estado_asociado NOT IN ('abierto','en_progreso','esperando_cliente','resuelto','cerrado','cancelado') THEN
    RAISE EXCEPTION 'Estado asociado inválido: %', p_estado_asociado USING ERRCODE = '22023';
  END IF;
  -- (A1) No permitir blanquear el texto al editar (el cliente vería un avance vacío).
  IF p_descripcion IS NOT NULL AND trim(p_descripcion) = '' THEN
    RAISE EXCEPTION 'La descripción no puede quedar vacía' USING ERRCODE = '22023';
  END IF;

  -- Edición de texto/adjuntos (b) — aplica a publicar e interno.
  IF p_descripcion IS NOT NULL THEN
    UPDATE public.tracking_lineas SET descripcion = trim(p_descripcion) WHERE id = p_linea_id;
  END IF;
  IF p_archivos_urls IS NOT NULL THEN
    UPDATE public.tracking_lineas SET archivos_urls = p_archivos_urls WHERE id = p_linea_id;
  END IF;

  IF p_accion = 'publicar' THEN
    UPDATE public.tracking_lineas
       SET visible_cliente = true, moderacion_estado = 'publicado',
           estado_asociado = COALESCE(p_estado_asociado, estado_asociado),
           moderada_at = now(), moderada_por = auth.uid()
     WHERE id = p_linea_id;
    -- (c) cambio de estado del trámite (p_estado_asociado ya validado arriba)
    IF p_estado_asociado IS NOT NULL THEN
      UPDATE public.tramites SET estado = p_estado_asociado, ultima_actividad_at = now()
       WHERE id = v_linea.tramite_id;
    END IF;
    -- notificar al cliente (recién ahora)
    PERFORM private.tracking_notificar_avance_cliente(p_linea_id);

  ELSIF p_accion = 'interno' THEN
    UPDATE public.tracking_lineas
       SET visible_cliente = false, moderacion_estado = 'interno',
           moderada_at = now(), moderada_por = auth.uid()
     WHERE id = p_linea_id;

  ELSIF p_accion = 'descartar' THEN
    UPDATE public.tracking_lineas
       SET visible_cliente = false, moderacion_estado = 'descartado',
           descarte_motivo = NULLIF(trim(COALESCE(p_motivo, '')), ''),
           moderada_at = now(), moderada_por = auth.uid()
     WHERE id = p_linea_id;

  ELSE
    RAISE EXCEPTION 'Acción inválida: %', p_accion USING ERRCODE = '22023';
  END IF;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.tracking_moderar_gestor_avance(uuid, text, text, text[], text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tracking_moderar_gestor_avance(uuid, text, text, text[], text, text) TO authenticated;

-- A2 -------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_tracking_lineas_moderada_por
  ON public.tracking_lineas(moderada_por) WHERE moderada_por IS NOT NULL;

-- D1 -------------------------------------------------------------------------
UPDATE public.tracking_lineas
   SET moderacion_estado = 'publicado'
 WHERE categoria = 'gestor_avance'
   AND moderacion_estado IS NULL
   AND visible_cliente = true;

-- R18 · el e2e mutante (carga→publicar/interno/descartar + validaciones A1 +
-- verificación del cierre del leak C1) se corre post-apply vía execute_sql con
-- BEGIN/ROLLBACK impersonando gerente y cliente (queda registrado en la sesión
-- de cierre §6). No se embebe smoke con fixtures sintéticos acá para no disparar
-- las notificaciones a gerentes reales del trigger de gestor_avance.
