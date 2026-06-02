import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from '@/lib/toast';
import { Button, Field, Input, Select, useConfirm } from '@/components/common';
import {
  upsertEstadoConfig,
  deleteEstadoConfig,
  colorBadge,
  type TrackingEstadoConfigRow,
} from '@/services/api/trackings';
import { cn } from '@/lib/cn';
import { humanizeError } from '@/lib/errors';

const COLORS = ['slate', 'cyan', 'teal', 'amber', 'red', 'emerald'] as const;

export interface EstadosConfigManagerProps {
  servicioId: string | null;  // null = editando defaults globales
  estados: TrackingEstadoConfigRow[];
  onChange: () => void;
}

export function EstadosConfigManager({
  servicioId,
  estados,
  onChange,
}: EstadosConfigManagerProps) {
  const confirm = useConfirm();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({
    slug: '',
    label: '',
    color: 'slate' as string,
    orden: 0,
    es_final: false,
  });

  async function handleAdd() {
    if (!draft.slug.trim() || !draft.label.trim()) {
      toast.error('Slug y label son obligatorios');
      return;
    }
    const res = await upsertEstadoConfig({
      servicio_id: servicioId,
      slug: draft.slug.trim(),
      label: draft.label.trim(),
      color: draft.color,
      orden: draft.orden,
      es_final: draft.es_final,
    });
    if (!res.ok) {
      toast.error(humanizeError(res.error));
      return;
    }
    toast.success('Estado agregado');
    setDraft({ slug: '', label: '', color: 'slate', orden: 0, es_final: false });
    setAdding(false);
    onChange();
  }

  async function handleDelete(estado: TrackingEstadoConfigRow) {
    if (estado.servicio_id === null) {
      toast.error('No se pueden eliminar estados default. Creá uno por servicio para sobreescribir.');
      return;
    }
    const ok = await confirm({
      title: 'Eliminar estado',
      message: `¿Eliminar "${estado.label}"? Los trackings que lo usen no se modifican.`,
      confirmLabel: 'Eliminar',
      danger: true,
    });
    if (!ok) return;
    const res = await deleteEstadoConfig(estado.id);
    if (!res.ok) {
      toast.error(humanizeError(res.error));
      return;
    }
    toast.success('Estado eliminado');
    onChange();
  }

  return (
    <section className="space-y-3">
      <header className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-700">Estados</h3>
        <Button variant="ghost" onClick={() => setAdding(true)} disabled={adding} className="py-1.5">
          <Plus className="h-4 w-4" /> Agregar
        </Button>
      </header>

      <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
        {estados.map((e) => (
          <li key={e.id} className="flex items-center gap-3 p-3">
            <span
              className={cn(
                'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1',
                colorBadge(e.color),
              )}
            >
              {e.label}
            </span>
            <span className="font-mono text-xs text-slate-500">{e.slug}</span>
            <span className="ml-auto text-xs text-slate-400">orden {e.orden}</span>
            {e.es_final && (
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700">
                final
              </span>
            )}
            {e.servicio_id !== null && (
              <button
                onClick={() => void handleDelete(e)}
                className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                aria-label="Eliminar"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </li>
        ))}
      </ul>

      {adding && (
        <div className="grid grid-cols-2 gap-3 rounded-xl border border-cyan-200 bg-cyan-50/30 p-4">
          <Field label="Slug" required>
            <Input
              value={draft.slug}
              onChange={(e) => setDraft({ ...draft, slug: e.target.value })}
              placeholder="mi_estado_custom"
            />
          </Field>
          <Field label="Label" required>
            <Input
              value={draft.label}
              onChange={(e) => setDraft({ ...draft, label: e.target.value })}
              placeholder="Mi Estado"
            />
          </Field>
          <Field label="Color">
            <Select
              value={draft.color}
              onChange={(e) => setDraft({ ...draft, color: e.target.value })}
            >
              {COLORS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Orden">
            <Input
              type="number"
              value={draft.orden}
              onChange={(e) => setDraft({ ...draft, orden: Number(e.target.value) })}
            />
          </Field>
          <label className="col-span-2 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={draft.es_final}
              onChange={(e) => setDraft({ ...draft, es_final: e.target.checked })}
            />
            Es estado final
          </label>
          <div className="col-span-2 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setAdding(false)} className="py-1.5">
              Cancelar
            </Button>
            <Button onClick={handleAdd} className="py-1.5">
              Guardar
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
