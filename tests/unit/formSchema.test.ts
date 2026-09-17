import { describe, it, expect } from 'vitest';
import { humanizeFieldName, camposDelSchema, fieldLabelMap, labelDeCampo } from '@/lib/formSchema';

describe('humanizeFieldName', () => {
  it('convierte snake/kebab a "Frase capitalizada"', () => {
    expect(humanizeFieldName('dni_solicitante')).toBe('Dni solicitante');
    expect(humanizeFieldName('dni-frente')).toBe('Dni frente');
    expect(humanizeFieldName('email')).toBe('Email');
  });
});

describe('camposDelSchema', () => {
  it('recorre fields/secciones/campos y humaniza labels faltantes', () => {
    const schema = {
      fields: [{ name: 'email', label: 'Email' }],
      secciones: [{ campos: [{ name: 'dni', label: 'DNI' }, { name: 'cuit_solicitante' }] }],
    };
    expect(camposDelSchema(schema)).toEqual([
      { name: 'email', label: 'Email' },
      { name: 'dni', label: 'DNI' },
      { name: 'cuit_solicitante', label: 'Cuit solicitante' },
    ]);
  });
  it('input no-objeto → []', () => {
    expect(camposDelSchema(null)).toEqual([]);
    expect(camposDelSchema('x')).toEqual([]);
  });
});

describe('fieldLabelMap / labelDeCampo', () => {
  it('mapa slug→label; la primera aparición gana', () => {
    const map = fieldLabelMap({ fields: [{ name: 'a', label: 'Primero' }, { name: 'a', label: 'Segundo' }] });
    expect(map).toEqual({ a: 'Primero' });
  });
  it('labelDeCampo usa el mapa; si falta, humaniza el slug', () => {
    const map = { dni: 'DNI' };
    expect(labelDeCampo(map, 'dni')).toBe('DNI');
    expect(labelDeCampo(map, 'otro_campo')).toBe('Otro campo');
  });
});
