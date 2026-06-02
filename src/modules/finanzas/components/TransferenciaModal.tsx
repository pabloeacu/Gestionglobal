import { useState } from 'react';
import { ArrowDown } from 'lucide-react';
import { Button, Field, Input, Modal, Select, Textarea } from '@/components/common';
import { toast } from '@/lib/toast';
import { crearTransferencia, type CajaConSaldoRow } from '@/services/api/finanzas';
import { humanizeError } from '@/lib/errors';

interface Props {
  cajas: CajaConSaldoRow[];
  onClose: () => void;
  onCreated: () => void;
}

function formatMoney(n: number): string {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n);
}

export function TransferenciaModal({ cajas, onClose, onCreated }: Props) {
  const [origenId, setOrigenId] = useState<string>(cajas[0]?.caja_id ?? '');
  const [destinoId, setDestinoId] = useState<string>(cajas[1]?.caja_id ?? '');
  const [monto, setMonto] = useState<string>('');
  const [fecha, setFecha] = useState<string>(new Date().toISOString().slice(0, 10));
  const [descripcion, setDescripcion] = useState('');
  const [referencia, setReferencia] = useState('');
  const [creating, setCreating] = useState(false);

  const origen = cajas.find((c) => c.caja_id === origenId);
  const destino = cajas.find((c) => c.caja_id === destinoId);

  async function onSubmit() {
    if (!origenId || !destinoId) { toast.error('Elegí las dos cajas'); return; }
    if (origenId === destinoId) { toast.error('Las cajas deben ser distintas'); return; }
    if (origen?.moneda !== destino?.moneda) {
      toast.error('Las cajas tienen monedas distintas. Por ahora soportamos solo ARS↔ARS o USD↔USD.');
      return;
    }
    const m = Number(monto.replace(',', '.'));
    if (!m || m <= 0) { toast.error('Monto inválido'); return; }
    if (origen && m > origen.saldo) {
      toast.error(`Saldo insuficiente en ${origen.nombre} (${formatMoney(origen.saldo)})`);
      return;
    }
    setCreating(true);
    const res = await crearTransferencia({
      cajaOrigenId: origenId,
      cajaDestinoId: destinoId,
      monto: m,
      fecha,
      descripcion: descripcion.trim() || null,
      referencia: referencia.trim() || null,
    });
    setCreating(false);
    if (!res.ok) {
      toast.error('No pudimos crear la transferencia', { description: humanizeError(res.error) });
      return;
    }
    toast.success('Transferencia registrada');
    onCreated();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Transferir entre cajas"
      kicker="Operación atómica"
      width={500}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={onSubmit} loading={creating}>Transferir</Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Desde" required>
          <Select value={origenId} onChange={(e) => setOrigenId(e.target.value)}>
            {cajas.map((c) => (
              <option key={c.caja_id} value={c.caja_id}>{c.nombre} · {formatMoney(c.saldo)}</option>
            ))}
          </Select>
        </Field>

        <div className="grid place-items-center">
          <div className="grid h-8 w-8 place-items-center rounded-full bg-brand-cyan/10 text-brand-cyan">
            <ArrowDown size={16} />
          </div>
        </div>

        <Field label="Hacia" required>
          <Select value={destinoId} onChange={(e) => setDestinoId(e.target.value)}>
            {cajas.filter((c) => c.caja_id !== origenId).map((c) => (
              <option key={c.caja_id} value={c.caja_id}>{c.nombre} · {formatMoney(c.saldo)}</option>
            ))}
          </Select>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Monto" required>
            <Input
              type="number"
              inputMode="decimal"
              value={monto}
              onChange={(e) => setMonto(e.target.value)}
              placeholder="0.00"
              min={0}
              step="0.01"
            />
          </Field>
          <Field label="Fecha" required>
            <Input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
          </Field>
        </div>

        <Field label="Descripción">
          <Textarea
            rows={2}
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
            placeholder="Ej: ajuste fondos, pago proveedor X"
          />
        </Field>

        <Field label="Referencia externa (opcional)">
          <Input value={referencia} onChange={(e) => setReferencia(e.target.value)} />
        </Field>

        <p className="rounded-lg bg-slate-50 p-2 text-xs text-brand-muted">
          Se crearán dos movimientos pareados (salida en origen, entrada en destino), atómicos. Si revertís uno, se revierten ambos.
        </p>
      </div>
    </Modal>
  );
}
