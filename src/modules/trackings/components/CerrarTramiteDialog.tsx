// ============================================================================
// CerrarTramiteDialog · DGG-38 · José Luis · (DGG-158, 2026-09-09: sin adjunto)
//
// Cierre de trámite con motivo + observaciones. El cierre puede ocurrir aunque
// NO haya certificado — el motivo define si fue satisfactorio o frustrado.
//
// DGG-158 (Pablo): el cierre NUNCA pide subir un archivo. El certificado de
// curso lo genera la propia plataforma (ligado al trámite) y las constancias de
// inscripción/renovación/DDJJ las emite el Estado y se las manda directo al
// cliente — la gestoría no las sube. Se eliminó el paso de "documento final".
//
// Flujo:
//   1. Selección de motivo (radio según categoría del trámite):
//        - curso: Concluyó / Abandonó / Desaprobó / Se arrepintió
//        - matricula | renovacion: Otorgada / Rechazada / Abandono
//        - dj: DDJJ presentada / rechazada / Abandono
//        - otros: Satisfactorio / Sin éxito / Abandono
//   2. Observaciones (textarea, opcional).
//
// El motivo + observaciones se persisten en `tramites.motivo_cierre` /
// `tramites.cierre_satisfactorio` y se vuelven parte de la última línea del
// trámite, con estado_asociado = 'finalizado' o 'frustrado'.
// ============================================================================
import { useEffect, useState, useMemo } from 'react';
import { Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { Button, Field, Modal, Textarea } from '@/components/common';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/cn';
import {
  MOTIVOS_CIERRE_POR_CATEGORIA,
  type MotivoCierreOpcion,
  type TramiteCategoria,
} from '@/services/api/tramites';
import { cerrarTracking } from '@/services/api/trackings';
import { humanizeError } from '@/lib/errors';

interface CerrarTramiteDialogProps {
  open: boolean;
  onClose: () => void;
  tramiteId: string;
  /**
   * Categoría del trámite — determina el catálogo de motivos que se ofrecen.
   */
  categoria: TramiteCategoria;
  /**
   * Se llama después de un cierre exitoso. El padre recarga el detalle y
   * (DGG-142 E3) encadena el flujo de "programar próximo vencimiento" en TODO
   * cierre con administración — `vigencia_meses` sólo pre-llena la fecha.
   */
  onCerrado: () => void;
}

export function CerrarTramiteDialog({
  open,
  onClose,
  tramiteId,
  categoria,
  onCerrado,
}: CerrarTramiteDialogProps) {
  const opciones = useMemo<MotivoCierreOpcion[]>(
    () => MOTIVOS_CIERRE_POR_CATEGORIA[categoria] ?? [],
    [categoria],
  );

  const [motivo, setMotivo] = useState<MotivoCierreOpcion | null>(null);
  const [observaciones, setObservaciones] = useState('');
  const [loading, setLoading] = useState(false);

  // Reset al abrir
  useEffect(() => {
    if (open) {
      setMotivo(null);
      setObservaciones('');
      setLoading(false);
    }
  }, [open]);

  const puedeContinuar = !loading && motivo !== null;

  async function handleAceptar() {
    if (!puedeContinuar || !motivo) return;
    setLoading(true);
    const res = await cerrarTracking(
      tramiteId,
      motivo.value,
      motivo.satisfactorio,
      observaciones.trim() || null,
      null, // DGG-158: el cierre no adjunta documento final
    );
    setLoading(false);
    if (!res.ok) {
      toast.error('No pudimos cerrar el trámite', { description: humanizeError(res.error) });
      return;
    }
    onCerrado();
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={loading ? () => undefined : onClose}
      title="Cerrar trámite"
      kicker="Motivo + observaciones"
      width={560}
      closeOnBackdrop={!loading}
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={handleAceptar} disabled={!puedeContinuar}>
            {loading ? (
              <>
                <Loader2 size={14} className="animate-spin" /> Cerrando…
              </>
            ) : (
              'Aceptar y cerrar'
            )}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {/* (1) Motivo */}
        <Field label="Motivo del cierre" hint="Elegí el resultado del trámite. Es obligatorio.">
          <div className="space-y-2">
            {opciones.map((op) => {
              const active = motivo?.value === op.value;
              const Icon = op.satisfactorio ? CheckCircle2 : XCircle;
              return (
                <button
                  key={op.value}
                  type="button"
                  onClick={() => setMotivo(op)}
                  className={cn(
                    'flex w-full items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition',
                    active
                      ? 'border-brand-cyan bg-brand-cyan-pale/30 ring-2 ring-brand-cyan/30'
                      : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50',
                  )}
                >
                  <Icon
                    size={18}
                    className={cn(
                      'mt-0.5 shrink-0',
                      op.satisfactorio ? 'text-emerald-600' : 'text-rose-500',
                    )}
                  />
                  <div className="flex-1">
                    <div className="text-sm font-medium text-brand-ink">{op.label}</div>
                    {op.descripcion && (
                      <div className="mt-0.5 text-xs text-brand-muted">{op.descripcion}</div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </Field>

        {/* (2) Observaciones */}
        <Field
          label="Observaciones"
          hint="Opcional. Se incorporan a la última línea del trámite como constancia."
        >
          <Textarea
            value={observaciones}
            onChange={(e) => setObservaciones(e.target.value)}
            placeholder="Ej.: el alumno avisó por WhatsApp que no continuaba. Se contactó al consorcio…"
            rows={3}
            maxLength={2000}
          />
        </Field>
      </div>
    </Modal>
  );
}
