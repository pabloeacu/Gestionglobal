-- ============================================================================
-- 0006a_rls_perf_fixes · performance fixes señalados por el linter:
--   1) auth_rls_initplan: envolver auth.uid() en (select auth.uid()) en las
--      policies de profiles para que el planner lo evalúe una sola vez por
--      query, no por fila (regla 11 / E44).
--   2) multiple_permissive_policies: los `*_write_*` definidos con FOR ALL
--      generaban una segunda policy permisiva sobre SELECT (además de la
--      `*_select`). Las separo en INSERT/UPDATE/DELETE explícitos para que
--      SELECT tenga una sola policy permisiva.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) profiles · auth.uid() → (select auth.uid())
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS profiles_select ON public.profiles;
CREATE POLICY profiles_select ON public.profiles
  FOR SELECT TO authenticated
  USING (private.is_staff() OR id = (select auth.uid()));

DROP POLICY IF EXISTS profiles_update_self ON public.profiles;
CREATE POLICY profiles_update_self ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = (select auth.uid()))
  WITH CHECK (id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- 2) Replace `FOR ALL` write policies with explicit INSERT/UPDATE/DELETE
--    triples para que la policy de SELECT quede sola (sin solapamiento).
-- ---------------------------------------------------------------------------

-- helper macro lógico: a continuación, por tabla, drop ALL → recreate triple.

-- administraciones
DROP POLICY IF EXISTS administraciones_write_staff ON public.administraciones;
CREATE POLICY administraciones_insert_staff ON public.administraciones
  FOR INSERT TO authenticated WITH CHECK (private.is_staff());
CREATE POLICY administraciones_update_staff ON public.administraciones
  FOR UPDATE TO authenticated USING (private.is_staff()) WITH CHECK (private.is_staff());
CREATE POLICY administraciones_delete_staff ON public.administraciones
  FOR DELETE TO authenticated USING (private.is_staff());

-- consorcios
DROP POLICY IF EXISTS consorcios_write_staff ON public.consorcios;
CREATE POLICY consorcios_insert_staff ON public.consorcios
  FOR INSERT TO authenticated WITH CHECK (private.is_staff());
CREATE POLICY consorcios_update_staff ON public.consorcios
  FOR UPDATE TO authenticated USING (private.is_staff()) WITH CHECK (private.is_staff());
CREATE POLICY consorcios_delete_staff ON public.consorcios
  FOR DELETE TO authenticated USING (private.is_staff());

-- administracion_emails
DROP POLICY IF EXISTS admin_emails_write_staff ON public.administracion_emails;
CREATE POLICY admin_emails_insert_staff ON public.administracion_emails
  FOR INSERT TO authenticated WITH CHECK (private.is_staff());
CREATE POLICY admin_emails_update_staff ON public.administracion_emails
  FOR UPDATE TO authenticated USING (private.is_staff()) WITH CHECK (private.is_staff());
CREATE POLICY admin_emails_delete_staff ON public.administracion_emails
  FOR DELETE TO authenticated USING (private.is_staff());

-- categorias_servicio
DROP POLICY IF EXISTS categorias_servicio_write_gerente ON public.categorias_servicio;
CREATE POLICY categorias_servicio_insert_gerente ON public.categorias_servicio
  FOR INSERT TO authenticated WITH CHECK (private.is_gerente());
CREATE POLICY categorias_servicio_update_gerente ON public.categorias_servicio
  FOR UPDATE TO authenticated USING (private.is_gerente()) WITH CHECK (private.is_gerente());
CREATE POLICY categorias_servicio_delete_gerente ON public.categorias_servicio
  FOR DELETE TO authenticated USING (private.is_gerente());

-- servicios
DROP POLICY IF EXISTS servicios_write_gerente ON public.servicios;
CREATE POLICY servicios_insert_gerente ON public.servicios
  FOR INSERT TO authenticated WITH CHECK (private.is_gerente());
