import { describe, it, expect } from 'vitest';
import { mimeDeArchivo, normalizarAdjunto, motivoRechazoAdjunto } from '@/lib/adjuntos';

// Validación cliente de adjuntos ANTES de subir (E-GG-170/171). Si el MIME efectivo
// o el gate de tamaño/formato están mal, un archivo válido se rechaza (mala UX) o uno
// inválido viaja y muere con 415/silencio en Storage. Estos tests fijan esa lógica.

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

describe('adjuntos · mimeDeArchivo', () => {
  it('usa el type declarado cuando es conocido', () => {
    expect(mimeDeArchivo(new File(['x'], 'a.pdf', { type: 'application/pdf' }))).toBe('application/pdf');
    expect(mimeDeArchivo(new File(['x'], 'foto.jpg', { type: 'image/jpeg' }))).toBe('image/jpeg');
  });

  it('cae a la extensión cuando el type está vacío', () => {
    expect(mimeDeArchivo(new File(['x'], 'planilla.xlsx', { type: '' }))).toBe(XLSX);
    expect(mimeDeArchivo(new File(['x'], 'doc.pdf', { type: '' }))).toBe('application/pdf');
  });

  it('E-GG-171: octet-stream + .xlsx → resuelve al MIME real por extensión', () => {
    // El caso que rompía: Android/providers reportan .xlsx como octet-stream.
    expect(mimeDeArchivo(new File(['x'], 'reporte.xlsx', { type: 'application/octet-stream' }))).toBe(XLSX);
  });

  it('descarta parámetros del type (charset)', () => {
    expect(mimeDeArchivo(new File(['x'], 'a.pdf', { type: 'application/pdf; charset=utf-8' }))).toBe('application/pdf');
  });

  it('archivo sin extensión ni type conocido → devuelve el type crudo (o vacío)', () => {
    expect(mimeDeArchivo(new File(['x'], 'sinextension', { type: '' }))).toBe('');
  });
});

describe('adjuntos · normalizarAdjunto', () => {
  it('re-tipa el archivo cuando el MIME efectivo difiere del declarado', () => {
    const f = new File(['x'], 'reporte.xlsx', { type: 'application/octet-stream' });
    const out = normalizarAdjunto(f);
    expect(out.type).toBe(XLSX);
    expect(out.name).toBe('reporte.xlsx');
  });

  it('no re-envuelve si el MIME ya es el correcto (devuelve el mismo File)', () => {
    const f = new File(['x'], 'a.pdf', { type: 'application/pdf' });
    expect(normalizarAdjunto(f)).toBe(f);
  });
});

describe('adjuntos · motivoRechazoAdjunto', () => {
  const lim = { maxMB: 1, mimes: new Set(['application/pdf', XLSX]), formatosLabel: 'PDF o XLSX' };

  it('rechaza archivo de 0 bytes (placeholder de cloud sin descargar)', () => {
    const m = motivoRechazoAdjunto(new File([], 'vacio.pdf', { type: 'application/pdf' }), lim);
    expect(m).not.toBeNull();
    expect(m).toMatch(/vac[íi]o|0 bytes/i);
  });

  it('rechaza archivo que excede el tamaño máximo', () => {
    const big = new File([new Uint8Array(2 * 1024 * 1024)], 'grande.pdf', { type: 'application/pdf' });
    const m = motivoRechazoAdjunto(big, lim);
    expect(m).not.toBeNull();
    expect(m).toContain('MB');
  });

  it('rechaza formato fuera de la whitelist con la etiqueta accionable', () => {
    const m = motivoRechazoAdjunto(new File(['x'], 'foto.jpg', { type: 'image/jpeg' }), lim);
    expect(m).not.toBeNull();
    expect(m).toContain('PDF o XLSX');
  });

  it('acepta un archivo válido dentro de límites (devuelve null)', () => {
    expect(motivoRechazoAdjunto(new File(['abc'], 'ok.pdf', { type: 'application/pdf' }), lim)).toBeNull();
  });

  it('E-GG-171: acepta un .xlsx reportado como octet-stream (via MIME efectivo)', () => {
    const f = new File(['abc'], 'planilla.xlsx', { type: 'application/octet-stream' });
    expect(motivoRechazoAdjunto(f, lim)).toBeNull();
  });

  it('sin whitelist de mimes: sólo valida tamaño (no formato)', () => {
    const soloTamano = { maxMB: 1 };
    expect(motivoRechazoAdjunto(new File(['x'], 'cualquier.cosa', { type: 'x/y' }), soloTamano)).toBeNull();
  });
});
