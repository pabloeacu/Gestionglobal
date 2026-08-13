// AvisarGestoriaModal · DGG-135 (evolución del prompt de DGG-133).
// Reaviso a la gestoría externa con mensaje libre opcional y, ahora, archivos
// adjuntos opcionales que viajan EN el email (attachments_jsonb → el
// despachador adjunta el archivo real, mismo circuito que la derivación
// original de mig 0208/0396, bucket privado gestoria-adjuntos).
// SIEMPRE comunicación interna: la línea que crea la RPC es
// visible_cliente=false — el cliente jamás la ve (regla neurálgica DGG-133).
//
// Subida al ENVIAR (no al elegir): evita la clase de huérfanos E-GG-177. Si
// el envío falla después de subir, los metas quedan cacheados y el reintento
// no re-sube (sin duplicados).

import { useRef, useState } from 'react';
import { Send, Paperclip, X as XIcon, Loader2 } from 'lucide-react';
import { Modal, Button, Textarea } from '@/components/common';
import { supabase } from '@/lib/supabase';
import { toast } from '@/lib/toast';
import { humanizeError } from '@/lib/errors';
import { motivoRechazoAdjunto, type LimitesAdjunto } from '@/lib/adjuntos';
import { avisarGestoria, type AdjuntoGestoriaMeta } from '@/services/api/trackings';
import { uploadAdjuntoGestoria } from '@/services/api/solicitudes';

// §6 DGG-135 (crítico): el despachador de emails corta los adjuntos en
// MAX_ATTACH_B64_TOTAL≈5,25 MB TOTALES por mail y OMITE en silencio el
// excedente. El techo acá es el espejo honesto de ese límite (4,5 MB raw
// deja margen al inflado base64 4/3). Formatos libres como la derivación.
const MAX_TOTAL_MB = 4.5;
const LIMITES: LimitesAdjunto = { maxMB: MAX_TOTAL_MB };
const MAX_ADJUNTOS = 10;

interface ArchivoItem {
  id: string;
  file: File;
  meta?: AdjuntoGestoriaMeta; // seteado tras subir OK (cache anti-re-subida)
}

interface Props {
  open: boolean;
  onClose: () => void;
  tramiteId: string;
  solicitudId: string | null;
  destinatarioEmail: string;
  onDone?: () => void;
}

