import { useMemo, useState } from 'react';
import { CalendarClock, Radio, Video, X, ExternalLink, PlayCircle } from 'lucide-react';
import { cn } from '@/lib/cn';
import { fmtFechaHora, type CursoEncuentroRow } from '@/services/api/campus';
import { ZoomLiveEmbed } from './ZoomLiveEmbed';

// DGG-14: panel del alumno con los encuentros sincrónicos del curso.
// - "Entrar al vivo" abre el embed inline (Meeting SDK Component View).
// - Si ya hay grabación publicada, muestra el botón "Ver grabación".
// - Pinta badge "● En vivo" cuando el webhook recibió meeting.started.

interface Props {
  encuentros: CursoEncuentroRow[];
  userName: string;
}

export function EncuentrosEnVivoAlumno({ encuentros, userName }: Props) {
  const [activoId, setActivoId] = useState<string | null>(null);

  const visibles = useMemo(
    () => encuentros.filter((e: any) => !!e.zoom_meeting_id),
    [encuentros],
  );

  if (visibles.length === 0) return null;

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
                  <div className="flex items-center gap-2">
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
                  {!finalizado && (
                    <button
                      onClick={() => setActivoId(enc.id)}
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition',
                        isLive
                          ? 'bg-red-600 hover:bg-red-700'
                          : 'bg-brand-cyan hover:bg-brand-cyan/90',
                      )}
                    >
                      <Radio size={13} /> {isLive ? 'Entrar al vivo' : 'Conectar a la sala'}
                    </button>
                  )}
                  {enc.zoom_join_url && !finalizado && (
                    <a
                      href={enc.zoom_join_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-brand-muted hover:bg-slate-50"
                      title="Abrir en la app/web nativa de Zoom"
                    >
                      <ExternalLink size={13} /> Abrir en Zoom
                    </a>
                  )}
                </div>
              </div>

              {/* Embed inline (Meeting SDK) — solo cuando el alumno clickea */}
              {activoId === enc.id && (
                <div className="mt-4">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-xs text-brand-muted">
                      Tu asistencia se registra automáticamente cuando entrás a la sala.
                    </p>
                    <button
                      onClick={() => setActivoId(null)}
                      className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-brand-muted hover:bg-slate-50"
                    >
                      <X size={12} /> Cerrar
                    </button>
                  </div>
                  <ZoomLiveEmbed
                    encuentroId={enc.id}
                    userName={userName}
                    password={enc.zoom_password ?? null}
                  />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
