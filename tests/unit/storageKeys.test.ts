import { describe, it, expect } from 'vitest';
import { safeStorageKey, buildStorageKey } from '@/lib/storageKeys';

describe('safeStorageKey (E-GG-40 / R20)', () => {
  it('quita acentos y ñ, y reemplaza espacios por _', () => {
    expect(safeStorageKey('Transferencia Inscripción Niño.pdf')).toBe('Transferencia_Inscripcion_Nino.pdf');
  });

  it('deja SOLO [a-zA-Z0-9._-] (caracteres inválidos de key de Storage fuera)', () => {
    expect(safeStorageKey('a/b\\c*d?e:f.pdf')).toMatch(/^[a-zA-Z0-9._-]+$/);
  });

  it('colapsa runs de _ y recorta los bordes', () => {
    expect(safeStorageKey('  hola   mundo  .pdf')).toBe('hola_mundo_.pdf');
  });

  it('vacío o degenerado → "archivo" (nunca key vacía)', () => {
    expect(safeStorageKey('')).toBe('archivo');
    expect(safeStorageKey('***')).toBe('archivo');
  });
});

describe('buildStorageKey', () => {
  it('produce scope/<timestamp>-<nombre saneado>', () => {
    expect(buildStorageKey('abc-123', 'Mi Foto.png')).toMatch(/^abc-123\/\d+-Mi_Foto\.png$/);
  });
});
