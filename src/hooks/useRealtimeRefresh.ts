import { useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';

// Hook que suscribe a postgres_changes de una o varias tablas y dispara
// onChange con un debounce corto, evitando recargar N veces si llegan
// múltiples eventos juntos (p.ej. bulk insert).
// La RLS de la tabla se aplica: solo recibimos eventos de filas visibles.

export function useRealtimeRefresh(
  tables: string[],
  onChange: () => void,
  debounceMs = 220,
): void {
  const cbRef = useRef(onChange);
  cbRef.current = onChange;

  useEffect(() => {
    if (tables.length === 0) return;

    let timer: number | undefined;
    const fire = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => cbRef.current(), debounceMs);
    };

    const channel = supabase.channel(`rt:${tables.join('+')}`);
    for (const t of tables) {
      channel.on(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        'postgres_changes' as any,
        { event: '*', schema: 'public', table: t },
        fire,
      );
    }
    channel.subscribe();

    return () => {
      window.clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tables.join(','), debounceMs]);
}
