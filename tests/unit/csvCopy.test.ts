import { describe, it, expect } from 'vitest';
import { rowsToCsv, type CsvColumn } from '@/lib/csvCopy';

// rowsToCsv es puro (sin imports de runtime). Cubre el quoting RFC 4180, que es
// fuente clásica de bugs de export (una coma o comilla sin escapar corre columnas).
describe('rowsToCsv', () => {
  type Row = { a: unknown; b?: unknown };
  const colsAB: CsvColumn<Row>[] = [
    { key: 'a', label: 'A' },
    { key: 'b', label: 'B' },
  ];

  it('header + fila, coma y CRLF por defecto', () => {
    expect(rowsToCsv([{ a: 'x', b: 'y' }], colsAB)).toBe('A,B\r\nx,y');
  });

  it('header:false omite la cabecera', () => {
    expect(rowsToCsv([{ a: 'x', b: 'y' }], colsAB, { header: false })).toBe('x,y');
  });

  it('quoting RFC 4180: coma → envuelto en comillas', () => {
    expect(rowsToCsv([{ a: 'x,y' }], [{ key: 'a', label: 'A' }], { header: false })).toBe('"x,y"');
  });

  it('quoting: comillas internas se duplican y se envuelve', () => {
    expect(rowsToCsv([{ a: 'a"b' }], [{ key: 'a', label: 'A' }], { header: false })).toBe('"a""b"');
  });

  it('quoting: salto de línea → envuelto', () => {
    expect(rowsToCsv([{ a: 'a\nb' }], [{ key: 'a', label: 'A' }], { header: false })).toBe('"a\nb"');
  });

  it('null/undefined → celda vacía', () => {
    expect(rowsToCsv([{ a: null, b: undefined }], colsAB, { header: false })).toBe(',');
  });

  it('separador ";": sólo se envuelve si el valor contiene ";", no ","', () => {
    // Con sep=';', un valor con coma NO se envuelve (la coma no es separador acá).
    expect(rowsToCsv([{ a: 'x,y' }], [{ key: 'a', label: 'A' }], { header: false, separator: ';' })).toBe('x,y');
    // Un valor con ";" sí se envuelve.
    expect(rowsToCsv([{ a: 'x;y' }], [{ key: 'a', label: 'A' }], { header: false, separator: ';' })).toBe('"x;y"');
  });

  it('usa la función format cuando existe; si no, row[key]', () => {
    const cols: CsvColumn<Row>[] = [{ key: 'a', label: 'A', format: (r) => String(r.a).toUpperCase() }];
    expect(rowsToCsv([{ a: 'x' }], cols, { header: false })).toBe('X');
  });

  it('newline configurable (\\n)', () => {
    expect(rowsToCsv([{ a: 'x', b: 'y' }], colsAB, { newline: '\n' })).toBe('A,B\nx,y');
  });
});
