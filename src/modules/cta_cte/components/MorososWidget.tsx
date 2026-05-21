import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, ArrowRight } from 'lucide-react';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import { Skeleton } from '@/components/common';
import { listMorososResumen, type MorosoRow } from '@/services/api/ctaCte';
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh';
import { formatMoney } from '../lib/format';

interface Props {
  limit?: number;
}

// Widget standalone para enchufar en GerenciaHome. Muestra top N morosos
// con deuda total y badge de vencidos. Refresca via Realtime al cambiar
// comprobantes o imputaciones.
export function MorososWidget({ limit = 5 }: Props) {
  const [rows, setRows] = useState<MorosoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    const res = await listMorososResumen(limit);
    setLoading(false);
    if (!res.ok) {
      setError(res.error.message);
      return;
    }
    setRows(res.data);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [limit]);

  useRealtimeRefresh(
    ['comprobantes', 'movimiento_imputaciones'],
    () => void load(),
  );

  return (
    <section className="card-premium relative overflow-hidden">
      <TrianglesAccent
        position="top-right"
        size={170}
        tone="cyan"
        density="soft"
        className="opacity-30"
      />
      <div className="relative p-5">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-amber-50 text-amber-700">
              <AlertCircle size={18} />
            </span>
            <div>
              <p className="kicker text-brand-muted">Morosos</p>
              <h2 className="font-display text-lg font-bold text-brand-ink">
                Top deudores
              </h2>
            </div>
          </div>
          <Link
            to="/gerencia/cuenta-corriente"
            className="inline-flex items-center gap-1 text-xs font-medium text-brand-cyan transition hover:underline"
          >
            Ver todo <ArrowRight size={12} />
          </Link>
        </div>

        {loading && rows.length === 0 ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-12 w-full rounded-lg" />
            ))}
          </div>
        ) : error ? (
          <p className="py-6 text-center text-sm text-red-600">{error}</p>
        ) : rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-brand-muted">
            Sin morosos por ahora.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((r) => (
              <li key={r.administracion_id}>
                <Link
                  to={`/gerencia/cuenta-corriente/${r.administracion_id}`}
                  className="flex items-center justify-between gap-3 py-2.5 transition hover:bg-brand-zebra/30 hover:-mx-2 hover:px-2 hover:rounded-lg"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-brand-ink">
                      {r.administracion_nombre}
                    </p>
                    <p className="text-[11px] text-brand-muted">
                      {r.comprobantes_pendientes} pendientes
                      {r.comprobantes_vencidos > 0 && (
                        <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700">
                          {r.comprobantes_vencidos} vencidos
                          {r.mayor_dias_vencido > 0 &&
                            ` · ${r.mayor_dias_vencido}d`}
                        </span>
                      )}
                    </p>
                  </div>
                  <p className="font-display text-sm font-bold tabular text-amber-700">
                    {formatMoney(r.deuda_total, 0)}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
