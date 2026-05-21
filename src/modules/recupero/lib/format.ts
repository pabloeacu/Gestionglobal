// Helpers locales al módulo de recupero.

export function formatMoney(n: number, fractionDigits = 0): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(n);
}

export function comprobanteLabel(
  tipo: string | null,
  punto_venta: number | null,
  numero: number | null,
): string {
  if (!tipo) return '—';
  const pv = (punto_venta ?? 0).toString().padStart(5, '0');
  const n = (numero ?? 0).toString().padStart(8, '0');
  return `${tipo} ${pv}-${n}`;
}
