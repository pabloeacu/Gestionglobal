// ActivarPushAssistant · Tarjeta universal de CTA "Activá las notificaciones"
// que se muestra en cualquier dashboard cuando:
//   - El browser soporta push (Notification API + service worker)
//   - El usuario aún NO ha dado permiso (permission === 'default') o aún no
//     hay subscription registrada en BD.
// Single-click → pide permiso → suscribe → desaparece. Si el browser no
// soporta (ej. iOS Safari sin PWA instalada), no se muestra.
//
// Sirve a todos los roles: gerencia, cliente, partner, gestor.

import { useEffect, useState } from 'react';
import { Bell, Check, Loader2, X } from 'lucide-react';
import { toast } from '@/lib/toast';
import {
  pushSoportado,
  estadoSuscripcion,
  pedirPermisoYSuscribir,
} from '@/services/api/push';
import { humanizeError } from '@/lib/errors';

const STORAGE_KEY = 'gg.activar_push.dismissed_until';
const COOLDOWN_DAYS = 14;

function loadDismissed(): Date | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (!v) return null;
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

export function ActivarPushAssistant() {
  const [activadas, setActivadas] = useState(false);
  const [soportado, setSoportado] = useState(false);
  const [permisoDenegado, setPermisoDenegado] = useState(false);
  const [activando, setActivando] = useState(false);
  const [loading, setLoading] = useState(true);
  const [dismissedUntil, setDismissedUntil] = useState<Date | null>(loadDismissed());

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const sup = pushSoportado();
      if (!sup) { setSoportado(false); setLoading(false); return; }
      setSoportado(true);
      if (typeof Notification !== 'undefined' && Notification.permission === 'denied') {
        setPermisoDenegado(true);
        setLoading(false);
        return;
      }
      const res = await estadoSuscripcion();
      if (cancelled) return;
      if (res.ok) setActivadas(res.data.activa);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  function dismiss() {
    const until = new Date(Date.now() + COOLDOWN_DAYS * 24 * 60 * 60 * 1000);
    try { localStorage.setItem(STORAGE_KEY, until.toISOString()); } catch { /* noop */ }
    setDismissedUntil(until);
  }

  async function activar() {
    setActivando(true);
    const res = await pedirPermisoYSuscribir();
    setActivando(false);
    if (res.ok) {
      setActivadas(true);
      toast.success('¡Listo!', { description: 'Te vamos a avisar cuando haya novedades importantes.' });
    } else {
      if (res.error.code === 'DENIED') {
        setPermisoDenegado(true);
        toast.error('Permiso denegado. Habilitalo desde la configuración del browser.');
      } else {
        toast.error('No pudimos activar las notificaciones', { description: humanizeError(res.error) });
      }
    }
  }

  if (loading) return null;
  if (!soportado) return null;
  if (activadas) return null;
  if (permisoDenegado) return null;
  if (dismissedUntil && dismissedUntil > new Date()) return null;

  return (
    <section className="relative overflow-hidden rounded-2xl border-2 border-cyan-200 bg-gradient-to-br from-cyan-50 via-white to-teal-50 p-4 shadow-sm ring-1 ring-cyan-100 sm:p-5">
      <button
        type="button"
        onClick={dismiss}
        className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-full text-brand-muted transition hover:bg-white/80 hover:text-brand-ink"
        aria-label="Cerrar"
      >
        <X size={13} />
      </button>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <span className="grid h-12 w-12 flex-shrink-0 place-items-center rounded-2xl bg-brand-cyan text-white shadow-sm">
          <Bell size={22} className="motion-safe:animate-[wiggle_1.2s_ease-in-out_infinite]" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="kicker text-brand-cyan">Activá las notificaciones</p>
          <h3 className="font-display text-lg font-bold text-brand-ink">
            No te pierdas ninguna novedad
          </h3>
          <p className="mt-0.5 text-xs text-brand-muted sm:text-sm">
            Recibí avisos de avances, vencimientos, cobranzas y recordatorios — directo a tu teléfono o desktop, incluso con la app cerrada.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void activar()}
          disabled={activando}
          className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-brand-cyan px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-cyan-700 disabled:opacity-60"
        >
          {activando ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
          Activar
        </button>
      </div>
    </section>
  );
}
