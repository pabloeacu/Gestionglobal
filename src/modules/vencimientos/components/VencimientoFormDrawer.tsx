import { useEffect, useMemo, useState } from 'react';
import { CalendarClock } from 'lucide-react';
import { toast } from '@/lib/toast';
import {
  Drawer,
  Button,
  Field,
  Input,
  Select,
  Textarea,
} from '@/components/common';
import {
  listAdministraciones,
  type AdministracionListItem,
} from '@/services/api/administraciones';
import {
  listConsorciosByAdministracion,
  type ConsorcioRow,
} from '@/services/api/consorcios';
import {
  crearVencimiento,
  actualizarVencimiento,
  VENCIMIENTO_TIPOS,
  VENCIMIENTO_TIPO_LABEL,
  type VencimientoRow,
  type VencimientoSujeto,
  type VencimientoTipo,
} from '@/services/api/vencimientos';
import { humanizeError } from '@/lib/errors';

interface Props {
  open: boolean;
  onClose: () => void;
  // Si viene `editing`, el drawer edita en lugar de crear.
  editing?: VencimientoRow | null;
  // Pre-seteo opcional para "Nuevo desde cliente".
  initialAdministracionId?: string | null;
  onSaved?: (id: string) => void;
}

export function VencimientoFormDrawer({
  open,
  onClose,
  editing = null,
  initialAdministracionId = null,
  onSaved,
}: Props) {
  const isEdit = !!editing;

  const [tipo, setTipo] = useState<VencimientoTipo>('renovacion_rpac');
  const [sujeto, setSujeto] = useState<VencimientoSujeto>('administracion');
  const [administracionId, setAdministracionId] = useState<string>('');
  const [consorcioId, setConsorcioId] = useState<string>('');
  const [fechaVto, setFechaVto] = useState('');
  const [fechaEmision, setFechaEmision] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [observaciones, setObservaciones] = useState('');

  const [admins, setAdmins] = useState<AdministracionListItem[]>([]);
  const [consorcios, setConsorcios] = useState<ConsorcioRow[]>([]);
  const [saving, setSaving] = useState(false);

  // Reset / hidratación al abrir
  useEffect(() => {
    if (!open) return;
    if (editing) {
      setTipo(editing.tipo as VencimientoTipo);
      setSujeto(editing.sujeto as VencimientoSujeto);
      setAdministracionId(editing.administracion_id);
      setConsorcioId(editing.consorcio_id ?? '');
      setFechaVto(editing.fecha_vencimiento);
      setFechaEmision(editing.fecha_emision ?? '');
      setDescripcion(editing.descripcion ?? '');
      setObservaciones(editing.observaciones ?? '');
    } else {
      setTipo('renovacion_rpac');
      setSujeto('administracion');
      setAdministracionId(initialAdministracionId ?? '');
      setConsorcioId('');
      setFechaVto('');
      setFechaEmision('');
      setDescripcion('');
      setObservaciones('');
    }
  }, [open, editing, initialAdministracionId]);

  // Cargar administraciones cuando abre
  useEffect(() => {
    if (!open) return;
    void (async () => {
      const res = await listAdministraciones({ estado: 'activo', limit: 500 });
      if (res.ok) setAdmins(res.data.rows);
    })();
  }, [open]);

  // Cargar consorcios al cambiar la administración
  useEffect(() => {
    if (!administracionId) {
      setConsorcios([]);
      return;
    }
    void (async () => {
      const res = await listConsorciosByAdministracion(administracionId);
      if (res.ok) setConsorcios(res.data);
    })();
  }, [administracionId]);

  const sujetoIdResolved = useMemo(() => {
    return sujeto === 'consorcio' ? consorcioId : administracionId;
  }, [sujeto, administracionId, consorcioId]);

  async function onSave() {
    if (!administracionId) {
      toast.error('Elegí la administración');
      return;
    }
    if (sujeto === 'consorcio' && !consorcioId) {
      toast.error('Elegí el consorcio');
      return;
    }
    if (!fechaVto) {
      toast.error('Indicá la fecha de vencimiento');
      return;
    }

    setSaving(true);
    if (isEdit && editing) {
      const res = await actualizarVencimiento(editing.id, {
        tipo,
        fecha_vencimiento: fechaVto,
        fecha_emision: fechaEmision || null,
        descripcion: descripcion.trim() || null,
        observaciones: observaciones.trim() || null,
        consorcio_id: sujeto === 'consorcio' ? consorcioId : null,
      });
      setSaving(false);
      if (!res.ok) {
        toast.error(`No se pudo actualizar: ${humanizeError(res.error)}`);
        return;
      }
      toast.success('Vencimiento actualizado');
      onSaved?.(res.data.id);
      onClose();
      return;
    }

    const res = await crearVencimiento({
      tipo,
      sujeto,
      sujeto_id: sujetoIdResolved,
      administracion_id: administracionId,
      consorcio_id: sujeto === 'consorcio' ? consorcioId : null,
      fecha_vencimiento: fechaVto,
      fecha_emision: fechaEmision || null,
      descripcion: descripcion.trim() || null,
      observaciones: observaciones.trim() || null,
    });
    setSaving(false);
    if (!res.ok) {
      toast.error(`No se pudo crear: ${humanizeError(res.error)}`);
      return;
    }
    toast.success('Vencimiento creado');
    onSaved?.(res.data.id);
    onClose();
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={isEdit ? 'Editar vencimiento' : 'Nuevo vencimiento'}
      kicker="Datos estratégicos"
      description="Registrá fechas que disparan alertas y sugerencias automáticas de servicios."
      icon={<CalendarClock size={18} />}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={() => void onSave()} disabled={saving}>
            {saving ? 'Guardando…' : isEdit ? 'Guardar cambios' : 'Crear vencimiento'}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Tipo" required>
            <Select
              value={tipo}
              onChange={(e) => setTipo(e.target.value as VencimientoTipo)}
            >
              {VENCIMIENTO_TIPOS.map((t) => (
                <option key={t} value={t}>
                  {VENCIMIENTO_TIPO_LABEL[t]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Sujeto" required>
            <Select
              value={sujeto}
              onChange={(e) => setSujeto(e.target.value as VencimientoSujeto)}
              disabled={isEdit}
            >
              <option value="administracion">Administración</option>
              <option value="consorcio">Consorcio</option>
            </Select>
          </Field>
        </div>

        <Field label="Administración" required>
          <Select
            value={administracionId}
            onChange={(e) => setAdministracionId(e.target.value)}
            disabled={isEdit}
          >
            <option value="">— Elegir —</option>
            {admins.map((a) => (
              <option key={a.id} value={a.id}>
                {a.nombre}
              </option>
            ))}
          </Select>
        </Field>

        {sujeto === 'consorcio' && (
          <Field label="Consorcio" required>
            <Select
              value={consorcioId}
              onChange={(e) => setConsorcioId(e.target.value)}
              disabled={!administracionId}
            >
              <option value="">— Elegir —</option>
              {consorcios.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}
                </option>
              ))}
            </Select>
          </Field>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label="Fecha de vencimiento" required>
            <Input
              type="date"
              value={fechaVto}
              onChange={(e) => setFechaVto(e.target.value)}
            />
          </Field>
          <Field label="Fecha de emisión">
            <Input
              type="date"
              value={fechaEmision}
              onChange={(e) => setFechaEmision(e.target.value)}
            />
          </Field>
        </div>

        <Field label="Descripción">
          <Input
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
            placeholder="Ej: Matrícula RPAC tomo 3 folio 124"
          />
        </Field>

        <Field label="Observaciones">
          <Textarea
            value={observaciones}
            onChange={(e) => setObservaciones(e.target.value)}
            rows={3}
            placeholder="Notas internas, condiciones especiales…"
          />
        </Field>
      </div>
    </Drawer>
  );
}
