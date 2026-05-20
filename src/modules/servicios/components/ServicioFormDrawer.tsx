import { useEffect, useState, type FormEvent } from 'react';
import { toast } from '@/lib/toast';
import { Briefcase, Save, Sparkles } from 'lucide-react';
import {
  Drawer,
  Button,
  Field,
  Input,
  Select,
  Textarea,
} from '@/components/common';
import {
  crearServicio,
  actualizarServicio,
  PRECIO_MODOS,
  PRECIO_MODO_LABEL,
  type PrecioModo,
  type ServicioRow,
  type CategoriaServicioRow,
} from '@/services/api/servicios';

interface ServicioFormDrawerProps {
  open: boolean;
  onClose: () => void;
  onSaved?: (servicio: ServicioRow) => void;
  categorias: CategoriaServicioRow[];
  servicio?: ServicioRow | null; // edición si viene
}

type Draft = {
  categoria_id: string;
  codigo: string;
  nombre: string;
  descripcion: string;
  precio_modo: PrecioModo;
  precio_inicial: string;
  iva_alicuota: string;
  requiere_administracion: boolean;
  requiere_consorcio: boolean;
  permite_multiples_consorcios: boolean;
  habilita_campus: boolean;
  campus_vigencia_meses: string;
  habilitado_formulario_publico: boolean;
  formulario_publico_slug: string;
  observaciones: string;
};

const EMPTY: Draft = {
  categoria_id: '',
  codigo: '',
  nombre: '',
  descripcion: '',
  precio_modo: 'fijo',
  precio_inicial: '',
  iva_alicuota: '21',
  requiere_administracion: true,
  requiere_consorcio: false,
  permite_multiples_consorcios: false,
  habilita_campus: false,
  campus_vigencia_meses: '',
  habilitado_formulario_publico: false,
  formulario_publico_slug: '',
  observaciones: '',
};

