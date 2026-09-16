import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  hoyISO,
  hoyISOoffset,
  toISODate,
  parseLocalDate,
  daysBetween,
  formatDateShort,
  formatTimestampDate,
} from '@/lib/dates';

// Familia E-GG-194 (fecha contable corrida un día tras las 21 hs AR, reporte JL).
// La BD corre en UTC; una cobranza a las 21:36 ART es 00:36 UTC del día siguiente.
// Estos tests fijan el INVARIANTE: la fecha AR nunca se corre al día UTC.
describe('dates · zona horaria AR (E-GG-194)', () => {
  it('toISODate: instante de la tarde-noche AR NO se corre al día UTC siguiente', () => {
    // 2026-08-25 00:36 UTC = 2026-08-24 21:36 ART → debe ser el 24, no el 25.
    expect(toISODate(new Date('2026-08-25T00:36:00Z'))).toBe('2026-08-24');
    // Un instante de media mañana AR cae en el mismo día en ambas zonas.
    expect(toISODate(new Date('2026-08-25T12:00:00Z'))).toBe('2026-08-25');
  });

  it('formatTimestampDate: un timestamptz nocturno AR muestra el día AR, no el UTC', () => {
    const s = formatTimestampDate('2026-08-25T00:36:00Z'); // 24 ago AR
    expect(s).toContain('24');
    expect(s).not.toContain('25');
    expect(formatTimestampDate(null)).toBe('—');
    expect(formatTimestampDate(undefined)).toBe('—');
  });

});

describe('dates · hoyISO/hoyISOoffset (reloj congelado → determinista)', () => {
  afterEach(() => vi.useRealTimers());

  it('formato yyyy-mm-dd y desplazamiento exacto en horario AR', () => {
    // 2026-06-15 15:00 UTC = 12:00 ART → el "hoy" AR es el 15.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-15T15:00:00Z'));
    expect(hoyISO()).toBe('2026-06-15');
    expect(hoyISOoffset(0)).toBe('2026-06-15');
    expect(hoyISOoffset(1)).toBe('2026-06-16');
    expect(hoyISOoffset(-1)).toBe('2026-06-14');
    expect(hoyISO()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('dates · parseLocalDate (anti-corrimiento de date-only)', () => {
  it('parsea yyyy-mm-dd como fecha LOCAL (no UTC) → el día no se retrocede', () => {
    const d = parseLocalDate('2026-09-11');
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(8); // septiembre (0-indexed)
    expect(d.getDate()).toBe(11);
  });

  it('tolera un ISO completo cortando a la parte de fecha', () => {
    const d = parseLocalDate('2026-09-11T23:00:00Z');
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(8);
    expect(d.getDate()).toBe(11);
  });
});

describe('dates · daysBetween', () => {
  it('cuenta días corridos hasta la fecha objetivo (today explícito)', () => {
    expect(daysBetween('2026-09-20', new Date(2026, 8, 10))).toBe(10);
    expect(daysBetween('2026-09-10', new Date(2026, 8, 10))).toBe(0);
  });

  it('null/undefined → null', () => {
    expect(daysBetween(null)).toBeNull();
    expect(daysBetween(undefined)).toBeNull();
  });
});

describe('dates · formatDateShort (vacío)', () => {
  it('null/undefined → guion', () => {
    expect(formatDateShort(null)).toBe('—');
    expect(formatDateShort(undefined)).toBe('—');
  });
});
