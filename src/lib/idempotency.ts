import { useCallback, useState } from 'react';

// Genera una clave nueva. crypto.randomUUID donde exista (prod HTTPS siempre).
// El fallback también produce un UUID v4 VÁLIDO: la columna movimientos.idempotency_key
// es uuid, así que un valor no-uuid rompería el INSERT (aunque esta rama es
// inalcanzable en prod, donde el secure context garantiza crypto.randomUUID).
function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/**
 * Clave de idempotencia por INTENCIÓN de pago (A-INTEG · mig 0479).
 *
 * `key` es ESTABLE por montaje del componente: sobrevive re-renders y un
 * doble-click / reintento de red de la MISMA intención de pago → el backend
 * deduplica y no imputa dos veces.
 *
 * `renew()` debe llamarse DESPUÉS de un pago EXITOSO: genera una clave nueva
 * para que el PRÓXIMO pago legítimo use otra clave y NO se deduplique por error
 * (evita el falso positivo de bloquear un segundo pago legítimo de igual monto).
 *
 * Patrón de uso en un form/modal/drawer de pago:
 *   const idem = useIdempotencyKey();
 *   ... registrarCobranza({ ..., idempotencyKey: idem.key });
 *   if (res.ok) idem.renew();
 */
export function useIdempotencyKey(): { key: string; renew: () => void } {
  const [key, setKey] = useState<string>(newIdempotencyKey);
  const renew = useCallback(() => setKey(newIdempotencyKey()), []);
  return { key, renew };
}
