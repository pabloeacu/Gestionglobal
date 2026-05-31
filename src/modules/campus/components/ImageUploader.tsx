// Uploader de imagen para Campus (banners, íconos, fotos de docente).
// Sube a `campus-media` y devuelve la URL pública. UX: preview circular o
// rectangular según `shape`, botón "Reemplazar", botón "Quitar" en X.

import { useRef, useState } from 'react';
import { Image as ImageIcon, Loader2, Upload, X } from 'lucide-react';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/cn';
import {
  uploadCampusMedia,
  type CampusMediaScope,
} from '@/services/api/campus';

interface ImageUploaderProps {
  /** URL pública actual (o null si no hay imagen). */
  value: string | null;
  /** Se invoca con la URL pública nueva (o null tras quitar). */
  onChange: (url: string | null) => void;
  /** Carpeta lógica dentro del bucket; agrupa por tipo de uso. */
  scope: CampusMediaScope;
  /** Identificador del dueño (curso_id, modulo_id, clase_id) para el path. */
  ownerId: string;
  /** Forma del preview: 'circle' para avatares, 'square' para íconos, 'wide' para banners. */
  shape?: 'circle' | 'square' | 'wide';
  /** Tamaño base del preview en px. */
  size?: number;
  /** Etiqueta corta debajo de la imagen (ej: "Foto del instructor"). */
  label?: string;
  /** Hint debajo del label. */
  hint?: string;
  /** MB máximo aceptado. Default 5. */
  maxMb?: number;
}

export function ImageUploader({
  value,
  onChange,
  scope,
  ownerId,
  shape = 'square',
  size = 80,
  label,
  hint,
  maxMb = 5,
}: ImageUploaderProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);

  const shapeClass =
    shape === 'circle'
      ? 'rounded-full'
      : shape === 'wide'
        ? 'rounded-xl'
        : 'rounded-2xl';
  const widthPx = shape === 'wide' ? size * 3 : size;

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = ''; // permite re-elegir el mismo archivo
    if (!f) return;
    if (f.size > maxMb * 1024 * 1024) {
      toast.error(`La imagen no puede pesar más de ${maxMb} MB.`);
      return;
    }
    setUploading(true);
    const res = await uploadCampusMedia(scope, ownerId, f);
    setUploading(false);
    if (!res.ok) {
      toast.error('No pudimos subir la imagen.', { description: res.error.message });
      return;
    }
    onChange(res.data);
  }

  return (
    <div className="flex flex-col gap-2">
      {label && (
        <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-muted">
          {label}
        </p>
      )}
      <div className="flex items-center gap-3">
        <div
          className={cn(
            'relative overflow-hidden border border-slate-200 bg-slate-50',
            shapeClass,
          )}
          style={{ width: widthPx, height: size }}
        >
          {value ? (
            <>
              <img
                src={value}
                alt=""
                className="h-full w-full object-cover"
              />
              <button
                type="button"
                onClick={() => onChange(null)}
                aria-label="Quitar imagen"
                className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-white text-red-600 shadow ring-1 ring-red-200 hover:bg-red-50"
              >
                <X size={11} />
              </button>
            </>
          ) : (
            <div className="grid h-full w-full place-items-center text-brand-muted">
              {uploading ? (
                <Loader2 size={18} className="animate-spin" />
              ) : (
                <ImageIcon size={18} />
              )}
            </div>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-brand-ink shadow-sm hover:border-brand-cyan/40 hover:bg-brand-cyan-pale/30 disabled:opacity-60"
          >
            {uploading ? (
              <>
                <Loader2 size={12} className="animate-spin" /> Subiendo…
              </>
            ) : (
              <>
                <Upload size={12} /> {value ? 'Reemplazar' : 'Subir imagen'}
              </>
            )}
          </button>
          {hint && (
            <p className="max-w-[180px] text-[11px] text-brand-muted">{hint}</p>
          )}
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          onChange={onPick}
          className="hidden"
        />
      </div>
    </div>
  );
}
