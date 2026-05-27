import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, Loader2, ShieldCheck, X } from 'lucide-react';
import QRCode from 'qrcode';
import { toast } from '@/lib/toast';
import {
  verificacionUrl,
  type CertificadoParaPdf,
} from '@/services/api/campus';
import {
  CertificadoPremium,
  CERT_W,
  CERT_H,
  type EsquemaCert,
} from './CertificadoPremium';
import { generateCertificadoPdf } from '../lib/generateCertificadoPdf';

// Vista previa del certificado premium (DGG-13). Muestra el MISMO componente
// que html2canvas captura para el PDF, escalado para entrar en pantalla, con
// botones de descargar y verificar. Sirve para revisar el diseño sin bajar el
// archivo (y para que el browser-test lo inspeccione en vivo).
export function CertificadoPreviewModal({
  cert,
  open,
  onClose,
  esquema,
}: {
  cert: CertificadoParaPdf | null;
  open: boolean;
  onClose: () => void;
  /** Esquema visual (DGG-29). Si no se pasa, se usa el default institucional. */
  esquema?: EsquemaCert;
}) {
  const [qr, setQr] = useState<string | null>(null);
  const [descargando, setDescargando] = useState(false);
  const [scale, setScale] = useState(1);
  const boxRef = useRef<HTMLDivElement>(null);
  const url = cert ? verificacionUrl(cert.codigo) : '';

  useEffect(() => {
    if (!open || !cert) return;
    let cancelled = false;
    void QRCode.toDataURL(url, {
      margin: 1,
      width: 320,
      errorCorrectionLevel: 'M',
      color: { dark: '#0b1f33', light: '#ffffff' },
    })
      .then((d) => !cancelled && setQr(d))
      .catch(() => !cancelled && setQr(null));
    return () => {
      cancelled = true;
    };
  }, [open, cert, url]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Escala el lienzo al ancho disponible del modal.
  useEffect(() => {
    if (!open) return;
    const el = boxRef.current;
    if (!el) return;
    const fit = () => {
      const w = el.clientWidth;
      setScale(Math.min(1, w / CERT_W));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [open]);

  if (!open || !cert) return null;

  async function onDescargar() {
    if (!cert) return;
    setDescargando(true);
    try {
      await generateCertificadoPdf(cert, esquema);
    } catch {
      toast.error('No pudimos generar el PDF.');
    } finally {
      setDescargando(false);
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-brand-ink/60 p-4 backdrop-blur-sm motion-safe:animate-fade-in"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-[1180px] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl motion-safe:animate-spring-in"
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-3">
          <div className="min-w-0">
            <p className="kicker text-brand-cyan">Vista previa del certificado</p>
            <h2 className="truncate text-base font-semibold text-brand-ink">
              {cert.alumno_nombre} · {cert.curso_titulo}
            </h2>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              onClick={() => void onDescargar()}
              disabled={descargando}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand-cyan px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-cyan/90 disabled:opacity-60"
            >
              {descargando ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Download size={14} />
              )}
              Descargar PDF
            </button>
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-brand-muted hover:text-brand-ink"
            >
              <ShieldCheck size={14} /> Verificar
            </a>
            <button
              onClick={onClose}
              className="rounded-md p-1.5 text-brand-muted hover:bg-slate-100"
              aria-label="Cerrar"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Lienzo escalado al ancho disponible, manteniendo el ratio A4 */}
        <div className="flex-1 overflow-auto bg-slate-100 p-6">
          <div ref={boxRef} className="mx-auto w-full">
            <div
              style={{ width: CERT_W * scale, height: CERT_H * scale }}
              className="mx-auto shadow-xl ring-1 ring-black/5"
            >
              <div
                style={{
                  width: CERT_W,
                  height: CERT_H,
                  transform: `scale(${scale})`,
                  transformOrigin: 'top left',
                }}
              >
                <CertificadoPremium
                  cert={cert}
                  qrDataUrl={qr}
                  verificarUrl={url}
                  esquema={esquema}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
