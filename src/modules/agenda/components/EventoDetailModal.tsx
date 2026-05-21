import { Link } from 'react-router-dom';
import {
  Building2,
  Users2,
  Clock,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  ExternalLink,
  Tag,
} from 'lucide-react';
import { Modal, Button } from '@/components/common';
import { cn } from '@/lib/cn';
import {
  AGENDA_CATEGORIA_LABEL,
  AGENDA_PRIORIDAD_LABEL,
  type EventoAgenda,
  type AgendaCategoria,
  type AgendaPrioridad,
} from '@/services/api/agenda';

interface Props {
  evento: EventoAgenda | null;
  onClose: () => void;
  onCompletar: (e: EventoAgenda) => void;
  onCancelar: (e: EventoAgenda) => void;
}

export function EventoDetailModal({ evento, onClose, onCompletar, onCancelar }: Props) {
  if (!evento) return null;
  const fechaTxt = new Date(evento.fechaInicio).toLocaleString('es-AR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: evento.todoElDia ? undefined : '2-digit',
    minute: evento.todoElDia ? undefined : '2-digit',
  });
  const completado = !!evento.completadoAt;

  return (
    <Modal
      open={!!evento}
      onClose={onClose}
      kicker={AGENDA_CATEGORIA_LABEL[evento.categoria as AgendaCategoria] ?? 'Evento'}
      title={evento.titulo}
      width={560}
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          {!completado && (
            <>
              <Button variant="ghost" onClick={() => onCancelar(evento)}>
                <XCircle size={14} /> Cancelar evento
              </Button>
              <Button onClick={() => onCompletar(evento)}>
                <CheckCircle2 size={14} /> Marcar como completado
              </Button>
            </>
          )}
          {completado && <Button onClick={onClose}>Cerrar</Button>}
        </div>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 font-semibold text-brand-ink">
            <Clock size={11} /> {fechaTxt}
          </span>
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 font-semibold',
              prioridadTone(evento.prioridad as AgendaPrioridad),
            )}
          >
            <Tag size={11} /> {AGENDA_PRIORIDAD_LABEL[evento.prioridad as AgendaPrioridad]}
          </span>
          {evento.categoria === 'vencimiento' && (
            <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 font-semibold text-amber-700">
              <AlertTriangle size={11} /> Vencimiento
            </span>
          )}
        </div>

        {evento.descripcion && (
          <p className="rounded-lg bg-slate-50 p-3 text-sm text-brand-ink/90">
            {evento.descripcion}
          </p>
        )}

        <div className="grid gap-2 text-sm">
          {evento.clienteNombre && (
            <div className="flex items-center gap-2 text-brand-muted">
              <Building2 size={14} className="text-brand-cyan" />
              <span>Cliente: <span className="font-semibold text-brand-ink">{evento.clienteNombre}</span></span>
            </div>
          )}
          {evento.responsableNombre && (
            <div className="flex items-center gap-2 text-brand-muted">
              <Users2 size={14} className="text-brand-cyan" />
              <span>Responsable: <span className="font-semibold text-brand-ink">{evento.responsableNombre}</span></span>
            </div>
          )}
          {evento.servicioNombre && (
            <div className="flex items-center gap-2 text-brand-muted">
              <Tag size={14} className="text-brand-cyan" />
              <span>Servicio: <span className="font-semibold text-brand-ink">{evento.servicioNombre}</span></span>
            </div>
          )}
        </div>

        {evento.tramiteId && (
          <Link
            to={`/gerencia/tramites/${evento.tramiteId}`}
            className="inline-flex items-center gap-1 text-sm font-semibold text-brand-cyan hover:underline"
          >
            Ir al trámite vinculado <ExternalLink size={12} />
          </Link>
        )}
        {evento.vencimientoId && (
          <Link
            to={`/gerencia/vencimientos`}
            className="inline-flex items-center gap-1 text-sm font-semibold text-brand-cyan hover:underline"
          >
            Ver vencimiento <ExternalLink size={12} />
          </Link>
        )}
      </div>
    </Modal>
  );
}

function prioridadTone(p: AgendaPrioridad): string {
  switch (p) {
    case 'urgente': return 'bg-rose-50 text-rose-700 border-rose-200';
    case 'alta': return 'bg-amber-50 text-amber-700 border-amber-200';
    case 'baja': return 'bg-slate-100 text-slate-600 border-slate-200';
    default: return 'bg-brand-cyan-pale/40 text-brand-cyan border-brand-cyan/30';
  }
}
