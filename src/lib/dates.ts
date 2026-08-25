// Postgres devuelve `date` como 'YYYY-MM-DD'. `new Date('YYYY-MM-DD')` lo
// parsea como UTC midnight, y Argentina (UTC-3) lo retrocede un día al
// formatear con toLocaleDateString. Estos helpers parsean el string como
// fecha LOCAL (no UTC) para que el día mostrado coincida con el de la BD.

// Fecha de HOY en horario Argentina como 'YYYY-MM-DD'. Usar SIEMPRE para defaults
// de <input type="date"> y para persistir fechas (cobranzas, comprobantes,
// movimientos…). `new Date().toISOString().slice(0,10)` da la fecha UTC, que
// después de las 21 hs AR ya es el día siguiente → fecha contable corrida (E-GG-194,
// reporte JL). `en-CA` formatea yyyy-mm-dd.
export function hoyISO(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
  }).format(new Date());
}

// hoyISO con desplazamiento en días, en horario AR (p.ej. hoyISOoffset(7) = hoy+7).
export function hoyISOoffset(dias: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
  }).format(new Date(Date.now() + dias * 86400000));
}

// Formatea CUALQUIER Date a 'YYYY-MM-DD' en horario Argentina. Para fechas ya
// computadas (vencimientos, rangos, períodos): evita el corrimiento de
// `.toISOString().slice(0,10)` (UTC) para instantes de la tarde-noche AR (E-GG-194).
export function toISODate(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
  }).format(d);
}

export function parseLocalDate(d: string): Date {
  // Tolera 'YYYY-MM-DD' y también ISO completo 'YYYY-MM-DDT...'.
  const datePart = d.includes('T') ? d.slice(0, 10) : d;
  const parts = datePart.split('-').map(Number);
  const y = parts[0] ?? 1970;
  const m = parts[1] ?? 1;
  const day = parts[2] ?? 1;
  return new Date(y, m - 1, day);
}

export function formatDateShort(d: string | null | undefined): string {
  if (!d) return '—';
  return parseLocalDate(d).toLocaleDateString('es-AR', {
    day: '2-digit',
    month: 'short',
    year: '2-digit',
  });
}

export function formatDateLong(d: string | null | undefined): string {
  if (!d) return '—';
  return parseLocalDate(d).toLocaleDateString('es-AR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
}

// Para `timestamptz` cuando sólo querés mostrar la FECHA (sin hora) en horario
// LOCAL. NO uses formatDateShort/Long con un timestamp: ésos lo tratan como
// date-only (cortan a 10 chars = fecha UTC) y muestran el día siguiente para
// registros de la tarde-noche AR (ej. expira_at guardado 23:59:59 local).
// Acá `new Date()` respeta la TZ del string y se formatea en hora local.
export function formatTimestampDate(
  d: string | null | undefined,
  style: 'short' | 'long' = 'short',
): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString(
    'es-AR',
    style === 'long'
      ? { day: '2-digit', month: 'long', year: 'numeric' }
      : { day: '2-digit', month: 'short', year: '2-digit' },
  );
}

// Para timestamps con hora (`timestamptz` de Postgres). Acá SÍ se usa
// `new Date(...)` directo porque el string incluye TZ.
export function formatDateTime(d: string | null | undefined): string {
  if (!d) return '—';
  const dt = new Date(d);
  return `${dt.toLocaleDateString('es-AR', {
    day: '2-digit',
    month: 'short',
  })} · ${dt.toLocaleTimeString('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
  })}`;
}

export function daysBetween(from: string | null | undefined, today = new Date()): number | null {
  if (!from) return null;
  const target = parseLocalDate(from);
  const ms = target.getTime() - today.getTime();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}
