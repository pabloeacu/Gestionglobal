// ============================================================================
// Filters.tsx · Toolkit premium de filtros (F8 · DGG-64)
//
// Componentes compartidos para "segmentar la visión del gerente" en Solicitudes
// y Trámites a escala (cientos de registros). Diseño: controles MIXTOS (no todo
// multiselect) — chips, switches, multiselect con búsqueda, y "segment cards"
// (las KPI cards de arriba que funcionan como filtros). Decisiones de Pablo:
// estado efímero (no URL/localStorage), default "Solo activos" ON.
//
// Todo presentacional + un hook de orden (useSort). El estado del filtro vive
// en cada página (useState efímero); estos componentes son controlados.
// ============================================================================

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ChevronDown, Check, Search, X, ChevronUp, ChevronsUpDown } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';

// Paletas de tono reusadas por SegmentCard y chips.
const TONES = {
  cyan: { ring: 'ring-brand-cyan/30', activeBg: 'bg-brand-cyan/10', text: 'text-brand-cyan', dot: 'bg-brand-cyan' },
  red: { ring: 'ring-red-200', activeBg: 'bg-red-50', text: 'text-red-700', dot: 'bg-red-500' },
  amber: { ring: 'ring-amber-200', activeBg: 'bg-amber-50', text: 'text-amber-700', dot: 'bg-amber-500' },
  violet: { ring: 'ring-violet-200', activeBg: 'bg-violet-50', text: 'text-violet-700', dot: 'bg-violet-500' },
  emerald: { ring: 'ring-emerald-200', activeBg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-500' },
  slate: { ring: 'ring-slate-200', activeBg: 'bg-slate-100', text: 'text-slate-700', dot: 'bg-slate-400' },
} as const;
export type FilterTone = keyof typeof TONES;

// ----------------------------------------------------------------------------
// Switch · toggle accesible (role=switch). Usado para "Solo activos" y flags.
// ----------------------------------------------------------------------------
export function Switch({
  checked,
  onChange,
  label,
  hint,
  disabled,
  size = 'md',
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label?: ReactNode;
  hint?: string;
  disabled?: boolean;
  size?: 'sm' | 'md';
}) {
  const dims = size === 'sm'
    ? { track: 'h-5 w-9', knob: 'h-4 w-4', on: 'translate-x-4', off: 'translate-x-0.5' }
    : { track: 'h-6 w-11', knob: 'h-5 w-5', on: 'translate-x-5', off: 'translate-x-0.5' };
  return (
    <label className={cn('inline-flex items-center gap-2', disabled ? 'opacity-60' : 'cursor-pointer')}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => !disabled && onChange(!checked)}
        className={cn(
          'relative inline-flex shrink-0 items-center rounded-full transition-colors',
          dims.track,
          checked ? 'bg-brand-cyan' : 'bg-slate-300',
        )}
      >
        <span className={cn('inline-block transform rounded-full bg-white shadow transition-transform', dims.knob, checked ? dims.on : dims.off)} />
      </button>
      {label && (
        <span className="select-none text-sm font-medium text-brand-ink">
          {label}
          {hint && <span className="ml-1 text-xs font-normal text-brand-muted">{hint}</span>}
        </span>
      )}
    </label>
  );
}

