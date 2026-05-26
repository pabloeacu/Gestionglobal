// ============================================================================
// RealtimeStatus · indicador de conexión Realtime de Supabase (P2-#15)
//
// Dot en el header que muestra:
//   • verde con pulse → conectado a Realtime
//   • ámbar → reconectando
//   • rojo → desconectado / offline
//
// Implementación: monta un canal "heartbeat" minimal y observa su estado vía
// el callback `(status) => ...` del subscribe. También escucha el evento
// `online/offline` del browser para señalizar fallas de red.
// ============================================================================

import { useEffect, useState } from 'react';
import { Radio, RadioReceiver, WifiOff } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/cn';

type Estado = 'conectado' | 'reconectando' | 'offline';

export function RealtimeStatus() {
  const [estado, setEstado] = useState<Estado>(
    typeof navigator !== 'undefined' && navigator.onLine ? 'reconectando' : 'offline',
  );

  useEffect(() => {
    if (typeof navigator === 'undefined') return;

    // Detectores de red del browser.
    const onOnline = () => setEstado('reconectando');
    const onOffline = () => setEstado('offline');
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);

    // Heartbeat realtime: subscribimos un canal vacío y observamos status.
    // No hace traffic real más allá del handshake/heartbeat de Supabase.
    const channel = supabase
      .channel('rt-heartbeat-' + Math.random().toString(36).slice(2, 8))
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') setEstado('conectado');
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          setEstado((prev) => (prev === 'offline' ? 'offline' : 'reconectando'));
        }
      });

    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      void supabase.removeChannel(channel);
    };
  }, []);

  const meta =
    estado === 'conectado'
      ? {
          icon: Radio,
          label: 'Realtime activo',
          dotClass: 'bg-emerald-500',
          tooltip: 'Conectado a la base de datos en tiempo real',
          pulse: true,
        }
      : estado === 'reconectando'
        ? {
            icon: RadioReceiver,
            label: 'Reconectando…',
            dotClass: 'bg-amber-500',
            tooltip: 'Conectando a Realtime…',
            pulse: true,
          }
        : {
            icon: WifiOff,
            label: 'Sin conexión',
            dotClass: 'bg-rose-500',
            tooltip: 'Sin red — los cambios se sincronizarán cuando vuelva',
            pulse: false,
          };

  return (
    <span
      className="inline-flex items-center gap-1.5"
      title={meta.tooltip}
      aria-label={meta.label}
      role="status"
    >
      <span className="relative flex h-2 w-2 shrink-0">
        {meta.pulse && (
          <span
            className={cn(
              'absolute inset-0 inline-flex h-full w-full animate-ping rounded-full opacity-75',
              meta.dotClass,
            )}
          />
        )}
        <span className={cn('relative inline-flex h-2 w-2 rounded-full', meta.dotClass)} />
      </span>
      <span className="hidden text-[10px] font-medium uppercase tracking-wider text-brand-muted sm:inline">
        {estado === 'conectado' ? 'En vivo' : estado === 'reconectando' ? 'Conectando' : 'Offline'}
      </span>
    </span>
  );
}
