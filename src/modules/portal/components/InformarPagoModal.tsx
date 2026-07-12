// #1/#2 (reporte JL) · Modal para que el cliente INFORME un pago desde el portal.
// No mueve el saldo: crea un "pago reportado" que gerencia concilia después.
// Simple a propósito (usuarios no técnicos): monto, fecha, medio, referencia.
import { useState } from 'react';
import { Wallet, Loader2 } from 'lucide-react';
import { Modal, Field, Input, Select, Textarea, Button } from '@/components/common';
import { toast } from '@/lib/toast';
import { humanizeError } from '@/lib/errors';
import { reportarPago, type PagoMedio } from '@/services/api/pagosReportados';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Si se informa desde un comprobante puntual, se pre-asocia. */
  comprobanteId?: string | null;
  tramiteId?: string | null;
  trackingLineaId?: string | null;
  /** Monto sugerido (ej. el saldo o el importe de la cuota). */
  montoSugerido?: number | null;
  onReported?: () => void;
}

function hoyISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function InformarPagoModal({
  open,
  onClose,
  comprobanteId,
  tramiteId,
  trackingLineaId,
  montoSugerido,
  onReported,
}: Props) {
  const [monto, setMonto] = useState(montoSugerido ? String(montoSugerido) : '');
  const [fecha, setFecha] = useState(hoyISO());
  const [medio, setMedio] = useState<PagoMedio>('transferencia');
  const [referencia, setReferencia] = useState('');
  const [nota, setNota] = useState('');
  const [saving, setSaving] = useState(false);

  const montoNum = parseFloat((monto || '').replace(',', '.'));
  const montoValido = !isNaN(montoNum) && montoNum > 0;

  async function enviar() {
    if (!montoValido) {
      toast.error('Ingresá el importe que pagaste');
      return;
    }
    setSaving(true);
    const res = await reportarPago({
      comprobanteId: comprobanteId ?? null,
      tramiteId: tramiteId ?? null,
      trackingLineaId: trackingLineaId ?? null,
      monto: montoNum,
      fechaPago: fecha || hoyISO(),
      medio,
      referencia: referencia.trim() || null,
      nota: nota.trim() || null,
    });
    setSaving(false);
    if (!res.ok) {
      toast.error('No pudimos registrar el aviso', { description: humanizeError(res.error) });
      return;
    }
    toast.success('¡Gracias! Avisamos a Gestión Global', {
      description: 'Verificamos el pago y actualizamos tu cuenta a la brevedad.',
    });
    onReported?.();
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      kicker="Cuenta corriente"
      title="Informar un pago"
      icon={<Wallet size={18} />}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={() => void enviar()} disabled={saving || !montoValido}>
            {saving ? <Loader2 size={15} className="animate-spin" /> : <Wallet size={15} />}
            Informar el pago
          </Button>
        </>
      }
    >
      <p className="mb-4 rounded-lg border border-brand-cyan/20 bg-brand-cyan-pale/25 p-3 text-xs text-brand-ink">
        Contanos que ya pagaste y con estos datos lo verificamos. Tu saldo se
        actualiza cuando Gestión Global confirma el pago (te avisamos).
      </p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Importe pagado" required>
          <Input
            inputMode="decimal"
            value={monto}
            onChange={(e) => setMonto(e.target.value)}
            placeholder="0,00"
            autoFocus
          />
        </Field>
        <Field label="Fecha del pago">
          <Input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
        </Field>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="¿Cómo pagaste?">
          <Select value={medio} onChange={(e) => setMedio(e.target.value as PagoMedio)}>
            <option value="transferencia">Transferencia</option>
            <option value="deposito">Depósito</option>
            <option value="mercadopago">Mercado Pago</option>
            <option value="efectivo">Efectivo</option>
            <option value="otro">Otro</option>
          </Select>
        </Field>
        <Field label="Nº de operación / referencia">
          <Input
            value={referencia}
            onChange={(e) => setReferencia(e.target.value)}
            placeholder="Ej. comprobante de transferencia"
          />
        </Field>
      </div>

      <Field label="Nota (opcional)" className="mt-3">
        <Textarea
          rows={2}
          value={nota}
          onChange={(e) => setNota(e.target.value)}
          placeholder="Cualquier aclaración que nos ayude a identificar el pago"
        />
      </Field>
    </Modal>
  );
}
