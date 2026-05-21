import {
  Award,
  Bell,
  Calendar,
  Check,
  CheckCircle2,
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
import {
  colorBadge,
  type TrackingLineaRow,
  type TrackingCategoriaConfigRow,
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
  calendar: Calendar,
  eye: Eye,
  award: Award,
  'graduation-cap': GraduationCap,
  tag: Tag,
};

export interface LineaTrackingCardProps {
  linea: TrackingLineaRow;
  categoriaConfig?: TrackingCategoriaConfigRow;
  autorNombre?: string | null;
}

export function LineaTrackingCard({
  linea,
  categoriaConfig,
  autorNombre,
}: LineaTrackingCardProps) {
  const Icon = categoriaConfig?.icono ? ICON_MAP[categoriaConfig.icono] ?? Tag : Tag;
  const futura =
    linea.alerta_en !== null && new Date(linea.alerta_en).getTime() > Date.now();

  return (
    <article
      className={cn(
        'group relative overflow-hidden rounded-2xl border border-slate-200/70 bg-white',
        'p-5 shadow-sm transition motion-safe:animate-fade-up',
        'hover:shadow-md hover:border-slate-300',
      )}
    >
      <div className="flex items-start gap-4">
        <div
          className={cn(
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-1',
            colorBadge(categoriaConfig?.color ?? 'slate'),
          )}
        >
          <Icon className="h-5 w-5" />
        </div>

        <div className="flex-1 min-w-0">
          <header className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1',
                colorBadge(categoriaConfig?.color ?? 'slate'),
              )}
            >
              {categoriaConfig?.label ?? linea.categoria}
            </span>
            {linea.estado_asociado && (
              <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700 ring-1 ring-slate-200">
                <CheckCircle2 className="mr-1 h-3 w-3" />
                {linea.estado_asociado}
              </span>
            )}
            {futura && (
              <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-amber-200">
                <Clock className="mr-1 h-3 w-3" />
                Alerta {formatDateTime(linea.alerta_en!)}
              </span>
            )}
          </header>

          <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">
            {linea.descripcion}
          </p>

          {linea.archivos_urls && linea.archivos_urls.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-2">
              {linea.archivos_urls.map((u, i) => (
                <li key={i}>
                  <a
                    href={u}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-100"
                  >
                    <Paperclip className="h-3.5 w-3.5" />
                    Adjunto {i + 1}
                  </a>
                </li>
              ))}
            </ul>
          )}

          <footer className="mt-3 flex items-center gap-2 text-xs text-slate-500">
            <span>{formatDateTime(linea.created_at)}</span>
            {autorNombre && (
              <>
                <span aria-hidden>·</span>
                <span>{autorNombre}</span>
              </>
            )}
          </footer>
        </div>
      </div>
    </article>
  );
}
