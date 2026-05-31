// F4 · Hook para listados que se refrescan post-save sin generar flash blanco.
//
// El patrón viejo `setLoading(true)` en cada `load()` borraba el contenido
// renderizado durante el refetch → pantalla blanca momentánea cada vez que el
// usuario guardaba algo o llegaba un realtime event. Premium ⇒ NO.
//
// Esta abstracción separa:
//   · `loading`  = TRUE sólo en la PRIMERA carga (skeleton OK ahí).
//   · `refreshing` = TRUE en refrescos posteriores (mostramos data vieja
//     + indicador sutil top).
//   · `data` = nunca vuelve a null tras la primera carga exitosa.
//
// API:
//   const { data, loading, refreshing, error, reload, setData } =
//     useRefreshableData(async () => await listSolicitudes({...}));
//
// Render:
//   if (loading) return <Skeleton/>;
//   return (
//     <>
//       {refreshing && <RefreshIndicator/>}
//       <Contenido data={data} />
//     </>
//   );
//
// Importante: el caller pasa la dependencia explícita (deps array) y la
// función loader fresca; el hook se encarga del ciclo.

import { useCallback, useEffect, useRef, useState } from 'react';

export interface RefreshableResult<T> {
  data: T | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  /** Forzar refetch. No muta loading (mostrará "refreshing"). */
  reload: () => Promise<void>;
  /** Actualización optimista local (sin fetch). */
  setData: (next: T | ((prev: T | null) => T)) => void;
}

export function useRefreshableData<T>(
  loader: () => Promise<T>,
  deps: readonly unknown[] = [],
): RefreshableResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Capturamos el último loader sin re-disparar el efecto.
  const loaderRef = useRef(loader);
  loaderRef.current = loader;
  // Para detectar la primera carga vs posteriores.
  const firstLoadDone = useRef(false);
  // Para descartar respuestas obsoletas (race condition).
  const reqIdRef = useRef(0);

  const reload = useCallback(async () => {
    const myId = ++reqIdRef.current;
    if (firstLoadDone.current) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const res = await loaderRef.current();
      if (myId !== reqIdRef.current) return; // descartar obsoleto
      setData(res);
      firstLoadDone.current = true;
    } catch (e) {
      if (myId !== reqIdRef.current) return;
      setError(e instanceof Error ? e.message : 'Error al cargar');
    } finally {
      if (myId !== reqIdRef.current) return;
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  // Update optimista local sin disparar refetch (útil para mutaciones).
  const updateData = useCallback((next: T | ((prev: T | null) => T)) => {
    setData((prev) => {
      if (typeof next === 'function') return (next as (p: T | null) => T)(prev);
      return next;
    });
  }, []);

  return { data, loading, refreshing, error, reload, setData: updateData };
}
