-- ============================================================================
-- 0003_servicios_tabulador · catálogo extensible de servicios + tabulador de
-- precios con historial. Cubre el punto 5 (servicios) y el punto 14 (tabulador
-- flexible: fijo, por consorcio, por unidad funcional, convenio, preferencial,
-- ajustes masivos, historial) del Documento Maestro.
-- Cita el bagaje: D04/D06 (facturable admin vs consorcio), P-DB-01.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- categorias_servicio · agrupador (RPAC, RPA, Capacitación, SaaS, Jurídico…)
-- ---------------------------------------------------------------------------
CREATE TABLE public.categorias_servicio (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo text NOT NULL UNIQUE,
  nombre text NOT NULL,
  descripcion text,
  color text,
  icono text,
  orden int NOT NULL DEFAULT 0,
  activo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_categorias_servicio_touch
  BEFORE UPDATE ON public.categorias_servicio
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- servicios · catálogo extensible. Cada servicio define cómo se calcula su
-- precio base (modo) y reglas de aplicabilidad.
-- ---------------------------------------------------------------------------
CREATE TABLE public.servicios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  categoria_id uuid NOT NULL REFERENCES public.categorias_servicio(id) ON DELETE RESTRICT,

  codigo text NOT NULL UNIQUE,
  nombre text NOT NULL,
  descripcion text,

  -- Cómo se calcula el precio base de este servicio (pto 14 Documento Maestro)
  precio_modo text NOT NULL CHECK (precio_modo IN (
    'fijo',                  -- precio único
    'por_consorcio',         -- N consorcios × precio
    'por_unidad_funcional',  -- N UF × precio (Administración Global)
    'por_tramite',           -- por cada trámite/expediente
    'convenio'               -- precio definido por convenio
  )),
  precio_base numeric(12,2) NOT NULL DEFAULT 0 CHECK (precio_base >= 0),
  iva_alicuota text NOT NULL DEFAULT '21'
    CHECK (iva_alicuota IN ('0','10.5','21','27','exento','no_gravado')),

  -- Reglas de aplicabilidad
  requiere_administracion boolean NOT NULL DEFAULT true,
  requiere_consorcio boolean NOT NULL DEFAULT false,
  permite_multiples_consorcios boolean NOT NULL DEFAULT false,

  -- Integración con campus (cursos)
  habilita_campus boolean NOT NULL DEFAULT false,
  campus_vigencia_meses int CHECK (campus_vigencia_meses IS NULL OR campus_vigencia_meses > 0),

  -- Integración con formularios públicos (pto 9 / 3)
  habilitado_formulario_publico boolean NOT NULL DEFAULT false,
  formulario_publico_slug text UNIQUE,

  orden int NOT NULL DEFAULT 0,
  activo boolean NOT NULL DEFAULT true,
  observaciones text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);

CREATE INDEX idx_servicios_categoria ON public.servicios(categoria_id);
CREATE INDEX idx_servicios_activo ON public.servicios(activo, orden)
  WHERE activo;
CREATE INDEX idx_servicios_form_publico
  ON public.servicios(formulario_publico_slug)
  WHERE habilitado_formulario_publico AND activo;

CREATE TRIGGER trg_servicios_touch
  BEFORE UPDATE ON public.servicios
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_servicios_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.servicios
  FOR EACH ROW EXECUTE FUNCTION public.audit_row();

