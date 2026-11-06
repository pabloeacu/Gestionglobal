// searchText — canon de búsqueda de texto del front: insensible a mayúsculas Y a
// acentos/diacríticos. Hermano de `safeStorageKey` (R20, que normaliza claves de
// Storage), pero acá el objetivo es MATCHEAR, no sanear un path.
//
// Por qué NFD + strip U+0300–U+036F: NFD descompone un carácter acentuado en su
// base + el diacrítico combinante (á → "a" + U+0301). Al borrar el rango de
// combinantes queda la letra base. Así "balcón" y "balcon" pliegan al mismo
// texto y el `.includes()` matchea en los dos sentidos (escribo con o sin acento;
// el dato está con o sin acento). Capitaliza E-GG-… (buscador de LexPH no hallaba
// "balcon"). Reemplaza el uso ad-hoc de `.toLowerCase()` en todos los buscadores.

/** Pliega texto para comparación de búsqueda: NFD, sin diacríticos, minúsculas, trim. */
export function foldText(s: string | null | undefined): string {
  return (s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * ¿Alguno de los campos contiene el término? `needleFolded` ya viene plegado con
 * `foldText` (plegarlo una sola vez por render, no por fila). Si está vacío → true
 * (sin término = no filtra). Ignora campos null/undefined.
 */
export function matchesFold(
  needleFolded: string,
  ...haystacks: (string | null | undefined)[]
): boolean {
  if (!needleFolded) return true;
  return haystacks.some((h) => foldText(h).includes(needleFolded));
}
