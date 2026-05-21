// Helpers de formato local al módulo de cta. cte.

export function formatMoney(n: number, fractionDigits = 2): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(n);
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function defaultDesde(): string {
  // 12 meses atrás.
  const d = new Date();
  d.setMonth(d.getMonth() - 12);
  return d.toISOString().slice(0, 10);
}

export function defaultHasta(): string {
  // Fin del año actual (asegura ver cargos futuros emitidos adelantados).
  const d = new Date();
  d.setMonth(11, 31);
  return d.toISOString().slice(0, 10);
}
