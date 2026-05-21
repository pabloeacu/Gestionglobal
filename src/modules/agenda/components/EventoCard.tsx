import { Building2, Clock, Users2, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { EventoAgenda, AgendaPrioridad } from '@/services/api/agenda';

const PRIORIDAD_TONE: Record<AgendaPrioridad, string> = {
  baja: 'bg-slate-100 text-slate-600 border-slate-200',
  normal: 'bg-brand-cyan-pale/40 text-brand-cyan border-brand-cyan/30',
  alta: 'bg-amber-50 text-amber-700 border-amber-200',
  urgente: 'bg-rose-50 text-rose-700 border-rose-200',
};

interface Props {
  evento: EventoAgenda;
  compacto?: boolean;
  onClick?: () => void;
}

export function EventoCard({ evento, compacto = false, onClick }: Props) {
  const hora = evento.todoElDia
    ? 'Todo el día'
    : new Date(evento.fechaInicio).toLocaleTimeString('es-AR', {
        hour: '2-digit',
        minute: '2-digit',
      });
  const completado = !!evento.completadoAt;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group relative w-full overflow-hidden rounded-lg border bg-white p-3 text-left shadow-sm transition hover:shadow-md',
        completado ? 'border-slate-200 opacity-70' : 'border-slate-200 hover:border-brand-cyan/50',
        compacto && 'p-2',
      )}
    >
      <div className="flex items-start gap-2">
        <span
          className={cn(
            'mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
            PRIORIDAD_TONE[evento.prioridad as AgendaPrioridad],
          )}
        >
          {evento.prioridad}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-brand-muted">
              <Clock size={11} />
              {hora}
            </span>
            {completado && (
              <span className="inline-flex items-center gap-1 text-[11px] text-emerald-700">
                <CheckCircle2 size={11} /> Completado
              </span>
            )}
          </div>
          <p
            className={cn(
              'mt-0.5 truncate font-display text-sm font-bold text-brand-ink',
              completado && 'line-through',
            )}
          >
            {evento.titulo}
          </p>
          {!compacto && (
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-brand-muted">
              {evento.clienteNombre && (
                <span className="inline-flex items-center gap-1">
                  <Building2 size={11} /> {evento.clienteNombre}
                </span>
              )}
              {evento.responsableNombre && (
                <span className="inline-flex items-center gap-1">
                  <Users2 size={11} /> {evento.responsableNombre}
                </span>
              )}
              {evento.categoria === 'vencimiento' && (
                <span className="inline-flex items-center gap-1 text-amber-700">
                  <AlertTriangle size={11} /> Vencimiento
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </button>
  );
}
