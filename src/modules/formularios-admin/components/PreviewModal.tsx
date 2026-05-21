// Modal de vista previa: rinde el schema actual con el `FormularioRunner`
// real, pero envuelto en un `FormularioRow` sintético (sin persistir).
// El runner intenta hacer submit → lo prevenimos arriba si quisiéramos, pero
// el botón "Enviar" igual dispara submitFormulario y como `slug` puede no
// existir, el edge function devolverá error; mostramos un aviso.

import { Modal } from '@/components/common';
import type { FormularioRow, FormularioSchemaDef } from '@/services/api/formularios';
import { FormularioRunner } from '@/modules/public/components/FormularioRunner';

interface PreviewModalProps {
  open: boolean;
  onClose: () => void;
  formulario: FormularioRow;
  schema: FormularioSchemaDef;
}

export function PreviewModal({ open, onClose, formulario, schema }: PreviewModalProps) {
  if (!open) return null;
  // Construimos un row "shallow" con el schema vivo para que el runner trabaje
  // con la versión actual del builder (sin guardar).
  const previewRow: FormularioRow = {
    ...formulario,
    schema: schema as unknown as FormularioRow['schema'],
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={formulario.titulo}
      kicker="Vista previa"
      width={720}
    >
      <div className="space-y-3">
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          Esta es la vista del formulario tal como lo verán los visitantes. El
          botón Enviar intentará enviar de verdad — no lo uses para probar
          envíos hasta que el formulario esté activo.
        </p>
        <FormularioRunner formulario={previewRow} />
      </div>
    </Modal>
  );
}
