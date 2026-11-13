-- 0689 · DGG-249 · R11: índice faltante en la FK egresos.consorcio_id.
-- La auditoría final §6 detectó que egresos.consorcio_id (FK a consorcios, nullable) quedó sin
-- índice en la mig 0685. Postgres no crea índices de FK automáticamente (R11): se agrega acá para
-- que los filtros/joins por consorcio sobre egresos no degraden cuando la tabla crezca.
CREATE INDEX IF NOT EXISTS idx_egresos_consorcio_id ON public.egresos (consorcio_id) WHERE consorcio_id IS NOT NULL;
