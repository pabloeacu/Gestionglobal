// ============================================================================
// EmailsRebotadosWidget · Dashboard gerencia (DGG-117, caso Nogueira)
//
// Banner en el Inicio cuando hay emails REBOTADOS (o con queja de spam) en los
// últimos 7 días: el cliente NO recibió lo que le mandamos (bienvenida,
// avances, cta cte) y alguien tiene que actuar (verificar la casilla o
// corregir el mail de acceso desde su ficha). Mismo patrón que
// PagosInformadosWidget, tono ROSA (alerta de entregabilidad).
//   · Vacío/cargando → no renderiza nada.
//   · Cada rebote linkea a la ficha del cliente (o a Comunicaciones si el
//     envío no tiene administración asociada).
// ============================================================================
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { MailX, ChevronRight } from 'lucide-react';
import { listarRebotesRecientes, type ReboteReciente } from '@/services/api/emails';
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh';

export function EmailsRebotadosWidget({ limit = 5 }: { limit?: number }) {
  const [items, setItems] = useState<ReboteReciente[]>([]);
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);

  const load = useCallback(async () => {
    const res = await listarRebotesRecientes();
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

  // El harvester marca rebotes cada 30 min; refrescamos si sent_emails cambia
  // (si la tabla no está en la publicación realtime, el load inicial alcanza).
  useRealtimeRefresh(['sent_emails'], load);

  if (loading || items.length === 0) return null;

  const total = items.length;
  const visibles = items.slice(0, limit);

  return (
    <section className="relative overflow-hidden rounded-2xl border-2 border-rose-300/70 bg-gradient-to-br from-rose-50 via-white to-rose-50/60 p-5 shadow-md animate-fade-in">
      <header className="mb-3 flex items-start gap-3">
        <span className="relative grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-rose-100 text-rose-700">
          <MailX size={18} />
          <span className="absolute -right-0.5 -top-0.5 flex h-3 w-3">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-400 opacity-75" />
            <span className="relative inline-flex h-3 w-3 rounded-full bg-rose-500 ring-2 ring-white" />
          </span>
        </span>
        <div className="min-w-0">
          <p className="kicker text-rose-700">Emails rebotados · últimos 7 días</p>
          <h3 className="font-display text-lg font-bold text-brand-ink">
            <span key={total} className="inline-block animate-fade-in tabular">
              {total}
            </span>{' '}
            {total === 1 ? 'email no llegó a destino' : 'emails no llegaron a destino'}
          </h3>
          <p className="mt-0.5 text-xs text-brand-muted">
            El cliente no recibió lo que le enviamos. Verificá su casilla o
            corregí su mail de acceso desde la ficha.
          </p>
        </div>
      </header>

      <ul className="divide-y divide-rose-200/60">
        {visibles.map((r) => (
          <li key={r.id}>
            <Link
              to={r.administracion_id ? `/gerencia/clientes/${r.administracion_id}` : '/gerencia/comunicaciones'}
              className="group flex items-center justify-between gap-3 rounded px-1 py-2.5 transition hover:bg-white"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-brand-ink">
                  {r.administracion_nombre ?? r.to_email}
                  {r.estado === 'complained' && (
                    <span className="ml-1.5 rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-rose-700">
                      queja de spam
                    </span>
                  )}
                </p>
                <p className="truncate text-xs text-brand-muted">
                  {r.to_email}
                  {r.asunto ? ` · ${r.asunto}` : ''}
                </p>
              </div>
              <ChevronRight
                size={16}
                className="shrink-0 text-brand-muted transition group-hover:translate-x-0.5 group-hover:text-rose-600"
              />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
