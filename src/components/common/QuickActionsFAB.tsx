// ============================================================================
// QuickActionsFAB · botón flotante con acciones rápidas en mobile (P2-#9)
//
// FAB cyan en bottom-right (solo mobile · md:hidden). Al tocar abre un mini
// menú radial con las acciones más usadas: Nueva administración, Nuevo
// comprobante, Buscar (⌘K), Atajos. En desktop está oculto porque ya hay
// botones explícitos y atajos de teclado.
// ============================================================================

import { useState } from 'react';
import { Plus, Search, Keyboard, Users, FileText, X } from 'lucide-react';
import { useCommandPalette } from '@/contexts/CommandPaletteContext';
import { cn } from '@/lib/cn';

interface QuickActionsFABProps {
  onShortcuts?: () => void;
}

export function QuickActionsFAB({ onShortcuts }: QuickActionsFABProps) {
  const [open, setOpen] = useState(false);
  const palette = useCommandPalette();

  function navigate(path: string) {
    window.history.pushState({}, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }

  function doAction(fn: () => void) {
    setOpen(false);
    requestAnimationFrame(fn);
  }

  const actions = [
    {
      icon: Users,
      label: 'Cliente',
      onClick: () => doAction(() => navigate('/gerencia/clientes')),
      tone: 'bg-brand-cyan text-white',
    },
    {
      icon: FileText,
      label: 'Factura',
      onClick: () => doAction(() => navigate('/gerencia/facturacion')),
      tone: 'bg-amber-500 text-white',
    },
    {
      icon: Search,
      label: 'Buscar',
      onClick: () => doAction(() => palette.open()),
      tone: 'bg-violet-500 text-white',
    },
    {
      icon: Keyboard,
      label: 'Atajos',
      onClick: () => doAction(() => onShortcuts?.()),
      tone: 'bg-slate-700 text-white',
    },
  ];

  return (
    <div className="fixed bottom-5 right-5 z-40 flex flex-col items-end gap-2 md:hidden">
      {open &&
        actions.map((a, i) => {
          const Icon = a.icon;
          return (
            <button
              key={i}
              type="button"
              onClick={a.onClick}
              aria-label={a.label}
              className={cn(
                'group flex h-11 items-center gap-2 rounded-full pl-3 pr-4 shadow-lg motion-safe:animate-fade-up',
                a.tone,
              )}
              style={{ animationDelay: `${i * 40}ms` }}
            >
              <Icon size={16} />
              <span className="text-xs font-semibold">{a.label}</span>
            </button>
          );
        })}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={open ? 'Cerrar acciones' : 'Acciones rápidas'}
        className={cn(
          'grid h-14 w-14 place-items-center rounded-full shadow-[0_14px_32px_-8px_rgba(14,155,200,0.55)] transition',
          open
            ? 'rotate-45 bg-rose-500 text-white'
            : 'bg-brand-cyan text-white hover:bg-brand-cyan/90',
        )}
      >
        {open ? <X size={22} /> : <Plus size={22} />}
      </button>
    </div>
  );
}
