// ============================================================================
// useCardDismiss · E-GG-158 (pedido de Pablo, 2026-07-24)
//
// Descarte persistente de un card de aviso del Inicio de gerencia. La X
// guarda el INSTANTE del descarte (localStorage, por navegador); el card
// vuelve a aparecer SOLO cuando hay items posteriores a ese instante.
// Así el gerente decide cuándo dejar de ver un aviso, sin perderse nunca
// una novedad: lo nuevo siempre revive el card.
//
// (Es preferencia visual por dispositivo, no estado de negocio — por eso
// localStorage y no BD; la regla 1 aplica a mutaciones de dominio.)
// ============================================================================
import { useCallback, useState } from 'react';

export function useCardDismiss(storageKey: string): {
  dismissedAt: number;
  dismiss: () => void;
} {
  const [dismissedAt, setDismissedAt] = useState<number>(() => {
    try {
      return Number(localStorage.getItem(storageKey)) || 0;
    } catch {
      return 0;
    }
  });

  const dismiss = useCallback(() => {
    const ahora = Date.now();
    setDismissedAt(ahora);
    try {
      localStorage.setItem(storageKey, String(ahora));
    } catch {
      // Sin storage disponible: el descarte vale al menos para esta sesión.
    }
  }, [storageKey]);

  return { dismissedAt, dismiss };
}
