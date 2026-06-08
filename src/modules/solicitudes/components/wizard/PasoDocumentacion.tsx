// Paso 2 · Revisar documentación y pagos.
// (Chunk A: placeholder navegable que ya lista los adjuntos del formulario.
//  Chunk B completa el ✓/✗ por archivo + visor + las ramas terminales
//  completa / pedir-docs-y-avanzar / revisión / rechazo / descarte.)

import { FileText } from 'lucide-react';
import { StepPanel } from '@/components/common';
import type { PasoProps } from './types';

export function PasoDocumentacion({ solicitud }: PasoProps) {
  const adjuntos = solicitud.submission_adjuntos ?? [];
  return (
    <StepPanel
      stepKey="documentacion"
      title="2 · Revisar documentación y pagos"
      subtitle="Revisá lo que adjuntó el solicitante y marcá cada archivo como correcto o incorrecto. De ahí se decide si la documentación está completa o si hay que pedir faltantes."
    >
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand-muted">
          <FileText size={12} className="mr-1 inline" />
          {adjuntos.length} archivo{adjuntos.length === 1 ? '' : 's'} adjunto
          {adjuntos.length === 1 ? '' : 's'}
        </p>
        {adjuntos.length === 0 ? (
          <p className="mt-2 text-sm text-brand-muted">
            La solicitud no trae archivos adjuntos.
          </p>
        ) : (
          <ul className="mt-2 space-y-1 text-sm text-brand-ink">
            {adjuntos.map((a, i) => (
              <li key={i} className="truncate">
                <span className="text-brand-muted">{a.campo}:</span> {a.nombre}
              </li>
            ))}
          </ul>
        )}
      </div>
    </StepPanel>
  );
}
