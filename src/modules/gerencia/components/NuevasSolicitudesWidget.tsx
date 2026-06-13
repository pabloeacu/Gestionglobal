// ============================================================================
// NuevasSolicitudesWidget · Dashboard gerencia
//
// Bloque B / obs 1: señal clara cuando ingresan solicitudes nuevas.
// F7 (Lista JL · DGG-62): el aviso ahora es un BANNER EN TIEMPO REAL —
//   · Se suscribe a Realtime de `solicitudes` (la tabla ya está en la
//     publicación supabase_realtime) → cuando entra una solicitud nueva,
//     el banner aparece / actualiza el contador SIN recargar.
//   · Estado activo = banner prominente ámbar con punto "en vivo" y el
//     número animado al cambiar (énfasis sutil, sin sonido ni toast).
//   · Estado vacío = barra slim discreta ("Todo al día"), no roba foco.
// El widget va arriba de todo en el Inicio (ver GerenciaHome).
// ============================================================================
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Inbox, ChevronRight, CheckCircle2 } from 'lucide-react';
import { Skeleton } from '@/components/common';
import { listSolicitudesPendientes } from '@/services/api/solicitudes';
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh';

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
  const mountedRef = useRef(true);

  const load = useCallback(async () => {
    // Pendientes = estado 'recibida'/'en_revision' (aún sin derivar ni activar).
    const res = await listSolicitudesPendientes(limit);
    if (!mountedRef.current) return; // evita setState tras unmount (realtime)
    setLoading(false);
    if (res.ok) {
      setItems(res.data.rows as unknown as SolicitudPendiente[]);
      setTotal(res.data.total);
    }
  }, [limit]);

  useEffect(() => {
    mountedRef.current = true;
    void load();
    return () => {
      mountedRef.current = false;
    };
  }, [load]);

  // F7: tiempo real — re-fetch cuando entra/cambia/sale una solicitud.
  // La RLS de `solicitudes` filtra por staff (regla 2); el hook debouncea ráfagas.
  useRealtimeRefresh(['solicitudes'], load);

  if (loading) {
    return <Skeleton className="h-12 rounded-xl" />;
  }

  // Estado vacío: barra slim discreta (no es un banner que robe foco).
  if (total === 0) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-brand-muted shadow-sm">
        <CheckCircle2 size={16} className="shrink-0 text-emerald-500" />
        <span>Sin solicitudes nuevas. Todo al día.</span>
      </div>
    );
  }

  // Estado activo: banner prominente. `animate-fade-in` corre cuando el banner
  // APARECE (transición vacío→activo). El número re-anima al cambiar el total
  // (key={total}) → énfasis sutil sin sonido ni toast.
  return (
    <section className="relative overflow-hidden rounded-2xl border-2 border-amber-300/70 bg-gradient-to-br from-amber-50 via-white to-amber-50/60 p-5 shadow-md animate-fade-in">
      <header className="mb-3 flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="relative grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-amber-100 text-amber-700">
            <Inbox size={18} />
            {/* Punto "en vivo": señala que el banner se actualiza en tiempo real. */}
            <span className="absolute -right-0.5 -top-0.5 flex h-3 w-3">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
              <span className="relative inline-flex h-3 w-3 rounded-full bg-amber-500 ring-2 ring-white" />
            </span>
          </span>
          <div className="min-w-0">
            <p className="kicker text-amber-700">Tenés novedades · en vivo</p>
            <h3 className="font-display text-lg font-bold text-brand-ink">
              <span key={total} className="inline-block animate-fade-in tabular">
                {total}
              </span>{' '}
              {total === 1 ? 'nueva solicitud' : 'nuevas solicitudes'}
            </h3>
            <p className="mt-0.5 text-xs text-brand-muted">
              Derivá al gestor o activá el wizard para arrancar el trámite.
            </p>
          </div>
        </div>
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
          to="/gerencia/solicitudes"
          className="mt-3 inline-block text-xs font-medium text-brand-cyan hover:underline"
        >
          Ver todas ({total}) →
        </Link>
      )}
    </section>
  );
}
