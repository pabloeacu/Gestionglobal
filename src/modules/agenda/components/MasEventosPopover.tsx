// Popover "+N más" para Vista Mes (3.H).
//
// Cuando la cantidad de eventos de un día supera MAX_VISIBLES, en vez de
// abrir solo el primero o cambiar a Vista Día, mostramos un popover anclado
// a la celda con la lista completa de items (personales + proyectados),
// cada uno clickeable hacia su respectiva acción.

import { useEffect, useRef } from 'react';
import { Lock } from 'lucide-react';
import type { Ocurrencia } from '@/lib/agendaRecurrencia';
import type { OcurrenciaUnificada, AgendaCategoria } from '@/services/api/agenda';
import { colorDeFuente } from '../fuenteColor';
import { CirculoHecha } from './CirculoHecha';

export type ItemCalendario =
  | { kind: 'personal'; ocurrencia: Ocurrencia }
  | { kind: 'proyectada'; proyeccion: OcurrenciaUnificada };

interface Props {
  fecha: Date;
  items: ItemCalendario[];
  categorias: AgendaCategoria[];
  x: number;
  y: number;
  onClose: () => void;
  onAbrirAcciones: (oc: Ocurrencia, x: number, y: number) => void;
  onToggleDone: (oc: Ocurrencia) => void;
  onAbrirProyectada?: (p: OcurrenciaUnificada) => void;
}

export function MasEventosPopover({
  fecha,
  items,
  categorias,
  x,
  y,
  onClose,
  onAbrirAcciones,
  onToggleDone,
  onAbrirProyectada,
}: Props) {
  const ref = useRef<HTMLDivElement | null>(null);

  // Click fuera + ESC para cerrar.
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) onClose();
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  // Clamp posición al viewport.
  const W = 260;
  const H = Math.min(420, items.length * 40 + 80);
  const left = Math.min(Math.max(8, x), window.innerWidth - W - 8);
  const top = Math.min(Math.max(8, y), window.innerHeight - H - 8);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={`Eventos del ${fecha.toLocaleDateString('es-AR')}`}
      className="fixed z-50 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl motion-safe:animate-spring-in"
      style={{ left, top, width: W }}
    >
      <header className="border-b border-slate-100 bg-brand-zebra/40 px-3 py-2">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-brand-muted">
          Eventos
        </p>
        <h3 className="text-sm font-semibold capitalize text-brand-ink">
          {fecha.toLocaleDateString('es-AR', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
          })}
        </h3>
      </header>
      <ul className="max-h-[360px] divide-y divide-slate-100 overflow-y-auto py-1">
        {items.map((it, idx) => {
          if (it.kind === 'personal') {
            const oc = it.ocurrencia;
            const cat = categorias.find((c) => c.id === oc.evento.categoryId);
            const color = oc.evento.colorOverride ?? cat?.color ?? '#06b6d4';
            return (
              <li key={`p-${oc.key}-${idx}`}>
                <button
                  type="button"
                  onClick={(e) => onAbrirAcciones(oc, e.clientX, e.clientY)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-brand-cyan-pale/30"
                >
                  <CirculoHecha
                    isDone={oc.isDone}
                    onToggle={() => onToggleDone(oc)}
                    size={12}
                  />
                  <span
                    className="block h-2 w-2 shrink-0 rounded-full"
                    style={{ background: color }}
                  />
                  <span
                    className={`min-w-0 flex-1 truncate ${
                      oc.isDone ? 'text-brand-muted line-through' : 'text-brand-ink'
                    }`}
                  >
                    {oc.evento.title}
                  </span>
                  {oc.startAt && !oc.evento.allDay && (
                    <span className="text-[10px] text-brand-muted">
                      {new Date(oc.startAt).toLocaleTimeString('es-AR', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  )}
                </button>
              </li>
            );
          }
          const p = it.proyeccion;
          const cf = colorDeFuente(p.fuente);
          return (
            <li key={`pr-${p.fuente}-${p.origenId}-${idx}`}>
              <button
                type="button"
                onClick={() => onAbrirProyectada?.(p)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-brand-cyan-pale/30"
              >
                <Lock size={11} className="shrink-0 text-brand-muted" />
                <span
                  className="block h-2 w-2 shrink-0 rounded-full"
                  style={{ background: cf }}
                />
                <span className="min-w-0 flex-1 truncate text-brand-ink/80">{p.title}</span>
                {!p.allDay && (
                  <span className="text-[10px] text-brand-muted">
                    {new Date(p.startAt).toLocaleTimeString('es-AR', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
