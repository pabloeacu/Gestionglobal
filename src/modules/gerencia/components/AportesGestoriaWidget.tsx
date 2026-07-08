// ============================================================================
// AportesGestoriaWidget · Dashboard gerencia (E-GG-91, reporte JL)
//
// "El aporte de gestoría no lo informa en el inicio, sólo en la campanita o
//  ingresando al trámite." → banner en el inicio, EN TIEMPO REAL, cuando la
// gestoría externa manda un aporte pendiente de moderación. Mismo patrón que
// NuevasSolicitudesWidget (F7/DGG-62) pero tono violeta para distinguirlo.
//   · Vacío  → no renderiza nada (NuevasSolicitudes ya muestra el "todo al día").
//   · Activo → banner con el contador y la lista, cada uno linkea a su trámite;
//     "Ver todos" va a la cola de Moderación.
// ============================================================================
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ClipboardCheck, ChevronRight } from 'lucide-react';
import { fetchModeracionPendientes, type ModeracionPendiente } from '@/services/api/trackings';
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh';

export function AportesGestoriaWidget({ limit = 5 }: { limit?: number }) {
  const [items, setItems] = useState<ModeracionPendiente[]>([]);
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);

  const load = useCallback(async () => {
    const res = await fetchModeracionPendientes();
    if (!mountedRef.current) return;
    setLoading(false);
    if (res.ok) setItems(res.data);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void load();
    return () => {
      mountedRef.current = false;
    };
  }, [load]);

  // Tiempo real: cuando entra/cambia un aporte del gestor (tracking_lineas), se
  // re-fetchea. La RLS filtra por staff (regla 2); el hook debouncea ráfagas.
  useRealtimeRefresh(['tracking_lineas'], load);

  // Vacío o cargando → no ocupa espacio (el widget de solicitudes ya da el
  // "todo al día"; no queremos dos barras).
  if (loading || items.length === 0) return null;

  const total = items.length;
  const visibles = items.slice(0, limit);

  return (
    <section className="relative overflow-hidden rounded-2xl border-2 border-violet-300/70 bg-gradient-to-br from-violet-50 via-white to-violet-50/60 p-5 shadow-md animate-fade-in">
      <header className="mb-3 flex items-start gap-3">
        <span className="relative grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-violet-100 text-violet-700">
          <ClipboardCheck size={18} />
          <span className="absolute -right-0.5 -top-0.5 flex h-3 w-3">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-violet-400 opacity-75" />
            <span className="relative inline-flex h-3 w-3 rounded-full bg-violet-500 ring-2 ring-white" />
          </span>
        </span>
        <div className="min-w-0">
          <p className="kicker text-violet-700">Gestoría externa · en vivo</p>
          <h3 className="font-display text-lg font-bold text-brand-ink">
            <span key={total} className="inline-block animate-fade-in tabular">
              {total}
            </span>{' '}
            {total === 1 ? 'aporte para revisar' : 'aportes para revisar'}
          </h3>
          <p className="mt-0.5 text-xs text-brand-muted">
            La gestoría mandó novedades. Revisá y publicá lo que ve el cliente.
          </p>
        </div>
      </header>

      <ul className="divide-y divide-violet-200/60">
        {visibles.map((a) => (
          <li key={a.linea_id}>
            <Link
              to={`/gerencia/trackings/${a.tramite_id}`}
              className="group flex items-center justify-between gap-3 rounded px-1 py-2.5 transition hover:bg-white"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-brand-ink">
                  {a.cliente_nombre ?? a.tramite_codigo}
                  {a.servicio_nombre ? ` · ${a.servicio_nombre}` : ''}
                </p>
                <p className="truncate text-xs text-brand-muted">
                  {a.gestor_label ? `${a.gestor_label} · ` : ''}
                  {a.descripcion}
                </p>
              </div>
              <ChevronRight
                size={16}
                className="shrink-0 text-brand-muted transition group-hover:translate-x-0.5 group-hover:text-violet-600"
              />
            </Link>
          </li>
        ))}
      </ul>

      <Link
        to="/gerencia/moderacion"
        className="mt-3 inline-block text-xs font-medium text-violet-700 hover:underline"
      >
        Ir a Moderación{total > visibles.length ? ` (${total})` : ''} →
      </Link>
    </section>
  );
}
