// Paso 5 · Tracking del servicio. Período + fecha de apertura + observaciones
// internas opcionales. Collect-only: el trámite se crea en el ProcesadorFinal
// (vía solicitud_activar, que también da de alta/vincula el cliente).

import { CalendarRange } from 'lucide-react';
import { Field, Input, StepPanel, Textarea } from '@/components/common';
import type { PasoProps } from './types';

export function PasoTracking({ state, set }: PasoProps) {
  return (
    <StepPanel
      stepKey="tracking"
      title="5 · Tracking del servicio"
      subtitle="Definí el período y la fecha de apertura. Podés sumar observaciones internas; si no, sólo se registra la fecha de inicio."
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Período" required hint="Ej: 2025, 2025-Q1, 2025-12">
          <Input
            value={state.periodo}
            onChange={(e) => set((s) => ({ ...s, periodo: e.target.value }))}
          />
        </Field>
        <Field label="Fecha de inicio" required>
          <Input
            type="date"
            value={state.fechaInicio}
            onChange={(e) => set((s) => ({ ...s, fechaInicio: e.target.value }))}
          />
        </Field>
      </div>

      <div className="mt-3">
        <Field label="Observaciones (opcional)">
          <Textarea
            rows={3}
            value={state.observacionesTracking}
            onChange={(e) => set((s) => ({ ...s, observacionesTracking: e.target.value }))}
            placeholder="Señalamientos internos sobre la apertura del trámite…"
          />
        </Field>
      </div>

      <div className="mt-4 rounded-lg border border-brand-cyan/30 bg-brand-cyan-pale/30 p-3 text-xs">
        <p className="font-semibold text-brand-ink">
          <CalendarRange size={11} className="mr-1 inline" />
          Al procesar
        </p>
        <ul className="mt-1 list-disc space-y-0.5 pl-4 text-brand-muted">
          <li>Se abre el trámite del servicio para el período {state.periodo || '—'}.</li>
          <li>
            {state.modoCliente === 'nuevo'
              ? 'Se da de alta al cliente y se le envía la bienvenida con credenciales.'
              : 'Se vincula al cliente existente sin duplicar.'}
          </li>
          <li>El cliente puede seguir el avance desde su portal.</li>
        </ul>
      </div>
    </StepPanel>
  );
}
