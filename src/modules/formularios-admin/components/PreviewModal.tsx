// Modal de vista previa: rinde el schema actual con el `FormularioRunner`
// real, pero envuelto en un `FormularioRow` sintético (sin persistir).
//
// 4.C · toggle Desktop / Móvil / Ambos. "Móvil" encuadra el runner en un marco
// de 375px; "Ambos" muestra dos columnas (375px + full) lado a lado para cazar
// problemas de layout antes de publicar.

import { useState } from 'react';
import { Monitor, Smartphone, Columns2 } from 'lucide-react';
import { Modal } from '@/components/common';
import { cn } from '@/lib/cn';
import type { FormularioRow, FormularioSchemaDef } from '@/services/api/formularios';
import { FormularioRunner } from '@/modules/public/components/FormularioRunner';

interface PreviewModalProps {
  open: boolean;
  onClose: () => void;
  formulario: FormularioRow;
  schema: FormularioSchemaDef;
}

type Viewport = 'desktop' | 'movil' | 'ambos';

const VIEWPORTS: { key: Viewport; label: string; icon: typeof Monitor }[] = [
  { key: 'desktop', label: 'Desktop', icon: Monitor },
  { key: 'movil', label: 'Móvil', icon: Smartphone },
  { key: 'ambos', label: 'Ambos', icon: Columns2 },
];

export function PreviewModal({ open, onClose, formulario, schema }: PreviewModalProps) {
  const [viewport, setViewport] = useState<Viewport>('desktop');
  if (!open) return null;
  const previewRow: FormularioRow = {
    ...formulario,
    schema: schema as unknown as FormularioRow['schema'],
  };

  const runner = <FormularioRunner formulario={previewRow} />;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={formulario.titulo}
      kicker="Vista previa"
      width={viewport === 'ambos' ? 980 : 720}
    >
      <div className="space-y-3">
        {/* 4.C · toggle de viewport */}
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-amber-800">
            Vista del formulario tal como lo verán los visitantes.
          </p>
          <div className="inline-flex gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1">
            {VIEWPORTS.map((v) => {
              const Icon = v.icon;
              return (
                <button
                  key={v.key}
                  type="button"
                  onClick={() => setViewport(v.key)}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition',
                    viewport === v.key
                      ? 'bg-white text-brand-ink shadow-sm'
                      : 'text-brand-muted hover:text-brand-ink',
                  )}
                  aria-pressed={viewport === v.key}
                >
                  <Icon size={13} /> {v.label}
                </button>
              );
            })}
          </div>
        </div>

        <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          El botón Enviar intentará enviar de verdad — no lo uses para probar
          envíos hasta que el formulario esté activo.
        </p>

        {viewport === 'desktop' && <div>{runner}</div>}

        {viewport === 'movil' && (
          <div className="flex justify-center">
            <PhoneFrame>{runner}</PhoneFrame>
          </div>
        )}

        {viewport === 'ambos' && (
          <div className="grid gap-4 lg:grid-cols-[375px_1fr]">
            <div>
              <p className="mb-1 text-center text-[11px] font-semibold uppercase tracking-wider text-brand-muted">
                Móvil · 375px
              </p>
              <PhoneFrame>{<FormularioRunner formulario={previewRow} />}</PhoneFrame>
            </div>
            <div>
              <p className="mb-1 text-center text-[11px] font-semibold uppercase tracking-wider text-brand-muted">
                Desktop
              </p>
              <div className="rounded-xl border border-slate-200 p-3">
                <FormularioRunner formulario={previewRow} />
              </div>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

// Marco de teléfono de 375px para previsualizar el layout móvil.
function PhoneFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-[375px] max-w-full overflow-hidden rounded-[2rem] border-4 border-slate-800 bg-white shadow-xl">
      <div className="mx-auto mt-1 h-1 w-16 rounded-full bg-slate-300" />
      <div className="max-h-[70vh] overflow-y-auto p-4">{children}</div>
    </div>
  );
}
