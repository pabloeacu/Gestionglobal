import { useMemo, useState } from 'react';
import { cn } from '@/lib/cn';
import { eventosDelMes, type EventoAgenda } from '@/services/api/agenda';

interface Props {
  anchor: Date;
  eventos: EventoAgenda[];
  onSelect: (e: EventoAgenda) => void;
  onPickDay?: (d: Date) => void;
}

const DIAS_LABEL = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

export function CalendarioMes({ anchor, eventos, onSelect, onPickDay }: Props) {
  const { desde, hasta } = eventosDelMes(anchor.getFullYear(), anchor.getMonth());
  const [hover, setHover] = useState<string | null>(null);

  const dias = useMemo(() => {
    const out: Date[] = [];
    const d = new Date(desde);
    while (d < hasta) {
      out.push(new Date(d));
      d.setDate(d.getDate() + 1);
    }
    return out;
  }, [desde, hasta]);

  const porDia = useMemo(() => {
    const m = new Map<string, EventoAgenda[]>();
    for (const e of eventos) {
      const k = new Date(e.fechaInicio).toDateString();
      const arr = m.get(k) ?? [];
      arr.push(e);
      m.set(k, arr);
    }
    return m;
  }, [eventos]);

  const hoyKey = new Date().toDateString();
  const mesActual = anchor.getMonth();

  return (
    <div className="card-premium overflow-hidden p-4">
      <div className="mb-2 grid grid-cols-7 gap-2">
        {DIAS_LABEL.map((d) => (
          <div key={d} className="text-center text-xs font-semibold text-brand-muted">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-2">
        {dias.map((d) => {
          const key = d.toDateString();
          const arr = porDia.get(key) ?? [];
          const otroMes = d.getMonth() !== mesActual;
          const esHoy = key === hoyKey;
          const isHovered = hover === key;
          return (
            <div
              key={key}
              onMouseEnter={() => setHover(key)}
              onMouseLeave={() => setHover((cur) => (cur === key ? null : cur))}
              onClick={() => onPickDay?.(d)}
              className={cn(
                'relative min-h-[88px] cursor-pointer rounded-lg border bg-white p-2 transition hover:shadow-md',
                otroMes ? 'opacity-40' : '',
                esHoy ? 'border-brand-cyan ring-1 ring-brand-cyan/30' : 'border-slate-200',
              )}
            >
              <div
                className={cn(
                  'text-right text-xs font-semibold',
                  esHoy ? 'text-brand-cyan' : 'text-brand-ink',
                )}
              >
                {d.getDate()}
              </div>
              <div className="mt-1 flex flex-wrap gap-1">
                {arr.slice(0, 3).map((e) => (
                  <span
                    key={e.id}
                    className={cn(
                      'h-1.5 w-1.5 rounded-full',
                      dotColor(e.prioridad),
                    )}
                    title={e.titulo}
                  />
                ))}
                {arr.length > 3 && (
                  <span className="text-[9px] font-semibold text-brand-muted">
                    +{arr.length - 3}
                  </span>
                )}
              </div>

              {/* Hover preview */}
              {isHovered && arr.length > 0 && (
                <div className="pointer-events-none absolute left-0 top-full z-20 mt-1 w-56 rounded-lg border border-slate-200 bg-white p-2 text-left shadow-lg">
                  {arr.slice(0, 4).map((e) => (
                    <button
                      type="button"
                      key={e.id}
                      onClick={(ev) => {
                        ev.stopPropagation();
                        onSelect(e);
                      }}
                      className="pointer-events-auto block w-full truncate rounded px-1 py-0.5 text-left text-xs hover:bg-slate-50"
                    >
                      <span
                        className={cn('mr-1 inline-block h-1.5 w-1.5 rounded-full align-middle', dotColor(e.prioridad))}
                      />
                      {e.titulo}
                    </button>
                  ))}
                  {arr.length > 4 && (
                    <p className="px-1 pt-1 text-[10px] text-brand-muted">
                      Y {arr.length - 4} más…
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function dotColor(p: string): string {
  switch (p) {
    case 'urgente': return 'bg-rose-500';
    case 'alta': return 'bg-amber-500';
    case 'baja': return 'bg-slate-400';
    default: return 'bg-brand-cyan';
  }
}
