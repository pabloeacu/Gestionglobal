import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Save, Sliders } from 'lucide-react';
import { toast } from '@/lib/toast';
import { Field, Input, Skeleton, Button } from '@/components/common';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import { IllustratedEmpty } from '@/components/brand/IllustratedEmpty';
import {
  listConfig,
  actualizarConfig,
  type RecuperoConfigRow,
} from '@/services/api/recupero';
import { humanizeError } from '@/lib/errors';

interface DraftRow {
  id: string;
  administracion_id: string | null;
  dias_r1: number;
  dias_r2: number;
  dias_r3: number;
  activo_r1: boolean;
  activo_r2: boolean;
  activo_r3: boolean;
  email_destinatario_override: string;
  dirty: boolean;
  saving: boolean;
}

function fromRow(r: RecuperoConfigRow): DraftRow {
  return {
    id: r.id,
    administracion_id: r.administracion_id,
    dias_r1: r.dias_r1,
    dias_r2: r.dias_r2,
    dias_r3: r.dias_r3,
    activo_r1: r.activo_r1,
    activo_r2: r.activo_r2,
    activo_r3: r.activo_r3,
    email_destinatario_override: r.email_destinatario_override ?? '',
    dirty: false,
    saving: false,
  };
}

export function RecuperoConfigPage() {
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const res = await listConfig();
    setLoading(false);
    if (!res.ok) {
      toast.error(`No pudimos cargar la configuración: ${humanizeError(res.error)}`);
      return;
    }
    setRows(res.data.map(fromRow));
  }

  useEffect(() => {
    void load();
  }, []);

  function patchRow(id: string, patch: Partial<DraftRow>) {
    setRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, ...patch, dirty: true } : r)),
    );
  }

  async function saveRow(row: DraftRow) {
    if (!(row.dias_r1 < row.dias_r2 && row.dias_r2 < row.dias_r3)) {
      toast.error('Los días deben cumplir R1 < R2 < R3.');
      return;
    }
    setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, saving: true } : r)));
    const res = await actualizarConfig(row.id, {
      dias_r1: row.dias_r1,
      dias_r2: row.dias_r2,
      dias_r3: row.dias_r3,
      activo_r1: row.activo_r1,
      activo_r2: row.activo_r2,
      activo_r3: row.activo_r3,
      email_destinatario_override: row.email_destinatario_override.trim() || null,
    });
    if (!res.ok) {
      toast.error(`No se pudo guardar: ${humanizeError(res.error)}`);
      setRows((prev) =>
        prev.map((r) => (r.id === row.id ? { ...r, saving: false } : r)),
      );
      return;
    }
    toast.success('Configuración guardada.');
    setRows((prev) =>
      prev.map((r) => (r.id === row.id ? { ...fromRow(res.data) } : r)),
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="kicker text-brand-cyan">Cobranzas · MDC-17</p>
          <h1 className="font-display text-3xl font-bold text-brand-ink sm:text-4xl">
            Configuración de recupero
          </h1>
          <p className="mt-1 text-sm text-brand-muted">
            Definí cuándo se disparan automáticamente los recuperos R1, R2 y R3.
            La fila <span className="font-semibold">Global</span> aplica como
            default; podés crear overrides por administración.
          </p>
        </div>
        <Link
          to="/gerencia/recupero"
          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-brand-ink transition hover:border-brand-cyan hover:text-brand-cyan"
        >
          <ArrowLeft size={15} /> Volver
        </Link>
      </header>

      <section className="card-premium relative overflow-hidden p-5">
        <TrianglesAccent
          position="top-right"
          size={140}
          tone="cyan"
          density="soft"
          className="opacity-20"
        />
        <div className="relative space-y-4">
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 2 }).map((_, i) => (
                <Skeleton key={i} className="h-44 w-full rounded-2xl" />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <IllustratedEmpty
              illustration="lista"
              title="No hay configuraciones cargadas"
              description="Definí umbrales y reglas de recupero para empezar a automatizar la cobranza."
            />
          ) : (
            rows.map((r) => (
              <article
                key={r.id}
                className="rounded-2xl border border-slate-200 bg-white p-4"
              >
                <header className="mb-3 flex items-center gap-2">
                  <Sliders size={15} className="text-brand-cyan" />
                  <h3 className="font-display text-base font-semibold text-brand-ink">
                    {r.administracion_id === null
                      ? 'Configuración global (default)'
                      : `Override por admin · ${r.administracion_id}`}
                  </h3>
                </header>

                <div className="grid gap-3 sm:grid-cols-3">
                  <NivelEditor
                    titulo="R1 · Amistoso"
                    dias={r.dias_r1}
                    activo={r.activo_r1}
                    onDias={(n) => patchRow(r.id, { dias_r1: n })}
                    onActivo={(v) => patchRow(r.id, { activo_r1: v })}
                  />
                  <NivelEditor
                    titulo="R2 · Firme"
                    dias={r.dias_r2}
                    activo={r.activo_r2}
                    onDias={(n) => patchRow(r.id, { dias_r2: n })}
                    onActivo={(v) => patchRow(r.id, { activo_r2: v })}
                  />
                  <NivelEditor
                    titulo="R3 · Prejudicial"
                    dias={r.dias_r3}
                    activo={r.activo_r3}
                    onDias={(n) => patchRow(r.id, { dias_r3: n })}
                    onActivo={(v) => patchRow(r.id, { activo_r3: v })}
                  />
                </div>

                <Field
                  label="Email destinatario (override, opcional)"
                  className="mt-4"
                >
                  <Input
                    type="email"
                    value={r.email_destinatario_override}
                    onChange={(e) =>
                      patchRow(r.id, { email_destinatario_override: e.target.value })
                    }
                    placeholder="cobranzas@cliente.com (vacío usa el email de la administración)"
                  />
                </Field>

                <footer className="mt-3 flex items-center justify-end gap-2">
                  <Button
                    onClick={() => saveRow(r)}
                    disabled={!r.dirty || r.saving}
                  >
                    <Save size={14} /> {r.saving ? 'Guardando…' : 'Guardar'}
                  </Button>
                </footer>
              </article>
            ))
          )}
        </div>
      </section>
    </div>
  );
}

interface NivelProps {
  titulo: string;
  dias: number;
  activo: boolean;
  onDias: (n: number) => void;
  onActivo: (v: boolean) => void;
}

function NivelEditor({ titulo, dias, activo, onDias, onActivo }: NivelProps) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand-muted">
          {titulo}
        </p>
        <label className="inline-flex cursor-pointer items-center gap-1.5">
          <input
            type="checkbox"
            checked={activo}
            onChange={(e) => onActivo(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-brand-cyan focus:ring-brand-cyan"
          />
          <span className="text-[11px] text-brand-muted">Activo</span>
        </label>
      </div>
      <Field label="Días desde vencimiento" className="mt-2">
        <Input
          type="number"
          min={1}
          max={365}
          value={dias}
          onChange={(e) => onDias(Number(e.target.value))}
        />
      </Field>
    </div>
  );
}
