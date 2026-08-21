-- 0435_dgg143_rename_plataforma_gestion.sql
-- DGG-143 (Pablo, 2026-08-21): el servicio "Administración Global" pasa a
-- llamarse "Plataforma de gestión" — ya no se trabaja con el sistema
-- Administración Global; lo que se ofrece es la plataforma de gestión propia.
-- Catálogo vivo en `servicios` (el seed histórico de mig 0003 no se reescribe).
-- Sin recordatorios/ofrecimientos para este servicio (matriz DGG-143).

UPDATE public.servicios
   SET nombre = 'Plataforma de gestión'
 WHERE nombre = 'Administración Global';
