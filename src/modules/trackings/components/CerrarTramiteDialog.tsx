// ============================================================================
// CerrarTramiteDialog · DGG-38 (2026-06-02) · José Luis
//
// Reemplaza el `usePrompt()` simple que solo aceptaba URL externa. Ahora el
// staff puede:
//   - Subir un archivo (PDF, imagen, doc) → se guarda en bucket público
//     `tramite-documento-final` y se obtiene una URL estable.
//   - O pegar una URL externa (Drive, mail link, etc.).
//
// El "documento final" se guarda en `tramites.documento_final_url` y se
// agrega como adjunto de la línea automática "Tracking cerrado.
// Documento final adjunto." (categoría `certificado_emitido`,
// estado_asociado `finalizado`).
//
// Auto-cierre: cuando el alumno aprueba un curso del Campus y se emite
// el certificado, el trigger `trg_certificado_cierra_tramite_curso` lo
// cierra automáticamente sin pasar por este modal (mig 0181).
// ============================================================================
import { useEffect, useState, useRef } from 'react';
import { Link2, Upload, FileText, X, Loader2 } from 'lucide-react';
import { Button, Field, Input, Modal } from '@/components/common';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/cn';
import { subirDocumentoFinalTramite } from '@/services/api/tramites';
import { cerrarTracking } from '@/services/api/trackings';
import { humanizeError } from '@/lib/errors';

type Modo = 'archivo' | 'url';

interface CerrarTramiteDialogProps {
  open: boolean;
  onClose: () => void;
  tramiteId: string;
  /**
   * Se llama después de un cierre exitoso. El padre típicamente recarga el
   * detalle (`load()`) y dispara el flujo de "programar próximo vencimiento"
   * si el servicio tiene `vigencia_meses`.
   */
  onCerrado: () => void;
}

export function CerrarTramiteDialog({
  open,
  onClose,
  tramiteId,
  onCerrado,
}: CerrarTramiteDialogProps) {
  const [modo, setModo] = useState<Modo>('archivo');
  const [file, setFile] = useState<File | null>(null);
  const [urlExterna, setUrlExterna] = useState('');
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Reset al abrir
  useEffect(() => {
    if (open) {
      setModo('archivo');
      setFile(null);
      setUrlExterna('');
      setLoading(false);
    }
  }, [open]);

  const puedeContinuar =
    !loading && ((modo === 'archivo' && file !== null) || (modo === 'url' && urlExterna.trim().length > 5));

  async function handleAceptar() {
    if (!puedeContinuar) return;
    setLoading(true);
    let urlFinal: string;

    if (modo === 'archivo' && file) {
      const up = await subirDocumentoFinalTramite(tramiteId, file);
      if (!up.ok) {
        setLoading(false);
        toast.error('No pudimos subir el archivo', { description: humanizeError(up.error) });
        return;
      }
      urlFinal = up.data;
    } else {
      urlFinal = urlExterna.trim();
      // Sanity light: si no arranca con http, lo prefijamos
      if (!/^https?:\/\//i.test(urlFinal)) {
        urlFinal = 'https://' + urlFinal;
      }
    }

    const res = await cerrarTracking(tramiteId, urlFinal);
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
      kicker="Documento final"
      width={520}
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
        <p className="text-sm text-brand-muted">
          Adjuntá el documento que cierra este trámite (certificado, diploma,
          comprobante final). Podés <strong>subir un archivo</strong> desde tu
          equipo o <strong>pegar una URL</strong> si el documento ya está en
          la nube.
        </p>

        {/* Tabs modo */}
        <div className="flex gap-2 rounded-xl bg-slate-100 p-1">
          <button
            type="button"
            onClick={() => setModo('archivo')}
            className={cn(
              'flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition',
              modo === 'archivo'
                ? 'bg-white text-brand-ink shadow-sm'
                : 'text-brand-muted hover:text-brand-ink',
            )}
          >
            <Upload size={14} /> Subir archivo
          </button>
          <button
            type="button"
            onClick={() => setModo('url')}
            className={cn(
              'flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition',
              modo === 'url'
                ? 'bg-white text-brand-ink shadow-sm'
                : 'text-brand-muted hover:text-brand-ink',
            )}
          >
            <Link2 size={14} /> Pegar URL
          </button>
        </div>

        {/* Cuerpo según modo */}
        {modo === 'archivo' ? (
          <Field
            label="Archivo del documento final"
            hint="PDF, imagen (JPG/PNG/WebP), Word o Excel. Hasta 20 MB."
          >
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
              <div className="mt-2 flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                <FileText size={14} className="text-brand-cyan" />
                <span className="flex-1 truncate" title={file.name}>
                  {file.name}
                </span>
                <span className="text-xs text-brand-muted">
                  {(file.size / 1024).toFixed(0)} KB
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setFile(null);
                    if (fileInputRef.current) fileInputRef.current.value = '';
                  }}
                  className="rounded-md p-0.5 text-brand-muted transition hover:bg-white hover:text-brand-ink"
                  aria-label="Quitar archivo"
                >
                  <X size={14} />
                </button>
              </div>
            )}
          </Field>
        ) : (
          <Field
            label="URL del documento final"
            hint="Pegá el link al certificado / diploma (Drive, OneDrive, página pública, etc.)."
          >
            <Input
              type="url"
              value={urlExterna}
              onChange={(e) => setUrlExterna(e.target.value)}
              placeholder="https://…"
              autoFocus
            />
          </Field>
        )}
      </div>
    </Modal>
  );
}
