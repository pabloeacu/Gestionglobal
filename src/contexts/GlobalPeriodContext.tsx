// ============================================================================
// GlobalPeriodContext · período global de la plataforma (P2-#13)
//
// Provee un período "vivo" que muchas pantallas pueden consumir:
// dashboard de Inicio, KPIs de Finanzas, horizonte de Vencimientos, rango
// de Cuenta Corriente, etc.
//
// Persistido en localStorage `gg.globalPeriod`. Si el usuario cambia desde
// el dropdown en el header, todas las pantallas que consumen el hook se
// re-renderizan automáticamente.
//
// El context provee dos formas de uso:
//   1. `usePeriod()` → { kind, days, label, since, until }
//      Para componentes que sólo lo necesitan leer.
//   2. `usePeriodSetter()` → ((kind) => void)
//      Para el dropdown que lo cambia. Separado para evitar re-renders
//      innecesarios en consumers de solo-lectura.
// ============================================================================

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export type PeriodKind = '7d' | '30d' | '90d' | '1y' | 'all';

export interface PeriodValue {
  kind: PeriodKind;
  days: number; // 0 = "todo"
  label: string;
  since: Date | null;
  until: Date;
}

const KIND_TO_DAYS: Record<PeriodKind, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
  '1y': 365,
  all: 0,
};

const KIND_TO_LABEL: Record<PeriodKind, string> = {
  '7d': 'Últimos 7 días',
  '30d': 'Últimos 30 días',
  '90d': 'Últimos 90 días',
  '1y': 'Último año',
  all: 'Todo el historial',
};

function computeValue(kind: PeriodKind): PeriodValue {
  const days = KIND_TO_DAYS[kind];
  const until = new Date();
  const since = days > 0
    ? new Date(until.getTime() - days * 24 * 60 * 60 * 1000)
    : null;
  return {
    kind,
    days,
    label: KIND_TO_LABEL[kind],
    since,
    until,
  };
}

const STORAGE_KEY = 'gg.globalPeriod';
const DEFAULT_KIND: PeriodKind = '30d';

const PeriodValueCtx = createContext<PeriodValue | null>(null);
const PeriodSetterCtx = createContext<((kind: PeriodKind) => void) | null>(null);

export function GlobalPeriodProvider({ children }: { children: ReactNode }) {
  const [kind, setKind] = useState<PeriodKind>(() => {
    try {
      const v = localStorage.getItem(STORAGE_KEY);
      if (v === '7d' || v === '30d' || v === '90d' || v === '1y' || v === 'all') return v;
    } catch { /* ignore */ }
    return DEFAULT_KIND;
  });

  const value = useMemo(() => computeValue(kind), [kind]);

  const setter = useCallback((next: PeriodKind) => {
    setKind(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch { /* ignore */ }
  }, []);

  // Re-computamos `until` si pasa medianoche estando en la pestaña: el
  // valor "Últimos 30 días" debería avanzar. Cheapest: dispara cada hora.
  useEffect(() => {
    const id = setInterval(() => setKind((k) => k), 60 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <PeriodValueCtx.Provider value={value}>
      <PeriodSetterCtx.Provider value={setter}>
        {children}
      </PeriodSetterCtx.Provider>
    </PeriodValueCtx.Provider>
  );
}

export function usePeriod(): PeriodValue {
  const v = useContext(PeriodValueCtx);
  if (!v) {
    // Fallback: si el provider no está montado (ej. una página pública),
    // devolvemos un default 30d. No crashea ni obliga a wrappear todo.
    return computeValue(DEFAULT_KIND);
  }
  return v;
}

export function usePeriodSetter(): (kind: PeriodKind) => void {
  const fn = useContext(PeriodSetterCtx);
  if (!fn) {
    // No-op cuando no hay provider (sin warnings ruidosos).
    return () => {};
  }
  return fn;
}

// Lista de opciones para el dropdown.
export const PERIOD_OPTIONS: Array<{ kind: PeriodKind; label: string }> = [
  { kind: '7d',  label: '7 días' },
  { kind: '30d', label: '30 días' },
  { kind: '90d', label: '90 días' },
  { kind: '1y',  label: '1 año' },
  { kind: 'all', label: 'Todo' },
];