CREATE POLICY servicios_update_gerente ON public.servicios
  FOR UPDATE TO authenticated USING (private.is_gerente()) WITH CHECK (private.is_gerente());
CREATE POLICY servicios_delete_gerente ON public.servicios
  FOR DELETE TO authenticated USING (private.is_gerente());

-- tabulador_precios
DROP POLICY IF EXISTS tabulador_write_gerente ON public.tabulador_precios;
CREATE POLICY tabulador_insert_gerente ON public.tabulador_precios
  FOR INSERT TO authenticated WITH CHECK (private.is_gerente());
CREATE POLICY tabulador_update_gerente ON public.tabulador_precios
  FOR UPDATE TO authenticated USING (private.is_gerente()) WITH CHECK (private.is_gerente());
CREATE POLICY tabulador_delete_gerente ON public.tabulador_precios
  FOR DELETE TO authenticated USING (private.is_gerente());

-- comprobantes
DROP POLICY IF EXISTS comprobantes_write_staff ON public.comprobantes;
CREATE POLICY comprobantes_insert_staff ON public.comprobantes
  FOR INSERT TO authenticated WITH CHECK (private.is_staff());
CREATE POLICY comprobantes_update_staff ON public.comprobantes
  FOR UPDATE TO authenticated USING (private.is_staff()) WITH CHECK (private.is_staff());
CREATE POLICY comprobantes_delete_staff ON public.comprobantes
  FOR DELETE TO authenticated USING (private.is_staff());

-- items_comprobantes
DROP POLICY IF EXISTS items_comprobantes_write_staff ON public.items_comprobantes;
CREATE POLICY items_comprobantes_insert_staff ON public.items_comprobantes
  FOR INSERT TO authenticated WITH CHECK (private.is_staff());
CREATE POLICY items_comprobantes_update_staff ON public.items_comprobantes
  FOR UPDATE TO authenticated USING (private.is_staff()) WITH CHECK (private.is_staff());
CREATE POLICY items_comprobantes_delete_staff ON public.items_comprobantes
  FOR DELETE TO authenticated USING (private.is_staff());

-- numeradores
DROP POLICY IF EXISTS numeradores_write_staff ON public.numeradores;
CREATE POLICY numeradores_insert_staff ON public.numeradores
  FOR INSERT TO authenticated WITH CHECK (private.is_staff());
CREATE POLICY numeradores_update_staff ON public.numeradores
  FOR UPDATE TO authenticated USING (private.is_staff()) WITH CHECK (private.is_staff());
CREATE POLICY numeradores_delete_staff ON public.numeradores
  FOR DELETE TO authenticated USING (private.is_staff());

-- lotes_facturacion
DROP POLICY IF EXISTS lotes_write_staff ON public.lotes_facturacion;
CREATE POLICY lotes_insert_staff ON public.lotes_facturacion
  FOR INSERT TO authenticated WITH CHECK (private.is_staff());
CREATE POLICY lotes_update_staff ON public.lotes_facturacion
  FOR UPDATE TO authenticated USING (private.is_staff()) WITH CHECK (private.is_staff());
CREATE POLICY lotes_delete_staff ON public.lotes_facturacion
  FOR DELETE TO authenticated USING (private.is_staff());

-- cajas
DROP POLICY IF EXISTS cajas_write_staff ON public.cajas;
CREATE POLICY cajas_insert_staff ON public.cajas
  FOR INSERT TO authenticated WITH CHECK (private.is_staff());
CREATE POLICY cajas_update_staff ON public.cajas
  FOR UPDATE TO authenticated USING (private.is_staff()) WITH CHECK (private.is_staff());
CREATE POLICY cajas_delete_staff ON public.cajas
  FOR DELETE TO authenticated USING (private.is_staff());

