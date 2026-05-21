// ============================================================================
// ProgramarVencimientoModal · cierre de ciclo del tracking + creación de
// próximo vencimiento con alarmas configurables (mig 0040).
//
// Flujo:
//   1. Usuario elige fecha del próximo vencimiento.
//   2. Marca offsets de alarma (chips multi-select; defaults 30/7/2).
//   3. Switch "Notificar al administrador por email" (default ON).
//   4. Preview cronograma con fechas calculadas (`fecha - offset`).
//   5. Botón "Programar" → RPC tracking_cerrar_ciclo, toast de éxito, refresh.
// ============================================================================
import { useEffect, useMemo, useState } from 'react';
import { CalendarClock, Check, Plus, Trash2 } from 'lucide-react';
import { Button, Field, Input, Modal } from '@/components/common';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/cn';
import { cerrarCicloTracking } from '@/services/api/trackings';

interface PresetOffset {
  value: number;
  label: string;
}

const OFFSETS_PRESET: ReadonlyArray<PresetOffset> = [
  { value: 30, label: '1 mes' },
  { value: 15, label: '15 días' },
  { value: 7, label: '1 semana' },
  { value: 2, label: '2 días' },
  { value: 1, label: '1 día' },
  { value: 0, label: 'El día' },
];

const OFFSETS_DEFAULT: number[] = [30, 7, 2];