export function AvisarGestoriaModal({
  open, onClose, tramiteId, solicitudId, destinatarioEmail, onDone,
}: Props) {
  const [mensaje, setMensaje] = useState('');
  const [archivos, setArchivos] = useState<ArchivoItem[]>([]);
  const [enviando, setEnviando] = useState(false);
  const enviadoOkRef = useRef(false);

  // §6: no cerrar con ESC/X/backdrop mientras el envío está en vuelo (el aviso
  // saldría igual con el gerente creyendo que canceló). Y al cerrar SIN haber
  // enviado, borrar best-effort lo ya subido — gestoria-adjuntos no tiene
  // detector de huérfanos (el cron E-GG-177 cubre otro bucket).
  function safeClose() {
    if (enviando) return;
    if (!enviadoOkRef.current) {
      const paths = archivos.filter((a) => a.meta).map((a) => a.meta!.path);
      if (paths.length > 0) {
        void supabase.storage.from('gestoria-adjuntos').remove(paths).catch(() => undefined);
      }
    }
    onClose();
  }

  function onFilesPicked(files: FileList | null) {
    if (!files || files.length === 0) return;
    const nuevos: ArchivoItem[] = [];
    for (const f of Array.from(files)) {
      const motivo = motivoRechazoAdjunto(f, LIMITES);
      if (motivo) { toast.error(motivo); continue; }
      nuevos.push({ id: crypto.randomUUID(), file: f });
    }
    setArchivos((prev) => {
      let merged = [...prev, ...nuevos];
      if (merged.length > MAX_ADJUNTOS) {
        toast.error(`Hasta ${MAX_ADJUNTOS} archivos por aviso`);
        merged = merged.slice(0, MAX_ADJUNTOS);
      }
      // §6: el límite REAL del mail es el total, no el por-archivo.
      while (merged.reduce((acc, x) => acc + x.file.size, 0) > MAX_TOTAL_MB * 1024 * 1024
             && merged.length > prev.length) {
        toast.error(`Los adjuntos no pueden superar ${MAX_TOTAL_MB} MB en total (límite del email)`);
        merged = merged.slice(0, -1);
      }
      return merged;
    });
  }

  async function handleEnviar() {
    // §6: doble guard del total antes de subir nada.
    const totalBytes = archivos.reduce((acc, x) => acc + x.file.size, 0);
    if (totalBytes > MAX_TOTAL_MB * 1024 * 1024) {
      toast.error(`Los adjuntos no pueden superar ${MAX_TOTAL_MB} MB en total (límite del email)`);
      return;
    }
    setEnviando(true);
    // 1) Subir lo pendiente. Cache INCREMENTAL: cada subida OK se persiste al
    // estado al instante — si falla la 3ra, el retry salta la 1ra y 2da (§6).
    const conMeta: ArchivoItem[] = [];
    for (const a of archivos) {
      if (a.meta) { conMeta.push(a); continue; }
      if (!solicitudId) {
        setEnviando(false);
        toast.error('No encontramos la solicitud de la derivación para adjuntar archivos');
        return;
      }
      const up = await uploadAdjuntoGestoria(solicitudId, a.file);
      if (!up.ok) {
        setEnviando(false);
        toast.error(`No pudimos subir "${a.file.name}"`, { description: humanizeError(up.error) });
        return;
      }
      const item = { ...a, meta: up.data };
      conMeta.push(item);
      setArchivos((prev) => prev.map((x) => (x.id === item.id ? item : x)));
    }
    // 2) El aviso real (RPC: email con adjuntos + línea interna).
    const res = await avisarGestoria(
      tramiteId,
      mensaje.trim() || null,
      conMeta.map((a) => a.meta as AdjuntoGestoriaMeta),
    );
    setEnviando(false);
    if (!res.ok) {
      toast.error('No pudimos avisar a la gestoría', { description: humanizeError(res.error) });
      return;
    }
    enviadoOkRef.current = true;
    toast.success(`Aviso enviado a ${res.data.email}`, {
      description: conMeta.length > 0
        ? `Con ${conMeta.length} archivo${conMeta.length === 1 ? '' : 's'} adjunto${conMeta.length === 1 ? '' : 's'} en el email.`
        : undefined,
    });
    setMensaje('');
    setArchivos([]);
    onDone?.();
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={safeClose}
      kicker="GESTORÍA EXTERNA"
      title="Avisar a la gestoría"
      icon={<Send size={18} />}
      width={520}
      footer={
        <>
          <Button variant="ghost" onClick={safeClose} disabled={enviando}>Cancelar</Button>
          <Button onClick={() => void handleEnviar()} loading={enviando}>
            <Send size={14} /> Avisar a la gestoría
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm leading-relaxed text-brand-muted">
          Le avisaremos a <strong className="text-brand-ink">{destinatarioEmail}</strong> que
          hay información nueva y que puede retomar el trámite. Podés agregar un mensaje
          propio y archivos (opcionales — vacío envía el aviso estándar). Esta comunicación
          es interna: el cliente no la ve.
        </p>

        <Textarea
          rows={3}
          value={mensaje}
          onChange={(e) => setMensaje(e.target.value)}
          placeholder="Mensaje adicional para la gestoría (opcional)…"
          disabled={enviando}
        />

        {/* DGG-135 · adjuntos opcionales: viajan como archivos reales en el email */}
        <div className="rounded-xl border border-dashed border-brand-cyan/30 bg-white p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="kicker text-brand-cyan inline-flex items-center gap-1">
              <Paperclip size={12} /> Adjuntos{archivos.length > 0 ? ` (${archivos.length})` : ''}
            </span>
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-brand-cyan-pale/40 px-3 py-1.5 text-xs font-medium text-brand-cyan transition hover:bg-brand-cyan-pale">
              <Paperclip size={12} />
              Agregar archivo
              <input
                type="file"
                multiple
                className="sr-only"
                disabled={enviando}
                onChange={(e) => {
                  onFilesPicked(e.target.files);
                  e.target.value = '';
                }}
              />
            </label>
          </div>
          {archivos.length > 0 ? (
            <ul className="mt-2 space-y-1.5">
              {archivos.map((a) => (
                <li
                  key={a.id}
                  className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs"
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    <Paperclip size={11} className="shrink-0 text-brand-cyan" />
                    <span className="truncate text-brand-ink">{a.file.name}</span>
                    <span className="shrink-0 text-brand-muted">
                      ({Math.max(1, Math.round(a.file.size / 1024))} KB)
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    {enviando && !a.meta ? (
                      <Loader2 size={11} className="animate-spin text-brand-muted" />
                    ) : null}
                    <button
                      type="button"
                      onClick={() => {
                        if (a.meta) {
                          void supabase.storage.from('gestoria-adjuntos').remove([a.meta.path]).catch(() => undefined);
                        }
                        setArchivos((prev) => prev.filter((x) => x.id !== a.id));
                      }}
                      disabled={enviando}
                      className="rounded p-0.5 text-brand-muted hover:bg-slate-200 hover:text-brand-ink"
                      aria-label="Quitar"
                    >
                      <XIcon size={11} />
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-xs text-brand-muted">
              Opcional. Los archivos le llegan adjuntos en el email (hasta {MAX_ADJUNTOS}, {MAX_TOTAL_MB} MB en total — límite del email).
            </p>
          )}
        </div>
      </div>
    </Modal>
  );
}
