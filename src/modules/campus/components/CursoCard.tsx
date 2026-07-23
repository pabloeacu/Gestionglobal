import { Link } from 'react-router-dom';
import { Clock, Copy, GraduationCap, Loader2, Users } from 'lucide-react';
import { cn } from '@/lib/cn';
import {
  MODALIDAD_LABEL,
  estadoPublicacion,
  fmtMoneda,
  type CursoListItem,
} from '@/services/api/campus';

// DGG-115: tonos del chip de estado de publicación (Borrador / Programado /
// Publicado / Finalizado) sobre el banner, sólo en vista gerencia.
const ESTADO_CHIP: Record<'emerald' | 'slate' | 'amber' | 'rose', string> = {
  emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  slate: 'bg-slate-100 text-slate-600 ring-slate-200',
  amber: 'bg-amber-50 text-amber-700 ring-amber-200',
  rose: 'bg-rose-50 text-rose-700 ring-rose-200',
};

interface CursoCardProps {
  curso: CursoListItem;
  to: string;
  className?: string;
  /** Si se provee (vista gerencia), muestra el botón "Duplicar" sobre el banner. */
  onDuplicate?: () => void;
  /** Spinner + disabled mientras se está clonando este curso. */
  duplicating?: boolean;
}

// Tarjeta de curso para el catálogo (staff y alumno).
export function CursoCard({
  curso,
  to,
  className,
  onDuplicate,
  duplicating,
}: CursoCardProps) {
  return (
    <Link
      to={to}
      className={cn(
        'group relative flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:border-brand-cyan hover:shadow-lg motion-safe:animate-fade-up',
        className,
      )}
    >
      {/* Banner / fallback decorativo */}
      <div className="relative h-32 w-full overflow-hidden bg-gradient-to-br from-brand-cyan-pale via-white to-brand-cyan/10">
        {curso.banner_url ? (
          <img
            src={curso.banner_url}
            alt=""
            className="h-full w-full object-cover transition group-hover:scale-105"
          />
        ) : (
          <div className="grid h-full w-full place-items-center">
            <GraduationCap
              size={48}
              className="text-brand-cyan/40 transition group-hover:text-brand-cyan/60"
            />
          </div>
        )}
        {onDuplicate && (
          <button
            type="button"
            disabled={duplicating}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (!duplicating) onDuplicate();
            }}
            title="Duplicar curso (copia borrador, sin alumnos)"
            aria-label="Duplicar curso"
            className="absolute left-3 top-3 z-10 inline-flex items-center gap-1 rounded-full bg-white/90 px-2.5 py-1 text-[11px] font-semibold text-brand-ink shadow-sm ring-1 ring-slate-200 backdrop-blur transition hover:bg-white hover:text-brand-cyan disabled:cursor-not-allowed disabled:opacity-70"
          >
            {duplicating ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <Copy size={12} />
            )}
            {duplicating ? 'Duplicando…' : 'Duplicar'}
          </button>
        )}
        <div className="absolute right-3 top-3 flex flex-col items-end gap-1">
          <span
            className={cn(
              'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider',
              curso.modalidad === 'asincronica'
                ? 'bg-emerald-50 text-emerald-700'
                : curso.modalidad === 'sincronica'
                ? 'bg-amber-50 text-amber-700'
                : 'bg-brand-cyan/10 text-brand-cyan',
            )}
          >
            {MODALIDAD_LABEL[curso.modalidad as keyof typeof MODALIDAD_LABEL]}
          </span>
          {onDuplicate &&
            (() => {
              const estado = estadoPublicacion(
                {
                  publicado: curso.activo,
                  publicar_at: curso.publicar_at,
                  despublicar_at: curso.despublicar_at,
                },
                'curso',
              );
              return (
                <span
                  className={cn(
                    'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ring-1',
                    ESTADO_CHIP[estado.tone],
                  )}
                >
                  {estado.label}
                </span>
              );
            })()}
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-3 p-4">
        {curso.categoria && (
          <p className="kicker text-brand-cyan">{curso.categoria}</p>
        )}
        <h3 className="font-display text-lg font-semibold text-brand-ink">
          {curso.titulo}
        </h3>
        {curso.descripcion && (
          <p className="line-clamp-2 text-sm text-brand-muted">
            {curso.descripcion}
          </p>
        )}

        <dl className="mt-auto grid grid-cols-3 gap-2 border-t border-slate-100 pt-3 text-xs">
          <Stat
            icon={<Clock size={13} />}
            label="Duración"
            value={curso.duracion_horas ? `${curso.duracion_horas} h` : '—'}
          />
          <Stat
            icon={<Users size={13} />}
            label="Matriculados"
            value={String(curso.matriculados_activos)}
          />
          <Stat
            icon={<GraduationCap size={13} />}
            label="Precio"
            value={fmtMoneda(curso.precio_lista)}
          />
        </dl>
      </div>
    </Link>
  );
}

function Stat({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-brand-muted">
        <span className="text-brand-cyan">{icon}</span>
        {label}
      </dt>
      <dd className="mt-0.5 truncate text-sm font-semibold text-brand-ink">
        {value}
      </dd>
    </div>
  );
}
