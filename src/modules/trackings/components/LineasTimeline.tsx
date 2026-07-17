// ============================================================================
// LineasTimeline · vista timeline de líneas de tracking (DGG-31 / P5-2.A)
//
// Eje vertical con marcadores de fecha agrupados por día. Cada línea cuelga
// del eje con un nodo coloreado por categoría (toma `color` de
// categoria_config) y una mini-card con la nota + adjuntos + autor.
//
// Cita patrón MDC handoff §C1 (timeline con scroll vertical) adaptado a
// estética Gestión Global (acento cyan/teal). Pensado para trackings largos
// (10+ líneas) donde la lista plana se vuelve ilegible.
// ============================================================================

import {
  Award,
  Bell,
  Calendar as CalendarIcon,
  Check,
  Eye,
  FileCheck,
  GraduationCap,
  Mail,
  Send,
  Tag,
  AlertCircle,
  UserCog,
  XCircle,
  Paperclip,
  Clock,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { formatDateTime } from '@/lib/dates';
import { abrirArchivoProtegido, nombreArchivoStorage } from '@/lib/storageUrls';
import type {
  TrackingLineaRow,
  TrackingCategoriaConfigRow,
} from '@/services/api/trackings';

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  'file-check': FileCheck,
  'alert-circle': AlertCircle,
  send: Send,
  'user-clock': UserCog,
  mail: Mail,
  check: Check,
  'x-circle': XCircle,
  bell: Bell,
  calendar: CalendarIcon,
  eye: Eye,
  award: Award,
  'graduation-cap': GraduationCap,
  tag: Tag,
};

// Tinte de fondo + borde para el nodo según color de la categoría.
function nodeTone(color: string | undefined): { ring: string; bg: string; text: string } {
  switch (color) {
    case 'cyan':    return { ring: 'ring-cyan-300',    bg: 'bg-cyan-100',    text: 'text-cyan-700'    };
    case 'emerald':
    case 'green':   return { ring: 'ring-emerald-300', bg: 'bg-emerald-100', text: 'text-emerald-700' };
    case 'amber':
    case 'yellow':  return { ring: 'ring-amber-300',   bg: 'bg-amber-100',   text: 'text-amber-700'   };
    case 'rose':
    case 'red':     return { ring: 'ring-rose-300',    bg: 'bg-rose-100',    text: 'text-rose-700'    };
    case 'violet':
    case 'purple':  return { ring: 'ring-violet-300',  bg: 'bg-violet-100',  text: 'text-violet-700'  };
    case 'sky':
    case 'blue':    return { ring: 'ring-sky-300',     bg: 'bg-sky-100',     text: 'text-sky-700'     };
    default:        return { ring: 'ring-slate-300',   bg: 'bg-slate-100',   text: 'text-slate-700'   };
  }
}

interface LineasTimelineProps {
  lineas: TrackingLineaRow[];
  categoriaConfigMap: Map<string, TrackingCategoriaConfigRow>;
}

