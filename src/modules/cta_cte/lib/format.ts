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
  // DGG-108 · fin del AÑO SIGUIENTE: el ledger incluye los cargos futuros
  // (adelantados a este año o al próximo) que el KPI "Saldo actual" (all-time neto)
  // ya cuenta → el saldo grande cuadra con la suma del extracto de abajo.
  const d = new Date();
  d.setFullYear(d.getFullYear() + 1, 11, 31);
  return d.toISOString().slice(0, 10);
}
