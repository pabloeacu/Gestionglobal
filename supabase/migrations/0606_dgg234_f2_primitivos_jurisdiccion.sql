-- 0606_dgg234_f2_primitivos_jurisdiccion.sql
-- DGG-234 · Fase 2 — Primitivos de clasificación de jurisdicción conscientes
-- de matricula_extra (ADITIVO, 0 regresión). Ver DGG-234_matricula_multijurisdiccion.md
-- --------------------------------------------------------------------------
-- Como matricula_extra está vacía y los 3 CABA siguen en matricula_rpac (cutover
-- en F7), estas funciones devuelven EXACTAMENTE lo mismo que hoy para los 144
-- admins actuales. Los nuevos OR/AND sólo "se activan" cuando exista una matrícula
-- CABA/NEU en la tabla hija. CREATE OR REPLACE (misma firma → sin overload, R16 ok).
-- --------------------------------------------------------------------------

-- matrícula conocida: + si existe matrícula no-PBA en la hija
CREATE OR REPLACE FUNCTION private.gg_admin_matricula_conocida(p_admin uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.administraciones a
                 WHERE a.id=p_admin AND NULLIF(btrim(a.matricula_rpac),'') IS NOT NULL)
      OR EXISTS (SELECT 1 FROM public.perfil_regulatorio pr
                 WHERE pr.administracion_id=p_admin AND NULLIF(btrim(pr.matricula_nro_declarada),'') IS NOT NULL)
      OR EXISTS (SELECT 1 FROM public.matricula_extra me
                 WHERE me.administracion_id=p_admin);
$function$;

-- "sólo CABA": tiene señal CABA (curso caba o matrícula CABA en la hija),
-- SIN ninguna señal PBA, y SIN matrícula Neuquén (si tuviera NEU no es "solo caba").
CREATE OR REPLACE FUNCTION private.gg_admin_es_solo_caba(p_admin uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT (
      private.gg_admin_hizo_curso_caba(p_admin)
      OR EXISTS (SELECT 1 FROM public.matricula_extra me
                 WHERE me.administracion_id=p_admin AND me.jurisdiccion='caba')
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.administraciones a
      WHERE a.id = p_admin
        AND (a.matricula_rpac IS NOT NULL OR a.matricula_rpac_vencimiento IS NOT NULL)
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.tramites t
      JOIN public.servicios s ON s.id = t.servicio_id
      WHERE t.administracion_id = p_admin AND t.estado <> 'cancelado'
        AND s.codigo IN ('rpac_inscripcion','rpac_inscripcion_juridica','rpac_renovacion',
                         'rpac_certificado','rpac_ddjj','curso_formacion_rpac','curso_actualizacion_rpac')
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.curso_matriculas cm
      JOIN public.cursos c ON c.id = cm.curso_id
      LEFT JOIN public.profiles p ON p.id = cm.profile_id
      WHERE COALESCE(cm.administracion_id, p.administracion_id) = p_admin
        AND cm.estado <> 'anulada'
        AND c.jurisdiccion = 'pba'
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.matricula_extra me
      WHERE me.administracion_id = p_admin AND me.jurisdiccion = 'neuquen'
    );
$function$;
