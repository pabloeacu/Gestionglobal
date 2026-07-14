// ============================================================================
// PagosInformadosWidget · Dashboard gerencia (E-GG-116 · P5-A, reporte JL)
//
// "Se podrá incluir que nos avise en el inicio los pagos informados ???" → banner
// EN TIEMPO REAL en el Inicio cuando un cliente informa un pago pendiente de
// conciliar (pagos_reportados.estado='reportado'). Mismo patrón que
// AportesGestoriaWidget / DocsClientePendientesWidget, tono ÁMBAR para distinguir
// (Docs=cian, Gestoría=violeta).
//   · Vacío/cargando → no renderiza nada.
//   · Activo → contador + lista; cada uno linkea a Pagos informados para conciliar.
// ============================================================================
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Wallet, ChevronRight } from 'lucide-react';
import {
  listPagosReportadosGerencia,
  type PagoReportadoGerencia,
} from '@/services/api/pagosReportados';
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh';

const MEDIO_LABEL: Record<string, string> = {
  transferencia: 'Transferencia',
  deposito: 'Depósito',
  mercadopago: 'Mercado Pago',
  efectivo: 'Efectivo',
  otro: 'Otro',
};

function money(n: number): string {
  return '$' + n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function PagosInformadosWidget({ limit = 5 }: { limit?: number }) {
  const [items, setItems] = useState<PagoReportadoGerencia[]>([]);
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);

  const load = useCallback(async () => {
    const res = await listPagosReportadosGerencia('reportado');
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

  // Tiempo real (mig 0342 agregó pagos_reportados a la publicación). RLS = staff.
  useRealtimeRefresh(['pagos_reportados'], load);

  if (loading || items.length === 0) return null;

  const total = items.length;
  const visibles = items.slice(0, limit);

  return (
    <section className="relative overflow-hidden rounded-2xl border-2 border-amber-300/70 bg-gradient-to-br from-amber-50 via-white to-amber-50/60 p-5 shadow-md animate-fade-in">
      <header className="mb-3 flex items-start gap-3">
        <span className="relative grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-amber-100 text-amber-700">
          <Wallet size={18} />
          <span className="absolute -right-0.5 -top-0.5 flex h-3 w-3">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
            <span className="relative inline-flex h-3 w-3 rounded-full bg-amber-500 ring-2 ring-white" />
          </span>
        </span>
        <div className="min-w-0">
          <p className="kicker text-amber-700">Pagos informados · en vivo</p>
          <h3 className="font-display text-lg font-bold text-brand-ink">
            <span key={total} className="inline-block animate-fade-in tabular">
              {total}
            </span>{' '}
            {total === 1 ? 'pago para conciliar' : 'pagos para conciliar'}
          </h3>
          <p className="mt-0.5 text-xs text-brand-muted">
            Un cliente avisó que pagó. Verificá y conciliá para que impacte el saldo.
          </p>
        </div>
      </header>

      <ul className="divide-y divide-amber-200/60">
        {visibles.map((p) => (
          <li key={p.id}>
            <Link
              to="/gerencia/facturacion/pagos-informados"
              className="group flex items-center justify-between gap-3 rounded px-1 py-2.5 transition hover:bg-white"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-brand-ink">
                  {money(p.monto)}
                  <span className="text-brand-muted">
                    {' · '}
                    {p.administracion_nombre ?? 'Cliente'}
                  </span>
                </p>
                <p className="truncate text-xs text-brand-muted">
                  {MEDIO_LABEL[p.medio] ?? p.medio}
                  {p.referencia ? ` · Ref: ${p.referencia}` : ''}
                </p>
              </div>
              <ChevronRight
                size={16}
                className="shrink-0 text-brand-muted transition group-hover:translate-x-0.5 group-hover:text-amber-600"
              />
            </Link>
          </li>
        ))}
      </ul>

      <Link
        to="/gerencia/facturacion/pagos-informados"
        className="mt-3 inline-block text-xs font-medium text-amber-700 hover:underline"
      >
        Ir a Pagos informados{total > visibles.length ? ` (${total})` : ''} →
      </Link>
    </section>
  );
}
