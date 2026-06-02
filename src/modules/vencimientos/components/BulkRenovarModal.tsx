// ============================================================================
// BulkRenovarModal · renovar varios vencimientos en una sola operación
//   (DGG-34 / P5-6.B)
//
// UX: el usuario selecciona N vencimientos en el listado, abre este modal,
// define una fecha "aplicar a todos" (default = +1 año desde HOY), y opcio-
// nalmente puede overridear la fecha por fila desde el grid. Confirma →
// llama a `marcar_renovados_masivo` (RPC atómico). Si una falla, ninguna se
// renueva (mejor UX que dejar parcialmente aplicado).
//
// Mostramos por cada vencimiento: chip de tipo, sujeto (consorcio o adm),
// fecha actual, input fecha nueva. Validación: cada nueva fecha debe ser
// > actual. Si alguna inválida, el botón se deshabilita y se muestra el
// motivo del rechazo en color rosa.
// ============================================================================

import { useEffect, useMemo, useState } from 'react';
import { CalendarPlus, Loader2, RefreshCcw, Wand2 } from 'lucide-react';
import { Button, Field, Input, Modal } from '@/components/common';
import { toast } from '@/lib/toast';
import { formatDateLong } from '@/lib/dates';
import { cn } from '@/lib/cn';
import {
  marcarRenovadosMasivo,
  VENCIMIENTO_TIPO_LABEL,
  type ProximoVencimiento,
} from '@/services/api/vencimientos';
import { humanizeError } from '@/lib/errors';

interface BulkRenovarModalProps {
  open: boolean;
  onClose: () => void;
  vencimientos: ProximoVencimiento[];
  onRenewed?: () => void;
}

interface RowState {
  id: string;
  current: string; // YYYY-MM-DD
  next: string;    // YYYY-MM-DD
}

function plusOneYear(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  d.setFullYear(d.getFullYear() + 1);
  return d.toISOString().slice(0, 10);
}

export function BulkRenovarModal({
  open,
  onClose,
  vencimientos,
  onRenewed,
}: BulkRenovarModalProps) {
  const [rows, setRows] = useState<RowState[]>([]);
  const [aplicarTodos, setAplicarTodos] = useState<string>('');
  const [busy, setBusy] = useState(false);

  // Inicializar las filas cuando se abre el modal o cambia el set.
  useEffect(() => {
    if (!open) return;
    const initial: RowState[] = vencimientos.map((v) => ({
      id: v.id,
      current: v.fecha_vencimiento,
      next: plusOneYear(v.fecha_vencimiento),
    }));
    setRows(initial);
    // Default "aplicar a todos" = hoy + 1 año (típico para matrículas).
    const hoy = new Date();
    hoy.setFullYear(hoy.getFullYear() + 1);
    setAplicarTodos(hoy.toISOString().slice(0, 10));
  }, [open, vencimientos]);

  function setNextFor(id: string, value: string) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, next: value } : r)));
  }

  function aplicarMisma() {
    if (!aplicarTodos) return;
    setRows((prev) => prev.map((r) => ({ ...r, next: aplicarTodos })));
  }

  // Validación: cada nueva fecha > actual.
  const invalidIds = useMemo(
    () => rows.filter((r) => !r.next || r.next <= r.current).map((r) => r.id),
    [rows],
  );
  const ok = invalidIds.length === 0 && rows.length > 0;

  async function handleConfirm() {
    if (!ok) {
      toast.error('Hay filas con fecha inválida — deben ser posteriores a la actual.');
      return;
    }
    setBusy(true);
    const ids = rows.map((r) => r.id);
    const fechas = rows.map((r) => r.next);
    const res = await marcarRenovadosMasivo(ids, fechas);
    setBusy(false);
    if (!res.ok) {
      toast.error('No pudimos renovar el lote', { description: humanizeError(res.error) });
      return;
    }
    toast.success(
      `${res.data.length} ${res.data.length === 1 ? 'vencimiento renovado' : 'vencimientos renovados'}`,
    );
    onRenewed?.();
    onClose();
  }

  // Mapa id → ProximoVencimiento para mostrar metadata en la lista.
  const meta = useMemo(() => {
    const m = new Map<string, ProximoVencimiento>();
    for (const v of vencimientos) m.set(v.id, v);
    return m;
  }, [vencimientos]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Renovar ${rows.length} ${rows.length === 1 ? 'vencimiento' : 'vencimientos'}`}
      kicker="Acción masiva"
      icon={<RefreshCcw size={16} />}
      width={620}
      footer={
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-brand-muted">
            {invalidIds.length === 0
              ? `${rows.length} filas listas`
              : `${invalidIds.length} con fecha inválida`}
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              Cancelar
            </Button>
            <Button onClick={() => void handleConfirm()} disabled={!ok || busy}>
              {busy ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <CalendarPlus size={14} />
              )}
              Renovar todo
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4 text-sm">
        <p className="text-brand-muted">
          Definí una fecha "aplicar a todos" y ajustá por fila si querés
          (default: actual + 1 año). La operación es atómica: si una falla,
          ninguna se aplica.
        </p>

        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <Field label="Aplicar a todos los seleccionados">
            <div className="flex gap-2">
              <Input
                type="date"
                value={aplicarTodos}
                onChange={(e) => setAplicarTodos(e.target.value)}
              />
              <Button
                variant="secondary"
                onClick={aplicarMisma}
                disabled={!aplicarTodos}
                title="Pisar todas las filas con esta fecha"
              >
                <Wand2 size={13} /> Aplicar
              </Button>
            </div>
          </Field>
        </div>

        <div className="max-h-[44vh] space-y-1.5 overflow-y-auto pr-1">
          {rows.map((r) => {
            const v = meta.get(r.id);
            if (!v) return null;
            const invalida = invalidIds.includes(r.id);
            const sujeto =
              v.sujeto === 'consorcio' && v.consorcio_nombre
                ? v.consorcio_nombre
                : v.administracion_nombre ?? 'sin nombre';
            return (
              <div
                key={r.id}
                className={cn(
                  'flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-white p-3 transition',
                  invalida ? 'border-rose-200 bg-rose-50/40' : 'border-slate-200',
                )}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-brand-muted">
                    {VENCIMIENTO_TIPO_LABEL[v.tipo]}
                  </p>
                  <p className="truncate font-medium text-brand-ink">{sujeto}</p>
                  <p className="text-[11px] text-brand-muted">
                    Vencía {formatDateLong(r.current)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    type="date"
                    value={r.next}
                    min={r.current}
                    onChange={(e) => setNextFor(r.id, e.target.value)}
                    className={cn(
                      'h-9 text-sm',
                      invalida && 'border-rose-300 bg-white',
                    )}
                  />
                  {invalida && (
                    <span className="text-[10px] font-medium text-rose-700">
                      ↑ después de {r.current}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Modal>
  );
}
