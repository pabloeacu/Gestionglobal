// ============================================================================
// DocsClientePendientesWidget · Dashboard gerencia (#4, reporte JL docx2)
//
// "Cuando el cliente envía documentación no nos aparece aviso en el Inicio del
//  panel" (sí en la campanita y en el trámite). El Inicio son widgets sobre
// tablas de dominio; la gestoría ya tiene el suyo (AportesGestoriaWidget). Este
// es el espejo para la doc del cliente: banner EN VIVO cuando hay pedidos de
// documentación abiertos con archivos/datos subidos esperando revisión.
//   · Keyea por item 'subido' (no por "enviado a revisión") → también muestra
//     la subida PARCIAL / en tandas (#5), sin depender del botón del cliente.
//   · Vacío → no renderiza nada. Tono cian para distinguirlo del violeta gestoría.
// ============================================================================
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { FileCheck2, ChevronRight } from 'lucide-react';
import { fetchDocsClientePendientes, type DocPendienteCliente } from '@/services/api/trackings';
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh';

export function DocsClientePendientesWidget({ limit = 5 }: { limit?: number }) {
  const [items, setItems] = useState<DocPendienteCliente[]>([]);
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);

  const load = useCallback(async () => {
    const res = await fetchDocsClientePendientes();
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

  // Tiempo real: cambios en pedidos/items de documentación re-fetchean.
  useRealtimeRefresh(['tramite_pedidos_doc', 'tramite_pedidos_doc_items'], load);

  if (loading || items.length === 0) return null;

  const total = items.length;
  const visibles = items.slice(0, limit);

  return (
    <section className="relative overflow-hidden rounded-2xl border-2 border-brand-cyan/50 bg-gradient-to-br from-brand-cyan-pale/50 via-white to-brand-cyan-pale/30 p-5 shadow-md animate-fade-in">
      <header className="mb-3 flex items-start gap-3">
        <span className="relative grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-cyan-pale text-brand-cyan">
          <FileCheck2 size={18} />
          <span className="absolute -right-0.5 -top-0.5 flex h-3 w-3">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-cyan/60 opacity-75" />
            <span className="relative inline-flex h-3 w-3 rounded-full bg-brand-cyan ring-2 ring-white" />
          </span>
        </span>
        <div className="min-w-0">
          <p className="kicker text-brand-cyan">Documentación del cliente · en vivo</p>
          <h3 className="font-display text-lg font-bold text-brand-ink">
            <span key={total} className="inline-block animate-fade-in tabular">
              {total}
            </span>{' '}
            {total === 1 ? 'envío para revisar' : 'envíos para revisar'}
          </h3>
          <p className="mt-0.5 text-xs text-brand-muted">
            Un cliente subió documentación. Revisá y aprobá para que el trámite siga.
          </p>
        </div>
      </header>

      <ul className="divide-y divide-brand-cyan/15">
        {visibles.map((d) => (
          <li key={d.pedido_id}>
            <Link
              to={`/gerencia/trackings/${d.tramite_id}`}
              className="group flex items-center justify-between gap-3 rounded px-1 py-2.5 transition hover:bg-white"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-brand-ink">
                  {d.cliente_nombre ?? d.tramite_codigo}
                </p>
                <p className="truncate text-xs text-brand-muted">
                  {d.descripcion}
                  {d.items_subidos > 0
                    ? ` · ${d.items_subidos} archivo(s) para revisar`
                    : ''}
                </p>
              </div>
              <ChevronRight
                size={16}
                className="shrink-0 text-brand-muted transition group-hover:translate-x-0.5 group-hover:text-brand-cyan"
              />
            </Link>
          </li>
        ))}
      </ul>

      <Link
        to="/gerencia/tramites"
        className="mt-3 inline-block text-xs font-medium text-brand-cyan hover:underline"
      >
        Ir a Trámites{total > visibles.length ? ` (${total})` : ''} →
      </Link>
    </section>
  );
}
