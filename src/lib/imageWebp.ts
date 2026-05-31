// Helper compartido: detección runtime de soporte WebP + export de canvas a
// blob con el mime óptimo (WebP cuando se puede, JPEG en fallback).
//
// Se usa desde:
//   · AvatarEditor (perfil de usuario)
//   · ImageUploader (Campus: banner curso, ícono módulo, foto docente)
//
// WebP suele pesar ~30% menos que JPEG a calidad percibida equivalente.
// Soporte browser actual >95% (Safari 14+, Chrome 23+, Firefox 65+, Edge).

let _supports: boolean | null = null;

export function supportsWebp(): boolean {
  if (_supports !== null) return _supports;
  if (typeof document === 'undefined') {
    _supports = false;
    return _supports;
  }
  try {
    const c = document.createElement('canvas');
    c.width = 1;
    c.height = 1;
    _supports = c.toDataURL('image/webp').startsWith('data:image/webp');
  } catch {
    _supports = false;
  }
  return _supports;
}

export type OptimizedImageMime = 'image/webp' | 'image/jpeg';
export type OptimizedImageExt = 'webp' | 'jpg';

export function preferredImageMime(): OptimizedImageMime {
  return supportsWebp() ? 'image/webp' : 'image/jpeg';
}

export function preferredImageExt(): OptimizedImageExt {
  return supportsWebp() ? 'webp' : 'jpg';
}

/** Exporta el canvas con el mime óptimo. Resuelve con el blob, mime y ext. */
export async function canvasToOptimizedBlob(
  canvas: HTMLCanvasElement,
  quality = 0.9,
): Promise<{ blob: Blob; mime: OptimizedImageMime; ext: OptimizedImageExt }> {
  const mime = preferredImageMime();
  const ext = preferredImageExt();
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => {
        if (!b) {
          reject(new Error('canvas.toBlob devolvió null'));
          return;
        }
        resolve({ blob: b, mime, ext });
      },
      mime,
      quality,
    );
  });
}