-- ---------------------------------------------------------------------------
-- tabulador_precios · historial de cambios + reglas especiales.
-- Cada fila representa: el precio que estuvo (o está) vigente para un
-- servicio en un rango de fechas, opcionalmente sólo para 1 administración
-- (preferencial) o 1 convenio.
-- ---------------------------------------------------------------------------
CREATE TABLE public.tabulador_precios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  servicio_id uuid NOT NULL REFERENCES public.servicios(id) ON DELETE CASCADE,

  precio numeric(12,2) NOT NULL CHECK (precio >= 0),
  vigente_desde date NOT NULL DEFAULT CURRENT_DATE,
  vigente_hasta date,

  -- Alcance: si ambos NULL → es la regla base del servicio
  administracion_id uuid REFERENCES public.administraciones(id) ON DELETE CASCADE,
  convenio text,

  -- Trazabilidad del ajuste
  origen text NOT NULL DEFAULT 'base' CHECK (origen IN (
    'base',                  -- cambio de precio base
    'ajuste_porcentual',     -- aumento masivo por % (carga el delta)
    'ajuste_fijo',           -- aumento masivo por monto fijo
    'ajuste_indice',         -- ajuste por índice (IPC, etc.)
    'convenio',              -- precio especial por convenio
    'preferencial',          -- precio especial para 1 administración
    'cliente_nuevo',         -- promo cliente nuevo
    'cliente_recurrente'     -- precio recurrente
  )),
  precio_anterior numeric(12,2),
  porcentaje_aplicado numeric(7,4),
  motivo text,

  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,

  CONSTRAINT chk_tabulador_alcance CHECK (
    NOT (administracion_id IS NOT NULL AND convenio IS NOT NULL)
  ),
  CONSTRAINT chk_tabulador_fechas CHECK (
    vigente_hasta IS NULL OR vigente_hasta >= vigente_desde
  )
);

CREATE INDEX idx_tabulador_servicio_fechas
  ON public.tabulador_precios(servicio_id, vigente_desde DESC);
CREATE INDEX idx_tabulador_admin
  ON public.tabulador_precios(administracion_id, servicio_id)
  WHERE administracion_id IS NOT NULL;
CREATE INDEX idx_tabulador_convenio
  ON public.tabulador_precios(convenio, servicio_id)
  WHERE convenio IS NOT NULL;
-- Una sola regla base abierta por servicio.
CREATE UNIQUE INDEX uq_tabulador_base_vigente
  ON public.tabulador_precios(servicio_id)
  WHERE administracion_id IS NULL
    AND convenio IS NULL
    AND vigente_hasta IS NULL;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.categorias_servicio ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS categorias_servicio_select ON public.categorias_servicio;
CREATE POLICY categorias_servicio_select ON public.categorias_servicio
  FOR SELECT TO authenticated, anon USING (activo);
-- Los administradores también pueden ver inactivos? No, solo activos para todos.
DROP POLICY IF EXISTS categorias_servicio_select_staff ON public.categorias_servicio;
CREATE POLICY categorias_servicio_select_staff ON public.categorias_servicio
  FOR SELECT TO authenticated USING (private.is_staff());

DROP POLICY IF EXISTS categorias_servicio_write_gerente ON public.categorias_servicio;
CREATE POLICY categorias_servicio_write_gerente ON public.categorias_servicio
  FOR ALL TO authenticated
  USING (private.is_gerente())
  WITH CHECK (private.is_gerente());

ALTER TABLE public.servicios ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS servicios_select_public ON public.servicios;
CREATE POLICY servicios_select_public ON public.servicios
  FOR SELECT TO authenticated, anon USING (activo);
DROP POLICY IF EXISTS servicios_select_staff ON public.servicios;
CREATE POLICY servicios_select_staff ON public.servicios
  FOR SELECT TO authenticated USING (private.is_staff());

DROP POLICY IF EXISTS servicios_write_gerente ON public.servicios;
CREATE POLICY servicios_write_gerente ON public.servicios
  FOR ALL TO authenticated
  USING (private.is_gerente())
  WITH CHECK (private.is_gerente());

ALTER TABLE public.tabulador_precios ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tabulador_select_staff ON public.tabulador_precios;
CREATE POLICY tabulador_select_staff ON public.tabulador_precios
  FOR SELECT TO authenticated USING (private.is_staff());

DROP POLICY IF EXISTS tabulador_write_gerente ON public.tabulador_precios;
CREATE POLICY tabulador_write_gerente ON public.tabulador_precios
  FOR ALL TO authenticated
  USING (private.is_gerente())
  WITH CHECK (private.is_gerente());

