import { createRoot } from 'react-dom/client';
import { createElement } from 'react';
import jsPDF from 'jspdf';
import { toPng } from 'html-to-image';
import QRCode from 'qrcode';
import type { CertificadoParaPdf } from '@/services/api/campus';
import { verificacionUrl } from '@/services/api/campus';
import {
  CertificadoPremium,
  CERT_W,
  CERT_H,
  type EsquemaCert,
} from '../components/CertificadoPremium';

// ============================================================================
// Generación del certificado ULTRA PREMIUM (DGG-13).
//
// Estrategia v3 — switch html2canvas → html-to-image:
//   html2canvas rasteriza manualmente el DOM y falla con SVGs complejos +
//   position:absolute + bottom (perdía la franja inferior, QR, sello).
//   html-to-image en cambio serializa el DOM dentro de un foreignObject SVG
//   y lo dibuja en canvas — es el método más fiel posible al render real
//   del browser. Lo que ve el usuario en el preview = exactamente lo que
//   sale al PDF.
//
//   1. Monto <CertificadoPremium> en un host VISIBLE (no offscreen-hack)
//      en una capa por encima de la app con opacity 0 + pointer-events none,
//      para que el browser lo rasterice de verdad.
//   2. Espero fonts + imágenes + 3 frames.
//   3. toPng(target, { width: CERT_W, height: CERT_H, pixelRatio: 3 }).
//   4. jsPDF.addImage cubre A4 297×210mm (ratio idéntico a CERT_W/CERT_H).
// ============================================================================

async function generarQrDataUrl(url: string, dark: string): Promise<string | null> {
  try {
    return await QRCode.toDataURL(url, {
      margin: 1,
      width: 320,
      errorCorrectionLevel: 'M',
      color: { dark, light: '#ffffff' },
    });
  } catch {
    return null;
  }
}

/**
 * Convierte una URL a data:image/png;base64,...
 * Necesario porque html-to-image rasteriza dentro de foreignObject SVG y los
 * <img src="/cert/firma.png"> no siempre se inlinean correctamente — el SVG
 * referencia la URL pero el rasterizador final no resuelve el blob.
 * Solución: meter la imagen como data URL inline en el src antes del render.
 */
