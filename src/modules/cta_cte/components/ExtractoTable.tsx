import { Link } from 'react-router-dom';
import { ExternalLink, FileText, Wallet } from 'lucide-react';
import type { ExtractoRow } from '@/services/api/ctaCte';
import { formatDateShort } from '@/lib/dates';
import { cn } from '@/lib/cn';
import { formatMoney } from '../lib/format';

interface Props {
  rows: ExtractoRow[];
  emptyHint?: string;
}

// Tabla de extracto con saldo running. Sticky header. Acepta navegación al
// detalle del comprobante por fila de cargo.
export function ExtractoTable({ rows, emptyHint }: Props) {
  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-12 text-center">
        <span className="grid h-12 w-12 place-items-center rounded-xl bg-brand-cyan-pale/40 text-brand-cyan">
          <Wallet size={20} />
        </span>
        <h3 className="font-display text-lg font-bold">
          Sin movimientos en el período
        </h3>
        <p className="max-w-sm text-sm text-brand-muted">
          {emptyHint ?? 'Ajustá el rango o esperá nuevos cargos / cobranzas.'}
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="sticky top-0 z-10 bg-white/95 backdrop-blur">
          <tr className="border-b border-slate-100 bg-brand-zebra/40 text-left text-[11px] font-semibold uppercase tracking-wider text-brand-muted">
            <th className="px-4 py-2.5">Fecha</th>
            <th className="px-4 py-2.5">Movimiento</th>
            <th className="px-4 py-2.5 text-right">Debe</th>
            <th className="px-4 py-2.5 text-right">Haber</th>
            <th className="px-4 py-2.5 text-right">Saldo</th>
            <th className="px-4 py-2.5"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, idx) => {
            const isInicial = r.tipo === 'saldo_inicial';
            return (
              <tr
                key={`${r.tipo}-${r.imputacion_id ?? r.comprobante_id ?? idx}`}
                className={cn(
                  'border-b border-slate-100 hover:bg-brand-zebra/30 motion-safe:animate-fade-up',
                  isInicial && 'bg-slate-50/60 font-medium',
                )}
                style={{ animationDelay: `${Math.min(idx, 12) * 18}ms` }}
              >
                <td className="px-4 py-3 tabular text-xs text-brand-muted">
                  {isInicial ? '—' : formatDateShort(r.fecha)}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    {r.tipo === 'cargo' && (
                      <FileText size={14} className="text-brand-muted" />
                    )}
                    {r.tipo === 'abono' && (
                      <Wallet size={14} className="text-emerald-700" />
                    )}
                    <span
                      className={cn(
                        isInicial ? 'text-brand-muted' : 'text-brand-ink',
                      )}
                    >
                      {r.descripcion}
                    </span>
                  </div>
                  {r.consorcio_nombre && (
                    <span className="block pl-6 text-xs text-brand-muted">
                      · {r.consorcio_nombre}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-right tabular">
                  {r.debe > 0 ? (
                    <span className="text-brand-ink">
                      {formatMoney(r.debe, 0)}
                    </span>
                  ) : (
                    <span className="text-brand-muted">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right tabular">
                  {r.haber > 0 ? (
                    <span className="text-emerald-700">
                      {formatMoney(r.haber, 0)}
                    </span>
                  ) : (
                    <span className="text-brand-muted">—</span>
                  )}
                </td>
                <td
                  className={cn(
                    'px-4 py-3 text-right tabular font-semibold',
                    r.saldo > 0
                      ? 'text-amber-700'
                      : r.saldo < 0
                        ? 'text-emerald-700'
                        : 'text-brand-muted',
                  )}
                >
                  {formatMoney(r.saldo, 0)}
                </td>
                <td className="px-4 py-3 text-right">
                  {r.tipo === 'cargo' && r.comprobante_id && (
                    <Link
                      to={`/gerencia/facturacion/${r.comprobante_id}`}
                      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-brand-cyan transition hover:bg-brand-cyan-pale/40"
                      title="Ver comprobante"
                    >
                      <ExternalLink size={12} />
                    </Link>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
