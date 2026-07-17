// E-GG-126 (núcleo) · resolución de archivos en buckets PRIVADOS.
//
// Los identificadores persistidos (tracking_lineas.archivos_urls,
// tramites.documento_final_url, comprobantes.partner_factura_pdf_url) siguen
// siendo la URL "pública" completa que generó getPublicUrl — con el bucket
// privado esa URL directa da 400, pero como identificador contiene bucket+path
// y es compatible con TODOS los datos históricos y columnas polimórficas
// (que mezclan URLs externas y https://gestionglobal.ar/verificar/...).
//
// Este helper detecta si un valor apunta a un bucket privado firmable y lo
// resuelve a una signed URL en el momento del click (firmar on-click evita
// URLs vencidas en pestañas largas — las firmas duran 1h). Cualquier otro
// valor (URL externa, /verificar/, buckets públicos) pasa tal cual.

import { supabase } from '@/lib/supabase';

/** Buckets privados cuyos identificadores persistidos se resuelven a signed URL. */
const BUCKETS_FIRMABLES = [
  'gestor-uploads',
  'tramite-documento-final',
  'partner-facturas',
] as const;

const RE_STORAGE =
  /\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/]+)\/(.+?)(?:\?.*)?$/;

export interface ArchivoStorage {
  bucket: string;
  path: string;
}

/** Extrae {bucket, path} si el valor es una URL de Supabase Storage; null si no. */
export function parsearArchivoStorage(url: string): ArchivoStorage | null {
  const m = RE_STORAGE.exec(url);
  const bucket = m?.[1];
  const rawPath = m?.[2];
  if (!bucket || !rawPath) return null;
  try {
    return { bucket, path: decodeURIComponent(rawPath) };
  } catch {
    return { bucket, path: rawPath };
  }
}

/** ¿El valor apunta a uno de los buckets privados firmables? */
export function esArchivoProtegido(url: string): boolean {
  const p = parsearArchivoStorage(url);
  return !!p && (BUCKETS_FIRMABLES as readonly string[]).includes(p.bucket);
}

/** Nombre visible del archivo — derivarlo SIEMPRE de la URL cruda/path,
 *  nunca de una signed URL (el ?token=… rompe el último segmento). */
export function nombreArchivoStorage(url: string): string {
  const p = parsearArchivoStorage(url);
  const base = (p ? p.path : url).split('?')[0] ?? url;
  const seg = base.split('/').pop() ?? base;
  try {
    return decodeURIComponent(seg);
  } catch {
    return seg;
  }
}

/** Resuelve un valor persistido a una URL abrible: signed URL (1h, download)
 *  para los buckets privados; passthrough para todo lo demás. */
export async function resolverArchivoProtegido(url: string): Promise<string> {
  const p = parsearArchivoStorage(url);
  if (!p || !(BUCKETS_FIRMABLES as readonly string[]).includes(p.bucket)) {
    return url;
  }
  const { data, error } = await supabase.storage
    .from(p.bucket)
    .createSignedUrl(p.path, 3600, { download: true });
  if (error || !data?.signedUrl) {
    throw new Error(error?.message ?? 'No se pudo firmar el archivo');
  }
  return data.signedUrl;
}

/** Abre el archivo en una pestaña nueva, firmando si hace falta. */
export async function abrirArchivoProtegido(url: string): Promise<void> {
  const resolved = await resolverArchivoProtegido(url);
  window.open(resolved, '_blank', 'noopener');
}