export function ServicioFormDrawer({
  open,
  onClose,
  onSaved,
  categorias,
  servicio,
}: ServicioFormDrawerProps) {
  const isEdit = Boolean(servicio?.id);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [errs, setErrs] = useState<Partial<Record<keyof Draft, string>>>({});

  useEffect(() => {
    if (!open) return;
    if (servicio) {
      setDraft({
        categoria_id: servicio.categoria_id,
        codigo: servicio.codigo,
        nombre: servicio.nombre,
        descripcion: servicio.descripcion ?? '',
        precio_modo: (servicio.precio_modo as PrecioModo) ?? 'fijo',
        precio_inicial: '',
        iva_alicuota: servicio.iva_alicuota,
        requiere_administracion: servicio.requiere_administracion,
        requiere_consorcio: servicio.requiere_consorcio,
        permite_multiples_consorcios: servicio.permite_multiples_consorcios,
        habilita_campus: servicio.habilita_campus,
        campus_vigencia_meses: servicio.campus_vigencia_meses?.toString() ?? '',
        habilitado_formulario_publico: servicio.habilitado_formulario_publico,
        formulario_publico_slug: servicio.formulario_publico_slug ?? '',
        observaciones: servicio.observaciones ?? '',
      });
    } else {
      setDraft({
        ...EMPTY,
        categoria_id: categorias[0]?.id ?? '',
      });
    }
    setErrs({});
  }, [open, servicio, categorias]);

  function validate(): boolean {
    const e: Partial<Record<keyof Draft, string>> = {};
    if (!draft.categoria_id) e.categoria_id = 'Elegí una categoría';
    if (!draft.codigo.trim()) e.codigo = 'Código requerido';
    if (!draft.nombre.trim()) e.nombre = 'Nombre requerido';
    if (!isEdit && draft.precio_inicial && Number(draft.precio_inicial) < 0) {
      e.precio_inicial = 'No puede ser negativo';
    }
    setErrs(e);
    return Object.keys(e).length === 0;
  }

  async function onSubmit(ev: FormEvent) {
    ev.preventDefault();
    if (!validate()) return;
    setSaving(true);

    const payload = {
      categoria_id: draft.categoria_id,
      codigo: draft.codigo.trim(),
      nombre: draft.nombre.trim(),
      descripcion: draft.descripcion.trim() || null,
      precio_modo: draft.precio_modo,
      iva_alicuota: draft.iva_alicuota,
      requiere_administracion: draft.requiere_administracion,
      requiere_consorcio: draft.requiere_consorcio,
      permite_multiples_consorcios: draft.permite_multiples_consorcios,
      habilita_campus: draft.habilita_campus,
      campus_vigencia_meses: draft.campus_vigencia_meses
        ? Number(draft.campus_vigencia_meses)
        : null,
      habilitado_formulario_publico: draft.habilitado_formulario_publico,
      formulario_publico_slug:
        draft.formulario_publico_slug.trim() || null,
      observaciones: draft.observaciones.trim() || null,
    };

    const res = isEdit
      ? await actualizarServicio(servicio!.id, payload)
      : await crearServicio({
          ...payload,
          precio_inicial: draft.precio_inicial
            ? Number(draft.precio_inicial)
            : undefined,
        });
    setSaving(false);

    if (!res.ok) {
      toast.error(`No pudimos guardar el servicio: ${res.error.message}`);
      return;
    }
    toast.success(isEdit ? 'Servicio actualizado.' : 'Servicio creado.');
    onSaved?.(res.data);
    onClose();
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={isEdit ? 'Editar servicio' : 'Nuevo servicio'}
      kicker="Catálogo"
      icon={<Briefcase size={18} />}
      width={680}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} type="button">
            Cancelar
          </Button>
          <Button
            type="submit"
            form="servicio-form"
            loading={saving}
          >
            <Save size={16} /> Guardar
          </Button>
        </>
      }
    >
      <form id="servicio-form" onSubmit={onSubmit} className="space-y-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Categoría" required error={errs.categoria_id}>
            <Select
              value={draft.categoria_id}
              onChange={(e) =>
                setDraft({ ...draft, categoria_id: e.target.value })
              }
            >
              <option value="" disabled>
                Elegí categoría…
              </option>
              {categorias.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Modalidad de precio" required>
            <Select
              value={draft.precio_modo}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  precio_modo: e.target.value as PrecioModo,
                })
              }
            >
              {PRECIO_MODOS.map((m) => (
                <option key={m} value={m}>
                  {PRECIO_MODO_LABEL[m]}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field
            label="Código"
            required
            error={errs.codigo}
            hint="Identificador único (slug)"
          >
            <Input
              value={draft.codigo}
              onChange={(e) =>
                setDraft({ ...draft, codigo: e.target.value })
              }
              placeholder="rpac_renovacion"
              disabled={isEdit}
            />
          </Field>
          <Field label="Nombre" required error={errs.nombre}>
            <Input
              value={draft.nombre}
              onChange={(e) => setDraft({ ...draft, nombre: e.target.value })}
              placeholder="Renovación de matrícula RPAC"
            />
          </Field>
        </div>

        <Field label="Descripción">
          <Textarea
            value={draft.descripcion}
            onChange={(e) =>
              setDraft({ ...draft, descripcion: e.target.value })
            }
            placeholder="Detalle público del servicio"
          />
        </Field>

        {!isEdit && (
          <div className="rounded-xl border border-brand-cyan/20 bg-brand-cyan-pale/30 p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-brand-ink">
              <Sparkles size={16} className="text-brand-cyan" /> Precio inicial
            </div>
            <Field
              label="Monto base (ARS)"
              hint="Crea la regla base del tabulador. Podés dejarlo vacío y cargarlo después."
              error={errs.precio_inicial}
            >
              <Input
                type="number"
                step="0.01"
                min="0"
                value={draft.precio_inicial}
                onChange={(e) =>
                  setDraft({ ...draft, precio_inicial: e.target.value })
                }
                placeholder="0,00"
              />
            </Field>
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Alícuota IVA">
            <Select
              value={draft.iva_alicuota}
              onChange={(e) =>
                setDraft({ ...draft, iva_alicuota: e.target.value })
              }
            >
              {['0', '10.5', '21', '27', 'exento', 'no_gravado'].map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Vigencia campus (meses)"
            hint="Sólo si habilita campus"
          >
            <Input
              type="number"
              min="1"
              value={draft.campus_vigencia_meses}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  campus_vigencia_meses: e.target.value,
                })
              }
              disabled={!draft.habilita_campus}
              placeholder="12"
            />
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {(
            [
              [
                'requiere_administracion',
                'Requiere administración',
              ],
              ['requiere_consorcio', 'Requiere consorcio'],
              [
                'permite_multiples_consorcios',
                'Permite múltiples consorcios',
              ],
              ['habilita_campus', 'Habilita campus'],
              [
                'habilitado_formulario_publico',
                'Formulario público',
              ],
            ] as Array<[keyof Draft, string]>
          ).map(([key, label]) => (
            <label
              key={key}
              className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-brand-ink"
            >
              <input
                type="checkbox"
                checked={Boolean(draft[key])}
                onChange={(e) =>
                  setDraft({ ...draft, [key]: e.target.checked } as Draft)
                }
                className="h-4 w-4 rounded border-slate-300 text-brand-cyan"
              />
              {label}
            </label>
          ))}
        </div>

        {draft.habilitado_formulario_publico && (
          <Field
            label="Slug del formulario público"
            hint="Ruta /formulario/:slug"
          >
            <Input
              value={draft.formulario_publico_slug}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  formulario_publico_slug: e.target.value,
                })
              }
              placeholder="rpac/renovacion"
            />
          </Field>
        )}

        <Field label="Observaciones internas">
          <Textarea
            value={draft.observaciones}
            onChange={(e) =>
              setDraft({ ...draft, observaciones: e.target.value })
            }
          />
        </Field>
      </form>
    </Drawer>
  );
}
