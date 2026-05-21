import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Save, FileEdit } from 'lucide-react';
import { cn } from '@/lib/cn';
import { toast } from '@/lib/toast';
import { Field, Input, Textarea, Skeleton, Button } from '@/components/common';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import {
  listPlantillas,
  updatePlantilla,
  RECUPERO_NIVEL_LABEL,
  RECUPERO_NIVEL_TONO,
  type RecuperoNivel,
  type RecuperoPlantillaRow,
} from '@/services/api/recupero';

const TONE_RING: Record<'cyan' | 'amber' | 'red', string> = {
  cyan: 'border-brand-cyan/40 bg-brand-cyan/5',
  amber: 'border-amber-300 bg-amber-50/60',
  red: 'border-red-300 bg-red-50/60',
};

interface Draft {
  slug: string;
  asunto: string;
  body: string;
  activo: boolean;
  descripcion: string;
  dias: number;
  nivel: RecuperoNivel;
  dirty: boolean;
  saving: boolean;
}

function fromRow(r: RecuperoPlantillaRow): Draft {
  return {
    slug: r.slug,
    asunto: r.asunto,
    body: r.body,
    activo: r.activo,
    descripcion: r.descripcion ?? '',
    dias: r.dias_desde_vencimiento_min,
    nivel: r.nivel as RecuperoNivel,
    dirty: false,
    saving: false,
  };
}

export function PlantillasPage() {
  const [rows, setRows] = useState<Draft[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const res = await listPlantillas();
    setLoading(false);
    if (!res.ok) {
      toast.error(`No pudimos cargar las plantillas: ${res.error.message}`);
      return;
    }
    setRows(res.data.map(fromRow));
  }

  useEffect(() => {
    void load();
  }, []);

  function patchRow(slug: string, patch: Partial<Draft>) {
    setRows((prev) =>
      prev.map((r) => (r.slug === slug ? { ...r, ...patch, dirty: true } : r)),
    );
  }

  async function saveRow(d: Draft) {
    setRows((prev) => prev.map((r) => (r.slug === d.slug ? { ...r, saving: true } : r)));
    const res = await updatePlantilla(d.slug, {
      asunto: d.asunto.trim(),
      body: d.body,
      activo: d.activo,
      descripcion: d.descripcion.trim() || null,
      dias_desde_vencimiento_min: d.dias,
    });
    if (!res.ok) {
      toast.error(`No se pudo guardar: ${res.error.message}`);
      setRows((prev) => prev.map((r) => (r.slug === d.slug ? { ...r, saving: false } : r)));
      return;
    }
    toast.success('Plantilla guardada.');
    setRows((prev) => prev.map((r) => (r.slug === d.slug ? fromRow(res.data) : r)));
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="kicker text-brand-cyan">Cobranzas · MDC-17</p>
          <h1 className="font-display text-3xl font-bold text-brand-ink sm:text-4xl">
            Plantillas de recupero
          </h1>
          <p className="mt-1 text-sm text-brand-muted">
            Editá el copy de cada nivel. Variables disponibles:{' '}
            <code className="rounded bg-slate-100 px-1 text-xs">{'{{nombre}}'}</code>,{' '}
            <code className="rounded bg-slate-100 px-1 text-xs">
              {'{{nombre_administracion}}'}
            </code>
            ,{' '}
            <code className="rounded bg-slate-100 px-1 text-xs">
              {'{{comprobante_tipo}}'}
            </code>
            ,{' '}
            <code className="rounded bg-slate-100 px-1 text-xs">
              {'{{comprobante_numero}}'}
            </code>
            ,{' '}
            <code className="rounded bg-slate-100 px-1 text-xs">
              {'{{saldo_pendiente}}'}
            </code>
            ,{' '}
            <code className="rounded bg-slate-100 px-1 text-xs">
              {'{{fecha_vencimiento}}'}
            </code>
            ,{' '}
            <code className="rounded bg-slate-100 px-1 text-xs">
              {'{{dias_vencido}}'}
            </code>
            .
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
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-60 w-full rounded-2xl" />
              ))}
            </div>
          ) : (
            rows.map((d) => {
              const tone = RECUPERO_NIVEL_TONO[d.nivel];
              return (
                <article
                  key={d.slug}
                  className={cn(
                    'rounded-2xl border p-4',
                    TONE_RING[tone],
                  )}
                >
                  <header className="mb-3 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <FileEdit size={15} className="text-brand-cyan" />
                      <h3 className="font-display text-base font-semibold text-brand-ink">
                        {RECUPERO_NIVEL_LABEL[d.nivel]}
                      </h3>
                      <code className="rounded bg-white/70 px-2 py-0.5 text-[11px] text-brand-muted">
                        {d.slug}
                      </code>
                    </div>
                    <label className="inline-flex cursor-pointer items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={d.activo}
                        onChange={(e) =>
                          patchRow(d.slug, { activo: e.target.checked })
                        }
                        className="h-4 w-4 rounded border-slate-300 text-brand-cyan focus:ring-brand-cyan"
                      />
                      <span className="text-[11px] text-brand-muted">Activa</span>
                    </label>
                  </header>

                  <div className="grid gap-3 sm:grid-cols-3">
                    <Field label="Asunto" className="sm:col-span-2">
                      <Input
                        value={d.asunto}
                        onChange={(e) => patchRow(d.slug, { asunto: e.target.value })}
                      />
                    </Field>
                    <Field label="Días desde venc. (referencia)">
                      <Input
                        type="number"
                        min={0}
                        max={365}
                        value={d.dias}
                        onChange={(e) =>
                          patchRow(d.slug, { dias: Number(e.target.value) })
                        }
                      />
                    </Field>
                  </div>

                  <Field label="Cuerpo (texto plano)" className="mt-3">
                    <Textarea
                      value={d.body}
                      onChange={(e) => patchRow(d.slug, { body: e.target.value })}
                      rows={8}
                    />
                  </Field>

                  <Field label="Descripción interna" className="mt-3">
                    <Input
                      value={d.descripcion}
                      onChange={(e) =>
                        patchRow(d.slug, { descripcion: e.target.value })
                      }
                    />
                  </Field>

                  <footer className="mt-3 flex items-center justify-end gap-2">
                    <Button onClick={() => saveRow(d)} disabled={!d.dirty || d.saving}>
                      <Save size={14} /> {d.saving ? 'Guardando…' : 'Guardar'}
                    </Button>
                  </footer>
                </article>
              );
            })
          )}
        </div>
      </section>
    </div>
  );
}
