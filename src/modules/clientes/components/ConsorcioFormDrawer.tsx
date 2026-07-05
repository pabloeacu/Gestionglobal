import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { toast } from '@/lib/toast';
import {
  Building,
  Save,
  ArrowLeft,
  ArrowRight,
  Loader2,
  Info,
} from 'lucide-react';
import {
  Drawer,
  Button,
  Field,
  Input,
  Select,
  Textarea,
  Stepper,
  StepPanel,
  type Step,
} from '@/components/common';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import {
  createConsorcio,
  updateConsorcio,
  type ConsorcioRow,
} from '@/services/api/consorcios';
import { humanizeError } from '@/lib/errors';
import { formatCuit, validarCuit } from '@/lib/cuit';

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

const STEPS: Step[] = [
  { key: 'identidad', label: 'Identidad', description: 'Código y nombre' },
  { key: 'composicion', label: 'Composición', description: 'UF, cocheras, bauleras' },
  { key: 'documento', label: 'Documento', description: 'CUIT o DNI ficticio' },
  { key: 'facturacion', label: 'Facturación', description: 'Abono y domicilio' },
];

type StepKey = (typeof STEPS)[number]['key'];

export function ConsorcioFormDrawer({
  open,
  onClose,
  administracionId,
  editing,
  onSaved,
}: ConsorcioFormDrawerProps) {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});

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
      const firstErrIdx = stepErrors.findIndex(
        (e) => Object.keys(e).length > 0,
      );
      if (firstErrIdx >= 0) setStep(firstErrIdx);
      return;
    }
    setSaving(true);
    const n = (s: string) => Number(s.replace(',', '.'));
    const base = {
      codigo: form.codigo.trim(),
      nombre: form.nombre.trim(),
      unidades_funcionales: Math.max(
        0,
        Math.floor(n(form.unidades_funcionales)),
      ),
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
        ? {
            tipo_documento: form.tipo_documento,
            numero_documento: form.numero_documento,
          }
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
        editing ? 'No pudimos actualizar el consorcio' : 'No pudimos crear el consorcio',
        { description: humanizeError(res.error) },
      );
      return;
    }
    toast.success(editing ? 'Consorcio actualizado' : 'Consorcio creado');
    onSaved?.(res.data);
    onClose();
  }

  const stepsWithStatus: Step[] = STEPS.map((s, i) => ({
    ...s,
    invalid:
      i !== step &&
      Object.keys(stepErrors[i] ?? {}).some(
        (k) => errors[k as keyof FormState],
      ),
  }));

  const isLast = step === STEPS.length - 1;
  const stepKey: StepKey = STEPS[step]?.key as StepKey;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={880}
      kicker={editing ? 'Editar' : 'Nuevo consorcio'}
      title={editing ? editing.nombre : 'Alta de consorcio'}
      description="Si dejás el documento vacío, el sistema asigna un DNI ficticio (D07) automáticamente."
      icon={<Building size={20} />}
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
              <Button type="submit" form="cons-form" loading={saving}>
                <Save size={15} /> Guardar
              </Button>
            )}
          </div>
        </div>
      }
    >
      <form id="cons-form" onSubmit={onSubmit} className="relative">
        <TrianglesAccent
          position="top-right"
          size={160}
          tone="cyan"
          density="soft"
          className="opacity-50"
        />
        <TrianglesAccent
          position="bottom-left"
          size={130}
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
              title="Identificación del consorcio"
              subtitle="Cómo lo nombra la administración y un código corto para reconocerlo."
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Código" required error={errors.codigo}>
                  <Input
                    value={form.codigo}
                    onChange={(e) => setField('codigo', e.target.value)}
                    placeholder="C-001"
                    autoFocus
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
            </StepPanel>
          )}

          {stepKey === 'composicion' && (
            <StepPanel
              stepKey="composicion"
              title="Composición"
              subtitle="Para Administración Global el precio se calcula por unidad funcional."
            >
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <Field
                  label="Unidades funcionales"
                  error={errors.unidades_funcionales}
                >
                  <Input
                    type="number"
                    min="0"
                    value={form.unidades_funcionales}
                    onChange={(e) =>
                      setField('unidades_funcionales', e.target.value)
                    }
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
            </StepPanel>
          )}

          {stepKey === 'documento' && (
            <StepPanel
              stepKey="documento"
              title="Documento fiscal del consorcio"
              subtitle="Solo cargá CUIT si el consorcio lo tiene propio. Si no, lo dejamos en blanco."
            >
              <div className="rounded-xl border border-brand-cyan-pale/50 bg-brand-cyan-pale/10 p-3 text-xs leading-relaxed text-brand-ink/80">
                <Info size={13} className="mr-1 inline text-brand-cyan" />
                Sin documento, el sistema le asigna un{' '}
                <strong>DNI ficticio</strong> secuencial (rango 99000001+) para
                que ARCA acepte el receptor (D07).
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Tipo de documento">
                  <Select
                    value={form.tipo_documento}
                    onChange={(e) =>
                      setField(
                        'tipo_documento',
                        e.target.value as FormState['tipo_documento'],
                      )
                    }
                    disabled={!!editing}
                  >
                    <option value="">— Asignar DNI ficticio automático —</option>
                    <option value="cuit">CUIT propio</option>
                    <option value="dni_ficticio">DNI ficticio (manual)</option>
                  </Select>
                </Field>
                <Field
                  label="Número de documento"
                  error={errors.numero_documento}
                >
                  <Input
                    inputMode="numeric"
                    value={
                      form.tipo_documento === 'cuit'
                        ? formatCuit(form.numero_documento)
                        : form.numero_documento
                    }
                    onChange={(e) =>
                      setField(
                        'numero_documento',
                        e.target.value.replace(/\D/g, '').slice(0, 11),
                      )
                    }
                    placeholder={
                      form.tipo_documento === 'cuit' ? 'XX-XXXXXXXX-X' : ''
                    }
                    disabled={!form.tipo_documento || !!editing}
                  />
                </Field>
              </div>
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
                  <option value="consumidor_final">Consumidor final</option>
                  <option value="responsable_inscripto">
                    Responsable inscripto
                  </option>
                </Select>
              </Field>
            </StepPanel>
          )}

          {stepKey === 'facturacion' && (
            <StepPanel
              stepKey="facturacion"
              title="Facturación y domicilio"
              subtitle="Abono mensual base y a quién facturarle por defecto."
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Monto de abono mensual"
                  hint="ARS, sin IVA"
                  error={errors.monto_abono}
                >
                  <Input
                    inputMode="decimal"
                    value={form.monto_abono}
                    onChange={(e) => setField('monto_abono', e.target.value)}
                  />
                </Field>
                <Field label="Dirección">
                  <Input
                    value={form.domicilio}
                    onChange={(e) => setField('domicilio', e.target.value)}
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
                    onChange={(e) =>
                      setField('codigo_postal', e.target.value)
                    }
                  />
                </Field>
              </div>
              <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-3 transition hover:border-brand-cyan/50 hover:bg-brand-cyan-pale/10">
                <input
                  type="checkbox"
                  checked={form.facturar_con_cuit_administracion}
                  onChange={(e) =>
                    setField(
                      'facturar_con_cuit_administracion',
                      e.target.checked,
                    )
                  }
                  className="mt-0.5 accent-brand-cyan"
                />
                <span className="text-sm text-brand-ink">
                  Facturar con los datos de la <strong>administración</strong>
                  <span className="block text-xs text-brand-muted">
                    Por defecto el comprobante sale con el receptor del
                    consorcio. Activá esto si querés que traiga el CUIT/razón
                    social del administrador.
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

function stepValidations(
  form: FormState,
): Array<Partial<Record<keyof FormState, string>>> {
  const out: Array<Partial<Record<keyof FormState, string>>> = [{}, {}, {}, {}];
  if (!form.codigo.trim()) out[0]!.codigo = 'Requerido';
  if (!form.nombre.trim()) out[0]!.nombre = 'Requerido';
  if (form.tipo_documento === 'cuit') {
    const cuitErr = validarCuit(form.numero_documento);
    if (cuitErr) out[2]!.numero_documento = cuitErr;
  } else if (form.tipo_documento === 'dni_ficticio') {
    if (!/^\d{7,8}$/.test(form.numero_documento))
      out[2]!.numero_documento = 'DNI ficticio: 7 u 8 dígitos';
  }
  const n = (s: string) => Number(s.replace(',', '.'));
  if (Number.isNaN(n(form.monto_abono)) || n(form.monto_abono) < 0)
    out[3]!.monto_abono = 'Inválido';
  if (n(form.unidades_funcionales) < 0)
    out[1]!.unidades_funcionales = 'No puede ser negativo';
  return out;
}
