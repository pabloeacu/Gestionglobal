// PortalOnboardingTour · Tour custom (sin libs externas) que guía al
// cliente la primera vez que entra al portal. Modal alineado top (no
// centrado, para no taparse con el header). Reproducible en mobile.
//
// El estado se persiste en localStorage (`gg_portal_tour_v1`) para no
// re-aparecer en cada visita. Reseteable desde Perfil.
//
// Paso "Instalá la app" muestra contenido adaptativo según device:
//   - en celular sin standalone → instrucciones de install
//   - en desktop → tip "te lo podés instalar como app en el celu"

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Home,
  GraduationCap,
  FileText,
  Video,
  PlusCircle,
  Sparkles,
  ChevronRight,
  ChevronLeft,
  X,
  Bell,
  Smartphone,
  Share2,
  Plus,
  Lock,
  Download,
} from 'lucide-react';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';

const STORAGE_KEY = 'gg_portal_tour_v1';

interface Props {
  open: boolean;
  onClose: () => void;
}

interface Step {
  icon: typeof Home;
  kicker: string;
  titulo: string;
  // Si descripcion es función, recibe info de device para variar contenido
  descripcion: string | ((ctx: DeviceCtx) => React.ReactNode);
}

interface DeviceCtx {
  isStandalone: boolean;
  isIos: boolean;
  isAndroid: boolean;
  isMobile: boolean;
  isIosSafari: boolean;
  isIosChrome: boolean;
  isAndroidChrome: boolean;
  isAndroidFirefox: boolean;
  isFirefox: boolean;
  notifSupported: boolean;
  notifPermission: NotificationPermission | 'unsupported';
}

function detectDevice(): DeviceCtx {
  if (typeof window === 'undefined') {
    return {
      isStandalone: false, isIos: false, isAndroid: false, isMobile: false,
      isIosSafari: false, isIosChrome: false, isAndroidChrome: false,
      isAndroidFirefox: false, isFirefox: false, notifSupported: false,
      notifPermission: 'unsupported',
    };
  }
  const ua = navigator.userAgent;
  const isIos = /iPad|iPhone|iPod/.test(ua);
  const isAndroid = /Android/.test(ua);
  const isMobile = isIos || isAndroid || /Mobile/.test(ua);
  // iOS Chrome ("CriOS") y iOS Firefox ("FxiOS"): igual son WebKit pero distinto chrome de instalación
  const isIosChrome = isIos && /CriOS/.test(ua);
  const isIosSafari = isIos && !/CriOS|FxiOS|EdgiOS/.test(ua);
  const isAndroidChrome = isAndroid && /Chrome/.test(ua) && !/Firefox/.test(ua);
  const isAndroidFirefox = isAndroid && /Firefox/.test(ua);
  const isFirefox = /Firefox/.test(ua);
  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const notifSupported = 'Notification' in window && 'serviceWorker' in navigator;
  const notifPermission: NotificationPermission | 'unsupported' = notifSupported
    ? Notification.permission
    : 'unsupported';
  return {
    isStandalone, isIos, isAndroid, isMobile,
    isIosSafari, isIosChrome, isAndroidChrome, isAndroidFirefox, isFirefox,
    notifSupported, notifPermission,
  };
}

