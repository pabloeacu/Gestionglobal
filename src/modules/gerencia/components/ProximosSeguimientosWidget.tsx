// ============================================================================
// ProximosSeguimientosWidget · Widget timeline dashboard gerencia
//
// Muestra próximas alarmas de tracking_lineas (alerta_en en N días futuros).
// Carga via RPC `gerencia_proximos_seguimientos(p_dias)`.
//
// Visual: lista compacta con dot de color según urgencia + fecha + descripción
// corta + link al tramite. Estado vacío amable.
// ============================================================================
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Clock, ChevronRight, BellRing } from 'lucide-react';
import { Skeleton } from '@/components/common';
import {
  fetchProximosSeguimientos,
  type ProximoSeguimientoRow,
} from '@/services/api/trackings';

interface Props {
  dias?: number;
  limit?: number;
}

export function ProximosSeguimientosWidget({ dias = 7, limit = 8 }: Props) {
  const [items, setItems] = useState<ProximoSeguimientoRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    async function load() {
      const res = await fetchProximosSeguimientos(dias);
      if (!mounted) return;
      setLoading(false);
      if (res.ok) setItems(res.data.slice(0, limit));
    }
    void load();
    return () => {
      mounted = false;
    };
  }, [dias, limit]);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <header className="flex items-center justify-between mb-3">
        <div>
          <p className="kicker text-brand-cyan">Trackings</p>
          <h3 className="font-display text-lg font-bold text-brand-ink">
            Próximos seguimientos
          </h3>
          <p className="mt-0.5 text-xs text-brand-muted">
            Alarmas activas en los próximos {dias} días.
          </p>
        </div>
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-cyan-pale text-brand-cyan">
          <BellRing size={18} />
        </span>
      </header>

      {loading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-12 rounded-lg" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-lg bg-slate-50 p-4 text-center text-sm text-brand-muted">
          <Clock size={18} className="mx-auto mb-2 text-slate-400" />
          No hay seguimientos programados en los próximos {dias} días.
        </div>
      ) : (
        <ul className="divide-y divide-slate-100">
          {items.map((it) => (
            <li key={it.linea_id}>
              <Link
                to={`/gerencia/trackings/${it.tramite_id}`}
                className="group flex items-center gap-3 py-2.5 px-1 transition hover:bg-slate-50 rounded"
              >
                <span
                  className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${dotForDias(it.dias_restantes)}`}
                  aria-hidden
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2">
                    <p className="truncate text-sm font-semibold text-brand-ink">
                      {it.tramite_titulo}
                    </p>
                    <span className="shrink-0 text-[11px] text-brand-muted">
                      {labelDias(it.dias_restantes)}
                    </span>
                  </div>
                  <p className="truncate text-xs text-brand-muted">
                    {it.administracion_nombre} · {it.descripcion}
                  </p>
                </div>
                <ChevronRight
                  size={16}
                  className="shrink-0 text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-brand-cyan"
                />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function dotForDias(d: number): string {
  if (d <= 1) return 'bg-rose-500';
  if (d <= 3) return 'bg-amber-500';
  return 'bg-emerald-500';
}

function labelDias(d: number): string {
  if (d <= 0) return 'hoy';
  if (d === 1) return 'mañana';
  return `en ${d} d`;
}
