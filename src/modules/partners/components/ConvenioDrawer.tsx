import { useEffect, useState } from 'react';
import { Percent } from 'lucide-react';
import { toast } from '@/lib/toast';
import {
  Drawer,
  Button,
  Field,
  Input,
  Select,
  Textarea,
} from '@/components/common';
import { crearConvenio } from '@/services/api/partners';

interface Props {
  open: boolean;
  onClose: () => void;
  partnerId: string;
  partnerNombre: string;
  onSaved?: () => void;
}

export function ConvenioDrawer({
  open,
  onClose,
  partnerId,
  partnerNombre,
  onSaved,
}: Props) {
  const [desde, setDesde] = useState(() => new Date().toISOString().slice(0, 10));
  const [hasta, setHasta] = useState('');
  const [porcIngresos, setPorcIngresos] = useState('30.00');
  const [porcCostos, setPorcCostos] = useState('30.00');
  const [moneda, setMoneda] = useState<'ARS' | 'USD'>('ARS');
  const [observaciones, setObservaciones] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDesde(new Date().toISOString().slice(0, 10));
    setHasta('');
    setPorcIngresos('30.00');
    setPorcCostos('30.00');
    setMoneda('ARS');
    setObservaciones('');
  }, [open]);

  async function onSave() {
    const pi = parseFloat(porcIngresos.replace(',', '.'));
    const pc = parseFloat(porcCostos.replace(',', '.'));
    if (!Number.isFinite(pi) || pi < 0 || pi > 100) {
      toast.error('Porcentaje de ingresos inválido (0–100)');
      return;
    }
    if (!Number.isFinite(pc) || pc < 0 || pc > 100) {
      toast.error('Porcentaje de costos inválido (0–100)');
      return;
    }
    if (!desde) {
      toast.error('Indicá la fecha de inicio');
      return;
    }
    if (hasta && hasta < desde) {
      toast.error('La fecha de fin no puede ser anterior al inicio');
      return;
    }
    setSaving(true);
    const res = await crearConvenio({
      partner_id: partnerId,
      vigencia_desde: desde,
      vigencia_hasta: hasta || null,
      porc_ingresos: pi,
      porc_costos: pc,
      moneda,
      observaciones: observaciones.trim() || null,
    });
    setSaving(false);
    if (!res.ok) {
      toast.error(`No se pudo crear el convenio: ${res.error.message}`);
      return;
    }
    toast.success('Convenio creado');
    onSaved?.();
    onClose();
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Nuevo convenio"
      kicker={partnerNombre}
      description="Vigencia + porcentajes de ingresos y costos. Si hay convenios previos, cerralos antes con fecha hasta."
      icon={<Percent size={18} />}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={() => void onSave()} disabled={saving}>
            {saving ? 'Guardando…' : 'Crear convenio'}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Vigente desde" required>
            <Input
              type="date"
              value={desde}
              onChange={(e) => setDesde(e.target.value)}
            />
          </Field>
          <Field label="Vigente hasta">
            <Input
              type="date"
              value={hasta}
              onChange={(e) => setHasta(e.target.value)}
              min={desde}
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="% Ingresos" required>
            <Input
              value={porcIngresos}
              onChange={(e) => setPorcIngresos(e.target.value)}
              inputMode="decimal"
              placeholder="30.00"
            />
          </Field>
          <Field label="% Costos" required>
            <Input
              value={porcCostos}
              onChange={(e) => setPorcCostos(e.target.value)}
              inputMode="decimal"
              placeholder="30.00"
            />
          </Field>
        </div>

        <Field label="Moneda">
          <Select value={moneda} onChange={(e) => setMoneda(e.target.value as 'ARS' | 'USD')}>
            <option value="ARS">ARS</option>
            <option value="USD">USD</option>
          </Select>
        </Field>

        <Field label="Observaciones">
          <Textarea
            value={observaciones}
            onChange={(e) => setObservaciones(e.target.value)}
            rows={3}
            placeholder="Detalles del acuerdo, condiciones especiales…"
          />
        </Field>
      </div>
    </Drawer>
  );
}
