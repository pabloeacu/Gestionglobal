// Parser de lenguaje natural rioplatense para la "barra mágica" de la Agenda
// (handoff sección B6 + C7). Adapta entrada libre a un draft de evento.
//
// Soporta:
// - Fechas: hoy, mañana, pasado (mañana), nombres de día (lunes..domingo),
//   DD/MM, DD/MM/YYYY, "el 15", "en N días"
// - Horas: 9am, 9 am, 14:30, 9hs, 9 hs, 2pm, "a las 9", "9 y media"
// - Categoría: #nombre (match flexible sin acentos)
// - Prioridad: !alta / !media / !baja / !! (alta)
// - "todo el día" → allDay
// - Recurrencia: "todos los días", "todos los lunes", "cada mes", "el 5 de
//   cada mes", "semanal", "mensual"
// - Lo que no entiende, queda en title.
//
// Nada se persiste acá — devolvemos un objeto plano que el caller usa para
// abrir el modal o crear directo (regla 1: persistencia explícita).

import type { AgendaCategoria, AgendaPrioridad, AgendaRecurrencia } from '@/services/api/agenda';

export interface AgendaParseResult {
  title: string;
  startAt: string | null; // ISO
  endAt: string | null;
  allDay: boolean;
  categoryId: string | null;
  categoryHint: string | null; // texto detectado, para feedback si no matchea
  priority: AgendaPrioridad;
  recurrence: AgendaRecurrencia;
  recurrenceWeekdays: number[] | null;
  recurrenceMonthday: number | null;
}

const NORM = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const DOW_MAP: Record<string, number> = {
  dom: 0, domingo: 0,
  lun: 1, lunes: 1,
  mar: 2, martes: 2,
  mie: 3, miercoles: 3,
  jue: 4, jueves: 4,
  vie: 5, viernes: 5,
  sab: 6, sabado: 6,
};

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

function fechaDOWFutura(target: number, ref = startOfToday()): Date {
  const diff = ((target - ref.getDay() + 7) % 7) || 7; // estrictamente posterior
  return addDays(ref, diff);
}

function withTime(date: Date, h: number, m: number): Date {
  const d = new Date(date);
  d.setHours(h, m, 0, 0);
  return d;
}

function defaultIso(date: Date | null, allDay: boolean, hint: { h: number; m: number } | null): string | null {
  if (!date) return null;
  if (allDay) {
    const d = new Date(date); d.setHours(0, 0, 0, 0);
    return d.toISOString();
  }
  if (hint) return withTime(date, hint.h, hint.m).toISOString();
  // sin hora: 09:00 default
  return withTime(date, 9, 0).toISOString();
}

