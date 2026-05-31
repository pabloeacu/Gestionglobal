// F4 · Indicador sutil de refresco para listados que usan useRefreshableData.
// Se muestra en lugar del flash blanco al guardar / al recibir un realtime
// event. Posición: top-right, no intrusivo, opacity-soft.

import { Loader2 } from 'lucide-react';

interface Props {
  /** Si false, no renderiza nada. */
  show: boolean;
  /** Texto custom. Default: "Actualizando…" */
  label?: string;
}

export function RefreshIndicator({ show, label = 'Actualizando…' }: Props) {
  if (!show) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed right-4 top-20 z-30 inline-flex items-center gap-2 rounded-full bg-brand-cyan/90 px-3 py-1 text-xs font-semibold text-white shadow-lg backdrop-blur motion-safe:animate-fade-in"
    >
      <Loader2 size={12} className="animate-spin" />
      {label}
    </div>
  );
}
