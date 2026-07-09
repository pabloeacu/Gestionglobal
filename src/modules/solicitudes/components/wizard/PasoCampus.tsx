// Paso 6 · Campus (sólo si el servicio es curso o webinar).
// Collect-only: gerencia elige el curso/webinar publicado a matricular. La
// matrícula/inscripción se ejecuta en el ProcesadorFinal. Es opcional: si se
// deja vacío, no se matricula (se puede hacer después desde Campus).

import { useEffect, useState } from 'react';
import { GraduationCap } from 'lucide-react';
import { Field, Select, StepPanel } from '@/components/common';
import { listCursos, type CursoListItem } from '@/services/api/campus';
import { listWebinars, type WebinarRow } from '@/services/api/webinars';
import type { PasoProps } from './types';

export function PasoCampus({ flags, state, set }: PasoProps) {
  const [cursos, setCursos] = useState<CursoListItem[]>([]);
  const [webinars, setWebinars] = useState<WebinarRow[]>([]);

  useEffect(() => {
    if (flags.esCurso) {
      // listCursos por default ya filtra activo=true (cursos vigentes).
      void listCursos().then((r) => {
        if (r.ok) setCursos(r.data);
      });
    }
    if (flags.esWebinar) {
      void listWebinars().then((r) => {
        if (r.ok) setWebinars(r.data);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <StepPanel
      stepKey="campus"
      title="6 · Campus"
      subtitle="Opcional. Matriculá al cliente para que tenga el curso o evento habilitado en su portal apenas se active."
    >
      {flags.esCurso && (
        <Field label="Curso a matricular" hint="Opcional. Dejalo vacío si lo asignás después.">
          <Select
            value={state.campus.cursoId ?? ''}
            onChange={(e) =>
              set((s) => ({ ...s, campus: { ...s.campus, cursoId: e.target.value || null } }))
            }
          >
            <option value="">— No matricular ahora —</option>
            {cursos.map((c) => (
              <option key={c.id} value={c.id}>
                {c.titulo}
              </option>
            ))}
          </Select>
        </Field>
      )}
      {flags.esWebinar && (
        <Field label="Evento a inscribir" hint="Opcional.">
          <Select
            value={state.campus.webinarId ?? ''}
            onChange={(e) =>
              set((s) => ({ ...s, campus: { ...s.campus, webinarId: e.target.value || null } }))
            }
          >
            <option value="">— No inscribir ahora —</option>
            {webinars.map((w) => (
              <option key={w.id} value={w.id}>
                {w.titulo}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <div className="mt-3 rounded-lg border border-brand-cyan/30 bg-brand-cyan-pale/30 p-3 text-xs text-brand-muted">
        <GraduationCap size={12} className="mr-1 inline" />
        Si elegís uno, al procesar se crea la matrícula/inscripción y el cliente lo verá en su
        portal.
      </div>
    </StepPanel>
  );
}
