// ============================================================================
// PeriodSelector · dropdown global de período (P2-#13)
//
// Se ubica en el header de GerenciaLayout, entre la búsqueda y la campana.
// Toggle compacto con label "Últimos 30 días ▾" y popover con las 5 opciones.
// ============================================================================

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, CalendarRange, Check } from 'lucide-react';
import {
  PERIOD_OPTIONS,
  usePeriod,
  usePeriodSetter,
  type PeriodKind,
} from '@/contexts/GlobalPeriodContext';
import { cn } from '@/lib/cn';

export function PeriodSelector() {
  const period = usePeriod();
  const setPeriod = usePeriodSetter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function select(kind: PeriodKind) {
    setPeriod(kind);
    setOpen(false);
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-brand-ink transition hover:border-brand-cyan/40',
          open && 'border-brand-cyan/40 bg-brand-cyan/5',
        )}
        aria-expanded={open}
        aria-haspopup="listbox"
        title={`Período actual: ${period.label}`}
      >
        <CalendarRange size={13} className="text-brand-cyan" />
        <span className="hidden sm:inline">{period.label}</span>
        <span className="sm:hidden">
          {PERIOD_OPTIONS.find((o) => o.kind === period.kind)?.label}
        </span>
        <ChevronDown
          size={12}
          className={cn('transition-transform', open && 'rotate-180')}
        />
      </button>
      {open && (
        <ul
          role="listbox"
          aria-label="Período"
          className="absolute right-0 top-full z-40 mt-2 w-44 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_18px_40px_-10px_rgba(18,34,48,0.25)] motion-safe:animate-fade-up"
        >
          {PERIOD_OPTIONS.map((o) => {
            const isSelected = o.kind === period.kind;
            return (
              <li key={o.kind}>
                <button
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => select(o.kind)}
                  className={cn(
                    'flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition',
                    isSelected
                      ? 'bg-brand-cyan/10 text-brand-cyan'
                      : 'text-brand-ink hover:bg-slate-50',
                  )}
                >
                  <span>{o.label}</span>
                  {isSelected && <Check size={12} />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
