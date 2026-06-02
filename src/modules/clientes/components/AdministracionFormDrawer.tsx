import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { toast } from '@/lib/toast';
import { Building2, Save, ArrowLeft, ArrowRight, Loader2 } from 'lucide-react';
import {
  Drawer,
  Button,
  Field,
  Input,
  PasswordRevealInput,
  Select,
  Textarea,
  Stepper,
  StepPanel,
  type Step,
} from '@/components/common';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import {
  createAdministracion,
  updateAdministracion,
  type AdministracionRow,
} from '@/services/api/administraciones';
import { humanizeError } from '@/lib/errors';

interface AdministracionFormDrawerProps {
  open: boolean;
  onClose: () => void;
  editing?: AdministracionRow | null;
  onSaved?: (row: AdministracionRow) => void;
}

type FormState = {
  codigo: string;
  nombre: string;
  responsable_nombre: string;
  responsable_apellido: string;
  estado: 'prospecto' | 'activo' | 'suspendido' | 'baja';
  cuit: string;
  condicion_iva: '' | 'consumidor_final' | 'responsable_inscripto' | 'monotributo' | 'exento';
  domicilio_fiscal: string;
  email: string;
  telefono: string;
  whatsapp: string;
  direccion: string;
  localidad: string;
  provincia: string;
  codigo_postal: string;
  matricula_rpac: string;
  matricula_rpac_fecha: string;
  matricula_rpac_vencimiento: string;
  matricula_rpa: string;
  // AJL-3 · Datos personales del administrador titular (RPAC los pide)
  padre_apellido_nombre: string;
  madre_apellido_nombre: string;
  legajo_rpac: string;
  clave_fiscal_arca: string;
  origen: string;
  convenio: string;
  observaciones: string;
};

const EMPTY: FormState = {
  codigo: '',
  nombre: '',
  responsable_nombre: '',
  responsable_apellido: '',
  estado: 'activo',
  cuit: '',
  condicion_iva: '',
  domicilio_fiscal: '',
  email: '',
  telefono: '',
  whatsapp: '',
  direccion: '',
  localidad: '',
  provincia: '',
  codigo_postal: '',
  matricula_rpac: '',
  matricula_rpac_fecha: '',
  matricula_rpac_vencimiento: '',
  matricula_rpa: '',
  padre_apellido_nombre: '',
  madre_apellido_nombre: '',
  legajo_rpac: '',
  clave_fiscal_arca: '',
  origen: '',
  convenio: '',
  observaciones: '',
};

function rowToForm(r: AdministracionRow): FormState {
  return {
    codigo: r.codigo,
    nombre: r.nombre,
    responsable_nombre: r.responsable_nombre ?? '',
    responsable_apellido: r.responsable_apellido ?? '',
    estado: r.estado as FormState['estado'],
    cuit: r.cuit ?? '',
    condicion_iva: (r.condicion_iva as FormState['condicion_iva']) ?? '',
    domicilio_fiscal: r.domicilio_fiscal ?? '',
    email: r.email ?? '',
    telefono: r.telefono ?? '',
    whatsapp: r.whatsapp ?? '',
    direccion: r.direccion ?? '',
    localidad: r.localidad ?? '',
    provincia: r.provincia ?? '',
    codigo_postal: r.codigo_postal ?? '',
    matricula_rpac: r.matricula_rpac ?? '',
    matricula_rpac_fecha: r.matricula_rpac_fecha ?? '',
    matricula_rpac_vencimiento: r.matricula_rpac_vencimiento ?? '',
    matricula_rpa: r.matricula_rpa ?? '',
    padre_apellido_nombre: (r as { padre_apellido_nombre?: string | null }).padre_apellido_nombre ?? '',
    madre_apellido_nombre: (r as { madre_apellido_nombre?: string | null }).madre_apellido_nombre ?? '',
    legajo_rpac: (r as { legajo_rpac?: string | null }).legajo_rpac ?? '',
    clave_fiscal_arca: (r as { clave_fiscal_arca?: string | null }).clave_fiscal_arca ?? '',
    origen: r.origen ?? '',
    convenio: r.convenio ?? '',
    observaciones: r.observaciones ?? '',
  };
}

