import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import {
  RotateCcw,
  RotateCw,
  RefreshCcw,
  ZoomIn,
  ZoomOut,
  Loader2,
} from 'lucide-react';
import { Modal, Button } from '@/components/common';
import { cn } from '@/lib/cn';

// Editor de avatar con pan / zoom / rotación. Output siempre JPEG cuadrado
// 512×512 ~ 80-150 KB — independiente del tamaño/formato del archivo de
// entrada. Compatible con cualquier imagen que el browser pueda decodificar
// (incluyendo HEIC en Safari iOS). Mantiene un preview en vivo en el mismo
// canvas que se exporta, así lo que ves es lo que queda.

const PREVIEW_SIZE = 320;
const OUTPUT_SIZE = 512;
const MIN_SCALE = 0.5;
const MAX_SCALE = 4;
// WebP cuando el browser lo soporta (~30 % más liviano que JPEG a la misma
// calidad percibida). Si no, fallback a JPEG. La pruebamos en runtime.
const QUALITY = 0.88;

// Detecta soporte de WebP a partir de un canvas 1×1.
function supportsWebp(): boolean {
  try {
    const c = document.createElement('canvas');
    c.width = 1;
    c.height = 1;
    return c.toDataURL('image/webp').startsWith('data:image/webp');
  } catch {
    return false;
  }
}

interface AvatarEditorProps {
  file: File | null;
  onCancel: () => void;
  onConfirm: (blob: Blob) => Promise<void> | void;
}

