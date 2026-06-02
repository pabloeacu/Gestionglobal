import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CalendarRange, History } from 'lucide-react';
import { historialPorCliente, type TrackingRow } from '@/services/api/trackings';
import { Skeleton } from '@/components/common';
import { formatDateShort } from '@/lib/dates';
import { cn } from '@/lib/cn';
import { humanizeError } from '@/lib/errors';

export interface RecurrenciaListProps {
  administracionId: string;
  servicioCodigo: string;
  trackingActualId: string;
}

export function RecurrenciaList({
  administracionId,
  servicioCodigo,
  trackingActualId,
}: RecurrenciaListProps) {
  const [items, setItems] = useState<TrackingRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await historialPorCliente(administracionId, servicioCodigo);
      if (cancelled) return;
      if (!res.ok) {
        setError(humanizeError(res.error));
        setItems([]);
        return;
      }
      setItems(res.data);
    })();
    return () => {
      cancelled = true;
    };
  }, [administracionId, servicioCodigo]);

  if (!items) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
      </div>
    );
  }

  if (error) {
    return (
      <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>
    );
  }

  if (items.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
        Sin trackings previos de este servicio para este cliente.
      </p>
    );
  }

  return (
    <ol className="space-y-3">
      {items.map((t) => {
        const isCurrent = t.id === trackingActualId;
        return (
          <li key={t.id}>
            <Link
              to={`/gerencia/trackings/${t.id}`}
              className={cn(
                'group flex items-center gap-3 rounded-xl border bg-white p-4 transition',
                isCurrent
                  ? 'border-cyan-300 bg-cyan-50/60 shadow-sm'
                  : 'border-slate-200 hover:border-slate-300 hover:shadow-sm',
              )}
            >
              <CalendarRange className="h-5 w-5 shrink-0 text-slate-400" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-slate-800">
                    {t.periodo ?? '—'}
                  </span>
                  {isCurrent && (
                    <span className="rounded-full bg-cyan-100 px-2 py-0.5 text-xs font-medium text-cyan-700 ring-1 ring-cyan-200">
                      Actual
                    </span>
                  )}
                </div>
                <p className="truncate text-xs text-slate-500">
                  <History className="inline h-3 w-3" /> Estado:{' '}
                  <strong>{t.estado}</strong>
                  {t.fecha_inicio && (
                    <>
                      {' '}
                      · Inicio: {formatDateShort(t.fecha_inicio)}
                    </>
                  )}
                  {t.fecha_fin && (
                    <>
                      {' '}
                      · Fin: {formatDateShort(t.fecha_fin)}
                    </>
                  )}
                </p>
              </div>
              {!isCurrent && (
                <ArrowRight className="h-4 w-4 text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-slate-600" />
              )}
            </Link>
          </li>
        );
      })}
    </ol>
  );
}
