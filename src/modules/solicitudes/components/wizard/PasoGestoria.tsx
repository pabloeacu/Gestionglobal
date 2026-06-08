// Paso 4 · Derivación a gestoría externa (OPCIONAL).
// Switch maestro: si está apagado, el paso se saltea. (Chunk A: switch real +
//  explicación. Chunk D completa email/observaciones/monto/caja/adjuntos.)
//  Diferida: el mail y el egreso se ejecutan en el ProcesadorFinal, no acá.

import { Send } from 'lucide-react';
import { StepPanel } from '@/components/common';
import type { PasoProps } from './types';

export function PasoGestoria({ state, set }: PasoProps) {
  const activa = state.gestoria.activa;
  return (
    <StepPanel
      stepKey="gestoria"
      title="4 · Derivación a gestoría"
      subtitle="Opcional. Si lo activás, al final le mandamos a la gestoría un correo con la documentación y un acceso seguro (sin login). El egreso del pago a la gestoría también se registra al final."
    >
      <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4">
        <span>
          <span className="block text-sm font-semibold text-brand-ink">
            <Send size={14} className="mr-1 inline" />
            Derivar a una gestoría externa
          </span>
          <span className="mt-0.5 block text-xs text-brand-muted">
            Activá para configurar el correo y el pago a la gestoría.
          </span>
        </span>
        <input
          type="checkbox"
          checked={activa}
          onChange={(e) =>
            set((s) => ({ ...s, gestoria: { ...s.gestoria, activa: e.target.checked } }))
          }
          className="h-5 w-5 accent-brand-cyan"
        />
      </label>
    </StepPanel>
  );
}
