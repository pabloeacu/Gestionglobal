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
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import { BANNER_TONES, premiumCtaClass } from './premiumBanner';

const STORAGE_KEY = 'gg_portal_pwa_dismissed_until_v1';
const COOLDOWN_DAYS = 7;

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function PortalPwaAssistant({ forceOpen = false }: { forceOpen?: boolean } = {}) {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIosCard, setShowIosCard] = useState(false);
  const [showOpenInSafariCard, setShowOpenInSafariCard] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [dismissedUntil, setDismissedUntil] = useState<Date | null>(loadDismissed());

  useEffect(() => {
    // Detectar standalone: si ya está instalada, no mostramos nada
    if (isStandalone()) {
      setInstalled(true);
      return;
    }

    if (isIosNonSafari()) {
      // Chrome/Edge/Firefox en iOS: NO permiten instalar la PWA. Hay que abrir
      // en Safari. Mostramos card con instrucciones específicas.
      setShowOpenInSafariCard(true);
      return;
    }

    if (isIosSafari()) {
      // iOS Safari: no soporta beforeinstallprompt — instrucciones manuales.
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

  // Decidir si mostrar. forceOpen (llegada desde el email de engagement):
  // ignora el cooldown y, en desktop donde `beforeinstallprompt` puede no
  // dispararse, igual muestra la tarjeta con instrucciones manuales.
  const hasTrigger = installEvent !== null || showIosCard || showOpenInSafariCard;
  const notDismissed = !dismissedUntil || dismissedUntil < new Date();
  const genericFallback = forceOpen && !hasTrigger; // desktop sin evento beforeinstallprompt
  const shouldShow = !installed && (forceOpen || (hasTrigger && notDismissed));
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

  // DGG-254-b · tono 'app' (azul-azur): INSTALAR la app va distinto del assistant
  // de notificaciones (cielo) — en el bloque de engagement aparecen pegados.
  const T = BANNER_TONES.app;
  return (
    <div className={`relative overflow-hidden gg-chamfer bg-gradient-to-br p-4 text-white sm:p-5 ${T.grad}`}>
      <TrianglesAccent position="top-right" size={132} tone={T.tri} density="rich" className="opacity-20" />
      {/* Dismiss */}
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
          <Smartphone size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <p className={`kicker ${T.accent}`}>Experiencia app</p>
          <h3 className="font-display text-base uppercase leading-tight tracking-tight sm:text-lg">
            {showOpenInSafariCard
              ? 'Abrí esta página en Safari'
              : 'Instalá Gestión Global en tu pantalla'}
          </h3>
          <p className="mt-0.5 text-xs text-white/80">
            {showOpenInSafariCard
              ? 'En iPhone, las notificaciones y la app instalada SÓLO funcionan desde Safari (no desde Chrome).'
              : showIosCard
                ? 'Acceso directo desde el escritorio + notificaciones · sin app store.'
                : 'Un toque y tenés Gestión Global como app en tu teléfono o desktop.'}
          </p>
        </div>

        {installEvent && !showIosCard && !showOpenInSafariCard && (
          <button
            type="button"
            onClick={() => void handleInstall()}
            className={`shrink-0 ${premiumCtaClass('app')}`}
          >
            <Download size={14} /> Instalar
          </button>
        )}
      </div>

      {/* Chrome/Edge/Firefox iOS: instrucciones para cambiar a Safari */}
      {showOpenInSafariCard && (
        <div className="relative mt-3 gg-chamfer-sm bg-white/10 p-3 text-sm text-white ring-1 ring-white/20">
          <p className="mb-2 font-semibold text-white">Cómo abrir en Safari:</p>
          <ol className="space-y-1.5 text-xs">
            <li className="flex items-start gap-2">
              <span className="grid h-5 w-5 flex-shrink-0 place-items-center rounded-full bg-white/15 text-brand-cyan-light text-[10px] font-bold">1</span>
              <span>Mantené presionada la dirección <strong>gestionglobal.ar</strong> arriba</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="grid h-5 w-5 flex-shrink-0 place-items-center rounded-full bg-white/15 text-brand-cyan-light text-[10px] font-bold">2</span>
              <span>Elegí <strong>Copiar</strong> el enlace</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="grid h-5 w-5 flex-shrink-0 place-items-center rounded-full bg-white/15 text-brand-cyan-light text-[10px] font-bold">3</span>
              <span>Abrí <strong>Safari</strong> desde la pantalla de inicio, pegá la URL y entrá</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="grid h-5 w-5 flex-shrink-0 place-items-center rounded-full bg-white/15 text-brand-cyan-light text-[10px] font-bold">4</span>
              <span>Una vez en Safari, vas a poder instalar la app y activar notificaciones <Sparkles size={11} className="inline mb-0.5" /></span>
            </li>
          </ol>
          <p className="mt-2 text-[10px] text-white/70">
            Es una limitación de iOS: todos los navegadores menos Safari corren sobre WebKit con notificaciones deshabilitadas por Apple.
          </p>
        </div>
      )}

      {/* Desktop sin beforeinstallprompt (forzado desde el email): instrucciones manuales */}
      {genericFallback && (
        <div className="relative mt-3 gg-chamfer-sm bg-white/10 p-3 text-xs text-white ring-1 ring-white/20">
          <p className="mb-1 font-semibold text-white">Cómo instalarla:</p>
          <p>
            En la compu (Chrome/Edge): tocá el ícono <strong>⊕ Instalar</strong> en la barra de
            direcciones, o el menú <strong>⋮</strong> → <strong>“Instalar Gestión Global”</strong>.
            En el teléfono: menú del navegador → <strong>“Agregar a pantalla de inicio”</strong>.
          </p>
        </div>
      )}

      {/* Instrucciones iOS Safari */}
      {showIosCard && (
        <div className="relative mt-3 gg-chamfer-sm bg-white/10 p-3 text-sm text-white ring-1 ring-white/20">
          <p className="mb-2 font-semibold text-white">3 pasos en Safari (iPhone/iPad):</p>
          <ol className="space-y-1.5 text-xs">
            <li className="flex items-start gap-2">
              <span className="grid h-5 w-5 flex-shrink-0 place-items-center rounded-full bg-white/15 text-brand-cyan-light text-[10px] font-bold">1</span>
              <span>Tocá <Share2 size={11} className="inline mb-0.5" /> <strong>Compartir</strong> abajo</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="grid h-5 w-5 flex-shrink-0 place-items-center rounded-full bg-white/15 text-brand-cyan-light text-[10px] font-bold">2</span>
              <span>Bajá y elegí <Plus size={11} className="inline mb-0.5" /> <strong>Agregar a inicio</strong></span>
            </li>
            <li className="flex items-start gap-2">
              <span className="grid h-5 w-5 flex-shrink-0 place-items-center rounded-full bg-white/15 text-brand-cyan-light text-[10px] font-bold">3</span>
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

// En iOS TODOS los navegadores usan WebKit y la única forma de instalar PWA es
// vía Safari → Compartir → Agregar a pantalla de inicio. Si el usuario está en
// Chrome iOS / Edge iOS / Firefox iOS, el flujo es igual pero hay que decirles
// que cambien a Safari primero (los otros browsers en iOS NO permiten
// "Agregar a inicio" desde su menú compartir).
function isIosNonSafari(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  const isIos = /iPad|iPhone|iPod/.test(ua) && !(window as Window & { MSStream?: unknown }).MSStream;
  if (!isIos) return false;
  // Chrome iOS = CriOS, Edge iOS = EdgiOS, Firefox iOS = FxiOS
  return /(CriOS|EdgiOS|FxiOS)/.test(ua);
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
