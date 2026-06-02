// ============================================================================
// storageKeys.ts · helper para construir keys de Supabase Storage seguras.
//
// Bug capitalizado: 2026-06-02 (E-GG-40). El upload de "Transferencia
// Inscripción de Jorge Adrián Alejandro Prieto.pdf" desde el wizard de
// activación fallaba con:
//
//   "Invalid key: <uuid>/<timestamp>-Transferencia_Inscripción_de_..."
//
// porque `solicitudes.ts:uploadAdjuntoGestoria` solo reemplazaba espacios
// con `_` y dejaba caracteres acentuados (ó, í, á) y la ñ. Supabase Storage
// es estricto con la key: caracteres fuera del rango ASCII seguro
// (a-z, A-Z, 0-9, _, ., -) pueden ser rechazados según la versión del
// runtime — y aunque los acepte, la URL pública/firmada queda mal
// encodeada en el cliente.
//
// El resto de los services del repo (`tramites`, `trackings`, `partners`,
// `formularios-admin`, `accesoExterno`, `campus`, `encuestas`) ya usaban
// regex equivalentes — este helper unifica el patrón en un solo lugar
// para no volver a tener inconsistencias.
// ============================================================================

/**
 * Sanitiza un nombre de archivo de usuario para usar como key en
 * Supabase Storage. Pasos:
 *   1. NFKD: descompone caracteres acentuados (ó → o + ́).
 *   2. Quita los diacríticos (combining marks U+0300..U+036F).
 *   3. Reemplaza cualquier char fuera de [a-zA-Z0-9._-] por `_`.
 *   4. Colapsa runs de `_` para evitar paths feos.
 *   5. Recorta a 200 chars para no romper el límite de Storage (1024 total).
 *   6. Fallback `archivo` si quedó vacío (caso degenerado).
 *
 * @example
 *   safeStorageKey('Transferencia Inscripción Niño.pdf')
 *   // → 'Transferencia_Inscripcion_Nino.pdf'
 */
export function safeStorageKey(filename: string): string {
  if (!filename) return 'archivo';
  const clean = filename
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')   // diacríticos
    .replace(/[^a-zA-Z0-9._-]+/g, '_') // cualquier otro → _
    .replace(/_+/g, '_')                // colapsar __
    .replace(/^_+|_+$/g, '')            // recortar bordes
    .slice(0, 200);
  return clean || 'archivo';
}

/**
 * Construye una key de Storage con prefijo de scope (típicamente un UUID
 * de entidad) + timestamp para evitar colisiones + nombre sanitizado.
 *
 * @example
 *   buildStorageKey('47c76049-fcad-...', file.name)
 *   // → '47c76049-fcad-.../1780432483789-Transferencia_Inscripcion.pdf'
 */
export function buildStorageKey(scope: string, filename: string): string {
  return `${scope}/${Date.now()}-${safeStorageKey(filename)}`;
}
