// AccionesMenu — menú flotante con clamp robusto al viewport (E7).
// useLayoutEffect mide el alto REAL del menú renderizado y reposiciona;
// recalcula cuando se expande el submenú "Posponer" (sino se corta abajo).
import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  CalendarClock,
  Check,
  ChevronRight,
  Pencil,
  Trash2,
} from 'lucide-react';

export type PostergarDest = 'manana' | 'semana' | 'mes' | 'personalizado';

interface Props {
  x: number;
  y: number;
  titulo: string;
  fechaLabel?: string | null;
  isDone: boolean;
  esRecurrente: boolean;
  onClose: () => void;
  onToggleDone: () => void;
  onEditar: () => void;
  onPosponer: (dest: PostergarDest) => void;
  onEliminar: () => void;
}

export function AccionesMenu({
  x,
  y,
  titulo,
  fechaLabel,
  isDone,
  esRecurrente,
  onClose,
  onToggleDone,
  onEditar,
  onPosponer,
  onEliminar,
}: Props) {
  const [subOpen, setSubOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const m = 12;
    setPos({
      left: Math.max(8, Math.min(x, window.innerWidth - width - m)),
      top: Math.max(8, Math.min(y, window.innerHeight - height - m)),
    });
  }, [x, y, subOpen]);

  return createPortal(
    <div className="fixed inset-0 z-[70]" onClick={onClose}>
      <div
        ref={menuRef}
        className="fixed w-60 rounded-xl border border-slate-200 bg-white py-1 text-sm shadow-2xl"
        style={{ left: pos.left, top: pos.top }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-slate-100 px-3 py-2">
          <div className="line-clamp-1 font-medium text-brand-ink">{titulo}</div>
          {fechaLabel && <div className="text-xs text-brand-muted">{fechaLabel}</div>}
        </div>

        <button
          type="button"
          className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-slate-50"
          onClick={() => {
            onToggleDone();
            onClose();
          }}
        >
          <Check size={14} className="text-emerald-600" />
          {isDone ? 'Marcar como pendiente' : 'Marcar como hecha'}
        </button>

        <button
          type="button"
          className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-slate-50"
          onClick={() => {
            onEditar();
            onClose();
          }}
        >
          <Pencil size={14} className="text-slate-600" />
          Editar
        </button>

        <button
          type="button"
          className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-slate-50"
          onClick={() => setSubOpen((v) => !v)}
        >
          <span className="flex items-center gap-2">
            <CalendarClock size={14} className="text-brand-cyan" />
            Posponer
          </span>
          <ChevronRight
            size={14}
            className={`text-slate-400 transition-transform ${subOpen ? 'rotate-90' : ''}`}
          />
        </button>
        {subOpen && (
          <div className="bg-slate-50/60 py-1">
            {[
              { id: 'manana' as const, label: '1 día' },
              { id: 'semana' as const, label: '1 semana' },
              { id: 'mes' as const, label: '1 mes' },
              { id: 'personalizado' as const, label: 'Personalizado...' },
            ].map((opt) => (
              <button
                key={opt.id}
                type="button"
                className="block w-full px-6 py-1.5 text-left text-xs text-brand-ink hover:bg-white"
                onClick={() => {
                  onPosponer(opt.id);
                  onClose();
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}

        <div className="my-1 border-t border-slate-100" />
        <button
          type="button"
          className="flex w-full items-center gap-2 px-3 py-2 text-left text-rose-600 hover:bg-rose-50"
          onClick={() => {
            onEliminar();
            onClose();
          }}
        >
          <Trash2 size={14} />
          {esRecurrente ? 'Saltear esta ocurrencia' : 'Eliminar'}
        </button>
      </div>
    </div>,
    document.body,
  );
}
