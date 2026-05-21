import { useMemo } from 'react';
import { cn } from '@/lib/cn';
import { eventosDeLaSemana, type EventoAgenda } from '@/services/api/agenda';
import { EventoCard } from './EventoCard';

interface Props {
  anchor: Date;
  eventos: EventoAgenda[];
  onSelect: (e: EventoAgenda) => void;
}

const DIAS_LABEL = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

export function CalendarioSemana({ anchor, eventos, onSelect }: Props) {
  const { desde } = eventosDeLaSemana(anchor);
  const dias = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(desde);
      d.setDate(d.getDate() + i);
      return d;
    });
  }, [desde]);

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

  return (
    <div className="card-premium overflow-hidden p-4">
      <div className="grid grid-cols-7 gap-2">
        {dias.map((d, i) => {
          const key = d.toDateString();
          const arr = porDia.get(key) ?? [];
          const esHoy = key === hoyKey;
          return (
            <div key={key} className="min-h-[180px]">
              <div
                className={cn(
                  'mb-2 rounded-md px-2 py-1 text-center text-xs font-semibold',
                  esHoy
                    ? 'bg-brand-cyan text-white'
                    : 'bg-slate-100 text-brand-ink',
                )}
              >
                <div className="opacity-80">{DIAS_LABEL[i]}</div>
                <div className="text-base">{d.getDate()}</div>
              </div>
              <div className="grid gap-1.5">
                {arr.length === 0 ? (
                  <div className="rounded-md border border-dashed border-slate-200 px-2 py-3 text-center text-[11px] text-brand-muted">
                    Sin eventos
                  </div>
                ) : (
                  arr.map((e) => (
                    <EventoCard
                      key={e.id}
                      evento={e}
                      compacto
                      onClick={() => onSelect(e)}
                    />
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
