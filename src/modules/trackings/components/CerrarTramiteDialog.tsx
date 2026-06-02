// ============================================================================
// CerrarTramiteDialog · DGG-38 + DGG-38 EXT (2026-06-02) · José Luis
//
// Cierre de trámite con motivo + observaciones + documento opcional.
// El cierre puede ocurrir aunque NO haya certificado — el motivo define
// si fue satisfactorio o frustrado.
//
// Flujo:
//   1. Selección de motivo (radio según categoría del trámite):
//        - curso: Concluyó / Abandonó / Desaprobó / Se arrepintió
//        - matricula | renovacion: Otorgada / Rechazada / Abandono
//        - otros: Satisfactorio / Sin éxito / Abandono
//      Cada motivo trae `satisfactorio: bool` y `requiere_documento: bool`.
//   2. Observaciones (textarea, opcional pero siempre disponible).
//   3. Documento final (solo si el motivo lo requiere):
//        tabs "Subir archivo" / "Pegar URL".
//        El upload va al bucket público `tramite-documento-final`.
//
// El motivo + observaciones se persisten en `tramites.motivo_cierre` /
// `tramites.cierre_satisfactorio` y se vuelven parte de la última línea
// del trámite ("Trámite cerrado: <motivo>. <observaciones>") con
// estado_asociado = 'finalizado' o 'frustrado'.
// ============================================================================
import { useEffect, useState, useRef, useMemo } from 'react';
import {
  Link2, Upload, FileText, X, Loader2, CheckCircle2, XCircle,
} from 'lucide-react';
import { Button, Field, Input, Modal, Textarea } from '@/components/common';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/cn';
import {
  subirDocumentoFinalTramite,
  MOTIVOS_CIERRE_POR_CATEGORIA,
  tipoDocumentoLabel,
  type MotivoCierreOpcion,
  type TramiteCategoria,
} from '@/services/api/tramites';
import { cerrarTracking } from '@/services/api/trackings';
import { humanizeError } from '@/lib/errors';

type Modo = 'archivo' | 'url';

interface CerrarTramiteDialogProps {
  open: boolean;
  onClose: () => void;
  tramiteId: string;
  /**
   * Categoría del trámite — determina el catálogo de motivos que se ofrecen.
   */
  categoria: TramiteCategoria;
  /**
   * Se llama después de un cierre exitoso. El padre típicamente recarga el
   * detalle y dispara el flujo de "programar próximo vencimiento" si el
   * servicio tiene `vigencia_meses`.
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
  const [modo, setModo] = useState<Modo>('archivo');
  const [file, setFile] = useState<File | null>(null);
  const [urlExterna, setUrlExterna] = useState('');
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Reset al abrir
  useEffect(() => {
    if (open) {
      setMotivo(null);
      setObservaciones('');
      setModo('archivo');
      setFile(null);
      setUrlExterna('');
      setLoading(false);
    }
  }, [open]);

  const requiereDoc = !!motivo?.requiere_documento;
  const tieneDocSiAplica = !requiereDoc
    || (modo === 'archivo' && file !== null)
    || (modo === 'url' && urlExterna.trim().length > 5);
  const puedeContinuar = !loading && motivo !== null && tieneDocSiAplica;

  async function handleAceptar() {
    if (!puedeContinuar || !motivo) return;
    setLoading(true);
    let urlFinal: string | null = null;

    if (requiereDoc) {
      if (modo === 'archivo' && file) {
        const up = await subirDocumentoFinalTramite(tramiteId, file);
        if (!up.ok) {
          setLoading(false);
          toast.error('No pudimos subir el archivo', { description: humanizeError(up.error) });
          return;
        }
        urlFinal = up.data;
      } else if (modo === 'url') {
        let u = urlExterna.trim();
        if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
        urlFinal = u;
      }
    }

    const res = await cerrarTracking(
      tramiteId,
      motivo.value,
      motivo.satisfactorio,
      observaciones.trim() || null,
      urlFinal,
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
                  {op.requiere_documento && (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-brand-muted">
                      {tipoDocumentoLabel(op.tipo_documento)}
                    </span>
                  )}
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

        {/* (3) Documento — solo si el motivo lo requiere */}
        {requiereDoc && motivo && (
          <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wider text-brand-muted">
                {tipoDocumentoLabel(motivo.tipo_documento)} final
              </p>
              <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-rose-700">
                Obligatorio
              </span>
            </div>
            <div className="flex gap-2 rounded-lg bg-white p-1">
              <button
                type="button"
                onClick={() => setModo('archivo')}
                className={cn(
                  'flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition',
                  modo === 'archivo'
                    ? 'bg-brand-cyan-pale text-brand-cyan'
                    : 'text-brand-muted hover:text-brand-ink',
                )}
              >
                <Upload size={14} /> Subir archivo
              </button>
              <button
                type="button"
                onClick={() => setModo('url')}
                className={cn(
                  'flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition',
                  modo === 'url'
                    ? 'bg-brand-cyan-pale text-brand-cyan'
                    : 'text-brand-muted hover:text-brand-ink',
                )}
              >
                <Link2 size={14} /> Pegar URL
              </button>
            </div>

            {modo === 'archivo' ? (
              <div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx,application/pdf,image/*,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  onChange={(e) => {
                    const f = e.target.files?.[0] ?? null;
                    if (f && f.size > 20 * 1024 * 1024) {
                      toast.error('El archivo supera los 20 MB');
                      return;
                    }
                    setFile(f);
                  }}
                  className="block w-full text-sm text-brand-muted file:mr-3 file:rounded-lg file:border-0 file:bg-brand-cyan file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white hover:file:bg-brand-cyan/90"
                />
                {file && (
                  <div className="mt-2 flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
                    <FileText size={14} className="text-brand-cyan" />
                    <span className="flex-1 truncate" title={file.name}>{file.name}</span>
                    <span className="text-xs text-brand-muted">{(file.size / 1024).toFixed(0)} KB</span>
                    <button
                      type="button"
                      onClick={() => {
                        setFile(null);
                        if (fileInputRef.current) fileInputRef.current.value = '';
                      }}
                      className="rounded-md p-0.5 text-brand-muted transition hover:bg-slate-100 hover:text-brand-ink"
                      aria-label="Quitar archivo"
                    >
                      <X size={14} />
                    </button>
                  </div>
                )}
                <p className="mt-1.5 text-xs text-brand-muted">
                  PDF, imagen (JPG/PNG/WebP), Word o Excel. Hasta 20 MB.
                </p>
              </div>
            ) : (
              <Input
                type="url"
                value={urlExterna}
                onChange={(e) => setUrlExterna(e.target.value)}
                placeholder="https://…"
              />
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
