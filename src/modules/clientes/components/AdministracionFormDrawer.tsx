import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { toast } from '@/lib/toast';
import { Building2, Save, ArrowLeft, ArrowRight, Loader2, KeyRound } from 'lucide-react';
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
  useConfirm,
  type Step,
} from '@/components/common';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import {
  createAdministracion,
  updateAdministracion,
  reactivarAdministracion,
  adminPrecheckIdentidad,
  type AdministracionRow,
} from '@/services/api/administraciones';
import { altaClientePortal } from '@/services/api/usuarios';
import { humanizeError } from '@/lib/errors';
import { formatCuit, validarCuit, soloDigitosCuit } from '@/lib/cuit';

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
  responsable_dni: string;
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
  // UI-only (no va al payload): si crear el acceso al portal tras el alta.
  crearAcceso: boolean;
};

const EMPTY: FormState = {
  codigo: '',
  nombre: '',
  responsable_nombre: '',
  responsable_apellido: '',
  responsable_dni: '',
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
  crearAcceso: false,
};

function rowToForm(r: AdministracionRow): FormState {
  return {
    codigo: r.codigo,
    nombre: r.nombre,
    responsable_nombre: r.responsable_nombre ?? '',
    responsable_apellido: r.responsable_apellido ?? '',
    responsable_dni: (r as { responsable_dni?: string | null }).responsable_dni ?? '',
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
    crearAcceso: false,
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
  const confirm = useConfirm();

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
    // Si se pidió crear acceso al portal, el email es obligatorio (vive en paso Contacto).
    if (!editing && form.crearAcceso && !form.email.trim()) {
      setErrors((e) => ({ ...e, email: 'Necesario para crear el acceso al portal' }));
      setStep(2);
      return;
    }
    const payload = {
      codigo: form.codigo.trim(),
      nombre: form.nombre.trim(),
      responsable_nombre: form.responsable_nombre.trim() || null,
      responsable_apellido: form.responsable_apellido.trim() || null,
      responsable_dni: form.responsable_dni.trim() || null,
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

    // ── Blindaje de identidad (decisiones Pablo, mig 0321) ──────────────────
    // Antes de crear/editar, chequeamos gemelos por CUIT y DNI en la BD.
    const cuitDigits = soloDigitosCuit(form.cuit);
    const dniDigits = form.responsable_dni.replace(/\D/g, '');
    if (cuitDigits.length === 11 || (dniDigits.length >= 7 && dniDigits.length <= 8)) {
      const pre = await adminPrecheckIdentidad(
        form.cuit.trim() || null,
        form.responsable_dni.trim() || null,
        editing?.id ?? null,
      );
      if (pre.ok) {
        const { cuit_twin: cuitTwin, dni_twin: dniTwin } = pre.data;
        // (1) CUIT de un cliente DADO DE BAJA → el gerente decide (reactivar vs crear).
        if (!editing && cuitTwin && cuitTwin.activo === false) {
          const reactivar = await confirm({
            title: 'Ya existe un cliente dado de baja con este CUIT',
            message: `"${cuitTwin.nombre}" está dado de baja con este mismo CUIT. La baja pudo deberse a un problema que quizá no quieras heredar. ¿Reactivás ese cliente (conserva su historial y cuenta corriente) o creás una cuenta nueva y separada?`,
            confirmLabel: 'Reactivar el existente',
            cancelLabel: 'Crear una cuenta nueva',
          });
          if (reactivar) {
            setSaving(true);
            const re = await reactivarAdministracion(cuitTwin.id);
            if (!re.ok) {
              setSaving(false);
              toast.error('No pudimos reactivar el cliente', { description: humanizeError(re.error) });
              return;
            }
            const upd = await updateAdministracion(cuitTwin.id, payload);
            setSaving(false);
            if (!upd.ok) {
              toast.error('Reactivado, pero no pudimos aplicar los datos nuevos', { description: humanizeError(upd.error) });
              return;
            }
            toast.success(`Cliente "${cuitTwin.nombre}" reactivado y actualizado`);
            onSaved?.(upd.data);
            onClose();
            return;
          }
          // Eligió "crear nueva" (o cerró): confirmamos explícito para no crear por accidente.
          const crearNueva = await confirm({
            title: 'Crear una cuenta nueva',
            message: 'Se creará una cuenta NUEVA y separada con el mismo CUIT. El cliente dado de baja queda como está.',
            confirmLabel: 'Sí, crear nueva',
            cancelLabel: 'Cancelar',
          });
          if (!crearNueva) return;
        }
        // (2) DNI ya presente en un cliente ACTIVO → aviso (puede ser la misma persona).
        if (dniTwin) {
          const seguir = await confirm({
            title: 'Ya existe un cliente con este DNI',
            message: `El DNI ${form.responsable_dni.trim()} ya figura en "${dniTwin.nombre}". Si es la misma persona, mejor editá ese cliente en vez de duplicarlo. ¿Continuar igual?`,
            confirmLabel: 'Continuar igual',
            cancelLabel: 'Cancelar',
          });
          if (!seguir) return;
        }
      }
    }

    setSaving(true);
    const res = editing
      ? await updateAdministracion(editing.id, payload)
      : await createAdministracion(payload);

    if (!res.ok) {
      setSaving(false);
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

    // Alta de acceso al portal (sólo en creación nueva y si se tildó). La cuenta
    // la dispara el gerente desde acá; la edge fn crea el user + manda credenciales.
    if (!editing && form.crearAcceso) {
      const alta = await altaClientePortal({
        administracion_id: res.data.id,
        email: form.email.trim(),
        nombre: form.nombre.trim(),
      });
      if (!alta.ok) {
        toast.error('Cliente creado, pero no pudimos crear el acceso al portal', {
          description: humanizeError(alta.error),
        });
      } else {
        const d = alta.data as { password_set?: boolean } | null;
        toast.success(
          d?.password_set === false
            ? 'Ese email ya tenía usuario; quedó vinculado al cliente.'
            : `Acceso al portal creado. Credenciales enviadas a ${form.email.trim()}.`,
        );
      }
    }
    setSaving(false);
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
              <Field label="Responsable · DNI" className="mt-4">
                <Input
                  inputMode="numeric"
                  value={form.responsable_dni}
                  onChange={(e) =>
                    setField('responsable_dni', e.target.value.replace(/\D/g, '').slice(0, 10))
                  }
                />
              </Field>
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
                  required
                  hint="Formato XX-XXXXXXXX-X (los guiones se completan solos)"
                  error={errors.cuit}
                >
                  <Input
                    inputMode="numeric"
                    value={formatCuit(form.cuit)}
                    onChange={(e) =>
                      setField('cuit', soloDigitosCuit(e.target.value).slice(0, 11))
                    }
                    placeholder="XX-XXXXXXXX-X"
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

              {/* Alta de acceso al portal sólo en creación nueva. Si no se tilda
                  acá, se puede crear después desde la ficha del cliente. */}
              {!editing && (
                <label className="mt-2 flex cursor-pointer items-start gap-3 rounded-xl border border-brand-cyan/30 bg-brand-cyan/5 p-4">
                  <input
                    type="checkbox"
                    checked={form.crearAcceso}
                    onChange={(e) => setField('crearAcceso', e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-cyan focus:ring-brand-cyan"
                  />
                  <span className="text-sm">
                    <span className="inline-flex items-center gap-1.5 font-semibold text-brand-ink">
                      <KeyRound size={14} className="text-brand-cyan" /> Crear acceso al portal para este cliente
                    </span>
                    <span className="mt-0.5 block text-xs text-brand-muted">
                      {form.email.trim() ? (
                        <>
                          Le enviamos las credenciales a{' '}
                          <span className="font-medium text-brand-ink">{form.email.trim()}</span> al guardar.
                        </>
                      ) : (
                        <>
                          Cargá el email en el paso <span className="font-medium">Contacto</span> para habilitarlo.
                        </>
                      )}
                    </span>
                  </span>
                </label>
              )}
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
  // CUIT OBLIGATORIO (decisión Pablo): identifica al cliente y es la clave de
  // deduplicación (un CUIT = una cuenta). Aplica a alta y edición (fuerza el
  // backfill de los clientes viejos con CUIT NULL).
  if (!form.cuit || !form.cuit.trim()) {
    out[1]!.cuit = 'El CUIT es obligatorio: identifica al cliente y evita cuentas duplicadas.';
  } else {
    const cuitErr = validarCuit(form.cuit);
    if (cuitErr) out[1]!.cuit = cuitErr;
  }
  if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email))
    out[2]!.email = 'Email inválido';
  return out;
}
