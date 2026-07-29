-- ============================================================================
-- 0394 · DGG-120 · Catálogo "Proveedor frecuente" para el alta manual de egresos
--
-- Pedido de Pablo (29/07): un combo práctico en "Nuevo movimiento" (egresos)
-- para elegir un proveedor de una lista y que su nombre se CONCATENE al inicio
-- de la descripción ("ARCA - Pago de monotributo"). Tabla INDEPENDIENTE y
-- meramente informativa: CERO columnas/FKs nuevas en movimientos ni cambios en
-- el circuito contable — el movimiento guardado no referencia esta tabla.
-- ============================================================================

CREATE TABLE public.proveedores_frecuentes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre text NOT NULL CHECK (btrim(nombre) <> ''),
  activo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.proveedores_frecuentes ENABLE ROW LEVEL SECURITY;
-- R6: grants explícitos (post mig 0130). Solo lo que el flujo usa.
-- §6: el default ACL del schema public regala ALL a anon/authenticated en toda
-- tabla nueva — sin estos REVOKE el GRANT de abajo es un no-op decorativo
-- (RLS contiene igual, pero defensa en profundidad manda).
REVOKE ALL ON public.proveedores_frecuentes FROM anon;
REVOKE ALL ON public.proveedores_frecuentes FROM authenticated;
GRANT SELECT, INSERT ON public.proveedores_frecuentes TO authenticated;

-- Dedupe insensible a mayúsculas/espacios ("arca" == "ARCA").
CREATE UNIQUE INDEX uq_proveedores_frecuentes_nombre
  ON public.proveedores_frecuentes (lower(btrim(nombre)));

-- Catálogo interno de gerencia: solo staff lo ve y lo alimenta.
CREATE POLICY proveedores_frecuentes_select ON public.proveedores_frecuentes
  FOR SELECT TO authenticated USING (private.is_staff());
CREATE POLICY proveedores_frecuentes_insert ON public.proveedores_frecuentes
  FOR INSERT TO authenticated WITH CHECK (private.is_staff());

-- Listado inicial provisto por Pablo (29/07) — 41 proveedores.
INSERT INTO public.proveedores_frecuentes (nombre) VALUES
  ('ARCA'),
  ('Camara de Adm. de La Plata CALP.'),
  ('CONSORCIANDO > Marcos Hernández y Otros'),
  ('Cra. Tamara Suken'),
  ('Cr. Darío Schvartz'),
  ('Cr. Natalia Cervan'),
  ('Dra. Agustina Botana Mathieu - Estudio Chiesa'),
  ('Dra. Diana Sevitz'),
  ('Dra. Mayra Lucero'),
  ('Dr. Federico Chiesa'),
  ('Dr. Gerardo J. Rodríguez Arauco'),
  ('Dr. Lisandro Cingolani'),
  ('Dr. Pablo Acuña'),
  ('Dr. Raul Castro'),
  ('Dr. Soledad Ortiz de Zarate'),
  ('Envíalo Simple'),
  ('Fabian Beuchel'),
  ('Felipe Baeck'),
  ('GCBA'),
  ('GESTAR'),
  ('Gestión Global'),
  ('Gestor360 SA.'),
  ('Google'),
  ('Ing. José Miguel Biel'),
  ('Julieta Galesi'),
  ('Proveedores de Compras Varios'),
  ('Leonel E. Sánchez'),
  ('Lic. Martin Saveriano'),
  ('Lic. Ximena V. Gonzalez'),
  ('Locutor Profesional'),
  ('Lucas C. Krenkel'),
  ('Meta Business'),
  ('Movistar'),
  ('Pablo Aguirre Streaming'),
  ('Prod. Seg. Ileana Ruveda'),
  ('Prof. Seguros Christian Bruni'),
  ('Proveedores de Servicios y/o Gastos Varios'),
  ('Renderix Sociedad'),
  ('UNLP Graduados'),
  ('Wix.com - Hosting'),
  ('Zoom.com')
ON CONFLICT DO NOTHING;
