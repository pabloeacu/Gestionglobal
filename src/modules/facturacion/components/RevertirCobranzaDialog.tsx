import { useEffect, useState } from 'react';
import { Undo2, RotateCcw, Wallet } from 'lucide-react';
import { Modal, Button } from '@/components/common';
import { revertirPagoCobranza, desimputarDejarACuenta } from '@/services/api/cobranzas';
import { humanizeError } from '@/lib/errors';
import { toast } from '@/lib/toast';

interface Props {
  open: boolean;
  onClose: () => void;
  imputacionId: string;
  movimientoId: string | null;
  montoCobranza: number;
  label?: string;        // ej. "Cobranza · $160.000"
  onDone?: () => void;
}

type Caso = 'anular_pago' | 'dejar_a_cuenta';

/**
 * DGG-259 · Revertir una cobranza con DOS casos explícitos (decisión Pablo), para
 * que gerencia elija y operación haga los asientos correctos:
 *   · Anular el pago  → contra-asientos (cuenta corriente + caja), trazable, el pago
 *     desaparece del saldo vivo. Usalo cuando el pago no corresponde / se devuelve.
 *   · Dejar a cuenta   → el pago queda como saldo a favor del cliente, reaplicable a
 *     otro comprobante. Usalo cuando el pago es válido pero va a otra factura.
 * Ambos liberan el saldo del comprobante → después podés emitir la NC por el total.
 */
export function RevertirCobranzaDialog({
  open, onClose, imputacionId, movimientoId, montoCobranza, label, onDone,
}: Props) {
  const [caso, setCaso] = useState<Caso>('dejar_a_cuenta');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) { setCaso('dejar_a_cuenta'); setSaving(false); }
  }, [open]);

  async function confirmar() {
    setSaving(true);
    let okFlag = false;
    let err: unknown = null;
    if (caso === 'anular_pago') {
      if (!movimientoId) {
        toast.error('No se pudo identificar el movimiento del pago');
        setSaving(false);
        return;
      }
      const r = await revertirPagoCobranza(movimientoId, 'Reversión de cobranza');
      okFlag = r.ok; if (!r.ok) err = r.error;
    } else {
      const r = await desimputarDejarACuenta(imputacionId);
      okFlag = r.ok; if (!r.ok) err = r.error;
    }
    setSaving(false);
    if (!okFlag) {
      toast.error('No pudimos revertir la cobranza', { description: humanizeError(err) });
      return;
    }
    toast.success(caso === 'anular_pago'
      ? 'Pago anulado · se registró el contra-asiento'
      : 'Pago dejado a cuenta · quedó como saldo a favor del cliente');
    onDone?.();
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      kicker="Revertir cobranza"
      title={label ?? `Revertir ${formatMoney(montoCobranza)}`}
      icon={<Undo2 size={18} />}
      width={560}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button onClick={confirmar} loading={saving} variant={caso === 'anular_pago' ? 'danger' : 'primary'}>
            {caso === 'anular_pago' ? 'Anular el pago' : 'Dejar a cuenta'}
          </Button>
        </>
      }
    >
      <p className="mb-4 text-sm text-brand-muted">
        Elegí qué hacer con el pago de <strong className="text-brand-ink">{formatMoney(montoCobranza)}</strong>.
        Las dos opciones liberan el saldo del comprobante (podés emitir la nota de crédito después).
      </p>
      <div className="space-y-3">
        <OptionCard
          selected={caso === 'dejar_a_cuenta'}
          onSelect={() => setCaso('dejar_a_cuenta')}
          icon={<Wallet size={18} />}
          title="Dejar a cuenta (saldo a favor)"
          desc="El pago se desconecta del comprobante pero queda como saldo a favor del cliente, listo para aplicarlo a otro comprobante. No se toca la caja."
        />
        <OptionCard
          selected={caso === 'anular_pago'}
          onSelect={() => setCaso('anular_pago')}
          icon={<RotateCcw size={18} />}
          title="Anular el pago (contra-asiento)"
          desc="El pago se revierte con un contra-asiento en la cuenta corriente y en la caja/banco (queda trazable como anulado) y desaparece del saldo vivo. Usalo si el pago no corresponde o se devuelve."
          danger
        />
      </div>
    </Modal>
  );
}

function OptionCard({
  selected, onSelect, icon, title, desc, danger,
}: {
  selected: boolean; onSelect: () => void; icon: React.ReactNode; title: string; desc: string; danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={[
        'flex w-full items-start gap-3 rounded-xl border p-4 text-left transition',
        selected
          ? danger
            ? 'border-rose-400 bg-rose-50 ring-2 ring-rose-200'
            : 'border-brand-cyan bg-brand-cyan-pale/30 ring-2 ring-brand-cyan/30'
          : 'border-slate-200 bg-white hover:border-slate-300',
      ].join(' ')}
    >
      <span className={[
        'mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg',
        selected ? (danger ? 'bg-rose-100 text-rose-700' : 'bg-brand-cyan text-white') : 'bg-slate-100 text-brand-muted',
      ].join(' ')}>
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block font-semibold text-brand-ink">{title}</span>
        <span className="mt-0.5 block text-sm text-brand-muted">{desc}</span>
      </span>
    </button>
  );
}

function formatMoney(n: number): string {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}
