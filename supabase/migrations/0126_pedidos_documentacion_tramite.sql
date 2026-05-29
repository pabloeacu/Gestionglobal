-- ============================================================================
-- Migration: 0126_pedidos_documentacion_tramite
-- Fecha: 2026-05-28
-- N2 · Sistema de pedidos de documentación al cliente dentro de un trámite.
-- Un trámite puede tener N pedidos abiertos. Cada pedido tiene M items con
-- estado independiente (pendiente → subido → aprobado/rechazado). Trámite
-- queda con flag `requiere_docs_cliente=true` mientras tenga pedidos abiertos.
-- Aplica al inicio o en cualquier punto del trámite.
-- ============================================================================

-- (a) Bucket de storage
INSERT INTO storage.buckets (id, name, public)
VALUES ('pedidos-doc-cliente', 'pedidos-doc-cliente', false)
ON CONFLICT (id) DO NOTHING;

-- (b) Flag en tramites
ALTER TABLE public.tramites
  ADD COLUMN IF NOT EXISTS requiere_docs_cliente boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.tramites.requiere_docs_cliente IS
  'N2 · true si hay al menos un pedido_doc abierto. Actualizado por triggers.';

-- (c) Pedido (cabecera)
CREATE TABLE IF NOT EXISTS public.tramite_pedidos_doc (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tramite_id      uuid NOT NULL REFERENCES public.tramites(id) ON DELETE CASCADE,
  descripcion     text NOT NULL,
  estado          text NOT NULL DEFAULT 'abierto'
                    CHECK (estado IN ('abierto','completo','cancelado')),
  creado_por      uuid REFERENCES public.profiles(id),
  creado_at       timestamptz NOT NULL DEFAULT now(),
  cerrado_at      timestamptz,
  cerrado_por     uuid REFERENCES public.profiles(id)
);
CREATE INDEX IF NOT EXISTS idx_pedidos_doc_tramite ON public.tramite_pedidos_doc(tramite_id);
CREATE INDEX IF NOT EXISTS idx_pedidos_doc_estado ON public.tramite_pedidos_doc(estado) WHERE estado='abierto';

-- (d) Items
CREATE TABLE IF NOT EXISTS public.tramite_pedidos_doc_items (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id           uuid NOT NULL REFERENCES public.tramite_pedidos_doc(id) ON DELETE CASCADE,
  descripcion         text NOT NULL,
  estado              text NOT NULL DEFAULT 'pendiente'
                        CHECK (estado IN ('pendiente','subido','aprobado','rechazado')),
  archivo_path        text,
  archivo_nombre      text,
  archivo_mime        text,
  archivo_size_bytes  bigint,
  subido_at           timestamptz,
  subido_por          uuid REFERENCES public.profiles(id),
  revisado_at         timestamptz,
  revisado_por        uuid REFERENCES public.profiles(id),
  observaciones_rev   text,
  orden               int NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_pedidos_doc_items_pedido ON public.tramite_pedidos_doc_items(pedido_id);

-- (e) Trigger sync flag tramite
CREATE OR REPLACE FUNCTION private.sync_tramite_requiere_docs()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_tramite_id uuid;
  v_abiertos   int;
BEGIN
  v_tramite_id := COALESCE(NEW.tramite_id, OLD.tramite_id);
  SELECT count(*) INTO v_abiertos
    FROM public.tramite_pedidos_doc
   WHERE tramite_id = v_tramite_id AND estado = 'abierto';
  UPDATE public.tramites
     SET requiere_docs_cliente = (v_abiertos > 0),
         updated_at = now()
   WHERE id = v_tramite_id;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_tramite_requiere_docs ON public.tramite_pedidos_doc;
CREATE TRIGGER trg_sync_tramite_requiere_docs
AFTER INSERT OR UPDATE OF estado OR DELETE ON public.tramite_pedidos_doc
FOR EACH ROW EXECUTE FUNCTION private.sync_tramite_requiere_docs();

-- (f) RLS
ALTER TABLE public.tramite_pedidos_doc ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tramite_pedidos_doc_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY pedidos_doc_gerente_all ON public.tramite_pedidos_doc
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('gerente')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('gerente')));

CREATE POLICY pedidos_doc_cliente_select ON public.tramite_pedidos_doc
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1
      FROM public.tramites t
      JOIN public.profiles p ON p.administracion_id = t.administracion_id
     WHERE t.id = tramite_pedidos_doc.tramite_id
       AND p.id = auth.uid()
       AND p.role = 'administrador'
  ));

CREATE POLICY pedidos_doc_items_gerente_all ON public.tramite_pedidos_doc_items
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('gerente')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('gerente')));

CREATE POLICY pedidos_doc_items_cliente_select ON public.tramite_pedidos_doc_items
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1
      FROM public.tramite_pedidos_doc ped
      JOIN public.tramites t ON t.id = ped.tramite_id
      JOIN public.profiles p ON p.administracion_id = t.administracion_id
     WHERE ped.id = tramite_pedidos_doc_items.pedido_id
       AND p.id = auth.uid()
       AND p.role = 'administrador'
  ));

-- (g)(h)(i)(j) RPCs en migración 0126 aplicada via Supabase MCP.
-- Versión completa en BD; este archivo documenta el esquema.

-- (k) Storage RLS bucket pedidos-doc-cliente
CREATE POLICY pedidos_doc_storage_cliente_rw ON storage.objects
  FOR ALL TO authenticated
  USING (
    bucket_id = 'pedidos-doc-cliente'
    AND (
      EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('gerente'))
      OR EXISTS (
        SELECT 1
          FROM public.tramites t
          JOIN public.profiles pr ON pr.administracion_id = t.administracion_id
         WHERE pr.id = auth.uid()
           AND pr.role = 'administrador'
           AND t.id::text = split_part(name, '/', 1)
      )
    )
  )
  WITH CHECK (
    bucket_id = 'pedidos-doc-cliente'
    AND (
      EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('gerente'))
      OR EXISTS (
        SELECT 1
          FROM public.tramites t
          JOIN public.profiles pr ON pr.administracion_id = t.administracion_id
         WHERE pr.id = auth.uid()
           AND pr.role = 'administrador'
           AND t.id::text = split_part(name, '/', 1)
      )
    )
  );

-- Email template tramite-docs-pendientes seedeada en MCP.
