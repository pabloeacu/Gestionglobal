import { describe, it, expect } from 'vitest';
import { expandirEvento, expandirRango, etiquetaRecurrencia, efectivoDe } from '@/lib/agendaRecurrencia';
import type { AgendaEvento, AgendaOverride } from '@/services/api/agenda';

// Motor de recurrencia virtual (agendaRecurrencia.ts). Es lógica de fechas + reglas
// de negocio, muy propensa a bugs (off-by-one, overrides, cota de serie). Todo puro.

// Factory con sólo los campos que las funciones leen (el resto no importa en runtime).
function ev(o: Partial<AgendaEvento>): AgendaEvento {
  return {
    id: 'ev1',
    startAt: null,
    endAt: null,
    allDay: false,
    isDone: false,
    recurrence: 'none',
    recurrenceWeekdays: null,
    recurrenceMonthday: null,
    recurrenceUntil: null,
    ...o,
  } as unknown as AgendaEvento;
}
function ovr(o: Partial<AgendaOverride>): AgendaOverride {
  return {
    id: 'ov1', parentId: 'ev1', originalDate: '2026-09-01', status: 'skipped',
    newStartAt: null, newEndAt: null, ...o,
  } as unknown as AgendaOverride;
}

const from = new Date(2026, 8, 1); // 1-sep-2026 local
const to5 = new Date(2026, 8, 5);

describe('expandirEvento · recurrence none', () => {
  it('cae en rango → 1 ocurrencia', () => {
    const occ = expandirEvento(ev({ startAt: '2026-09-03T10:00:00', recurrence: 'none' }), [], from, to5);
    expect(occ).toHaveLength(1);
    expect(occ[0]!.fechaOriginal).toBe('2026-09-03');
    expect(occ[0]!.esRecurrente).toBe(false);
  });
  it('fuera de rango → 0 ocurrencias', () => {
    const occ = expandirEvento(ev({ startAt: '2026-09-03T10:00:00', recurrence: 'none' }), [], from, new Date(2026, 8, 2));
    expect(occ).toHaveLength(0);
  });
  it('sin startAt → 0 (bandeja, no calendario)', () => {
    expect(expandirEvento(ev({ startAt: null, recurrence: 'none' }), [], from, to5)).toHaveLength(0);
  });
});

describe('expandirEvento · daily', () => {
  it('genera una ocurrencia por día del rango', () => {
    const occ = expandirEvento(ev({ startAt: '2026-09-01T10:00:00', recurrence: 'daily' }), [], from, to5);
    expect(occ.map((o) => o.fechaOriginal)).toEqual([
      '2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05',
    ]);
    expect(occ.every((o) => o.esRecurrente)).toBe(true);
  });
  it('recurrenceUntil corta la serie', () => {
    const occ = expandirEvento(
      ev({ startAt: '2026-09-01T10:00:00', recurrence: 'daily', recurrenceUntil: '2026-09-05' }),
      [], from, new Date(2026, 8, 10),
    );
    expect(occ).toHaveLength(5);
    expect(occ[occ.length - 1]!.fechaOriginal).toBe('2026-09-05');
  });
});

describe('expandirEvento · weekly / monthly', () => {
  it('weekly sólo cae en los weekdays configurados', () => {
    const occ = expandirEvento(
      ev({ startAt: '2026-09-01T10:00:00', recurrence: 'weekly', recurrenceWeekdays: [1, 3] }), // lun, mié
      [], from, new Date(2026, 8, 30),
    );
    expect(occ.length).toBeGreaterThan(0);
    // Cada ocurrencia cae en lunes(1) o miércoles(3) — chequeo por el día original a mediodía local.
    for (const o of occ) {
      const dow = new Date(o.fechaOriginal + 'T12:00:00').getDay();
      expect([1, 3]).toContain(dow);
    }
  });
  it('monthly cae sólo en el recurrenceMonthday', () => {
    const occ = expandirEvento(
      ev({ startAt: '2026-09-15T10:00:00', recurrence: 'monthly', recurrenceMonthday: 15 }),
      [], from, new Date(2026, 10, 30), // hasta 30-nov
    );
    expect(occ.map((o) => o.fechaOriginal)).toEqual(['2026-09-15', '2026-10-15', '2026-11-15']);
  });
});

