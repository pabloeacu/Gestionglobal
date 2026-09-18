import { describe, it, expect } from 'vitest';
import {
  eventosToIcs,
  eventoPersonalToIcs,
  ocurrenciaProyectadaToIcs,
  type IcsEvento,
} from '@/lib/icsExport';

// Exportador iCalendar (RFC 5545) de la Agenda. Si el escaping o el formato de
// fecha están mal, el .ics falla SILENCIOSAMENTE al importarse en Google/Apple/
// Outlook (el usuario pierde la sincronización sin ver un error). Estos tests
// fijan las invariantes de formato del estándar.

// Fecha con hora, construida en UTC para ser determinística sin importar la TZ del runner.
const startUtc = new Date(Date.UTC(2026, 8, 17, 14, 30, 5)); // 2026-09-17 14:30:05Z

function baseEvento(over: Partial<IcsEvento> = {}): IcsEvento {
  return {
    uid: 'personal-abc',
    summary: 'Reunión',
    startAt: startUtc,
    endAt: null,
    allDay: false,
    source: 'gestion-global / personal',
    ...over,
  };
}

describe('icsExport · eventosToIcs', () => {
  it('envuelve en VCALENDAR con VERSION 2.0 y cierra correctamente', () => {
    const ics = eventosToIcs([baseEvento()]);
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics).toContain('VERSION:2.0');
    expect(ics).toContain('PRODID:-//Gestion Global//Agenda 1.0//ES');
    expect(ics.trimEnd().endsWith('END:VCALENDAR')).toBe(true);
    // Exactamente un VEVENT.
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect(ics.match(/END:VEVENT/g)).toHaveLength(1);
  });

  it('usa CRLF como separador de línea (obligatorio en RFC 5545)', () => {
    const ics = eventosToIcs([baseEvento()]);
    // Debe haber CRLF y no debe quedar ningún \n suelto sin su \r previo.
    expect(ics).toContain('\r\n');
    expect(/[^\r]\n/.test(ics)).toBe(false);
    expect(ics.endsWith('\r\n')).toBe(true);
  });

  it('evento con hora: DTSTART en UTC (YYYYMMDDTHHmmssZ) y DTEND default = +1h', () => {
    const ics = eventosToIcs([baseEvento()]);
    expect(ics).toContain('DTSTART:20260917T143005Z');
    // endAt null → +1h.
    expect(ics).toContain('DTEND:20260917T153005Z');
  });

  it('evento con hora: respeta endAt explícito', () => {
    const ics = eventosToIcs([
      baseEvento({ endAt: new Date(Date.UTC(2026, 8, 17, 16, 0, 0)) }),
    ]);
    expect(ics).toContain('DTEND:20260917T160000Z');
  });

  it('all-day: DTSTART;VALUE=DATE (sin Z) y DTEND default = +1 día', () => {
    // Fecha local (fmtAllDayLocal usa getFullYear/Month/Date locales) → determinística
    // si se construye con el ctor local.
    const localDay = new Date(2026, 8, 17); // 2026-09-17 local
    const ics = eventosToIcs([
      baseEvento({ startAt: localDay, allDay: true }),
    ]);
    expect(ics).toContain('DTSTART;VALUE=DATE:20260917');
    expect(ics).toContain('DTEND;VALUE=DATE:20260918'); // +1 día
    // No debe haber sufijo Z en las líneas DATE.
    expect(ics).not.toContain('VALUE=DATE:20260917T');
  });

  it('escapa coma, punto y coma, backslash y salto de línea por RFC 5545', () => {
    // JS: 'a, b; c\\ d\ne'  =  a, b; c<backslash> d<newline>e
    const ics = eventosToIcs([baseEvento({ summary: 'a, b; c\\ d\ne' })]);
    // Esperado (chars reales): SUMMARY:a\, b\; c\\ d\ne
    expect(ics).toContain('SUMMARY:a\\, b\\; c\\\\ d\\ne');
  });

  it('UID lleva el dominio y sale como línea propia', () => {
    const ics = eventosToIcs([baseEvento({ uid: 'vencimiento-123' })]);
    expect(ics).toContain('UID:vencimiento-123@gestionglobal.ar');
  });

  it('description y url son opcionales (sólo aparecen si vienen)', () => {
    const sin = eventosToIcs([baseEvento()]);
    expect(sin).not.toContain('DESCRIPTION:');
    expect(sin).not.toContain('URL:');
    const con = eventosToIcs([
      baseEvento({ description: 'nota', url: 'https://gestionglobal.ar/x' }),
    ]);
    expect(con).toContain('DESCRIPTION:nota');
    expect(con).toContain('URL:https://gestionglobal.ar/x');
  });

  it('CATEGORIES refleja source', () => {
    const ics = eventosToIcs([baseEvento({ source: 'gestion-global / vencimiento' })]);
    expect(ics).toContain('CATEGORIES:gestion-global / vencimiento');
  });

  it('folding RFC 5545 §3.1: ninguna línea supera 75 octetos', () => {
    const largo = 'X'.repeat(200);
    const ics = eventosToIcs([baseEvento({ summary: largo })]);
    for (const linea of ics.split('\r\n')) {
      expect(linea.length).toBeLessThanOrEqual(75);
    }
    // Y las continuaciones empiezan con espacio.
    expect(ics).toContain('\r\n '); // hay al menos un fold
  });

  it('un summary corto NO se pliega', () => {
    const ics = eventosToIcs([baseEvento({ summary: 'corto' })]);
    // La línea del SUMMARY corto no debe tener continuación con espacio inmediata.
    expect(ics).toContain('SUMMARY:corto\r\n');
  });

  it('frontera de folding: línea de exactamente 75 octetos NO se pliega, 76 SÍ', () => {
    // 'SUMMARY:' son 8 chars → summary de 67 = línea de 75 (límite, no pliega);
    // summary de 68 = línea de 76 (pliega a 75 + continuación de 1).
    const linea75 = eventosToIcs([baseEvento({ summary: 'X'.repeat(67) })]);
    expect(linea75.split('\r\n').every((l) => l.length <= 75)).toBe(true);
    expect(linea75).not.toContain('\r\n X'); // no hay continuación
    const linea76 = eventosToIcs([baseEvento({ summary: 'X'.repeat(68) })]);
    expect(linea76.split('\r\n').every((l) => l.length <= 75)).toBe(true);
    expect(linea76).toContain('\r\n X'); // el char 76 pasó a una línea de continuación
  });

  it('all-day con endAt explícito: DTEND;VALUE=DATE usa la fecha dada (no el default +1)', () => {
    const ics = eventosToIcs([
      baseEvento({
        startAt: new Date(2026, 8, 17),
        endAt: new Date(2026, 8, 20),
        allDay: true,
      }),
    ]);
    expect(ics).toContain('DTSTART;VALUE=DATE:20260917');
    expect(ics).toContain('DTEND;VALUE=DATE:20260920');
  });

  it('serializa múltiples eventos', () => {
    const ics = eventosToIcs([
      baseEvento({ uid: 'a' }),
      baseEvento({ uid: 'b' }),
      baseEvento({ uid: 'c' }),
    ]);
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(3);
    expect(ics).toContain('UID:a@gestionglobal.ar');
    expect(ics).toContain('UID:c@gestionglobal.ar');
  });

  it('lista vacía: sólo el envelope, sin VEVENT', () => {
    const ics = eventosToIcs([]);
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('END:VCALENDAR');
    expect(ics).not.toContain('BEGIN:VEVENT');
  });
});

