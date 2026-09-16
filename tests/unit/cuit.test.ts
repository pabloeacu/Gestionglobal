import { describe, it, expect } from 'vitest';
import { soloDigitosCuit, formatCuit, validarCuit, esCuitValido, esCuitJuridico, esCampoCuit } from '@/lib/cuit';

// CUIT válido real: 20-32988518-7 (DV mód 11 = 7, verificado a mano).
describe('cuit', () => {
  it('soloDigitosCuit descarta todo lo que no sea dígito', () => {
    expect(soloDigitosCuit('20-32988518-7')).toBe('20329885187');
    expect(soloDigitosCuit(null)).toBe('');
    expect(soloDigitosCuit(undefined)).toBe('');
  });

  it('formatCuit agrupa 2-8-1 progresivamente y capa a 11 dígitos', () => {
    expect(formatCuit('20')).toBe('20');
    expect(formatCuit('203')).toBe('20-3');
    expect(formatCuit('2032988518')).toBe('20-32988518');
    expect(formatCuit('20329885187')).toBe('20-32988518-7');
    expect(formatCuit('203298851879999')).toBe('20-32988518-7');
  });

  it('validarCuit: el vacío es null (lo maneja `required`, no este validador)', () => {
    expect(validarCuit('')).toBeNull();
    expect(validarCuit(null)).toBeNull();
  });

  it('validarCuit: rechaza longitud distinta de 11', () => {
    expect(validarCuit('123')).not.toBeNull();
    expect(validarCuit('2032988518')).not.toBeNull();
  });

  it('esCuitValido: acepta un CUIT válido (con y sin guiones) y rechaza el DV incorrecto', () => {
    expect(esCuitValido('20-32988518-7')).toBe(true);
    expect(esCuitValido('20329885187')).toBe(true);
    expect(esCuitValido('20-32988518-8')).toBe(false); // dígito verificador mal
    expect(esCuitValido('20-32988518-0')).toBe(false);
  });

  it('esCuitJuridico: prefijos 30/33/34 = persona jurídica; el resto no', () => {
    expect(esCuitJuridico('30329885182')).toBe(true);
    expect(esCuitJuridico('33-69345023-9')).toBe(true);
    expect(esCuitJuridico('20329885187')).toBe(false);
    expect(esCuitJuridico('123')).toBe(false);
    expect(esCuitJuridico(null)).toBe(false);
  });

  it('esCampoCuit: detecta el campo por type/name/label con word-boundary', () => {
    expect(esCampoCuit({ type: 'cuit' })).toBe(true);
    expect(esCampoCuit({ name: 'cuit' })).toBe(true);
    expect(esCampoCuit({ name: 'cuil' })).toBe(true);
    expect(esCampoCuit({ label: 'CUIT/CUIL' })).toBe(true);
    // No debe matchear palabras que CONTIENEN "cui" sin ser el campo (word-boundary).
    expect(esCampoCuit({ name: 'circuito' })).toBe(false);
    expect(esCampoCuit({ label: 'cuidado' })).toBe(false);
    expect(esCampoCuit({ name: 'email', label: 'Correo' })).toBe(false);
  });
});