export function AvatarEditor({ file, onCancel, onConfirm }: AvatarEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const draggingRef = useRef<{ x: number; y: number } | null>(null);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [scale, setScale] = useState(1);
  const [rotation, setRotation] = useState(0); // grados
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 1. Carga del archivo → HTMLImageElement
  useEffect(() => {
    if (!file) {
      setImage(null);
      return;
    }
    setLoading(true);
    setError(null);
    setOffset({ x: 0, y: 0 });
    setScale(1);
    setRotation(0);
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      setImage(img);
      setLoading(false);
    };
    img.onerror = () => {
      setError(
        'No pudimos abrir esta imagen. Probá con otra (JPG, PNG, WEBP o HEIC si estás en Safari).',
      );
      setLoading(false);
    };
    img.src = url;
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [file]);

  // baseScale = el factor para que la imagen cubra justo el preview cuadrado.
  // Multiplicamos por `scale` (slider/wheel del usuario) para el zoom efectivo.
  const baseScale = useMemo(() => {
    if (!image) return 1;
    return Math.max(
      PREVIEW_SIZE / image.naturalWidth,
      PREVIEW_SIZE / image.naturalHeight,
    );
  }, [image]);

  // Dibuja la imagen en un canvas de tamaño arbitrario. Reusado para el
  // preview y para la exportación final.
  const drawToCanvas = useCallback(
    (canvas: HTMLCanvasElement, size: number) => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.save();
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, size, size);
      if (!image) {
        ctx.restore();
        return;
      }
      const factor = size / PREVIEW_SIZE;
      const effScale = baseScale * scale;
      const drawW = image.naturalWidth * effScale * factor;
      const drawH = image.naturalHeight * effScale * factor;
      ctx.translate(size / 2 + offset.x * factor, size / 2 + offset.y * factor);
      ctx.rotate((rotation * Math.PI) / 180);
      ctx.drawImage(image, -drawW / 2, -drawH / 2, drawW, drawH);
      ctx.restore();
    },
    [image, scale, rotation, offset, baseScale],
  );

  // Render del preview con cada cambio de estado.
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    drawToCanvas(c, PREVIEW_SIZE);
  }, [drawToCanvas]);

  // Gestos
  function onPointerDown(e: ReactPointerEvent<HTMLCanvasElement>) {
    (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
    draggingRef.current = { x: e.clientX, y: e.clientY };
  }
  function onPointerMove(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (!draggingRef.current) return;
    const dx = e.clientX - draggingRef.current.x;
    const dy = e.clientY - draggingRef.current.y;
    draggingRef.current = { x: e.clientX, y: e.clientY };
    setOffset((o) => ({ x: o.x + dx, y: o.y + dy }));
  }
  function onPointerUp(e: ReactPointerEvent<HTMLCanvasElement>) {
    (e.target as HTMLCanvasElement).releasePointerCapture(e.pointerId);
    draggingRef.current = null;
  }
  function onWheel(e: ReactWheelEvent<HTMLCanvasElement>) {
    const delta = -e.deltaY * 0.0015;
    setScale((s) => clamp(s + delta, MIN_SCALE, MAX_SCALE));
  }

  function reset() {
    setScale(1);
    setRotation(0);
    setOffset({ x: 0, y: 0 });
  }

  async function handleConfirm() {
    if (!image) return;
    setSaving(true);
    try {
      // Render a canvas oculto 512×512. WebP si el browser lo soporta
      // (~30% más liviano), sino JPEG.
      const out = document.createElement('canvas');
      out.width = OUTPUT_SIZE;
      out.height = OUTPUT_SIZE;
      drawToCanvas(out, OUTPUT_SIZE);
      const mime = supportsWebp() ? 'image/webp' : 'image/jpeg';
      const blob = await new Promise<Blob | null>((resolve) =>
        out.toBlob((b) => resolve(b), mime, QUALITY),
      );
      if (!blob) {
        setError('No pudimos generar la imagen final.');
        return;
      }
      await onConfirm(blob);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={file !== null}
      onClose={() => {
        if (!saving) onCancel();
      }}
      title="Ajustá tu foto"
      kicker="Mi perfil"
      width={520}
      closeOnBackdrop={!saving}
      footer={
        <div className="flex w-full items-center justify-end gap-2">
          <Button
            variant="ghost"
            onClick={onCancel}
            disabled={saving}
          >
            Cancelar
          </Button>
          <Button onClick={() => void handleConfirm()} loading={saving} disabled={!image || saving}>
            Guardar foto
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-brand-muted">
          Arrastrá para mover, usá la rueda o el slider para zoom, y los
          botones para rotar. Subimos una imagen optimizada (cuadrada,
          512&nbsp;px, JPEG) — no importa el tamaño original.
        </p>

        <div className="flex justify-center">
          <div
            className={cn(
              'relative overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 shadow-inner',
              loading && 'opacity-70',
            )}
            style={{ width: PREVIEW_SIZE, height: PREVIEW_SIZE }}
          >
            <canvas
              ref={canvasRef}
              width={PREVIEW_SIZE}
              height={PREVIEW_SIZE}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onWheel={onWheel}
              className="block touch-none select-none cursor-grab active:cursor-grabbing"
            />
            {loading && (
              <div className="absolute inset-0 grid place-items-center bg-white/70 text-sm text-brand-muted">
                <Loader2 size={18} className="animate-spin" />
              </div>
            )}
            {/* Marco circular guía para visualizar cómo quedará el avatar */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0"
              style={{
                background:
                  'radial-gradient(circle at center, transparent 49%, rgba(255,255,255,0.55) 51%)',
              }}
            />
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 rounded-2xl ring-1 ring-inset ring-brand-cyan/30"
            />
          </div>
        </div>

        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </div>
        )}

        <div className="space-y-3">
          <SliderRow
            label="Zoom"
            value={scale}
            min={MIN_SCALE}
            max={MAX_SCALE}
            step={0.02}
            onChange={setScale}
            display={`${Math.round(scale * 100)}%`}
            leftIcon={<ZoomOut size={13} />}
            rightIcon={<ZoomIn size={13} />}
          />
          <SliderRow
            label="Rotación"
            value={rotation}
            min={-180}
            max={180}
            step={1}
            onChange={setRotation}
            display={`${rotation}°`}
            leftIcon={
              <button
                type="button"
                onClick={() => setRotation((r) => r - 90)}
                className="text-brand-muted hover:text-brand-cyan"
                title="Rotar −90°"
                aria-label="Rotar −90°"
              >
                <RotateCcw size={13} />
              </button>
            }
            rightIcon={
              <button
                type="button"
                onClick={() => setRotation((r) => r + 90)}
                className="text-brand-muted hover:text-brand-cyan"
                title="Rotar +90°"
                aria-label="Rotar +90°"
              >
                <RotateCw size={13} />
              </button>
            }
          />
          <div className="flex items-center justify-end">
            <button
              type="button"
              onClick={reset}
              className="inline-flex items-center gap-1 text-xs font-medium text-brand-muted hover:text-brand-cyan"
            >
              <RefreshCcw size={11} /> Reset
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  onChange,
  display,
  leftIcon,
  rightIcon,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (n: number) => void;
  display: string;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="font-semibold text-brand-ink">{label}</span>
        <span className="font-mono text-brand-muted">{display}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="grid h-6 w-6 place-items-center text-brand-muted">
          {leftIcon}
        </span>
        <input
          type="range"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(e) => onChange(Number(e.target.value))}
          className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-slate-200 accent-brand-cyan"
        />
        <span className="grid h-6 w-6 place-items-center text-brand-muted">
          {rightIcon}
        </span>
      </div>
    </div>
  );
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}
