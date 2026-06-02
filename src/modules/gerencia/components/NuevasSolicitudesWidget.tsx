// ============================================================================
// NuevasSolicitudesWidget · Dashboard gerencia
//
// Bloque B / obs 1: la gerencia necesita una señal clara cuando ingresan
// solicitudes nuevas, no solo la campanita. Este widget cuenta las solicitudes
// en estado='nueva' (sin derivar/activar) y muestra las últimas N como tarjeta
// premium con link directo al detalle.
// ============================================================================
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Inbox, ChevronRight, Sparkles } from 'lucide-react';
import { Skeleton } from '@/components/common';
import { listSolicitudesPendientes } from '@/services/api/solicitudes';

interface SolicitudPendiente {
  id: string;
  solicitante_nombre: string | null;
  solicitante_email: string | null;
  servicio_slug: string | null;
  created_at: string;
}

export function NuevasSolicitudesWidget({ limit = 5 }: { limit?: number }) {
  const [items, setItems] = useState<SolicitudPendiente[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    async function load() {
      // Estado 'nueva' = solicitudes que aún no fueron derivadas a un gestor
      // ni activadas. Son las que requieren atención inmediata de la gerencia.
      const res = await listSolicitudesPendientes(limit);
      if (!mounted) return;
      setLoading(false);
      if (res.ok) {
        setItems(res.data.rows as unknown as SolicitudPendiente[]);
        setTotal(res.data.total);
      }
    }
    void load();
    return () => {
      mounted = false;
    };
  }, [limit]);

  if (loading) {
    return (
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <Skeleton className="mb-3 h-6 w-40 rounded" />
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-12 rounded-lg" />
          ))}
        </div>
      </section>
    );
  }

  if (total === 0) {
    return (
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <header className="mb-3 flex items-center justify-between">
          <div>
            <p className="kicker text-brand-cyan">Solicitudes</p>
            <h3 className="font-display text-lg font-bold text-brand-ink">
              Sin novedades
            </h3>
          </div>
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-50 text-emerald-600">
            <Sparkles size={18} />
          </span>
        </header>
        <p className="text-sm text-brand-muted">
          No hay solicitudes nuevas esperando derivación.
        </p>
      </section>
    );
  }

  return (
    <section className="relative overflow-hidden rounded-2xl border-2 border-amber-300/60 bg-gradient-to-br from-amber-50 via-white to-amber-50/60 p-5 shadow-sm">
      <header className="mb-3 flex items-center justify-between">
        <div>
          <p className="kicker text-amber-700">Tenés novedades</p>
          <h3 className="font-display text-lg font-bold text-brand-ink">
            {total} {total === 1 ? 'nueva solicitud' : 'nuevas solicitudes'}
          </h3>
          <p className="mt-0.5 text-xs text-brand-muted">
            Derivá al gestor o activá el wizard para arrancar el trámite.
          </p>
        </div>
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-amber-100 text-amber-700">
          <Inbox size={18} />
        </span>
      </header>

      <ul className="divide-y divide-amber-200/60">
        {items.map((s) => (
          <li key={s.id}>
            <Link
              to={`/gerencia/solicitudes/${s.id}`}
              className="group flex items-center justify-between gap-3 rounded py-2.5 px-1 transition hover:bg-white"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-brand-ink">
                  {s.solicitante_nombre ?? 'Solicitante sin nombre'}
                </p>
                <p className="truncate text-xs text-brand-muted">
                  {s.servicio_slug ?? 'Servicio sin identificar'}
                  {s.solicitante_email ? ` · ${s.solicitante_email}` : ''}
                </p>
              </div>
              <ChevronRight
                size={16}
                className="shrink-0 text-brand-muted transition group-hover:text-brand-cyan group-hover:translate-x-0.5"
              />
            </Link>
          </li>
        ))}
      </ul>

      {total > items.length && (
        <Link
          to="/gerencia/solicitudes?estado=nueva"
          className="mt-3 inline-block text-xs font-medium text-brand-cyan hover:underline"
        >
          Ver todas ({total}) →
        </Link>
      )}
    </section>
  );
}
