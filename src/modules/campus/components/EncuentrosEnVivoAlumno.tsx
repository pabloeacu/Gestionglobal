import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  CalendarClock,
  Radio,
  Video,
  X,
  ExternalLink,
  PlayCircle,
  Smartphone,
  CheckCircle2,
  Mic,
  VideoIcon,
  MessageSquare,
  LogOut,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { fmtFechaHora, type CursoEncuentroRow } from '@/services/api/campus';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import { ZoomLiveEmbed } from './ZoomLiveEmbed';

// DGG-14: panel del alumno con encuentros sincrónicos.
//
// Desktop: botón "Entrar a la clase en vivo" → callback al padre que cambia
// el layout del curso al "modo clase en vivo" (embed full-width, sidebar
// colapsado). El embed muestra el SDK nativo de Zoom con todos sus
// controles (audio, cámara, chat, participantes, compartir, levantar mano,
// salir).
//
// Mobile (< 768px): el SDK Web no rinde bien en pantallas chicas. Usamos
// deep link a la app Zoom nativa (zoomus://) con fallback a la web. El
// usuario sale de la app y vuelve cuando la clase termina.

interface Props {
  encuentros: CursoEncuentroRow[];
  /** Recibido sólo para mantener API estable; el ClaseEnVivoFullLayout lo usa. */
  userName: string;
  /** Cuando el alumno entra a la clase activa, el padre re-acomoda layout. */
  activoEncuentroId: string | null;
  onEntrar: (encuentroId: string) => void;
  onSalir: () => void;
}

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth < 768 : false,
  );
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return isMobile;
}

// Tamaño natural del SDK Component View con width 720 (configurable). El
// SDK respeta esto, y el resultado es ~720×874 con buttons readables.
const SDK_NATIVE_W = 720;
const SDK_NATIVE_H = 874;
// Espacio reservado para header overlay + paddings + safety.
const OVERLAY_CHROME_H = 80;

/**
 * Wrapper visual ancho (matchea el mockup del usuario): un contenedor con
 * fondo oscuro + borde brand que ocupa el espacio izquierdo, con el SDK
 * Paper centrado adentro. El SDK rinde a tamaño nativo legible (720×874
 * escalado al alto disponible), pero el "marco visual" hace que el embed
 * se vea ancho como el mockup. La toolbar SDK queda visible al fondo del
 * Paper centrado.
 */
function ZoomEmbedScaled({
  encuentroId,
  userName,
  password,
  onSalir,
}: {
  encuentroId: string;
  userName: string;
  password: string | null;
  onSalir: () => void;
}) {
  const [scale, setScale] = useState(() => {
    if (typeof window === 'undefined') return 0.85;
    const availH = window.innerHeight - OVERLAY_CHROME_H;
    return Math.min(1.0, Math.max(0.65, availH / SDK_NATIVE_H));
  });
  useEffect(() => {
    const onResize = () => {
      const availH = window.innerHeight - OVERLAY_CHROME_H;
      setScale(Math.min(1.0, Math.max(0.65, availH / SDK_NATIVE_H)));
    };
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const sdkVisualH = SDK_NATIVE_H * scale;
  const sdkVisualW = SDK_NATIVE_W * scale;

  return (
    // Container exterior: ocupa todo el espacio disponible del grid column.
    // Fondo oscuro + borde brand para que se vea como un "marco premium"
    // alrededor del SDK (matching mockup wide).
    <div
      className="relative flex h-full w-full items-center justify-center overflow-hidden rounded-2xl border border-slate-200/70 bg-slate-950 shadow-xl ring-1 ring-brand-cyan/20"
      style={{ minHeight: sdkVisualH + 20 }}
    >
      {/* Wrapper del SDK centrado dentro del marco wide */}
      <div
        className="relative shrink-0"
        style={{ width: sdkVisualW, height: sdkVisualH }}
      >
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
            width: SDK_NATIVE_W,
            height: SDK_NATIVE_H,
          }}
        >
          <ZoomLiveEmbed
            encuentroId={encuentroId}
            userName={userName}
            password={password}
            onLeft={onSalir}
          />
        </div>
      </div>
    </div>
  );
}

