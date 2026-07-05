// DGG-98 (pedido Pablo) · Validación + formateo de CUIT/CUIL para TODOS los formularios.
// Formato canónico: XX-XXXXXXXX-X (2 + 8 + 1 = 11 dígitos). Se autocompletan los guiones
// mientras se tipea; la validación exige 11 dígitos + dígito verificador (mód 11) para
// evitar datos incorrectos, sin importar si el usuario los puso con o sin guiones.

/** Deja sólo dígitos (descarta guiones, espacios, puntos, etc.). */
export function soloDigitosCuit(v: string | null | undefined): string {
  return (v ?? '').replace(/\D/g, '');
}

/**
 * Formatea a `XX-XXXXXXXX-X` a partir de lo tipeado. Acepta entrada con o sin guiones
 * y agrupa 2-8-1 según los dígitos disponibles (autocompleta guiones progresivamente).
 * Cap a 11 dígitos: no deja escribir de más.
 */
export function formatCuit(v: string | null | undefined): string {
  const d = soloDigitosCuit(v).slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 10) return `${d.slice(0, 2)}-${d.slice(2)}`;
  return `${d.slice(0, 2)}-${d.slice(2, 10)}-${d.slice(10)}`;
}

/** Dígito verificador estándar AFIP (mód 11) sobre los primeros 10 dígitos. */
function digitoVerificadorCuit(diez: string): number {
  const mult = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  let suma = 0;
  for (let i = 0; i < 10; i++) suma += Number(diez[i] ?? '0') * (mult[i] ?? 0);
  let ver = 11 - (suma % 11);
  if (ver === 11) ver = 0;
  if (ver === 10) ver = 9; // convención AFIP para el resto=1
  return ver;
}

/**
 * Valida un CUIT/CUIL. Devuelve un mensaje de error humano, o `null` si es válido.
 * El vacío devuelve `null` (el "requerido" se controla aparte, para no romper campos
 * opcionales). Chequea cantidad de dígitos (11) + dígito verificador.
 */
export function validarCuit(v: string | null | undefined): string | null {
  const d = soloDigitosCuit(v);
  if (d.length === 0) return null; // vacío: lo maneja `required`, no este validador
  if (d.length !== 11) {
    return 'El CUIT debe tener 11 números con el formato XX-XXXXXXXX-X.';
  }
  if (digitoVerificadorCuit(d.slice(0, 10)) !== Number(d[10])) {
    return 'El CUIT no es válido: revisá los números (el dígito verificador no coincide).';
  }
  return null;
}

/** true si el valor es un CUIT válido (o está vacío). Azúcar sobre validarCuit. */
export function esCuitValido(v: string | null | undefined): boolean {
  return validarCuit(v) === null;
}

/**
 * Heurística para detectar si un campo de formulario dinámico es un CUIT/CUIL,
 * por su `name` o `label` (los formularios existentes lo definen como text `name:'cuit'`
 * con label 'CUIT/CUIL'; también captura variantes 'cuil', 'cuit_cuil', etc.).
 */
export function esCampoCuit(field: { name?: string | null; label?: string | null; type?: string | null }): boolean {
  if (field.type === 'cuit') return true;
  // Word-boundary para no matchear "circuito", "cuidado", etc. Captura 'cuit', 'cuil',
  // 'CUIT/CUIL'. Los formularios existentes definen el campo como name:'cuit'.
  const hay = (s?: string | null) => !!s && /\bcui[tl]\b/i.test(s);
  return hay(field.name) || hay(field.label);
}
