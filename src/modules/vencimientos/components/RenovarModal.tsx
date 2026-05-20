import { useEffect, useState } from 'react';
import { RefreshCcw } from 'lucide-react';
import { toast } from '@/lib/toast';
import { Modal, Button, Field, Input } from '@/components/common';
import { formatDateLong } from '@/lib/dates';
import {
  marcarRenovado,
  VENCIMIENTO_TIPO_LABEL,
  type ProximoVencimiento,
} from '@/services/api/vencimientos';

interface Props {
  open: boolean;
  onClose: () => void;
  venc: ProximoVencimiento | null;
  onRenewed?: (nuevoId: string) => void;
}

export function RenovarModal({ open, onClose, venc, onRenewed }: Props) {
  const [nuevaFecha, setNuevaFecha] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !venc) {
      setNuevaFecha('');
      return;
    }
    // Default: misma fecha + 1 año (típico para matrículas / DDJJ).
    const f = new Date(venc.fecha_vencimiento + 'T00:00:00');
    f.setFullYear(f.getFullYear() + 1);
    setNuevaFecha(f.toISOString().slice(0, 10));
  }, [open, venc]);

  async function onSubmit() {
    if (!venc) return;
    if (!nuevaFecha) {
      toast.error('Indicá la nueva fecha');
      return;
    }
    if (nuevaFecha <= venc.fecha_vencimiento) {
      toast.error('La nueva fecha debe ser posterior a la actual');
      return;
    }
    setSaving(true);
    const res = await marcarRenovado(venc.id, nuevaFecha);
    setSaving(false);
    if (!res.ok) {
      toast.error(`No se pudo renovar: ${res.error.message}`);
      return;
    }
    toast.success('Vencimiento renovado');
    onRenewed?.(res.data);
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Renovar vencimiento"
      kicker="Datos estratégicos"
      icon={<RefreshCcw size={16} />}
      width={460}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={() => void onSubmit()} disabled={saving}>
            {saving ? 'Renovando…' : 'Confirmar renovación'}
          </Button>
        </div>
      }
    >
      {venc ? (
        <div className="space-y-4 text-sm text-brand-ink">
          <div className="rounded-lg border border-slate-200 bg-brand-zebra/40 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-brand-muted">
              {VENCIMIENTO_TIPO_LABEL[venc.tipo]}
            </p>
            <p className="mt-1 font-medium">
              {venc.sujeto === 'consorcio' && venc.consorcio_nombre
                ? venc.consorcio_nombre
                : venc.administracion_nombre}
            </p>
            <p className="text-xs text-brand-muted">
              Vencía el {formatDateLong(venc.fecha_vencimiento)}
            </p>
          </div>

          <Field label="Nueva fecha de vencimiento" required>
            <Input
              type="date"
              value={nuevaFecha}
              onChange={(e) => setNuevaFecha(e.target.value)}
              min={venc.fecha_vencimiento}
            />
          </Field>

          <p className="text-xs text-brand-muted">
            Marcaremos el actual como{' '}
            <span className="font-medium">renovado</span> y crearemos uno nuevo
            con la fecha indicada. Las alertas se resetean para el ciclo
            siguiente.
          </p>
        </div>
      ) : null}
    </Modal>
  );
}
