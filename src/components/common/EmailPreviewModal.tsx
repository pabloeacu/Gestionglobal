// EmailPreviewModal · vista previa modal del HTML real encolado/enviado.
// Renderiza el body en un iframe sandboxed para evitar fugas de CSS al host.
// Cita: regla 13 (modal premium, no nativo).

import { useEffect, useState } from 'react';
import { Eye, Mail, Calendar, Paperclip, Loader2, AlertCircle } from 'lucide-react';
import { Modal } from './Modal';
import { getEnvioPreview, type EnvioPreview } from '@/services/api/emails';
import { cn } from '@/lib/cn';

interface EmailPreviewModalProps {
  open: boolean;
  envioId: string | null;
  onClose: () => void;
}

export function EmailPreviewModal({ open, envioId, onClose }: EmailPreviewModalProps) {
  const [data, setData] = useState<EnvioPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !envioId) {
      setData(null);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    setData(null);
    void (async () => {
      const res = await getEnvioPreview(envioId);
      if (res.ok) setData(res.data);
      else setError(res.error.message);
      setLoading(false);
    })();
  }, [open, envioId]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={data?.subject ?? 'Vista previa del correo'}
      kicker="Correo enviado"
      icon={<Eye size={18} className="text-brand-cyan" />}
      width={860}
    >
      {loading && (
        <div className="flex items-center justify-center py-16 text-brand-muted">
          <Loader2 size={20} className="animate-spin" />
          <span className="ml-2 text-sm">Cargando vista previa…</span>
        </div>
      )}

      {error && !loading && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <AlertCircle size={14} className="mr-1 inline-block" />
          {error}
        </div>
      )}

      {data && !loading && (
        <div className="space-y-3">
          {/* Metadata header */}
          <dl className="grid grid-cols-1 gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs sm:grid-cols-2">
            <div className="flex items-center gap-2 truncate">
              <Mail size={12} className="text-brand-muted" />
              <dt className="font-semibold text-brand-muted">Para:</dt>
              <dd className="truncate text-brand-ink">
                {data.to_nombre ? `${data.to_nombre} <${data.to_email}>` : data.to_email}
              </dd>
            </div>
            <div className="flex items-center gap-2">
              <Calendar size={12} className="text-brand-muted" />
              <dt className="font-semibold text-brand-muted">Enviado:</dt>
              <dd className="text-brand-ink">
                {data.enviado_at ? new Date(data.enviado_at).toLocaleString('es-AR') : 'pendiente'}
              </dd>
            </div>
            {data.template_slug && (
              <div className="flex items-center gap-2 sm:col-span-2">
                <dt className="font-semibold text-brand-muted">Plantilla:</dt>
                <dd className="font-mono text-[11px] text-brand-ink">{data.template_slug}</dd>
              </div>
            )}
            {data.attachments_filenames && data.attachments_filenames.length > 0 && (
              <div className="flex items-start gap-2 sm:col-span-2">
                <Paperclip size={12} className="mt-0.5 text-brand-muted" />
                <dt className="font-semibold text-brand-muted">Adjuntos:</dt>
                <dd className="flex flex-wrap gap-1 text-brand-ink">
                  {data.attachments_filenames.map((fn, i) => (
                    <span
                      key={i}
                      className="inline-flex items-center rounded border border-slate-200 bg-white px-2 py-0.5 text-[11px]"
                    >
                      {fn}
                    </span>
                  ))}
                </dd>
              </div>
            )}
          </dl>

          {/* HTML body en iframe sandboxed */}
          <div className={cn(
            'overflow-hidden rounded-lg border border-slate-200 bg-white',
            'shadow-inner',
          )}>
            {data.html_body ? (
              <iframe
                title="Vista previa del correo"
                srcDoc={data.html_body}
                sandbox=""
                className="block h-[60vh] w-full border-0 bg-white"
              />
            ) : (
              <div className="p-8 text-center text-sm text-brand-muted">
                Este correo no tiene contenido HTML guardado. Si el envío era simple,
                puede que la plantilla solo haya generado texto plano.
              </div>
            )}
          </div>

          {/* Variables (debug colapsado) */}
          {data.variables && Object.keys(data.variables).length > 0 && (
            <details className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs">
              <summary className="cursor-pointer font-semibold text-brand-muted">
                Variables ({Object.keys(data.variables).length})
              </summary>
              <pre className="mt-2 max-h-40 overflow-auto rounded bg-white p-2 text-[10px] text-brand-ink">
                {JSON.stringify(data.variables, null, 2)}
              </pre>
            </details>
          )}
        </div>
      )}
    </Modal>
  );
}
