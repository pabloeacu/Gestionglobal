// #1/#2 (reporte JL) · Modal para que el cliente INFORME un pago desde el portal.
// No mueve el saldo: crea un "pago reportado" que gerencia concilia después.
// Simple a propósito (usuarios no técnicos): monto, fecha, medio, referencia.
import { useEffect, useRef, useState } from 'react';
import { Wallet, Loader2, Paperclip, X } from 'lucide-react';
import { Modal, Field, Input, Select, Textarea, Button } from '@/components/common';
import { toast } from '@/lib/toast';
import { humanizeError } from '@/lib/errors';
import { useAuth } from '@/contexts/AuthContext';
import {
  reportarPago,
  uploadComprobantePago,
  type PagoMedio,
} from '@/services/api/pagosReportados';

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

// Parseo robusto de importe en formato argentino (auditoría §6 A#9):
// "10.000" → 10000, "1.234.567" → 1234567, "10.000,50" → 10000.50,
// "10000,50" → 10000.50, "10.5" → 10.5. Evita que parseFloat("10.000") dé 10.
function parseMontoAR(s: string): number {
  const t = (s || '').trim().replace(/\s/g, '');
  if (!t) return NaN;
  if (t.includes(',')) {
    // coma = decimal · puntos = separador de miles
    return parseFloat(t.replace(/\./g, '').replace(',', '.'));
  }
  // sin coma: puntos como miles sólo si son grupos de 3 (10.000 / 1.234.567)
  if (/^\d{1,3}(\.\d{3})+$/.test(t)) return parseFloat(t.replace(/\./g, ''));
  return parseFloat(t);
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
  const { user } = useAuth();
  const [monto, setMonto] = useState(montoSugerido ? String(montoSugerido) : '');
  const [fecha, setFecha] = useState(hoyISO());
  const [medio, setMedio] = useState<PagoMedio>('transferencia');
  const [referencia, setReferencia] = useState('');
  const [nota, setNota] = useState('');
  // Doc JL 2026-07-12: adjuntar el comprobante de la transferencia (clave
  // cuando se paga a la cuenta de la Fundación, que no vemos en nuestro banco).
  const [archivo, setArchivo] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);

  // Auditoría §6 (#8): el modal vive montado — al REABRIR para informar otro
  // pago, el estado del anterior (sobre todo el archivo adjunto) quedaba
  // pegado y se re-subía a un pago que no correspondía. Reset al abrir.
  useEffect(() => {
    if (!open) return;
    setMonto(montoSugerido ? String(montoSugerido) : '');
    setFecha(hoyISO());
    setMedio('transferencia');
    setReferencia('');
    setNota('');
    setArchivo(null);
    if (fileRef.current) fileRef.current.value = '';
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const montoNum = parseMontoAR(monto);
  const montoValido = !isNaN(montoNum) && montoNum > 0;

  async function enviar() {
    if (!montoValido) {
      toast.error('Ingresá el importe que pagaste');
      return;
    }
    setSaving(true);

    // 1) Subir el comprobante si lo adjuntó. Si falla, avisamos y NO
    //    perdemos el reporte en silencio: el cliente decide reintentar.
    let archivoPath: string | null = null;
    if (archivo) {
      const adminId = user?.administracionId;
      if (!adminId) {
        setSaving(false);
        toast.error('No pudimos identificar tu cuenta. Recargá la página e intentá de nuevo.');
        return;
      }
      const up = await uploadComprobantePago(adminId, archivo);
      if (!up.ok) {
        setSaving(false);
        toast.error('No pudimos subir el comprobante', { description: humanizeError(up.error) });
        return;
      }
      archivoPath = up.data.path;
    }

    const res = await reportarPago({
      comprobanteId: comprobanteId ?? null,
      tramiteId: tramiteId ?? null,
      trackingLineaId: trackingLineaId ?? null,
      monto: montoNum,
      fechaPago: fecha || hoyISO(),
      medio,
      referencia: referencia.trim() || null,
      archivoPath,
      nota: nota.trim() || null,
    });
    setSaving(false);
    if (!res.ok) {
      // Auditoría §6 (#9): si el reporte falla después de subir el archivo,
      // el objeto queda huérfano en el bucket. Decisión documentada: aceptable
      // (nombres únicos por timestamp, bucket con límite de 10 MB, y el
      // cliente NO tiene permiso de borrado — su evidencia es inmutable).
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

      <Field
        label="Comprobante de la transferencia (opcional)"
        className="mt-3"
        hint="Muy recomendado si pagaste a la cuenta de la Fundación (cursos): nos permite verificar tu pago al instante."
      >
        <input
          ref={fileRef}
          type="file"
          accept="image/*,.pdf"
          className="hidden"
          onChange={(e) => setArchivo(e.target.files?.[0] ?? null)}
        />
        {archivo ? (
          <div className="flex items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm">
            <span className="inline-flex min-w-0 items-center gap-2 text-emerald-800">
              <Paperclip size={14} className="shrink-0" />
              <span className="truncate">{archivo.name}</span>
            </span>
            <button
              type="button"
              onClick={() => {
                setArchivo(null);
                if (fileRef.current) fileRef.current.value = '';
              }}
              className="shrink-0 rounded p-1 text-emerald-700 hover:bg-emerald-100"
              aria-label="Quitar archivo"
            >
              <X size={14} />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 px-3 py-2.5 text-sm font-medium text-brand-muted transition hover:border-brand-cyan/50 hover:text-brand-cyan"
          >
            <Paperclip size={14} /> Adjuntar foto o PDF del comprobante
          </button>
        )}
      </Field>

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
