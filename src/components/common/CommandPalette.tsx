import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
// No usamos `useNavigate` porque CommandPalette se monta fuera de
// <BrowserRouter> (en main.tsx, junto al AuthProvider). Para navegar
// usamos un push manual al history del browser via window.location o
// history.pushState + popstate, evitando el hook violation.
import {
  Search as SearchIcon,
  CornerDownLeft,
  ArrowUp,
  ArrowDown,
  Command as CommandIcon,
  Users,
  FileText,
  Inbox,
  CalendarClock,
  Briefcase,
  GraduationCap,
  Handshake,
  ClipboardList,
  Loader2,
  type LucideIcon,
} from 'lucide-react';
import { useCommandPalette, type PaletteCommand } from '@/contexts/CommandPaletteContext';
import { cn } from '@/lib/cn';
import {
  buscarGlobal,
  type BusquedaItem,
  type BusquedaKind,
} from '@/services/api/busqueda';

// UI del command palette. Montar una sola vez en el árbol (junto al
// CommandPaletteProvider).
//
// Dos secciones:
//   1. "Comandos"     → registrados vía useRegisterCommand (navegación + acciones).
//   2. "Resultados"   → datos reales de la BD vía RPC busqueda_global, agrupados
//                       por kind. Debounce 200 ms, mínimo 2 caracteres.
//
// Cita: regla 4 (services/api), regla 12 (tenancy guard inline en la RPC),
// regla 13 (sin window.* — esto ES el reemplazo de spotlight nativo).

const GROUP_LABEL: Record<PaletteCommand['group'], string> = {
  navegar: 'Navegar',
  acciones: 'Acciones',
  recientes: 'Recientes',
};

const GROUP_ORDER: PaletteCommand['group'][] = ['acciones', 'navegar', 'recientes'];

const KIND_META: Record<
  BusquedaKind,
  { label: string; icon: LucideIcon; chip: string }
> = {
  administracion: { label: 'Cliente',       icon: Users,         chip: 'bg-brand-cyan-pale/60 text-brand-cyan'      },
  comprobante:    { label: 'Comprobante',   icon: FileText,      chip: 'bg-amber-50 text-amber-700'                 },
  tramite:        { label: 'Trámite',       icon: Inbox,         chip: 'bg-violet-50 text-violet-700'               },
  vencimiento:    { label: 'Vencimiento',   icon: CalendarClock, chip: 'bg-rose-50 text-rose-700'                   },
  servicio:       { label: 'Servicio',      icon: Briefcase,     chip: 'bg-emerald-50 text-emerald-700'             },
  curso:          { label: 'Curso',         icon: GraduationCap, chip: 'bg-indigo-50 text-indigo-700'               },
  partner:        { label: 'Partner',       icon: Handshake,     chip: 'bg-sky-50 text-sky-700'                     },
  formulario:     { label: 'Formulario',    icon: ClipboardList, chip: 'bg-slate-100 text-slate-700'                },
};

const KIND_ORDER: BusquedaKind[] = [
  'administracion',
  'comprobante',
  'tramite',
  'vencimiento',
  'servicio',
  'curso',
  'partner',
  'formulario',
];

function score(needle: string, hay: string): number {
  if (!needle) return 0.5;
  const n = needle.toLowerCase();
  const h = hay.toLowerCase();
  if (h === n) return 10;
  if (h.startsWith(n)) return 5;
  if (h.includes(n)) return 3;
  // fuzzy super simple: cada char de n en orden dentro de h
  let i = 0;
  for (const c of h) {
    if (c === n[i]) i++;
    if (i === n.length) return 1;
  }
  return 0;
}

