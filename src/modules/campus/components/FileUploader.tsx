// Uploader de archivo genérico para Campus (PDF: CV del docente, bibliografía).
// A diferencia de ImageUploader (que recorta imágenes con un cropper), este sube
// el archivo tal cual al bucket público `campus-media` vía uploadCampusMedia
// (R20 safeStorageKey). Mismo contrato onChange/onPersist que ImageUploader:
// onChange actualiza el state local del padre; onPersist (opcional) persiste la
// URL en BD inmediatamente, sin esperar al botón "Guardar".

import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, FileText, Images, Loader2, Upload, X } from 'lucide-react';
import { toast } from '@/lib/toast';
import {
  listDocentesCvBanco,
  uploadCampusMedia,
  type CampusMediaScope,
  type DocenteCvBancoItem,
} from '@/services/api/campus';
import { humanizeError } from '@/lib/errors';

interface FileUploaderProps {
  /** URL pública actual (o null si no hay archivo). */
  value: string | null;
  /** State local en el padre (se actualiza tras subir/quitar). */
  onChange: (url: string | null) => void;
  /** Si lo provee el padre, se llama tras el upload exitoso para persistir la
   *  URL en BD inmediatamente (sin esperar al botón "Guardar"). */
  onPersist?: (url: string | null) => void | Promise<void>;
  scope: CampusMediaScope;
  ownerId: string;
  label?: string;
  hint?: string;
  /** MIME aceptado por el input. Default PDF. */
  accept?: string;
  /** MB máximo aceptado. Default 10. */
  maxMb?: number;
  /** Si true, ofrece "Elegir del banco" (CVs de docente ya cargados en otros
   *  cursos) además de subir uno nuevo. */
  bankEnabled?: boolean;
  /** Llamado al elegir un CV del banco. El padre setea nombre + cv y persiste
   *  (no se re-sube nada: se reusa la URL existente). */
  onPickBank?: (item: DocenteCvBancoItem) => void;
}

// Nombre legible: toma el último segmento de la URL, decodifica y le saca el
// prefijo de timestamp que agrega uploadCampusMedia (`1717-archivo.pdf`).
function nombreLegible(url: string): string {
  const raw = url.split('/').pop() ?? 'archivo';
  let name = raw;
  try {
    name = decodeURIComponent(raw);
  } catch {
    /* dejar raw si la URL trae secuencias inválidas */
  }
  return name.replace(/^\d+-/, '');
}

