// ============================================================================
// adjuntos.ts · validación cliente de archivos ANTES de subirlos a Storage.
//
// E-GG-170 (caso Rodríguez): los adjuntos que violaban los límites del bucket
// (tamaño / MIME) viajaban igual y morían silenciosamente en Storage — el
// usuario no se enteraba o veía un error técnico. Este helper es el espejo
// cliente de esos límites: cada superficie de upload pasa su config (la del
// bucket destino) y rechaza el archivo con un mensaje accionable en español
// antes de gastar la subida.
//
// Mantener cada `LimitesAdjunto` EN SYNC con el bucket destino
// (storage.buckets: file_size_limit / allowed_mime_types).
// ============================================================================

/** Límites del bucket destino, espejados en el cliente. */
export interface LimitesAdjunto {
  maxMB: number;
  /** Whitelist de MIMEs del bucket. Si falta, no se valida formato. */
  mimes?: Set<string>;
  /** Etiqueta humana de los formatos aceptados, ej. "JPG, PNG o PDF". */
  formatosLabel?: string;
}

// Fallback por extensión para archivos con File.type vacío o basura
// (descargas renombradas, providers de Android que reportan .xlsx como
// application/octet-stream, Windows con registro roto).
const MIME_POR_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

const MIMES_CONOCIDOS = new Set(Object.values(MIME_POR_EXTENSION));

/**
 * MIME efectivo de un archivo: el type declarado si es uno de los conocidos;
 * si está vacío o fuera de esa whitelist, cae a la extensión; último recurso
 * el declarado tal cual (cubre formatos legítimos fuera del mapa, ej. SVG
 * declarado correctamente antes de agregarlo al mapa).
 */
export function mimeDeArchivo(f: File): string {
  const t = (f.type ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  if (t && MIMES_CONOCIDOS.has(t)) return t;
  const ext = f.name.split('.').pop()?.toLowerCase() ?? '';
  return MIME_POR_EXTENSION[ext] ?? t;
}

/** Devuelve el motivo de rechazo del archivo (mensaje para el usuario final), o null si es válido. */
export function motivoRechazoAdjunto(f: File, lim: LimitesAdjunto): string | null {
  // Placeholder de cloud drive no descargado (0 bytes): satisface el input
  // con un archivo inservible.
  if (f.size === 0) {
    return `«${f.name}» está vacío (0 bytes). Si está en la nube, descargalo al dispositivo y volvé a adjuntarlo.`;
  }
  if (f.size > lim.maxMB * 1024 * 1024) {
    return `«${f.name}» pesa ${(f.size / 1048576).toFixed(1)} MB y el máximo es ${lim.maxMB} MB.`;
  }
  if (lim.mimes && !lim.mimes.has(mimeDeArchivo(f))) {
    return lim.formatosLabel
      ? `El formato de «${f.name}» no está soportado. Aceptamos ${lim.formatosLabel}.`
      : `El formato de «${f.name}» no está soportado.`;
  }
  return null;
}
