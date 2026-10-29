-- 0611_dgg234_f5b_materializador_stamp_jurisdiccion.sql
-- DGG-234 · Fase 5b — el materializador de vencimientos declarados estampa
-- `vencimientos.jurisdiccion` según la matrícula del cliente. Ver DGG-234 §5 (F5).
-- --------------------------------------------------------------------------
-- `perfil_declarado_sync_venc` inserta los recordatorios DECLARADOS
-- (renovacion_matricula_declarada, ddjj/curso/certificado _declarado) SIN setear
-- jurisdiccion → el trigger F4a los dejaba en 'pba'. Para que una renovación de
-- matrícula CABA/NEU declarada se rotule bien en el edge (F4b), hay que estampar
-- la jurisdicción real de la matrícula del cliente al insertar.
--
-- 0 REGRESIÓN pre-cutover: `matricula_extra` está vacía → el stamp cae a 'pba'
-- para todos = exactamente lo que el trigger ponía. Sólo cambia (a 'caba'/'neuquen')
-- cuando el cliente tenga matrícula en la hija (post-cutover F7 / nuevos CABA-NEU).
-- CREATE OR REPLACE, misma firma (R16 ok). SECURITY DEFINER igual.
-- --------------------------------------------------------------------------

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
  v_renov_en_curso boolean;
  v_jur public.jurisdiccion_matricula;   -- DGG-234 F5b: jurisdicción de la matrícula del cliente
BEGIN
  v := private.perfil_regulatorio_calc(p_admin);
  v_no_req := COALESCE(v->'no_requiere', '{}'::jsonb);

  -- DGG-234 F5b: jurisdicción real de la matrícula del cliente (hija → 'pba' si no hay).
  -- Hoy la hija está vacía → 'pba' para todos (= default del trigger F4a, 0 regresión);
  -- post-cutover un CABA puro (sin columna) → 'caba'. NOTA F6/§6-A#6b: para un cliente
  -- DUAL futuro (matrícula PBA en columna + fila CABA en la hija) calc rutea la matrícula
  -- columnas-first mientras esto estampa desde la hija → se alinean cuando F6 construya
  -- el modelo N-matrículas (hoy no alcanzable: hija vacía / los 3 CABA son CABA-puros).
  v_jur := COALESCE(
    (SELECT me.jurisdiccion FROM public.matricula_extra me
      WHERE me.administracion_id = p_admin ORDER BY me.jurisdiccion LIMIT 1),
    'pba');

  v_renov_en_curso := EXISTS (
    SELECT 1 FROM public.tramites t
    WHERE t.administracion_id = p_admin
      AND t.categoria = 'renovacion'
      AND t.estado IN ('abierto','en_progreso','esperando_cliente'));

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
      v_oficial := (array_length(r.oficiales, 1) IS NOT NULL) AND EXISTS (
        SELECT 1 FROM public.vencimientos w
        WHERE w.administracion_id = p_admin AND w.tipo = ANY(r.oficiales)
          AND w.estado IN ('vigente','vencido'));

      IF r.tipo_dec = 'renovacion_matricula_declarada' THEN
        v_oficial := v_renov_en_curso
                     OR (v_oficial AND private.gg_venc_tramix_fresco(p_admin));
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
           descripcion, estado, origen, alarmas_offsets, notificar_cliente, jurisdiccion)
        SELECT r.tipo_dec, 'administracion', p_admin, p_admin, v_fecha,
               (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date,
               'Recordatorio según datos declarados por el cliente', 'vigente',
               'declarado', '{45,30,15,0,-7,-21}'::int[], true, v_jur   -- DGG-234 F5b
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