export function CommandPalette() {
  const { isOpen, close, search, setSearch, registered } = useCommandPalette();
  // Push manual al history del browser. React Router escucha popstate y
  // re-rendea la ruta. Mejor que window.location.href (no recarga la app).
  const navigate = useCallback((path: string) => {
    window.history.pushState({}, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, []);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [active, setActive] = useState(0);

  // Resultados remotos
  const [results, setResults] = useState<BusquedaItem[]>([]);
  const [loading, setLoading] = useState(false);
  const reqIdRef = useRef(0);

  // Debounce 200 ms y llamada a la RPC. Cancelamos requests obsoletos por id.
  useEffect(() => {
    const q = search.trim();
    if (!isOpen || q.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    const myId = ++reqIdRef.current;
    setLoading(true);
    const t = setTimeout(async () => {
      const res = await buscarGlobal(q, 6);
      if (myId !== reqIdRef.current) return; // request obsoleto
      if (res.ok) setResults(res.data);
      else setResults([]);
      setLoading(false);
    }, 200);
    return () => clearTimeout(t);
  }, [search, isOpen]);

  // Filtrado + grouping de comandos registrados
  const visibleCommands = useMemo(() => {
    const path =
      typeof window !== 'undefined' ? window.location.pathname : '/';
    const filtered = registered
      .filter(
        (c) => !c.whenPathStartsWith || path.startsWith(c.whenPathStartsWith),
      )
      .map((c) => ({
        cmd: c,
        s: Math.max(score(search, c.label), score(search, c.description ?? '')),
      }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s);

    const grouped: Record<string, PaletteCommand[]> = {};
    for (const { cmd } of filtered) {
      (grouped[cmd.group] ??= []).push(cmd);
    }
    const order: { group: PaletteCommand['group']; items: PaletteCommand[] }[] = [];
    for (const g of GROUP_ORDER) {
      if (grouped[g]?.length) order.push({ group: g, items: grouped[g]! });
    }
    return order;
  }, [registered, search]);

  // Resultados agrupados por kind (preservando el orden global por rank dentro
  // de cada grupo — `buscarGlobal` ya ordenó por rank descendente).
  const resultsByKind = useMemo(() => {
    const map = new Map<BusquedaKind, BusquedaItem[]>();
    for (const r of results) {
      const arr = map.get(r.kind) ?? [];
      arr.push(r);
      map.set(r.kind, arr);
    }
    return KIND_ORDER
      .filter((k) => map.has(k))
      .map((k) => ({ kind: k, items: map.get(k)! }));
  }, [results]);

  // Aplanado para keyboard nav. Comandos primero, después resultados (en el
  // orden de KIND_ORDER).
  const flat = useMemo(() => {
    type FlatItem =
      | { kind: 'command'; cmd: PaletteCommand }
      | { kind: 'result'; item: BusquedaItem };
    const items: FlatItem[] = [];
    for (const g of visibleCommands) {
      for (const c of g.items) items.push({ kind: 'command', cmd: c });
    }
    for (const g of resultsByKind) {
      for (const r of g.items) items.push({ kind: 'result', item: r });
    }
    return items;
  }, [visibleCommands, resultsByKind]);

  useEffect(() => {
    setActive(0);
  }, [search, isOpen, results.length]);

  // Autofocus al abrir
  useEffect(() => {
    if (isOpen) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [isOpen]);

  // Keyboard nav
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActive((a) => Math.min(a + 1, flat.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActive((a) => Math.max(a - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const it = flat[active];
        if (!it) return;
        close();
        if (it.kind === 'command') {
          requestAnimationFrame(() => it.cmd.action());
        } else {
          requestAnimationFrame(() => navigate(it.item.url_path));
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, active, flat, close, navigate]);

  if (!isOpen) return null;

  const trimmedSearch = search.trim();
  const hasQuery = trimmedSearch.length >= 2;
  const isEmpty =
    flat.length === 0 && (!loading || !hasQuery);

  let flatIdx = 0;

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center bg-brand-ink/40 px-4 pt-[14vh] backdrop-blur-sm motion-safe:animate-fade-in"
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <div
        role="dialog"
        aria-label="Command palette"
        className="w-full max-w-xl overflow-hidden rounded-2xl border border-slate-200 bg-white/95 shadow-[0_30px_80px_-20px_rgba(18,34,48,0.5)] backdrop-blur-md motion-safe:animate-spring-in"
      >
        <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-3">
          <SearchIcon size={16} className="text-brand-muted" />
          <input
            ref={inputRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar pantallas, acciones, clientes, comprobantes…"
            className="flex-1 bg-transparent text-sm text-brand-ink outline-none placeholder:text-brand-muted/70"
          />
          {loading && hasQuery && (
            <Loader2
              size={14}
              className="animate-spin text-brand-muted"
              aria-label="Buscando"
            />
          )}
          <kbd className="hidden rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-semibold text-brand-muted sm:inline">
            ESC
          </kbd>
        </div>

        <div className="max-h-[55vh] overflow-y-auto">
          {/* Comandos */}
          {visibleCommands.length > 0 &&
            visibleCommands.map(({ group, items }) => (
              <div key={group} className="py-1">
                <p className="px-4 py-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-brand-muted">
                  {GROUP_LABEL[group]}
                </p>
                {items.map((c) => {
                  const myIdx = flatIdx++;
                  const isActive = myIdx === active;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onMouseEnter={() => setActive(myIdx)}
                      onClick={() => {
                        close();
                        requestAnimationFrame(() => c.action());
                      }}
                      className={cn(
                        'flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition motion-safe:animate-fade-up',
                        isActive
                          ? 'bg-brand-cyan-pale/30 text-brand-ink'
                          : 'text-brand-ink/85 hover:bg-brand-cyan-pale/20',
                      )}
                    >
                      <span
                        className={cn(
                          'grid h-7 w-7 place-items-center rounded-md text-brand-cyan',
                          isActive
                            ? 'bg-brand-cyan text-white'
                            : 'bg-brand-cyan-pale/40',
                        )}
                      >
                        {c.icon ? (
                          (() => {
                            const Icon = c.icon as React.ComponentType<{
                              size?: number;
                            }>;
                            return <Icon size={14} />;
                          })()
                        ) : (
                          <span className="text-[10px] font-bold">·</span>
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">
                          {c.label}
                        </span>
                        {c.description && (
                          <span className="block truncate text-xs text-brand-muted">
                            {c.description}
                          </span>
                        )}
                      </span>
                      {c.shortcutHint && (
                        <kbd className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-semibold text-brand-muted">
                          {c.shortcutHint}
                        </kbd>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}

          {/* Resultados de BD */}
          {resultsByKind.length > 0 && (
            <div className="border-t border-slate-100 pt-1">
              <p className="flex items-center justify-between px-4 py-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-brand-muted">
                <span>Resultados</span>
                <span className="font-normal normal-case tracking-normal text-brand-muted/70">
                  {results.length} {results.length === 1 ? 'coincidencia' : 'coincidencias'}
                </span>
              </p>
              {resultsByKind.map(({ kind, items }) => {
                const meta = KIND_META[kind];
                const Icon = meta.icon;
                return (
                  <div key={kind}>
                    <p className="px-4 pt-1 pb-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-brand-muted/80">
                      {meta.label}
                    </p>
                    {items.map((r) => {
                      const myIdx = flatIdx++;
                      const isActive = myIdx === active;
                      return (
                        <button
                          key={`${r.kind}-${r.id}`}
                          type="button"
                          onMouseEnter={() => setActive(myIdx)}
                          onClick={() => {
                            close();
                            requestAnimationFrame(() => navigate(r.url_path));
                          }}
                          className={cn(
                            'flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition motion-safe:animate-fade-up',
                            isActive
                              ? 'bg-brand-cyan-pale/30 text-brand-ink'
                              : 'text-brand-ink/85 hover:bg-brand-cyan-pale/20',
                          )}
                        >
                          <span
                            className={cn(
                              'grid h-7 w-7 place-items-center rounded-md',
                              isActive
                                ? 'bg-brand-cyan text-white'
                                : meta.chip,
                            )}
                          >
                            <Icon size={14} />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium">
                              {r.titulo}
                            </span>
                            {r.subtitulo && (
                              <span className="block truncate text-xs text-brand-muted">
                                {r.subtitulo}
                              </span>
                            )}
                          </span>
                          <span
                            className={cn(
                              'rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                              meta.chip,
                            )}
                          >
                            {meta.label}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          )}

          {/* Estado vacío */}
          {isEmpty && (
            <div className="px-4 py-10 text-center text-sm text-brand-muted">
              {hasQuery
                ? `Sin coincidencias para "${trimmedSearch}".`
                : 'Empezá a escribir para buscar clientes, comprobantes, trámites…'}
            </div>
          )}
          {/* Loading sin resultados aún */}
          {flat.length === 0 && loading && hasQuery && (
            <div className="flex items-center justify-center gap-2 px-4 py-10 text-sm text-brand-muted">
              <Loader2 size={14} className="animate-spin" />
              Buscando "{trimmedSearch}"…
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-slate-100 bg-brand-zebra/40 px-4 py-2 text-[11px] text-brand-muted">
          <span className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1">
              <ArrowUp size={11} />
              <ArrowDown size={11} /> navegar
            </span>
            <span className="inline-flex items-center gap-1">
              <CornerDownLeft size={11} /> ir
            </span>
          </span>
          <span className="inline-flex items-center gap-1">
            <CommandIcon size={11} />
            <span className="font-semibold">K</span> abrir / cerrar
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
