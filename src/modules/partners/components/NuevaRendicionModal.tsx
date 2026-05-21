import { useEffect, useState } from 'react';
import { FileBarChart } from 'lucide-react';
import { toast } from '@/lib/toast';
import { Modal, Button, Field, Input } from '@/components/common';
import { crearRendicion } from '@/services/api/partners';

interface Props {
  open: boolean;
  onClose: () => void;
  partnerId: string;
  partnerNombre: string;
  onCreated?: (rendicionId: string) => void;
}

function firstDayOfMonth(): string {
  const d = new Date();
  d.setDate(1);
  return d.toISOString().slice(0, 10);
}

function lastDayOfMonth(): string {
  const d = new Date();
  d.setMonth(d.getMonth() + 1, 0);
  return d.toISOString().slice(0, 10);
}

export function NuevaRendicionModal({
  open,
  onClose,
  partnerId,
  partnerNombre,
  onCreated,
}: Props) {
  const [desde, setDesde] = useState(firstDayOfMonth());
  const [hasta, setHasta] = useState(lastDayOfMonth());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDesde(firstDayOfMonth());
    setHasta(lastDayOfMonth());
  }, [open]);

  async function onSubmit() {
    if (!desde || !hasta) {
      toast.error('Indicá ambas fechas');
      return;
    }
    if (hasta < desde) {
      toast.error('La fecha hasta no puede ser anterior al desde');
      return;
    }
    setSaving(true);
    const res = await crearRendicion(partnerId, desde, hasta);
    setSaving(false);
    if (!res.ok) {
      toast.error(`No se pudo crear la rendición: ${res.error.message}`);
      return;
    }
    toast.success('Rendición creada en borrador');
    onCreated?.(res.data);
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Nueva rendición"
      kicker={partnerNombre}
      icon={<FileBarChart size={16} />}
      width={500}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={() => void onSubmit()} disabled={saving}>
            {saving ? 'Creando…' : 'Crear rendición'}
          </Button>
        </div>
      }
    >
      <div className="space-y-4 text-sm text-brand-ink">
        <p className="text-xs text-brand-muted">
          Se generarán todas las atribuciones del periodo según el convenio
          vigente. Después podés revisarlas y cerrar la rendición.
        </p>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Desde" required>
            <Input
              type="date"
              value={desde}
              onChange={(e) => setDesde(e.target.value)}
            />
          </Field>
          <Field label="Hasta" required>
            <Input
              type="date"
              value={hasta}
              onChange={(e) => setHasta(e.target.value)}
              min={desde}
            />
          </Field>
        </div>

        <div className="rounded-lg border border-brand-cyan/30 bg-brand-cyan/5 px-3 py-2 text-xs text-brand-ink">
          Sólo se incluyen comprobantes autorizados y movimientos egreso
          atribuidos al partner dentro del periodo.
        </div>
      </div>
    </Modal>
  );
}
