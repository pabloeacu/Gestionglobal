import { useEffect, useState, type FormEvent } from 'react';
import { toast } from '@/lib/toast';
import { Building, Save, Loader2, Info } from 'lucide-react';
import { Drawer, Button, Field, Input, Select, Textarea } from '@/components/common';
import {
  createConsorcio,
  updateConsorcio,
  type ConsorcioRow,
} from '@/services/api/consorcios';

interface ConsorcioFormDrawerProps {
  open: boolean;
  onClose: () => void;
  administracionId: string;
  editing?: ConsorcioRow | null;
  onSaved?: (row: ConsorcioRow) => void;
}

type FormState = {
  codigo: string;
  nombre: string;
  unidades_funcionales: string;
  cocheras: string;
  bauleras: string;
  empleados: string;
  tipo_documento: '' | 'cuit' | 'dni_ficticio';
  numero_documento: string;
  condicion_iva: 'consumidor_final' | 'responsable_inscripto';
  domicilio: string;
  localidad: string;
  provincia: string;
  codigo_postal: string;
  monto_abono: string;
  facturar_con_cuit_administracion: boolean;
  observaciones: string;
};

const EMPTY: FormState = {
  codigo: '',
  nombre: '',
  unidades_funcionales: '0',
  cocheras: '0',
  bauleras: '0',
  empleados: '0',
  tipo_documento: '',
  numero_documento: '',
  condicion_iva: 'consumidor_final',
  domicilio: '',
  localidad: '',
  provincia: '',
  codigo_postal: '',
  monto_abono: '0',
  facturar_con_cuit_administracion: false,
  observaciones: '',
};

function rowToForm(r: ConsorcioRow): FormState {
  return {
    codigo: r.codigo,
    nombre: r.nombre,
    unidades_funcionales: String(r.unidades_funcionales),
    cocheras: String(r.cocheras),
    bauleras: String(r.bauleras),
    empleados: String(r.empleados),
    tipo_documento: r.tipo_documento as FormState['tipo_documento'],
    numero_documento: r.numero_documento,
    condicion_iva: r.condicion_iva as FormState['condicion_iva'],
    domicilio: r.domicilio ?? '',
    localidad: r.localidad ?? '',
    provincia: r.provincia ?? '',
    codigo_postal: r.codigo_postal ?? '',
    monto_abono: String(r.monto_abono),
    facturar_con_cuit_administracion: r.facturar_con_cuit_administracion,
    observaciones: r.observaciones ?? '',
  };
}

