import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseEntradaAgenda, previewLabel } from '@/lib/agendaParse';
import type { AgendaCategoria } from '@/services/api/agenda';

// El parser usa new Date() para fechas relativas (hoy/mañana). Congelamos el reloj
// a un instante fijo para que TODO sea determinista.
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-06-15T12:00:00')); // lunes 15-jun-2026, mediodía local
});
afterEach(() => vi.useRealTimers());

const cats: AgendaCategoria[] = [{ id: 'c1', name: 'Jurídico' }] as unknown as AgendaCategoria[];

describe('parseEntradaAgenda · vacío y defaults', () => {
  it('input vacío → todo default', () => {
    const r = parseEntradaAgenda('');
    expect(r.title).toBe('');
    expect(r.startAt).toBeNull();
    expect(r.priority).toBe('media');
    expect(r.recurrence).toBe('none');
  });
});

describe('parseEntradaAgenda · prioridad', () => {
  it('!! → alta', () => {
    const r = parseEntradaAgenda('!! comprar');
    expect(r.priority).toBe('alta');
    expect(r.title).toBe('comprar');
  });
  it('!baja → baja', () => {
    expect(parseEntradaAgenda('!baja tarea').priority).toBe('baja');
  });
});

describe('parseEntradaAgenda · categoría', () => {
  it('#juridico matchea la categoría (sin acentos, startsWith)', () => {
    const r = parseEntradaAgenda('#juridico llamar', cats);
    expect(r.categoryId).toBe('c1');
    expect(r.categoryHint).toBe('juridico');
    expect(r.title).toBe('llamar');
  });
  it('categoría desconocida → hint sin id', () => {
    const r = parseEntradaAgenda('#zzz x', cats);
    expect(r.categoryHint).toBe('zzz');
    expect(r.categoryId).toBeNull();
  });
});

describe('parseEntradaAgenda · todo el día y recurrencia', () => {
  it('"todo el día" → allDay', () => {
    expect(parseEntradaAgenda('todo el día feriado').allDay).toBe(true);
  });
  it('"todos los días" → daily', () => {
    expect(parseEntradaAgenda('todos los días gym').recurrence).toBe('daily');
  });
  it('"todos los lunes" → weekly [1]', () => {
    const r = parseEntradaAgenda('todos los lunes');
    expect(r.recurrence).toBe('weekly');
    expect(r.recurrenceWeekdays).toEqual([1]);
  });
  it('"todos los lunes y miercoles" → weekly [1,3]', () => {
    expect(parseEntradaAgenda('todos los lunes y miercoles').recurrenceWeekdays).toEqual([1, 3]);
  });
  it('"el 5 de cada mes" → monthly, monthday 5', () => {
    const r = parseEntradaAgenda('el 5 de cada mes pagar');
    expect(r.recurrence).toBe('monthly');
    expect(r.recurrenceMonthday).toBe(5);
    expect(r.title).toBe('pagar');
  });
});

describe('parseEntradaAgenda · fechas y horas', () => {
  it('DD/MM → fecha con hora default 09:00', () => {
    const r = parseEntradaAgenda('15/03 dentista');
    const d = new Date(r.startAt!);
    expect(d.getMonth()).toBe(2); // marzo
    expect(d.getDate()).toBe(15);
    expect(d.getHours()).toBe(9);
    expect(r.title).toBe('dentista');
  });
  it('DD/MM/YY con año de 2 dígitos → 20YY', () => {
    const r = parseEntradaAgenda('15/03/27 x');
    expect(new Date(r.startAt!).getFullYear()).toBe(2027);
  });
  it('"hoy 14:30" → hora 14:30 y endAt = +1h', () => {
    const r = parseEntradaAgenda('hoy 14:30 reunion');
    const s = new Date(r.startAt!);
    expect(s.getHours()).toBe(14);
    expect(s.getMinutes()).toBe(30);
    expect(new Date(r.endAt!).getHours()).toBe(15);
    expect(r.title).toBe('reunion');
  });
  it('am/pm: "hoy 2pm" → 14; "hoy 9am" → 9', () => {
    expect(new Date(parseEntradaAgenda('hoy 2pm').startAt!).getHours()).toBe(14);
    expect(new Date(parseEntradaAgenda('hoy 9am').startAt!).getHours()).toBe(9);
  });
  it('"hoy a las 9 y media" → 9:30', () => {
    const s = new Date(parseEntradaAgenda('hoy a las 9 y media').startAt!);
    expect(s.getHours()).toBe(9);
    expect(s.getMinutes()).toBe(30);
  });
});

describe('previewLabel', () => {
  it('sin fecha → "sin fecha"', () => {
    expect(previewLabel(parseEntradaAgenda(''))).toContain('sin fecha');
  });
  it('daily se refleja en el label', () => {
    expect(previewLabel(parseEntradaAgenda('todos los días gym'))).toContain('todos los días');
  });
});
