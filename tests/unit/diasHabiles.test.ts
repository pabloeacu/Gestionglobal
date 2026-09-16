import { describe, it, expect } from 'vitest';
import { addDiasHabiles } from '@/lib/diasHabiles';

// Tests robustos: no asumen el día de la semana de una fecha hardcodeada,
// verifican los INVARIANTES de la función (espejo de private.dias_habiles_add).
describe('addDiasHabiles', () => {
  it('el resultado nunca cae en sábado ni domingo', () => {
    for (let start = 1; start <= 14; start++) {
      for (let n = 1; n <= 10; n++) {
        const r = addDiasHabiles(new Date(2026, 8, start), n);
        expect(r.getDay()).not.toBe(0); // domingo
        expect(r.getDay()).not.toBe(6); // sábado
      }
    }
  });

  it('avanza EXACTAMENTE N días hábiles', () => {
    const base = new Date(2026, 8, 1);
    const r = addDiasHabiles(base, 7);
    let count = 0;
    const d = new Date(base.getTime());
    while (d < r) {
      d.setDate(d.getDate() + 1);
      const dow = d.getDay();
      if (dow !== 0 && dow !== 6) count++;
    }
    expect(count).toBe(7);
  });

  it('0 días hábiles = misma fecha', () => {
    const base = new Date(2026, 8, 11);
    expect(addDiasHabiles(base, 0).getTime()).toBe(base.getTime());
  });

  it('no muta la fecha de entrada', () => {
    const t = new Date(2026, 8, 11).getTime();
    const base = new Date(t);
    addDiasHabiles(base, 3);
    expect(base.getTime()).toBe(t);
  });
});
