// PortalPushAssistant · Banner que invita a activar notificaciones push.
// Sólo aparece si: push soportado + permission ∉ denied + no suscripto.
// Estado dismissed con cooldown 7 días (localStorage).

import { useEffect, useState } from 'react';
import { Bell, X, Loader2, CheckCircle2 } from 'lucide-react';
import { toast } from '@/lib/toast';
import {
  pushSoportado,
  estadoSuscripcion,
  pedirPermisoYSuscribir,
} from '@/services/api/push';
import { humanizeError } from '@/lib/errors';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import { BANNER_TONES, premiumCtaClass } from './premiumBanner';

const STORAGE_KEY = 'gg_portal_push_dismissed_until_v1';
const COOLDOWN_DAYS = 7;

export function PortalPushAssistant() {
  const [shouldShow, setShouldShow] = useState(false);
  const [working, setWorking] = useState(false);
  const [subscribed, setSubscribed] = useState(false);

  useEffect(() => {
    let mounted = true;
    async function check() {
      if (!pushSoportado()) return;
      if (typeof Notification === 'undefined') return;
      if (Notification.permission === 'denied') return;

      const dismissed = loadDismissed();
      if (dismissed && dismissed > new Date()) return;

      const status = await estadoSuscripcion();
      if (!mounted) return;
      if (!status.ok) return;
      if (status.data?.activa) {
        setSubscribed(true);
        return;
      }
      setShouldShow(true);
    }
    void check();
    return () => { mounted = false; };
  }, []);

  if (subscribed) {
    return null;
  }

  if (!shouldShow) return null;

  function dismiss() {
    const until = new Date(Date.now() + COOLDOWN_DAYS * 24 * 60 * 60 * 1000);
    try { localStorage.setItem(STORAGE_KEY, until.toISOString()); } catch {}
    setShouldShow(false);
  }

  async function handleActivate() {
    setWorking(true);
    const res = await pedirPermisoYSuscribir();
    setWorking(false);
    if (!res.ok) {
      toast.error('No pudimos activar', { description: humanizeError(res.error) });
      return;
    }
    setSubscribed(true);
    setShouldShow(false);
    toast.success('¡Notificaciones activadas!', { description: 'Te avisaremos antes de cada clase, evento y vencimiento.' });
  }

  // DGG-254 · premium marca-nativa. Tono 'cielo' (azul cielo) para distinguir
  // los assistants del nudge de agenda (brand) cuando conviven (DGG-254-b).
  const T = BANNER_TONES.cielo;
  return (
    <div className={`relative overflow-hidden gg-chamfer bg-gradient-to-br p-4 text-white sm:p-5 ${T.grad}`}>
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
          <Bell size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <p className={`kicker ${T.accent}`}>Recordatorios</p>
          <h3 className="font-display text-base uppercase leading-tight tracking-tight sm:text-lg">
            Activá la campanita
          </h3>
          <p className="mt-0.5 text-xs text-white/80">
            Te avisamos antes de cada clase, evento y vencimiento importante. Sin spam, sólo lo necesario.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void handleActivate()}
          disabled={working}
          className={`shrink-0 ${premiumCtaClass('cielo')}`}
        >
          {working ? <Loader2 size={14} className="animate-spin" /> : <Bell size={14} />}
          {working ? 'Activando…' : 'Activar'}
        </button>
      </div>
    </div>
  );
}

function loadDismissed(): Date | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const d = new Date(raw);
    return isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

export function PushActiveBadge() {
  const [active, setActive] = useState(false);
  useEffect(() => {
    let mounted = true;
    if (!pushSoportado()) return;
    void estadoSuscripcion().then((r) => {
      if (!mounted) return;
      if (r.ok && r.data?.activa) setActive(true);
    });
    return () => { mounted = false; };
  }, []);
  if (!active) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700 ring-1 ring-inset ring-amber-200">
      <CheckCircle2 size={10} /> Avisos activos
    </span>
  );
}
