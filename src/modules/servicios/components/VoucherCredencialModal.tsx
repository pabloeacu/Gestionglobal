import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, FileImage, FileText, Loader2, X } from 'lucide-react';
import { toast } from '@/lib/toast';
import {
  VoucherCredencial,
  VOUCHER_W,
  VOUCHER_H,
  type VoucherCredencialDatos,
} from './VoucherCredencial';
import {
  descargarVoucherCredencial,
  type FormatoVoucher,
} from '../lib/generateVoucherCredencial';

// Vista previa de la credencial de cortesía del voucher (DGG-210). Muestra el
// MISMO componente que se rasteriza al descargar, escalado para entrar en
// pantalla, con botones PNG / PDF. Capa de presentación: no toca la lógica.
export function VoucherCredencialModal({
  datos,
  open,
  onClose,
}: {
  datos: VoucherCredencialDatos | null;
  open: boolean;
  onClose: () => void;
}) {
  const [descargando, setDescargando] = useState<FormatoVoucher | null>(null);
  const [scale, setScale] = useState(1);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const el = boxRef.current;
    if (!el) return;
    const fit = () => setScale(Math.min(1, el.clientWidth / VOUCHER_W));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [open]);

  if (!open || !datos) return null;

  async function onDescargar(formato: FormatoVoucher) {
    if (!datos || descargando) return;
    setDescargando(formato);
    try {
      await descargarVoucherCredencial(datos, formato);
    } catch (err) {
      console.error('[voucher-credencial] descarga falló:', err);
      const detalle = err instanceof Error ? err.message.slice(0, 180) : 'Error desconocido';
      toast.error(`No pudimos generar el ${formato.toUpperCase()}.`, { description: detalle });
    } finally {
      setDescargando(null);
    }
  }

  return createPortal(
    <div
      data-gg="overlay"
      className="fixed inset-0 z-50 flex items-center justify-center bg-brand-ink/60 p-4 backdrop-blur-sm motion-safe:animate-fade-in"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-[1100px] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl motion-safe:animate-spring-in"
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-3">
          <div className="min-w-0">
            <p className="kicker text-brand-cyan">Credencial del voucher</p>
            <h2 className="truncate text-base font-semibold text-brand-ink">
              {datos.codigo} · {datos.es100 ? '100% · Gratis' : `${datos.descuentoPct}% de descuento`}
            </h2>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              onClick={() => void onDescargar('png')}
              disabled={descargando !== null}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand-cyan px-3 py-2 text-sm font-semibold text-white transition hover:bg-brand-cyan/90 disabled:opacity-60"
              aria-label="Descargar PNG"
            >
              {descargando === 'png' ? <Loader2 size={14} className="animate-spin" /> : <FileImage size={14} />}
              <span className="hidden sm:inline">Descargar PNG</span>
            </button>
            <button
              onClick={() => void onDescargar('pdf')}
              disabled={descargando !== null}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-brand-muted transition hover:text-brand-ink disabled:opacity-60"
              aria-label="Descargar PDF"
            >
              {descargando === 'pdf' ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />}
              <span className="hidden sm:inline">Descargar PDF</span>
            </button>
            <button
              onClick={onClose}
              className="rounded-md p-2 text-brand-muted hover:bg-slate-100"
              aria-label="Cerrar"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Lienzo escalado al ancho disponible, manteniendo el ratio de la tarjeta */}
        <div className="flex-1 overflow-auto bg-slate-100 p-6">
          <div ref={boxRef} className="mx-auto w-full">
            <div
              style={{ width: VOUCHER_W * scale, height: VOUCHER_H * scale }}
              className="mx-auto shadow-xl ring-1 ring-black/5"
            >
              <div
                data-gg-classic=""
                style={{
                  width: VOUCHER_W,
                  height: VOUCHER_H,
                  transform: `scale(${scale})`,
                  transformOrigin: 'top left',
                }}
              >
                <VoucherCredencial datos={datos} />
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 border-t border-slate-100 px-5 py-2.5 text-xs text-brand-muted">
          <Download size={13} />
          <span>
            Pieza de cortesía para pasarle al cliente — no modifica el voucher ni su funcionamiento.
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