describe('expandirEvento · overrides', () => {
  it("override 'skipped' excluye esa fecha", () => {
    const occ = expandirEvento(
      ev({ startAt: '2026-09-01T10:00:00', recurrence: 'daily' }),
      [ovr({ originalDate: '2026-09-02', status: 'skipped' })],
      from, new Date(2026, 8, 3),
    );
    expect(occ.map((o) => o.fechaOriginal)).toEqual(['2026-09-01', '2026-09-03']);
  });
  it("override 'moved' relocaliza el startAt de esa ocurrencia", () => {
    const occ = expandirEvento(
      ev({ startAt: '2026-09-01T10:00:00', recurrence: 'daily' }),
      [ovr({ originalDate: '2026-09-01', status: 'moved', newStartAt: '2026-09-10T15:00:00' })],
      from, new Date(2026, 8, 2),
    );
    const movida = occ.find((o) => o.fechaOriginal === '2026-09-01')!;
    expect(movida.startAt).toBe(new Date('2026-09-10T15:00:00').toISOString());
  });
});

describe('expandirRango', () => {
  it('junta y ordena por startAt', () => {
    const a = ev({ id: 'a', startAt: '2026-09-02T09:00:00', recurrence: 'none' });
    const b = ev({ id: 'b', startAt: '2026-09-01T09:00:00', recurrence: 'none' });
    const occ = expandirRango([a, b], [], from, to5);
    expect(occ.map((o) => o.evento.id)).toEqual(['b', 'a']); // b (1-sep) antes que a (2-sep)
  });
});

describe('etiquetaRecurrencia', () => {
  it('none → null', () => {
    expect(etiquetaRecurrencia(ev({ recurrence: 'none' }))).toBeNull();
  });
  it('daily → "Todos los días"', () => {
    expect(etiquetaRecurrencia(ev({ recurrence: 'daily' }))).toBe('Todos los días');
  });
  it('monthly → "Cada día N del mes"', () => {
    expect(etiquetaRecurrencia(ev({ recurrence: 'monthly', recurrenceMonthday: 10 }))).toBe('Cada día 10 del mes');
  });
  it('weekly con weekdays → nombres abreviados', () => {
    expect(etiquetaRecurrencia(ev({ recurrence: 'weekly', recurrenceWeekdays: [1, 3] }))).toBe('Cada lun, mié');
  });
});

describe('efectivoDe', () => {
  it('sin override → passthrough', () => {
    const r = efectivoDe(ev({ startAt: '2026-09-01T10:00:00', endAt: '2026-09-01T11:00:00' }), []);
    expect(r).toEqual({ startAt: '2026-09-01T10:00:00', endAt: '2026-09-01T11:00:00', overrideId: null, skipped: false });
  });
  it("override 'skipped' → skipped=true, conserva fecha", () => {
    const r = efectivoDe(
      ev({ startAt: '2026-09-01T10:00:00' }),
      [ovr({ originalDate: '2026-09-01', status: 'skipped', id: 'ovX' })],
    );
    expect(r.skipped).toBe(true);
    expect(r.overrideId).toBe('ovX');
    expect(r.startAt).toBe('2026-09-01T10:00:00');
  });
  it("override 'moved' → adopta las fechas nuevas", () => {
    const r = efectivoDe(
      ev({ startAt: '2026-09-01T10:00:00' }),
      [ovr({ originalDate: '2026-09-01', status: 'moved', newStartAt: '2026-09-09T08:00:00', newEndAt: '2026-09-09T09:00:00' })],
    );
    expect(r.startAt).toBe('2026-09-09T08:00:00');
    expect(r.endAt).toBe('2026-09-09T09:00:00');
    expect(r.skipped).toBe(false);
  });
});