export function FileUploader({
  value,
  onChange,
  onPersist,
  scope,
  ownerId,
  label,
  hint,
  accept = 'application/pdf',
  maxMb = 10,
  bankEnabled = false,
  onPickBank,
}: FileUploaderProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [bankOpen, setBankOpen] = useState(false);
  const [bankItems, setBankItems] = useState<DocenteCvBancoItem[] | null>(null);
  const [bankLoading, setBankLoading] = useState(false);

  async function openBank() {
    setBankOpen(true);
    if (bankItems !== null) return; // ya cargado en esta sesión
    setBankLoading(true);
    const res = await listDocentesCvBanco();
    setBankLoading(false);
    if (!res.ok) {
      toast.error('No pudimos cargar el banco de CV.', {
        description: humanizeError(res.error),
      });
      setBankItems([]);
      return;
    }
    setBankItems(res.data);
  }

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = ''; // permite re-elegir el mismo archivo
    if (!f) return;
    if (f.size > maxMb * 1024 * 1024) {
      toast.error(`El archivo no puede pesar más de ${maxMb} MB.`);
      return;
    }
    setUploading(true);
    const res = await uploadCampusMedia(scope, ownerId, f);
    setUploading(false);
    if (!res.ok) {
      toast.error('No pudimos subir el archivo.', {
        description: humanizeError(res.error),
      });
      return;
    }
    onChange(res.data);
    if (onPersist) {
      try {
        await onPersist(res.data);
      } catch (err) {
        console.error('[FileUploader] persistir falló:', err);
      }
    }
    toast.success('Archivo guardado.');
  }

  async function onRemove() {
    onChange(null);
    if (onPersist) {
      try {
        await onPersist(null);
      } catch (err) {
        console.error('[FileUploader] persistir null falló:', err);
      }
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {label && (
        <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-muted">
          {label}
        </p>
      )}
      {value && (
        <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
          <FileText size={16} className="shrink-0 text-brand-cyan" />
          <a
            href={value}
            target="_blank"
            rel="noopener noreferrer"
            download
            className="min-w-0 flex-1 truncate text-sm font-medium text-brand-ink hover:text-brand-cyan hover:underline"
            title={nombreLegible(value)}
          >
            {nombreLegible(value)}
          </a>
          <a
            href={value}
            target="_blank"
            rel="noopener noreferrer"
            download
            className="rounded-md p-1 text-brand-muted hover:bg-slate-100"
            aria-label="Descargar archivo"
          >
            <Download size={14} />
          </a>
          <button
            type="button"
            onClick={() => void onRemove()}
            aria-label="Quitar archivo"
            className="rounded-md p-1 text-red-600 hover:bg-red-50"
          >
            <X size={14} />
          </button>
        </div>
      )}
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className="inline-flex w-fit items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-brand-ink shadow-sm hover:border-brand-cyan/40 hover:bg-brand-cyan-pale/30 disabled:opacity-60"
      >
        {uploading ? (
          <>
            <Loader2 size={12} className="animate-spin" /> Subiendo…
          </>
        ) : (
          <>
            <Upload size={12} /> {value ? 'Reemplazar archivo' : 'Subir archivo'}
          </>
        )}
      </button>
      {bankEnabled && onPickBank && (
        <button
          type="button"
          onClick={() => void openBank()}
          disabled={uploading}
          className="inline-flex w-fit items-center gap-1.5 rounded-lg border border-brand-cyan/30 bg-brand-cyan-pale/40 px-3 py-1.5 text-xs font-medium text-brand-cyan shadow-sm hover:bg-brand-cyan-pale/70 disabled:opacity-60"
        >
          <Images size={12} /> Elegir del banco
        </button>
      )}
      {hint && <p className="text-[11px] text-brand-muted">{hint}</p>}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        onChange={(e) => void onPick(e)}
        className="hidden"
      />
      {bankOpen && onPickBank && (
        <CvBankModal
          items={bankItems}
          loading={bankLoading}
          onClose={() => setBankOpen(false)}
          onPick={(item) => {
            onPickBank(item);
            setBankOpen(false);
            toast.success(`CV de ${item.nombre} asignado.`);
          }}
        />
      )}
    </div>
  );
}

function CvBankModal({
  items,
  loading,
  onClose,
  onPick,
}: {
  items: DocenteCvBancoItem[] | null;
  loading: boolean;
  onClose: () => void;
  onPick: (item: DocenteCvBancoItem) => void;
}) {
  const [q, setQ] = useState('');
  const visibles = (items ?? []).filter((it) =>
    q.trim() ? it.nombre.toLowerCase().includes(q.trim().toLowerCase()) : true,
  );
  return createPortal(
    <div className="fixed inset-0 z-[60] grid place-items-center bg-brand-ink/60 p-4">
      <div className="card-premium relative flex max-h-[80vh] w-full max-w-lg flex-col gap-3 p-4">
        <header className="flex items-center justify-between">
          <h3 className="inline-flex items-center gap-2 font-display text-base font-semibold text-brand-ink">
            <FileText size={16} className="text-brand-cyan" /> Banco de CV de docentes
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="rounded-md p-1 text-brand-muted hover:bg-slate-100"
          >
            <X size={16} />
          </button>
        </header>
        {items && items.length > 6 && (
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar docente…"
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-brand-cyan focus:ring-4 focus:ring-brand-cyan/10"
          />
        )}
        <div className="min-h-[120px] overflow-y-auto">
          {loading ? (
            <div className="grid h-32 place-items-center text-brand-muted">
              <Loader2 size={20} className="animate-spin" />
            </div>
          ) : visibles.length === 0 ? (
            <p className="grid h-32 place-items-center px-4 text-center text-sm text-brand-muted">
              {items && items.length === 0
                ? 'Todavía no hay CVs de docentes cargados. Subí el primero con "Subir archivo".'
                : 'Ningún docente coincide con la búsqueda.'}
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {visibles.map((it) => (
                <li key={`${it.nombre}|${it.cv_url}`}>
                  <button
                    type="button"
                    onClick={() => onPick(it)}
                    className="flex w-full items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-left transition hover:border-brand-cyan hover:shadow-sm"
                    title={`Usar el CV de ${it.nombre}`}
                  >
                    <FileText size={15} className="shrink-0 text-brand-cyan" />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-brand-ink">
                      {it.nombre}
                    </span>
                    <span className="shrink-0 text-[10px] text-brand-muted">
                      {nombreLegible(it.cv_url)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
