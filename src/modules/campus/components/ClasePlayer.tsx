import { useState } from 'react';
import {
  BookOpen,
  Check,
  CheckCircle2,
  Download,
  ExternalLink,
  PlayCircle,
  Video,
} from 'lucide-react';
import { Button } from '@/components/common';
import { cn } from '@/lib/cn';
import {
  CLASE_TIPO_LABEL,
  fmtFechaHora,
  marcarCompletada,
  youtubeIdFromUrl,
  type ClaseTipo,
  type CursoClaseRow,
} from '@/services/api/campus';
import { toast } from '@/lib/toast';

interface ClasePlayerProps {
  matriculaId: string;
  clase: CursoClaseRow;
  completada: boolean;
  onCompletada: () => void;
}

// Reproductor + acciones de una clase para el alumno.
export function ClasePlayer({
  matriculaId,
  clase,
  completada,
  onCompletada,
}: ClasePlayerProps) {
  const [saving, setSaving] = useState(false);

  const ytId = youtubeIdFromUrl(clase.youtube_url);

  async function marcar() {
    setSaving(true);
    const res = await marcarCompletada(matriculaId, clase.id);
    setSaving(false);
    if (!res.ok) {
      toast.error(res.error.message);
      return;
    }
    toast.success('¡Clase completada!');
    onCompletada();
  }

  return (
    <article className="space-y-4 motion-safe:animate-fade-up">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          {clase.instructor_foto_url && (
            <img
              src={clase.instructor_foto_url}
              alt=""
              className="h-14 w-14 shrink-0 rounded-full border border-slate-200 object-cover shadow-sm"
            />
          )}
          <div>
            <p className="kicker text-brand-cyan">
              {CLASE_TIPO_LABEL[clase.tipo as ClaseTipo]}
            </p>
            <h2 className="mt-1 font-display text-2xl font-bold text-brand-ink">
              {clase.titulo}
            </h2>
            {clase.descripcion && (
              <p className="mt-2 max-w-2xl text-sm text-brand-muted">
                {clase.descripcion}
              </p>
            )}
          </div>
        </div>
        {completada ? (
          <span className="inline-flex items-center gap-1 self-start rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
            <CheckCircle2 size={14} /> Completada
          </span>
        ) : (
          <Button onClick={marcar} loading={saving} variant="secondary">
            <Check size={14} /> Marcar completada
          </Button>
        )}
      </header>

      {/* Contenido por tipo */}
      {clase.tipo === 'asincronica_video' && ytId && (
        <div className="aspect-video w-full overflow-hidden rounded-2xl border border-slate-200 bg-black shadow-sm">
          <iframe
            className="h-full w-full"
            src={`https://www.youtube.com/embed/${ytId}?rel=0`}
            title={clase.titulo}
            allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        </div>
      )}
      {clase.tipo === 'asincronica_video' && !ytId && (
        <FallbackBox
          icon={<PlayCircle size={28} />}
          title="Video no disponible"
          message="Pedile al instructor que cargue una URL de YouTube válida."
        />
      )}

      {clase.tipo === 'sincronica_zoom' && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-5">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-amber-100 text-amber-700">
              <Video size={18} />
            </span>
            <div className="flex-1">
              <p className="font-display text-base font-semibold text-amber-900">
                Encuentro en vivo
              </p>
              <p className="mt-1 text-sm text-amber-800">
                {clase.zoom_fecha_hora
                  ? `Programado para ${fmtFechaHora(clase.zoom_fecha_hora)}`
                  : 'Fecha y hora a confirmar.'}
                {clase.duracion_min ? ` · ${clase.duracion_min} min.` : ''}
              </p>
              {clase.zoom_url && (
                <a
                  href={clase.zoom_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-3 inline-flex items-center gap-1 rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700"
                >
                  <ExternalLink size={13} /> Abrir Zoom
                </a>
              )}
            </div>
          </div>
        </div>
      )}

      {clase.tipo === 'lectura_pdf' && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-cyan/10 text-brand-cyan">
              <BookOpen size={18} />
            </span>
            <div className="flex-1">
              <p className="font-display text-base font-semibold text-brand-ink">
                Material de lectura
              </p>
              {clase.duracion_min && (
                <p className="text-sm text-brand-muted">
                  Tiempo estimado: {clase.duracion_min} min.
                </p>
              )}
              {clase.material_url && (
                <a
                  href={clase.material_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-3 inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-brand-ink hover:bg-slate-50"
                >
                  <Download size={13} /> Abrir material
                </a>
              )}
            </div>
          </div>
        </div>
      )}

      {clase.tipo === 'examen' && (
        <FallbackBox
          icon={<BookOpen size={28} />}
          title="Examen vinculado"
          message="Buscá esta evaluación en la sección 'Exámenes' del curso."
        />
      )}
    </article>
  );
}

function FallbackBox({
  icon,
  title,
  message,
}: {
  icon: React.ReactNode;
  title: string;
  message: string;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
      <span className={cn('mx-auto grid h-12 w-12 place-items-center rounded-xl bg-brand-cyan/10 text-brand-cyan')}>
        {icon}
      </span>
      <p className="mt-3 font-display text-base font-semibold text-brand-ink">
        {title}
      </p>
      <p className="mt-1 text-sm text-brand-muted">{message}</p>
    </div>
  );
}
