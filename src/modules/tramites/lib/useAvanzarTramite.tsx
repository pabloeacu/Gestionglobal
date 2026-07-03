// DGG-87 · Única vía para cambiar el estado de un trámite desde la UI de gerencia.
// La comparten el Kanban (drag + botón →) y la Lista (botón de avance), así el
// atajo de la lista hace EXACTAMENTE lo mismo que el kanban: misma mutación
// (`updateTramite` → la BD es la fuente de verdad), mismo gate de cobranza
// (DGG-44) y mismos toasts. Cada vista pasa su propio update optimista + recarga.
import { useRef } from 'react';
import { useConfirm, useAlert } from '@/components/common';
import { toast } from '@/lib/toast';
import { humanizeError } from '@/lib/errors';
import {
  updateTramite,
  tramiteCancelar,
  tramiteCobroResumen,
  tramitePostCancelacionInfo,
  tramiteAvisarCancelacion,
  esAvanceTramite,
  TRAMITE_ESTADO_LABEL,
  type TramiteEstado,
  type TramiteCancelarResult,
  type MovableTramite,
} from '@/services/api/tramites';
import { desasignarAlumno } from '@/services/api/campus';

const fmtARS = (n: number) =>
  n.toLocaleString('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

// DGG-95 (reporte JL) · Diálogo de cancelación REUSABLE. Cancelar un trámite con un
// comprobante vinculado debe ofrecer anular el comprobante para que lo ya pagado quede
// como SALDO A FAVOR (en vez de dejar deuda fantasma). Decisión de Pablo: "preguntar al
// cancelar". Los comprobantes fiscales (CAE) se avisan y NO se anulan. Este hook lo usan
// TODAS las superficies que cancelan (kanban/lista vía useAvanzarTramite + tracking detail),
// así ninguna saltea la cascada `tramite_cancelar`.
export function useCancelarTramite() {
  const confirm = useConfirm();
  const alert = useAlert();
  // DGG-95 §6 · guard de reentrancy: evita que un doble-click en la ventana async
  // previa al 1er diálogo dispare la cancelación (y sus ofertas) dos veces —
  // protege también el `resolver` compartido del DialogProvider.
  const enCurso = useRef(false);
  return async function cancelarConDialogo(
    tramiteId: string,
    codigo: string,
  ): Promise<TramiteCancelarResult | null> {
    if (enCurso.current) return null;
    enCurso.current = true;
    try {
    const resumenRes = await tramiteCobroResumen(tramiteId);
    const resumen = resumenRes.ok ? resumenRes.data : null;
    let anular = false;

    if (resumen?.tiene_comprobante) {
      if (!resumen.tiene_anulable && resumen.tiene_cae) {
        // Sólo hay comprobante fiscal → no se puede anular acá (avisar y frenar).
        const ok = await confirm({
          title: 'Cancelar trámite',
          message: (
            <div className="space-y-2">
              <p>
                El comprobante vinculado es <strong>fiscal</strong> (tiene CAE): no se puede
                anular desde acá, corresponde una <strong>nota de crédito</strong>.
              </p>
              <p>Se cancela el trámite y el comprobante queda como está.</p>
            </div>
          ),
          confirmLabel: 'Cancelar trámite',
          cancelLabel: 'Volver',
          danger: true,
        });
        if (!ok) return null;
      } else if (resumen.tiene_anulable) {
        const pagado = resumen.pagado_anulable;
        anular = await confirm({
          title: 'Cancelar trámite',
          message: (
            <div className="space-y-2">
              {pagado > 0 ? (
                <p>
                  Este trámite tiene un comprobante con <strong>{fmtARS(pagado)}</strong> ya
                  cobrado.
                </p>
              ) : (
                <p>Este trámite tiene un comprobante impago vinculado.</p>
              )}
              <p>
                ¿Anular el comprobante
                {pagado > 0
                  ? ' y dejar lo pagado como saldo a favor del cliente'
                  : ' (borra la deuda)'}
                ?
              </p>
              <p className="text-brand-muted">
                Si elegís “No tocar”, el trámite se cancela pero el comprobante
                {pagado > 0 ? ' y su saldo' : ''} quedan como están.
              </p>
              {resumen.tiene_cae && (
                <p className="text-amber-700">
                  Además hay un comprobante fiscal (CAE) que <strong>no</strong> se anulará
                  (requiere nota de crédito).
                </p>
              )}
            </div>
          ),
          confirmLabel: pagado > 0 ? 'Anular → saldo a favor' : 'Anular comprobante',
          cancelLabel: 'No tocar',
        });
      }
    }

    const res = await tramiteCancelar(
      tramiteId,
      anular,
      codigo ? `Trámite ${codigo} cancelado` : 'Trámite cancelado',
    );
    if (!res.ok) {
      toast.error(`No pudimos cancelar el trámite: ${humanizeError(res.error)}`);
      return null;
    }
    if (res.data.anulados.length > 0) {
      const sf = res.data.saldo_a_favor;
      toast.success(
        sf > 0
          ? `Trámite ${codigo} cancelado · comprobante anulado · ${fmtARS(sf)} quedó como saldo a favor`
          : `Trámite ${codigo} cancelado · comprobante anulado`,
      );
    } else {
      toast.success(`Trámite ${codigo || ''} cancelado`.trim());
    }

    // DGG-95 (pedido Pablo) · Ofertas OPT-IN (no automáticas) tras cancelar:
    // (B) avisar al cliente por mail · (A) retirar al alumno de la matrícula del curso.
    const info = await tramitePostCancelacionInfo(tramiteId);
    if (info.ok) {
      // (B) Mail de aviso al cliente.
      if (info.data.solicitante_email) {
        const enviar = await confirm({
          title: 'Avisar al cliente',
          message: `¿Le enviamos un mail a ${info.data.solicitante_email} avisándole que el trámite se canceló?`,
          confirmLabel: 'Enviar mail',
          cancelLabel: 'No hace falta',
        });
        if (enviar) {
          const r = await tramiteAvisarCancelacion(tramiteId);
          if (r.ok) toast.success('Mail de cancelación enviado al cliente');
          else toast.error(`No se pudo enviar el mail: ${humanizeError(r.error)}`);
        }
      }
      // (A) Retirar al alumno de la matrícula (si el solicitante tiene matrícula/s activas).
      const mats = info.data.matriculas;
      const soloMat = mats.length === 1 ? mats[0] : undefined;
      if (soloMat) {
        const m = soloMat;
        const retirar = await confirm({
          title: 'Retirar de la matrícula',
          message: (
            <div className="space-y-2">
              <p>
                {m.alumno_nombre ?? 'El alumno'} está matriculado en{' '}
                <strong>{m.curso_nombre}</strong>.
              </p>
              <p>¿Lo retirás de esa matrícula del campus?</p>
            </div>
          ),
          confirmLabel: 'Retirar de la matrícula',
          cancelLabel: 'Dejar la matrícula',
          danger: true,
        });
        if (retirar) {
          const r = await desasignarAlumno(m.matricula_id);
          if (r.ok) toast.success(`${m.alumno_nombre ?? 'Alumno'} retirado de ${m.curso_nombre}`);
          else toast.error(humanizeError(r.error));
        }
      } else if (mats.length > 1) {
        await alert({
          title: 'Retirar de la matrícula',
          message: `El alumno tiene ${mats.length} matrículas activas (${mats
            .map((m) => m.curso_nombre)
            .join(', ')}). Retiralas desde Campus → el curso → pestaña Alumnos.`,
        });
      }
    }
    return res.data;
    } finally {
      enCurso.current = false;
    }
  };
}

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
  const cancelarConDialogo = useCancelarTramite();
  return async function mover(
    t: MovableTramite,
    nuevoEstado: TramiteEstado,
  ): Promise<boolean> {
    if (t.estado === nuevoEstado) return false;

    // DGG-95 · Cancelar pasa por el diálogo reusable (cascada a saldo a favor).
    if (nuevoEstado === 'cancelado') {
      const result = await cancelarConDialogo(t.id, t.codigo);
      if (!result) return false; // abort del usuario o error (ya avisado)
      opts.onOptimistic?.(t.id, nuevoEstado);
      opts.play?.('success');
      return true;
    }

    // DGG-88 · El gate dispara igual con saldo pendiente, pero el copy distingue el
    // MOTIVO real (cobro_estado): un pago a cuenta NO es lo mismo que "sin cobranza".
    const cobroParcial = t.cobro_estado === 'parcial';
    const cobroDetalle = cobroParcial
      ? 'tiene un pago a cuenta, pero el comprobante todavía no está cancelado (queda saldo pendiente)'
      : 'no tiene ninguna cobranza registrada (está impago)';
    // DGG-88 · regla dura: NO se puede CERRAR un trámite impago (resuelto sí puede).
    // El trigger trg_tramite_cerrar_exige_cobrado es el backstop en BD; acá damos
    // feedback inmediato sin ida y vuelta.
    if (nuevoEstado === 'cerrado' && t.cobro_pendiente) {
      toast.error(
        `No se puede cerrar: el trámite ${cobroDetalle}. ` +
          `${cobroParcial ? 'Completá' : 'Registrá'} la cobranza ` +
          '(o anulá/bonificá el comprobante) antes de cerrar.',
      );
      return false;
    }
    // DGG-44 · gate de cobranza (soft) al AVANZAR un trámite impago.
    if (esAvanceTramite(t.estado as TramiteEstado, nuevoEstado) && t.cobro_pendiente) {
      const ok = await confirm({
        title: cobroParcial ? 'Trámite con saldo pendiente' : 'Trámite impago',
        message: (
          <div className="space-y-2">
            <p>Este trámite {cobroDetalle}.</p>
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
