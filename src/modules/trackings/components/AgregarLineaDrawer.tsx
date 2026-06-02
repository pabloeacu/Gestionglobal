import { useState } from 'react';
import { toast } from '@/lib/toast';
import { Drawer, Button, Field, Select, Textarea } from '@/components/common';
import {
  agregarLinea,
  type TrackingCategoriaConfigRow,
  type TrackingEstadoConfigRow,
} from '@/services/api/trackings';
import { humanizeError } from '@/lib/errors';

export interface AgregarLineaDrawerProps {
  open: boolean;
  onClose: () => void;
  trackingId: string;
  categorias: TrackingCategoriaConfigRow[];
  estados: TrackingEstadoConfigRow[];
  permiteCambiarEstado: boolean;  // staff = true
  onSaved: () => void;
}

export function AgregarLineaDrawer({
  open,
  onClose,
  trackingId,
  categorias,
  estados,
  permiteCambiarEstado,
  onSaved,
}: AgregarLineaDrawerProps) {
  const [categoria, setCategoria] = useState<string>(categorias[0]?.slug ?? 'seguimiento_interno');
  const [descripcion, setDescripcion] = useState('');
  const [estadoAsociado, setEstadoAsociado] = useState<string>('');
  const [archivosTxt, setArchivosTxt] = useState('');
  const [alertaEn, setAlertaEn] = useState('');
  const [visibleCliente, setVisibleCliente] = useState(false);
  const [saving, setSaving] = useState(false);

  function reset() {
    setCategoria(categorias[0]?.slug ?? 'seguimiento_interno');
    setDescripcion('');
    setEstadoAsociado('');
    setArchivosTxt('');
    setAlertaEn('');
    setVisibleCliente(false);
  }

  async function handleSave() {
    if (!descripcion.trim()) {
      toast.error('La descripción es obligatoria');
      return;
    }
    setSaving(true);
    const urls = archivosTxt
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const res = await agregarLinea(trackingId, {
      categoria,
      descripcion: descripcion.trim(),
      estado_asociado: permiteCambiarEstado && estadoAsociado ? estadoAsociado : null,
      archivos_urls: urls,
      alerta_en: alertaEn ? new Date(alertaEn).toISOString() : null,
      visible_cliente: visibleCliente,
    });
    setSaving(false);
    if (!res.ok) {
      toast.error(humanizeError(res.error));
      return;
    }
    toast.success('Línea agregada');
    reset();
    onSaved();
    onClose();
  }

  return (
    <Drawer open={open} onClose={onClose} title="Agregar línea al tracking" width={520}>
      <div className="space-y-4">
        <Field label="Categoría" required>
          <Select value={categoria} onChange={(e) => setCategoria(e.target.value)}>
            {categorias.map((c) => (
              <option key={c.id} value={c.slug}>
                {c.label}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Descripción" required>
          <Textarea
            rows={5}
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
            placeholder="Describí el avance, la observación, el contacto realizado…"
          />
        </Field>

        {permiteCambiarEstado && (
          <Field label="Cambiar estado del tracking (opcional)">
            <Select value={estadoAsociado} onChange={(e) => setEstadoAsociado(e.target.value)}>
              <option value="">No cambiar</option>
              {estados.map((e) => (
                <option key={e.id} value={e.slug}>
                  {e.label}
                </option>
              ))}
            </Select>
          </Field>
        )}

        <Field label="Adjuntos (1 URL por línea, opcional)">
          <Textarea
            rows={3}
            value={archivosTxt}
            onChange={(e) => setArchivosTxt(e.target.value)}
            placeholder="https://…"
          />
        </Field>

        <Field
          label="Alerta futura (opcional)"
          hint="Si completás una fecha futura, se enviará un email de recordatorio."
        >
          <input
            type="datetime-local"
            value={alertaEn}
            onChange={(e) => setAlertaEn(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-200"
          />
        </Field>

        {/* ¿El cliente lo ve? — encola push + email al cliente con template
            tracking-avance-cliente. Default false = nota interna. */}
        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-cyan-200 bg-cyan-50/50 p-3 text-sm hover:bg-cyan-50 transition-colors">
          <input
            type="checkbox"
            checked={visibleCliente}
            onChange={(e) => setVisibleCliente(e.target.checked)}
            className="mt-0.5 h-4 w-4 cursor-pointer rounded border-slate-300 text-cyan-600 focus:ring-cyan-500"
          />
          <div className="flex-1">
            <div className="font-semibold text-slate-800">¿El cliente lo ve?</div>
            <div className="mt-0.5 text-xs leading-relaxed text-slate-600">
              Si lo activás, esta línea aparece en el portal del cliente y le llega
              <strong> aviso push + email</strong> al instante. Si lo dejás vacío,
              queda como nota interna del equipo.
            </div>
          </div>
        </label>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Guardando…' : 'Agregar línea'}
          </Button>
        </div>
      </div>
    </Drawer>
  );
}