-- ---------------------------------------------------------------------------
-- Seed inicial · categorías + servicios del catálogo de Gestión Global.
-- Los precios quedan en 0 y `activo=false` para que un gerente los revise y
-- los active explícitamente antes de facturar.
-- ---------------------------------------------------------------------------
INSERT INTO public.categorias_servicio (codigo, nombre, descripcion, orden) VALUES
  ('rpac_pba',        'RPAC · Buenos Aires',          'Gestoría de matrícula y trámites del Registro Público de Administraciones de Consorcios de la PBA', 10),
  ('rpa_caba',        'RPA · CABA',                   'Renovación de matrícula del Registro Público de Administradores de CABA', 20),
  ('capacitacion',    'Capacitación',                 'Cursos de formación y actualización oficiales', 30),
  ('plataforma_saas', 'Plataforma SaaS',              'Administración Global · suite operativa para el administrador', 40),
  ('juridico',        'Asesoría jurídica',            'Consultoría especializada en propiedad horizontal', 50),
  ('comunidad',       'Comunidad',                    'Capacitaciones gratuitas y contenidos abiertos', 60)
ON CONFLICT (codigo) DO NOTHING;

INSERT INTO public.servicios
  (categoria_id, codigo, nombre, descripcion, precio_modo,
   requiere_administracion, requiere_consorcio, permite_multiples_consorcios,
   habilita_campus, campus_vigencia_meses, habilitado_formulario_publico,
   formulario_publico_slug, orden, activo)
SELECT c.id, s.codigo, s.nombre, s.descripcion, s.precio_modo,
       s.requiere_administracion, s.requiere_consorcio, s.permite_multiples_consorcios,
       s.habilita_campus, s.campus_vigencia_meses, s.habilitado_formulario_publico,
       s.formulario_publico_slug, s.orden, false
FROM (VALUES
  -- RPAC PBA
  ('rpac_pba', 'rpac_inscripcion',     'Inscripción al RPAC',                 'Gestión integral de la matrícula de administrador en PBA',                 'fijo',                true, false, false, false, NULL::int, true,  'rpac/inscripcion',     10),
  ('rpac_pba', 'rpac_renovacion',      'Renovación de matrícula RPAC',        'Renovación anual de la matrícula',                                         'fijo',                true, false, false, false, NULL,      true,  'rpac/renovacion',      20),
  ('rpac_pba', 'rpac_certificado',     'Certificado de acreditación RPAC',    'Certificado que acredita matrícula vigente',                               'fijo',                true, false, false, false, NULL,      true,  'rpac/certificado',     30),
  ('rpac_pba', 'rpac_ddjj',            'Declaraciones juradas anuales',       'DDJJ por consorcio · plataforma guiada',                                    'por_consorcio',       true, true,  true,  false, NULL,      true,  'rpac/ddjj',            40),
  -- RPA CABA
  ('rpa_caba', 'rpa_actualizacion',    'Actualización RPA · CABA',            'Curso de actualización para renovación RPA · 100% asincrónico',            'fijo',                true, false, false, true,  12,        true,  'rpa/actualizacion',    10),
  -- Capacitación
  ('capacitacion', 'curso_formacion_rpac',    'Curso de Formación RPAC',      'Curso obligatorio para inscripción · sincrónico',                          'fijo',                true, false, false, true,  6,         true,  'cursos/formacion-rpac',   10),
  ('capacitacion', 'curso_actualizacion_rpac','Curso de Actualización RPAC',  'Curso obligatorio para renovación · asincrónico + tutorías',               'fijo',                true, false, false, true,  12,        true,  'cursos/actualizacion-rpac', 20),
  -- Plataforma SaaS
  ('plataforma_saas', 'administracion_global', 'Administración Global',       'Suite web de gestión para el administrador (precio por unidad funcional)', 'por_unidad_funcional', true, true,  true,  false, NULL,      true,  'plataforma/administracion-global', 10),
  -- Jurídico
  ('juridico', 'juridico_consulta',    'Consulta jurídica',                   'Respuesta documentada con fundamento legal',                                'por_tramite',         true, false, false, false, NULL,      true,  'juridico/consulta',    10),
  -- Comunidad
  ('comunidad','capacitacion_gratuita','Capacitaciones gratuitas',            'Webinars, podcasts y charlas con especialistas',                            'fijo',                false, false, false, false, NULL,     false, NULL,                   10)
) AS s(categoria_codigo, codigo, nombre, descripcion, precio_modo,
       requiere_administracion, requiere_consorcio, permite_multiples_consorcios,
       habilita_campus, campus_vigencia_meses, habilitado_formulario_publico,
       formulario_publico_slug, orden)
JOIN public.categorias_servicio c ON c.codigo = s.categoria_codigo
ON CONFLICT (codigo) DO NOTHING;
