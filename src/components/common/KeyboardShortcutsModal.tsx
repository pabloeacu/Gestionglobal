// ============================================================================
// KeyboardShortcutsModal · cheat sheet de atajos de teclado (P2-#12)
//
// Modal que se abre con la tecla "?" (registrada globalmente en
// `useKeyboardShortcutsListener`) o vía CommandPalette ("Atajos de teclado").
// Lista los atajos por sección con kbd-style chips.
// ============================================================================

import { useEffect, useState } from 'react';
import { Keyboard, Search, ArrowLeft, ArrowRight, ArrowUp, ArrowDown, Command, Bell, Briefcase, type LucideIcon } from 'lucide-react';
import { Modal } from './Modal';
import { cn } from '@/lib/cn';

interface ShortcutDef {
  keys: string[];   // ej: ['⌘', 'K'] o ['Esc']
  label: string;
}
interface Section {
  title: string;
  icon: LucideIcon;
  items: ShortcutDef[];
}

const SECTIONS: Section[] = [
  {
    title: 'Navegación global',
    icon: Search,
    items: [
      { keys: ['⌘', 'K'], label: 'Abrir buscador / paleta de comandos' },
      { keys: ['?'], label: 'Abrir esta ayuda de atajos' },
      { keys: ['Esc'], label: 'Cerrar modal / paleta / drawer' },
      { keys: ['↑', '↓'], label: 'Navegar dentro de listas y resultados' },
      { keys: ['↵'], label: 'Confirmar selección' },
    ],
  },
  {
    title: 'Constructor de formularios',
    icon: Briefcase,
    items: [
      { keys: ['⌘', 'Z'], label: 'Deshacer último cambio' },
      { keys: ['⌘', '⇧', 'Z'], label: 'Rehacer cambio' },
      { keys: ['⌘', 'Y'], label: 'Rehacer (alternativo)' },
    ],
  },
  {
    title: 'Notificaciones',
    icon: Bell,
    items: [
      { keys: ['Esc'], label: 'Cerrar dropdown de la campana' },
    ],
  },
];

const useKey = (handler: (e: KeyboardEvent) => void, deps: React.DependencyList) => {
  useEffect(() => {
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
};

export function KeyboardShortcutsModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Atajos de teclado"
      kicker="Premium · navegación rápida"
      icon={<Keyboard size={16} />}
      width={520}
    >
      <div className="space-y-5">
        <p className="text-sm text-brand-muted">
          Estos atajos funcionan en cualquier pantalla logueada. En mobile
          la mayoría se reemplazan por gestos táctiles.
        </p>

        {SECTIONS.map((s) => {
          const Icon = s.icon;
          return (
            <section key={s.title} className="space-y-2">
              <h3 className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-brand-muted">
                <Icon size={12} className="text-brand-cyan" /> {s.title}
              </h3>
              <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
                {s.items.map((it, i) => (
                  <li
                    key={i}
                    className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                  >
                    <span className="text-brand-ink/85">{it.label}</span>
                    <span className="flex items-center gap-1">
                      {it.keys.map((k, j) => (
                        <kbd
                          key={j}
                          className={cn(
                            'inline-flex h-6 min-w-[1.5rem] items-center justify-center rounded-md border border-slate-200 bg-slate-50 px-1.5 text-[11px] font-semibold text-brand-ink',
                            (k === '↑' || k === '↓' || k === '←' || k === '→' || k === '↵') && 'font-bold text-brand-cyan',
                          )}
                        >
                          {k}
                        </kbd>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}

        <div className="rounded-lg border border-brand-cyan/30 bg-brand-cyan-pale/20 px-3 py-2 text-[11.5px] text-brand-cyan">
          <p>
            <Command size={11} className="mr-1 inline" />
            Tip: las flechas <ArrowLeft size={11} className="inline" /> <ArrowRight size={11} className="inline" /> <ArrowUp size={11} className="inline" /> <ArrowDown size={11} className="inline" />
            funcionan dentro de cualquier menú o lista interactiva.
          </p>
        </div>
      </div>
    </Modal>
  );
}

/**
 * Hook que registra "?" como atajo global para abrir el modal.
 * Pasarle el `setOpen` que controla el modal. Skipea cuando el foco
 * está dentro de un input/textarea (para no robar la tecla).
 */
export function useShortcutsHotkey(setOpen: (v: boolean) => void) {
  useKey((e) => {
    if (e.key !== '?') return;
    const target = e.target as HTMLElement | null;
    if (!target) return;
    const tag = target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (target.isContentEditable) return;
    // Algunos teclados producen "?" sólo con Shift. Lo permitimos igual.
    e.preventDefault();
    setOpen(true);
  }, []);
}

/**
 * Componente self-contained: monta el modal y registra el hotkey.
 * Útil para colgar en GerenciaLayout / PortalLayout sin manage state externo.
 */
export function ShortcutsHelpProvider() {
  const [open, setOpen] = useState(false);
  useShortcutsHotkey(setOpen);
  return <KeyboardShortcutsModal open={open} onClose={() => setOpen(false)} />;
}
