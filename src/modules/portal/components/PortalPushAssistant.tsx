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
    toast.success('¡Notificaciones activadas!', { description: 'Te avisaremos antes de cada clase, webinar y vencimiento.' });
  }

  return (
    <div className="relative overflow-hidden rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 via-white to-yellow-50 p-4 shadow-sm sm:p-5">
      <button
        type="button"
        onClick={dismiss}
        className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-full text-brand-muted transition hover:bg-white/80 hover:text-brand-ink"
        aria-label="Cerrar"
      >
        <X size={13} />
      </button>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <span className="grid h-12 w-12 flex-shrink-0 place-items-center rounded-2xl bg-amber-100 text-amber-700">
          <Bell size={22} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="kicker text-amber-700 opacity-80">RECORDATORIOS</p>
          <h3 className="font-display text-lg font-bold text-brand-ink">
            Activá la campanita
          </h3>
          <p className="mt-0.5 text-xs text-brand-muted">
            Te avisamos antes de cada clase, webinar y vencimiento importante. Sin spam, sólo lo necesario.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void handleActivate()}
          disabled={working}
          className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-amber-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-amber-700 disabled:opacity-60"
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