// Agrupa líneas por día calendario (yyyy-mm-dd local AR).
function groupByDia(lineas: TrackingLineaRow[]): Array<{
  key: string;
  fecha: Date;
  items: TrackingLineaRow[];
}> {
  const groups = new Map<string, { fecha: Date; items: TrackingLineaRow[] }>();
  for (const l of lineas) {
    const d = new Date(l.created_at);
    const key = d.toLocaleDateString('es-AR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
    if (!groups.has(key)) {
      const startOfDay = new Date(d);
      startOfDay.setHours(0, 0, 0, 0);
      groups.set(key, { fecha: startOfDay, items: [] });
    }
    groups.get(key)!.items.push(l);
  }
  // Orden cronológico DESC (los más nuevos arriba).
  return Array.from(groups.entries())
    .map(([key, v]) => ({ key, fecha: v.fecha, items: v.items }))
    .sort((a, b) => b.fecha.getTime() - a.fecha.getTime());
}

function formatDiaLabel(d: Date): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.round((today.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'Hoy';
  if (diffDays === 1) return 'Ayer';
  if (diffDays > 1 && diffDays < 7) return `Hace ${diffDays} días`;
  return d.toLocaleDateString('es-AR', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
}

export function LineasTimeline({ lineas, categoriaConfigMap }: LineasTimelineProps) {
  if (lineas.length === 0) {
    return null;
  }
  const groups = groupByDia(lineas);

  return (
    <div className="relative">
      {/* Eje vertical · gradient cyan suave */}
      <span
        aria-hidden
        className="absolute left-[19px] top-2 bottom-2 w-px bg-gradient-to-b from-brand-cyan/40 via-slate-200 to-slate-200"
      />

      <div className="space-y-8">
        {groups.map((g) => (
          <div key={g.key} className="relative">
            {/* Etiqueta del día · sticky cuando hay scroll */}
            <div className="relative mb-3 ml-12 flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-brand-cyan/20 bg-brand-cyan-pale/30 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-brand-cyan">
                <CalendarIcon size={10} />
                {formatDiaLabel(g.fecha)}
              </span>
              <span className="text-[11px] text-brand-muted">
                {g.fecha.toLocaleDateString('es-AR', {
                  day: '2-digit',
                  month: '2-digit',
                })}
              </span>
              <span className="text-[10px] text-brand-muted/70">
                · {g.items.length} {g.items.length === 1 ? 'línea' : 'líneas'}
              </span>
            </div>

            <ol className="space-y-3">
              {g.items.map((linea) => {
                const cfg = categoriaConfigMap.get(linea.categoria);
                const tone = nodeTone(cfg?.color);
                const Icon = cfg?.icono ? ICON_MAP[cfg.icono] ?? Tag : Tag;
                const futura =
                  linea.alerta_en !== null &&
                  new Date(linea.alerta_en).getTime() > Date.now();
                const hora = new Date(linea.created_at).toLocaleTimeString('es-AR', {
                  hour: '2-digit',
                  minute: '2-digit',
                });

                return (
                  <li key={linea.id} className="relative pl-12">
                    {/* Nodo en el eje */}
                    <span
                      className={cn(
                        'absolute left-2 top-3 grid h-8 w-8 place-items-center rounded-full ring-2 ring-offset-2 ring-offset-white',
                        tone.bg,
                        tone.text,
                        tone.ring,
                      )}
                    >
                      <Icon className="h-3.5 w-3.5" />
                    </span>

                    <div
                      className={cn(
                        'rounded-xl border border-slate-200 bg-white p-3 shadow-sm transition hover:border-slate-300 hover:shadow',
                        futura && 'border-amber-200 bg-amber-50/40',
                      )}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-brand-muted">
                          <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold', tone.bg, tone.text)}>
                            {cfg?.label ?? linea.categoria}
                          </span>
                          <span className="inline-flex items-center gap-1 text-brand-muted/80">
                            <Clock size={10} /> {hora}
                          </span>
                          {linea.estado_asociado && (
                            <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-700">
                              → {linea.estado_asociado}
                            </span>
                          )}
                          {futura && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700">
                              <Bell size={10} /> programada
                            </span>
                          )}
                        </p>
                        <p className="text-[10px] text-brand-muted">
                          {formatDateTime(linea.created_at)}
                        </p>
                      </div>
                      {linea.descripcion && (
                        <p className="mt-2 whitespace-pre-wrap text-sm text-brand-ink/90">
                          {linea.descripcion}
                        </p>
                      )}
                      {(linea.archivos_urls?.length ?? 0) > 0 && (
                        <ul className="mt-2 flex flex-wrap gap-1.5">
                          {linea.archivos_urls!.map((u, i) => (
                            <li key={i}>
                              <button
                                type="button"
                                onClick={() => void abrirArchivoProtegido(u)}
                                className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] text-slate-700 hover:border-slate-300"
                              >
                                <Paperclip size={10} /> {nombreArchivoStorage(u).slice(0, 28)}
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
        ))}
      </div>
    </div>
  );
}
