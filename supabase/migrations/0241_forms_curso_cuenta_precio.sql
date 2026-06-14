-- ============================================================================
-- 0241_forms_curso_cuenta_precio.sql
-- DGG-81 · Datos de pago + precio en los formularios de actualización
--
-- (1) curso-actualizacion-caba (Gestar/RPA): se carga la cuenta de pago real
--     (Mercado Pago · GestionGlobal.ar — la misma de inscripción al RPAC, dato
--     pasado por Pablo) y se restaura el flujo normal de pago (hint + comprobante
--     obligatorio), revirtiendo el "te enviamos por correo" temporal de 0240.
-- (2) Ambos formularios de actualización (RPAC/FUNDPLATA + RPA/Gestar) informan
--     el precio del servicio: $80.000.
--
-- Índices del schema (idénticos en ambos forms; el de Gestar se clonó del RPAC):
--   sections[2]=Pago · fields[0]=costos_curso (costos_info) · fields[1]=comprobante.
-- ============================================================================

-- (1) Gestar: cuenta Mercado Pago + restaurar flujo de pago normal -----------
UPDATE public.formularios
SET schema =
  jsonb_set(jsonb_set(jsonb_set(jsonb_set(
    schema,
    '{sections,2,fields,0,costos,cuenta}',
    '{"cvu":"0000003100053534352305","alias":"GestionGlobal.ar","titular":"Mercado Pago","cuit_cuil":"27225982746"}'::jsonb),
    '{sections,2,fields,0,hint}',
    '"Transferí el importe del curso a la siguiente cuenta."'::jsonb),
    '{sections,2,fields,1,required}', 'true'::jsonb),
    '{sections,2,fields,1,hint}',
    '"Subí el comprobante de la transferencia o depósito a la cuenta indicada arriba. Si vas a usar un voucher 100% lo podés ingresar en la sección \"Voucher\" y este campo se omitirá automáticamente."'::jsonb)
WHERE slug='curso-actualizacion-caba';

-- (2) Precio $80.000 en AMBOS formularios de actualización -------------------
UPDATE public.formularios
SET schema = jsonb_set(
  schema,
  '{sections,2,fields,0,costos,items}',
  '[{"label":"Curso de actualización","precio":"$80.000,00"}]'::jsonb)
WHERE slug IN ('curso-actualizacion', 'curso-actualizacion-caba');
