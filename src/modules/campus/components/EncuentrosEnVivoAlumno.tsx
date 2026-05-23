import { useEffect, useMemo, useState } from 'react';
import {
  CalendarClock,
  Radio,
  Video,
  X,
  ExternalLink,
  PlayCircle,
  Smartphone,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { fmtFechaHora, type CursoEncuentroRow } from '@/services/api/campus';
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

// Componente full-width que se renderea cuando el alumno está en una clase.
// Lo usa el padre (CursoDetalleAlumnoPage) en lugar de la grilla normal.
export function ClaseEnVivoFullLayout({
  encuentro,
  userName,
  onSalir,
}: {
  encuentro: CursoEncuentroRow;
  userName: string;
  onSalir: () => void;
}) {
  return (
    <section className="card-premium p-4 sm:p-6">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="kicker text-red-600">● Clase en vivo</p>
          <h2 className="font-display text-lg font-semibold text-brand-ink sm:text-xl">
            {encuentro.titulo}
          </h2>
          <p className="text-xs text-brand-muted">
            Tu asistencia se registra automáticamente. Cuando termines de cursar,
            tocá "Volver al curso" para regresar al contenido.
          </p>
        </div>
        <button
          onClick={onSalir}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-brand-ink shadow-sm transition hover:bg-slate-50"
          title="Salir de la clase y volver al curso"
        >
          <X size={13} /> Volver al curso
        </button>
      </header>
      <div className="rounded-xl bg-slate-50 p-3">
        <ZoomLiveEmbed
          encuentroId={encuentro.id}
          userName={userName}
          password={(encuentro as any).zoom_password ?? null}
          onLeft={onSalir}
        />
      </div>
    </section>
  );
}
