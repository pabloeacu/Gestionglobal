import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  CalendarClock,
  Clock,
  Radio,
  Video,
  X,
  ExternalLink,
  PlayCircle,
  Smartphone,
  CheckCircle2,
  Mic,
  Video as VideoIcon,
  MessageSquare,
  LogOut,
  GraduationCap,
  FileText,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import {
  fmtFechaHora,
  type CursoEncuentroRow,
  type ModalidadSincronica,
  type ModuloSincronicoRow,
} from '@/services/api/campus';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import { ZoomLiveEmbed } from './ZoomLiveEmbed';
import { WebexLiveEmbed } from './WebexLiveEmbed';

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
  /** F10: módulos sincrónicos del curso (para agrupar + docente + requisito). */
  modulos: ModuloSincronicoRow[];
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

// "Ahora" reactivo: re-renderiza cada 30s para que el botón de unirse se
// habilite/cierre solo al entrar/salir de la ventana temporal sin que el
// alumno tenga que refrescar (F9-ter · Lista JL).
function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

const GATE_PREV_MS = 10 * 60_000; // habilita 10 min antes del horario

// SDK Component View natural 720×874 (aspect ~0.82 vertical).
//
// Estrategia A+B (DGG-18): renderizamos el SDK a su aspect NATURAL sin
// cropping. La toolbar nativa de Zoom + todo el chrome del SDK (header,
// view toggle, gallery, share screen, polls, breakout rooms, chat,
// todos los popups) quedan funcionales al 100%. Marco "phone-like"
// vertical en el column izquierdo, cards a la derecha con botón
// "Abrir Zoom oficial" para los que prefieren la experiencia nativa.
const SDK_NATIVE_W = 720;
const SDK_NATIVE_H = 874;