// ----------------------------------------------------------------------------
// FilterChips · selector de chips (multi por default). Para Estado / Prioridad.
// ----------------------------------------------------------------------------
export interface ChipOption<T extends string> {
  value: T;
  label: string;
  count?: number;
  tone?: FilterTone;
}
export function FilterChips<T extends string>({
  options,
  selected,
  onChange,
  multi = true,
  ariaLabel,
}: {
  options: ChipOption<T>[];
  selected: T[];
  onChange: (next: T[]) => void;
  multi?: boolean;
  ariaLabel?: string;
}) {
  function toggle(v: T) {
    if (selected.includes(v)) {
      onChange(selected.filter((x) => x !== v));
    } else {
      onChange(multi ? [...selected, v] : [v]);
    }
  }
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label={ariaLabel}>
      {options.map((o) => {
        const on = selected.includes(o.value);
        const tone = TONES[o.tone ?? 'cyan'];
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            onClick={() => toggle(o.value)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition',
              on
                ? cn('border-transparent text-white', tone.dot) // tone.dot es una clase bg-*
                : 'border-slate-200 bg-white text-brand-muted hover:border-slate-300 hover:text-brand-ink',
            )}
          >
            {o.label}
            {typeof o.count === 'number' && (
              <span className={cn('rounded-full px-1.5 text-[10px] tabular-nums', on ? 'bg-white/25' : 'bg-slate-100 text-brand-muted')}>
                {o.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ----------------------------------------------------------------------------
// FilterMultiSelect · botón + popover con checkboxes (+ búsqueda si hay muchas).
// Para Categoría / Servicio (muchas opciones).
// ----------------------------------------------------------------------------
export interface MultiSelectOption {
  value: string;
  label: string;
  count?: number;
}
export function FilterMultiSelect({
  label,
  options,
  selected,
  onChange,
  searchable,
  align = 'left',
  emptyText = 'Sin opciones',
}: {
  label: string;
  options: MultiSelectOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  searchable?: boolean;
  align?: 'left' | 'right';
  emptyText?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onEsc(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false); }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return options;
    return options.filter((o) => o.label.toLowerCase().includes(needle));
  }, [options, q]);

  function toggle(v: string) {
    onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition',
          selected.length > 0
            ? 'border-brand-cyan/40 bg-brand-cyan/5 text-brand-ink'
            : 'border-slate-300 bg-white text-brand-muted hover:border-slate-400 hover:text-brand-ink',
        )}
      >
        {label}
        {selected.length > 0 && (
          <span className="rounded-full bg-brand-cyan px-1.5 text-[10px] font-bold tabular-nums text-white">
            {selected.length}
          </span>
        )}
        <ChevronDown size={14} className={cn('transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div
          className={cn(
            'absolute z-30 mt-1 w-64 max-w-[80vw] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg',
            align === 'right' ? 'right-0' : 'left-0',
          )}
        >
          {searchable && (
            <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2">
              <Search size={14} className="text-brand-muted" />
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Buscar…"
                className="w-full bg-transparent text-sm outline-none placeholder:text-brand-muted/60"
              />
              {q && <button type="button" onClick={() => setQ('')} className="text-brand-muted hover:text-brand-ink"><X size={13} /></button>}
            </div>
          )}
          <ul className="max-h-64 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-xs text-brand-muted">{emptyText}</li>
            ) : filtered.map((o) => {
              const on = selected.includes(o.value);
              return (
                <li key={o.value}>
                  <button
                    type="button"
                    onClick={() => toggle(o.value)}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-brand-ink hover:bg-slate-50"
                  >
                    <span className={cn(
                      'grid h-4 w-4 shrink-0 place-items-center rounded border',
                      on ? 'border-brand-cyan bg-brand-cyan text-white' : 'border-slate-300',
                    )}>
                      {on && <Check size={11} />}
                    </span>
                    <span className="flex-1 truncate">{o.label}</span>
                    {typeof o.count === 'number' && <span className="text-[11px] tabular-nums text-brand-muted">{o.count}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
          {selected.length > 0 && (
            <div className="border-t border-slate-100 px-3 py-1.5">
              <button type="button" onClick={() => onChange([])} className="text-xs font-medium text-brand-cyan hover:underline">
                Limpiar selección
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------
// SegmentCard · KPI card clickeable que funciona como filtro (tu "cards filtro").
// ----------------------------------------------------------------------------
export function SegmentCard({
  label,
  count,
  icon: Icon,
  tone = 'cyan',
  active,
  onClick,
}: {
  label: string;
  count: number;
  icon?: LucideIcon;
  tone?: FilterTone;
  active: boolean;
  onClick: () => void;
}) {
  const t = TONES[tone];
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'group flex items-center gap-3 rounded-2xl border bg-white p-3 text-left shadow-sm transition',
        active ? cn('border-transparent ring-2', t.ring, t.activeBg) : 'border-slate-200 hover:border-slate-300 hover:shadow-md',
      )}
    >
      {Icon && (
        <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-full ring-1', t.activeBg, t.ring, t.text)}>
          <Icon size={16} />
        </span>
      )}
      <span className="min-w-0">
        <span className={cn('block font-display text-xl font-bold leading-none tabular-nums', active ? t.text : 'text-brand-ink')}>
          {count}
        </span>
        <span className="mt-0.5 block truncate text-xs font-medium text-brand-muted">{label}</span>
      </span>
    </button>
  );
}

// ----------------------------------------------------------------------------
// SortHeader · celda de encabezado clickeable (asc → desc → sin orden).
// ----------------------------------------------------------------------------
export type SortDir = 'asc' | 'desc';
export interface SortState { key: string; dir: SortDir }

export function SortHeader({
  label,
  sortKey,
  sort,
  onToggle,
  align = 'left',
  className,
}: {
  label: string;
  sortKey: string;
  sort: SortState | null;
  onToggle: (key: string) => void;
  align?: 'left' | 'right' | 'center';
  className?: string;
}) {
  const active = sort?.key === sortKey;
  return (
    <button
      type="button"
      onClick={() => onToggle(sortKey)}
      className={cn(
        'inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wider transition',
        active ? 'text-brand-cyan' : 'text-brand-muted hover:text-brand-ink',
        align === 'right' && 'flex-row-reverse',
        className,
      )}
    >
      {label}
      {!active ? (
        <ChevronsUpDown size={12} className="opacity-40 group-hover:opacity-70" />
      ) : sort!.dir === 'asc' ? (
        <ChevronUp size={12} />
      ) : (
        <ChevronDown size={12} />
      )}
    </button>
  );
}

// Hook de orden en memoria. `accessors` debe ser estable (módulo o useMemo).
export function useSort<T>(
  rows: T[],
  accessors: Record<string, (row: T) => string | number | null | undefined>,
  initial: SortState | null = null,
) {
  const [sort, setSort] = useState<SortState | null>(initial);

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const acc = accessors[sort.key];
    if (!acc) return rows;
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const va = acc(a);
      const vb = acc(b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1; // nulls al final siempre
      if (vb == null) return -1;
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return 0;
    });
  }, [rows, sort, accessors]);

  function toggle(key: string) {
    setSort((prev) => {
      if (!prev || prev.key !== key) return { key, dir: 'asc' };
      if (prev.dir === 'asc') return { key, dir: 'desc' };
      return null; // 3er click limpia el orden
    });
  }

  return { sorted, sort, toggle };
}

// ----------------------------------------------------------------------------
// ResultCount · "X de N" + Limpiar (solo si hay filtros activos).
// ----------------------------------------------------------------------------
export function ResultCount({
  shown,
  total,
  hasFilters,
  onClear,
  noun = 'resultados',
}: {
  shown: number;
  total: number;
  hasFilters: boolean;
  onClear?: () => void;
  noun?: string;
}) {
  return (
    <div className="flex items-center gap-2 text-xs text-brand-muted">
      <span className="tabular-nums">
        {shown === total ? `${total} ${noun}` : `${shown} de ${total} ${noun}`}
      </span>
      {hasFilters && onClear && (
        <button type="button" onClick={onClear} className="font-medium text-brand-cyan hover:underline">
          Limpiar filtros
        </button>
      )}
    </div>
  );
}