export function ConsorcioFormDrawer({
  open,
  onClose,
  administracionId,
  editing,
  onSaved,
}: ConsorcioFormDrawerProps) {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});

  useEffect(() => {
    if (open) {
      setForm(editing ? rowToForm(editing) : EMPTY);
      setErrors({});
    }
  }, [open, editing?.id]);

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }));
  }

  function validate(): boolean {
    const e: Partial<Record<keyof FormState, string>> = {};
    if (!form.codigo.trim()) e.codigo = 'Requerido';
    if (!form.nombre.trim()) e.nombre = 'Requerido';
    if (form.tipo_documento === 'cuit') {
      if (!/^\d{11}$/.test(form.numero_documento)) {
        e.numero_documento = 'El CUIT debe tener 11 dígitos';
      }
    } else if (form.tipo_documento === 'dni_ficticio') {
      if (!/^\d{7,8}$/.test(form.numero_documento)) {
        e.numero_documento = 'DNI ficticio: 7 u 8 dígitos';
      }
    }
    const n = (s: string) => Number(s.replace(',', '.'));
    if (Number.isNaN(n(form.monto_abono)) || n(form.monto_abono) < 0)
      e.monto_abono = 'Inválido';
    if (n(form.unidades_funcionales) < 0)
      e.unidades_funcionales = 'No puede ser negativo';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function onSubmit(ev: FormEvent) {
    ev.preventDefault();
    if (!validate()) return;
    setSaving(true);
    const n = (s: string) => Number(s.replace(',', '.'));
    const base = {
      codigo: form.codigo.trim(),
      nombre: form.nombre.trim(),
      unidades_funcionales: Math.max(0, Math.floor(n(form.unidades_funcionales))),
      cocheras: Math.max(0, Math.floor(n(form.cocheras))),
      bauleras: Math.max(0, Math.floor(n(form.bauleras))),
      empleados: Math.max(0, Math.floor(n(form.empleados))),
      condicion_iva: form.condicion_iva,
      domicilio: form.domicilio.trim() || null,
      localidad: form.localidad.trim() || null,
      provincia: form.provincia.trim() || null,
      codigo_postal: form.codigo_postal.trim() || null,
      monto_abono: n(form.monto_abono),
      facturar_con_cuit_administracion: form.facturar_con_cuit_administracion,
      observaciones: form.observaciones.trim() || null,
    };
    const docFields =
      form.tipo_documento && form.numero_documento
        ? { tipo_documento: form.tipo_documento, numero_documento: form.numero_documento }
        : {};
    const res = editing
      ? await updateConsorcio(editing.id, { ...base, ...docFields })
      : await createConsorcio({
          administracion_id: administracionId,
          ...base,
          ...docFields,
        });
    setSaving(false);

    if (!res.ok) {
      toast.error(
        editing
          ? `No pudimos actualizar el consorcio: ${res.error.message}`
          : `No pudimos crear el consorcio: ${res.error.message}`,
      );
      return;
    }
    toast.success(editing ? 'Consorcio actualizado' : 'Consorcio creado');
    onSaved?.(res.data);
    onClose();
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={680}
      kicker={editing ? 'Editar' : 'Nuevo consorcio'}
      title={editing ? editing.nombre : 'Alta de consorcio'}
      description="Si no cargás CUIT propio, el sistema asigna un DNI ficticio secuencial (D07) para que ARCA acepte el receptor."
      icon={<Building size={20} />}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button type="submit" form="cons-form" loading={saving}>
            <Save size={15} /> Guardar
          </Button>
        </>
      }
    >
      <form id="cons-form" onSubmit={onSubmit} className="space-y-7">
        <fieldset className="space-y-4">
          <p className="kicker text-brand-cyan">Identificación</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Código" required error={errors.codigo}>
              <Input
                value={form.codigo}
                onChange={(e) => setField('codigo', e.target.value)}
                placeholder="C-001"
                required
              />
            </Field>
            <Field label="Nombre" required error={errors.nombre}>
              <Input
                value={form.nombre}
                onChange={(e) => setField('nombre', e.target.value)}
                placeholder="Edificio Las Lomas"
                required
              />
            </Field>
          </div>
        </fieldset>

        <fieldset className="space-y-4">
          <p className="kicker text-brand-cyan">Composición</p>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Field label="Unidades funcionales" error={errors.unidades_funcionales}>
              <Input
                type="number"
                min="0"
                value={form.unidades_funcionales}
                onChange={(e) => setField('unidades_funcionales', e.target.value)}
              />
            </Field>
            <Field label="Cocheras">
              <Input
                type="number"
                min="0"
                value={form.cocheras}
                onChange={(e) => setField('cocheras', e.target.value)}
              />
            </Field>
            <Field label="Bauleras">
              <Input
                type="number"
                min="0"
                value={form.bauleras}
                onChange={(e) => setField('bauleras', e.target.value)}
              />
            </Field>
            <Field label="Empleados">
              <Input
                type="number"
                min="0"
                value={form.empleados}
                onChange={(e) => setField('empleados', e.target.value)}
              />
            </Field>
          </div>
        </fieldset>

        <fieldset className="space-y-4">
          <p className="kicker text-brand-cyan">Documento fiscal</p>
          <div className="rounded-lg border border-brand-cyan-pale/50 bg-brand-cyan-pale/10 p-3 text-xs leading-relaxed text-brand-ink/80">
            <Info size={13} className="mr-1 inline text-brand-cyan" />
            Si dejás los campos vacíos, el sistema le asigna automáticamente un
            <strong> DNI ficticio</strong> secuencial (rango 99000001+) para
            ARCA. Cargá CUIT solo si el consorcio tiene CUIT propio.
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Tipo de documento">
              <Select
                value={form.tipo_documento}
                onChange={(e) =>
                  setField('tipo_documento', e.target.value as FormState['tipo_documento'])
                }
                disabled={!!editing}
              >
                <option value="">— Asignar DNI ficticio automático —</option>
                <option value="cuit">CUIT propio</option>
                <option value="dni_ficticio">DNI ficticio (manual)</option>
              </Select>
            </Field>
            <Field label="Número de documento" error={errors.numero_documento}>
              <Input
                value={form.numero_documento}
                onChange={(e) =>
                  setField(
                    'numero_documento',
                    e.target.value.replace(/\D/g, '').slice(0, 11),
                  )
                }
                placeholder={form.tipo_documento === 'cuit' ? '30712345678' : ''}
                disabled={!form.tipo_documento || !!editing}
              />
            </Field>
          </div>
          <Field label="Condición frente a IVA">
            <Select
              value={form.condicion_iva}
              onChange={(e) =>
                setField('condicion_iva', e.target.value as FormState['condicion_iva'])
              }
            >
              <option value="consumidor_final">Consumidor final</option>
              <option value="responsable_inscripto">Responsable inscripto</option>
            </Select>
          </Field>
        </fieldset>

        <fieldset className="space-y-4">
          <p className="kicker text-brand-cyan">Domicilio</p>
          <Field label="Dirección">
            <Input
              value={form.domicilio}
              onChange={(e) => setField('domicilio', e.target.value)}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Localidad">
              <Input
                value={form.localidad}
                onChange={(e) => setField('localidad', e.target.value)}
              />
            </Field>
            <Field label="Provincia">
              <Input
                value={form.provincia}
                onChange={(e) => setField('provincia', e.target.value)}
              />
            </Field>
            <Field label="CP">
              <Input
                value={form.codigo_postal}
                onChange={(e) => setField('codigo_postal', e.target.value)}
              />
            </Field>
          </div>
        </fieldset>

        <fieldset className="space-y-4">
          <p className="kicker text-brand-cyan">Facturación</p>
          <Field label="Monto de abono mensual" hint="ARS, sin IVA" error={errors.monto_abono}>
            <Input
              inputMode="decimal"
              value={form.monto_abono}
              onChange={(e) => setField('monto_abono', e.target.value)}
            />
          </Field>
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 p-3 hover:border-brand-cyan/50">
            <input
              type="checkbox"
              checked={form.facturar_con_cuit_administracion}
              onChange={(e) =>
                setField('facturar_con_cuit_administracion', e.target.checked)
              }
              className="mt-0.5 accent-brand-cyan"
            />
            <span className="text-sm text-brand-ink">
              Facturar con los datos de la <strong>administración</strong>
              <span className="block text-xs text-brand-muted">
                Por defecto, los comprobantes salen con el receptor del
                consorcio. Activá esto si querés que el comprobante traiga el
                CUIT/razón social del administrador.
              </span>
            </span>
          </label>
          <Field label="Observaciones">
            <Textarea
              rows={3}
              value={form.observaciones}
              onChange={(e) => setField('observaciones', e.target.value)}
            />
          </Field>
        </fieldset>

        {saving && (
          <p className="flex items-center gap-2 text-xs text-brand-muted">
            <Loader2 size={14} className="animate-spin" /> Guardando…
          </p>
        )}
      </form>
    </Drawer>
  );
}
