// Motor de recurrencia VIRTUAL (handoff sección B5 + F3 + lecciones E2, E3,
// E10, E12, E13). La fila madre guarda la regla; las ocurrencias se calculan
// en runtime y los overrides se aplican sobre la fecha original.
//
// Reglas:
// - recurrence='none' → 1 ocurrencia si cae en rango.
// - daily / weekly (con recurrenceWeekdays) / monthly (con recurrenceMonthday).
// - Override 'skipped'  → no se genera la ocurrencia.
// - Override 'moved'    → se relocaliza startAt/endAt a newStartAt/newEndAt.
// - Override 'done'     → isDone=true para esa ocurrencia (no toca la madre).
// - recurrence_until    → cota superior de la serie.
//
// Guard de iteración < 1500 días para evitar loops infinitos (handoff).

import type { AgendaEvento, AgendaOverride } from '@/services/api/agenda';

export interface Ocurrencia {
  key: string; // `${ev.id}__${fechaOriginal}`
  evento: AgendaEvento;
  fechaOriginal: string; // YYYY-MM-DD
  startAt: string | null;
  endAt: string | null;
  allDay: boolean;
  isDone: boolean;
  esRecurrente: boolean;
  overrideId: string | null;
}

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function atMidnight(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

function clampStart(evStart: Date, from: Date): Date {
  return evStart > from ? new Date(evStart) : new Date(from);
}

export function expandirEvento(
  ev: AgendaEvento,
  overrides: AgendaOverride[],
  from: Date,
  to: Date,
): Ocurrencia[] {
  if (!ev.startAt) return []; // sin fecha → bandeja, no entra en calendario

  const ovByDate = new Map<string, AgendaOverride>();
  overrides.filter((o) => o.parentId === ev.id).forEach((o) => ovByDate.set(o.originalDate, o));

  const baseStart = new Date(ev.startAt);
  const horaH = baseStart.getHours();
  const horaM = baseStart.getMinutes();
  const durMs = ev.endAt ? new Date(ev.endAt).getTime() - baseStart.getTime() : 0;
  const out: Ocurrencia[] = [];
  const limiteSerie = ev.recurrenceUntil
    ? new Date(`${ev.recurrenceUntil}T23:59:59`)
    : null;

  const push = (diaOriginal: Date): void => {
    const fechaOrig = ymd(diaOriginal);
    const ov = ovByDate.get(fechaOrig);
    if (ov?.status === 'skipped') return;

    let s = new Date(diaOriginal);
    if (!ev.allDay) s.setHours(horaH, horaM, 0, 0);
    else s.setHours(0, 0, 0, 0);
    let e: Date | null = durMs ? new Date(s.getTime() + durMs) : null;

    if (ov?.status === 'moved' && ov.newStartAt) {
      s = new Date(ov.newStartAt);
      e = ov.newEndAt
        ? new Date(ov.newEndAt)
        : durMs
          ? new Date(s.getTime() + durMs)
          : null;
    }
    const isDone = ev.recurrence === 'none' ? ev.isDone : ov?.status === 'done';

    out.push({
      key: `${ev.id}__${fechaOrig}`,
      evento: ev,
      fechaOriginal: fechaOrig,
      startAt: s.toISOString(),
      endAt: e ? e.toISOString() : null,
      allDay: ev.allDay,
      isDone,
      esRecurrente: ev.recurrence !== 'none',
      overrideId: ov?.id ?? null,
    });
  };

  if (ev.recurrence === 'none') {
    const d = atMidnight(baseStart);
    if (d >= atMidnight(from) && d <= atMidnight(to)) push(d);
    return out;
  }

  const ini = clampStart(
    new Date(baseStart.getFullYear(), baseStart.getMonth(), baseStart.getDate()),
    atMidnight(from),
  );
  const finRango = atMidnight(to);
  const fin = limiteSerie && limiteSerie < finRango ? limiteSerie : finRango;
  const cursor = new Date(ini);
  let guard = 0;
  while (cursor <= fin && guard < 1500) {
    guard++;
    let aplica = false;
    if (ev.recurrence === 'daily') aplica = true;
    else if (ev.recurrence === 'weekly') {
      const dias =
        ev.recurrenceWeekdays && ev.recurrenceWeekdays.length > 0
          ? ev.recurrenceWeekdays
          : [baseStart.getDay()];
      aplica = dias.includes(cursor.getDay());
    } else if (ev.recurrence === 'monthly') {
      const md = ev.recurrenceMonthday ?? baseStart.getDate();
      aplica = cursor.getDate() === md;
    }
    const cursorDay = atMidnight(cursor);
    const serieDay = atMidnight(baseStart);
    if (aplica && cursorDay >= serieDay) push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

export function expandirRango(
  eventos: AgendaEvento[],
  overrides: AgendaOverride[],
  from: Date,
  to: Date,
): Ocurrencia[] {
  const all: Ocurrencia[] = [];
  for (const ev of eventos) all.push(...expandirEvento(ev, overrides, from, to));
  all.sort((a, b) => (a.startAt ?? '').localeCompare(b.startAt ?? ''));
  return all;
}

export function etiquetaRecurrencia(ev: AgendaEvento): string | null {
  if (ev.recurrence === 'none') return null;
  if (ev.recurrence === 'daily') return 'Todos los días';
  if (ev.recurrence === 'monthly') {
    const md =
      ev.recurrenceMonthday ?? (ev.startAt ? new Date(ev.startAt).getDate() : 1);
    return `Cada día ${md} del mes`;
  }
  const nombres = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
  const dias =
    ev.recurrenceWeekdays && ev.recurrenceWeekdays.length > 0
      ? ev.recurrenceWeekdays
      : ev.startAt
        ? [new Date(ev.startAt).getDay()]
        : [];
  if (dias.length === 0) return 'Semanal';
  return `Cada ${dias.map((d) => nombres[d]).join(', ')}`;
}

// --- E10: resolución efectiva para la Lista ------------------------------
// Aplica el override de la fecha BASE del evento madre. Antes la Lista
// ignoraba overrides → un recurrente postergado quedaba en el día original.
export interface EfectivoEv {
  startAt: string | null;
  endAt: string | null;
  overrideId: string | null;
  skipped: boolean;
}

export function efectivoDe(ev: AgendaEvento, overrides: AgendaOverride[]): EfectivoEv {
  if (!ev.startAt) return { startAt: null, endAt: null, overrideId: null, skipped: false };
  const od = ev.startAt.slice(0, 10);
  const ov = overrides.find((o) => o.parentId === ev.id && o.originalDate === od);
  if (!ov) return { startAt: ev.startAt, endAt: ev.endAt, overrideId: null, skipped: false };
  if (ov.status === 'skipped')
    return { startAt: ev.startAt, endAt: ev.endAt, overrideId: ov.id, skipped: true };
  if (ov.status === 'moved')
    return {
      startAt: ov.newStartAt ?? ev.startAt,
      endAt: ov.newEndAt ?? ev.endAt,
      overrideId: ov.id,
      skipped: false,
    };
  return { startAt: ev.startAt, endAt: ev.endAt, overrideId: ov.id, skipped: false };
}
