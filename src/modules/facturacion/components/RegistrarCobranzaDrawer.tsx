import { useEffect, useState, type FormEvent } from 'react';
import { toast } from '@/lib/toast';
import {
  Wallet, Save, ArrowLeft, ArrowRight, CreditCard, Sparkles,
} from 'lucide-react';
import {
  Drawer, Button, Field, Input, Select, Textarea,
  Stepper, StepPanel, AnimatedNumber, type Step,
} from '@/components/common';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import {
  registrarCobranza,
  listCajasActivas,
  listCategoriasIngreso,
  type CajaRow,
  type CategoriaFinanzaRow,
} from '@/services/api/cobranzas';
import type { ComprobanteRow } from '@/services/api/comprobantes';
import { humanizeError } from '@/lib/errors';

interface Props {
  open: boolean;
  onClose: () => void;
  comprobante: ComprobanteRow;
  onSaved?: () => void;
}

type StepKey = 'caja' | 'monto' | 'confirmar';

const STEPS: { key: StepKey; label: string }[] = [
  { key: 'caja', label: 'Caja' },
  { key: 'monto', label: 'Monto' },
  { key: 'confirmar', label: 'Confirmar' },
];

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function RegistrarCobranzaDrawer({
  open,
  onClose,
  comprobante,
  onSaved,
}: Props) {
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);

  const [cajaId, setCajaId] = useState('');
  const [categoriaId, setCategoriaId] = useState('');
  const [fecha, setFecha] = useState(todayISO());
  const [monto, setMonto] = useState<number>(Number(comprobante.saldo_pendiente ?? 0));
  const [referencia, setReferencia] = useState('');
  const [descripcion, setDescripcion] = useState('');

  const [cajas, setCajas] = useState<CajaRow[]>([]);
  const [categorias, setCategorias] = useState<CategoriaFinanzaRow[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const saldo = Number(comprobante.saldo_pendiente ?? 0);

  useEffect(() => {
    if (!open) return;
    setStep(0);
    setCajaId('');
    setCategoriaId('');
    setFecha(todayISO());
    setMonto(saldo);
    setReferencia('');
    setDescripcion('');
    setErrors({});
    void (async () => {
      const [cR, gR] = await Promise.all([
        listCajasActivas(),
        listCategoriasIngreso(),
      ]);
      if (cR.ok) {
        setCajas(cR.data);
        if (cR.data.length === 1) setCajaId(cR.data[0]!.id);
      }
      if (gR.ok) {
        setCategorias(gR.data);
        // Sugerir "Cobranza" o similar
        const cobranza = gR.data.find((c) =>
          /cobranza|honorario|servicio/i.test(c.nombre),
        );
        if (cobranza) setCategoriaId(cobranza.id);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, comprobante.id]);

  function validateStep(s: number): Record<string, string> {
    const e: Record<string, string> = {};
    if (s === 0) {
      if (!cajaId) e['caja_id'] = 'Elegí una caja';
      if (!fecha) e['fecha'] = 'Fecha requerida';
    }
    if (s === 1) {
      if (monto <= 0) e['monto'] = 'El monto debe ser mayor a 0';
      if (monto > saldo) e['monto'] = `El monto supera el saldo (${formatMoney(saldo)})`;
    }
    return e;
  }

  function next() {
    const e = validateStep(step);
    setErrors(e);
    if (Object.keys(e).length > 0) {
      toast.error('Revisá los campos marcados');
      return;
    }
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }
  function back() { setStep((s) => Math.max(s - 1, 0)); }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const all = { ...validateStep(0), ...validateStep(1) };
    setErrors(all);
    if (Object.keys(all).length > 0) {
      toast.error('Revisá los campos marcados');
      return;
    }
    setSaving(true);
    const res = await registrarCobranza({
      comprobante_id: comprobante.id,
      caja_id: cajaId,
      fecha,
      monto,
      descripcion,
      referencia,
      categoria_id: categoriaId || null,
    });
    setSaving(false);
    if (!res.ok) {
      toast.error('No pudimos registrar la cobranza', { description: humanizeError(res.error) });
      return;
    }
    toast.success(`Cobranza registrada: ${formatMoney(monto)}`);
    onSaved?.();
    onClose();
  }

  const stepsWithStatus: Step[] = STEPS.map((s, i) => ({
    ...s,
    invalid:
      i !== step &&
      Object.keys(errors).some((k) =>
        i === 0 ? ['caja_id', 'fecha'].includes(k) : i === 1 ? k === 'monto' : false,
      ),
  }));

  const isLast = step === STEPS.length - 1;
  const stepKey: StepKey = (STEPS[step]?.key ?? 'caja') as StepKey;
  const restante = saldo - monto;
  const totalCompleto = monto === saldo;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={820}
      kicker="Registrar pago"
      title={`Cobranza · ${formatNumStr(comprobante)}`}
      description={`Saldo pendiente: ${formatMoney(saldo)}`}
      icon={<Wallet size={20} />}
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          <div className="text-xs text-brand-muted">
            Paso {step + 1} de {STEPS.length}
            <span className="ml-3 inline-flex items-center gap-1 rounded-full bg-brand-cyan-pale/40 px-2 py-0.5 text-[11px] font-semibold text-brand-cyan">
              <Sparkles size={11} /> Saldo {formatMoney(saldo)}
            </span>
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
              <Button type="submit" form="cobranza-form" loading={saving}>
                <Save size={15} /> Registrar
              </Button>
            )}
          </div>
        </div>
      }
    >
      <form id="cobranza-form" onSubmit={onSubmit} className="relative">
        <TrianglesAccent
          position="top-right" size={170} tone="cyan" density="soft"
          className="opacity-50"
        />
        <TrianglesAccent
          position="bottom-left" size={140} tone="teal" density="soft"
          className="opacity-40"
        />
        <div className="relative">
          <div className="mb-7">
            <Stepper steps={stepsWithStatus} current={step} onJump={setStep} />
          </div>

          {stepKey === 'caja' && (
            <StepPanel
              stepKey="caja"
              title="Caja y fecha"
              subtitle="Dónde se acreditó el pago y cuándo."
            >
              <Field label="Caja" required error={errors['caja_id']}>
                <Select
                  value={cajaId}
                  onChange={(e) => setCajaId(e.target.value)}
                  required
                >
                  <option value="">— Elegí una caja —</option>
                  {cajas.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nombre} {c.tipo ? `· ${c.tipo}` : ''}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Fecha" required error={errors['fecha']}>
                <Input
                  type="date"
                  value={fecha}
                  onChange={(e) => setFecha(e.target.value)}
                  required
                />
              </Field>
              <Field
                label="Categoría"
                hint="Opcional. Útil para agrupar en reportes financieros."
              >
                <Select
                  value={categoriaId}
                  onChange={(e) => setCategoriaId(e.target.value)}
                >
                  <option value="">— Sin categoría —</option>
                  {categorias.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nombre}
                    </option>
                  ))}
                </Select>
              </Field>
            </StepPanel>
          )}

          {stepKey === 'monto' && (
            <StepPanel
              stepKey="monto"
              title="Monto e identificación"
              subtitle="Cuánto se cobró y cómo identificás el pago."
            >
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Monto" required error={errors['monto']} className="sm:col-span-2">
                  <Input
                    type="number"
                    step="0.01"
                    min={0.01}
                    max={saldo}
                    value={monto}
                    onChange={(e) => setMonto(Number(e.target.value))}
                    required
                  />
                </Field>
                <div className="flex items-end">
                  <button
                    type="button"
                    onClick={() => setMonto(saldo)}
                    className="rounded-lg border border-brand-cyan/40 bg-brand-cyan-pale/30 px-3 py-2 text-sm font-medium text-brand-cyan transition hover:bg-brand-cyan hover:text-white"
                  >
                    Cobrar todo: {formatMoney(saldo)}
                  </button>
                </div>
              </div>

              <Field
                label="Referencia"
                hint="Ej: nº de transferencia, ID de Mercado Pago, cheque…"
              >
                <Input
                  value={referencia}
                  onChange={(e) => setReferencia(e.target.value)}
                  placeholder="Sin referencia"
                />
              </Field>

              <Field label="Descripción interna" hint="Opcional. Solo visible en la caja.">
                <Textarea
                  rows={2}
                  value={descripcion}
                  onChange={(e) => setDescripcion(e.target.value)}
                />
              </Field>

              {/* Preview live de cómo queda el saldo */}
              <div className="grid gap-3 sm:grid-cols-3">
                <PreviewBox label="Saldo actual" value={saldo} tone="muted" />
                <PreviewBox label="Este pago" value={monto} tone="cyan" />
                <PreviewBox
                  label="Saldo después"
                  value={restante}
                  tone={totalCompleto ? 'green' : restante <= 0 ? 'green' : 'amber'}
                />
              </div>
            </StepPanel>
          )}

          {stepKey === 'confirmar' && (
            <StepPanel
              stepKey="confirmar"
              title="Confirmar"
              subtitle="Se va a crear un movimiento de ingreso en la caja elegida e imputar el monto al comprobante."
            >
              <div className="space-y-3">
                <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm">
                  <p className="kicker text-brand-cyan">Resumen</p>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <KV k="Caja" v={cajas.find((c) => c.id === cajaId)?.nombre ?? '—'} />
                    <KV k="Fecha" v={fecha} />
                    <KV
                      k="Categoría"
                      v={categorias.find((c) => c.id === categoriaId)?.nombre ?? '(sin categoría)'}
                    />
                    <KV k="Referencia" v={referencia || '(sin referencia)'} />
                  </div>
                </div>
                <div className="flex items-center justify-between rounded-xl border-2 border-brand-cyan/40 bg-gradient-to-br from-brand-cyan-pale/40 to-brand-teal/10 p-4">
                  <p className="font-display font-bold uppercase tracking-wider text-brand-ink">
                    Monto a cobrar
                  </p>
                  <p className="font-display text-2xl font-bold tabular text-brand-cyan">
                    {formatMoney(monto)}
                  </p>
                </div>
                <p className="text-xs text-brand-muted">
                  Saldo pendiente luego de este pago:{' '}
                  <span className="font-semibold text-brand-ink">{formatMoney(restante)}</span>
                  {totalCompleto && (
                    <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                      <CreditCard size={11} /> queda pagado
                    </span>
                  )}
                </p>
              </div>
            </StepPanel>
          )}
        </div>
      </form>
    </Drawer>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <p className="kicker text-brand-muted">{k}</p>
      <p className="text-sm text-brand-ink">{v}</p>
    </div>
  );
}

function PreviewBox({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'muted' | 'cyan' | 'amber' | 'green';
}) {
  const cls =
    tone === 'cyan'
      ? 'border-brand-cyan/40 bg-brand-cyan-pale/30'
      : tone === 'green'
        ? 'border-emerald-200 bg-emerald-50'
        : tone === 'amber'
          ? 'border-amber-200 bg-amber-50'
          : 'border-slate-200 bg-white';
  const valueCls =
    tone === 'cyan'
      ? 'text-brand-cyan'
      : tone === 'green'
        ? 'text-emerald-700'
        : tone === 'amber'
          ? 'text-amber-700'
          : 'text-brand-ink';
  return (
    <div className={`rounded-xl border p-3 ${cls}`}>
      <p className="kicker text-brand-muted">{label}</p>
      <p className={`mt-0.5 font-display text-lg font-bold tabular ${valueCls}`}>
        $<AnimatedNumber value={Math.round(value)} />
      </p>
    </div>
  );
}

function formatMoney(n: number): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

function formatNumStr(c: ComprobanteRow): string {
  if (!c.numero) return c.tipo;
  return `${c.tipo} ${String(c.punto_venta).padStart(5, '0')}-${String(c.numero).padStart(8, '0')}`;
}
