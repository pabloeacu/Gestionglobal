// Editor de publicación reutilizable: checkbox "Publicado" + ventana opcional
// (publicar desde / dejar de publicar el). Genera el chip de estado y los
// inputs datetime-local. Tres modos pedidos en sesión 30/05/2026:
//   1. Publicación inmediata (publicado=true, sin fechas)
//   2. Publicación programada (publicar_at en el futuro)
//   3. Despublicación programada / oculto (publicado=false ó despublicar_at)

import { Calendar, Eye, EyeOff } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Field, Input } from '@/components/common';
import { estadoPublicacion } from '@/services/api/campus';

export interface PublicacionState {
  publicado: boolean;
  publicar_at: string | null;
  despublicar_at: string | null;
}

interface PublicacionEditorProps {
  value: PublicacionState;
  onChange: (next: PublicacionState) => void;
  /** Densidad: 'compact' para insertarlo dentro de cards de clase, 'normal' para módulo/curso. */
  density?: 'compact' | 'normal';
  /** DGG-115: 'curso' etiqueta el post-fin como "Finalizado" (corta matrícula
   *  de nuevos, no solo visibilidad). Módulos/clases conservan "Despublicado". */
  variant?: 'curso';
}

function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  // YYYY-MM-DDTHH:mm (sin segundos, hora local)
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(local: string): string | null {
  if (!local) return null;
  return new Date(local).toISOString();
}

const TONE_CHIP: Record<
  ReturnType<typeof estadoPublicacion>['tone'],
  string
> = {
  emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  slate: 'bg-slate-100 text-slate-600 ring-slate-200',
  amber: 'bg-amber-50 text-amber-700 ring-amber-200',
  rose: 'bg-rose-50 text-rose-700 ring-rose-200',
};

export function PublicacionEditor({ value, onChange, density = 'normal', variant }: PublicacionEditorProps) {
  const estado = estadoPublicacion(value, variant);
  // DGG-115 (§6 A#20): ventana invertida (fin <= inicio) = el recurso pasa de
  // "programado" a oculto/finalizado sin publicarse nunca. Warning inline.
  const ventanaInvertida =
    !!value.publicar_at &&
    !!value.despublicar_at &&
    new Date(value.despublicar_at).getTime() <= new Date(value.publicar_at).getTime();

  return (
    <div
      className={cn(
        'rounded-xl border border-slate-200 bg-slate-50/50',
        density === 'compact' ? 'p-3' : 'p-4',
      )}
    >
      <header className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {value.publicado ? (
            <Eye size={14} className="text-brand-cyan" />
          ) : (
            <EyeOff size={14} className="text-slate-500" />
          )}
          <span className={cn('text-xs font-semibold uppercase tracking-wide', value.publicado ? 'text-brand-ink' : 'text-slate-600')}>
            Publicación
          </span>
        </div>
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1',
            TONE_CHIP[estado.tone],
          )}
        >
          {estado.label}
        </span>
      </header>

      <label className="flex cursor-pointer items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={value.publicado}
          onChange={(e) => onChange({ ...value, publicado: e.target.checked })}
          className="mt-0.5 rounded text-brand-cyan"
        />
        <span>
          <strong className="text-brand-ink">Visible para los alumnos</strong>
          <span className="ml-1 text-xs text-brand-muted">
            (destildá para dejarlo oculto / en borrador)
          </span>
        </span>
      </label>

      <div
        className={cn(
          'mt-3 grid gap-2',
          density === 'compact' ? 'sm:grid-cols-2' : 'sm:grid-cols-2',
        )}
      >
        <Field
          label={
            <span className="inline-flex items-center gap-1">
              <Calendar size={11} /> Publicar a partir de
            </span>
          }
          hint="Opcional. Si lo seteás a futuro, queda oculto hasta esa fecha."
        >
          <Input
            type="datetime-local"
            value={toLocalInput(value.publicar_at)}
            onChange={(e) => onChange({ ...value, publicar_at: fromLocalInput(e.target.value) })}
          />
        </Field>
        <Field
          label={
            <span className="inline-flex items-center gap-1">
              <Calendar size={11} /> Dejar de publicar el
            </span>
          }
          hint={
            variant === 'curso'
              ? 'Opcional. Al llegar esa fecha el curso queda FINALIZADO: no admite nuevas matrículas ni es visible para no matriculados. Los matriculados conservan su vigencia.'
              : 'Opcional. Cuando llegue esa fecha, se oculta automáticamente.'
          }
        >
          <Input
            type="datetime-local"
            value={toLocalInput(value.despublicar_at)}
            onChange={(e) => onChange({ ...value, despublicar_at: fromLocalInput(e.target.value) })}
          />
        </Field>
      </div>
      {ventanaInvertida && (
        <p className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">
          ⚠ La fecha de fin es anterior (o igual) a la de publicación:{' '}
          {variant === 'curso'
            ? 'el curso quedaría FINALIZADO sin haberse publicado nunca y no admitiría matrículas.'
            : 'el recurso nunca llegaría a publicarse.'}{' '}
          Revisá las fechas.
        </p>
      )}
    </div>
  );
}
