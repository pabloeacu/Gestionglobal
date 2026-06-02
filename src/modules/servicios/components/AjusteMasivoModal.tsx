import { useEffect, useState, type FormEvent } from 'react';
import { toast } from '@/lib/toast';
import { TrendingUp } from 'lucide-react';
import {
  Modal,
  Button,
  Field,
  Input,
  Select,
  Textarea,
} from '@/components/common';
import {
  ajusteMasivo,
  listCategorias,
  type CategoriaServicioRow,
} from '@/services/api/servicios';
import { humanizeError } from '@/lib/errors';

interface AjusteMasivoModalProps {
  open: boolean;
  onClose: () => void;
  onApplied?: () => void;
}

export function AjusteMasivoModal({
  open,
  onClose,
  onApplied,
}: AjusteMasivoModalProps) {
  const [categorias, setCategorias] = useState<CategoriaServicioRow[]>([]);
  const [categoriaCodigo, setCategoriaCodigo] = useState<string>('');
  const [porcentaje, setPorcentaje] = useState('');
  const [motivo, setMotivo] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCategoriaCodigo('');
    setPorcentaje('');
    setMotivo('');
    void (async () => {
      const r = await listCategorias();
      if (r.ok) setCategorias(r.data);
    })();
  }, [open]);

  async function onSubmit(ev: FormEvent) {
    ev.preventDefault();
    const pct = Number(porcentaje);
    if (Number.isNaN(pct) || pct === 0) {
      toast.error('Ingresá un porcentaje distinto de cero.');
      return;
    }
    setSaving(true);
    const res = await ajusteMasivo({
      categoriaCodigo: categoriaCodigo || null,
      porcentaje: pct,
      motivo: motivo.trim() || null,
    });
    setSaving(false);
    if (!res.ok) {
      toast.error(`No pudimos aplicar el ajuste: ${humanizeError(res.error)}`);
      return;
    }
    toast.success(
      `Ajuste aplicado a ${res.data.length} servicio${
        res.data.length === 1 ? '' : 's'
      }.`,
    );
    onApplied?.();
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Ajuste masivo de precios"
      kicker="Tabulador"
      icon={<TrendingUp size={18} />}
      width={520}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} type="button">
            Cancelar
          </Button>
          <Button
            type="submit"
            form="ajuste-form"
            loading={saving}
          >
            Aplicar ajuste
          </Button>
        </>
      }
    >
      <form id="ajuste-form" onSubmit={onSubmit} className="space-y-4">
        <p className="text-sm text-brand-muted">
          Cierra las reglas base abiertas con fecha de hoy y crea reglas
          nuevas con vigencia desde mañana. Cada cambio queda en la bitácora.
        </p>
        <Field label="Categoría" hint="Vacío = todos los servicios activos">
          <Select
            value={categoriaCodigo}
            onChange={(e) => setCategoriaCodigo(e.target.value)}
          >
            <option value="">Todas las categorías</option>
            {categorias.map((c) => (
              <option key={c.id} value={c.codigo}>
                {c.nombre}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Porcentaje" required hint="Ej.: 12.5 → +12,5 % · -10 → rebaja">
          <Input
            type="number"
            step="0.01"
            value={porcentaje}
            onChange={(e) => setPorcentaje(e.target.value)}
            placeholder="0"
          />
        </Field>
        <Field label="Motivo">
          <Textarea
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Actualización trimestral por IPC"
          />
        </Field>
      </form>
    </Modal>
  );
}