/**
 * Marco 16:9 HORIZONTAL con el SDK Component View escalado y ANCLADO al
 * fondo del marco. Solo se ve la mitad inferior del SDK (donde está el
 * speaker en gallery + la toolbar). La mitad superior del SDK (header +
 * área vacía del speaker spotlight) queda CROPEADA por overflow:hidden.
 *
 * Resultado visual: el host se ve grande llenando el marco horizontal,
 * con la toolbar Zoom (mic/cam/chat/salir) visible al fondo. Aspect
 * natural del speaker preservado (uniform scale, no distortion).
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
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(0.8);

  useEffect(() => {
    const el = containerRef.current;
    if (!el?.parentElement) return;
    const compute = () => {
      const parent = el.parentElement;
      if (!parent) return;
      // Scale para que el SDK ocupe toda la altura disponible. Width
      // se ajusta proporcionalmente (aspect 0.82 vertical phone-like).
      const ph = Math.min(parent.clientHeight, window.innerHeight - 100);
      const s = Math.min(1.0, Math.max(0.55, ph / SDK_NATIVE_H));
      setScale(s);
    };
    compute();
    const observer = new ResizeObserver(compute);
    observer.observe(el.parentElement);
    window.addEventListener('resize', compute);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', compute);
    };
  }, []);

  const w = SDK_NATIVE_W * scale;
  const h = SDK_NATIVE_H * scale;

  return (
    <div
      ref={containerRef}
      className="relative shrink-0 overflow-hidden rounded-3xl border border-slate-200/70 bg-slate-950 shadow-2xl ring-1 ring-brand-cyan/20"
      style={{ width: w, height: h }}
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
  );
}

// CustomToolbar y ToolbarIcon eliminados (DGG-18): el SDK Component View
// rinde su toolbar nativa al fondo del marco vertical, con todos los
// controles nativos funcionales (mic/cam/chat/share/polls/breakout/etc).

export function EncuentrosEnVivoAlumno({
  encuentros,
  modulos,
  activoEncuentroId,
  onEntrar,
}: Props) {
  const isMobile = useIsMobile();
  const now = useNow();

  const visibles = useMemo(
    () =>
      encuentros.filter((e) =>
        e.plataforma === 'webex' ? !!e.webex_meeting_id : !!e.zoom_meeting_id,
      ),
    [encuentros],
  );

  // F10: agrupar por módulo sincrónico (en el orden de los módulos); los
  // encuentros sin módulo van en un grupo suelto al final.
  const grupos = useMemo(() => {
    const porId = new Map<string, CursoEncuentroRow[]>();
    for (const e of visibles) {
      const k = e.condicion_id ?? '__none__';
      const arr = porId.get(k);
      if (arr) arr.push(e);
      else porId.set(k, [e]);
    }
    const out: {
      modulo: ModuloSincronicoRow | null;
      encs: CursoEncuentroRow[];
      totalReal: number;
    }[] = [];
    for (const m of modulos) {
      const encs = porId.get(m.id);
      if (encs && encs.length) {
        // R19: el requisito ("asistí a 1 de N" / "a los N") cuenta TODOS los
        // encuentros del módulo, no sólo los visibles con sala — igual que el
        // backend (eval_asistencia_cumplida). Si no, un 'serie' con un encuentro
        // sin sala todavía sub-reportaría el requisito al alumno.
        const totalReal = encuentros.filter((e) => e.condicion_id === m.id).length;
        out.push({ modulo: m, encs, totalReal });
      }
    }
    const sueltos = porId.get('__none__');
    if (sueltos && sueltos.length) out.push({ modulo: null, encs: sueltos, totalReal: sueltos.length });
    return out;
  }, [visibles, modulos, encuentros]);

  if (visibles.length === 0) return null;

  // Si hay un encuentro activo Y es desktop, el padre tiene el modo "clase
  // en vivo" rendereando el embed full-width — aquí NO renderizamos el
  // listado para no duplicar.
  if (activoEncuentroId && !isMobile) return null;

  return (
    <section className="card-premium p-5">
      <header className="mb-4 flex items-center gap-2">
        <Video size={16} className="text-amber-600" />
        <h2 className="font-display text-lg font-semibold text-brand-ink">
          Encuentros en vivo
        </h2>
      </header>
      <div className="space-y-6">
        {grupos.map(({ modulo, encs, totalReal }) => (
          <div key={modulo?.id ?? '__none__'}>
            {modulo && <ModuloHeaderAlumno modulo={modulo} total={totalReal} />}
            <ul className="space-y-3">
              {encs.map((enc) => (
                <EncuentroLi
                  key={enc.id}
                  enc={enc}
                  now={now}
                  isMobile={isMobile}
                  onEntrar={onEntrar}
                />
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

function ModuloHeaderAlumno({ modulo, total }: { modulo: ModuloSincronicoRow; total: number }) {
  const modalidad = (modulo.modalidad as ModalidadSincronica) ?? 'unico';
  const requisito =
    modalidad === 'serie'
      ? `Tenés que asistir a ${total === 1 ? 'el encuentro' : `los ${total} encuentros`}.`
      : modalidad === 'alternativos'
        ? `Te alcanza con asistir a 1 de ${total === 1 ? 'la fecha' : `las ${total} fechas`}.`
        : 'Tenés que asistir al encuentro.';
  return (
    <div className="mb-2 flex flex-wrap items-center gap-3 rounded-xl border border-brand-cyan/20 bg-brand-cyan/5 p-3">
      {modulo.docente_foto_url ? (
        <img
          src={modulo.docente_foto_url}
          alt={modulo.docente_nombre ?? 'Docente'}
          className="h-10 w-10 shrink-0 rounded-full object-cover ring-2 ring-white"
        />
      ) : (
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand-cyan/15 text-brand-cyan">
          <GraduationCap size={18} />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="font-display text-sm font-semibold text-brand-ink">{modulo.etiqueta}</p>
        {modulo.docente_nombre && (
          <p className="text-xs text-brand-muted">Con {modulo.docente_nombre}</p>
        )}
        <p className="mt-0.5 text-[11px] font-medium text-brand-cyan">{requisito}</p>
      </div>
      {modulo.docente_cv_url && (
        <a
          href={modulo.docente_cv_url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-brand-ink hover:bg-slate-50"
        >
          <FileText size={13} /> CV
        </a>
      )}
    </div>
  );
}

function EncuentroLi({
  enc,
  now,
  isMobile,
  onEntrar,
}: {
  enc: CursoEncuentroRow;
  now: number;
  isMobile: boolean;
  onEntrar: (encuentroId: string) => void;
}) {
  const plataforma = (enc.plataforma as string | undefined) ?? 'zoom';
          const isZoom = plataforma === 'zoom';
          const isWebex = plataforma === 'webex';
          const statusField = isWebex ? enc.webex_status : enc.zoom_status;
          const status = (statusField as string | undefined) ?? 'programado';
          const isLive = status === 'en_curso';
          const finalizado = status === 'finalizado';
          const tieneGrabacion = !!enc.grabacion_play_url;

          // Gating temporal del acceso del alumno (F9-ter · Lista JL):
          // habilitado SÓLO en [fecha_hora − 10min, fecha_hora + duración], o
          // si el host ya inició (isLive). Antes / después / sin-fecha → bloqueado.
          const fhMs = enc.fecha_hora ? new Date(enc.fecha_hora).getTime() : null;
          const opensAtMs = fhMs != null ? fhMs - GATE_PREV_MS : null;
          const closesAtMs = fhMs != null ? fhMs + (enc.duracion_min ?? 60) * 60_000 : null;
          const dentroVentana =
            fhMs != null && now >= (opensAtMs as number) && now <= (closesAtMs as number);
          const puedeUnirse = dentroVentana || isLive;
          const gateMsg =
            fhMs == null
              ? 'Pendiente de programar la fecha'
              : now < (opensAtMs as number)
                ? `Se habilita ${fmtFechaHora(new Date(opensAtMs as number).toISOString())}`
                : 'El encuentro finalizó';
          const botonBloqueado = (
            <span
              className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs font-semibold text-brand-muted"
              title="El acceso se habilita 10 minutos antes del horario programado del encuentro."
            >
              <Clock size={13} /> {gateMsg}
            </span>
          );
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
                      href={enc.grabacion_play_url ?? undefined}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100"
                    >
                      <PlayCircle size={14} /> Ver grabación
                    </a>
                  )}

                  {/* ZOOM (default) · botón grande external link. Asistencia
                      tracked via webhook meeting.participant_joined/left.
                      Gateado por tiempo (F9-ter): habilitado 10 min antes. */}
                  {!finalizado &&
                    isZoom &&
                    enc.zoom_join_url &&
                    (puedeUnirse ? (
                      <a
                        href={enc.zoom_join_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={cn(
                          'inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-bold text-white shadow-sm transition',
                          isLive
                            ? 'bg-red-600 hover:bg-red-700'
                            : 'bg-brand-cyan hover:bg-brand-cyan/90',
                        )}
                        title="Abrir la reunión en Zoom oficial"
                      >
                        <ExternalLink size={13} />{' '}
                        {isLive ? 'Unirme a la clase Zoom' : 'Unirme al encuentro'}
                      </a>
                    ) : (
                      botonBloqueado
                    ))}

                  {/* WEBEX · embed embebido en el campus (botón abre overlay).
                      Gateado por tiempo (F9-ter): habilitado 10 min antes. */}
                  {!finalizado &&
                    isWebex &&
                    !isMobile &&
                    (puedeUnirse ? (
                      <button
                        onClick={() => onEntrar(enc.id)}
                        className={cn(
                          'inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-bold text-white shadow-sm transition',
                          isLive
                            ? 'bg-red-600 hover:bg-red-700'
                            : 'bg-brand-cyan hover:bg-brand-cyan/90',
                        )}
                      >
                        <Radio size={13} />{' '}
                        {isLive ? 'Entrar a la clase Webex' : 'Conectarme a Webex'}
                      </button>
                    ) : (
                      botonBloqueado
                    ))}

                  {/* Mobile · Webex también via link externo. Gateado (F9-ter). */}
                  {!finalizado &&
                    isWebex &&
                    isMobile &&
                    enc.webex_join_url &&
                    (puedeUnirse ? (
                      <a
                        href={enc.webex_join_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 rounded-lg bg-brand-cyan px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-brand-cyan/90"
                      >
                        <Smartphone size={13} /> Abrir Webex
                      </a>
                    ) : (
                      botonBloqueado
                    ))}
                </div>
              </div>

              {/* Asistencia automática (zoom external link) */}
              {!finalizado && isZoom && (
                <p className="mt-2 flex items-center gap-1.5 text-[11px] text-brand-muted">
                  <CheckCircle2 size={12} className="text-emerald-600" />
                  Tu asistencia se registra automáticamente al unirte a la sala.
                </p>
              )}

              {/* Webex embed limitations note */}
              {!finalizado && isWebex && !isMobile && (
                <p className="mt-2 flex items-center gap-1.5 text-[11px] text-brand-muted">
                  <CheckCircle2 size={12} className="text-emerald-600" />
                  Embebido en el campus. Para funciones avanzadas (polls, salas), abrir en Webex oficial.
                </p>
              )}

              {/* Nota mobile */}
              {!finalizado && isMobile && (
                <p className="mt-3 text-xs text-brand-muted">
                  Desde el celular usamos la app nativa (mejor experiencia). Si no la tenés instalada, se abre en el navegador.
                </p>
              )}
            </li>
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

        {/* Cuerpo: grid 2-columnas con padding GENEROSO en todos los lados
            (sobre todo derecho para que los cards NO se peguen al borde).
            min-h-0 + items-stretch garantizan altura concreta del column. */}
        <main className="relative grid min-h-0 flex-1 grid-cols-1 items-stretch gap-6 overflow-hidden px-6 py-4 lg:grid-cols-[minmax(0,1fr)_260px] lg:gap-10 lg:pl-12 lg:pr-16 xl:pl-16 xl:pr-20">
          {/* Embed según plataforma. Zoom NO debería caer acá normalmente
              (el alumno usa el link externo directo); si llega, fallback al
              Zoom embed. Webex usa el widget oficial @webex/widgets. */}
          <div className="flex h-full items-center justify-center">
            {(encuentro as any).plataforma === 'webex' ? (
              <WebexLiveEmbed
                encuentroId={encuentro.id}
                userName={userName}
                webexJoinUrl={(encuentro as any).webex_join_url ?? null}
                onLeft={onSalir}
              />
            ) : (
              <ZoomEmbedScaled
                encuentroId={encuentro.id}
                userName={userName}
                password={(encuentro as any).zoom_password ?? null}
                onSalir={onSalir}
              />
            )}
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

            {/* Botón link externo Zoom (opción A: app/web nativa) */}
            {(encuentro as any).zoom_join_url && (
              <a
                href={(encuentro as any).zoom_join_url as string}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex items-center gap-2.5 rounded-2xl border border-brand-cyan/40 bg-brand-cyan/5 p-3 transition hover:bg-brand-cyan/10"
                title="Abrir la reunión en la app o web de Zoom para acceder a TODAS las funciones (compartir pantalla, vista cuadrícula, salas pequeñas, etc.)"
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-cyan/15 text-brand-cyan group-hover:bg-brand-cyan/25">
                  <ExternalLink size={14} />
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-brand-cyan">
                    Más funciones
                  </p>
                  <p className="text-[11px] font-semibold text-brand-ink">
                    Abrir Zoom oficial
                  </p>
                  <p className="text-[10px] text-brand-muted">
                    Compartir pantalla, galería, salas
                  </p>
                </div>
              </a>
            )}

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