describe('icsExport · mappers', () => {
  it('eventoPersonalToIcs: sin startAt (bandeja) devuelve null — no se exporta', () => {
    const ev = { id: 'e1', title: 'T', startAt: null } as unknown as Parameters<
      typeof eventoPersonalToIcs
    >[0];
    expect(eventoPersonalToIcs(ev)).toBeNull();
  });

  it('eventoPersonalToIcs: mapea id→uid personal-<id>, title→summary, notes→description', () => {
    const ev = {
      id: 'e9',
      title: 'Llamar al cliente',
      notes: 'sobre la deuda',
      startAt: '2026-09-17T14:30:00Z',
      endAt: null,
      allDay: false,
    } as unknown as Parameters<typeof eventoPersonalToIcs>[0];
    const ics = eventoPersonalToIcs(ev);
    expect(ics).not.toBeNull();
    expect(ics!.uid).toBe('personal-e9');
    expect(ics!.summary).toBe('Llamar al cliente');
    expect(ics!.description).toBe('sobre la deuda');
    expect(ics!.startAt).toBeInstanceOf(Date);
  });

  it('ocurrenciaProyectadaToIcs: uid = <fuente>-<origenId> y source namespaced', () => {
    const oc = {
      fuente: 'vencimiento',
      origenId: 'v42',
      title: 'Vence RPAC',
      categoryHint: 'RPAC',
      startAt: '2026-09-17T00:00:00Z',
      endAt: null,
      allDay: true,
    } as unknown as Parameters<typeof ocurrenciaProyectadaToIcs>[0];
    const ics = ocurrenciaProyectadaToIcs(oc);
    expect(ics.uid).toBe('vencimiento-v42');
    expect(ics.source).toBe('gestion-global / vencimiento');
    expect(ics.allDay).toBe(true);
  });
});
