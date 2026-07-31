// ThInteractivo · DGG-124 (pedido Pablo 31/07): "el encabezado debe filtrar,
// buscar y ordenar". Encabezado de columna estándar para las grillas de la
// plataforma:
//   · click en el label → alterna orden asc/desc (si la columna es ordenable)
//   · ícono de embudo → popover con búsqueda de texto o lista de opciones
// El estado (orden + filtros) vive en la página; este componente es puro UI.

import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronsUpDown, ListFilter, Search, X } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface OrdenGrilla {
  campo: string;
  dir: 'asc' | 'desc';
}

export interface OpcionFiltro {
  value: string;
  label: string;
}

export function ThInteractivo({
  label,
  align = 'left',
  // Orden
  sortKey,
  orden,
  onOrden,
  // Filtro por opciones (checkbox) o búsqueda de texto
  filtroOpciones,
  filtroValores,
  onFiltroValores,
  busquedaValor,
  onBusqueda,
  busquedaPlaceholder,
  className,
}: {
  label: string;
  align?: 'left' | 'right';
  /** Campo de orden que representa esta columna (habilita el toggle asc/desc). */
  sortKey?: string;
  orden?: OrdenGrilla | null;
  onOrden?: (orden: OrdenGrilla) => void;
  /** Lista de opciones → popover con checkboxes (multi-selección). */
  filtroOpciones?: OpcionFiltro[];
  filtroValores?: string[];
  onFiltroValores?: (valores: string[]) => void;
  /** Búsqueda de texto → popover con input (aplica con Enter o al cerrar). */
  busquedaValor?: string;
  onBusqueda?: (texto: string) => void;
  busquedaPlaceholder?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [borrador, setBorrador] = useState(busquedaValor ?? '');
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const ordenable = !!sortKey && !!onOrden;
  const conFiltro = (!!filtroOpciones && !!onFiltroValores) || !!onBusqueda;
  const esActiva = orden?.campo === sortKey;
  const filtroActivo =
    (filtroValores !== undefined && filtroValores.length > 0) ||
    (busquedaValor !== undefined && busquedaValor.trim() !== '');

  useEffect(() => { setBorrador(busquedaValor ?? ''); }, [busquedaValor]);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        aplicarBusqueda();
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, borrador]);

  function toggleOrden() {
    if (!ordenable || !sortKey || !onOrden) return;
    const dir = esActiva && orden?.dir === 'desc' ? 'asc' : 'desc';
    onOrden({ campo: sortKey, dir });
  }

  function toggleOpcion(v: string) {
    if (!onFiltroValores) return;
    const actual = filtroValores ?? [];
    onFiltroValores(actual.includes(v) ? actual.filter((x) => x !== v) : [...actual, v]);
  }

  function aplicarBusqueda() {
    if (onBusqueda && borrador !== (busquedaValor ?? '')) onBusqueda(borrador);
  }

  return (
    <th className={cn('px-4 py-2', align === 'right' && 'text-right', className)}>
      <div
        ref={ref}
        className={cn('relative inline-flex items-center gap-1', align === 'right' && 'flex-row-reverse')}
      >
        <button
          type="button"
          onClick={toggleOrden}
          disabled={!ordenable}
          className={cn(
            'inline-flex items-center gap-1 text-xs uppercase tracking-wider transition',
            ordenable ? 'hover:text-brand-cyan' : 'cursor-default',
            esActiva ? 'font-bold text-brand-cyan' : 'text-brand-muted',
          )}
        >
          {label}
          {ordenable && (
            esActiva
              ? (orden?.dir === 'desc' ? <ArrowDown size={11} /> : <ArrowUp size={11} />)
              : <ChevronsUpDown size={11} className="opacity-40" />
          )}
        </button>

        {conFiltro && (
          <button
            type="button"
            aria-label={`Filtrar ${label}`}
            onClick={() => setOpen((o) => !o)}
            className={cn(
              'grid h-5 w-5 place-items-center rounded transition',
              filtroActivo
                ? 'bg-brand-cyan text-white'
                : 'text-brand-muted/60 hover:bg-slate-200 hover:text-brand-ink',
            )}
          >
            <ListFilter size={11} />
          </button>
        )}

        {open && conFiltro && (
          <div
            className={cn(
              'absolute top-full z-30 mt-1 w-56 rounded-xl border border-slate-200 bg-white p-2 text-left shadow-xl motion-safe:animate-fade-up',
              align === 'right' ? 'right-0' : 'left-0',
            )}
          >
            {onBusqueda && (
              <div className="relative">
                <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-brand-muted" />
                <input
                  ref={inputRef}
                  value={borrador}
                  onChange={(e) => setBorrador(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { aplicarBusqueda(); setOpen(false); }
                  }}
                  placeholder={busquedaPlaceholder ?? `Buscar en ${label.toLowerCase()}…`}
                  className="w-full rounded-md border border-slate-200 py-1 pl-7 pr-6 text-xs normal-case tracking-normal"
                />
                {borrador && (
                  <button
                    type="button"
                    aria-label="Limpiar búsqueda"
                    onClick={() => { setBorrador(''); onBusqueda(''); }}
                    className="absolute right-1.5 top-1/2 grid h-4 w-4 -translate-y-1/2 place-items-center rounded-full text-brand-muted hover:bg-slate-100"
                  >
                    <X size={10} />
                  </button>
                )}
              </div>
            )}

            {filtroOpciones && onFiltroValores && (
              <div className={cn('max-h-56 overflow-y-auto', onBusqueda && 'mt-2 border-t border-slate-100 pt-2')}>
                {filtroOpciones.map((op) => (
                  <label
                    key={op.value}
                    className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-xs normal-case tracking-normal text-brand-ink hover:bg-slate-50"
                  >
                    <input
                      type="checkbox"
                      checked={(filtroValores ?? []).includes(op.value)}
                      onChange={() => toggleOpcion(op.value)}
                      className="h-3.5 w-3.5 rounded border-slate-300 text-brand-cyan focus:ring-brand-cyan"
                    />
                    {op.label}
                  </label>
                ))}
                {(filtroValores ?? []).length > 0 && (
                  <button
                    type="button"
                    onClick={() => onFiltroValores([])}
                    className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1 text-[11px] normal-case tracking-normal text-brand-muted hover:border-brand-cyan hover:text-brand-cyan"
                  >
                    Limpiar selección
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </th>
  );
}
