// Hook para sincronizar el estado de filtros de un listado con la URL
// (query string). Permite deep-link, back/forward del browser y compartir
// vistas filtradas.
//
// Uso:
//   const [filters, setFilter, resetFilters] = useUrlFilters({
//     estado: 'todos',
//     categoria: '',
//     periodo: '30d',
//   });
//   <Select value={filters.estado} onChange={(v) => setFilter('estado', v)} />
//
// Los defaults se omiten del query string para mantenerlo limpio (si el valor
// es igual al default, no se escribe a la URL).

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';

export function useUrlFilters<T extends Record<string, string>>(
  defaults: T,
): [T, (key: keyof T, value: string) => void, () => void] {
  const [params, setParams] = useSearchParams();
  const defaultsRef = useRef(defaults);

  // Reconstruir el estado actual leyendo de URL + defaults.
  const current = useMemo<T>(() => {
    const out: Record<string, string> = {};
    for (const key of Object.keys(defaultsRef.current)) {
      const v = params.get(key);
      out[key] = v ?? defaultsRef.current[key as keyof T] ?? '';
    }
    return out as T;
  }, [params]);

  const setFilter = useCallback(
    (key: keyof T, value: string) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          const def = defaultsRef.current[key];
          if (value === def || value === '') {
            next.delete(key as string);
          } else {
            next.set(key as string, value);
          }
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  const resetFilters = useCallback(() => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const key of Object.keys(defaultsRef.current)) {
          next.delete(key);
        }
        return next;
      },
      { replace: true },
    );
  }, [setParams]);

  // Cleanup al desmontar: opcional, dejamos URL como está para back/forward.
  useEffect(() => {
    return () => {
      /* noop — los filtros quedan al volver */
    };
  }, []);

  return [current, setFilter, resetFilters];
}
