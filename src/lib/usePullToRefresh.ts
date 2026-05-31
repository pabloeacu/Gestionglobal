// Hook para pull-to-refresh en mobile (iOS-like).
//
// Detecta cuando el usuario está scrolleado al tope (scrollTop===0) y empieza
// a arrastrar hacia abajo más de TRIGGER_PX. Llama a `onRefresh()` y muestra
// un spinner mientras la promesa esté pendiente.
//
// Apply: en el wrapper de página que tenga overflow scroll:
//   const { listeners, indicator } = usePullToRefresh(async () => await load());
//   return <div {...listeners}>{indicator}<contenido /></div>;

import { useCallback, useEffect, useRef, useState, type TouchEvent as ReactTouchEvent } from 'react';

const TRIGGER_PX = 70;
const MAX_PULL_PX = 110;
const RESISTANCE = 0.55; // qué porción del drag se "ve" (sensación de elástico)

export function usePullToRefresh(onRefresh: () => void | Promise<void>) {
  const [pullPx, setPullPx] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startYRef = useRef<number | null>(null);
  const activeRef = useRef(false);

  // No es un pull si el scroll padre no está en 0.
  function isAtTop(): boolean {
    if (typeof document === 'undefined') return false;
    const el = document.scrollingElement || document.documentElement;
    return (el?.scrollTop ?? 0) <= 0;
  }

  const onTouchStart = useCallback((e: ReactTouchEvent) => {
    if (refreshing) return;
    if (!isAtTop()) return;
    const t = e.touches[0];
    if (!t) return;
    startYRef.current = t.clientY;
    activeRef.current = true;
  }, [refreshing]);

  const onTouchMove = useCallback((e: ReactTouchEvent) => {
    if (!activeRef.current || startYRef.current == null || refreshing) return;
    const t = e.touches[0];
    if (!t) return;
    const dy = t.clientY - startYRef.current;
    if (dy <= 0) {
      setPullPx(0);
      return;
    }
    // Solo "tomamos" el gesto si seguimos en tope.
    if (!isAtTop()) {
      activeRef.current = false;
      setPullPx(0);
      return;
    }
    const eff = Math.min(MAX_PULL_PX, dy * RESISTANCE);
    setPullPx(eff);
  }, [refreshing]);

  const finish = useCallback(async () => {
    if (!activeRef.current) return;
    activeRef.current = false;
    if (pullPx >= TRIGGER_PX) {
      setRefreshing(true);
      setPullPx(TRIGGER_PX);
      try {
        await onRefresh();
      } finally {
        setRefreshing(false);
        setPullPx(0);
        startYRef.current = null;
      }
    } else {
      setPullPx(0);
      startYRef.current = null;
    }
  }, [pullPx, onRefresh]);

  const onTouchEnd = useCallback(() => {
    void finish();
  }, [finish]);
  const onTouchCancel = useCallback(() => {
    void finish();
  }, [finish]);

  useEffect(() => {
    return () => {
      activeRef.current = false;
    };
  }, []);

  const visiblePct = Math.min(1, pullPx / TRIGGER_PX);

  return {
    listeners: { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel },
    pullPx,
    refreshing,
    visiblePct,
  };
}
