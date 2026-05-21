// Histórico de versiones del schema con opción a restaurar. La restauración
// dispara `restaurar_formulario_version` (SECURITY DEFINER), que reescribe
// `formularios.schema` y el propio trigger guarda otra snapshot del estado
// previo (nunca se pierde nada).

import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, History, RotateCcw } from 'lucide-react';
import { Button, useConfirm } from '@/components/common';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import { BrandLoader } from '@/components/brand/BrandLoader';
import { IllustratedEmpty } from '@/components/brand/IllustratedEmpty';
import { toast } from '@/lib/toast';
import {
  getFormularioPorId,
  listVersiones,
  restaurarVersion,
  type FormularioVersionRow,
} from '@/services/api/formularios-admin';
import type { FormularioRow, FormularioSchemaDef } from '@/services/api/formularios';

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
        <ul className="space-y-3">
          {versiones.map((v, i) => {
            const stats = contarCampos(v.schema);
            return (
              <li
                key={v.id}
                className="card-premium relative overflow-hidden p-4 motion-safe:animate-fade-up"
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
      )}
    </div>
  );
}