-- categorias_finanzas
DROP POLICY IF EXISTS categorias_finanzas_write_gerente ON public.categorias_finanzas;
CREATE POLICY categorias_finanzas_insert_gerente ON public.categorias_finanzas
  FOR INSERT TO authenticated WITH CHECK (private.is_gerente());
CREATE POLICY categorias_finanzas_update_gerente ON public.categorias_finanzas
  FOR UPDATE TO authenticated USING (private.is_gerente()) WITH CHECK (private.is_gerente());
CREATE POLICY categorias_finanzas_delete_gerente ON public.categorias_finanzas
  FOR DELETE TO authenticated USING (private.is_gerente());

-- movimientos
DROP POLICY IF EXISTS movimientos_write_staff ON public.movimientos;
CREATE POLICY movimientos_insert_staff ON public.movimientos
  FOR INSERT TO authenticated WITH CHECK (private.is_staff());
CREATE POLICY movimientos_update_staff ON public.movimientos
  FOR UPDATE TO authenticated USING (private.is_staff()) WITH CHECK (private.is_staff());
CREATE POLICY movimientos_delete_staff ON public.movimientos
  FOR DELETE TO authenticated USING (private.is_staff());

-- movimiento_imputaciones
DROP POLICY IF EXISTS imp_write_staff ON public.movimiento_imputaciones;
CREATE POLICY imp_insert_staff ON public.movimiento_imputaciones
  FOR INSERT TO authenticated WITH CHECK (private.is_staff());
CREATE POLICY imp_update_staff ON public.movimiento_imputaciones
  FOR UPDATE TO authenticated USING (private.is_staff()) WITH CHECK (private.is_staff());
CREATE POLICY imp_delete_staff ON public.movimiento_imputaciones
  FOR DELETE TO authenticated USING (private.is_staff());

-- email_queue
DROP POLICY IF EXISTS email_queue_write_staff ON public.email_queue;
CREATE POLICY email_queue_insert_staff ON public.email_queue
  FOR INSERT TO authenticated WITH CHECK (private.is_staff());
CREATE POLICY email_queue_update_staff ON public.email_queue
  FOR UPDATE TO authenticated USING (private.is_staff()) WITH CHECK (private.is_staff());
CREATE POLICY email_queue_delete_staff ON public.email_queue
  FOR DELETE TO authenticated USING (private.is_staff());

-- sent_emails
DROP POLICY IF EXISTS sent_emails_write_staff ON public.sent_emails;
CREATE POLICY sent_emails_insert_staff ON public.sent_emails
  FOR INSERT TO authenticated WITH CHECK (private.is_staff());
CREATE POLICY sent_emails_update_staff ON public.sent_emails
  FOR UPDATE TO authenticated USING (private.is_staff()) WITH CHECK (private.is_staff());
CREATE POLICY sent_emails_delete_staff ON public.sent_emails
  FOR DELETE TO authenticated USING (private.is_staff());

-- email_plantillas
DROP POLICY IF EXISTS email_plantillas_write_gerente ON public.email_plantillas;
CREATE POLICY email_plantillas_insert_gerente ON public.email_plantillas
  FOR INSERT TO authenticated WITH CHECK (private.is_gerente());
CREATE POLICY email_plantillas_update_gerente ON public.email_plantillas
  FOR UPDATE TO authenticated USING (private.is_gerente()) WITH CHECK (private.is_gerente());
CREATE POLICY email_plantillas_delete_gerente ON public.email_plantillas
  FOR DELETE TO authenticated USING (private.is_gerente());

-- ---------------------------------------------------------------------------
-- 3) categorias_servicio · había DOS policies de SELECT (la pública + la
--    "select_staff" del 0003 que sobrescribí mentalmente). Consolido a una.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS categorias_servicio_select_staff ON public.categorias_servicio;
-- (la pública `categorias_servicio_select` queda como única SELECT permisiva)

DROP POLICY IF EXISTS servicios_select_staff ON public.servicios;
-- (la pública `servicios_select_public` queda como única SELECT permisiva)
