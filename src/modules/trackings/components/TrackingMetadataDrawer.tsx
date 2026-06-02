// ============================================================================
// TrackingMetadataDrawer · DEEP-1
//
// Drawer lateral para editar la metadata del trámite/tracking DESPUÉS del alta.
// Antes (DGG-33) algunos campos quedaban congelados post-creación porque sólo
// el `TramiteFormDrawer` (alta) los seteaba. Este drawer cubre el GAP:
// titulo, descripcion, categoria, prioridad, vence_at, administracion +
// consorcio dependiente, comprobante (opcional) y datos del solicitante.
//
// Regla 1 (persistencia): toda mutación va por `updateTramite` (services/api).
// Regla 4: NUNCA `supabase.from()` desde el componente.
// Regla 13: al cerrar con cambios sin guardar → `useConfirm` (no window.confirm).
// ============================================================================
import { useEffect, useMemo, useState } from 'react';
import { Briefcase, Save } from 'lucide-react';
import {
  Drawer,
  Button,
  Field,
  Input,
  Select,
  Textarea,
  useConfirm,
} from '@/components/common';
import { toast } from '@/lib/toast';
import { humanizeError } from '@/lib/errors';
import {
  updateTramite,
  TRAMITE_CATEGORIAS,
  TRAMITE_CATEGORIA_LABEL,
  TRAMITE_PRIORIDADES,
  TRAMITE_PRIORIDAD_LABEL,
  type TramiteCategoria,
  type TramitePrioridad,
  type UpdateTramitePatch,
} from '@/services/api/tramites';
import {
  listAdministraciones,
  type AdministracionListItem,
} from '@/services/api/administraciones';
import {
  listConsorciosByAdministracion,
  type ConsorcioRow,
} from '@/services/api/consorcios';
import type { TrackingDetail } from '@/services/api/trackings';

interface Props {
  open: boolean;
  tracking: TrackingDetail;
  onClose: () => void;
  onSaved: () => void;
}

// FormState refleja exactamente los campos editables. Mantenemos strings vacíos
// en lugar de null para que los <input> queden controlados sin warnings.
interface FormState {
  titulo: string;
  descripcion: string;
  categoria: TramiteCategoria;
  prioridad: TramitePrioridad;
  vence_at: string; // YYYY-MM-DD (input type=date)
  administracion_id: string; // '' = sin asociar
  consorcio_id: string; // '' = sin asociar
  solicitante_nombre: string;
  solicitante_email: string;
  solicitante_telefono: string;
}

// Helpers ------------------------------------------------------------------

// Trim opcional → null cuando el string queda vacío. Sirve para persistir
// "ningún valor" en columnas nullable sin enviar el string vacío.
function trimOrNull(v: string): string | null {
  const t = v.trim();
  return t.length > 0 ? t : null;
}

// El input type="date" exige "YYYY-MM-DD"; del backend nos llega ISO completo
// (vence_at es timestamptz). Cortamos la parte fecha sin convertir tz para no
// adelantar/atrasar un día por el offset local.
function isoToDateInput(iso: string | null): string {
  if (!iso) return '';
  return iso.slice(0, 10);
}

function dateInputToIso(d: string): string | null {
  return d ? new Date(d).toISOString() : null;
}

function buildInitial(t: TrackingDetail): FormState {
  return {
    titulo: t.titulo ?? '',
    descripcion: t.descripcion ?? '',
    categoria: (t.categoria as TramiteCategoria) ?? 'otro',
    prioridad: (t.prioridad as TramitePrioridad) ?? 'normal',
    vence_at: isoToDateInput(t.vence_at),
    administracion_id: t.administracion_id ?? '',
    consorcio_id: t.consorcio_id ?? '',
    solicitante_nombre: t.solicitante_nombre ?? '',
    solicitante_email: t.solicitante_email ?? '',
    solicitante_telefono: t.solicitante_telefono ?? '',
  };
}

// --------------------------------------------------------------------------

