-- 0293 · Eventos (refinamientos Pablo): banco reutilizable de disertantes
-- (catálogo con foto + CV) + flyer 1080x1350 del evento.
--
-- El catálogo `disertantes` es la fuente reutilizable: la gerencia elige de ahí
-- (o crea uno nuevo que se guarda al banco). El evento sigue guardando un
-- SNAPSHOT en webinars.docentes (jsonb) — ahora cada entrada puede incluir
-- cv_url además de foto_url — así la página pública no necesita leer el catálogo
-- (que es staff-only) y el evento no se rompe si luego se edita el banco.

-- 1) Catálogo de disertantes (staff-only; el público ve el snapshot del evento).
CREATE TABLE IF NOT EXISTS public.disertantes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre     text NOT NULL,
  foto_url   text,
  cv_url     text,
  bio        text,
  activo     boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.disertantes ENABLE ROW LEVEL SECURITY;

-- R6: GRANT explícito. Sólo staff (por RPC/tabla con RLS); NO anon (E-GG-88/92).
GRANT SELECT, INSERT, UPDATE, DELETE ON public.disertantes TO authenticated;

DROP POLICY IF EXISTS disertantes_staff_all ON public.disertantes;
CREATE POLICY disertantes_staff_all ON public.disertantes
  FOR ALL TO authenticated
  USING (private.is_staff())
  WITH CHECK (private.is_staff());

CREATE INDEX IF NOT EXISTS idx_disertantes_activo ON public.disertantes(activo) WHERE activo;

-- updated_at
CREATE OR REPLACE FUNCTION public.tg_disertantes_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;
DROP TRIGGER IF EXISTS trg_disertantes_updated_at ON public.disertantes;
CREATE TRIGGER trg_disertantes_updated_at BEFORE UPDATE ON public.disertantes
  FOR EACH ROW EXECUTE FUNCTION public.tg_disertantes_updated_at();

COMMENT ON TABLE public.disertantes IS
  'Banco reutilizable de docentes/disertantes (foto + CV) para eventos. El evento snapshotea nombre/foto/cv en webinars.docentes (jsonb).';

-- 2) Flyer vertical del evento (1080x1350), al costado del formulario.
ALTER TABLE public.webinars ADD COLUMN IF NOT EXISTS flyer_url text;
COMMENT ON COLUMN public.webinars.flyer_url IS 'Flyer promocional vertical (1080x1350) mostrado al costado del formulario de inscripción.';

-- 3) La RPC pública de inscripción suma flyer_url (docentes ya viaja como jsonb,
--    así que cv_url por docente fluye solo). Misma firma → CREATE OR REPLACE.
CREATE OR REPLACE FUNCTION public.webinar_inscripcion_activa()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT to_jsonb(t) FROM (
    SELECT w.id, w.titulo, w.descripcion, w.banner_url, w.flyer_url, w.docentes,
           w.fecha_hora, w.duracion_min, w.plataforma,
           w.modalidad, w.tipo,
           w.ubicacion_lugar, w.ubicacion_direccion, w.ubicacion_localidad,
           w.ubicacion_mapa_url, w.ubicacion_instrucciones,
           w.es_arancelado, w.arancel_monto, w.arancel_nota,
           COALESCE(w.formulario_id, ev.id)     AS formulario_id,
           COALESCE(f.slug, ev.slug)            AS formulario_slug,
           COALESCE(f.activo, ev.activo)        AS formulario_activo
    FROM public.webinars w
    LEFT JOIN public.formularios f ON f.id = w.formulario_id
    LEFT JOIN LATERAL (
      SELECT fe.id, fe.slug, fe.activo
      FROM public.formularios fe
      WHERE fe.categoria = 'evento' AND fe.activo
      ORDER BY fe.created_at ASC
      LIMIT 1
    ) ev ON true
    WHERE w.id = private.webinar_vigente_id()
  ) t;
$function$;
