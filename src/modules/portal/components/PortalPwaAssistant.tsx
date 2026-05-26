// PortalPwaAssistant · Banner discreto que invita a instalar la PWA.
// Detecta automáticamente si está en standalone (no muestra), y diferencia
// iOS Safari (instrucciones manuales) vs Chrome/Edge (beforeinstallprompt).
//
// Estado: 'dismissed_until' en localStorage con cooldown de 7 días.

import { useEffect, useState } from 'react';
import {
  Smartphone,
  Share2,
  Plus,
  X,
  Download,
  Sparkles,
  CheckCircle2,
} from 'lucide-react';
import { toast } from '@/lib/toast';

const STORAGE_KEY = 'gg_portal_pwa_dismissed_until_v1';
const COOLDOWN_DAYS = 7;

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function PortalPwaAssistant() {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIosCard, setShowIosCard] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [dismissedUntil, setDismissedUntil] = useState<Date | null>(loadDismissed());

  useEffect(() => {
    // Detectar standalone: si ya está instalada, no mostramos nada
    if (isStandalone()) {
      setInstalled(true);
      return;
    }

    const isIos = isIosSafari();
    if (isIos) {
      // iOS no soporta beforeinstallprompt — mostramos instrucciones manuales
      setShowIosCard(true);
      return;
    }

    function onBeforeInstall(e: Event) {
      e.preventDefault();
      setInstallEvent(e as BeforeInstallPromptEvent);
    }
    function onAppInstalled() {
      setInstalled(true);
      toast.success('¡App instalada!', { description: 'Ahora podés abrir Gestión Global desde el escritorio.' });
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onAppInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onAppInstalled);
    };
  }, []);

  // Decidir si mostrar
  const shouldShow = !installed && (installEvent !== null || showIosCard) && (!dismissedUntil || dismissedUntil < new Date());
  if (!shouldShow) return null;

  function dismiss() {
    const until = new Date(Date.now() + COOLDOWN_DAYS * 24 * 60 * 60 * 1000);
    try { localStorage.setItem(STORAGE_KEY, until.toISOString()); } catch {}
    setDismissedUntil(until);
  }

  async function handleInstall() {
    if (!installEvent) return;
    await installEvent.prompt();
    const { outcome } = await installEvent.userChoice;
    if (outcome === 'accepted') {
      setInstalled(true);
    } else {
      dismiss();
    }
    setInstallEvent(null);
  }

  return (
    <div className="relative overflow-hidden rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-cyan-50 p-4 shadow-sm sm:p-5">
      {/* Dismiss */}
      <button
        type="button"
        onClick={dismiss}
        className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-full text-brand-muted transition hover:bg-white/80 hover:text-brand-ink"
        aria-label="Cerrar"
      >
        <X size={13} />
      </button>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <span className="grid h-12 w-12 flex-shrink-0 place-items-center rounded-2xl bg-emerald-100 text-emerald-700">
          <Smartphone size={22} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="kicker text-emerald-700 opacity-80">EXPERIENCIA APP</p>
          <h3 className="font-display text-lg font-bold text-brand-ink">
            Instalá Gestión Global en tu pantalla
          </h3>
          <p className="mt-0.5 text-xs text-brand-muted">
            {showIosCard
              ? 'Acceso directo desde el escritorio + notificaciones · sin app store.'
              : 'Un toque y tenés Gestión Global como app en tu teléfono o desktop.'}
          </p>
        </div>

        {installEvent && !showIosCard && (
          <button
            type="button"
            onClick={() => void handleInstall()}
            className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700"
          >
            <Download size={14} /> Instalar
          </button>
        )}
      </div>

      {/* Instrucciones iOS */}
      {showIosCard && (
        <div className="mt-3 rounded-xl bg-white/80 p-3 text-sm text-brand-ink ring-1 ring-emerald-200">
          <p className="mb-2 font-semibold text-brand-ink">3 pasos en Safari (iPhone/iPad):</p>
          <ol className="space-y-1.5 text-xs">
            <li className="flex items-start gap-2">
              <span className="grid h-5 w-5 flex-shrink-0 place-items-center rounded-full bg-emerald-100 text-emerald-700 text-[10px] font-bold">1</span>
              <span>Tocá <Share2 size={11} className="inline mb-0.5" /> <strong>Compartir</strong> abajo</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="grid h-5 w-5 flex-shrink-0 place-items-center rounded-full bg-emerald-100 text-emerald-700 text-[10px] font-bold">2</span>
              <span>Bajá y elegí <Plus size={11} className="inline mb-0.5" /> <strong>Agregar a inicio</strong></span>
            </li>
            <li className="flex items-start gap-2">
              <span className="grid h-5 w-5 flex-shrink-0 place-items-center rounded-full bg-emerald-100 text-emerald-700 text-[10px] font-bold">3</span>
              <span>Confirmá. Ya tenés Gestión Global como app <Sparkles size={11} className="inline mb-0.5" /></span>
            </li>
          </ol>
        </div>
      )}
    </div>
  );
}

// Helpers state
function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  // Chrome/Edge/Android
  if (window.matchMedia('(display-mode: standalone)').matches) return true;
  // iOS Safari
  const navAny = navigator as Navigator & { standalone?: boolean };
  return navAny.standalone === true;
}

function isIosSafari(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  const isIos = /iPad|iPhone|iPod/.test(ua) && !(window as Window & { MSStream?: unknown }).MSStream;
  const isSafari = /^((?!chrome|android).)*safari/i.test(ua);
  return isIos && isSafari;
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

// Icono para mostrar estado instalado si querés exhibirlo en perfil
export function PwaInstalledBadge() {
  if (!isStandalone()) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200">
      <CheckCircle2 size={10} /> App instalada
    </span>
  );
}