const STEPS: Step[] = [
  {
    icon: Sparkles,
    kicker: 'BIENVENIDO',
    titulo: 'Tu portal de servicios',
    descripcion:
      'Acá tenés todo lo que contrataste con Gestión Global: cursos, trámites, eventos, comprobantes y más. Te lo presentamos en pocos pasos.',
  },
  {
    icon: Home,
    kicker: 'INICIO',
    titulo: 'Acceso inteligente',
    descripcion:
      'La pantalla principal te muestra lo más importante del día: tus clases próximas, eventos de hoy, vencimientos urgentes y oportunidades para vos.',
  },
  {
    icon: GraduationCap,
    kicker: 'CAMPUS',
    titulo: 'Mis cursos & clases en vivo',
    descripcion:
      'Tu carrera profesional centralizada. Cuando una clase esté por empezar, vas a ver el botón "Unirme" desde el inicio.',
  },
  {
    icon: Video,
    kicker: 'EVENTOS',
    titulo: 'Capacitaciones y encuentros',
    descripcion:
      'Anotate a eventos formativos de Gestión Global — online y presenciales. Te avisamos antes de cada uno por mail y notificación push.',
  },
  {
    icon: FileText,
    kicker: 'GESTIONES',
    titulo: 'Mis trámites · sin perderles el rastro',
    descripcion:
      'Todos tus trámites con estado actualizado, comentarios, archivos y novedades. Si necesitamos algo tuyo, lo verás como "Tu acción".',
  },
  {
    icon: PlusCircle,
    kicker: 'NUEVO SERVICIO',
    titulo: 'Pedí lo que necesites',
    descripcion:
      'Desde acá iniciás un nuevo trámite, consulta jurídica, renovación de matrícula o inscripción a curso. Te guiamos paso a paso.',
  },
  {
    icon: Bell,
    kicker: 'NOTIFICACIONES',
    titulo: 'Activá la campanita',
    descripcion: (ctx) => {
      if (!ctx.notifSupported) {
        return (
          <span>
            Tu navegador no soporta notificaciones push. Probá desde Chrome, Safari moderno o Firefox para recibir avisos antes de cada clase, evento y vencimiento.
          </span>
        );
      }
      if (ctx.notifPermission === 'granted') {
        return (
          <span>
            Ya tenés las notificaciones <strong>activadas</strong>. Te vamos a avisar antes de cada clase, evento y vencimiento importante. Sin spam.
          </span>
        );
      }
      if (ctx.notifPermission === 'denied') {
        if (ctx.isIos) {
          return (
            <span>
              Las notificaciones están bloqueadas. En iPhone: <strong>Ajustes → Notificaciones → Safari/Gestión Global → permitir</strong>. Después volvés acá y se activan solas.
            </span>
          );
        }
        if (ctx.isAndroid) {
          return (
            <span>
              Las notificaciones están bloqueadas. En Android: tocá el candado <Lock size={11} className="inline mb-0.5" /> a la izquierda de la URL → <strong>Permisos → Notificaciones</strong> → permitir.
            </span>
          );
        }
        return (
          <span>
            Las notificaciones están bloqueadas. Hacé click en el candado <Lock size={11} className="inline mb-0.5" /> al lado de la URL → <strong>Notificaciones → Permitir</strong>.
          </span>
        );
      }
      // default
      return (
        <span>
          Te avisamos antes de cada clase, evento y vencimiento importante. Sin spam, sólo lo necesario. La activás desde el banner verde del inicio · un toque y listo.
        </span>
      );
    },
  },
  {
    icon: Smartphone,
    kicker: 'EXPERIENCIA APP',
    titulo: 'Llevátelo al celular',
    descripcion: (ctx) => {
      if (ctx.isStandalone) {
        return (
          <span>
            Ya tenés Gestión Global instalada como app en este dispositivo <Sparkles size={12} className="inline mb-0.5 text-amber-500" />. Vas a recibir notificaciones push y abrir directo desde el escritorio.
          </span>
        );
      }
      // iOS Safari → instrucciones nativas
      if (ctx.isIosSafari) {
        return (
          <span>
            En iPhone/iPad, agregás Gestión Global como app en 3 pasos desde Safari:
            <ol className="mt-2 space-y-1 text-xs">
              <li className="flex items-start gap-2">
                <span className="grid h-5 w-5 flex-shrink-0 place-items-center rounded-full bg-emerald-100 text-emerald-700 text-[10px] font-bold">1</span>
                <span>Tocá <Share2 size={11} className="inline mb-0.5" /> <strong>Compartir</strong> abajo en el centro</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="grid h-5 w-5 flex-shrink-0 place-items-center rounded-full bg-emerald-100 text-emerald-700 text-[10px] font-bold">2</span>
                <span>Bajá hasta <Plus size={11} className="inline mb-0.5" /> <strong>Agregar a inicio</strong></span>
              </li>
              <li className="flex items-start gap-2">
                <span className="grid h-5 w-5 flex-shrink-0 place-items-center rounded-full bg-emerald-100 text-emerald-700 text-[10px] font-bold">3</span>
                <span>Confirmá. ¡Ya tenés la app! <Sparkles size={11} className="inline mb-0.5 text-amber-500" /></span>
              </li>
            </ol>
          </span>
        );
      }
      // iOS Chrome / Firefox / Edge → no se puede instalar, redirigir a Safari
      if (ctx.isIos) {
        return (
          <span>
            En iPhone, la instalación funciona solo desde <strong>Safari</strong>. Copiá esta URL y abrila en Safari (icono brújula), después: <Share2 size={11} className="inline mb-0.5" /> Compartir → <Plus size={11} className="inline mb-0.5" /> Agregar a inicio.
          </span>
        );
      }
      // Android Chrome (debería disparar beforeinstallprompt automáticamente)
      if (ctx.isAndroidChrome) {
        return (
          <span>
            Vas a ver el banner verde <strong>"Instalá Gestión Global"</strong> en el inicio · un toque y queda como app. Si no aparece, tocá el menú <strong>⋮</strong> arriba a la derecha → <strong>Instalar app</strong> o <strong>Agregar a la pantalla de inicio</strong>.
          </span>
        );
      }
      if (ctx.isAndroidFirefox) {
        return (
          <span>
            En Firefox Android, tocá el menú <strong>⋮</strong> arriba a la derecha → <strong>Instalar</strong>. Queda como app nativa con notificaciones push.
          </span>
        );
      }
      // Otros mobile
      if (ctx.isMobile) {
        return (
          <span>
            En la barra del navegador vas a ver una opción para <strong>"Instalar app"</strong> o <strong>"Agregar a inicio"</strong>. Confirmá y queda como app nativa.
          </span>
        );
      }
      // Desktop
      return (
        <span>
          Este portal funciona como <strong>app instalable</strong>. Tocá el ícono <Download size={11} className="inline mb-0.5" /> en la barra de URL de Chrome/Edge para instalarla en escritorio. Y abrí esta misma URL desde tu celular para tenerla como app del teléfono con notificaciones push.
        </span>
      );
    },
  },
];

