import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Search as SearchIcon,
  CornerDownLeft,
  ArrowUp,
  ArrowDown,
  Command as CommandIcon,
} from 'lucide-react';
import { useCommandPalette, type PaletteCommand } from '@/contexts/CommandPaletteContext';
import { cn } from '@/lib/cn';

// UI del command palette. Montar una sola vez en el árbol (junto al
// CommandPaletteProvider).

const GROUP_LABEL: Record<PaletteCommand['group'], string> = {
  navegar: 'Navegar',
  acciones: 'Acciones',
  recientes: 'Recientes',
};

const GROUP_ORDER: PaletteCommand['group'][] = ['acciones', 'navegar', 'recientes'];

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
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [active, setActive] = useState(0);

  // Filter + group + sort
  const visible = useMemo(() => {
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

    // Group preserving filter order
    const grouped: Record<string, PaletteCommand[]> = {};
    for (const { cmd } of filtered) {
      (grouped[cmd.group] ??= []).push(cmd);
    }
    const order: { group: PaletteCommand['group']; items: PaletteCommand[] }[] = [];
    for (const g of GROUP_ORDER) {
      if (grouped[g]?.length) order.push({ group: g, items: grouped[g]! });
    }
    const flat = order.flatMap((o) => o.items);
    return { order, flat };
  }, [registered, search]);

  useEffect(() => {
    setActive(0);
  }, [search, isOpen]);

  // Autofocus input on open
  useEffect(() => {
    if (isOpen) {
      // Defer al siguiente frame para que el input esté en el DOM
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [isOpen]);

  // Keyboard nav
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActive((a) => Math.min(a + 1, visible.flat.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActive((a) => Math.max(a - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const cmd = visible.flat[active];
        if (cmd) {
          close();
          // Defer la acción para que se cierre la UI primero
          requestAnimationFrame(() => cmd.action());
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, active, visible.flat, close]);

  if (!isOpen) return null;

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
            placeholder="Buscar pantallas, acciones, clientes…"
            className="flex-1 bg-transparent text-sm text-brand-ink outline-none placeholder:text-brand-muted/70"
          />
          <kbd className="hidden rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-semibold text-brand-muted sm:inline">
            ESC
          </kbd>
        </div>

        <div className="max-h-[55vh] overflow-y-auto">
          {visible.flat.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-brand-muted">
              Sin resultados para "{search}".
            </div>
          ) : (
            visible.order.map(({ group, items }) => (
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
                        'flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition',
                        isActive
                          ? 'bg-brand-cyan-pale/30 text-brand-ink'
                          : 'text-brand-ink/85 hover:bg-slate-50',
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
                          // Lucide icon component
                          // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
            ))
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
