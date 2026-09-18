import { describe, it, expect, vi } from 'vitest';

// storageUrls importa '@/lib/supabase' (crea el cliente con env). Lo mockeamos:
// sólo testeamos las funciones PURAS (parseo/nombre/es-protegido) que no lo usan.
vi.mock('@/lib/supabase', () => ({ supabase: { storage: { from: () => ({}) } } }));

const { parsearArchivoStorage, esArchivoProtegido, nombreArchivoStorage } = await import('@/lib/storageUrls');

// Resolución de archivos en buckets privados (E-GG-126). Si el parseo de la URL de
// Storage falla, el archivo no se resuelve a signed URL → descarga rota. Y el nombre
// visible DEBE derivarse del path crudo, nunca de la signed URL (el ?token lo rompe).

const base = 'https://xxx.supabase.co/storage/v1/object';

describe('storageUrls · parsearArchivoStorage', () => {
  it('parsea URL public → {bucket, path}', () => {
    expect(parsearArchivoStorage(`${base}/public/gestor-uploads/tok/file.pdf`)).toEqual({
      bucket: 'gestor-uploads',
      path: 'tok/file.pdf',
    });
  });

  it('parsea URL sign y descarta el query (?token=...)', () => {
    expect(parsearArchivoStorage(`${base}/sign/partner-facturas/a/b.pdf?token=xyz.abc`)).toEqual({
      bucket: 'partner-facturas',
      path: 'a/b.pdf',
    });
  });

  it('parsea URL authenticated', () => {
    expect(parsearArchivoStorage(`${base}/authenticated/tramite-documento-final/x/y.pdf`)).toEqual({
      bucket: 'tramite-documento-final',
      path: 'x/y.pdf',
    });
  });

  it('decodifica el path (espacios / acentos percent-encoded)', () => {
    expect(parsearArchivoStorage(`${base}/public/gestor-uploads/carpeta%20a/arch%20b.pdf`)).toEqual({
      bucket: 'gestor-uploads',
      path: 'carpeta a/arch b.pdf',
    });
  });

  it('devuelve null para URLs que NO son de Storage', () => {
    expect(parsearArchivoStorage('https://gestionglobal.ar/verificar/abc123')).toBeNull();
    expect(parsearArchivoStorage('https://drive.google.com/file/d/123/view')).toBeNull();
    expect(parsearArchivoStorage('no es una url')).toBeNull();
    expect(parsearArchivoStorage('')).toBeNull();
  });
});

describe('storageUrls · esArchivoProtegido', () => {
  it('true sólo para los buckets privados firmables', () => {
    expect(esArchivoProtegido(`${base}/public/gestor-uploads/x/f.pdf`)).toBe(true);
    expect(esArchivoProtegido(`${base}/sign/partner-facturas/x/f.pdf?token=z`)).toBe(true);
    expect(esArchivoProtegido(`${base}/authenticated/tramite-documento-final/x/f.pdf`)).toBe(true);
  });

  it('false para buckets públicos y URLs externas', () => {
    expect(esArchivoProtegido(`${base}/public/email-assets/logo.png`)).toBe(false);
    expect(esArchivoProtegido('https://gestionglobal.ar/verificar/abc')).toBe(false);
    expect(esArchivoProtegido('https://externo.com/x.pdf')).toBe(false);
  });
});

describe('storageUrls · nombreArchivoStorage', () => {
  it('deriva el nombre del path crudo, IGNORANDO el ?token de una signed URL', () => {
    // El bug que previene: el ?token=... rompería el último segmento si se usara la URL cruda.
    expect(nombreArchivoStorage(`${base}/sign/gestor-uploads/x/doc%20final.pdf?token=abc.def.ghi`)).toBe(
      'doc final.pdf',
    );
  });

  it('funciona con URLs externas (passthrough)', () => {
    expect(nombreArchivoStorage('https://externo.com/path/factura.jpg?v=1')).toBe('factura.jpg');
  });

  it('decodifica el nombre percent-encoded', () => {
    expect(nombreArchivoStorage(`${base}/public/gestor-uploads/x/recibo%20marzo%202024.pdf`)).toBe(
      'recibo marzo 2024.pdf',
    );
  });
});
