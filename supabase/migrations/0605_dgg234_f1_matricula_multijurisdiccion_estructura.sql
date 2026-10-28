-- 0605_dgg234_f1_matricula_multijurisdiccion_estructura.sql
-- DGG-234 · Fase 1 — Estructura ADITIVA e INERTE del modelo de matrícula
-- multi-jurisdicción (PBA · CABA · Neuquén). E-GG-236 (raíz: jurisdicción
-- derivada de la columna). Ver knowledge-base/DGG-234_matricula_multijurisdiccion.md
-- --------------------------------------------------------------------------
-- NADA se mueve ni cambia de comportamiento en esta fase: se crean un enum,
-- una tabla hija vacía (sólo CABA/NEU; PBA sigue en administraciones.matricula_rpac*)
-- y una vista unificada de lectura. Ningún consumidor existente la referencia
-- todavía (riesgo nulo para los 143 PBA). Los lectores se migran en F2+.
-- --------------------------------------------------------------------------

-- Enum de jurisdicción de 1ª clase (alinea con cursos.jurisdiccion 'pba'/'caba').
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'jurisdiccion_matricula') THEN
    CREATE TYPE public.jurisdiccion_matricula AS ENUM ('pba','caba','neuquen');
  END IF;
END$$;

-- Tabla hija: una matrícula NO-PBA por (administracion, jurisdiccion).
-- PBA NO vive acá (CHECK) — sigue en las columnas de administraciones.
CREATE TABLE IF NOT EXISTS public.matricula_extra (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  administracion_id    uuid NOT NULL REFERENCES public.administraciones(id) ON DELETE CASCADE,
  jurisdiccion         public.jurisdiccion_matricula NOT NULL,
  matricula_nro        text,
  matricula_fecha      date,                 -- fecha de otorgamiento
  matricula_vencimiento date,
  certeza              public.certeza_dato NOT NULL DEFAULT 'declarado',
  origen               text,                 -- 'formulario:<slug>' | 'gerencia' | 'cliente' | 'backfill'
  verificado_at        timestamptz,
  notas                text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  created_by           uuid,
  updated_by           uuid,
  CONSTRAINT matricula_extra_no_pba      CHECK (jurisdiccion <> 'pba'),
  CONSTRAINT matricula_extra_uq_adm_jur  UNIQUE (administracion_id, jurisdiccion)
);

COMMENT ON TABLE public.matricula_extra IS
  'DGG-234: matrículas NO-PBA (CABA/Neuquén), 1 por jurisdicción por administración. PBA vive en administraciones.matricula_rpac*. Leer vía v_matriculas.';

ALTER TABLE public.matricula_extra ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.matricula_extra TO authenticated;

-- RLS: mismo patrón que perfil_regulatorio (cliente ve lo suyo; staff todo).
DROP POLICY IF EXISTS matricula_extra_cliente_select ON public.matricula_extra;
CREATE POLICY matricula_extra_cliente_select ON public.matricula_extra
  FOR SELECT TO authenticated
  USING (administracion_id = private.current_administracion_id());

DROP POLICY IF EXISTS matricula_extra_staff ON public.matricula_extra;
CREATE POLICY matricula_extra_staff ON public.matricula_extra
  FOR ALL TO authenticated
  USING (private.is_staff()) WITH CHECK (private.is_staff());

CREATE INDEX IF NOT EXISTS idx_matricula_extra_admin ON public.matricula_extra(administracion_id);

-- Vista unificada de lectura: PBA (de columnas) ∪ no-PBA (de la hija).
-- Fuente única multi-jurisdicción para los lectores que se migran en F2+.
CREATE OR REPLACE VIEW public.v_matriculas AS
  SELECT a.id AS administracion_id,
         'pba'::public.jurisdiccion_matricula AS jurisdiccion,
         a.matricula_rpac               AS matricula_nro,
         a.matricula_rpac_fecha         AS matricula_fecha,
         a.matricula_rpac_vencimiento   AS matricula_vencimiento,
         a.legajo_rpac                  AS legajo_nro,
         COALESCE(a.matricula_rpac_vencimiento_certeza, 'confirmado')::public.certeza_dato AS certeza,
         a.matricula_rpac_vencimiento_origen         AS origen,
         a.matricula_rpac_vencimiento_verificado_at  AS verificado_at
  FROM public.administraciones a
  WHERE a.matricula_rpac IS NOT NULL OR a.matricula_rpac_vencimiento IS NOT NULL
  UNION ALL
  SELECT me.administracion_id, me.jurisdiccion, me.matricula_nro, me.matricula_fecha,
         me.matricula_vencimiento, NULL::text AS legajo_nro, me.certeza, me.origen, me.verificado_at
  FROM public.matricula_extra me;

COMMENT ON VIEW public.v_matriculas IS
  'DGG-234: lectura unificada de matrículas por jurisdicción (PBA desde administraciones ∪ CABA/NEU desde matricula_extra).';

GRANT SELECT ON public.v_matriculas TO authenticated;
