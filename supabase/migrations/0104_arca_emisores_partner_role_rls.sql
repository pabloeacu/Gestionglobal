-- ============================================================================
-- Migration: 0104_arca_emisores_partner_role_rls
-- Fecha: 2026-05-28
-- DGG-XX · #149 parte 2 (RLS + RPCs): policies y RPCs para role 'partner'.
-- ============================================================================

DROP POLICY IF EXISTS arca_em_staff_all ON public.arca_emisores;
CREATE POLICY arca_em_staff_all ON public.arca_emisores
  FOR ALL TO authenticated
  USING (private.is_staff())
  WITH CHECK (private.is_staff());

DROP POLICY IF EXISTS arca_em_partner_select ON public.arca_emisores;
CREATE POLICY arca_em_partner_select ON public.arca_emisores
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.partners pa
        JOIN public.profiles pr ON pr.partner_id = pa.id
       WHERE pr.id = auth.uid()
         AND pa.emisor_id = arca_emisores.id
    )
  );

DROP POLICY IF EXISTS comprobantes_partner_select ON public.comprobantes;
CREATE POLICY comprobantes_partner_select ON public.comprobantes
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles pr
        JOIN public.partners pa ON pa.id = pr.partner_id
       WHERE pr.id = auth.uid()
         AND pr.role = 'partner'
         AND pa.emisor_id = comprobantes.emisor_id
    )
  );

DROP POLICY IF EXISTS rendiciones_partner_select ON public.partner_rendiciones;
CREATE POLICY rendiciones_partner_select ON public.partner_rendiciones
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles pr
       WHERE pr.id = auth.uid()
         AND pr.role = 'partner'
         AND pr.partner_id = partner_rendiciones.partner_id
    )
  );

DROP POLICY IF EXISTS atribuciones_partner_select ON public.partner_atribuciones;
CREATE POLICY atribuciones_partner_select ON public.partner_atribuciones
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles pr
       WHERE pr.id = auth.uid()
         AND pr.role = 'partner'
         AND pr.partner_id = partner_atribuciones.partner_id
    )
  );

CREATE OR REPLACE FUNCTION public.partner_mis_comprobantes()
RETURNS TABLE (
  id uuid, tipo text, numero integer, punto_venta integer,
  fecha date, vencimiento date, total numeric,
  estado text, estado_cobranza text, emitido_arca boolean,
  receptor_razon_social text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT c.id, c.tipo, c.numero, c.punto_venta, c.fecha, c.vencimiento,
         c.total, c.estado, c.estado_cobranza, c.emitido_arca,
         c.receptor_razon_social
    FROM public.comprobantes c
    JOIN public.profiles pr ON pr.id = auth.uid()
    JOIN public.partners pa ON pa.id = pr.partner_id
   WHERE pr.role = 'partner'
     AND pa.emisor_id = c.emisor_id
   ORDER BY c.fecha DESC, c.numero DESC;
$$;
REVOKE EXECUTE ON FUNCTION public.partner_mis_comprobantes() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.partner_mis_comprobantes() TO authenticated;

CREATE OR REPLACE FUNCTION public.partner_mis_rendiciones()
RETURNS TABLE (
  id uuid, periodo_desde date, periodo_hasta date, estado text,
  total_ingresos_brutos numeric, total_ingresos_atribuidos numeric,
  total_costos_brutos numeric, total_costos_atribuidos numeric
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT r.id, r.periodo_desde, r.periodo_hasta, r.estado,
         r.total_ingresos_brutos, r.total_ingresos_atribuidos,
         r.total_costos_brutos, r.total_costos_atribuidos
    FROM public.partner_rendiciones r
    JOIN public.profiles pr ON pr.id = auth.uid()
   WHERE pr.role = 'partner'
     AND pr.partner_id = r.partner_id
   ORDER BY r.periodo_desde DESC;
$$;
REVOKE EXECUTE ON FUNCTION public.partner_mis_rendiciones() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.partner_mis_rendiciones() TO authenticated;
