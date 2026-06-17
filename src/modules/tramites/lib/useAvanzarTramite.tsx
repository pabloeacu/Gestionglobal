// DGG-87 · Única vía para cambiar el estado de un trámite desde la UI de gerencia.
// La comparten el Kanban (drag + botón →) y la Lista (botón de avance), así el
// atajo de la lista hace EXACTAMENTE lo mismo que el kanban: misma mutación
// (`updateTramite` → la BD es la fuente de verdad), mismo gate de cobranza
// (DGG-44) y mismos toasts. Cada vista pasa su propio update optimista + recarga.
import { useConfirm } from '@/components/common';
import { toast } from '@/lib/toast';
import { humanizeError } from '@/lib/errors';
import {
  updateTramite,
  esAvanceTramite,
  TRAMITE_ESTADO_LABEL,
  type TramiteEstado,
  type TramiteListItem,
} from '@/services/api/tramites';

interface Opts {
  /** Update optimista local (la vista actualiza su propio universo). */
  onOptimistic?: (id: string, nuevoEstado: TramiteEstado) => void;
  /** Recargar/revertir si la persistencia falla. */
  onError?: () => void;
  /** Sonido opcional (lo usa el kanban). */
  play?: (sound: 'click' | 'success') => void;
}

export function useAvanzarTramite(opts: Opts = {}) {
  const confirm = useConfirm();
  return async function mover(
    t: TramiteListItem,
    nuevoEstado: TramiteEstado,
  ): Promise<boolean> {
    if (t.estado === nuevoEstado) return false;
    // DGG-88 · regla dura: NO se puede CERRAR un trámite impago (resuelto sí puede).
    // El trigger trg_tramite_cerrar_exige_cobrado es el backstop en BD; acá damos
    // feedback inmediato sin ida y vuelta.
    if (nuevoEstado === 'cerrado' && t.cobro_pendiente) {
      toast.error(
        'No se puede cerrar: el trámite tiene cobro pendiente. Registrá la cobranza ' +
          '(o anulá/bonificá el comprobante) antes de cerrar.',
      );
      return false;
    }
    // DGG-44 · gate de cobranza (soft) al AVANZAR un trámite impago.
    if (esAvanceTramite(t.estado as TramiteEstado, nuevoEstado) && t.cobro_pendiente) {
      const ok = await confirm({
        title: 'Trámite impago',
        message: (
          <div className="space-y-2">
            <p>Este trámite no tiene cobranza registrada. Por lo tanto, está impago.</p>
            <p>¿Desea avanzar la gestión de todos modos?</p>
          </div>
        ),
        confirmLabel: 'Avanzar',
        cancelLabel: 'Cancelar',
      });
      if (!ok) return false;
    }
    opts.onOptimistic?.(t.id, nuevoEstado);
    opts.play?.('click');
    const res = await updateTramite(t.id, { estado: nuevoEstado });
    if (!res.ok) {
      toast.error(`No pudimos mover el trámite: ${humanizeError(res.error)}`);
      opts.onError?.();
      return false;
    }
    opts.play?.('success');
    toast.success(`Trámite ${t.codigo} → ${TRAMITE_ESTADO_LABEL[nuevoEstado]}`);
    return true;
  };
}
