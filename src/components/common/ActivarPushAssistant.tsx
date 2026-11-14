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
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import { BANNER_TONES, premiumCtaClass } from '@/modules/portal/components/premiumBanner';

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

export function ActivarPushAssistant({ forceOpen = false }: { forceOpen?: boolean } = {}) {
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
  // forceOpen (llegada desde el email de engagement con ?origen=engagement):
  // ignora el cooldown de descarte para que el CTA aparezca sí o sí.
  if (!forceOpen && dismissedUntil && dismissedUntil > new Date()) return null;

  // DGG-254 · premium marca-nativa. Tono 'cielo' (azul cielo) para distinguirlo
  // de la agenda/perfil (brand) cuando ambos conviven en el inicio (DGG-254-b).
  const T = BANNER_TONES.cielo;
  return (
    <section className={`relative overflow-hidden gg-chamfer bg-gradient-to-br p-4 text-white sm:p-5 ${T.grad}`}>
      <TrianglesAccent position="top-right" size={132} tone={T.tri} density="rich" className="opacity-20" />
      <button
        type="button"
        onClick={dismiss}
        className="absolute right-2.5 top-2.5 rounded-md p-1.5 text-white/60 transition hover:bg-white/10 hover:text-white"
        aria-label="Cerrar"
      >
        <X size={16} />
      </button>

      <div className="relative flex flex-col gap-3 pr-7 sm:flex-row sm:items-center">
        <span className={`grid h-11 w-11 flex-shrink-0 place-items-center gg-chamfer-sm bg-white/10 ring-1 ring-white/25 ${T.accent}`}>
          <Bell size={20} className="motion-safe:animate-[wiggle_1.2s_ease-in-out_infinite]" />
        </span>
        <div className="min-w-0 flex-1">
          <p className={`kicker ${T.accent}`}>Activá las notificaciones</p>
          <h3 className="font-display text-base uppercase leading-tight tracking-tight sm:text-lg">
            No te pierdas ninguna novedad
          </h3>
          <p className="mt-0.5 text-xs text-white/80 sm:text-sm">
            Recibí avisos de avances, vencimientos, cobranzas y recordatorios — directo a tu teléfono o desktop, incluso con la app cerrada.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void activar()}
          disabled={activando}
          className={`shrink-0 ${premiumCtaClass('cielo')}`}
        >
          {activando ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
          Activar
        </button>
      </div>
    </section>
  );
}
