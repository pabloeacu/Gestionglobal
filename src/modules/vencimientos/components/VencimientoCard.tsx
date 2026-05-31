import { Link } from 'react-router-dom';
import {
  CalendarClock,
  AlertTriangle,
  Inbox,
  PauseCircle,
  PlayCircle,
  Sparkles,
  Trash2,
  ChevronRight,
} from 'lucide-react';
import { Button } from '@/components/common';
import { cn } from '@/lib/cn';
import { formatDateLong } from '@/lib/dates';
import {
  CRITICIDAD_BADGE,
  CRITICIDAD_LABEL,
  VENCIMIENTO_TIPO_LABEL,
  criticidad,
  type ProximoVencimiento,
} from '@/services/api/vencimientos';

interface Props {
  venc: ProximoVencimiento;
  /** FIX-V2 · gerencia NO renueva — la renovación viene del cliente con
   * el formulario que corresponda. Sustituido por gestión de alertas. */
  onPausar?: (v: ProximoVencimiento) => void;
  onReanudar?: (v: ProximoVencimiento) => void;
  onEliminar?: (v: ProximoVencimiento) => void;
  compact?: boolean;
}

export function VencimientoCard({
  venc,
  onPausar,
  onReanudar,
  onEliminar,
  compact,
}: Props) {
  const crit = criticidad(venc.dias_restantes);
  const sujetoNombre =
    venc.sujeto === 'consorcio' && venc.consorcio_nombre
      ? venc.consorcio_nombre
      : venc.administracion_nombre;
  const pausado = !!venc.pausado_at;

  const diasTxt =
    venc.dias_restantes < 0
      ? `Venció hace ${Math.abs(venc.dias_restantes)} ${
          Math.abs(venc.dias_restantes) === 1 ? 'día' : 'días'
        }`
      : venc.dias_restantes === 0
        ? 'Vence hoy'
        : `Faltan ${venc.dias_restantes} ${
            venc.dias_restantes === 1 ? 'día' : 'días'
          }`;

  return (
    <article
      className={cn(
        'group relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-brand-cyan hover:shadow-md',
        compact && 'p-3',
      )}
    >
      {/* Acento cian sutil arriba */}
      <span
        aria-hidden
        className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-brand-cyan/0 via-brand-cyan/60 to-brand-cyan/0 opacity-60"
      />

      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <CalendarClock
              size={16}
              className="shrink-0 text-brand-cyan"
              aria-hidden
            />
            <p className="truncate text-[11px] font-semibold uppercase tracking-wider text-brand-muted">
              {VENCIMIENTO_TIPO_LABEL[venc.tipo]}
            </p>
          </div>
          <h3 className="mt-1 truncate font-display text-base font-semibold text-brand-ink">
            {sujetoNombre}
          </h3>
          {venc.sujeto === 'consorcio' && (
            <p className="truncate text-xs text-brand-muted">
              {venc.administracion_nombre}
            </p>
          )}
        </div>
        <span
          className={cn(
            'inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold',
            CRITICIDAD_BADGE[crit],
          )}
        >
          {crit === 'vencida' || crit === 'critica' ? (
            <AlertTriangle size={11} />
          ) : null}
          {CRITICIDAD_LABEL[crit]}
        </span>
      </header>

      <div className="mt-3 flex items-baseline gap-3">
        <p className="text-sm font-semibold text-brand-ink">
          {formatDateLong(venc.fecha_vencimiento)}
        </p>
        <p
          className={cn(
            'text-xs',
            crit === 'vencida' || crit === 'critica'
              ? 'font-semibold text-red-600'
              : crit === 'proxima'
                ? 'font-semibold text-amber-600'
                : 'text-brand-muted',
          )}
        >
          {diasTxt}
        </p>
      </div>

      {venc.descripcion && (
        <p className="mt-2 line-clamp-2 text-xs text-brand-muted">
          {venc.descripcion}
        </p>
      )}

      {venc.sugerencia_servicio_slug && (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-brand-cyan/30 bg-brand-cyan/5 px-3 py-2 text-xs text-brand-ink">
          <Sparkles size={13} className="text-brand-cyan" />
          <span className="flex-1">
            Sugerí el servicio{' '}
            <Link
              to={`/gerencia/clientes/${venc.administracion_id}`}
              className="font-medium text-brand-cyan hover:underline"
            >
              {venc.sugerencia_servicio_slug}
            </Link>
          </span>
        </div>
      )}

      {/* 6.F · chip "Desde tracking": linkea al detalle del trámite que
          generó este vencimiento (DGG-07). */}
      {venc.tracking_id && (
        <Link
          to={`/gerencia/trackings/${venc.tracking_id}`}
          className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[10px] font-medium text-violet-700 transition hover:bg-violet-100"
          title="Generado desde un tracking · abrir detalle"
          onClick={(e) => e.stopPropagation()}
        >
          <Inbox size={10} />
          Desde tracking
          <ChevronRight size={10} />
        </Link>
      )}

      {/* FIX-V2 · estado pausa visible (alertas suspendidas) */}
      {pausado && (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <PauseCircle size={14} className="shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold">Alertas pausadas</p>
            {venc.motivo_pausa && (
              <p className="truncate text-amber-700/80">{venc.motivo_pausa}</p>
            )}
          </div>
        </div>
      )}

      {/* FIX-V2 · acciones de management de alertas (no de "renovar") */}
      {(onPausar || onReanudar || onEliminar) && !compact && (
        <footer className="mt-3 flex flex-wrap items-center justify-end gap-2">
          {onEliminar && (
            <Button
              variant="ghost"
              onClick={() => onEliminar(venc)}
              title="Eliminar este vencimiento"
              className="!px-2 !py-1.5 !text-xs text-rose-600 hover:!bg-rose-50"
            >
              <Trash2 size={13} />
              <span className="hidden sm:inline">Eliminar</span>
            </Button>
          )}
          {pausado
            ? onReanudar && (
                <Button
                  variant="tonal"
                  onClick={() => onReanudar(venc)}
                  title="Reanudar las alertas automáticas"
                  className="!px-3 !py-1.5 !text-xs"
                >
                  <PlayCircle size={13} /> Reanudar alertas
                </Button>
              )
            : onPausar && (
                <Button
                  variant="tonal"
                  onClick={() => onPausar(venc)}
                  title="Pausar alertas (p.ej. cuando el trámite está en curso por otro lado)"
                  className="!px-3 !py-1.5 !text-xs"
                >
                  <PauseCircle size={13} /> Pausar alertas
                </Button>
              )}
        </footer>
      )}

      {compact && (
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-brand-muted opacity-0 transition group-hover:opacity-100">
          <ChevronRight size={16} />
        </span>
      )}
    </article>
  );
}
