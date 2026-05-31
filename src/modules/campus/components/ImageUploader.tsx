// Uploader de imagen para Campus (banners, íconos, fotos de docente).
// Flujo:
//   1) El gerente elige un archivo del disco.
//   2) Se abre un modal con react-easy-crop: zoom + rotación + drag para
//      encuadrar exactamente lo que quiere mostrar.
//   3) Al confirmar, el área seleccionada se exporta como blob y se sube al
//      bucket público `campus-media`.
//   4) Se invoca `onChange(url)` para actualizar el state local del padre y
//      `onPersist?(url)` para persistir inmediatamente en BD (no requiere
//      "Guardar módulo / clase"; el cambio sobrevive el refresh).
// Borrar la imagen también dispara onPersist(null) para borrar la referencia.

import { useCallback, useRef, useState } from 'react';
import Cropper, { type Area } from 'react-easy-crop';
import {
  Image as ImageIcon,
  Loader2,
  RotateCw,
  Upload,
  X,
  ZoomIn,
} from 'lucide-react';
import { toast } from '@/lib/toast';
import { Button } from '@/components/common';
import { cn } from '@/lib/cn';
import {
  uploadCampusMedia,
  type CampusMediaScope,
} from '@/services/api/campus';
import { canvasToOptimizedBlob } from '@/lib/imageWebp';

interface ImageUploaderProps {
  /** URL pública actual (o null si no hay imagen). */
  value: string | null;
  /** State local en el padre (se actualiza tras subir/quitar). */
  onChange: (url: string | null) => void;
  /** Si lo provee el padre, se llama después del upload exitoso para
   *  persistir la URL en BD inmediatamente (sin esperar al botón "Guardar"). */
  onPersist?: (url: string | null) => void | Promise<void>;
  scope: CampusMediaScope;
  ownerId: string;
  /** circle = avatar, square = ícono, wide = banner (3:1). */
  shape?: 'circle' | 'square' | 'wide';
  /** Tamaño visual del preview. `sm` para usos densos junto a inputs,
   *  `md` para cards independientes. Default `md`. */
  size?: 'sm' | 'md';
  /** Etiqueta corta arriba del preview. */
  label?: string;
  /** Hint debajo del label. */
  hint?: string;
  /** MB máximo aceptado. Default 5. */
  maxMb?: number;
}

const SHAPE_CFG = {
  // md: tamaños cómodos para cards independientes (módulo, clase, banner).
  // sm: compactos para colocar junto a inputs (foto del instructor en el form
  //     del curso, p.ej.), donde un círculo de 144px se come la columna.
  circle: {
    aspect: 1,
    classes: 'rounded-full',
    round: true,
    md: { w: 120, h: 120 },
    sm: { w: 84, h: 84 },
  },
  square: {
    aspect: 1,
    classes: 'rounded-2xl',
    round: false,
    md: { w: 120, h: 120 },
    sm: { w: 84, h: 84 },
  },
  wide: {
    aspect: 3,
    classes: 'rounded-xl',
    round: false,
    md: { w: 264, h: 88 },
    sm: { w: 180, h: 60 },
  },
} as const;

