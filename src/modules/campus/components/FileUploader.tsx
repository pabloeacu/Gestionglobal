// Uploader de archivo genérico para Campus (PDF: CV del docente, bibliografía).
// A diferencia de ImageUploader (que recorta imágenes con un cropper), este sube
// el archivo tal cual al bucket público `campus-media` vía uploadCampusMedia
// (R20 safeStorageKey). Mismo contrato onChange/onPersist que ImageUploader:
// onChange actualiza el state local del padre; onPersist (opcional) persiste la
// URL en BD inmediatamente, sin esperar al botón "Guardar".

import { useRef, useState } from 'react';
import { Download, FileText, Loader2, Upload, X } from 'lucide-react';
import { toast } from '@/lib/toast';
import { uploadCampusMedia, type CampusMediaScope } from '@/services/api/campus';
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
}: FileUploaderProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);

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
      {hint && <p className="text-[11px] text-brand-muted">{hint}</p>}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        onChange={(e) => void onPick(e)}
        className="hidden"
      />
    </div>
  );
}
