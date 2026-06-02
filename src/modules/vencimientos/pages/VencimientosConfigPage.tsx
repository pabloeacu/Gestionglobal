import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from '@/lib/toast';
import { ArrowLeft, Save, Sliders } from 'lucide-react';
import {
  Button,
  Field,
  Input,
  Skeleton,
} from '@/components/common';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh';
import { cn } from '@/lib/cn';
import {
  listConfig,
  actualizarConfig,
  VENCIMIENTO_TIPO_LABEL,
  type VencimientoConfigRow,
  type VencimientoTipo,
} from '@/services/api/vencimientos';
import { humanizeError } from '@/lib/errors';

interface RowState {
  dirty: boolean;
  saving: boolean;
  dias_alerta_1: number;
  dias_alerta_2: number;
  dias_alerta_3: number;
  activo: boolean;
  email_destinatario: string;
  sugerencia_servicio_slug: string;
}

function fromRow(r: VencimientoConfigRow): RowState {
  return {
    dirty: false,
    saving: false,
    dias_alerta_1: r.dias_alerta_1,
    dias_alerta_2: r.dias_alerta_2,
    dias_alerta_3: r.dias_alerta_3,
    activo: r.activo,
    email_destinatario: r.email_destinatario ?? '',
    sugerencia_servicio_slug: r.sugerencia_servicio_slug ?? '',
  };
}