async function urlToDataUrl(url: string | null | undefined): Promise<string | null> {
  if (!url) return null;
  // Ya es data URL → no hacer nada
  if (url.startsWith('data:')) return url;
  try {
    const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/**
 * Convierte todas las URLs de imágenes del esquema a data URLs. Los campos
 * NULL del esquema usan los assets del default institucional como fallback.
 */
async function embedAssets(esquema: EsquemaCert | undefined): Promise<EsquemaCert | undefined> {
  if (!esquema) {
    // Sin esquema custom · pre-cargamos los defaults igual para que las firmas
    // del esquema institucional carguen en el PDF
    const defaults = {
      marca_logo_url: '/cert/logo-fundplata.png',
      firma_1_img_url: '/cert/firma-acuna.png',
      firma_2_img_url: '/cert/firma-parente.png',
      sello_logo_url: '/logo-white.png',
      watermark_url: '/cert/logo-fondo.png',
    };
    const [marca, firma1, firma2, sello, watermark] = await Promise.all([
      urlToDataUrl(defaults.marca_logo_url),
      urlToDataUrl(defaults.firma_1_img_url),
      urlToDataUrl(defaults.firma_2_img_url),
      urlToDataUrl(defaults.sello_logo_url),
      urlToDataUrl(defaults.watermark_url),
    ]);
    return {
      // El resto del esquema lo llena CertificadoPremium con ESQUEMA_DEFAULT
      color_acento: '#0b1f33',
      color_dorado: '#c9a961',
      visible_marca_logo: true,
      marca_logo_url: marca,
      visible_sigla: true,
      sigla_texto: 'FU.DE.CO.IN.',
      visible_texto_descriptivo: true,
      texto_descriptivo: 'por haber completado y aprobado satisfactoriamente el curso',
      visible_leyenda_legal: true,
      leyenda_legal:
        'Certificado emitido conforme a la habilitación de FU.DE.CO.IN., Ley N.° 14.701, ' +
        'Decreto N.° 1734/22 y Disposición N.° 27/23. Organizado por Gestión Global.',
      visible_firma_1: true,
      firma_1_img_url: firma1,
      firma_1_nombre: 'Dr. Pablo E. Acuña',
      firma_1_cargo: 'Coordinador Académico',
      visible_firma_2: true,
      firma_2_img_url: firma2,
      firma_2_nombre: 'Pablo M. Parente',
      firma_2_cargo: 'Presidente · FU.DE.CO.IN.',
      visible_sello: true,
      sello_logo_url: sello,
      visible_watermark: true,
      watermark_url: watermark,
    };
  }
  // Esquema custom · embed cada URL (caen al default si null)
  const [marca, firma1, firma2, sello, watermark] = await Promise.all([
    urlToDataUrl(esquema.marca_logo_url ?? '/cert/logo-fundplata.png'),
    urlToDataUrl(esquema.firma_1_img_url ?? '/cert/firma-acuna.png'),
    urlToDataUrl(esquema.firma_2_img_url ?? '/cert/firma-parente.png'),
    urlToDataUrl(esquema.sello_logo_url ?? '/logo-white.png'),
    urlToDataUrl(esquema.watermark_url ?? '/cert/logo-fondo.png'),
  ]);
  return {
    ...esquema,
    marca_logo_url: marca,
    firma_1_img_url: firma1,
    firma_2_img_url: firma2,
    sello_logo_url: sello,
    watermark_url: watermark,
  };
}

/**
 * Pre-fetchea el CSS de Google Fonts y reemplaza cada url(.woff2) por una
 * data: URL base64. El resultado se pasa como `fontEmbedCSS` a html-to-image
 * para que las fonts (Great Vibes, Cormorant Garamond, Inter, Sora) viajen
 * dentro del SVG foreignObject y queden disponibles durante el rasterizado.
 *
 * Sin esto, el rasterizado cae al system font porque el browser no resuelve
 * @font-face dentro del foreignObject del SVG. Con esto, "María Test
 * Administradora" se ve en Great Vibes (script) tal cual el preview.
 */
async function buildFontEmbedCSS(): Promise<string> {
  const fontsUrl =
    'https://fonts.googleapis.com/css2?' +
    'family=Inter:wght@400;500;600;700;800' +
    '&family=Sora:wght@600;700;800' +
    '&family=Cormorant+Garamond:ital,wght@0,500;0,600;0,700;1,500;1,600' +
    '&family=Great+Vibes' +
    '&display=swap';
  try {
    const cssRes = await fetch(fontsUrl, { mode: 'cors' });
    if (!cssRes.ok) return '';
    let cssText = await cssRes.text();
    const matches = cssText.match(/url\(https:\/\/[^)]+\)/g) ?? [];
    const urls = Array.from(new Set(matches.map((m) => m.slice(4, -1))));
    const replacements = await Promise.all(
      urls.map(async (url) => {
        try {
          const res = await fetch(url, { mode: 'cors' });
          if (!res.ok) return null;
          const blob = await res.blob();
          const dataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
          return [url, dataUrl] as const;
        } catch {
          return null;
        }
      }),
    );
    for (const r of replacements) {
      if (!r) continue;
      cssText = cssText.split(r[0]).join(r[1]);
    }
    return cssText;
  } catch {
    return '';
  }
}

async function esperarRecursos(node: HTMLElement): Promise<void> {
  try {
    if (document.fonts?.ready) await document.fonts.ready;
  } catch {
    /* noop */
  }
  const imgs = Array.from(node.querySelectorAll('img'));
  await Promise.all(
    imgs.map(
      (img) =>
        new Promise<void>((resolve) => {
          if (img.complete && img.naturalWidth > 0) return resolve();
          img.addEventListener('load', () => resolve(), { once: true });
          img.addEventListener('error', () => resolve(), { once: true });
        }),
    ),
  );
  // 3 frames + 80ms para que SVG conic-gradient/drop-shadows asienten.
  for (let i = 0; i < 3; i++) {
    await new Promise((r) => requestAnimationFrame(() => r(null)));
  }
  await new Promise((r) => setTimeout(r, 80));
}

export async function generateCertificadoPdf(
  cert: CertificadoParaPdf,
  esquema?: EsquemaCert,
): Promise<void> {
  const url = verificacionUrl(cert.codigo);
  const qrDataUrl = await generarQrDataUrl(url, esquema?.color_acento ?? '#0b1f33');

  // Pre-cargar todas las imágenes del esquema como data URLs. Sin esto,
  // html-to-image no inlinea bien las firmas/logos/watermark dentro del
  // foreignObject SVG → la captura sale sin las imágenes (espacio vacío
  // donde deberían estar las firmas escaneadas).
  //
  // Pre-cargar fontEmbedCSS con timeout duro 4s. Si Google Fonts responde
  // rápido, las fonts viajan en el SVG y el alumno se ve en Great Vibes
  // (script). Si tarda, devuelve '' y caemos a skipFonts (fallback de
  // system font para el script — feo pero no fatal). El timeout evita
  // colgar 60s+ en network lento.
  const fontEmbedCSSPromise = Promise.race<string>([
    buildFontEmbedCSS(),
    new Promise<string>((r) => setTimeout(() => r(''), 4000)),
  ]);
  const [esquemaEmbedded, fontEmbedCSS] = await Promise.all([
    embedAssets(esquema),
    fontEmbedCSSPromise,
  ]);

  // Host VISIBLE pero invisible al usuario · z-index alto + opacity 0.
  // Sin position:fixed offscreen — el browser necesita layoutar de verdad
  // todos los position:absolute hijos.
  const host = document.createElement('div');
  host.style.position = 'fixed';
  host.style.left = '0';
  host.style.top = '0';
  host.style.width = `${CERT_W}px`;
  host.style.height = `${CERT_H}px`;
  host.style.opacity = '0';
  host.style.pointerEvents = 'none';
  host.style.zIndex = '-9999';
  host.style.overflow = 'hidden';
  document.body.appendChild(host);

  const root = createRoot(host);
  try {
    await new Promise<void>((resolve) => {
      root.render(
        createElement(CertificadoPremium, {
          cert,
          qrDataUrl,
          verificarUrl: url,
          esquema: esquemaEmbedded,
        }),
      );
      requestAnimationFrame(() => resolve());
    });

    const target = host.firstElementChild as HTMLElement | null;
    if (!target) throw new Error('No se montó el certificado');
    await esperarRecursos(target);

    // html-to-image: serializa DOM dentro de un foreignObject SVG y rasteriza
    // en canvas. Captura fielmente SVGs, conic-gradient, drop-shadow, etc.
    //
    // Si fontEmbedCSS llegó a tiempo (<4s) lo pasamos para que las fonts
    // viajen en el SVG. Si vino vacío, usamos skipFonts:true para saltar el
    // auto-scan cross-origin de Google Fonts (SecurityError) y dejar que el
    // browser use las fonts que ya tiene cargadas en memoria. En el peor caso
    // el "María Test" cae a system-ui (feo pero no rompe firmas/logos).
    const dataUrl = await toPng(target, {
      width: CERT_W,
      height: CERT_H,
      pixelRatio: 3,
      cacheBust: true,
      ...(fontEmbedCSS ? { fontEmbedCSS } : { skipFonts: true }),
      fetchRequestInit: { mode: 'cors', credentials: 'omit' },
    });

    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const W = doc.internal.pageSize.getWidth(); // 297
    const H = doc.internal.pageSize.getHeight(); // 210
    doc.addImage(dataUrl, 'PNG', 0, 0, W, H, undefined, 'FAST');
    doc.save(`certificado-${cert.codigo}.pdf`);
  } finally {
    root.unmount();
    host.remove();
  }
}