export function EncuentrosEnVivoAlumno({
  encuentros,
  activoEncuentroId,
  onEntrar,
}: Props) {
  const isMobile = useIsMobile();

  const visibles = useMemo(
    () => encuentros.filter((e: any) => !!e.zoom_meeting_id),
    [encuentros],
  );

  if (visibles.length === 0) return null;

  // Si hay un encuentro activo Y es desktop, el padre tiene el modo "clase
  // en vivo" rendereando el embed full-width — aquí NO renderizamos el
  // listado para no duplicar.
  if (activoEncuentroId && !isMobile) return null;

  return (
    <section className="card-premium p-5">
      <header className="mb-3 flex items-center gap-2">
        <Video size={16} className="text-amber-600" />
        <h2 className="font-display text-lg font-semibold text-brand-ink">
          Encuentros en vivo
        </h2>
      </header>
      <ul className="space-y-3">
        {visibles.map((enc: any) => {
          const status = (enc.zoom_status as string | undefined) ?? 'programado';
          const isLive = status === 'en_curso';
          const finalizado = status === 'finalizado';
          const tieneGrabacion = !!enc.grabacion_play_url;
          return (
            <li
              key={enc.id}
              className={cn(
                'rounded-xl border bg-white p-4 transition',
                isLive
                  ? 'border-red-300 bg-red-50/40 ring-1 ring-red-200'
                  : 'border-slate-200',
              )}
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="truncate font-semibold text-brand-ink">{enc.titulo}</h3>
                    {isLive && (
                      <span className="rounded-full border border-red-200 bg-red-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-red-700">
                        ● En vivo
                      </span>
                    )}
                    {finalizado && (
                      <span className="rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-700">
                        Finalizado
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 flex items-center gap-1.5 text-xs text-brand-muted">
                    <CalendarClock size={12} />
                    {enc.fecha_hora ? fmtFechaHora(enc.fecha_hora) : 'Sin fecha'}
                    {enc.duracion_min ? ` · ${enc.duracion_min} min` : ''}
                  </p>
                  {enc.descripcion && (
                    <p className="mt-1 text-sm text-brand-muted">{enc.descripcion}</p>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {tieneGrabacion && (
                    <a
                      href={enc.grabacion_play_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100"
                    >
                      <PlayCircle size={14} /> Ver grabación
                    </a>
                  )}
                  {!finalizado && !isMobile && (
                    <button
                      onClick={() => onEntrar(enc.id)}
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition',
                        isLive
                          ? 'bg-red-600 hover:bg-red-700'
                          : 'bg-brand-cyan hover:bg-brand-cyan/90',
                      )}
                    >
                      <Radio size={13} />{' '}
                      {isLive ? 'Entrar a la clase en vivo' : 'Conectarme a la sala'}
                    </button>
                  )}
                  {!finalizado && isMobile && (
                    <a
                      href={`zoomus://zoom.us/join?confno=${enc.zoom_meeting_id}${enc.zoom_password ? `&pwd=${enc.zoom_password}` : ''}`}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-brand-cyan px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-brand-cyan/90"
                    >
                      <Smartphone size={13} /> Abrir en Zoom
                    </a>
                  )}
                  {enc.zoom_join_url && !finalizado && !isMobile && (
                    <a
                      href={enc.zoom_join_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-brand-muted hover:bg-slate-50"
                      title="Abrir en la app/web nativa de Zoom"
                    >
                      <ExternalLink size={13} /> Abrir Zoom nativo
                    </a>
                  )}
                </div>
              </div>

              {/* Nota mobile */}
              {!finalizado && isMobile && (
                <p className="mt-3 text-xs text-brand-muted">
                  Desde el celular usamos la app Zoom (mejor experiencia). Si no
                  la tenés instalada, tocá "Abrir Zoom nativo" arriba —
                  se abre en tu navegador.
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// Componente fullscreen REAL — renderea en document.body via React Portal
// para evitar contextos de stacking del portal del cliente (transforms
// en parents rompen el position:fixed). Toma 100vw × 100vh sin estorbo.
//
// Layout HORIZONTAL premium con estética del campus:
// ┌──────────────────────────────────────────────────┐
// │ ▲▲   [HEADER compacto: badge En vivo · título]   │
// │                                                  │
// │ ┌───────────┐  ┌──────────┐  ┌──────────────┐    │
// │ │ Panel izq │  │   ZOOM   │  │ Panel der    │    │
// │ │ Curso     │  │  EMBED   │  │ Controles    │    │
// │ │ Estado    │  │  720×600 │  │ Participante │    │
// │ └───────────┘  └──────────┘  └──────────────┘    │
// │                                            ▲▲▲   │
// └──────────────────────────────────────────────────┘
//
// Triángulos cyan en las 4 esquinas → marca Gestión Global.
export function ClaseEnVivoFullLayout({
  encuentro,
  cursoTitulo,
  userName,
  onSalir,
}: {
  encuentro: CursoEncuentroRow;
  cursoTitulo: string;
  userName: string;
  onSalir: () => void;
}) {
  // Body scroll lock — evita que el scroll del documento de abajo afecte.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="relative overflow-hidden"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        width: '100vw',
        height: '100vh',
        zIndex: 9999,
        background:
          'linear-gradient(135deg, #f8fafc 0%, #ecfeff 35%, #fef9e8 70%, #f8fafc 100%)',
      }}
    >
      {/* Triángulos de marca campus en las 4 esquinas */}
      <TrianglesAccent position="top-left" tone="cyan" size={260} density="rich" />
      <TrianglesAccent position="top-right" tone="cyan" size={180} density="soft" />
      <TrianglesAccent position="bottom-left" tone="cyan" size={180} density="soft" />
      <TrianglesAccent position="bottom-right" tone="cyan" size={260} density="rich" />

      <div className="relative z-10 flex h-full flex-col">
        {/* Header súper compacto */}
        <header className="flex items-center justify-between border-b border-slate-200/60 bg-white/70 px-4 py-1.5 shadow-sm backdrop-blur-sm">
          <div className="flex min-w-0 items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-red-700">
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-red-600" />
              Clase en vivo
            </span>
            <h1 className="truncate font-display text-sm font-semibold text-brand-ink sm:text-base">
              {encuentro.titulo}
            </h1>
            <span className="hidden text-xs text-brand-muted sm:inline">
              · {cursoTitulo}
            </span>
          </div>
          <button
            onClick={onSalir}
            className="ml-3 inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-brand-ink shadow-sm transition hover:bg-slate-50"
            title="Salir de la clase y volver al curso"
          >
            <X size={13} /> Volver al curso
          </button>
        </header>

        {/* Cuerpo: grid 2-columnas. Izquierda: embed centrado en espacio
            disponible. Derecha: cards apilados, alineados verticalmente al
            centro. Padding genera respiro visual respecto a triángulos. */}
        <main className="relative grid flex-1 grid-cols-1 items-center gap-6 overflow-hidden px-8 py-3 lg:grid-cols-[1fr_280px] lg:px-12">
          {/* Embed Zoom — ocupa la columna izquierda, centrado. */}
          <div className="flex items-center justify-center">
            <ZoomEmbedScaled
              encuentroId={encuentro.id}
              userName={userName}
              password={(encuentro as any).zoom_password ?? null}
              onSalir={onSalir}
            />
          </div>

          {/* Aside derecho — dos cards apilados verticalmente */}
          <aside className="hidden h-full flex-col justify-center gap-3 lg:flex">
            {/* Card 1 — curso + encuentro + asistencia activa */}
            <div className="space-y-3 rounded-2xl border border-slate-200/60 bg-white/80 p-4 shadow-sm backdrop-blur-sm">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-brand-cyan">
                  Curso
                </p>
                <p className="mt-1 font-display text-sm font-bold leading-tight text-brand-ink">
                  {cursoTitulo}
                </p>
              </div>
              <hr className="border-slate-200/60" />
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-brand-cyan">
                  Encuentro
                </p>
                <p className="mt-1 text-xs font-semibold text-brand-ink">
                  {encuentro.titulo}
                </p>
                {encuentro.fecha_hora && (
                  <p className="mt-1 flex items-center gap-1 text-[11px] text-brand-muted">
                    <CalendarClock size={11} />
                    {fmtFechaHora(encuentro.fecha_hora)}
                  </p>
                )}
              </div>
              <div className="flex items-start gap-2 rounded-lg bg-emerald-50 p-2.5">
                <CheckCircle2
                  size={14}
                  className="mt-0.5 shrink-0 text-emerald-600"
                />
                <p className="text-[11px] leading-tight text-emerald-800">
                  <span className="font-semibold">Asistencia activa.</span>{' '}
                  Se registra automáticamente.
                </p>
              </div>
            </div>

            {/* Card 2 — participante + guía de controles */}
            <div className="space-y-3 rounded-2xl border border-slate-200/60 bg-white/80 p-4 shadow-sm backdrop-blur-sm">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-brand-cyan">
                  Conectado como
                </p>
                <p className="mt-1 truncate font-display text-sm font-bold text-brand-ink">
                  {userName}
                </p>
              </div>
              <hr className="border-slate-200/60" />
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-brand-cyan">
                  Tus controles
                </p>
                <ul className="mt-2 space-y-1.5 text-[11px] text-brand-ink">
                  <li className="flex items-center gap-2">
                    <Mic size={12} className="text-brand-cyan" />
                    <span>Activá tu micrófono para hablar</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <VideoIcon size={12} className="text-brand-cyan" />
                    <span>Encendé la cámara cuando quieras</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <MessageSquare size={12} className="text-brand-cyan" />
                    <span>Abrí el chat para preguntar</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <LogOut size={12} className="text-brand-cyan" />
                    <span>Salí desde la barra inferior</span>
                  </li>
                </ul>
              </div>
            </div>
          </aside>
        </main>
      </div>
    </div>,
    document.body,
  );
}
