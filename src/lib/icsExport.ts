// Genera archivos iCalendar (.ics · RFC 5545) para sincronizar la Agenda
// con Google Calendar, Outlook, Apple Calendar, etc.
//
// Soporta:
//   · Eventos personales (con título, notas, all-day o con hora).
//   · Eventos proyectados (vencimiento, trámite, comprobante, solicitud,
//     tracking_alarma) en modo read-only — sirven como recordatorio externo.
//
// Modo "personal" exporta sólo los míos. Modo "todo" incluye proyectados.
//
// Las fechas se escriben en UTC (sufijo Z). Para all-day se usa formato
// DATE (sin hora). Cada evento lleva un UID estable (id + dominio) para
// que sincronizaciones repetidas pisen y no dupliquen.

import type { AgendaEvento, OcurrenciaUnificada } from '@/services/api/agenda';

export interface IcsEvento {
  uid: string;
  summary: string;
  description?: string;
  startAt: Date;
  endAt: Date | null;
  allDay: boolean;
  url?: string;
  source: string;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function fmtUtc(d: Date): string {
  // YYYYMMDDTHHmmssZ
  return (
    d.getUTCFullYear().toString() +
    pad2(d.getUTCMonth() + 1) +
    pad2(d.getUTCDate()) +
    'T' +
    pad2(d.getUTCHours()) +
    pad2(d.getUTCMinutes()) +
    pad2(d.getUTCSeconds()) +
    'Z'
  );
}

function fmtAllDayLocal(d: Date): string {
  // YYYYMMDD (sin Z — DATE no admite zona)
  return (
    d.getFullYear().toString() +
    pad2(d.getMonth() + 1) +
    pad2(d.getDate())
  );
}

function escapeText(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;')
    .replace(/\r?\n/g, '\\n');
}

function fold(line: string): string {
  // RFC 5545 §3.1: max 75 octetos por línea; las siguientes empiezan con espacio.
  if (line.length <= 75) return line;
  const out: string[] = [];
  let rest = line;
  // Primer chunk: 75 chars.
  out.push(rest.slice(0, 75));
  rest = rest.slice(75);
  while (rest.length > 0) {
    out.push(' ' + rest.slice(0, 74));
    rest = rest.slice(74);
  }
  return out.join('\r\n');
}

export function eventosToIcs(eventos: IcsEvento[]): string {
  const now = fmtUtc(new Date());
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Gestion Global//Agenda 1.0//ES',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Agenda · Gestión Global',
    'X-WR-TIMEZONE:America/Argentina/Buenos_Aires',
  ];
  for (const ev of eventos) {
    lines.push('BEGIN:VEVENT');
    lines.push(fold(`UID:${ev.uid}@gestionglobal.ar`));
    lines.push(`DTSTAMP:${now}`);
    if (ev.allDay) {
      lines.push(`DTSTART;VALUE=DATE:${fmtAllDayLocal(ev.startAt)}`);
      const end = ev.endAt ?? new Date(ev.startAt.getTime() + 86_400_000);
      lines.push(`DTEND;VALUE=DATE:${fmtAllDayLocal(end)}`);
    } else {
      lines.push(`DTSTART:${fmtUtc(ev.startAt)}`);
      const end = ev.endAt ?? new Date(ev.startAt.getTime() + 60 * 60 * 1000);
      lines.push(`DTEND:${fmtUtc(end)}`);
    }
    lines.push(fold(`SUMMARY:${escapeText(ev.summary)}`));
    if (ev.description) lines.push(fold(`DESCRIPTION:${escapeText(ev.description)}`));
    if (ev.url) lines.push(fold(`URL:${escapeText(ev.url)}`));
    lines.push(fold(`CATEGORIES:${escapeText(ev.source)}`));
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

export function eventoPersonalToIcs(ev: AgendaEvento): IcsEvento | null {
  if (!ev.startAt) return null; // bandeja (sin fecha) — no se exporta
  return {
    uid: `personal-${ev.id}`,
    summary: ev.title,
    description: ev.notes ?? undefined,
    startAt: new Date(ev.startAt),
    endAt: ev.endAt ? new Date(ev.endAt) : null,
    allDay: ev.allDay ?? false,
    source: 'gestion-global / personal',
  };
}

export function ocurrenciaProyectadaToIcs(oc: OcurrenciaUnificada): IcsEvento {
  return {
    uid: `${oc.fuente}-${oc.origenId}`,
    summary: oc.title,
    description: oc.categoryHint || undefined,
    startAt: new Date(oc.startAt),
    endAt: oc.endAt ? new Date(oc.endAt) : null,
    allDay: oc.allDay,
    source: `gestion-global / ${oc.fuente}`,
  };
}

export function downloadIcs(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 100);
}
