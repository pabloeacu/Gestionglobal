import { useState } from 'react';
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
  Pencil,
  Send,
  Tag,
  AlertCircle,
  UserCog,
  XCircle,
  X,
  Paperclip,
  Clock,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { toast } from '@/lib/toast';
import { humanizeError } from '@/lib/errors';
import { formatDateTime } from '@/lib/dates';
import { abrirArchivoProtegido } from '@/lib/storageUrls';
import {
  colorBadge,
  type TrackingLineaRow,
  type TrackingCategoriaConfigRow,
  editarAvanceLinea,
} from '@/services/api/trackings';
import { useAuth } from '@/contexts/AuthContext';

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
  // Bloque E / obs 9: cuando se le pasa este callback, la gerencia puede
  // editar el texto de cualquier avance (propio, de otro gerente o del
  // gestor externo). El componente padre refresca la lista al guardar.
  onEdited?: () => void;
}

export function LineaTrackingCard({
  linea,
  categoriaConfig,
  autorNombre,
  onEdited,
}: LineaTrackingCardProps) {
  const Icon = categoriaConfig?.icono ? ICON_MAP[categoriaConfig.icono] ?? Tag : Tag;
  const futura =
    linea.alerta_en !== null && new Date(linea.alerta_en).getTime() > Date.now();
  const { user } = useAuth();
  // Staff = 'gerente' u 'operador'. La RPC valida también private.is_staff()
  // en backend, así que esto es solo UX (mostrar/ocultar el lápiz).
  const isStaff = user?.role === 'gerente' || user?.role === 'operador';
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(linea.descripcion);
  const [saving, setSaving] = useState(false);

  async function guardar() {
    if (!draft.trim()) {
      toast.error('La descripción no puede quedar vacía');
      return;
    }
    setSaving(true);
    const res = await editarAvanceLinea(linea.id, draft);
    setSaving(false);
    if (!res.ok) {
      toast.error('No pudimos guardar', { description: humanizeError(res.error) });
      return;
    }
    toast.success('Avance actualizado');
    setEditing(false);
    onEdited?.();
  }

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

          {editing ? (
            <div className="mt-2 space-y-2">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={4}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-cyan focus:outline-none focus:ring-1 focus:ring-brand-cyan"
                disabled={saving}
              />
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={guardar}
                  disabled={saving}
                  className="inline-flex items-center gap-1 rounded-lg bg-brand-cyan px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-cyan/90 disabled:opacity-50"
                >
                  <Check className="h-3 w-3" /> {saving ? 'Guardando…' : 'Guardar'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditing(false);
                    setDraft(linea.descripcion);
                  }}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                  disabled={saving}
                >
                  <X className="h-3 w-3" /> Cancelar
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-2 flex items-start gap-2">
              <p className="flex-1 whitespace-pre-wrap text-sm text-slate-700">
                {linea.descripcion}
              </p>
              {isStaff && (
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="shrink-0 rounded-md p-1 text-slate-400 transition hover:bg-slate-100 hover:text-brand-cyan"
                  title="Editar (gerencia)"
                  aria-label="Editar este avance"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          )}

          {linea.archivos_urls && linea.archivos_urls.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-2">
              {linea.archivos_urls.map((u, i) => (
                <li key={i}>
                  {/* E-GG-126: bucket privado → firmar on-click */}
                  <button
                    type="button"
                    onClick={() => void abrirArchivoProtegido(u)}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-100"
                  >
                    <Paperclip className="h-3.5 w-3.5" />
                    Adjunto {i + 1}
                  </button>
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
