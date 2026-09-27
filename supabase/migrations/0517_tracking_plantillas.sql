-- 0517 · Plantillas / "mensajes modelo" para las líneas de tracking (pedido Pablo 2026-09-27).
--
-- Pablo redacta a mano mensajes que se repiten al completar el tracking de un trámite (cierre,
-- avance, moderación de aportes de la gestoría). Ya hay "mensajes modelo" en otros lados
-- (recupero_plantillas, plantillas de email); acá se suma el mismo recurso para el tracking:
-- una plantilla = título (etiqueta del picker) + cuerpo (texto que se inserta en la descripción).
--
-- Diseño (espeja recupero_plantillas): tabla única (sin RPC, R5 aplica sólo a multi-tabla), CRUD por
-- service fns (R4), RLS staff-only (el cliente NUNCA ve el catálogo, sólo la línea resultante),
-- GRANT explícito a authenticated (R6). `categoria` es un slug SOFT opcional (parity con
-- tracking_lineas.categoria, que se valida en la RPC, no por FK) — permite plantillas genéricas o
-- etiquetadas. `created_by` = auth.uid() automático (informativo; NULL en los seeds del sistema).

CREATE TABLE public.tracking_plantillas (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo      text NOT NULL,                 -- etiqueta corta en el picker (ej. "Renovación finalizada")
  cuerpo      text NOT NULL,                 -- texto que se inserta/copia en la descripción de la línea
  categoria   text,                          -- opcional: slug de tracking_categorias_config (SOFT, sin FK)
  orden       smallint NOT NULL DEFAULT 0,   -- orden en el picker / listado
  activo      boolean NOT NULL DEFAULT true, -- inactiva = no aparece en el picker, sí en la gestión
  created_by  uuid DEFAULT auth.uid(),       -- gerente que la creó (informativo; NULL en seeds)
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.tracking_plantillas ENABLE ROW LEVEL SECURITY;

-- least-privilege EXACTO (R6): Supabase, por default privileges, grantea ALL a `authenticated`
-- y a `anon` en cada CREATE TABLE. Sin revocar primero, `authenticated` (los 131 clientes
-- incluidos) quedaría con TRUNCATE —que IGNORA RLS— y podría vaciar la tabla; `anon` con SELECT.
-- Revocamos todo y otorgamos sólo lo necesario (parity con recupero_plantillas).
REVOKE ALL ON public.tracking_plantillas FROM authenticated, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tracking_plantillas TO authenticated;
-- anon: nada (catálogo interno de gerencia, sin flujo público).

-- Sólo staff (gerente/operador) administra y ve las plantillas. El cliente jamás las toca.
CREATE POLICY tracking_plantillas_staff_all ON public.tracking_plantillas
  FOR ALL TO authenticated
  USING ((SELECT private.is_staff()))
  WITH CHECK ((SELECT private.is_staff()));

-- updated_at automático en cada UPDATE (helper existente).
CREATE TRIGGER trg_tracking_plantillas_touch
  BEFORE UPDATE ON public.tracking_plantillas
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- El picker lista activas ordenadas por (orden, titulo).
CREATE INDEX idx_tracking_plantillas_orden
  ON public.tracking_plantillas (activo, orden, titulo);

-- Semilla: mensajes que Pablo ya usa (editables/borrables desde la UI). created_by queda NULL.
INSERT INTO public.tracking_plantillas (titulo, cuerpo, categoria, orden) VALUES
  (
    'Renovación finalizada',
    E'Trámite de renovación finalizado. Se puede consultar la mesa de entrada a través del acceso en la plataforma para su respectiva verificación. Las fechas de vencimiento quedaron registradas a los efectos de generar las alarmas para que pueda gestionar las oportunas renovaciones.\nGracias por confiar en Gestión Global.',
    'gestor_avance',
    10
  ),
  (
    'Acuse de presentación disponible',
    E'Disponible: Acuse de Presentación del trámite.\n> La constancia la podés ver y/o descargar desde tu Portal de Gestión Global.',
    'gestor_avance',
    20
  ),
  (
    'Cierre — gracias por confiar',
    'Trámite resuelto correctamente. Gracias por confiar en Gestión Global.',
    NULL,
    30
  );