export function VencimientosConfigPage() {
  const [rows, setRows] = useState<VencimientoConfigRow[]>([]);
  const [edits, setEdits] = useState<Record<string, RowState>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    // Configs globales (administracion_id NULL). El override per-admin se
    // gestiona desde la ficha de cada cliente (fuera de scope acá).
    const res = await listConfig(null);
    setLoading(false);
    if (!res.ok) {
      setError(humanizeError(res.error));
      return;
    }
    setRows(res.data);
    const init: Record<string, RowState> = {};
    for (const r of res.data) init[r.id] = fromRow(r);
    setEdits(init);
  }

  useEffect(() => {
    void load();
  }, []);

  useRealtimeRefresh(['vencimientos_config'], () => void load());

  function patch(id: string, p: Partial<RowState>) {
    setEdits((prev) => ({
      ...prev,
      [id]: { ...prev[id]!, ...p, dirty: true },
    }));
  }

  async function save(id: string) {
    const s = edits[id];
    if (!s) return;
    if (!(s.dias_alerta_1 > s.dias_alerta_2 && s.dias_alerta_2 > s.dias_alerta_3)) {
      toast.error('Los umbrales deben ir de mayor a menor (30 > 20 > 10).');
      return;
    }
    setEdits((prev) => ({ ...prev, [id]: { ...prev[id]!, saving: true } }));
    const res = await actualizarConfig(id, {
      dias_alerta_1: s.dias_alerta_1,
      dias_alerta_2: s.dias_alerta_2,
      dias_alerta_3: s.dias_alerta_3,
      activo: s.activo,
      email_destinatario: s.email_destinatario.trim() || null,
      sugerencia_servicio_slug: s.sugerencia_servicio_slug.trim() || null,
    });
    if (!res.ok) {
      setEdits((prev) => ({ ...prev, [id]: { ...prev[id]!, saving: false } }));
      toast.error(`No se pudo guardar: ${humanizeError(res.error)}`);
      return;
    }
    toast.success('Configuración actualizada');
    setEdits((prev) => ({
      ...prev,
      [id]: { ...fromRow(res.data), dirty: false, saving: false },
    }));
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Link
            to="/gerencia/vencimientos"
            className="inline-flex items-center gap-1 text-xs font-medium text-brand-muted hover:text-brand-cyan"
          >
            <ArrowLeft size={13} /> Volver a vencimientos
          </Link>
          <p className="kicker mt-1 text-brand-cyan">Datos estratégicos</p>
          <h1 className="font-display text-3xl font-bold text-brand-ink sm:text-4xl">
            Configuración de alertas
          </h1>
          <p className="mt-1 text-sm text-brand-muted">
            Política por tipo de vencimiento: 3 umbrales de alerta, activación
            y servicio sugerido al cliente.
          </p>
        </div>
        <span className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-brand-muted">
          <Sliders size={13} /> Política global
        </span>
      </header>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-32 w-full rounded-2xl" />
          ))}
        </div>
      ) : error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => {
            const s = edits[r.id];
            if (!s) return null;
            const tipoLabel = VENCIMIENTO_TIPO_LABEL[r.tipo as VencimientoTipo];
            return (
              <section
                key={r.id}
                className="card-premium relative overflow-hidden p-5"
              >
                <TrianglesAccent
                  position="top-right"
                  size={100}
                  tone="cyan"
                  density="soft"
                  className="opacity-20"
                />
                <div className="relative space-y-4">
                  <header className="flex items-start justify-between gap-3">
                    <div>
                      <p className="kicker text-brand-cyan">Tipo</p>
                      <h2 className="font-display text-lg font-bold text-brand-ink">
                        {tipoLabel}
                      </h2>
                    </div>
                    <label
                      className={cn(
                        'inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition',
                        s.activo
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                          : 'border-slate-200 bg-slate-50 text-brand-muted',
                      )}
                    >
                      <input
                        type="checkbox"
                        className="sr-only"
                        checked={s.activo}
                        onChange={(e) =>
                          patch(r.id, { activo: e.target.checked })
                        }
                      />
                      <span
                        className={cn(
                          'h-2 w-2 rounded-full',
                          s.activo ? 'bg-emerald-500' : 'bg-slate-400',
                        )}
                      />
                      {s.activo ? 'Activo' : 'Inactivo'}
                    </label>
                  </header>

                  <div className="grid grid-cols-3 gap-3">
                    <SliderField
                      label="1er aviso"
                      value={s.dias_alerta_1}
                      min={s.dias_alerta_2 + 1}
                      max={120}
                      onChange={(n) => patch(r.id, { dias_alerta_1: n })}
                    />
                    <SliderField
                      label="2do aviso"
                      value={s.dias_alerta_2}
                      min={s.dias_alerta_3 + 1}
                      max={Math.max(1, s.dias_alerta_1 - 1)}
                      onChange={(n) => patch(r.id, { dias_alerta_2: n })}
                    />
                    <SliderField
                      label="3er aviso"
                      value={s.dias_alerta_3}
                      min={1}
                      max={Math.max(1, s.dias_alerta_2 - 1)}
                      onChange={(n) => patch(r.id, { dias_alerta_3: n })}
                    />
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Field
                      label="Email destinatario (opcional)"
                      hint="Si está vacío, usamos el email del administrador."
                    >
                      <Input
                        type="email"
                        value={s.email_destinatario}
                        onChange={(e) =>
                          patch(r.id, { email_destinatario: e.target.value })
                        }
                        placeholder="alertas@cliente.com"
                      />
                    </Field>
                    <Field
                      label="Servicio sugerido (slug)"
                      hint="Catálogo del módulo de servicios."
                    >
                      <Input
                        value={s.sugerencia_servicio_slug}
                        onChange={(e) =>
                          patch(r.id, {
                            sugerencia_servicio_slug: e.target.value,
                          })
                        }
                        placeholder="renovacion-rpac"
                      />
                    </Field>
                  </div>

                  <footer className="flex justify-end">
                    <Button
                      onClick={() => void save(r.id)}
                      disabled={!s.dirty || s.saving}
                    >
                      <Save size={15} />
                      {s.saving ? 'Guardando…' : 'Guardar cambios'}
                    </Button>
                  </footer>
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

interface SliderFieldProps {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
}

function SliderField({ label, value, min, max, onChange }: SliderFieldProps) {
  const safeMin = Math.max(1, min);
  const safeMax = Math.max(safeMin, max);
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-brand-muted">
          {label}
        </span>
        <span className="font-display text-lg font-bold text-brand-ink">
          {value}
          <span className="ml-0.5 text-xs font-medium text-brand-muted">d</span>
        </span>
      </div>
      <input
        type="range"
        min={safeMin}
        max={safeMax}
        value={Math.min(safeMax, Math.max(safeMin, value))}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full accent-brand-cyan"
      />
    </div>
  );
}
