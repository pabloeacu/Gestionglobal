import { useEffect, useState, type FormEvent } from 'react';
import { toast } from '@/lib/toast';
import { Building2, Loader2, Save } from 'lucide-react';
import { Drawer, Button, Field, Input, Select, Textarea } from '@/components/common';
import {
  createAdministracion,
  updateAdministracion,
  type AdministracionRow,
} from '@/services/api/administraciones';

interface AdministracionFormDrawerProps {
  open: boolean;
  onClose: () => void;
  /** Si viene, es edición; sino, alta. */
  editing?: AdministracionRow | null;
  onSaved?: (row: AdministracionRow) => void;
}

type FormState = {
  codigo: string;
  nombre: string;
  responsable_nombre: string;
  responsable_apellido: string;
  cuit: string;
  condicion_iva: '' | 'consumidor_final' | 'responsable_inscripto' | 'monotributo' | 'exento';
  domicilio_fiscal: string;
  direccion: string;
  localidad: string;
  provincia: string;
  codigo_postal: string;
  telefono: string;
  whatsapp: string;
  email: string;
  matricula_rpac: string;
  matricula_rpac_fecha: string;
  matricula_rpac_vencimiento: string;
  matricula_rpa: string;
  origen: string;
  convenio: string;
  estado: 'prospecto' | 'activo' | 'suspendido' | 'baja';
  observaciones: string;
};

const EMPTY: FormState = {
  codigo: '',
  nombre: '',
  responsable_nombre: '',
  responsable_apellido: '',
  cuit: '',
  condicion_iva: '',
  domicilio_fiscal: '',
  direccion: '',
  localidad: '',
  provincia: '',
  codigo_postal: '',
  telefono: '',
  whatsapp: '',
  email: '',
  matricula_rpac: '',
  matricula_rpac_fecha: '',
  matricula_rpac_vencimiento: '',
  matricula_rpa: '',
  origen: '',
  convenio: '',
  estado: 'activo',
  observaciones: '',
};

function rowToForm(r: AdministracionRow): FormState {
  return {
    codigo: r.codigo,
    nombre: r.nombre,
    responsable_nombre: r.responsable_nombre ?? '',
    responsable_apellido: r.responsable_apellido ?? '',
    cuit: r.cuit ?? '',
    condicion_iva: (r.condicion_iva as FormState['condicion_iva']) ?? '',
    domicilio_fiscal: r.domicilio_fiscal ?? '',
    direccion: r.direccion ?? '',
    localidad: r.localidad ?? '',
    provincia: r.provincia ?? '',
    codigo_postal: r.codigo_postal ?? '',
    telefono: r.telefono ?? '',
    whatsapp: r.whatsapp ?? '',
    email: r.email ?? '',
    matricula_rpac: r.matricula_rpac ?? '',
    matricula_rpac_fecha: r.matricula_rpac_fecha ?? '',
    matricula_rpac_vencimiento: r.matricula_rpac_vencimiento ?? '',
    matricula_rpa: r.matricula_rpa ?? '',
    origen: r.origen ?? '',
    convenio: r.convenio ?? '',
    estado: r.estado as FormState['estado'],
    observaciones: r.observaciones ?? '',
  };
}

