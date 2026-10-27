-- 0595_dgg231_hardening_s6.sql
-- =====================================================================
-- DGG-231 · hardening capitalizado de la doble auditoría §6 (3 agentes).
-- Fixes (ninguno toca el blindaje DGG-226 ni el motor TRAMIX/ofrecimientos):
--   B1 · REVOKE authenticated de gg_perfil_declarado_materializar_diario (el
--        REVOKE de 0594 nombró PUBLIC/anon pero NO authenticated → quedaba
--        ejecutable por cualquier logueado; default-privileges de public).
--   B2 · proximos_vencimientos EXCLUYE origen='declarado' (los recordatorios
--        declarados del cliente NO deben aparecer/contar en la grilla de gerencia;
--        el edge ya suprimía el push al gerente, pero el read-path no filtraba).
--   B4 · el materializador también retira la renovación declarada cuando hay un
--        TRÁMITE de renovación EN CURSO con GG (paridad con el gate oficial).
--   A2 · vía `cliente_confirmar_vencimiento_matricula` (FormularioRunner): el
--        cliente confirma su venc por formulario → administraciones.matricula_rpac_
--        vencimiento (certeza='declarado') → trigger crea renovacion_rpac → DGG-226
--        lo GATEA (sin TRAMIX fresco) = 0 avisos oficiales, y el guard v_oficial
--        suprimía la declarada = 0 avisos totales. Fix: una fila renovacion_rpac
--        "cubre" a la declarada SÓLO si el venc de matrícula es OFICIAL
--        (certeza='confirmado'); si es declarado por el cliente, la declarada
--        materializa y avisa con voz "según tus datos". El blindaje queda intacto
--        (la oficial sigue gateada/silenciosa; no hay doble aviso).
--   B5 · COMMENT de la tabla vencimientos (quedó stale: ya no es "SOLO servicios").
--   #7 · plantilla declarada: la línea del legajo prometía "verificar" DDJJ/curso/
--        certificado, donde el legajo (matrícula) no aplica → se ata a la matrícula.
-- Ver DGG-231 / ERRORES E-GG (si se documenta) / la doble auditoría §6.
-- =====================================================================

-- ---------------------------------------------------------------------
-- B1 · lockdown del materializador diario a service_role (como sus hermanas)
-- ---------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.gg_perfil_declarado_materializar_diario() FROM authenticated;

