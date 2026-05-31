// Tooltip premium para eventos proyectados (3.B).
//
// Reemplaza el `title=` HTML nativo (que tarda 1s+ y no se puede estilar)
// con un mini-popover que aparece a la derecha del item al hover. Muestra:
// título completo, fecha legible, categoría/hint, estado, fuente.
//
// Si no hay espacio a la derecha, se voltea a la izquierda automáticamente.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Lock } from 'lucide-react';
import type { OcurrenciaUnificada } from '@/services/api/agenda';
import { FUENTE_LABEL, colorDeFuente } from '../fuenteColor';

interface Props {
  proyectada: OcurrenciaUnificada;
  children: ReactNode;
  /** ms de delay antes de mostrar (def 250). */
  delay?: number;
}

function fechaCorta(iso: string, allDay: boolean): string {
  const d = new Date(iso);
  if (allDay) {
    return d.toLocaleDateString('es-AR', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    });
  }
  return d.toLocaleString('es-AR', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function HoverPreview({ proyectada, children, delay = 250 }: Props) {
  const wrapRef = useRef<HTMLSpanElement | null>(null);
  const [open, setOpen] = useState(false);
  const [flipped, setFlipped] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!open) return;
    // Auto-flip si nos vamos del viewport por la derecha.
    const el = wrapRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.right + 240 > window.innerWidth) setFlipped(true);
    else setFlipped(false);
  }, [open]);

  function handleEnter() {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setOpen(true), delay);
  }
  function handleLeave() {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    setOpen(false);
  }

  const color = colorDeFuente(proyectada.fuente);

  return (
    <span
      ref={wrapRef}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      onFocus={handleEnter}
      onBlur={handleLeave}
      className="relative inline-block w-full"
    >
      {children}
      {open && (
        <span
          role="tooltip"
          className={`pointer-events-none absolute top-1/2 z-30 hidden w-60 -translate-y-1/2 rounded-lg border border-slate-200 bg-white p-2.5 text-left shadow-xl sm:block ${
            flipped ? 'right-full mr-2' : 'left-full ml-2'
          }`}
        >
          <span
            className="mb-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white"
            style={{ background: color }}
          >
            <Lock size={9} />
            {FUENTE_LABEL[proyectada.fuente]}
          </span>
          <p className="line-clamp-2 text-sm font-semibold leading-tight text-brand-ink">
            {proyectada.title}
          </p>
          <p className="mt-1 text-[11px] capitalize text-brand-muted">
            {fechaCorta(proyectada.startAt, proyectada.allDay)}
          </p>
          {proyectada.categoryHint && (
            <p className="mt-0.5 text-[10px] text-brand-muted/80">
              {proyectada.categoryHint}
            </p>
          )}
          {proyectada.estado && (
            <span className="mt-1.5 inline-block rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-brand-muted">
              {proyectada.estado}
            </span>
          )}
        </span>
      )}
    </span>
  );
}
