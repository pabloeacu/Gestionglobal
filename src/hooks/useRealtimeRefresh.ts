import { useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';

// Hook que suscribe a postgres_changes de una o varias tablas y dispara
// onChange con un debounce corto, evitando recargar N veces si llegan
// múltiples eventos juntos (p.ej. bulk insert).
// La RLS de la tabla se aplica: solo recibimos eventos de filas visibles.

// DGG-166 §6 (prueba en vivo): el nombre de canal DEBE ser único por instancia.
// Antes era `rt:${tables.join('+')}` — si DOS componentes montados a la vez usaban
// el MISMO set de tablas (p. ej. EgresadosSinCertWidget y CertsRetenidosWidget en el
// Inicio, ambos con matricula_condiciones+curso_matriculas+certificados), el 2.º
// `supabase.channel(name)` reusaba el canal ya suscripto y `.on()` post-subscribe
// tiraba "cannot add postgres_changes callbacks after subscribe()", crasheando la
// página entera. Un id incremental por hook garantiza canales distintos.
let __rtSeq = 0;

export function useRealtimeRefresh(
  tables: string[],
  onChange: () => void,
  debounceMs = 220,
): void {
  const cbRef = useRef(onChange);
  cbRef.current = onChange;
  const idRef = useRef(0);
  if (idRef.current === 0) idRef.current = ++__rtSeq;

  useEffect(() => {
    if (tables.length === 0) return;

    let timer: number | undefined;
    const fire = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => cbRef.current(), debounceMs);
    };

    const channel = supabase.channel(`rt:${tables.join('+')}:${idRef.current}`);
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
