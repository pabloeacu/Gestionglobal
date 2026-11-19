import { useEffect, useState, type FormEvent } from 'react';
import { FileMinus, Save, Sparkles } from 'lucide-react';
import { Drawer, Button, Field, Input, Textarea, AnimatedNumber } from '@/components/common';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import { emitirNotaCredito, type ComprobanteRow } from '@/services/api/comprobantes';
import { humanizeError } from '@/lib/errors';
import { toast } from '@/lib/toast';

interface Props {
  open: boolean;
  onClose: () => void;
  comprobante: ComprobanteRow;
  onSaved?: () => void;
}

/**
 * DGG-259 · Emitir una Nota de Crédito (NC_X) contra el SALDO PENDIENTE de un
 * comprobante simple. Total o parcial. Si cubre el saldo entero, el original
 * queda 'compensado'. El tope lo impone también la RPC (defensa en profundidad).
 */
export function EmitirNotaCreditoDrawer({ open, onClose, comprobante, onSaved }: Props) {
  const saldo = Number(comprobante.saldo_pendiente ?? 0);
  const [monto, setMonto] = useState<number>(saldo);
  const [motivo, setMotivo] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setMonto(saldo);
    setMotivo('');
    setError(null);
    setSaving(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, comprobante.id]);

  const restante = Math.round((saldo - monto) * 100) / 100;
  const esTotal = Math.abs(restante) < 0.005;
  const fiscal = comprobante.tipo !== 'X';

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (saving) return; // DGG-259 · anti doble-submit (Enter en el input numérico re-disparaba)
    if (fiscal) {
      setError('La nota de crédito fiscal (A/B/C) se habilita al activar ARCA. Por ahora sólo comprobantes simples (X).');
      return;
    }
    if (!(monto > 0)) { setError('El monto debe ser mayor a 0'); return; }
    if (monto > saldo + 0.009) { setError(`El monto no puede superar el saldo pendiente (${formatMoney(saldo)})`); return; }
    if (!motivo.trim()) { setError('Indicá el motivo de la nota de crédito'); return; }
    setSaving(true);
    const res = await emitirNotaCredito(comprobante.id, monto, motivo.trim());
    setSaving(false);
    if (!res.ok) {
      toast.error('No pudimos emitir la nota de crédito', { description: humanizeError(res.error) });
      setError(humanizeError(res.error));
      return;
    }
    toast.success(
      esTotal ? `Nota de crédito emitida · el comprobante quedó compensado` : `Nota de crédito emitida: ${formatMoney(monto)}`,
    );
    onSaved?.();
    onClose();
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={680}
      kicker="Nota de crédito"
      title={`NC · ${formatNumStr(comprobante)}`}
      description={`Saldo pendiente: ${formatMoney(saldo)}`}
      icon={<FileMinus size={20} />}
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          <span className="inline-flex items-center gap-1 rounded-full bg-brand-cyan-pale/40 px-2 py-0.5 text-[11px] font-semibold text-brand-cyan">
            <Sparkles size={11} /> Saldo {formatMoney(saldo)}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={onClose} disabled={saving}>Cancelar</Button>
            <Button type="submit" form="nc-form" loading={saving} disabled={fiscal}>
              <Save size={15} /> Emitir nota de crédito
            </Button>
          </div>
        </div>
      }
    >
      <form id="nc-form" onSubmit={onSubmit} className="relative">
        <TrianglesAccent position="top-right" size={170} tone="cyan" density="soft" className="opacity-50" />
        <div className="relative space-y-5">
          <p className="text-sm text-brand-muted">
            La nota de crédito <strong className="text-brand-ink">acredita</strong> (compensa) el comprobante
            hasta su saldo pendiente. Si cubre el saldo entero, el comprobante queda <strong className="text-brand-ink">compensado</strong>.
            Para acreditar un importe ya cobrado, primero revertí la cobranza.
          </p>

          {fiscal && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              Este es un comprobante fiscal ({comprobante.tipo}). La nota de crédito fiscal se habilita al activar ARCA.
            </p>
          )}

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Monto a acreditar" required className="sm:col-span-2">
              <Input
                type="number" step="0.01" min={0.01} max={saldo}
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
                NC total: {formatMoney(saldo)}
              </button>
            </div>
          </div>

          <Field label="Motivo" required hint="Queda registrado en la nota de crédito y en la cuenta corriente.">
            <Textarea
              rows={2}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ej: error de facturación, bonificación acordada, servicio no prestado…"
            />
          </Field>

          <div className="grid gap-3 sm:grid-cols-3">
            <PreviewBox label="Saldo actual" value={saldo} tone="muted" />
            <PreviewBox label="Nota de crédito" value={monto} tone="cyan" />
            <PreviewBox
              label={esTotal ? 'Queda compensado' : 'Saldo después'}
              value={esTotal ? 0 : restante}
              tone={esTotal ? 'green' : 'amber'}
            />
          </div>

          {error && (
            <p className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</p>
          )}
        </div>
      </form>
    </Drawer>
  );
}

function PreviewBox({ label, value, tone }: { label: string; value: number; tone: 'muted' | 'cyan' | 'amber' | 'green' }) {
  const cls = tone === 'cyan' ? 'border-brand-cyan/40 bg-brand-cyan-pale/30'
    : tone === 'green' ? 'border-emerald-200 bg-emerald-50'
    : tone === 'amber' ? 'border-amber-200 bg-amber-50'
    : 'border-slate-200 bg-white';
  const valueCls = tone === 'cyan' ? 'text-brand-cyan'
    : tone === 'green' ? 'text-emerald-700'
    : tone === 'amber' ? 'text-amber-700'
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
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

function formatNumStr(c: ComprobanteRow): string {
  if (!c.numero) return c.tipo;
  return `${c.tipo} ${String(c.punto_venta).padStart(5, '0')}-${String(c.numero).padStart(8, '0')}`;
}
