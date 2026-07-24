// ============================================================================
// MoneySup · E-GG-154 (2026-07-24)
// Formato canónico de cifras de conciliación: SIEMPRE 2 decimales exactos.
//   - formatMoneyExact: string plano (selects, tablas, exports, confirms).
//   - MoneySup: centavos en superíndice (idea de Pablo) para KPIs y cards
//     grandes — exactitud al centavo sin comerse el ancho.
// es-AR usa ',' únicamente como separador decimal → partir por la última
// coma es seguro (los miles usan '.').
// ============================================================================

export function formatMoneyExact(n: number): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency', currency: 'ARS', minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(Number.isFinite(n) ? n : 0);
}

export function MoneySup({ value }: { value: number }) {
  const s = formatMoneyExact(value);
  const i = s.lastIndexOf(',');
  const entero = i >= 0 ? s.slice(0, i) : s;
  const centavos = i >= 0 ? s.slice(i + 1) : '00';
  return (
    <span className="whitespace-nowrap">
      {entero}
      <sup className="text-[0.62em] font-semibold opacity-80">,{centavos}</sup>
    </span>
  );
}
