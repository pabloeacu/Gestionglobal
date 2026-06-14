-- ============================================================================
-- 0243_wire_programa_urls.sql
-- DGG-81 · Enlaza los PDF de programa subidos a campus-media:
--   · cursos.programa_url  → nodo "Programa" del campus (alumno).
--   · formularios … file_download.download_url → descarga en el form de inscripción.
-- RPAC/FUNDPLATA (488b58c3) + RPA/Gestar (eaafb7af). Misma convención de URLs de
-- storage que mig 0235 (campus-media público).
-- ============================================================================

-- Campus · nodo "Programa" por curso
UPDATE public.cursos
SET programa_url = 'https://kaoyhkebnidzqjixvchh.supabase.co/storage/v1/object/public/campus-media/curso-programa/488b58c3-0966-4aef-a980-ab3aa3f5269b/programa-actualizacion-rpac-2026.pdf'
WHERE id = '488b58c3-0966-4aef-a980-ab3aa3f5269b';

UPDATE public.cursos
SET programa_url = 'https://kaoyhkebnidzqjixvchh.supabase.co/storage/v1/object/public/campus-media/curso-programa/eaafb7af-5129-4d9c-a2a7-eeabd620b0e9/programa-gestar-rpa-2026.pdf'
WHERE id = 'eaafb7af-5129-4d9c-a2a7-eeabd620b0e9';

-- Formularios · descarga del programa (sections[1]=Programa del curso · fields[0])
UPDATE public.formularios
SET schema = jsonb_set(jsonb_set(
  schema,
  '{sections,1,fields,0,download_url}',
  '"https://kaoyhkebnidzqjixvchh.supabase.co/storage/v1/object/public/campus-media/curso-programa/488b58c3-0966-4aef-a980-ab3aa3f5269b/programa-actualizacion-rpac-2026.pdf"'::jsonb),
  '{sections,1,fields,0,download_size_bytes}', '138818'::jsonb)
WHERE slug = 'curso-actualizacion';

UPDATE public.formularios
SET schema = jsonb_set(jsonb_set(
  schema,
  '{sections,1,fields,0,download_url}',
  '"https://kaoyhkebnidzqjixvchh.supabase.co/storage/v1/object/public/campus-media/curso-programa/eaafb7af-5129-4d9c-a2a7-eeabd620b0e9/programa-gestar-rpa-2026.pdf"'::jsonb),
  '{sections,1,fields,0,download_size_bytes}', '194303'::jsonb)
WHERE slug = 'curso-actualizacion-caba';
