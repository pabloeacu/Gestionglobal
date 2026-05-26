import { useEffect, useState } from 'react';

/**
 * P2 #4 · Devuelve `true` cuando un estado de carga llevó más de `timeoutMs`
 * milisegundos sin resolverse, para que la UI ofrezca "Reintentar" en vez de
 * dejar al usuario mirando un skeleton infinito.
 *
 * Default 8s — ver justificación en BACKLOG (P2 #4): widgets ancilares de
 * este proyecto suelen tardar 1-3s en condiciones normales; 8s da 2x margen
 * para red lenta/celular sin disparar falsos positivos.
 */
export function useLoadingTimeout(loading: boolean, timeoutMs = 8000): boolean {
  const [isStale, setIsStale] = useState(false);

  useEffect(() => {
    if (!loading) {
      setIsStale(false);
      return;
    }
    setIsStale(false);
    const id = window.setTimeout(() => setIsStale(true), timeoutMs);
    return () => window.clearTimeout(id);
  }, [loading, timeoutMs]);

  return isStale;
}
