import { useEffect, useState } from 'react';
import { MessageSquareText, Plus, Save, Trash2, Loader2 } from 'lucide-react';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/cn';
import { Field, Input, Textarea, Button, Switch, Skeleton, useConfirm } from '@/components/common';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import { humanizeError } from '@/lib/errors';
import {
  listTrackingPlantillas,
  createTrackingPlantilla,
  updateTrackingPlantilla,
  deleteTrackingPlantilla,
  type TrackingPlantillaRow,
} from '@/services/api/trackingPlantillas';

// Configuración · Plantillas de tracking ("mensajes modelo") — CRUD (mig 0517, pedido Pablo 2026-09-27).
// Mismo recurso que el picker inline de las líneas de tracking. Staff-only (RLS). El cliente no lo ve.

interface Draft {
  key: string; // key de React ESTABLE (id guardado o uuid temporal) — evita remonts al prepend
  id: string | null; // null = nueva sin guardar
  titulo: string;
  cuerpo: string;
  categoria: string;
  orden: number;
  activo: boolean;
  dirty: boolean;
  saving: boolean;
}

function fromRow(r: TrackingPlantillaRow): Draft {
  return {
    key: r.id,
    id: r.id,
    titulo: r.titulo,
    cuerpo: r.cuerpo,
    categoria: r.categoria ?? '',
    orden: r.orden,
    activo: r.activo,
    dirty: false,
    saving: false,
  };
}

export function TrackingPlantillasPage() {
  const confirm = useConfirm();
  const [rows, setRows] = useState<Draft[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const res = await listTrackingPlantillas();
    setLoading(false);
    if (!res.ok) {
      toast.error(`No pudimos cargar las plantillas: ${humanizeError(res.error)}`);
      return;
    }
    setRows(res.data.map(fromRow));
  }

  useEffect(() => {
    void load();
  }, []);

  function patchRow(idx: number, patch: Partial<Draft>) {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch, dirty: true } : r)));
  }

  function nueva() {
    setRows((prev) => [
      {
        key: crypto.randomUUID(),
        id: null,
        titulo: '',
        cuerpo: '',
        categoria: '',
        orden: (prev.reduce((m, r) => Math.max(m, r.orden), 0) || 0) + 10,
        activo: true,
        dirty: true,
        saving: false,
      },
      ...prev,
    ]);
  }

  async function guardar(idx: number) {
    const d = rows[idx];
    if (!d) return;
    if (!d.titulo.trim()) {
      toast.error('El nombre de la plantilla es obligatorio');
      return;
    }
    if (!d.cuerpo.trim()) {
      toast.error('El mensaje de la plantilla es obligatorio');
      return;
    }
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, saving: true } : r)));
    const payload = {
      titulo: d.titulo.trim(),
      cuerpo: d.cuerpo.trim(),
      categoria: d.categoria.trim() || null,
      orden: d.orden,
      activo: d.activo,
    };
    const res = d.id
      ? await updateTrackingPlantilla(d.id, payload)
      : await createTrackingPlantilla(payload);
    if (!res.ok) {
      setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, saving: false } : r)));
      toast.error('No pudimos guardar la plantilla', { description: humanizeError(res.error) });
      return;
    }
    setRows((prev) => prev.map((r, i) => (i === idx ? fromRow(res.data) : r)));
    toast.success(d.id ? 'Plantilla actualizada' : 'Plantilla creada');
  }

  async function eliminar(idx: number) {
    const d = rows[idx];
    if (!d) return;
    // Nueva sin guardar → sólo la sacamos del estado.
    if (!d.id) {
      setRows((prev) => prev.filter((_, i) => i !== idx));
      return;
    }
    const okDel = await confirm({
      title: 'Eliminar plantilla',
      message: `¿Eliminar la plantilla «${d.titulo}»? No se puede deshacer.`,
      confirmLabel: 'Eliminar',
      cancelLabel: 'Cancelar',
      danger: true,
    });
    if (!okDel) return;
    const res = await deleteTrackingPlantilla(d.id);
    if (!res.ok) {
      toast.error('No pudimos eliminar la plantilla', { description: humanizeError(res.error) });
      return;
    }
    setRows((prev) => prev.filter((_, i) => i !== idx));
    toast.success('Plantilla eliminada');
  }

  return (
    <div className="space-y-5">
      <header className="card-premium relative overflow-hidden p-5">
        <TrianglesAccent position="top-right" size={90} tone="cyan" density="soft" className="opacity-20" />
        <div className="relative flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="kicker flex items-center gap-2 text-brand-cyan">
              <MessageSquareText size={14} /> Mensajes modelo
            </p>
            <h1 className="mt-1 font-display text-xl font-bold text-brand-ink">
              Plantillas de tracking
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-brand-muted">
              Mensajes reutilizables para completar más rápido el tracking de los trámites. Aparecen
              en el selector «Usar plantilla» al agregar una línea, al moderar un aporte y al cerrar
              un trámite. También podés guardarlos sobre la marcha desde esos textareas.
            </p>
          </div>
          <Button variant="primary" onClick={nueva}>
            <Plus size={15} /> Nueva plantilla
          </Button>
        </div>
      </header>

      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center">
          <MessageSquareText size={28} className="mx-auto text-slate-300" />
          <p className="mt-2 text-sm font-medium text-brand-ink">Todavía no hay plantillas</p>
          <p className="mt-1 text-sm text-brand-muted">
            Creá la primera con «Nueva plantilla», o guardá un mensaje desde el tracking de un trámite.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((d, idx) => (
            <div
              key={d.key}
              className={cn(
                'rounded-xl border bg-white p-4 transition',
                d.activo ? 'border-slate-200' : 'border-slate-200 bg-slate-50/60',
              )}
            >
              <div className="grid gap-3 md:grid-cols-[1fr_180px_110px]">
                <Field label="Nombre" required>
                  <Input
                    value={d.titulo}
                    onChange={(e) => patchRow(idx, { titulo: e.target.value })}
                    placeholder="Ej.: Renovación finalizada"
                  />
                </Field>
                <Field label="Categoría (opcional)" hint="Etiqueta libre para agrupar.">
                  <Input
                    value={d.categoria}
                    onChange={(e) => patchRow(idx, { categoria: e.target.value })}
                    placeholder="Ej.: gestor_avance"
                  />
                </Field>
                <Field label="Orden">
                  <Input
                    type="number"
                    value={String(d.orden)}
                    onChange={(e) => patchRow(idx, { orden: parseInt(e.target.value, 10) || 0 })}
                  />
                </Field>
              </div>

              <Field label="Mensaje" required className="mt-1">
                <Textarea
                  rows={4}
                  value={d.cuerpo}
                  onChange={(e) => patchRow(idx, { cuerpo: e.target.value })}
                  placeholder="El texto que se va a insertar en la línea del tracking…"
                />
              </Field>

              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <Switch
                  checked={d.activo}
                  onChange={(v) => patchRow(idx, { activo: v })}
                  label={d.activo ? 'Activa (aparece en el selector)' : 'Inactiva (oculta del selector)'}
                />
                <div className="flex items-center gap-2">
                  <Button variant="ghost" onClick={() => void eliminar(idx)} disabled={d.saving}>
                    <Trash2 size={14} /> Eliminar
                  </Button>
                  <Button
                    variant="primary"
                    onClick={() => void guardar(idx)}
                    disabled={!d.dirty || d.saving}
                  >
                    {d.saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                    {d.id ? 'Guardar' : 'Crear'}
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