export function TrackingMetadataDrawer({
  open,
  tracking,
  onClose,
  onSaved,
}: Props) {
  const confirm = useConfirm();
  const [form, setForm] = useState<FormState>(() => buildInitial(tracking));
  const [initial, setInitial] = useState<FormState>(() => buildInitial(tracking));
  const [admins, setAdmins] = useState<AdministracionListItem[]>([]);
  const [consorcios, setConsorcios] = useState<ConsorcioRow[]>([]);
  const [loadingAdmins, setLoadingAdmins] = useState(false);
  const [loadingConsorcios, setLoadingConsorcios] = useState(false);
  const [saving, setSaving] = useState(false);

  // Reset on (re)open con datos frescos del tracking — si el usuario abrió,
  // editó, cerró sin guardar y volvió a abrir, no queremos arrastrar el draft.
  useEffect(() => {
    if (!open) return;
    const next = buildInitial(tracking);
    setForm(next);
    setInitial(next);
  }, [open, tracking.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cargar administraciones al abrir. Usamos limit alto para que el selector
  // pueda mostrar todas (no hay paginación dentro del drawer).
  useEffect(() => {
    if (!open) return;
    setLoadingAdmins(true);
    void (async () => {
      const res = await listAdministraciones({ limit: 500 });
      setLoadingAdmins(false);
      if (res.ok) setAdmins(res.data.rows);
    })();
  }, [open]);

  // Cargar consorcios cuando cambia la administración. Si no hay admin elegida
  // dejamos el select de consorcios vacío (no tiene sentido elegir consorcio
  // huérfano). Si la admin cambia, limpiamos consorcio_id para no quedar con
  // un consorcio que ya no pertenece a la admin nueva.
  useEffect(() => {
    if (!open) return;
    if (!form.administracion_id) {
      setConsorcios([]);
      return;
    }
    setLoadingConsorcios(true);
    void (async () => {
      const res = await listConsorciosByAdministracion(form.administracion_id, true);
      setLoadingConsorcios(false);
      if (res.ok) setConsorcios(res.data);
    })();
  }, [open, form.administracion_id]);

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => {
      // Al cambiar de administración limpiamos el consorcio elegido para no
      // dejar un consorcio que pertenece a otra admin.
      if (key === 'administracion_id') {
        return { ...f, administracion_id: value as string, consorcio_id: '' };
      }
      return { ...f, [key]: value };
    });
  }

  // Detectamos dirty comparando contra el snapshot inicial. Sirve para el
  // confirm al cerrar y para deshabilitar "Guardar" cuando no hay cambios.
  const dirty = useMemo(() => {
    return (Object.keys(form) as (keyof FormState)[]).some(
      (k) => form[k] !== initial[k],
    );
  }, [form, initial]);

  async function handleClose() {
    if (!dirty) {
      onClose();
      return;
    }
    const ok = await confirm({
      title: 'Descartar cambios',
      message:
        'Hay cambios sin guardar en la metadata del trámite. ¿Querés descartarlos?',
      confirmLabel: 'Descartar',
      cancelLabel: 'Seguir editando',
      danger: true,
    });
    if (ok) onClose();
  }

  // Construye el patch SOLO con los campos modificados — evita writes ruidosos
  // y deja `updated_at` actualizado únicamente cuando algo realmente cambia.
  function buildPatch(): UpdateTramitePatch {
    const patch: UpdateTramitePatch = {};
    if (form.titulo !== initial.titulo) {
      patch.titulo = form.titulo.trim();
    }
    if (form.descripcion !== initial.descripcion) {
      patch.descripcion = trimOrNull(form.descripcion);
    }
    if (form.categoria !== initial.categoria) {
      patch.categoria = form.categoria;
    }
    if (form.prioridad !== initial.prioridad) {
      patch.prioridad = form.prioridad;
    }
    if (form.vence_at !== initial.vence_at) {
      patch.vence_at = dateInputToIso(form.vence_at);
    }
    if (form.administracion_id !== initial.administracion_id) {
      patch.administracion_id = form.administracion_id || null;
    }
    if (form.consorcio_id !== initial.consorcio_id) {
      patch.consorcio_id = form.consorcio_id || null;
    }
    if (form.solicitante_nombre !== initial.solicitante_nombre) {
      patch.solicitante_nombre = trimOrNull(form.solicitante_nombre);
    }
    if (form.solicitante_email !== initial.solicitante_email) {
      patch.solicitante_email = trimOrNull(form.solicitante_email);
    }
    if (form.solicitante_telefono !== initial.solicitante_telefono) {
      patch.solicitante_telefono = trimOrNull(form.solicitante_telefono);
    }
    return patch;
  }

  async function handleSave() {
    if (!form.titulo.trim()) {
      toast.error('El título es obligatorio');
      return;
    }
    const patch = buildPatch();
    if (Object.keys(patch).length === 0) {
      toast.info('No hay cambios para guardar');
      return;
    }
    setSaving(true);
    const res = await updateTramite(tracking.id, patch);
    setSaving(false);
    if (!res.ok) {
      toast.error('No pudimos actualizar el trámite', {
        description: humanizeError(res.error),
      });
      return;
    }
    toast.success('Trámite actualizado');
    onSaved();
  }

  return (
    <Drawer
      open={open}
      onClose={handleClose}
      title="Editar metadata"
      kicker="Trámite"
      description="Cambios sobre datos generales — los avances de cada línea se editan desde la timeline."
      icon={<Briefcase size={18} />}
      width={640}
      footer={
        <div className="flex w-full items-center justify-end gap-2">
          <Button variant="secondary" onClick={handleClose} disabled={saving}>
            Cancelar
          </Button>
          <Button
            onClick={() => void handleSave()}
            loading={saving}
            disabled={saving || !dirty}
          >
            <Save size={15} /> Guardar cambios
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <Field label="Título" required>
          <Input
            value={form.titulo}
            onChange={(e) => setField('titulo', e.target.value)}
            placeholder="Renovación de matrícula RPAC"
            autoFocus
          />
        </Field>

        <Field label="Descripción">
          <Textarea
            value={form.descripcion}
            onChange={(e) => setField('descripcion', e.target.value)}
            placeholder="Contexto del trámite, observaciones del cliente…"
            rows={4}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Categoría" required>
            <Select
              value={form.categoria}
              onChange={(e) =>
                setField('categoria', e.target.value as TramiteCategoria)
              }
            >
              {TRAMITE_CATEGORIAS.map((c) => (
                <option key={c} value={c}>
                  {TRAMITE_CATEGORIA_LABEL[c]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Prioridad">
            <Select
              value={form.prioridad}
              onChange={(e) =>
                setField('prioridad', e.target.value as TramitePrioridad)
              }
            >
              {TRAMITE_PRIORIDADES.map((p) => (
                <option key={p} value={p}>
                  {TRAMITE_PRIORIDAD_LABEL[p]}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label="Vence el (opcional)">
          <Input
            type="date"
            value={form.vence_at}
            onChange={(e) => setField('vence_at', e.target.value)}
          />
        </Field>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field
            label="Administración"
            hint={loadingAdmins ? 'Cargando…' : undefined}
          >
            <Select
              value={form.administracion_id}
              onChange={(e) => setField('administracion_id', e.target.value)}
              disabled={loadingAdmins}
            >
              <option value="">— Sin asociar —</option>
              {admins.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.nombre}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Consorcio"
            hint={
              !form.administracion_id
                ? 'Elegí primero una administración'
                : loadingConsorcios
                  ? 'Cargando…'
                  : consorcios.length === 0
                    ? 'Sin consorcios cargados'
                    : undefined
            }
          >
            <Select
              value={form.consorcio_id}
              onChange={(e) => setField('consorcio_id', e.target.value)}
              disabled={
                !form.administracion_id ||
                loadingConsorcios ||
                consorcios.length === 0
              }
            >
              <option value="">— Sin asociar —</option>
              {consorcios.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="rounded-lg border border-slate-200 bg-brand-zebra/40 p-3">
          <p className="mb-2 text-xs font-medium text-brand-ink">
            Datos del solicitante
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Nombre">
              <Input
                value={form.solicitante_nombre}
                onChange={(e) =>
                  setField('solicitante_nombre', e.target.value)
                }
                placeholder="Diego García"
              />
            </Field>
            <Field label="Email">
              <Input
                type="email"
                value={form.solicitante_email}
                onChange={(e) =>
                  setField('solicitante_email', e.target.value)
                }
                placeholder="diego@correo.com"
              />
            </Field>
            <Field label="Teléfono" className="sm:col-span-2">
              <Input
                value={form.solicitante_telefono}
                onChange={(e) =>
                  setField('solicitante_telefono', e.target.value)
                }
                placeholder="+54 11 5555-1234"
              />
            </Field>
          </div>
        </div>
      </div>
    </Drawer>
  );
}
