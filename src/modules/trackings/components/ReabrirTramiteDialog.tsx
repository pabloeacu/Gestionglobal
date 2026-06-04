// ============================================================================
// ReabrirTramiteDialog · DGG-42 (2026-06-04) · Pablo
//
// Reapertura de un trámite que estaba cerrado. Pablo: "Podría ser un error de
// gerencia que debemos tener previsto para resolver. Lo que haremos es
// advertir que se está reabriendo y preguntar si desea informar la reapertura
// por mail al cliente."
//
// Flujo:
//   1. Advertencia visual (banner amber): estás revirtiendo un cierre y eso
//      va a reflejarse en todas las cards, KPIs y reportes del cliente.
//   2. Motivo (textarea, obligatorio). Se incluye en la línea automática de
//      tracking que se genera y, si se notifica al cliente, en el email.
//   3. Checkbox "Avisar al cliente por mail y push". Default OFF — el
//      operador decide caso por caso.
//   4. Confirmación. La RPC `tracking_reabrir` deja estado='en_progreso',
//      vacía fecha_fin / motivo_cierre / resuelto_at, incrementa
//      `reabierto_count` y genera la línea de tracking. Si el flag está
//      ON, encola email + push al cliente.
// ============================================================================
import { useEffect, useState } from 'react';
import { Loader2, RotateCcw, AlertTriangle } from 'lucide-react';
import { Button, Field, Modal, Textarea } from '@/components/common';
import { toast } from '@/lib/toast';
import { reabrirTracking } from '@/services/api/trackings';
import { humanizeError } from '@/lib/errors';

interface ReabrirTramiteDialogProps {
  open: boolean;
  onClose: () => void;
  tramiteId: string;
  tramiteTitulo: string;
  motivoCierreOriginal: string | null;
  /** Recarga del padre tras la reapertura exitosa. */
  onReabierto: () => void;
}

export function ReabrirTramiteDialog({
  open,
  onClose,
  tramiteId,
  tramiteTitulo,
  motivoCierreOriginal,
  onReabierto,
}: ReabrirTramiteDialogProps) {
  const [motivo, setMotivo] = useState('');
  const [notificar, setNotificar] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      setMotivo('');
      setNotificar(false);
      setLoading(false);
    }
  }, [open]);

  const puedeConfirmar = !loading && motivo.trim().length >= 4;

  async function handleConfirmar() {
    if (!puedeConfirmar) return;
    setLoading(true);
    const res = await reabrirTracking(tramiteId, motivo.trim(), notificar);
    setLoading(false);
    if (!res.ok) {
      toast.error('No pudimos reabrir el trámite', {
        description: humanizeError(res.error),
      });
      return;
    }
    toast.success(
      notificar
        ? 'Trámite reabierto. Le avisamos al cliente por mail y push.'
        : 'Trámite reabierto.',
    );
    onReabierto();
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={loading ? () => undefined : onClose}
      title="Reabrir trámite"
      kicker="Revertir el cierre"
      width={560}
      closeOnBackdrop={!loading}
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            onClick={() => void handleConfirmar()}
            disabled={!puedeConfirmar}
          >
            {loading ? (
              <>
                <Loader2 size={14} className="animate-spin" /> Reabriendo…
              </>
            ) : (
              <>
                <RotateCcw size={14} /> Reabrir trámite
              </>
            )}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Advertencia: la reapertura va a impactar reportes y comunicación */}
        <div className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-600" />
          <div className="space-y-1">
            <p className="font-semibold">Vas a revertir el cierre de este trámite.</p>
            <p>
              El trámite vuelve a estado <strong>en progreso</strong>. Las
              cards del cliente, los KPIs y los reportes se actualizan en
              consecuencia. La línea de cierre original queda en el historial
              pero ya no aparece como cierre vigente.
            </p>
            {motivoCierreOriginal && (
              <p className="text-xs">
                Cierre original: <em>"{motivoCierreOriginal}"</em>
              </p>
            )}
          </div>
        </div>

        <Field label="Motivo de la reapertura" required>
          <Textarea
            value={motivo}
            onChange={(e) => setMotivo(e.currentTarget.value)}
            rows={4}
            placeholder="Por qué reabrimos. Ej.: el cliente aportó documentación faltante / nos equivocamos al cerrar antes de cobrar / etc."
            maxLength={500}
          />
          <p className="mt-1 text-xs text-brand-muted">
            Se incluye en la línea automática de tracking. Si lo notificás al
            cliente, también va en el email.
          </p>
        </Field>

        <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
          <input
            type="checkbox"
            checked={notificar}
            onChange={(e) => setNotificar(e.currentTarget.checked)}
            className="mt-1 h-4 w-4 rounded border-slate-400 text-brand-cyan focus:ring-brand-cyan"
          />
          <div>
            <span className="font-semibold text-brand-ink">
              Avisar al cliente por mail y push
            </span>
            <p className="mt-0.5 text-xs text-brand-muted">
              Recomendado si la reapertura cambia el estado de algo que ya
              comunicamos. Si la reapertura es interna (corregir un error de
              gerencia que el cliente no vio), podés dejarlo apagado.
            </p>
            {notificar && (
              <p className="mt-2 text-xs text-cyan-700">
                Plantilla: <code>tramite-reabierto</code> · A:{' '}
                {tramiteTitulo}
              </p>
            )}
          </div>
        </label>
      </div>
    </Modal>
  );
}
