import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  CalendarClock,
  ArrowRight,
  AlertTriangle,
  CheckCircle2,
} from 'lucide-react';
import { Skeleton } from '@/components/common';
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh';
import { cn } from '@/lib/cn';
import { formatDateLong } from '@/lib/dates';
import {
  getProximosVencimientos,
  VENCIMIENTO_TIPO_LABEL,
  criticidad,
  CRITICIDAD_BADGE,
  CRITICIDAD_LABEL,
  type ProximoVencimiento,
} from '@/services/api/vencimientos';
import { humanizeError } from '@/lib/errors';

interface Props {
  /** Horizonte de días a mostrar (default 45). */
  dias?: number;
  /** Cantidad máxima de filas visibles (default 6). */
  limit?: number;
  className?: string;
}

/**
 * Widget standalone para incrustar en GerenciaHome (u otra dashboard).
 * Muestra los próximos vencimientos ordenados por fecha, con criticidad
 * resaltada y un atajo al módulo. Subsistema 9 (Documento Maestro).
 *
 * Uso:
 *   import { ProximosVencimientosWidget } from '@/modules/vencimientos';
 *   <ProximosVencimientosWidget />
 */
export function ProximosVencimientosWidget({
  dias = 45,
  limit = 6,
  className,
}: Props) {
  const [rows, setRows] = useState<ProximoVencimiento[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    const res = await getProximosVencimientos(dias);
    setLoading(false);
    if (!res.ok) {
      setError(humanizeError(res.error));
      return;
    }
    setRows(res.data);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dias]);

  useRealtimeRefresh(['vencimientos'], () => void load());

  const visibles = rows.slice(0, limit);

  return (
    <section
      className={cn(
        'card-premium relative overflow-hidden p-5',
        className,
      )}
    >
      <header className="flex items-start justify-between gap-3">
        <div>
          <p className="kicker text-brand-cyan">Datos estratégicos</p>
          <h2 className="font-display text-lg font-bold text-brand-ink">
            Próximos vencimientos
          </h2>
          <p className="mt-0.5 text-xs text-brand-muted">
            Matrículas, DDJJ, certificados ARCA y más, ordenados por urgencia.
          </p>
        </div>
        <Link
          to="/gerencia/vencimientos"
          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-brand-ink transition hover:border-brand-cyan hover:text-brand-cyan"
        >
          Ver todos <ArrowRight size={13} />
        </Link>
      </header>

      <div className="mt-4 space-y-2">
        {loading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center gap-3 rounded-xl border border-slate-100 p-3"
            >
              <Skeleton className="h-9 w-9 rounded-full" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3 w-2/3" />
                <Skeleton className="h-2.5 w-1/3" />
              </div>
            </div>
          ))
        ) : error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
            {error}
          </div>
        ) : visibles.length === 0 ? (
          <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 text-sm text-emerald-700">
            <CheckCircle2 size={16} />
            <span>Sin vencimientos en los próximos {dias} días.</span>
          </div>
        ) : (
          visibles.map((v) => {
            const crit = criticidad(v.dias_restantes);
            const sujetoNombre =
              v.sujeto === 'consorcio' && v.consorcio_nombre
                ? v.consorcio_nombre
                : v.administracion_nombre;
            const diasTxt =
              v.dias_restantes < 0
                ? `Venció hace ${Math.abs(v.dias_restantes)} d`
                : v.dias_restantes === 0
                  ? 'Vence hoy'
                  : `En ${v.dias_restantes} d`;
            return (
              <Link
                key={v.id}
                to="/gerencia/vencimientos"
                className="flex items-center gap-3 rounded-xl border border-slate-100 p-3 transition hover:border-brand-cyan hover:bg-brand-zebra/40"
              >
                <span
                  className={cn(
                    'grid h-9 w-9 shrink-0 place-items-center rounded-full',
                    crit === 'vencida' || crit === 'critica'
                      ? 'bg-red-50 text-red-600'
                      : crit === 'proxima'
                        ? 'bg-amber-50 text-amber-600'
                        : 'bg-brand-cyan/10 text-brand-cyan',
                  )}
                >
                  {crit === 'vencida' || crit === 'critica' ? (
                    <AlertTriangle size={16} />
                  ) : (
                    <CalendarClock size={16} />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-brand-ink">
                    {sujetoNombre}
                  </p>
                  <p className="truncate text-[11px] text-brand-muted">
                    {VENCIMIENTO_TIPO_LABEL[v.tipo]} ·{' '}
                    {formatDateLong(v.fecha_vencimiento)}
                  </p>
                </div>
                <span
                  className={cn(
                    'shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold',
                    CRITICIDAD_BADGE[crit],
                  )}
                  title={CRITICIDAD_LABEL[crit]}
                >
                  {diasTxt}
                </span>
              </Link>
            );
          })
        )}
      </div>
    </section>
  );
}
