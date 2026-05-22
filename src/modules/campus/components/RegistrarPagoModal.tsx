import { useEffect, useState } from 'react';
import { Banknote, Wallet } from 'lucide-react';
import { Button, Field, Input, Modal, Select, Textarea } from '@/components/common';
import { toast } from '@/lib/toast';
import {
  listCajasParaPago,
  registrarPagoCurso,
  type CajaParaPago,
} from '@/services/api/campus';

// Modal para registrar el pago del curso (gerencia). Registra un asiento de
// ingreso en movimientos + marca la condición 'pago' (DGG-10bis).
export function RegistrarPagoModal({
  open,
  matriculaId,
  alumnoNombre,
  montoSugerido,
  onClose,
  onRegistrado,
}: {
  open: boolean;
  matriculaId: string | null;
  alumnoNombre: string;
  montoSugerido?: number | null;
  onClose: () => void;
  onRegistrado: () => void;
}) {
  const [cajas, setCajas] = useState<CajaParaPago[]>([]);
  const [cajaId, setCajaId] = useState('');
  const [monto, setMonto] = useState<number | ''>('');
  const [obs, setObs] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setMonto(montoSugerido && montoSugerido > 0 ? montoSugerido : '');
    setObs('');
    void (async () => {
      const res = await listCajasParaPago();
      if (res.ok) {
        setCajas(res.data);
        if (res.data[0]) setCajaId(res.data[0].id);
      }
    })();
  }, [open, montoSugerido]);

  async function guardar() {
    if (!matriculaId) return;
    if (monto === '' || Number(monto) <= 0) {
      toast.error('Ingresá un monto válido.');
      return;
    }
    if (!cajaId) {
      toast.error('Elegí una caja.');
      return;
    }
    setSaving(true);
    const res = await registrarPagoCurso({
      matriculaId,
      monto: Number(monto),
      cajaId,
      observaciones: obs.trim() || null,
    });
    setSaving(false);
    if (!res.ok) {
      toast.error(res.error.message);
      return;
    }
    toast.success('Pago registrado · asiento de ingreso creado');
    onRegistrado();
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Registrar pago del curso"
      icon={<Banknote size={18} />}
    >
      <div className="space-y-4">
        <p className="text-sm text-brand-muted">
          Acreditás el pago de <strong className="text-brand-ink">{alumnoNombre}</strong>.
          Se registra un asiento de ingreso en finanzas y se marca la condición
          de pago como cumplida.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Monto" required>
            <Input
              type="number"
              min={0}
              value={monto}
              onChange={(e) =>
                setMonto(e.target.value === '' ? '' : Number(e.target.value))
              }
              placeholder="0"
            />
          </Field>
          <Field label="Caja" required>
            <Select value={cajaId} onChange={(e) => setCajaId(e.target.value)}>
              {cajas.length === 0 && <option value="">Sin cajas</option>}
              {cajas.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Observaciones" hint="Opcional. Queda en el movimiento.">
          <Textarea
            value={obs}
            onChange={(e) => setObs(e.target.value)}
            rows={2}
            placeholder="Transferencia, recibo Nº…"
          />
        </Field>
        <div className="flex items-center justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={guardar} loading={saving}>
            <Wallet size={14} /> Registrar pago
          </Button>
        </div>
      </div>
    </Modal>
  );
}
