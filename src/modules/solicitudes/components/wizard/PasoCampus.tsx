// Paso 6 · Campus (sólo si el servicio es curso o webinar).
// (Chunk A: placeholder. Chunk D completa el selector de curso/webinar
//  publicado. Collect-only: la matriculación se ejecuta en el ProcesadorFinal.)

import { GraduationCap } from 'lucide-react';
import { StepPanel } from '@/components/common';
import type { PasoProps } from './types';

export function PasoCampus({ flags }: PasoProps) {
  return (
    <StepPanel
      stepKey="campus"
      title="6 · Campus"
      subtitle="Iniciá la matriculación para que el cliente ya tenga habilitado el curso o webinar en su portal."
    >
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="text-sm font-semibold text-brand-ink">
          <GraduationCap size={14} className="mr-1 inline" />
          {flags.esCurso ? 'Curso' : 'Webinar'}
        </p>
        <p className="mt-1 text-sm text-brand-muted">
          Vas a poder elegir el {flags.esCurso ? 'curso' : 'webinar'} publicado al que se
          matricula el cliente.
        </p>
      </div>
    </StepPanel>
  );
}
