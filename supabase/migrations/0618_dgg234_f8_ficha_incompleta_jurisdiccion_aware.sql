-- 0618_dgg234_f8_ficha_incompleta_jurisdiccion_aware.sql
-- DGG-234 · F8 — `gg_admin_ficha_incompleta` consciente de jurisdicción (coherencia aviso↔display).
-- --------------------------------------------------------------------------
-- private.gg_admin_ficha_incompleta() alimenta el ofrecimiento 'perfil_incompleto' (email +
-- push "Completá tu perfil", CTA a /portal/mi-ficha). Era un ESPEJO del viejo contarPendientes
-- (previo a F6): contaba renovacion/curso/ddjj/certificado/consultoria SIN mirar jurisdicción.
-- Pero la ficha del cliente oculta lo que no aplica (obligacionesVisibles: CABA no muestra
-- 'certificado'; Neuquén tampoco 'curso'/'ddjj'). Resultado latente: un CABA/Neuquén que
-- completa TODO lo visible seguía ficha_incompleta=true por un 'certificado' irresoluble en el
-- portal → aviso periódico cuyo CTA abre una ficha sin nada por completar (dead-end). Capitalizado
-- por el §6 adversarial de F8 (2-bis a: lector pre-existente que filtra en silencio; 2-bis e:
-- incoherencia aviso↔display). Ya había disparado a CABA reales (Avolio/SANCLAUDIO).
--
-- Fix: gatear cada obligación NO-universal por `jurisdiccion_code` del calc (F8, mig 0617),
-- espejando obligacionesVisibles EXACTAMENTE:
--   · renovacion, consultoria → universales (pba/caba/neuquen): sin gate.
--   · curso_actualizacion, ddjj → pba/caba: no cuentan para 'neuquen'.
--   · certificado → sólo pba: no cuenta para 'caba' ni 'neuquen'.
-- COALESCE(code,'pba') preserva el comportamiento para PBA y para code NULL (sin matrícula:
-- ese caso ya queda incompleto por la 1ª cláusula `jurisdiccion IS NULL`). Verificado ANTES de
-- aplicar (old vs new inline sobre los 178 activos): pba 174→0 cambios, caba 4→0 cambios
-- (byte-idéntico HOY; sólo cierra el dead-end futuro). 0 regresión en quién recibe ofertas.
-- --------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.gg_admin_ficha_incompleta(p_admin uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH j AS (SELECT private.perfil_regulatorio_calc(p_admin) AS p)
  SELECT
    ((j.p->>'jurisdiccion') IS NULL)
    OR ((j.p->'matricula'->>'fecha_certeza')='desconocido' AND COALESCE((j.p->'matriculado'->>'valor')::boolean, false))
    OR ((j.p->'ultima_renovacion'->>'certeza')='desconocido'           AND NOT (j.p->'no_requiere' ? 'renovacion'))
    OR ((j.p->'ultimo_curso_actualizacion'->>'certeza')='desconocido'  AND NOT (j.p->'no_requiere' ? 'curso_actualizacion')
         AND COALESCE(j.p->>'jurisdiccion_code','pba') <> 'neuquen')
    OR ((j.p->'ultima_ddjj'->>'certeza')='desconocido'                 AND NOT (j.p->'no_requiere' ? 'ddjj')
         AND COALESCE(j.p->>'jurisdiccion_code','pba') <> 'neuquen')
    OR ((j.p->'ultimo_certificado'->>'certeza')='desconocido'          AND NOT (j.p->'no_requiere' ? 'certificado')
         AND COALESCE(j.p->>'jurisdiccion_code','pba') NOT IN ('caba','neuquen'))
    OR ((j.p->'ultima_consultoria'->>'certeza')='desconocido'          AND NOT (j.p->'no_requiere' ? 'consultoria'))
  FROM j;
$function$;
