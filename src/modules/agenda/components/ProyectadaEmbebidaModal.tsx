// B2 · Modal embebido del módulo origen.
//
// Al clickear un evento proyectado (vencimiento, trámite, comprobante,
// solicitud, alarma de tracking), en vez de navegar fuera de la Agenda
// abrimos este modal con un resumen contextual + CTA "Abrir el módulo".
// La idea (DGG-06): no perder el contexto del calendario. El gerente puede
// ver los datos clave al vuelo y decidir si entra al detalle completo o
// cierra y sigue planificando.
//
// El modal NO replica la pantalla completa del origen — sería brittle y
// rompería el patrón. Es un "preview" con los campos esenciales (fecha,
// monto cuando aplica, descripción, estado) + el botón que sí navega.

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowUpRight,
  CalendarClock,
  ExternalLink,
  FileText,
  Inbox,
  Lock,
  Sparkles,
  X,
} from 'lucide-react';
import { Button } from '@/components/common';
import { cn } from '@/lib/cn';
import type { OcurrenciaUnificada, AgendaFuente } from '@/services/api/agenda';
import { FUENTE_LABEL, colorDeFuente } from '../fuenteColor';

interface Props {
  proyectada: OcurrenciaUnificada | null;
  onClose: () => void;
}

function fechaLarga(iso: string, allDay: boolean): string {
  const d = new Date(iso);
  if (allDay) {
    return d.toLocaleDateString('es-AR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  }
  return d.toLocaleString('es-AR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function iconoFuente(f: AgendaFuente) {
  switch (f) {
    case 'vencimiento': return CalendarClock;
    case 'tramite': return Inbox;
    case 'comprobante': return FileText;
    case 'solicitud': return Sparkles;
    case 'tracking_alarma': return CalendarClock;
    default: return CalendarClock;
  }
}

function rutaModuloOrigen(item: OcurrenciaUnificada): string {
  switch (item.fuente) {
    case 'vencimiento':
      return '/gerencia/agenda/vencimientos';
    case 'tramite':
    case 'tracking_alarma':
      return `/gerencia/trackings/${item.origenId}`;
    case 'comprobante':
      return `/gerencia/facturacion/${item.origenId}`;
    case 'solicitud':
      return `/gerencia/solicitudes/${item.origenId}`;
    default:
      return '/gerencia';
  }
}

export function ProyectadaEmbebidaModal({ proyectada, onClose }: Props) {
  const navigate = useNavigate();
  const [closing, setClosing] = useState(false);
  // No hacemos fetch de detalle adicional: la VIEW gg_agenda_listar_unificada
  // ya devuelve los campos clave (title, color, categoryHint, estado, fecha).
  // Si en el futuro queremos enriquecer (p. ej. monto del comprobante), se
  // agrega aquí un useEffect con la API correspondiente.

  useEffect(() => {
    if (!proyectada) setClosing(false);
  }, [proyectada]);

  if (!proyectada) return null;

  const color = colorDeFuente(proyectada.fuente);
  const Icon = iconoFuente(proyectada.fuente);
  const ruta = rutaModuloOrigen(proyectada);

  function handleAbrirModulo() {
    setClosing(true);
    navigate(ruta);
    onClose();
  }

  return (
    <div
      role="dialog"
      aria-label="Detalle del evento proyectado"
      className="fixed inset-0 z-50 flex items-center justify-center bg-brand-ink/40 p-4 backdrop-blur-sm motion-safe:animate-fade-in"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={cn(
          'flex w-full max-w-md flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl motion-safe:animate-spring-in',
          closing && 'pointer-events-none opacity-50',
        )}
      >
        <div
          className="relative px-5 py-4"
          style={{
            background: `linear-gradient(135deg, ${color}15 0%, ${color}05 100%)`,
            borderBottom: `2px solid ${color}40`,
          }}
        >
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="absolute right-3 top-3 rounded-lg p-1.5 text-slate-500 hover:bg-white/60"
          >
            <X size={16} />
          </button>
          <div className="flex items-start gap-3">
            <span
              className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-white shadow-sm"
              style={{ background: color }}
            >
              <Icon size={18} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <span
                  className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white"
                  style={{ background: color }}
                >
                  <Lock size={9} />
                  {FUENTE_LABEL[proyectada.fuente]}
                </span>
                {proyectada.estado && (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-brand-muted">
                    {proyectada.estado}
                  </span>
                )}
              </div>
              <h2 className="font-display text-lg font-semibold leading-tight text-brand-ink">
                {proyectada.title}
              </h2>
            </div>
          </div>
        </div>

        <div className="space-y-3 px-5 py-4">
          <div className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-brand-ink">
            <CalendarClock size={14} className="text-brand-muted" />
            <span className="capitalize">
              {fechaLarga(proyectada.startAt, proyectada.allDay)}
            </span>
          </div>

          {proyectada.categoryHint && (
            <div className="rounded-lg border border-slate-100 bg-white px-3 py-2 text-sm text-brand-ink/80">
              <span className="block text-[10px] font-semibold uppercase tracking-wide text-brand-muted">
                Categoría
              </span>
              <span>{proyectada.categoryHint}</span>
            </div>
          )}

          <p className="rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2 text-xs text-amber-900">
            <Lock size={11} className="mr-1 inline" />
            Este evento se proyecta desde el módulo de origen. Para editarlo,
            entrá al módulo.
          </p>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-slate-100 bg-brand-zebra/40 px-5 py-3">
          <Button variant="ghost" onClick={onClose}>
            Cerrar
          </Button>
          <Button onClick={handleAbrirModulo}>
            <ArrowUpRight size={14} />
            Abrir el módulo
          </Button>
        </div>

        <div className="border-t border-slate-100 bg-white px-5 py-2 text-[10px] text-brand-muted">
          <span className="inline-flex items-center gap-1">
            <ExternalLink size={9} /> {ruta}
          </span>
        </div>
      </div>
    </div>
  );
}
