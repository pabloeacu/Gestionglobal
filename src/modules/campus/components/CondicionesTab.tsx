import { useEffect, useState } from 'react';
import { Award, GripVertical, Loader2, Lock, Plus, Save, Trash2 } from 'lucide-react';
import { Button, Input, Select, useConfirm } from '@/components/common';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/cn';
import {
  CONDICION_AUTOMATICA,
  CONDICION_TIPOS,
  CONDICION_TIPO_LABEL,
  guardarCondicionesConfig,
  listCondicionesConfig,
  type CondicionConfigInput,
  type CondicionTipo,
  type CursoDetalle,
} from '@/services/api/campus';
import { humanizeError } from '@/lib/errors';

type Draft = CondicionConfigInput & { _key: string };

// Tab "Condiciones del certificado" del editor. El instructor define qué exige
// el curso (DGG-10): examen (auto) / asistencia / pago / otra.
export function CondicionesTab({
  data,
}: {
  data: CursoDetalle;
}) {
  const confirm = useConfirm();
  const [items, setItems] = useState<Draft[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    const res = await listCondicionesConfig(data.curso.id);
    setLoading(false);
    if (!res.ok) {
      toast.error(humanizeError(res.error));
      return;
    }
    setItems(
      res.data
        // F10: las condiciones de 'asistencia' (módulos sincrónicos) se administran
        // en la pestaña Encuentros (con su modalidad + docente + fechas), no acá.
        .filter((c) => c.tipo !== 'asistencia')
        .map((c) => ({
        _key: c.id,
        id: c.id,
        tipo: c.tipo as CondicionTipo,
        etiqueta: c.etiqueta,
        examen_id: c.examen_id,
        obligatoria: c.obligatoria,
        activa: c.activa,
        orden: c.orden,
      })),
    );
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.curso.id]);

  function add(tipo: CondicionTipo) {
    setItems((prev) => [
      ...prev,
      {
        _key: `new-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        tipo,
        etiqueta: CONDICION_TIPO_LABEL[tipo],
        examen_id: null,
        obligatoria: true,
        activa: true,
      },
    ]);
  }

  function patch(key: string, p: Partial<Draft>) {
    setItems((prev) => prev.map((it) => (it._key === key ? { ...it, ...p } : it)));
  }

  async function remove(key: string) {
    const it = items.find((i) => i._key === key);
    if (it?.id) {
      const ok = await confirm({
        title: 'Quitar condición',
        message:
          'Si ya hay alumnos asignados, también se quita de sus checklists. ¿Confirmás?',
        confirmLabel: 'Quitar',
        danger: true,
      });
      if (!ok) return;
    }
    setItems((prev) => prev.filter((i) => i._key !== key));
  }

  async function guardar() {
    // Validación: etiqueta no vacía.
    if (items.some((i) => !i.etiqueta.trim())) {
      toast.error('Cada condición necesita una etiqueta.');
      return;
    }
    setSaving(true);
    const res = await guardarCondicionesConfig(
      data.curso.id,
      items.map((i) => ({
        id: i.id,
        tipo: i.tipo,
        etiqueta: i.etiqueta.trim(),
        examen_id: i.tipo === 'examen' ? i.examen_id ?? null : null,
        obligatoria: i.obligatoria,
        activa: i.activa,
      })),
    );
    setSaving(false);
    if (!res.ok) {
      toast.error(humanizeError(res.error));
      return;
    }
    toast.success('Condiciones guardadas');
    void load();
  }

  if (loading) {
    return (
      <div className="grid h-40 place-items-center text-brand-muted">
        <Loader2 size={18} className="animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="card-premium p-5">
        <header className="mb-1 flex items-center gap-2">
          <Award size={16} className="text-brand-cyan" />
          <h2 className="font-display text-lg font-semibold text-brand-ink">
            Condiciones del certificado
          </h2>
        </header>
        <p className="mb-4 text-sm text-brand-muted">
          Definí qué tiene que cumplir el alumno para recibir el certificado. La
          condición de examen se acredita sola al aprobar; el resto las tildás
          vos en la pestaña de gestión.
        </p>
        <p className="mb-4 -mt-2 rounded-lg bg-brand-cyan/5 px-3 py-2 text-xs text-brand-muted">
          La <strong className="text-brand-ink">asistencia a encuentros</strong> se
          configura en la pestaña <strong className="text-brand-ink">Encuentros</strong>{' '}
          (cada módulo sincrónico con su modalidad —único / alternativas / serie— y su
          docente); aparece sola como condición del certificado.
        </p>

        {items.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-brand-muted">
            Este curso todavía no exige condiciones. Sumá la primera abajo.
          </div>
        ) : (
          <ul className="space-y-2">
            {items.map((it) => {
              const auto = CONDICION_AUTOMATICA[it.tipo];
              return (
                <li
                  key={it._key}
                  className={cn(
                    'rounded-xl border bg-white p-3 transition',
                    it.activa
                      ? 'border-slate-200'
                      : 'border-slate-200 bg-slate-50 opacity-70',
                  )}
                >
                  <div className="flex flex-wrap items-start gap-2">
                    <GripVertical
                      size={16}
                      className="mt-2 shrink-0 text-slate-300"
                    />
                    <div className="min-w-[140px]">
                      <Select
                        value={it.tipo}
                        onChange={(e) =>
                          patch(it._key, {
                            tipo: e.target.value as CondicionTipo,
                            etiqueta:
                              CONDICION_TIPO_LABEL[e.target.value as CondicionTipo],
                          })
                        }
                      >
                        {CONDICION_TIPOS.filter((t) => t !== 'asistencia').map((t) => (
                          <option key={t} value={t}>
                            {CONDICION_TIPO_LABEL[t]}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <div className="flex-1 min-w-[180px]">
                      <Input
                        value={it.etiqueta}
                        onChange={(e) =>
                          patch(it._key, { etiqueta: e.target.value })
                        }
                        placeholder="Texto que ve el alumno"
                      />
                    </div>
                    {it.tipo === 'examen' && (
                      <div className="min-w-[180px]">
                        <Select
                          value={it.examen_id ?? ''}
                          onChange={(e) =>
                            patch(it._key, { examen_id: e.target.value || null })
                          }
                        >
                          <option value="">Cualquier examen del curso</option>
                          {data.examenes.map((ex) => (
                            <option key={ex.id} value={ex.id}>
                              {ex.titulo}
                            </option>
                          ))}
                        </Select>
                      </div>
                    )}
                    <button
                      onClick={() => void remove(it._key)}
                      className="rounded-md p-2 text-brand-muted transition hover:bg-red-50 hover:text-red-600"
                      title="Quitar condición"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-4 pl-7 text-xs">
                    {auto ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-brand-cyan/10 px-2 py-0.5 font-semibold text-brand-cyan">
                        <Lock size={11} /> Automática (al aprobar)
                      </span>
                    ) : (
                      <span className="text-brand-muted">Tilde manual de gerencia</span>
                    )}
                    <label className="inline-flex items-center gap-1.5 text-brand-muted">
                      <input
                        type="checkbox"
                        checked={it.activa ?? true}
                        onChange={(e) =>
                          patch(it._key, { activa: e.target.checked })
                        }
                        className="accent-brand-cyan"
                      />
                      Activa
                    </label>
                    <label className="inline-flex items-center gap-1.5 text-brand-muted">
                      <input
                        type="checkbox"
                        checked={it.obligatoria ?? true}
                        onChange={(e) =>
                          patch(it._key, { obligatoria: e.target.checked })
                        }
                        className="accent-brand-cyan"
                      />
                      Obligatoria
                    </label>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {CONDICION_TIPOS.filter((t) => t !== 'asistencia').map((t) => (
            <Button
              key={t}
              variant="secondary"
              className="!px-2.5 !py-1.5 text-xs"
              onClick={() => add(t)}
            >
              <Plus size={13} /> {CONDICION_TIPO_LABEL[t]}
            </Button>
          ))}
        </div>

        <div className="mt-5 flex justify-end">
          <Button onClick={guardar} loading={saving}>
            <Save size={14} /> Guardar condiciones
          </Button>
        </div>
      </div>
    </div>
  );
}
