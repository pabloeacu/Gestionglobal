-- 0655 · DGG-244 F2a · Ediciones (volúmenes) de LexPH + digest editorial.
--
-- La EDICIÓN agrupa una tanda. Dos ciclos de vida:
--   · las NOTAS (lexph_articulos) se ACUMULAN y quedan vigentes para siempre; `edicion_id`
--     marca en qué edición DEBUTARON (para el badge "Nuevo" y los permalinks). No se ocultan.
--   · el DIGEST editorial (intro / resumen ejecutivo / tendencias por materia / editorial) es
--     POR EDICIÓN y se PISA en cada entrega (la web muestra el de la última edición publicada).
--
-- 100% ADITIVO: tabla net-new + columna nullable en articulos; extiende el feed público con
-- `edicion_id` (misma firma → sin overload, R16 N/A). Reglas: R2, R5, R6, R11.

-- ============================================================================
-- 1. Tabla de ediciones (volúmenes) — staff-only, R6 least-privilege
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.lexph_ediciones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq integer NOT NULL,                       -- orden interno (NO se numera en pantalla)
  titulo_interno text NOT NULL,               -- referencia de gerencia ("Edición N°2")
  estado text NOT NULL DEFAULT 'borrador' CHECK (estado IN ('borrador', 'publicada')),
  destacado_articulo_id uuid REFERENCES public.lexph_articulos(id) ON DELETE SET NULL,
  intro text,                                 -- "lo último" / hilo conductor
  resumen jsonb NOT NULL DEFAULT '[]'::jsonb,      -- [{titulo, texto}]  (scan rápido)
  tendencias jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{materia, texto}] (análisis por materia)
  editorial jsonb NOT NULL DEFAULT '{}'::jsonb,    -- {kicker, titulo, cuerpo}
  publicado_at timestamptz,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.lexph_ediciones IS
  'DGG-244 F2 · Ediciones/volúmenes de LexPH. El digest (intro/resumen/tendencias/editorial) es por edición y se pisa; las notas se acumulan (edicion_id = edición de debut).';

ALTER TABLE public.lexph_ediciones ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.lexph_ediciones FROM authenticated, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lexph_ediciones TO authenticated;  -- RLS limita a staff
CREATE POLICY lexph_ediciones_staff_all ON public.lexph_ediciones
  FOR ALL TO authenticated
  USING ((SELECT private.is_staff()))
  WITH CHECK ((SELECT private.is_staff()));

CREATE UNIQUE INDEX IF NOT EXISTS idx_lexph_ediciones_seq ON public.lexph_ediciones (seq);
CREATE INDEX IF NOT EXISTS idx_lexph_ediciones_pub ON public.lexph_ediciones (estado, publicado_at DESC);
CREATE INDEX IF NOT EXISTS idx_lexph_ediciones_destacado ON public.lexph_ediciones (destacado_articulo_id);  -- R11 (FK)

-- ============================================================================
-- 2. edicion_id en artículos (la edición en la que debutó) — R11
-- ============================================================================
ALTER TABLE public.lexph_articulos
  ADD COLUMN IF NOT EXISTS edicion_id uuid REFERENCES public.lexph_ediciones(id) ON DELETE SET NULL;
COMMENT ON COLUMN public.lexph_articulos.edicion_id IS
  'DGG-244 F2 · Edición en la que la nota DEBUTÓ. La nota se acumula/queda vigente para siempre; esto sólo marca "Nuevo" y agrupa en el permalink de la edición.';
CREATE INDEX IF NOT EXISTS idx_lexph_articulos_edicion ON public.lexph_articulos (edicion_id);

-- ============================================================================
-- 3. Seed: Edición N°2 (la tanda actual) + asignar las 11 notas + destacada
-- ============================================================================
DO $seed$
DECLARE
  v_ed uuid;
  v_destacado uuid;