export function ImageUploader({
  value,
  onChange,
  onPersist,
  scope,
  ownerId,
  shape = 'square',
  size = 'md',
  label,
  hint,
  maxMb = 5,
}: ImageUploaderProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [pickedDataUrl, setPickedDataUrl] = useState<string | null>(null);
  const [originalFileName, setOriginalFileName] = useState<string>('');

  const shapeCfg = SHAPE_CFG[shape];
  const dims = shapeCfg[size];
  const cfg = {
    aspect: shapeCfg.aspect,
    classes: shapeCfg.classes,
    round: shapeCfg.round,
    w: dims.w,
    h: dims.h,
  };

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = ''; // permite re-elegir el mismo archivo
    if (!f) return;
    if (f.size > maxMb * 1024 * 1024) {
      toast.error(`La imagen no puede pesar más de ${maxMb} MB.`);
      return;
    }
    // Convertir a data URL para mostrarlo en el cropper.
    const reader = new FileReader();
    reader.onload = () => {
      setPickedDataUrl(typeof reader.result === 'string' ? reader.result : null);
      setOriginalFileName(f.name);
    };
    reader.readAsDataURL(f);
  }

  async function onCropConfirmed(blob: Blob, ext: 'webp' | 'jpg' = 'jpg') {
    setUploading(true);
    setPickedDataUrl(null);
    const safeName = originalFileName.replace(/[^a-zA-Z0-9._-]/g, '_') || 'imagen.png';
    // El blob viene del canvas; la extensión depende del mime óptimo del
    // browser (WebP cuando se puede ⇒ ~30 % más liviano que JPEG).
    const mime = ext === 'webp' ? 'image/webp' : 'image/jpeg';
    const file = new File([blob], safeName.replace(/\.[^.]+$/, '') + '.' + ext, {
      type: mime,
    });
    const res = await uploadCampusMedia(scope, ownerId, file);
    setUploading(false);
    if (!res.ok) {
      toast.error('No pudimos subir la imagen.', { description: res.error.message });
      return;
    }
    onChange(res.data);
    if (onPersist) {
      try {
        await onPersist(res.data);
      } catch (err) {
        console.error('[ImageUploader] persistir falló:', err);
      }
    }
    toast.success('Imagen guardada.');
  }

  async function onRemove() {
    onChange(null);
    if (onPersist) {
      try {
        await onPersist(null);
      } catch (err) {
        console.error('[ImageUploader] persistir null falló:', err);
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
      <div
        className={cn(
          'relative overflow-hidden border border-slate-200 bg-slate-50',
          cfg.classes,
        )}
        style={{ width: cfg.w, height: cfg.h }}
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
              onClick={() => void onRemove()}
              aria-label="Quitar imagen"
              className="absolute right-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-full bg-white text-red-600 shadow ring-1 ring-red-200 hover:bg-red-50"
            >
              <X size={12} />
            </button>
          </>
        ) : (
          <div className="grid h-full w-full place-items-center text-brand-muted">
            {uploading ? (
              <Loader2 size={22} className="animate-spin" />
            ) : (
              <ImageIcon size={22} />
            )}
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-brand-ink shadow-sm hover:border-brand-cyan/40 hover:bg-brand-cyan-pale/30 disabled:opacity-60"
        style={{ width: cfg.w }}
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
        <p className="text-[11px] text-brand-muted" style={{ maxWidth: cfg.w }}>
          {hint}
        </p>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        onChange={onPick}
        className="hidden"
      />

      {pickedDataUrl && (
        <CropperModal
          src={pickedDataUrl}
          aspect={cfg.aspect}
          round={cfg.round}
          onCancel={() => setPickedDataUrl(null)}
          onConfirm={(blob) => void onCropConfirmed(blob)}
        />
      )}
    </div>
  );
}

// ============================================================================
// Modal de recorte (react-easy-crop) · drag + zoom + rotación
// ============================================================================
function CropperModal({
  src,
  aspect,
  round,
  onCancel,
  onConfirm,
}: {
  src: string;
  aspect: number;
  round: boolean;
  onCancel: () => void;
  onConfirm: (blob: Blob, ext: 'webp' | 'jpg') => void;
}) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [areaPx, setAreaPx] = useState<Area | null>(null);
  const [working, setWorking] = useState(false);

  const onCropComplete = useCallback((_a: Area, areaPxComputed: Area) => {
    setAreaPx(areaPxComputed);
  }, []);

  async function confirmar() {
    if (!areaPx) return;
    setWorking(true);
    try {
      const { blob, ext } = await cropToBlob(src, areaPx, rotation);
      onConfirm(blob, ext);
    } catch (err) {
      console.error('[CropperModal] recorte falló:', err);
      toast.error('No pudimos recortar la imagen.');
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-brand-ink/60 p-4">
      <div className="card-premium relative flex w-full max-w-lg flex-col gap-3 p-4">
        <header className="flex items-center justify-between">
          <h3 className="font-display text-base font-semibold text-brand-ink">
            Recortar imagen
          </h3>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Cancelar"
            className="rounded-md p-1 text-brand-muted hover:bg-slate-100"
          >
            <X size={16} />
          </button>
        </header>
        <div className="relative h-72 w-full overflow-hidden rounded-xl bg-black">
          <Cropper
            image={src}
            crop={crop}
            zoom={zoom}
            rotation={rotation}
            aspect={aspect}
            cropShape={round ? 'round' : 'rect'}
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onRotationChange={setRotation}
            onCropComplete={onCropComplete}
            restrictPosition
            showGrid
          />
        </div>
        <div className="space-y-2">
          <label className="flex items-center gap-3 text-xs text-brand-muted">
            <ZoomIn size={14} className="shrink-0" />
            <input
              type="range"
              min={1}
              max={4}
              step={0.01}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              className="flex-1"
              aria-label="Zoom"
            />
            <span className="w-10 text-right tabular-nums">{zoom.toFixed(2)}×</span>
          </label>
          <label className="flex items-center gap-3 text-xs text-brand-muted">
            <RotateCw size={14} className="shrink-0" />
            <input
              type="range"
              min={-180}
              max={180}
              step={1}
              value={rotation}
              onChange={(e) => setRotation(Number(e.target.value))}
              className="flex-1"
              aria-label="Rotación"
            />
            <span className="w-10 text-right tabular-nums">{rotation}°</span>
          </label>
        </div>
        <footer className="mt-1 flex justify-end gap-2">
          <Button variant="secondary" onClick={onCancel} type="button">
            Cancelar
          </Button>
          <Button onClick={() => void confirmar()} loading={working} type="button">
            Usar esta imagen
          </Button>
        </footer>
      </div>
    </div>
  );
}

// Convierte el área seleccionada del cropper en un Blob con el mime óptimo
// (WebP si el browser lo soporta, JPEG en fallback). El render usa un canvas
// con rotación; el área se calcula en píxeles del original (no del display),
// así que el output mantiene resolución.
async function cropToBlob(
  src: string,
  area: Area,
  rotation: number,
): Promise<{ blob: Blob; ext: 'webp' | 'jpg' }> {
  const img = await loadImage(src);
  const rad = (rotation * Math.PI) / 180;
  const sin = Math.abs(Math.sin(rad));
  const cos = Math.abs(Math.cos(rad));
  const rotW = img.width * cos + img.height * sin;
  const rotH = img.width * sin + img.height * cos;

  // Canvas auxiliar para aplicar la rotación.
  const rotCanvas = document.createElement('canvas');
  rotCanvas.width = rotW;
  rotCanvas.height = rotH;
  const rctx = rotCanvas.getContext('2d');
  if (!rctx) throw new Error('No se pudo crear el contexto 2D');
  rctx.translate(rotW / 2, rotH / 2);
  rctx.rotate(rad);
  rctx.drawImage(img, -img.width / 2, -img.height / 2);

  // Recorte final.
  const outCanvas = document.createElement('canvas');
  outCanvas.width = Math.max(1, Math.round(area.width));
  outCanvas.height = Math.max(1, Math.round(area.height));
  const octx = outCanvas.getContext('2d');
  if (!octx) throw new Error('No se pudo crear el contexto 2D');
  octx.drawImage(
    rotCanvas,
    area.x,
    area.y,
    area.width,
    area.height,
    0,
    0,
    outCanvas.width,
    outCanvas.height,
  );

  const { blob, ext } = await canvasToOptimizedBlob(outCanvas, 0.9);
  return { blob, ext };
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e);
    img.crossOrigin = 'anonymous';
    img.src = src;
  });
}
