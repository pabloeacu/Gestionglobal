-- 0234_form_curso_rpac_costos_info.sql
-- JL 2 · obs 3 (2026-06-12): en los formularios de curso (curso-formacion +
-- curso-actualizacion RPAC) la cuenta de pago NO es de Gestión Global → se agrega
-- el bloque presentacional `costos_info` con los datos correctos (FU.DE.CO.IN:
-- CBU/alias/CUIT/CC) y se saca "a nombre de Gestión Global" del hint del campo
-- comprobante. costos_info NO se valida ni se envía en el payload (presentacional,
-- DGG-61). Sólo estos 2 forms (los otros 4 RPAC usan la cuenta MP de GG, sin tocar).
-- Se reconstruye sólo la sección "Pago", preservando el orden del resto.

UPDATE public.formularios f
SET schema = jsonb_set(
  f.schema,
  '{sections}',
  (
    SELECT jsonb_agg(
             CASE
               WHEN sec->>'title' = 'Pago'
               THEN jsonb_set(sec, '{fields}', $fields$[
                 {
                   "name": "costos_curso",
                   "type": "costos_info",
                   "label": "Datos para realizar el pago",
                   "hint": "Transferí el importe del curso a la siguiente cuenta.",
                   "costos": {
                     "items": [],
                     "cuenta": {
                       "titular": "FU.DE.CO.IN - Fundación para el Desarrollo, Conocimiento e Investigación",
                       "cvu": "0140114701205005476802",
                       "alias": "BECADO.PLATO.DIETA",
                       "cuit_cuil": "30-71753148-1"
                     },
                     "nota_extra": "Cuenta corriente N° 2050-54768/0."
                   }
                 },
                 {
                   "name": "comprobante_pago_inscripcion",
                   "type": "file",
                   "label": "Adjuntar comprobante de pago",
                   "required": true,
                   "hint": "Subí el comprobante de la transferencia o depósito a la cuenta indicada arriba. Si vas a usar un voucher 100% lo podés ingresar en la sección \"Voucher\" y este campo se omitirá automáticamente."
                 }
               ]$fields$::jsonb)
               ELSE sec
             END
             ORDER BY ord
           )
    FROM jsonb_array_elements(f.schema->'sections') WITH ORDINALITY AS t(sec, ord)
  )
)
WHERE f.slug IN ('curso-formacion', 'curso-actualizacion');