export function parseEntradaAgenda(
  input: string,
  categorias: AgendaCategoria[] = [],
): AgendaParseResult {
  const state: AgendaParseResult = {
    title: '',
    startAt: null,
    endAt: null,
    allDay: false,
    categoryId: null,
    categoryHint: null,
    priority: 'media',
    recurrence: 'none',
    recurrenceWeekdays: null,
    recurrenceMonthday: null,
  };

  let raw = input.trim();
  if (!raw) return state;

  let fechaBase: Date | null = null;
  let horaHint: { h: number; m: number } | null = null;

  // --- 1) Prioridad
  if (/(^|\s)!!(\s|$)/.test(raw)) {
    state.priority = 'alta';
    raw = raw.replace(/(^|\s)!!(\s|$)/, ' ');
  }
  const mPrio = /(^|\s)!(alta|media|baja)(\s|$)/i.exec(raw);
  if (mPrio) {
    state.priority = (mPrio[2] ?? 'media').toLowerCase() as AgendaPrioridad;
    raw = raw.replace(mPrio[0] ?? '', ' ');
  }

  // --- 2) Categoría (#nombre)
  const mCat = /(^|\s)#([\wáéíóúñ-]+)/i.exec(raw);
  if (mCat) {
    const hint = mCat[2] ?? '';
    state.categoryHint = hint;
    const targetN = NORM(hint);
    const found = categorias.find((c) => NORM(c.name).startsWith(targetN) || NORM(c.name) === targetN);
    if (found) state.categoryId = found.id;
    raw = raw.replace(mCat[0] ?? '', ' ');
  }

  // --- 3) Todo el día
  if (/todo el d[ií]a|all\s*day/i.test(raw)) {
    state.allDay = true;
    raw = raw.replace(/todo el d[ií]a|all\s*day/gi, ' ');
  }

  // --- 4) Recurrencia
  const mTodos = /todos\s+los\s+d[ií]as|cada\s+d[ií]a|a\s+diario/i.exec(raw);
  if (mTodos) {
    state.recurrence = 'daily';
    raw = raw.replace(mTodos[0] ?? '', ' ');
  } else {
    const mSem = /(?:todos\s+los|cada)\s+([a-záéíóú]+)(?:\s+y\s+([a-záéíóú]+))?(?:\s+y\s+([a-záéíóú]+))?/i.exec(raw);
    if (mSem) {
      const dows: number[] = [];
      for (let i = 1; i <= 3; i++) {
        const tok = mSem[i];
        if (!tok) continue;
        const dn = NORM(tok).slice(0, 3);
        const idx = DOW_MAP[dn];
        if (idx !== undefined) dows.push(idx);
      }
      if (dows.length > 0) {
        state.recurrence = 'weekly';
        state.recurrenceWeekdays = Array.from(new Set(dows)).sort();
        raw = raw.replace(mSem[0] ?? '', ' ');
      }
    }
    if (state.recurrence === 'none') {
      const mMes = /el\s+(\d{1,2})\s+de\s+cada\s+mes|cada\s+mes|mensual/i.exec(raw);
      if (mMes) {
        state.recurrence = 'monthly';
        if (mMes[1]) state.recurrenceMonthday = Math.max(1, Math.min(31, parseInt(mMes[1], 10)));
        raw = raw.replace(mMes[0] ?? '', ' ');
      }
    }
    if (state.recurrence === 'none' && /\bsemanal\b/i.test(raw)) {
      state.recurrence = 'weekly';
      raw = raw.replace(/\bsemanal\b/gi, ' ');
    }
  }

  // --- 5) Fecha explícita DD/MM o DD/MM/YYYY
  const mDmy = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/.exec(raw);
  if (mDmy) {
    const dd = parseInt(mDmy[1] ?? '1', 10);
    const mm = parseInt(mDmy[2] ?? '1', 10) - 1;
    const yyyyTok = mDmy[3];
    const yyyy = yyyyTok
      ? yyyyTok.length === 2
        ? 2000 + parseInt(yyyyTok, 10)
        : parseInt(yyyyTok, 10)
      : new Date().getFullYear();
    fechaBase = new Date(yyyy, mm, dd);
    raw = raw.replace(mDmy[0] ?? '', ' ');
  }

  // --- 6) "el N"
  if (!fechaBase) {
    const mDom = /\bel\s+(\d{1,2})\b/i.exec(raw);
    if (mDom) {
      const dd = parseInt(mDom[1] ?? '0', 10);
      if (dd >= 1 && dd <= 31) {
        const hoy = startOfToday();
        let cand = new Date(hoy.getFullYear(), hoy.getMonth(), dd);
        if (cand < hoy) cand = new Date(hoy.getFullYear(), hoy.getMonth() + 1, dd);
        fechaBase = cand;
        raw = raw.replace(mDom[0] ?? '', ' ');
      }
    }
  }

  // --- 7) Palabras relativas
  if (!fechaBase) {
    if (/\bhoy\b/i.test(raw)) {
      fechaBase = startOfToday();
      raw = raw.replace(/\bhoy\b/gi, ' ');
    } else if (/\bpasado\s+ma(ñ|n)ana\b/i.test(raw)) {
      fechaBase = addDays(startOfToday(), 2);
      raw = raw.replace(/\bpasado\s+ma(ñ|n)ana\b/gi, ' ');
    } else if (/\bma(ñ|n)ana\b/i.test(raw)) {
      fechaBase = addDays(startOfToday(), 1);
      raw = raw.replace(/\bma(ñ|n)ana\b/gi, ' ');
    }
  }

  // --- 8) "en N días"
  if (!fechaBase) {
    const mEn = /\ben\s+(\d{1,3})\s+d[ií]as?\b/i.exec(raw);
    if (mEn) {
      fechaBase = addDays(startOfToday(), parseInt(mEn[1] ?? '0', 10));
      raw = raw.replace(mEn[0] ?? '', ' ');
    }
  }

  // --- 9) Nombre de día
  if (!fechaBase) {
    const mDow = /\b(domingo|lunes|martes|mi(?:é|e)rcoles|jueves|viernes|s(?:á|a)bado|dom|lun|mar|mie|mié|jue|vie|sab|sáb)\b/i.exec(raw);
    if (mDow) {
      const dn = NORM(mDow[1] ?? '').slice(0, 3);
      const idx = DOW_MAP[dn];
      if (idx !== undefined) {
        fechaBase = fechaDOWFutura(idx);
        raw = raw.replace(mDow[0] ?? '', ' ');
      }
    }
  }

  // --- 10) Hora
  const mHm = /\b(\d{1,2}):(\d{2})\s*(am|pm)?\b/i.exec(raw);
  if (mHm) {
    let h = parseInt(mHm[1] ?? '0', 10);
    const m = parseInt(mHm[2] ?? '0', 10);
    const ap = mHm[3];
    if (ap && ap.toLowerCase() === 'pm' && h < 12) h += 12;
    if (ap && ap.toLowerCase() === 'am' && h === 12) h = 0;
    horaHint = { h, m };
    raw = raw.replace(mHm[0] ?? '', ' ');
  } else {
    const mHs = /\b(\d{1,2})\s*(?:hs|h)\b/i.exec(raw);
    if (mHs) {
      horaHint = { h: parseInt(mHs[1] ?? '0', 10), m: 0 };
      raw = raw.replace(mHs[0] ?? '', ' ');
    } else {
      const mAmPm = /\b(\d{1,2})\s*(am|pm)\b/i.exec(raw);
      if (mAmPm) {
        let h = parseInt(mAmPm[1] ?? '0', 10);
        const ap = (mAmPm[2] ?? '').toLowerCase();
        if (ap === 'pm' && h < 12) h += 12;
        if (ap === 'am' && h === 12) h = 0;
        horaHint = { h, m: 0 };
        raw = raw.replace(mAmPm[0] ?? '', ' ');
      } else {
        const mAlas = /\ba\s+las?\s+(\d{1,2})(?:\s+y\s+(media|cuarto|treinta|quince))?\b/i.exec(raw);
        if (mAlas) {
          const h = parseInt(mAlas[1] ?? '0', 10);
          let m = 0;
          const tokRaw = mAlas[2];
          if (tokRaw) {
            const tok = NORM(tokRaw);
            if (tok === 'media' || tok === 'treinta') m = 30;
            if (tok === 'cuarto' || tok === 'quince') m = 15;
          }
          horaHint = { h, m };
          raw = raw.replace(mAlas[0] ?? '', ' ');
        } else {
          const mYmedia = /\b(\d{1,2})\s+y\s+(media|cuarto|treinta|quince)\b/i.exec(raw);
          if (mYmedia) {
            const h = parseInt(mYmedia[1] ?? '0', 10);
            const tok = NORM(mYmedia[2] ?? '');
            const m = tok === 'media' || tok === 'treinta' ? 30 : 15;
            horaHint = { h, m };
            raw = raw.replace(mYmedia[0] ?? '', ' ');
          }
        }
      }
    }
  }

  // --- 11) Si hay recurrencia weekly pero no fecha
  if (!fechaBase && state.recurrence === 'weekly' && state.recurrenceWeekdays?.length) {
    const first = state.recurrenceWeekdays[0];
    if (first !== undefined) fechaBase = fechaDOWFutura(first);
  }
  // Si hay recurrencia daily/monthly sin fecha, usar hoy.
  if (!fechaBase && state.recurrence !== 'none') {
    fechaBase = startOfToday();
    if (state.recurrence === 'monthly' && state.recurrenceMonthday) {
      const hoy = startOfToday();
      let cand = new Date(hoy.getFullYear(), hoy.getMonth(), state.recurrenceMonthday);
      if (cand < hoy) cand = new Date(hoy.getFullYear(), hoy.getMonth() + 1, state.recurrenceMonthday);
      fechaBase = cand;
    }
  }

  state.startAt = defaultIso(fechaBase, state.allDay, horaHint);
  if (state.startAt && !state.allDay) {
    // endAt default +1h
    const s = new Date(state.startAt);
    s.setHours(s.getHours() + 1);
    state.endAt = s.toISOString();
  }

  // --- 12) Título: lo que quedó
  state.title = raw.replace(/\s+/g, ' ').trim();
  return state;
}

/** Etiqueta corta para el chip preview de la barra mágica. */
export function previewLabel(r: AgendaParseResult): string {
  const partes: string[] = [];
  if (r.startAt) {
    const d = new Date(r.startAt);
    const fecha = d.toLocaleDateString('es-AR', { weekday: 'short', day: '2-digit', month: 'short' });
    if (r.allDay) partes.push(`${fecha} · todo el día`);
    else partes.push(`${fecha} ${d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}`);
  } else {
    partes.push('sin fecha');
  }
  if (r.categoryHint) partes.push(`#${r.categoryHint}`);
  if (r.priority === 'alta') partes.push('alta');
  if (r.recurrence === 'daily') partes.push('todos los días');
  if (r.recurrence === 'weekly' && r.recurrenceWeekdays?.length) {
    const nombres = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
    partes.push(`cada ${r.recurrenceWeekdays.map((d) => nombres[d]).join(', ')}`);
  }
  if (r.recurrence === 'monthly') partes.push(`cada mes${r.recurrenceMonthday ? ` (día ${r.recurrenceMonthday})` : ''}`);
  return partes.join(' · ');
}
