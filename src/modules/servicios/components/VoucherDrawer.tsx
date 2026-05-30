// Drawer para crear / editar un voucher de descuento.
// Mig 0134.

import { useEffect, useState, type FormEvent } from 'react';
import { toast } from '@/lib/toast';
import { Ticket, Save } from 'lucide-react';
import {
  Drawer,
  Button,
  Field,
  Input,
  Select,
  Textarea,
} from '@/components/common';
import {
  crearVoucher,
  actualizarVoucher,
  type ServicioVoucherRow,
  type VoucherAlcance,
} from '@/services/api/vouchers';

interface VoucherDrawerProps {
  servicio_id: string;
  voucher: ServicioVoucherRow | null; // null = crear
  onClose: () => void;
  onSaved: () => void;
}

type Draft = {
  codigo: string;
  descuento_pct: string;
  alcance: VoucherAlcance;
  expira_at: string; // YYYY-MM-DD o vacío
  max_usos: string; // vacío = ilimitado
  observaciones: string;
};

const EMPTY: Draft = {
  codigo: '',
  descuento_pct: '10',
  alcance: 'ambos',
  expira_at: '',
  max_usos: '',
  observaciones: '',
};

export function VoucherDrawer({
  servicio_id,
  voucher,
  onClose,
  onSaved,
}: VoucherDrawerProps) {
  const isEdit = !!voucher;
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (voucher) {
      setDraft({
        codigo: voucher.codigo,
        descuento_pct: String(voucher.descuento_pct),
        alcance: voucher.alcance as VoucherAlcance,
        expira_at: voucher.expira_at
          ? voucher.expira_at.slice(0, 10) // ISO → YYYY-MM-DD
          : '',
        max_usos: voucher.max_usos != null ? String(voucher.max_usos) : '',
        observaciones: voucher.observaciones ?? '',
      });
    } else {
      setDraft(EMPTY);
    }
  }, [voucher]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const codigo = draft.codigo.trim();
    if (!codigo) {
      toast.error('Ingresá un código.');
      return;
    }
    const descuento = Number(draft.descuento_pct);
    if (!Number.isFinite(descuento) || descuento <= 0 || descuento > 100) {
      toast.error('El descuento debe ser entre 1 y 100.');
      return;
    }
    const maxUsos = draft.max_usos.trim() === '' ? null : Number(draft.max_usos);
    if (maxUsos != null && (!Number.isFinite(maxUsos) || maxUsos <= 0)) {
      toast.error('Máximo de usos debe ser un número positivo (o vacío).');
      return;
    }
    // expira_at: convertir a fin del día (23:59:59 local) para que el día
    // completo sea válido. Vacío = nunca expira.
    const expira_at = draft.expira_at
      ? new Date(`${draft.expira_at}T23:59:59`).toISOString()
      : null;

    setSaving(true);
    const payload = {
      codigo,
      descuento_pct: descuento,
      alcance: draft.alcance,
      expira_at,
      max_usos: maxUsos,
      observaciones: draft.observaciones.trim() || null,
    };

    const res = isEdit
      ? await actualizarVoucher(voucher!.id, payload)
      : await crearVoucher({ servicio_id, ...payload });
    setSaving(false);

    if (!res.ok) {
      // Si es duplicado de código, mensaje más amistoso.
      if (res.error.message.includes('uq_servicio_vouchers_codigo')) {
        toast.error(`Ya existe un voucher con el código “${codigo}” para este servicio.`);
      } else {
        toast.error(res.error.message);
      }
      return;
    }
    toast.success(isEdit ? 'Voucher actualizado.' : 'Voucher creado.');
    onSaved();
  }

  return (
    <Drawer
      open={true}
      onClose={onClose}
      title={isEdit ? 'Editar voucher' : 'Nuevo voucher'}
      icon={<Ticket size={18} />}
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="Código" hint="Lo que el usuario escribe en el formulario. Mayús/minús indiferentes.">
          <Input
            value={draft.codigo}
            onChange={(e) => setDraft((d) => ({ ...d, codigo: e.target.value.toUpperCase() }))}
            placeholder="WELCOME50"
            autoFocus
            required
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Descuento %" hint="1 a 100. Si es 100, el servicio queda gratuito y no requiere comprobante de pago.">
            <Input
              type="number"
              min={1}
              max={100}
              value={draft.descuento_pct}
              onChange={(e) => setDraft((d) => ({ ...d, descuento_pct: e.target.value }))}
              required
            />
          </Field>
          <Field label="Alcance">
            <Select
              value={draft.alcance}
              onChange={(e) =>
                setDraft((d) => ({ ...d, alcance: e.target.value as VoucherAlcance }))
              }
            >
              <option value="ambos">Todos (público + clientes)</option>
              <option value="publico">Sólo público (landing)</option>
              <option value="cliente">Sólo clientes (portal)</option>
            </Select>
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Vence el" hint="Dejá vacío para que no expire nunca.">
            <Input
              type="date"
              value={draft.expira_at}
              onChange={(e) => setDraft((d) => ({ ...d, expira_at: e.target.value }))}
            />
          </Field>
          <Field label="Máx. usos" hint="Vacío = ilimitado mientras esté vigente.">
            <Input
              type="number"
              min={1}
              value={draft.max_usos}
              onChange={(e) => setDraft((d) => ({ ...d, max_usos: e.target.value }))}
              placeholder="Ilimitado"
            />
          </Field>
        </div>

        <Field label="Observaciones internas" hint="No se muestran al cliente.">
          <Textarea
            value={draft.observaciones}
            onChange={(e) => setDraft((d) => ({ ...d, observaciones: e.target.value }))}
            rows={2}
            placeholder="Campaña de lanzamiento, convenio con X, etc."
          />
        </Field>

        <footer className="flex items-center justify-end gap-2 pt-2">
          <Button variant="secondary" type="button" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={saving}>
            <Save size={14} />
            {saving ? 'Guardando…' : isEdit ? 'Guardar cambios' : 'Crear voucher'}
          </Button>
        </footer>
      </form>
    </Drawer>
  );
}