-- ---------------------------------------------------------------------
-- B2 · proximos_vencimientos (grilla/widget de gerencia) excluye declaradas.
--      CREATE OR REPLACE — misma firma/retorno (R16 ok). Sólo se agrega el filtro.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.proximos_vencimientos(p_administracion_id uuid DEFAULT NULL::uuid, p_dias smallint DEFAULT 90)
 RETURNS TABLE(id uuid, tipo text, sujeto text, sujeto_id uuid, administracion_id uuid, administracion_nombre text, consorcio_id uuid, consorcio_nombre text, fecha_vencimiento date, fecha_emision date, dias_restantes integer, descripcion text, observaciones text, estado text, sugerencia_servicio_slug text, alerta_30d_enviada timestamp with time zone, alerta_20d_enviada timestamp with time zone, alerta_10d_enviada timestamp with time zone, tracking_id uuid, pausado_at timestamp with time zone, motivo_pausa text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET "TimeZone" TO 'America/Argentina/Buenos_Aires'
AS $function$
DECLARE
  v_admin_filter uuid := p_administracion_id;
BEGIN
  IF NOT private.is_staff() THEN
    v_admin_filter := private.current_administracion_id();
    IF v_admin_filter IS NULL THEN
      RAISE EXCEPTION 'Sin administración asociada' USING ERRCODE = '42501';
    END IF;
  ELSIF p_administracion_id IS NOT NULL THEN
    PERFORM private.assert_administracion_access(p_administracion_id);
  END IF;

  RETURN QUERY
  SELECT
    v.id, v.tipo, v.sujeto, v.sujeto_id,
    v.administracion_id, a.nombre AS administracion_nombre,
    v.consorcio_id, c.nombre AS consorcio_nombre,
    v.fecha_vencimiento, v.fecha_emision,
    (v.fecha_vencimiento - CURRENT_DATE)::int AS dias_restantes,
    v.descripcion, v.observaciones, v.estado,
    COALESCE(cfg_override.sugerencia_servicio_slug, cfg_global.sugerencia_servicio_slug),
    v.alerta_30d_enviada, v.alerta_20d_enviada, v.alerta_10d_enviada,
    v.tracking_id,
    v.pausado_at, v.motivo_pausa
  FROM public.vencimientos v
  JOIN public.administraciones a ON a.id = v.administracion_id
  LEFT JOIN public.consorcios c ON c.id = v.consorcio_id
  LEFT JOIN public.vencimientos_config cfg_override
    ON cfg_override.administracion_id = v.administracion_id
   AND cfg_override.tipo = v.tipo
  LEFT JOIN public.vencimientos_config cfg_global
    ON cfg_global.administracion_id IS NULL
   AND cfg_global.tipo = v.tipo
  WHERE v.estado IN ('vigente','vencido')
    AND COALESCE(v.origen,'') <> 'declarado'   -- DGG-231: declaradas van a la ficha del cliente, no a gerencia
    AND v.fecha_vencimiento <= CURRENT_DATE + p_dias
    AND (v_admin_filter IS NULL OR v.administracion_id = v_admin_filter)
  ORDER BY v.fecha_vencimiento ASC, v.id;
END;
$function$;

-- ---------------------------------------------------------------------
-- B4 + A2 · materializador: ajuste del guard de cobertura (v_oficial).
--   CREATE OR REPLACE — misma firma (R16 ok).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.perfil_declarado_sync_venc(p_admin uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v jsonb;
  v_no_req jsonb;
  r record;
  v_renov_en_curso boolean;   -- B4: trámite de renovación abierto con GG
  v_matric_venc_cert text;    -- A2: certeza del venc autoritativo de matrícula
BEGIN
  v := private.perfil_regulatorio_calc(p_admin);
  v_no_req := COALESCE(v->'no_requiere', '{}'::jsonb);

  v_renov_en_curso := EXISTS (
    SELECT 1 FROM public.tramites t
    WHERE t.administracion_id = p_admin
      AND t.categoria = 'renovacion'
      AND t.estado IN ('abierto','en_progreso','esperando_cliente'));
  SELECT a.matricula_rpac_vencimiento_certeza INTO v_matric_venc_cert
    FROM public.administraciones a WHERE a.id = p_admin;

  FOR r IN
    SELECT * FROM (VALUES
      ('renovacion_matricula_declarada'::text, 'proxima_renovacion'::text, 'renovacion'::text,          ARRAY['renovacion_rpac']::text[]),
      ('ddjj_anual_declarada',                 'proxima_ddjj',             'ddjj',                       ARRAY['ddjj_anual']::text[]),
      ('curso_actualizacion_declarado',        'proximo_curso_actualizacion', 'curso_actualizacion',     ARRAY['curso_actualizacion','curso_rpa_caba']::text[]),
      ('certificado_declarado',                'proximo_certificado',      'certificado',                ARRAY[]::text[])
    ) AS t(tipo_dec, calc_key, no_req_key, oficiales)
  LOOP
    DECLARE
      v_fecha   date    := NULLIF(v -> r.calc_key ->> 'fecha', '')::date;
      v_cert    text    := v -> r.calc_key ->> 'certeza';
      v_optout  boolean := (v_no_req ? r.no_req_key);
      v_oficial boolean;
      v_debe    boolean;
    BEGIN
      -- cobertura autoritativa genérica (ddjj / curso / certificado-sin-oficial)
      v_oficial := (array_length(r.oficiales, 1) IS NOT NULL) AND EXISTS (
        SELECT 1 FROM public.vencimientos w
        WHERE w.administracion_id = p_admin AND w.tipo = ANY(r.oficiales)
          AND w.estado IN ('vigente','vencido'));

      IF r.tipo_dec = 'renovacion_matricula_declarada' THEN
        -- A2: una fila renovacion_rpac "cubre" a la declarada SÓLO si el venc de
        -- matrícula es OFICIAL (certeza='confirmado'). Si es declarado por el cliente
        -- (cliente_confirmar_vencimiento_matricula → gateado por DGG-226, silencioso),
        -- NO cubre → la declarada materializa y avisa "según tus datos".
        v_oficial := v_oficial AND COALESCE(v_matric_venc_cert, '') = 'confirmado';
        -- B4: una renovación EN CURSO con GG también suprime la declarada (paridad
        -- con el gate oficial del planificador).
        v_oficial := v_oficial OR v_renov_en_curso;
      END IF;

      v_debe := v_cert IN ('declarado','inferido')
                AND v_fecha IS NOT NULL
                AND NOT v_optout
                AND NOT v_oficial;

      IF v_debe THEN
        UPDATE public.vencimientos
           SET estado = 'renovado'
         WHERE administracion_id = p_admin AND tipo = r.tipo_dec
           AND estado IN ('vigente','vencido') AND fecha_vencimiento <> v_fecha;
        INSERT INTO public.vencimientos
          (tipo, sujeto, sujeto_id, administracion_id, fecha_vencimiento, fecha_emision,
           descripcion, estado, origen, alarmas_offsets, notificar_cliente)
        SELECT r.tipo_dec, 'administracion', p_admin, p_admin, v_fecha,
               (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date,
               'Recordatorio según datos declarados por el cliente', 'vigente',
               'declarado', '{45,30,15,0,-7,-21}'::int[], true
        WHERE NOT EXISTS (
          SELECT 1 FROM public.vencimientos w
          WHERE w.administracion_id = p_admin AND w.tipo = r.tipo_dec
            AND w.estado IN ('vigente','vencido') AND w.fecha_vencimiento = v_fecha);
      ELSE
        UPDATE public.vencimientos
           SET estado = 'renovado'
         WHERE administracion_id = p_admin AND tipo = r.tipo_dec
           AND estado IN ('vigente','vencido');
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'perfil_declarado_sync_venc obligacion % admin %: %', r.tipo_dec, p_admin, SQLERRM;
    END;
  END LOOP;
END $function$;

-- ---------------------------------------------------------------------
-- B5 · COMMENT de la tabla (ya no es SOLO servicios contratados)
-- ---------------------------------------------------------------------
COMMENT ON TABLE public.vencimientos IS
  'Vencimientos con renovación periódica. origen=''gestion_global''/motor = servicios '
  'contratados o gestionados por GG (los ve la grilla de gerencia). origen=''declarado'' '
  '(DGG-231) = recordatorios calculados a partir de los datos que el cliente declaró en '
  'su perfil regulatorio; NO son servicios contratados, no se muestran en gerencia, y los '
  'supersede el dato autoritativo (TRAMIX/trámite).';

-- ---------------------------------------------------------------------
-- #7 · plantilla declarada: la línea de upsell del legajo se ata a la matrícula
--      (no promete "verificar" DDJJ/curso/certificado con el legajo).
-- ---------------------------------------------------------------------
UPDATE public.email_templates
   SET cuerpo_html_visual =
     '<p style="margin:0 0 12px;color:#1e293b;">Según los datos que cargaste en tu perfil, {{frase_estado}}.</p>'
     '<p style="margin:0 0 12px;background:#ecfeff;border-left:4px solid #0891b2;border-radius:8px;padding:12px 14px;color:#0e7490;">Si ya la gestionaste, actualizá la fecha en tu perfil y dejamos de recordártela. Si todavía no, escribinos y la resolvemos con vos.</p>'
     '<p style="margin:0;color:#475569;font-size:14px;">Además, si cargás tu legajo RPAC en tu ficha, verificamos tu matrícula con el registro oficial.</p>',
       updated_at = now()
 WHERE slug = 'vencimiento-declarado-cliente';
