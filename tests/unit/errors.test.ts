import { describe, it, expect } from 'vitest';
import { ok, fail, toApiError, humanizeError } from '@/lib/errors';

// errors.ts es puro (sin imports) y central: humanizeError traduce errores técnicos a
// frases humanas SIN filtrar el mensaje crudo — es la última barrera de UX + no-leak.

describe('ok / fail', () => {
  it('ok envuelve data (y meta opcional)', () => {
    expect(ok(42)).toEqual({ ok: true, data: 42 });
    expect(ok(1, { total: 9 })).toEqual({ ok: true, data: 1, meta: { total: 9 } });
  });
  it('fail arma el sobre de error', () => {
    expect(fail('X', 'm', { d: 1 })).toEqual({ ok: false, error: { code: 'X', message: 'm', details: { d: 1 } } });
  });
});

describe('toApiError', () => {
  it('objeto con message+code', () => {
    const r = toApiError({ message: 'boom', code: '42501' });
    expect(r.code).toBe('42501');
    expect(r.message).toBe('boom');
  });
  it('objeto con message sin code → UNKNOWN', () => {
    expect(toApiError({ message: 'x' }).code).toBe('UNKNOWN');
  });
  it('no-objeto (string/null) → UNKNOWN sin romper', () => {
    expect(toApiError('boom').code).toBe('UNKNOWN');
    expect(toApiError(null).code).toBe('UNKNOWN');
  });
});

describe('humanizeError · por código', () => {
  it('mapea códigos PG conocidos', () => {
    expect(humanizeError({ code: '42501', message: 'permission denied' })).toMatch(/permisos/i);
    expect(humanizeError({ code: '23505', message: 'dup' })).toMatch(/Ya existe un registro/i);
    expect(humanizeError({ code: 'PGRST301', message: 'x' })).toMatch(/sesión expiró/i);
  });
  it('el código tiene PRECEDENCIA sobre el mensaje', () => {
    // code 42501 gana aunque el message matchearía otra regla (failed to fetch).
    expect(humanizeError({ code: '42501', message: 'failed to fetch' })).toMatch(/permisos/i);
  });
});

describe('humanizeError · por mensaje (sin código)', () => {
  it('errores de red/timeout/jwt', () => {
    expect(humanizeError({ message: 'Failed to fetch' })).toMatch(/conectar con el servidor/i);
    expect(humanizeError({ message: 'operation timed out' })).toMatch(/tardó demasiado/i);
    expect(humanizeError({ message: 'jwt expired' })).toMatch(/sesión expiró/i);
  });
  it('constraint específico ANTES que el genérico de duplicado', () => {
    expect(humanizeError({ message: 'duplicate key value violates unique constraint "uq_admin_cuit_activo"' }))
      .toMatch(/cliente activo con ese CUIT/i);
    // genérico cuando no hay constraint específico
    expect(humanizeError({ message: 'duplicate key value violates unique constraint "otra_cosa"' }))
      .toMatch(/Ya existe un registro/i);
  });
  it('Error nativo: usa message; regex matchea', () => {
    expect(humanizeError(new Error('NetworkError when attempting to fetch'))).toMatch(/conectar/i);
  });
  it('string directo', () => {
    expect(humanizeError('rate limit exceeded')).toMatch(/muchas operaciones/i);
  });
});

describe('humanizeError · passthrough y vacíos', () => {
  it('mensaje ya humano (sin match) se devuelve tal cual', () => {
    const humano = 'Faltan documentos: subí el DNI antes de continuar.';
    expect(humanizeError({ message: humano })).toBe(humano);
  });
  it('null/undefined → mensaje genérico', () => {
    expect(humanizeError(null)).toMatch(/error inesperado/i);
    expect(humanizeError(undefined)).toMatch(/error inesperado/i);
  });
});