function formatearFechaLarga(date: Date): string {
  return date.toLocaleDateString('es-AR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function offsetLabel(offset: number): string {
  const p = OFFSETS_PRESET.find((o) => o.value === offset);
  if (p) return `${p.label} antes`.replace('El día antes', 'el día');
  if (offset === 1) return '1 día antes';
  return `${offset} días antes`;
}

interface ProgramarVencimientoModalProps {
  open: boolean;
  onClose: () => void;
  trackingId: string;
  trackingTitulo?: string;
  periodoSugeridoDias?: number; // defaults a 365
  onProgramado?: () => void;
}

export function ProgramarVencimientoModal({
  open,
  onClose,
  trackingId,
  trackingTitulo,
  periodoSugeridoDias = 365,
  onProgramado,
}: ProgramarVencimientoModalProps) {
  const [fecha, setFecha] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() + periodoSugeridoDias);
    return d.toISOString().slice(0, 10);
  });
  const [offsets, setOffsets] = useState<number[]>(OFFSETS_DEFAULT);
  const [customInput, setCustomInput] = useState<string>('');
  const [notificar, setNotificar] = useState<boolean>(true);
  const [submitting, setSubmitting] = useState<boolean>(false);

  // Reset al abrir
  useEffect(() => {
    if (!open) return;
    const d = new Date();
    d.setDate(d.getDate() + periodoSugeridoDias);
    setFecha(d.toISOString().slice(0, 10));
    setOffsets(OFFSETS_DEFAULT);
    setCustomInput('');
    setNotificar(true);
    setSubmitting(false);
  }, [open, periodoSugeridoDias]);

  function togglePreset(value: number) {
    setOffsets((prev) =>
      prev.includes(value) ? prev.filter((o) => o !== value) : [...prev, value].sort((a, b) => b - a),
    );
  }

  function agregarCustom() {
    const n = parseInt(customInput, 10);
    if (!Number.isFinite(n) || n < 0 || n > 730) {
      toast.error('Ingresá un número entre 0 y 730 días.');
      return;
    }
    if (offsets.includes(n)) {
      toast.info('Ese offset ya está en la lista.');
      setCustomInput('');
      return;
    }
    setOffsets((prev) => [...prev, n].sort((a, b) => b - a));
    setCustomInput('');
  }

  const preview = useMemo(() => {
    if (!fecha) return [];
    const base = new Date(fecha + 'T09:00:00');
    if (Number.isNaN(base.getTime())) return [];
    return offsets
      .slice()
      .sort((a, b) => b - a)
      .map((offset) => {
        const d = new Date(base);
        d.setDate(d.getDate() - offset);
        return {
          offset,
          fecha: d,
          label: `${formatearFechaLarga(d)} · ${offsetLabel(offset)}`,
        };
      });
  }, [fecha, offsets]);

  async function handleProgramar() {
    if (!fecha) {
      toast.error('Elegí una fecha.');
      return;
    }
    if (offsets.length === 0) {
      toast.error('Agregá al menos una alarma.');
      return;
    }
    setSubmitting(true);
    const res = await cerrarCicloTracking({
      trackingId,
      proximaFecha: fecha,
      alarmasOffsets: offsets,
      notificarCliente: notificar,
    });
    setSubmitting(false);
    if (!res.ok) {
      toast.error(res.error.message);
      return;
    }
    toast.success(`Vencimiento programado · ${res.data.alarmasPlanificadas.length} avisos en agenda`);
    onProgramado?.();
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Programar próximo vencimiento"
      kicker={trackingTitulo ? `Tracking · ${trackingTitulo}` : 'Tracking'}
      icon={<CalendarClock className="h-5 w-5 text-brand-cyan" />}
      width={560}
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Cancelar
          </Button>
          <Button onClick={() => void handleProgramar()} disabled={submitting}>
            <Check className="h-4 w-4" /> {submitting ? 'Programando...' : 'Programar'}
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        <Field label="Fecha del próximo vencimiento">
          <Input
            type="date"
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
            min={new Date().toISOString().slice(0, 10)}
          />
        </Field>

        <div className="space-y-2">
          <p className="text-sm font-semibold text-brand-ink">Alarmas</p>
          <p className="text-xs text-brand-muted">
            Elegí cuándo querés recibir el aviso. Pueden combinarse.
          </p>
          <div className="flex flex-wrap gap-2">
            {OFFSETS_PRESET.map((o) => {
              const activo = offsets.includes(o.value);
              return (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => togglePreset(o.value)}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition',
                    activo
                      ? 'border-brand-cyan/50 bg-brand-cyan/10 text-brand-cyan'
                      : 'border-slate-200 bg-white text-brand-muted hover:border-slate-300 hover:text-brand-ink',
                  )}
                >
                  {activo && <Check size={11} />}
                  {o.label}
                </button>
              );
            })}
            {/* Chips custom agregados manualmente que no están en presets */}
            {offsets
              .filter((o) => !OFFSETS_PRESET.some((p) => p.value === o))
              .map((o) => (
                <span
                  key={`custom-${o}`}
                  className="inline-flex items-center gap-1.5 rounded-full border border-brand-cyan/50 bg-brand-cyan/10 px-3 py-1 text-xs font-medium text-brand-cyan"
                >
                  <Check size={11} />
                  {o} días antes
                  <button
                    type="button"
                    onClick={() => setOffsets((prev) => prev.filter((p) => p !== o))}
                    className="ml-1 text-brand-cyan/70 hover:text-brand-cyan"
                    aria-label={`Quitar ${o} días`}
                  >
                    <Trash2 size={11} />
                  </button>
                </span>
              ))}
          </div>
          <div className="flex items-center gap-2 pt-1">
            <Input
              type="number"
              placeholder="Personalizado · días"
              value={customInput}
              onChange={(e) => setCustomInput(e.target.value)}
              min={0}
              max={730}
              className="!w-44"
            />
            <Button variant="ghost" onClick={agregarCustom} disabled={!customInput}>
              <Plus size={12} /> Agregar
            </Button>
          </div>
        </div>

        <label className="flex items-center gap-3 rounded-md border border-slate-200 bg-slate-50/50 px-3 py-2 text-sm">
          <input
            type="checkbox"
            checked={notificar}
            onChange={(e) => setNotificar(e.target.checked)}
            className="h-4 w-4 accent-brand-cyan"
          />
          <span className="flex-1">
            <span className="font-medium text-brand-ink">Notificar al administrador por email</span>
            <span className="block text-xs text-brand-muted">
              Cada alarma envía un push interno + email al cliente cuando esté activo.
            </span>
          </span>
        </label>

        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-brand-muted">
            Cronograma previsto
          </p>
          {preview.length === 0 ? (
            <p className="text-xs text-brand-muted">Agregá alarmas para ver el cronograma.</p>
          ) : (
            <ul className="space-y-1 text-sm text-brand-ink">
              {preview.map((p) => (
                <li key={`p-${p.offset}`} className="flex items-center gap-2">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-brand-cyan" />
                  {p.label}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Modal>
  );
}

export default ProgramarVencimientoModal;
