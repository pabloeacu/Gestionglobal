import { describe, it, expect, vi, afterEach } from 'vitest';
import { newIdempotencyKey } from '@/lib/idempotency';

// Clave de idempotencia de pago (A-INTEG · E-GG-205 · mig 0479).
// INVARIANTE DE SEGURIDAD DE DINERO: la clave SIEMPRE debe ser un UUID v4 válido
// — `movimientos.idempotency_key` es de tipo `uuid`, así que un valor no-uuid
// rompería el INSERT del pago. Y dos generaciones distintas NUNCA deben colisionar
// (dos pagos legítimos de igual monto deben deduplicar por separado, no bloquearse).

// UUID v4 canónico: 3er grupo empieza en '4'; 4to grupo empieza en 8/9/a/b (variante RFC 4122).
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('idempotency · newIdempotencyKey', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('el camino nativo (crypto.randomUUID, prod HTTPS) devuelve un UUID v4 válido', () => {
    // En Node ≥19 crypto.randomUUID existe → ejercita la rama de prod.
    const key = newIdempotencyKey();
    expect(key).toMatch(UUID_V4);
  });

  it('NUNCA colisiona: 1000 claves distintas son todas únicas y válidas', () => {
    const keys = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const k = newIdempotencyKey();
      expect(k).toMatch(UUID_V4);
      keys.add(k);
    }
    // Si dos pagos legítimos compartieran clave, el backend deduplicaría el 2º
    // (falso positivo = pago perdido). Deben ser todas distintas.
    expect(keys.size).toBe(1000);
  });

  it('el FALLBACK (sin crypto.randomUUID) TAMBIÉN produce un UUID v4 VÁLIDO — invariante de dinero', () => {
    // Fuerza la rama de fallback stubbeando un crypto sin randomUUID.
    // Es la rama que el comentario del módulo marca como crítica: un valor
    // no-uuid rompería el INSERT en movimientos.idempotency_key.
    vi.stubGlobal('crypto', {});
    const spy = vi.spyOn(Math, 'random');
    const key = newIdempotencyKey();
    // Auto-protección: garantiza que corrió la rama fallback (Math.random),
    // no la nativa — el test no vale si el stub fuera un no-op en otro runtime.
    expect(spy).toHaveBeenCalled();
    expect(key).toMatch(UUID_V4);
    // La versión debe ser exactamente '4' y la variante 8/9/a/b (no basura).
    expect(key[14]).toBe('4');
    expect(['8', '9', 'a', 'b']).toContain(key[19].toLowerCase());
  });

  it('el fallback tampoco colisiona en 500 generaciones', () => {
    vi.stubGlobal('crypto', {});
    const keys = new Set<string>();
    for (let i = 0; i < 500; i++) keys.add(newIdempotencyKey());
    expect(keys.size).toBe(500);
  });
});
