import { useMemo } from 'react';
import type { EventoAgenda } from '@/services/api/agenda';
import { EventoCard } from './EventoCard';

interface Props {
  anchor: Date;
  eventos: EventoAgenda[];
  onSelect: (e: EventoAgenda) => void;
}

const HORAS = Array.from({ length: 13 }, (_, i) => i + 7); // 7am .. 19pm

export function TimelineDia({ eventos, onSelect }: Props) {
  const eventosTodoElDia = useMemo(
    () => eventos.filter((e) => e.todoElDia),
    [eventos],
  );
  const porHora = useMemo(() => {
    const m = new Map<number, EventoAgenda[]>();
    for (const e of eventos) {
      if (e.todoElDia) continue;
      const h = new Date(e.fechaInicio).getHours();
      const arr = m.get(h) ?? [];
      arr.push(e);
      m.set(h, arr);
    }
    return m;
  }, [eventos]);

  return (
    <div className="card-premium overflow-hidden p-4">
      {eventosTodoElDia.length > 0 && (
        <div className="mb-4 border-b border-slate-200 pb-3">
          <p className="kicker mb-2 text-brand-muted">Todo el día</p>
          <div className="grid gap-2">
            {eventosTodoElDia.map((e) => (
              <EventoCard key={e.id} evento={e} onClick={() => onSelect(e)} />
            ))}
          </div>
        </div>
      )}
      <div className="space-y-2">
        {HORAS.map((h) => {
          const arr = porHora.get(h) ?? [];
          return (
            <div key={h} className="grid grid-cols-[64px_1fr] gap-3">
              <div className="pt-1 text-right text-xs font-semibold text-brand-muted">
                {String(h).padStart(2, '0')}:00
              </div>
              <div className="min-h-[44px] border-l border-slate-200 pl-3">
                {arr.length === 0 ? (
                  <div className="h-full" />
                ) : (
                  <div className="grid gap-2">
                    {arr.map((e) => (
                      <EventoCard key={e.id} evento={e} onClick={() => onSelect(e)} />
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
