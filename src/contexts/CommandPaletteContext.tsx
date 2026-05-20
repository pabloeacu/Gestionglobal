import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

// Command palette global con ⌘K / Ctrl+K. La UI vive en
// src/components/common/CommandPalette.tsx y se monta junto al provider.

export interface PaletteCommand {
  id: string;
  label: string;
  description?: string;
  group: 'navegar' | 'acciones' | 'recientes';
  /** Texto cuando aparezca como atajo en la fila (p.ej. "N" o "⌘K"). */
  shortcutHint?: string;
  /** Lucide-react icon component. Lo tipo como any para no acoplar import. */
  icon?: unknown;
  /** Ejecuta el comando. El palette se cierra antes. */
  action: () => void;
  /** Para que aparezca solo en ciertas rutas, opcional. */
  whenPathStartsWith?: string;
}

interface PaletteApi {
  open: () => void;
  close: () => void;
  toggle: () => void;
  isOpen: boolean;
  search: string;
  setSearch: (s: string) => void;
  registered: PaletteCommand[];
  register: (cmd: PaletteCommand) => () => void;
}

const Ctx = createContext<PaletteApi | null>(null);

export function CommandPaletteProvider({ children }: { children: ReactNode }) {
  const [isOpen, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [registered, setRegistered] = useState<PaletteCommand[]>([]);

  const open = useCallback(() => {
    setSearch('');
    setOpen(true);
  }, []);
  const close = useCallback(() => setOpen(false), []);
  const toggle = useCallback(() => {
    setSearch('');
    setOpen((v) => !v);
  }, []);

  const register = useCallback((cmd: PaletteCommand) => {
    setRegistered((rs) => {
      if (rs.some((r) => r.id === cmd.id)) return rs;
      return [...rs, cmd];
    });
    return () => {
      setRegistered((rs) => rs.filter((r) => r.id !== cmd.id));
    };
  }, []);

  // ⌘K / Ctrl+K listener global
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        toggle();
      } else if (e.key === 'Escape' && isOpen) {
        close();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle, close, isOpen]);

  const value = useMemo<PaletteApi>(
    () => ({ open, close, toggle, isOpen, search, setSearch, registered, register }),
    [open, close, toggle, isOpen, search, registered, register],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCommandPalette(): PaletteApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useCommandPalette requiere CommandPaletteProvider');
  return ctx;
}

// Hook para registrar comandos desde cualquier componente con cleanup.
export function useRegisterCommand(cmd: PaletteCommand | null): void {
  const { register } = useCommandPalette();
  useEffect(() => {
    if (!cmd) return;
    return register(cmd);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cmd?.id, cmd?.label]);
}
