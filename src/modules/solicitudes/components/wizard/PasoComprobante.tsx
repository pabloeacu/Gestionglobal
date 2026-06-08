// Paso 3 · Comprobante y registro de cobranza.
// (Chunk A: placeholder que ya refleja el modo según el servicio. Chunk C
//  completa items/precio, voucher/bonificación, total/parcial, caja y partner.)
//  Q3: DDJJ → se omite (se emite al cerrar el trámite); gratuito/100% bonif →
//  comprobante en $0 sin cobranza; pago → comprobante + cobranza.

import { Receipt } from 'lucide-react';
import { StepPanel } from '@/components/common';
import type { PasoProps } from './types';

export function PasoComprobante({ flags }: PasoProps) {
  const modo = flags.esDDJJ
    ? { titulo: 'Se omite el comprobante', detalle: 'Es una DDJJ: el importe se conoce al concluir el trámite, así que el comprobante se emite al cerrarlo, no ahora.' }
    : flags.esGratuito
      ? { titulo: 'Comprobante en $0', detalle: 'Servicio gratuito o 100% bonificado: se genera un comprobante en $0 (sin cobranza) para que quede en el historial del cliente.' }
      : { titulo: 'Comprobante + cobranza', detalle: 'Se configura el comprobante (con voucher/bonificación si corresponde) y el registro de la cobranza (total o parcial) sobre una caja.' };

  return (
    <StepPanel
      stepKey="comprobante"
      title="3 · Comprobante y cobranza"
      subtitle="Configurá el comprobante y la cobranza del servicio. Nada se emite hasta el paso final."
    >
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="text-sm font-semibold text-brand-ink">
          <Receipt size={14} className="mr-1 inline" />
          {modo.titulo}
        </p>
        <p className="mt-1 text-sm text-brand-muted">{modo.detalle}</p>
      </div>
    </StepPanel>
  );
}