const STEPS: Step[] = [
  { key: 'identidad', label: 'Identidad', description: 'Quién es' },
  { key: 'fiscal', label: 'Fiscal', description: 'CUIT y condición' },
  { key: 'contacto', label: 'Contacto', description: 'Bandejas y domicilio' },
  { key: 'extra', label: 'Matrícula y comercial', description: 'RPAC, RPA y notas' },
];

type StepKey = (typeof STEPS)[number]['key'];

export function AdministracionFormDrawer({
  open,
  onClose,
  editing,
  onSaved,
}: AdministracionFormDrawerProps) {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});

  // P-FE-02: resetear form local on-open
  useEffect(() => {
    if (open) {
      setForm(editing ? rowToForm(editing) : EMPTY);
      setErrors({});
      setStep(0);
    }
  }, [open, editing?.id]);

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }));
  }

  const stepErrors = useMemo(() => stepValidations(form), [form]);

  function validateStep(idx: number): boolean {
    const errs = stepErrors[idx] ?? {};
    if (Object.keys(errs).length === 0) return true;
    setErrors((prev) => ({ ...prev, ...errs }));
    return false;
  }

  function validateAll(): boolean {
    const all = stepErrors.reduce((acc, e) => ({ ...acc, ...e }), {});
    setErrors(all);
    return Object.keys(all).length === 0;
  }

  function next() {
    if (validateStep(step) && step < STEPS.length - 1) setStep(step + 1);
  }
  function back() {
    if (step > 0) setStep(step - 1);
  }

  async function onSubmit(ev: FormEvent) {
    ev.preventDefault();
    if (!validateAll()) {
      // Saltar al primer paso con error
      const firstErrIdx = stepErrors.findIndex((e) => Object.keys(e).length > 0);
      if (firstErrIdx >= 0) setStep(firstErrIdx);
      return;
    }
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
      padre_apellido_nombre: form.padre_apellido_nombre.trim() || null,
      madre_apellido_nombre: form.madre_apellido_nombre.trim() || null,
      legajo_rpac: form.legajo_rpac.trim() || null,
      clave_fiscal_arca: form.clave_fiscal_arca.trim() || null,
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
          ? 'No pudimos actualizar la administración'
          : 'No pudimos crear la administración',
        { description: humanizeError(res.error) },
      );
      return;
    }
    toast.success(
      editing ? 'Administración actualizada' : 'Administración creada',
    );
    onSaved?.(res.data);
    onClose();
  }

  // Marcar steps con error visible (rojo en stepper)
  const stepsWithStatus: Step[] = STEPS.map((s, i) => ({
    ...s,
    invalid: i !== step && Object.keys(stepErrors[i] ?? {}).length > 0
      && Object.keys(stepErrors[i] ?? {}).some((k) => errors[k as keyof FormState]),
  }));

  const isLast = step === STEPS.length - 1;
  const stepKey: StepKey = STEPS[step]?.key as StepKey;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={920}
      kicker={editing ? 'Editar' : 'Nueva administración'}
      title={editing ? editing.nombre : 'Alta de administración'}
      description="Cargá los datos en 4 pasos. Podés saltear lo que no tengas todavía y completarlo después."
      icon={<Building2 size={20} />}
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          <div className="text-xs text-brand-muted">
            Paso {step + 1} de {STEPS.length}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={onClose} disabled={saving}>
              Cancelar
            </Button>
            {step > 0 && (
              <Button variant="secondary" onClick={back} disabled={saving}>
                <ArrowLeft size={14} /> Atrás
              </Button>
            )}
            {!isLast ? (
              <Button onClick={next} disabled={saving}>
                Siguiente <ArrowRight size={14} />
              </Button>
            ) : (
              <Button type="submit" form="admin-form" loading={saving}>
                <Save size={15} /> Guardar
              </Button>
            )}
          </div>
        </div>
      }
    >
      <form id="admin-form" onSubmit={onSubmit} className="relative">
        {/* Decoración sutil del fondo del drawer */}
        <TrianglesAccent
          position="top-right"
          size={170}
          tone="cyan"
          density="soft"
          className="opacity-50"
        />
        <TrianglesAccent
          position="bottom-left"
          size={140}
          tone="teal"
          density="soft"
          className="opacity-40"
        />

        <div className="relative">
          <div className="mb-7">
            <Stepper steps={stepsWithStatus} current={step} onJump={setStep} />
          </div>

          {stepKey === 'identidad' && (
            <StepPanel
              stepKey="identidad"
              title="Identificación"
              subtitle="Cómo aparece en el sistema y quién es el responsable."
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Código interno" required error={errors.codigo}>
                  <Input
                    value={form.codigo}
                    onChange={(e) => setField('codigo', e.target.value)}
                    placeholder="ADM-001"
                    autoFocus
                    required
                  />
                </Field>
                <Field label="Estado">
                  <Select
                    value={form.estado}
                    onChange={(e) =>
                      setField('estado', e.target.value as FormState['estado'])
                    }
                  >
                    <option value="prospecto">Prospecto</option>
                    <option value="activo">Activo</option>
                    <option value="suspendido">Suspendido</option>
                    <option value="baja">Baja</option>
                  </Select>
                </Field>
              </div>
              <Field
                label="Razón social / Nombre comercial"
                required
                error={errors.nombre}
              >
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
                    onChange={(e) =>
                      setField('responsable_nombre', e.target.value)
                    }
                  />
                </Field>
                <Field label="Responsable · Apellido">
                  <Input
                    value={form.responsable_apellido}
                    onChange={(e) =>
                      setField('responsable_apellido', e.target.value)
                    }
                  />
                </Field>
              </div>
            </StepPanel>
          )}

          {stepKey === 'fiscal' && (
            <StepPanel
              stepKey="fiscal"
              title="Datos fiscales"
              subtitle="CUIT y condición frente a IVA. Estos datos van al snapshot de cada comprobante."
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="CUIT"
                  hint="11 dígitos sin guiones"
                  error={errors.cuit}
                >
                  <Input
                    inputMode="numeric"
                    maxLength={11}
                    value={form.cuit}
                    onChange={(e) =>
                      setField(
                        'cuit',
                        e.target.value.replace(/\D/g, '').slice(0, 11),
                      )
                    }
                    placeholder="20123456786"
                  />
                </Field>
                <Field label="Condición frente a IVA">
                  <Select
                    value={form.condicion_iva}
                    onChange={(e) =>
                      setField(
                        'condicion_iva',
                        e.target.value as FormState['condicion_iva'],
                      )
                    }
                  >
                    <option value="">— Sin definir —</option>
                    <option value="consumidor_final">Consumidor final</option>
                    <option value="responsable_inscripto">
                      Responsable inscripto
                    </option>
                    <option value="monotributo">Monotributo</option>
                    <option value="exento">Exento</option>
                  </Select>
                </Field>
              </div>
              <Field
                label="Domicilio fiscal"
                hint="El que figura en AFIP / ARCA"
              >
                <Input
                  value={form.domicilio_fiscal}
                  onChange={(e) => setField('domicilio_fiscal', e.target.value)}
                />
              </Field>
            </StepPanel>
          )}

          {stepKey === 'contacto' && (
            <StepPanel
              stepKey="contacto"
              title="Contacto"
              subtitle="Bandejas y domicilio comercial. Los emails para facturación los cargás en la ficha."
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Email" error={errors.email}>
                  <Input
                    type="email"
                    value={form.email}
                    onChange={(e) => setField('email', e.target.value)}
                    placeholder="contacto@administracion.com"
                  />
                </Field>
                <Field label="Teléfono">
                  <Input
                    value={form.telefono}
                    onChange={(e) => setField('telefono', e.target.value)}
                  />
                </Field>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="WhatsApp">
                  <Input
                    value={form.whatsapp}
                    onChange={(e) => setField('whatsapp', e.target.value)}
                  />
                </Field>
                <Field label="Dirección">
                  <Input
                    value={form.direccion}
                    onChange={(e) => setField('direccion', e.target.value)}
                  />
                </Field>
              </div>
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
            </StepPanel>
          )}

          {stepKey === 'extra' && (
            <StepPanel
              stepKey="extra"
              title="Matrículas y notas"
              subtitle="RPAC / RPA, canal por el que llegó y observaciones internas."
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Matrícula RPAC">
                  <Input
                    value={form.matricula_rpac}
                    onChange={(e) => setField('matricula_rpac', e.target.value)}
                    placeholder="Nº de matrícula"
                  />
                </Field>
                <Field label="Matrícula RPA · CABA">
                  <Input
                    value={form.matricula_rpa}
                    onChange={(e) => setField('matricula_rpa', e.target.value)}
                  />
                </Field>
              </div>
              {/* AJL-3: datos personales + identidad fiscal del titular RPAC */}
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Apellido y nombres del padre" hint="RPAC lo pide al matricularse.">
                  <Input
                    value={form.padre_apellido_nombre}
                    onChange={(e) => setField('padre_apellido_nombre', e.target.value)}
                  />
                </Field>
                <Field label="Apellido y nombres de la madre">
                  <Input
                    value={form.madre_apellido_nombre}
                    onChange={(e) => setField('madre_apellido_nombre', e.target.value)}
                  />
                </Field>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Legajo RPAC" hint="Número de legajo asignado por el Registro al matricularse.">
                  <Input
                    value={form.legajo_rpac}
                    onChange={(e) => setField('legajo_rpac', e.target.value)}
                  />
                </Field>
                <Field
                  label="Clave Fiscal ARCA"
                  hint="Texto común; se oculta automáticamente con ✦ y se revela con el botón."
                >
                  <PasswordRevealInput
                    value={form.clave_fiscal_arca}
                    onChange={(e) => setField('clave_fiscal_arca', e.target.value)}
                    placeholder="Clave fiscal nivel 3"
                  />
                </Field>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Fecha de matriculación RPAC">
                  <Input
                    type="date"
                    value={form.matricula_rpac_fecha}
                    onChange={(e) =>
                      setField('matricula_rpac_fecha', e.target.value)
                    }
                  />
                </Field>
                <Field label="Vencimiento RPAC">
                  <Input
                    type="date"
                    value={form.matricula_rpac_vencimiento}
                    onChange={(e) =>
                      setField('matricula_rpac_vencimiento', e.target.value)
                    }
                  />
                </Field>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Origen / Canal"
                  hint="Recomendación, Instagram, Cámara, etc."
                >
                  <Input
                    value={form.origen}
                    onChange={(e) => setField('origen', e.target.value)}
                  />
                </Field>
                <Field label="Convenio" hint="CALP, CAMEAC, etc.">
                  <Input
                    value={form.convenio}
                    onChange={(e) => setField('convenio', e.target.value)}
                  />
                </Field>
              </div>
              <Field label="Observaciones internas">
                <Textarea
                  rows={3}
                  value={form.observaciones}
                  onChange={(e) => setField('observaciones', e.target.value)}
                />
              </Field>
            </StepPanel>
          )}
        </div>

        {saving && (
          <p className="mt-6 flex items-center gap-2 text-xs text-brand-muted">
            <Loader2 size={14} className="animate-spin" /> Guardando…
          </p>
        )}
      </form>
    </Drawer>
  );
}

// ---------------- validation per step ----------------
function stepValidations(
  form: FormState,
): Array<Partial<Record<keyof FormState, string>>> {
  const out: Array<Partial<Record<keyof FormState, string>>> = [{}, {}, {}, {}];
  if (!form.codigo.trim()) out[0]!.codigo = 'Requerido';
  if (!form.nombre.trim()) out[0]!.nombre = 'Requerido';
  if (form.cuit && !/^\d{11}$/.test(form.cuit))
    out[1]!.cuit = 'Debe tener 11 dígitos numéricos';
  if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email))
    out[2]!.email = 'Email inválido';
  return out;
}
