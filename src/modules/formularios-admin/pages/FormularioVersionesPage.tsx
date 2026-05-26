// Histórico de versiones del schema con opción a restaurar. La restauración
// dispara `restaurar_formulario_version` (SECURITY DEFINER), que reescribe
// `formularios.schema` y el propio trigger guarda otra snapshot del estado
// previo (nunca se pierde nada).

import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, History, RotateCcw, GitCompare, X } from 'lucide-react';
import { Button, useConfirm } from '@/components/common';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import { BrandLoader } from '@/components/brand/BrandLoader';
import { IllustratedEmpty } from '@/components/brand/IllustratedEmpty';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/cn';
import {
  getFormularioPorId,
  listVersiones,
  restaurarVersion,
  type FormularioVersionRow,
} from '@/services/api/formularios-admin';
import type { FormularioRow, FormularioSchemaDef } from '@/services/api/formularios';
import { VersionDiffModal } from '../components/VersionDiffModal';

function fmtFecha(d: string) {
  try {
    return new Date(d).toLocaleString('es-AR', { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return d;
  }
}

function contarCampos(schema: unknown): { secciones: number; campos: number } {
  try {
    const s = schema as FormularioSchemaDef;
    return {
      secciones: s.sections.length,
      campos: s.sections.reduce((acc, sec) => acc + sec.fields.length, 0),
    };
  } catch {
    return { secciones: 0, campos: 0 };
  }
}

export function FormularioVersionesPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const [formulario, setFormulario] = useState<FormularioRow | null>(null);
  const [versiones, setVersiones] = useState<FormularioVersionRow[]>([]);
  const [loading, setLoading] = useState(true);
  // 4.E · diff visual entre 2 versiones (DGG-33). selectedIds guarda hasta
  // 2 IDs en orden de selección; cuando son 2, el botón "Comparar" se
  // habilita y abre el modal de diff.
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [diffOpen, setDiffOpen] = useState(false);

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 2) return [prev[1]!, id]; // FIFO
      return [...prev, id];
    });
  }

  const versionesAB = useMemo(() => {
    if (selectedIds.length !== 2) return null;
    const a = versiones.find((v) => v.id === selectedIds[0]);
    const b = versiones.find((v) => v.id === selectedIds[1]);
    if (!a || !b) return null;
    // Convención: A = más vieja, B = más nueva (por version_num).
    return a.version_num <= b.version_num ? { a, b } : { a: b, b: a };
  }, [selectedIds, versiones]);

  async function recargar() {
    if (!id) return;
    setLoading(true);
    const [fr, vr] = await Promise.all([
      getFormularioPorId(id),
      listVersiones(id),
    ]);
    setLoading(false);
    if (!fr.ok) {
      toast.error('No pudimos cargar el formulario', { description: fr.error.message });
      return;
    }
    if (!vr.ok) {
      toast.error('No pudimos listar versiones', { description: vr.error.message });
      return;
    }
    setFormulario(fr.data);
    setVersiones(vr.data);
  }

  useEffect(() => {
    void recargar();
  }, [id]);

  async function onRestaurar(v: FormularioVersionRow) {
    if (!formulario) return;
    const ok = await confirm({
      title: 'Restaurar versión',
      message: `¿Reemplazar el schema actual por la versión ${v.version_num}? Tu schema actual quedará como una nueva snapshot.`,
      confirmLabel: 'Restaurar',
    });
    if (!ok) return;
    const res = await restaurarVersion(formulario.id, v.version_num);
    if (!res.ok) {
      toast.error('No pudimos restaurar', { description: res.error.message });
      return;
    }
    toast.success(`Versión ${v.version_num} restaurada`);
    navigate(`/gerencia/formularios/${formulario.id}`);
  }

  if (loading) {
    return (
      <div className="grid min-h-[40vh] place-items-center">
        <BrandLoader size={48} label="Cargando historial…" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => navigate(`/gerencia/formularios/${id}`)}
          className="rounded-md p-1.5 text-brand-muted hover:bg-slate-100"
          aria-label="Volver"
        >
          <ArrowLeft size={16} />
        </button>
        <div>
          <p className="kicker">Historial</p>
          <h1 className="font-display text-2xl font-bold text-brand-ink">
            Versiones de {formulario?.titulo}
          </h1>
          <p className="text-sm text-brand-muted">
            Cada vez que guardás cambios estructurales se crea un snapshot.
          </p>
        </div>
        <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-brand-cyan-pale/40 px-2.5 py-1 text-xs font-medium text-brand-cyan">
          <History size={12} /> Versión actual: {formulario?.version_actual ?? 1}
        </span>
      </header>

      {versiones.length === 0 ? (
        <IllustratedEmpty
          title="Aún no hay snapshots"
          description="La primera versión se crea al guardar el próximo cambio."
          action={
            <Link
              to={`/gerencia/formularios/${id}`}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-brand-ink hover:bg-slate-50"
            >
              Ir al editor
            </Link>
          }
        />
      ) : (
        <>
          {/* Hint para usar el diff */}
          {selectedIds.length === 0 && versiones.length >= 2 && (
            <div className="rounded-xl border border-dashed border-brand-cyan/40 bg-brand-cyan-pale/20 px-4 py-2.5 text-xs text-brand-cyan">
              Marcá dos versiones para comparar visualmente sus diferencias.
            </div>
          )}
          <ul className="space-y-3">
            {versiones.map((v, i) => {
              const stats = contarCampos(v.schema);
              const checked = selectedIds.includes(v.id);
              const orderIdx = selectedIds.indexOf(v.id);
              return (
                <li
                  key={v.id}
                  className={cn(
                    'card-premium relative overflow-hidden p-4 motion-safe:animate-fade-up transition',
                    checked && 'ring-2 ring-brand-cyan/40',
                  )}
                  style={{ animationDelay: `${i * 30}ms` }}
                >
                  <TrianglesAccent
                    position="top-right"
                    size={90}
                    tone="teal"
                    density="soft"
                    className="opacity-20"
                  />
                  <div className="relative flex flex-wrap items-center gap-4">
                    {/* 4.E · checkbox para seleccionar como A o B del diff. */}
                    <label
                      className={cn(
                        'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border-2 text-[10px] font-bold uppercase transition',
                        checked
                          ? 'border-brand-cyan bg-brand-cyan text-white'
                          : 'border-slate-300 bg-white text-brand-muted hover:border-brand-cyan',
                      )}
                      title={
                        checked
                          ? 'Desmarcar de la comparación'
                          : 'Marcar para comparar'
                      }
                    >
                      <input
                        type="checkbox"
                        className="sr-only"
                        checked={checked}
                        onChange={() => toggleSelected(v.id)}
                      />
                      {checked ? (orderIdx === 0 ? 'A' : 'B') : ''}
                    </label>
                    <div className="min-w-0 flex-1">
                      <p className="font-display text-base font-bold text-brand-ink">
                        Versión {v.version_num}
                      </p>
                      <p className="text-xs text-brand-muted">
                        {fmtFecha(v.guardado_at)} · {stats.secciones} secciones · {stats.campos} campos
                      </p>
                    </div>
                    <Button variant="secondary" onClick={() => onRestaurar(v)}>
                      <RotateCcw size={13} /> Restaurar
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>

          {/* 4.E · barra flotante con CTA "Comparar" cuando hay 2 seleccionadas */}
          {selectedIds.length > 0 && (
            <div className="fixed inset-x-0 bottom-4 z-40 flex justify-center px-4 motion-safe:animate-fade-up">
              <div className="flex items-center gap-3 rounded-full border border-slate-200 bg-white px-4 py-2.5 shadow-[0_18px_48px_-15px_rgba(18,34,48,0.35)]">
                <span className="text-xs text-brand-muted">
                  {selectedIds.length === 1
                    ? 'Marcaste 1 versión · seleccioná otra para comparar'
                    : `Marcaste 2 versiones`}
                </span>
                {versionesAB && (
                  <span className="text-xs font-medium text-brand-ink">
                    v{versionesAB.a.version_num} → v{versionesAB.b.version_num}
                  </span>
                )}
                <Button
                  onClick={() => setDiffOpen(true)}
                  disabled={selectedIds.length !== 2}
                >
                  <GitCompare size={13} /> Comparar
                </Button>
                <button
                  type="button"
                  onClick={() => setSelectedIds([])}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-full text-brand-muted hover:bg-slate-100"
                  aria-label="Cancelar selección"
                  title="Cancelar"
                >
                  <X size={14} />
                </button>
              </div>
            </div>
          )}

          {versionesAB && (
            <VersionDiffModal
              open={diffOpen}
              onClose={() => setDiffOpen(false)}
              versionA={{
                num: versionesAB.a.version_num,
                at: versionesAB.a.guardado_at,
                schema: versionesAB.a.schema as unknown as FormularioSchemaDef,
              }}
              versionB={{
                num: versionesAB.b.version_num,
                at: versionesAB.b.guardado_at,
                schema: versionesAB.b.schema as unknown as FormularioSchemaDef,
              }}
            />
          )}
        </>
      )}
    </div>
  );
}