BEGIN
  -- idempotente por seq
  SELECT id INTO v_ed FROM public.lexph_ediciones WHERE seq = 2;
  SELECT id INTO v_destacado FROM public.lexph_articulos WHERE slug = 'fallo-difamacion-whatsapp-administradora';

  IF v_ed IS NULL THEN
    INSERT INTO public.lexph_ediciones (seq, titulo_interno, estado, destacado_articulo_id, publicado_at, intro, resumen, tendencias, editorial)
    VALUES (
      2, 'Edición N°2', 'publicada', v_destacado,
      (SELECT max(publicado_at) FROM public.lexph_articulos WHERE estado = 'publicado'),
      $i$El hilo conductor de estas seis semanas: las «cosas comunes» que nadie revisa (un balcón sin baranda, un matafuego con el soporte vencido, un acceso sin rampa) terminan en condenas millonarias, y el seguro del consorcio muchas veces no alcanza. Además: prórroga del FAL, nuevas escalas de encargados y un fallo que protege la reputación del administrador frente a los grupos de WhatsApp.$i$,
      $r$[
        {"titulo":"SUM sin baranda = responsabilidad objetiva","texto":"La Cámara Civil (Sala K) confirmó la condena a un consorcio por la muerte de un joven que cayó del balcón del SUM. La alcoholemia de la víctima solo le restó un 20%."},
        {"titulo":"Accesibilidad no se vota","texto":"Un juzgado de Dolores ordenó a un consorcio construir una rampa en 120 días y sostuvo que la accesibilidad no puede quedar sujeta a la inactividad de la asamblea."},
        {"titulo":"Administradores protegidos","texto":"La Sala F elevó a $1.500.000 la indemnización a una administradora difamada por una copropietaria en el grupo de WhatsApp del edificio."},
        {"titulo":"FAL postergado","texto":"El Decreto 1228/2026 corrió la entrada en vigencia del Fondo de Asistencia Laboral al 1° de diciembre de 2026. Hay que elegir entidad antes de esa fecha."},
        {"titulo":"Agenda CABA","texto":"La DDJJ anual de consorcios administrados (período 2025) vence el 30 de noviembre de 2026."}
      ]$r$::jsonb,
      $t$[
        {"materia":"Daños y responsabilidad","texto":"Tres de los seis fallos del período aplican la misma lógica: si el daño viene de una cosa común (balcón, matafuego, cañería), el consorcio responde en forma objetiva (arts. 1757 y 1758 CCyCN) y solo se libera probando una causa ajena. El hecho de la víctima reduce la condena, pero rara vez la elimina. Los tribunales aplican de forma consistente el 8% anual hasta la sentencia y luego la tasa activa del BNA."},
        {"materia":"Seguros","texto":"En los dos fallos de la Cámara Civil, la discusión sobre el límite de cobertura desactualizado fue central. Los jueces buscan fórmulas de ajuste (IPC, variación de primas), pero no siempre cubren la diferencia: lo que la póliza no paga lo paga el consorcio. La denuncia en término del siniestro es clave para no perder la cobertura."},
        {"materia":"Responsabilidad del administrador","texto":"En el caso del SUM, la demanda civil contra la administradora fue rechazada, aunque en sede penal resultó procesada. En sentido inverso, la Sala F reconoció que el administrador también tiene un honor profesional que proteger frente a acusaciones infundadas de los consorcistas."},
        {"materia":"Asambleas","texto":"El fallo de Dolores pone un límite a la soberanía de la asamblea: frente a derechos de personas con discapacidad, no tratar el tema también es decidir, y el juez puede ordenar la obra directamente."},
        {"materia":"Alquileres temporarios","texto":"España confirmó que la vivienda turística necesita aprobación de la junta con mayoría calificada: una referencia a seguir si avanza una regulación local. Hoy en Argentina decide el destino que fija el reglamento de copropiedad."}
      ]$t$::jsonb,
      $e${"kicker":"Insight LexPH · Edición N°2","titulo":"El riesgo está en los detalles… y en la póliza","cuerpo":"Un pasador faltante, un soporte vencido, una rampa que nunca se votó. Ninguno de estos fallos nace de una gran decisión equivocada, sino de pequeñas omisiones de mantenimiento que el régimen de responsabilidad objetiva convierte en condenas de decenas de millones.\n\nEl segundo mensaje es más incómodo: las pólizas de responsabilidad civil de muchos consorcios están desactualizadas. Un límite de cobertura de alrededor de un millón de pesos frente a condenas de ocho cifras deja al consorcio pagando la diferencia con fondos de los propietarios.\n\nRecomendación para este cierre de año: hacer en cada edificio una auditoría breve de cosas comunes con riesgo (balcones, terrazas, SUM, matafuegos, accesos), revisar sumas aseguradas y cláusulas de actualización, y llevar ambos temas a la próxima asamblea con presupuesto. Es la mejor inversión preventiva que un administrador puede proponer."}$e$::jsonb
    )
    RETURNING id INTO v_ed;
  END IF;

  -- Asignar todas las notas publicadas a la Edición N°2 (debut) si aún no tienen edición
  UPDATE public.lexph_articulos SET edicion_id = v_ed
  WHERE estado = 'publicado' AND edicion_id IS NULL;