export function PortalOnboardingTour({ open, onClose }: Props) {
  const [idx, setIdx] = useState(0);
  const ctx = useMemo(detectDevice, []);
  const totalSteps = STEPS.length;

  useEffect(() => {
    if (!open) return;
    setIdx(0);
  }, [open]);

  // Bloquear scroll del body cuando está abierto
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  if (!open) return null;

  const step = STEPS[idx]!;
  const Icon = step.icon;
  const isLast = idx === totalSteps - 1;
  const descripcion = typeof step.descripcion === 'function' ? step.descripcion(ctx) : step.descripcion;

  function complete() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ completed_at: new Date().toISOString() })); } catch {}
    onClose();
  }

  function skip() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ skipped_at: new Date().toISOString() })); } catch {}
    onClose();
  }

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto px-3 sm:px-4 pt-8 sm:pt-12 pb-6 backdrop-blur">
      {/* overlay */}
      <div
        className="fixed inset-0 bg-brand-ink/60"
        onClick={skip}
        aria-hidden
      />

      {/* card · alineada arriba (items-start del flex parent) */}
      <div
        className="relative w-full max-w-md overflow-hidden rounded-3xl bg-white shadow-2xl motion-safe:animate-fade-up"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
      >
        <TrianglesAccent position="top-right" size={170} tone="cyan" density="soft" className="opacity-30" />

        {/* close button */}
        <button
          type="button"
          onClick={skip}
          className="absolute right-3 top-3 z-10 grid h-8 w-8 place-items-center rounded-full bg-white/80 text-brand-muted backdrop-blur transition hover:bg-white hover:text-brand-ink"
          aria-label="Cerrar tour"
        >
          <X size={14} />
        </button>

        <div className="relative px-6 pt-8 pb-4 sm:px-8 sm:pt-10">
          {/* Step progress */}
          <div className="mb-5 flex items-center gap-1.5">
            {STEPS.map((_, i) => (
              <div
                key={i}
                className={`h-1 flex-1 rounded-full transition ${
                  i <= idx ? 'bg-brand-cyan' : 'bg-slate-200'
                }`}
              />
            ))}
          </div>

          {/* Icon */}
          <div className="mb-4 inline-grid h-14 w-14 place-items-center rounded-2xl bg-brand-cyan-pale text-brand-cyan">
            <Icon size={26} />
          </div>

          {/* Content */}
          <p className="kicker text-brand-cyan">{step.kicker}</p>
          <h2 id="tour-title" className="mt-1 font-display text-2xl font-bold text-brand-ink">
            {step.titulo}
          </h2>
          <div className="mt-3 text-sm leading-relaxed text-brand-muted">
            {descripcion}
          </div>
        </div>

        {/* Footer */}
        <div className="relative flex items-center justify-between gap-2 border-t border-slate-100 bg-slate-50/60 px-6 py-3 sm:px-8 sm:py-4">
          <button
            type="button"
            onClick={() => setIdx((i) => Math.max(0, i - 1))}
            disabled={idx === 0}
            className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-brand-muted transition hover:text-brand-ink disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ChevronLeft size={13} /> Atrás
          </button>

          <span className="text-[11px] font-medium text-brand-muted tabular">
            {idx + 1} / {totalSteps}
          </span>

          {isLast ? (
            <button
              type="button"
              onClick={complete}
              className="inline-flex items-center gap-1 rounded-lg bg-brand-cyan px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-cyan/90"
            >
              ¡Listo! <Sparkles size={13} />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setIdx((i) => Math.min(totalSteps - 1, i + 1))}
              className="inline-flex items-center gap-1 rounded-lg bg-brand-cyan px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-cyan/90"
            >
              Siguiente <ChevronRight size={13} />
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

// Helpers de estado del tour
export function tourCompletado(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return !!raw;
  } catch {
    return false;
  }
}

export function resetTour(): void {
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
}