export function AdministracionFormDrawer({
  open,
  onClose,
  editing,
  onSaved,
}: AdministracionFormDrawerProps) {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});

  // P-FE-02: resetear form local on-open
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
    if (form.cuit && !/^\d{11}$/.test(form.cuit)) e.cuit = 'Debe tener 11 dígitos numéricos';
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) e.email = 'Email inválido';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function onSubmit(ev: FormEvent) {
    ev.preventDefault();
    if (!validate()) return;
    setSaving(true);
    const payload = {
      codigo: form.codigo.trim(),
      nombre: form.nombre.trim(),
      responsable_nombre: form.responsable_nombre.trim() || null,
      responsable_apellido: form.responsable_apellido.trim() || null,
      cuit: form.cuit.trim() || null,
      condicion_iva: form.condicion_iva || null,
      domicilio_fiscal: form.domicilio_fiscal.trim() || null,
      direccion: form.direccion.trim() || null,
      localidad: form.localidad.trim() || null,
      provincia: form.provincia.trim() || null,
      codigo_postal: form.codigo_postal.trim() || null,
      telefono: form.telefono.trim() || null,
      whatsapp: form.whatsapp.trim() || null,
      email: form.email.trim() || null,
      matricula_rpac: form.matricula_rpac.trim() || null,
      matricula_rpac_fecha: form.matricula_rpac_fecha || null,
      matricula_rpac_vencimiento: form.matricula_rpac_vencimiento || null,
      matricula_rpa: form.matricula_rpa.trim() || null,
      origen: form.origen.trim() || null,
      convenio: form.convenio.trim() || null,
      estado: form.estado,
      observaciones: form.observaciones.trim() || null,
    };

    const res = editing
      ? await updateAdministracion(editing.id, payload)
      : await createAdministracion(payload);
    setSaving(false);

    if (!res.ok) {
      toast.error(
        editing
          ? `No pudimos actualizar la administración: ${res.error.message}`
          : `No pudimos crear la administración: ${res.error.message}`,
      );
      return;
    }
    toast.success(
      editing ? 'Administración actualizada' : 'Administración creada',
    );
    onSaved?.(res.data);
    onClose();
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={720}
      kicker={editing ? 'Editar' : 'Nueva administración'}
      title={editing ? editing.nombre : 'Alta de administración'}
      description="Datos comerciales, fiscales y registrales. Podés completar la matrícula RPAC y los emails después."
      icon={<Building2 size={20} />}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button type="submit" form="admin-form" loading={saving}>
            <Save size={15} /> Guardar
          </Button>
        </>
      }
    >
      <form id="admin-form" onSubmit={onSubmit} className="space-y-7">
        <fieldset className="space-y-4">
          <p className="kicker text-brand-cyan">Identificación</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Código interno" required error={errors.codigo}>
              <Input
                value={form.codigo}
                onChange={(e) => setField('codigo', e.target.value)}
                placeholder="ADM-001"
                required
              />
            </Field>
            <Field label="Estado">
              <Select
                value={form.estado}
                onChange={(e) => setField('estado', e.target.value as FormState['estado'])}
              >
                <option value="prospecto">Prospecto</option>
                <option value="activo">Activo</option>
                <option value="suspendido">Suspendido</option>
                <option value="baja">Baja</option>
              </Select>
            </Field>
          </div>
          <Field label="Razón social / Nombre comercial" required error={errors.nombre}>
            <Input
              value={form.nombre}
              onChange={(e) => setField('nombre', e.target.value)}
              placeholder="Administración Sol y Luna"
              required
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Responsable · Nombre">
              <Input
                value={form.responsable_nombre}
                onChange={(e) => setField('responsable_nombre', e.target.value)}
              />
            </Field>
            <Field label="Responsable · Apellido">
              <Input
                value={form.responsable_apellido}
                onChange={(e) => setField('responsable_apellido', e.target.value)}
              />
            </Field>
          </div>
        </fieldset>

        <fieldset className="space-y-4">
          <p className="kicker text-brand-cyan">Fiscal</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="CUIT" hint="11 dígitos sin guiones" error={errors.cuit}>
              <Input
                inputMode="numeric"
                maxLength={11}
                value={form.cuit}
                onChange={(e) =>
                  setField('cuit', e.target.value.replace(/\D/g, '').slice(0, 11))
                }
                placeholder="20123456786"
              />
            </Field>
            <Field label="Condición frente a IVA">
              <Select
                value={form.condicion_iva}
                onChange={(e) =>
                  setField('condicion_iva', e.target.value as FormState['condicion_iva'])
                }
              >
                <option value="">— Sin definir —</option>
                <option value="consumidor_final">Consumidor final</option>
                <option value="responsable_inscripto">Responsable inscripto</option>
                <option value="monotributo">Monotributo</option>
                <option value="exento">Exento</option>
              </Select>
            </Field>
          </div>
          <Field label="Domicilio fiscal">
            <Input
              value={form.domicilio_fiscal}
              onChange={(e) => setField('domicilio_fiscal', e.target.value)}
            />
          </Field>
        </fieldset>

        <fieldset className="space-y-4">
          <p className="kicker text-brand-cyan">Contacto</p>
          <Field label="Email" error={errors.email}>
            <Input
              type="email"
              value={form.email}
              onChange={(e) => setField('email', e.target.value)}
              placeholder="contacto@administracion.com"
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Teléfono">
              <Input
                value={form.telefono}
                onChange={(e) => setField('telefono', e.target.value)}
              />
            </Field>
            <Field label="WhatsApp">
              <Input
                value={form.whatsapp}
                onChange={(e) => setField('whatsapp', e.target.value)}
              />
            </Field>
          </div>
          <Field label="Dirección">
            <Input
              value={form.direccion}
              onChange={(e) => setField('direccion', e.target.value)}
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
          <p className="kicker text-brand-cyan">Registral</p>
          <Field label="Matrícula RPAC">
            <Input
              value={form.matricula_rpac}
              onChange={(e) => setField('matricula_rpac', e.target.value)}
              placeholder="Nº de matrícula"
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Fecha de matriculación">
              <Input
                type="date"
                value={form.matricula_rpac_fecha}
                onChange={(e) => setField('matricula_rpac_fecha', e.target.value)}
              />
            </Field>
            <Field label="Vencimiento de matrícula">
              <Input
                type="date"
                value={form.matricula_rpac_vencimiento}
                onChange={(e) =>
                  setField('matricula_rpac_vencimiento', e.target.value)
                }
              />
            </Field>
          </div>
          <Field label="Matrícula RPA (CABA)">
            <Input
              value={form.matricula_rpa}
              onChange={(e) => setField('matricula_rpa', e.target.value)}
            />
          </Field>
        </fieldset>

        <fieldset className="space-y-4">
          <p className="kicker text-brand-cyan">Comercial</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Origen / Canal de adquisición" hint="Recomendación, Instagram, Cámara, etc.">
              <Input
                value={form.origen}
                onChange={(e) => setField('origen', e.target.value)}
              />
            </Field>
            <Field label="Convenio" hint="Si pertenece a CALP / CAMEAC u otro">
              <Input
                value={form.convenio}
                onChange={(e) => setField('convenio', e.target.value)}
              />
            </Field>
          </div>
          <Field label="Observaciones">
            <Textarea
              value={form.observaciones}
              onChange={(e) => setField('observaciones', e.target.value)}
              rows={4}
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
