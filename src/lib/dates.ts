// Postgres devuelve `date` como 'YYYY-MM-DD'. `new Date('YYYY-MM-DD')` lo
// parsea como UTC midnight, y Argentina (UTC-3) lo retrocede un día al
// formatear con toLocaleDateString. Estos helpers parsean el string como
// fecha LOCAL (no UTC) para que el día mostrado coincida con el de la BD.

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
