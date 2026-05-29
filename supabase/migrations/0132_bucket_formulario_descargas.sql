-- Bucket público para archivos de descarga en formularios públicos.
-- Lectura pública (URL signada no hace falta); escritura solo gerencia.

INSERT INTO storage.buckets (id, name, public)
VALUES ('formulario-descargas', 'formulario-descargas', true)
ON CONFLICT (id) DO UPDATE SET public = true;

CREATE POLICY formulario_descargas_gerente_write ON storage.objects
  FOR ALL TO authenticated
  USING (
    bucket_id = 'formulario-descargas'
    AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'gerente')
  )
  WITH CHECK (
    bucket_id = 'formulario-descargas'
    AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'gerente')
  );
