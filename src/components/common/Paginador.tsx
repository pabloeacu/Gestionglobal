// Paginador · DGG-124 (pedido Pablo 31/07): ninguna grilla infinita.
// Control estándar de paginación server-side: "Mostrando X–Y de Z", flechas
// y tamaño de página (default 50). Va acompañado de queries con .range() en
// el service — la grilla nunca trae más de `pageSize` filas.

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/cn';

export const PAGE_SIZE_DEFAULT = 50;
const TAMANOS = [25, 50, 100] as const;

export function Paginador({
  page,
  pageSize,
  total,
  hayMas,
  onPage,
  onPageSize,
  className,
}: {
  /** Página actual, base 1. */
  page: number;
  pageSize: number;
  /**
   * Total de filas del universo filtrado (count exacto del server). Si la
   * fuente no devuelve total (ej. RPCs sin count), omitirlo y pasar `hayMas`.
   */
  total?: number;
  /** Fallback sin total: ¿la página vino llena? (rows.length === pageSize). */
  hayMas?: boolean;
  onPage: (page: number) => void;
  /** Si se omite, no se muestra el selector de tamaño. */
  onPageSize?: (size: number) => void;
  className?: string;
}) {
  const conTotal = total !== undefined;
  const totalPaginas = conTotal ? Math.max(1, Math.ceil(total / pageSize)) : null;
  const desde = conTotal ? (total === 0 ? 0 : (page - 1) * pageSize + 1) : 0;
  const hasta = conTotal ? Math.min(page * pageSize, total) : 0;
  const puedeAvanzar = conTotal ? page < (totalPaginas ?? 1) : (hayMas ?? false);

  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-4 py-3 text-sm',
        className,
      )}
    >
      {conTotal ? (
        <p className="text-brand-muted">
          Mostrando <span className="font-semibold text-brand-ink tabular">{desde}–{hasta}</span> de{' '}
          <span className="font-semibold text-brand-ink tabular">{total}</span>
        </p>
      ) : (
        <p className="text-brand-muted">
          {pageSize} por página
        </p>
      )}
      <div className="flex items-center gap-2">
        {onPageSize && (
          <select
            value={pageSize}
            onChange={(e) => onPageSize(Number(e.target.value))}
            className="rounded-md border border-slate-200 px-2 py-1 text-xs text-brand-muted"
            aria-label="Filas por página"
          >
            {TAMANOS.map((t) => (
              <option key={t} value={t}>{t} por página</option>
            ))}
          </select>
        )}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onPage(page - 1)}
            disabled={page <= 1}
            aria-label="Página anterior"
            className="grid h-7 w-7 place-items-center rounded-md border border-slate-200 text-brand-ink transition hover:border-brand-cyan hover:text-brand-cyan disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ChevronLeft size={14} />
          </button>
          <span className="min-w-[80px] text-center text-xs text-brand-muted tabular">
            {conTotal ? `Página ${page} de ${totalPaginas}` : `Página ${page}`}
          </span>
          <button
            type="button"
            onClick={() => onPage(page + 1)}
            disabled={!puedeAvanzar}
            aria-label="Página siguiente"
            className="grid h-7 w-7 place-items-center rounded-md border border-slate-200 text-brand-ink transition hover:border-brand-cyan hover:text-brand-cyan disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ChevronRight size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