END;
$seed$;

-- ============================================================================
-- 4. Extender el feed público con `edicion_id` (para el badge "Nuevo") — misma firma
-- ============================================================================
CREATE OR REPLACE FUNCTION public.lexph_publico_feed()
RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp STABLE
AS $$
  SELECT COALESCE(jsonb_agg(obj ORDER BY pub DESC NULLS LAST), '[]'::jsonb)
  FROM (
    SELECT
      jsonb_build_object(
        'id', a.id, 'slug', a.slug, 'tipo', a.tipo, 'titulo', a.titulo,
        'resumen', a.resumen, 'imagen_url', a.imagen_url, 'imagen_alt', a.imagen_alt,
        'publicado_at', a.publicado_at, 'edicion_id', a.edicion_id,
        'tags', (
          SELECT COALESCE(jsonb_agg(jsonb_build_object('slug', t.slug, 'nombre', t.nombre, 'tipo', t.tipo)
                          ORDER BY t.orden, t.nombre), '[]'::jsonb)
          FROM public.lexph_articulo_tags atg
          JOIN public.lexph_tags t ON t.id = atg.tag_id AND t.activo
          WHERE atg.articulo_id = a.id
        )
      ) AS obj,
      a.publicado_at AS pub
    FROM public.lexph_articulos a
    WHERE a.estado = 'publicado'
      AND public.get_lexph_publico_status()
  ) s;
$$;

-- ============================================================================
-- 5. Digest público de la edición ACTUAL (última publicada) — anon, gateado por el flag
-- ============================================================================
CREATE OR REPLACE FUNCTION public.lexph_edicion_publica_actual()
RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp STABLE
AS $$
  SELECT CASE WHEN public.get_lexph_publico_status() THEN (
    SELECT jsonb_build_object(
      'id', e.id,
      'intro', e.intro,
      'resumen', e.resumen,
      'tendencias', e.tendencias,
      'editorial', e.editorial,
      'publicado_at', e.publicado_at,
      'destacado_slug', (SELECT a.slug FROM public.lexph_articulos a
                          WHERE a.id = e.destacado_articulo_id AND a.estado = 'publicado')
    )
    FROM public.lexph_ediciones e
    WHERE e.estado = 'publicada'
    ORDER BY e.publicado_at DESC NULLS LAST, e.seq DESC
    LIMIT 1
  ) ELSE NULL END;
$$;
REVOKE ALL ON FUNCTION public.lexph_edicion_publica_actual() FROM public;
GRANT EXECUTE ON FUNCTION public.lexph_edicion_publica_actual() TO anon, authenticated;
