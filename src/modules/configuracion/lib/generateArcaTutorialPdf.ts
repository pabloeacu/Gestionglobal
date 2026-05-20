import jsPDF from 'jspdf';

// Paleta brand (RGB) — replica generateComprobantePdf.ts para mantener
// coherencia visual entre piezas de comunicación impresa.
const CYAN: [number, number, number] = [0, 158, 202];
const CYAN_PALE: [number, number, number] = [229, 246, 252];
const CYAN_MIST: [number, number, number] = [242, 250, 253];
const TEAL: [number, number, number] = [22, 160, 162];
const INK: [number, number, number] = [13, 30, 47];
const MUTED: [number, number, number] = [100, 116, 139];
const SOFT: [number, number, number] = [203, 213, 225];
const WHITE: [number, number, number] = [255, 255, 255];

interface LogoAsset {
  dataUrl: string;
  aspect: number;
}
let cachedLogo: LogoAsset | null | undefined;

// Trim del logo (negativo blanco) reutilizando misma lógica del comprobante.
// Cuando el logo se va a usar en COVER cyan, conviene la versión blanca.
async function loadLogoNegativo(): Promise<LogoAsset | null> {
  if (cachedLogo !== undefined) return cachedLogo;
  try {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = '/brand/logo-white.png';
    await img.decode();

    const SCAN = 600;
    const tmp = document.createElement('canvas');
    const sAspect = img.naturalWidth / Math.max(1, img.naturalHeight);
    tmp.width = sAspect >= 1 ? SCAN : Math.round(SCAN * sAspect);
    tmp.height = sAspect >= 1 ? Math.round(SCAN / sAspect) : SCAN;
    const tctx = tmp.getContext('2d');
    if (!tctx) {
      cachedLogo = null;
      return null;
    }
    tctx.drawImage(img, 0, 0, tmp.width, tmp.height);

    const data = tctx.getImageData(0, 0, tmp.width, tmp.height).data;
    let minX = tmp.width;
    let minY = tmp.height;
    let maxX = 0;
    let maxY = 0;
    let found = false;
    for (let y = 0; y < tmp.height; y++) {
      for (let x = 0; x < tmp.width; x++) {
        const alpha = data[(y * tmp.width + x) * 4 + 3] ?? 0;
        if (alpha > 12) {
          found = true;
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (!found) {
      cachedLogo = { dataUrl: tmp.toDataURL('image/png'), aspect: sAspect };
      return cachedLogo;
    }
    const cw = maxX - minX + 1;
    const ch = maxY - minY + 1;
    const TARGET_LONG = 320;
    const trimAspect = cw / ch;
    const outW = trimAspect >= 1 ? TARGET_LONG : Math.round(TARGET_LONG * trimAspect);
    const outH = trimAspect >= 1 ? Math.round(TARGET_LONG / trimAspect) : TARGET_LONG;
    const out = document.createElement('canvas');
    out.width = outW;
    out.height = outH;
    const octx = out.getContext('2d');
    if (!octx) {
      cachedLogo = null;
      return null;
    }
    octx.drawImage(tmp, minX, minY, cw, ch, 0, 0, outW, outH);
    cachedLogo = { dataUrl: out.toDataURL('image/png'), aspect: trimAspect };
    return cachedLogo;
  } catch {
    cachedLogo = null;
    return null;
  }
}

interface StepBlock {
  numero: number;
  titulo: string;
  parrafos: string[];
  bullets?: string[];
}

const PASOS: StepBlock[] = [
  {
    numero: 1,
    titulo: 'Generar el CSR (Certificate Signing Request)',
    parrafos: [
      'En la pantalla ARCA · Facturación electrónica, completá el campo "Alias" (o dejá el sugerido) y presioná "Generar CSR".',
      'La plataforma crea un par de claves RSA de 2048 bits y firma un CSR PKCS#10 con los datos fiscales de la empresa. La clave privada nunca sale del servidor.',
    ],
    bullets: [
      'Hacé clic en "Descargar .csr" — vas a obtener un archivo con extensión .csr.',
      'Tomá nota del Alias que muestra la plataforma; lo vas a necesitar al subir el CSR a AFIP.',
      'Una vez descargado, avanzá al Paso 2.',
    ],
  },
  {
    numero: 2,
    titulo: 'Subir el CSR al portal AFIP y generar el certificado',
    parrafos: [
      'Ingresá a www.afip.gob.ar con tu clave fiscal. Desde "Administrador de Relaciones de Clave Fiscal", agregá el servicio "Administración de Certificados Digitales" si todavía no lo tenés habilitado.',
      'Entrá al servicio. Para HOMOLOGACIÓN (pruebas) elegí "WSASS — Web Services de pruebas". Para PRODUCCIÓN seleccioná "Administración de Certificados Digitales" estándar.',
    ],
    bullets: [
      'Hacé clic en "Agregar alias" y pegá el alias que mostró Gestión Global (p. ej. gestion-global-2026).',
      'Subí el archivo .csr descargado en el Paso 1.',
      'AFIP devuelve un certificado .crt — descargalo y guardalo.',
      'Después tenés que asociar el alias al Web Service "wsfe" (Facturación Electrónica): "Nueva Relación" → buscar "wsfe" → guardar.',
    ],
  },
  {
    numero: 3,
    titulo: 'Subir el certificado a Gestión Global',
    parrafos: [
      'Volvé a la pantalla ARCA y avanzá al Paso 3. Pegá el contenido del .crt en el cuadro de texto o arrastrá el archivo directamente sobre el área indicada.',
      'La plataforma valida el certificado, extrae su CN, número de serie y fecha de vencimiento, y lo guarda en la base de datos encriptado.',
    ],
    bullets: [
      'Verificá que el "Válido hasta" coincida con lo que dice AFIP (típicamente 2 años para producción, 1 año para homologación).',
      'Si el certificado venció o no corresponde al CSR generado, vas a recibir un error claro; en ese caso regenerá CSR y repetí el paso 2.',
    ],
  },
  {
    numero: 4,
    titulo: 'Probar la conexión',
    parrafos: [
      'En el Paso 4 hacé clic en "Probar conexión". La plataforma se autentica contra WSAA con tu certificado, obtiene un Token + Sign, y consulta WSFE para confirmar que todo responde.',
      'Si el test devuelve OK, vas a poder emitir comprobantes fiscales A/B/C con CAE. Si falla, el mensaje de error explica si es problema de certificado, alias sin servicio, o algún otro punto.',
    ],
    bullets: [
      'Recordá: en HOMOLOGACIÓN los comprobantes son de prueba y no tienen validez fiscal.',
      'Para pasar a PRODUCCIÓN: una vez que test esté OK, usá el botón "Cambiar..." junto al badge de ambiente. La plataforma te va a pedir confirmación y va a borrar los tokens de homologación.',
    ],
  },
];

const NOTAS_FINALES = [
  'El certificado vence (habitualmente cada 2 años en producción). Vas a recibir avisos a partir de 30 días antes; renová con tiempo.',
  'Si extraviás el certificado o sospechás que se comprometió, regenerá un CSR — la clave anterior queda inservible y forzás un nuevo certificado.',
  'Soporte: ante cualquier duda escribinos a contacto@gestionglobal.ar; identificá tu administración para que podamos ayudarte rápido.',
];

export async function generateArcaTutorialPdf(): Promise<jsPDF> {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 18;
  const innerW = pageW - margin * 2;

  const logo = await loadLogoNegativo();

  // ====== Watermark sutil ==============================================
  drawWatermarkTriangles(doc, pageW, pageH);

  // ====== COVER bipartito 42mm =========================================
  const coverH = 42;
  const splitX = pageW * 0.58;
  doc.setFillColor(...CYAN);
  doc.rect(0, 0, splitX, coverH, 'F');
  doc.setFillColor(...TEAL);
  doc.rect(splitX, 0, pageW - splitX, coverH, 'F');
  for (let i = 0; i < 8; i++) {
    const t = i / 8;
    const r = Math.round(CYAN[0] + (TEAL[0] - CYAN[0]) * t);
    const g = Math.round(CYAN[1] + (TEAL[1] - CYAN[1]) * t);
    const b = Math.round(CYAN[2] + (TEAL[2] - CYAN[2]) * t);
    doc.setFillColor(r, g, b);
    doc.rect(splitX - 8 + i, 0, 1.1, coverH, 'F');
  }

  if (logo) {
    const logoH = 22;
    const logoW = logoH * logo.aspect;
    doc.addImage(
      logo.dataUrl,
      'PNG',
      margin,
      (coverH - logoH) / 2,
      logoW,
      logoH,
      undefined,
      'FAST',
    );
  } else {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.setTextColor(...WHITE);
    doc.text('GESTIÓN GLOBAL', margin, coverH / 2);
  }

  const rightCx = splitX + (pageW - splitX) / 2;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(...WHITE);
  doc.text('TUTORIAL', rightCx, 11, { align: 'center', charSpace: 1.6 });
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(17);
  doc.text('Vinculación', rightCx, 22, { align: 'center' });
  doc.setFontSize(12);
  doc.text('con ARCA / AFIP', rightCx, 30, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.text('FACTURACIÓN ELECTRÓNICA', rightCx, 37, {
    align: 'center',
    charSpace: 1.4,
  });

  // ====== INTRO ========================================================
  let y = coverH + 12;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(...CYAN);
  doc.text('INTRODUCCIÓN', margin, y, { charSpace: 1.5 });
  y += 6;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(...INK);
  doc.text('Conectá Gestión Global con AFIP en 4 pasos', margin, y);
  y += 7;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(...MUTED);
  const introWrap = doc.splitTextToSize(
    'Para emitir facturas A, B y C con CAE necesitamos un certificado digital firmado por AFIP que autentique a tu empresa contra los Web Services WSAA y WSFE. Este tutorial te acompaña paso a paso por el proceso self-service de la plataforma. Reservá entre 20 y 40 minutos la primera vez.',
    innerW,
  ) as string[];
  doc.text(introWrap, margin, y);
  y += introWrap.length * 4.5 + 6;

  // Stepper visual minimal — 4 círculos numerados conectados
  drawStepperHorizontal(doc, margin, y, innerW);
  y += 22;

  // ====== STEPS ========================================================
  for (const paso of PASOS) {
    // Si no entra el bloque del paso (cabecera + ~3 líneas), saltamos página.
    if (y > pageH - 70) {
      doc.addPage();
      drawWatermarkTriangles(doc, pageW, pageH);
      y = margin + 6;
    }
    y = drawStepBlock(doc, paso, margin, y, innerW, pageH);
    y += 4;
  }

  // ====== NOTAS FINALES =================================================
  if (y > pageH - 50) {
    doc.addPage();
    drawWatermarkTriangles(doc, pageW, pageH);
    y = margin + 6;
  }
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(...CYAN);
  doc.text('TENÉ EN CUENTA', margin, y, { charSpace: 1.5 });
  y += 6;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(...INK);
  for (const nota of NOTAS_FINALES) {
    const wrap = doc.splitTextToSize(`• ${nota}`, innerW) as string[];
    if (y + wrap.length * 4.6 > pageH - 22) {
      doc.addPage();
      drawWatermarkTriangles(doc, pageW, pageH);
      y = margin + 6;
    }
    doc.text(wrap, margin, y);
    y += wrap.length * 4.6 + 1.5;
  }

  // ====== FOOTER en todas las páginas ==================================
  const total = doc.getNumberOfPages();
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    drawFooter(doc, pageW, pageH, p, total);
  }

  return doc;
}

// =====================================================================
// helpers
// =====================================================================

function drawStepperHorizontal(
  doc: jsPDF,
  x: number,
  y: number,
  w: number,
) {
  const count = 4;
  const cx0 = x + 6;
  const cxN = x + w - 6;
  const dx = (cxN - cx0) / (count - 1);
  // Línea base
  doc.setDrawColor(...SOFT);
  doc.setLineWidth(0.4);
  doc.line(cx0, y, cxN, y);
  for (let i = 0; i < count; i++) {
    const cx = cx0 + dx * i;
    doc.setFillColor(...CYAN);
    doc.circle(cx, y, 3.4, 'F');
    doc.setTextColor(...WHITE);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text(String(i + 1), cx, y + 1.2, { align: 'center' });
    const labels = ['CSR', 'AFIP', 'Cert', 'Probar'];
    doc.setTextColor(...MUTED);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.text(labels[i] ?? '', cx, y + 8, { align: 'center', charSpace: 0.6 });
  }
}

function drawStepBlock(
  doc: jsPDF,
  paso: StepBlock,
  x: number,
  y: number,
  w: number,
  pageH: number,
): number {
  // Header con número en círculo cyan + título
  doc.setFillColor(...CYAN);
  doc.circle(x + 5, y + 4, 4.5, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(...WHITE);
  doc.text(String(paso.numero), x + 5, y + 5.6, { align: 'center' });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(...INK);
  doc.text(paso.titulo, x + 13, y + 5.6);

  y += 11;

  // Línea sutil bajo el header
  doc.setDrawColor(...CYAN_PALE);
  doc.setLineWidth(0.4);
  doc.line(x, y, x + w, y);
  y += 4;

  // Parrafos
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(...MUTED);
  for (const p of paso.parrafos) {
    const lines = doc.splitTextToSize(p, w - 4) as string[];
    if (y + lines.length * 4.4 > pageH - 22) {
      doc.addPage();
      drawWatermarkTriangles(
        doc,
        doc.internal.pageSize.getWidth(),
        doc.internal.pageSize.getHeight(),
      );
      y = 22;
    }
    doc.text(lines, x + 4, y);
    y += lines.length * 4.4 + 2;
  }

  // Bullets
  if (paso.bullets) {
    y += 1;
    for (const b of paso.bullets) {
      const wrap = doc.splitTextToSize(b, w - 12) as string[];
      const blockH = wrap.length * 4.4 + 1;
      if (y + blockH > pageH - 22) {
        doc.addPage();
        drawWatermarkTriangles(
          doc,
          doc.internal.pageSize.getWidth(),
          doc.internal.pageSize.getHeight(),
        );
        y = 22;
      }
      // Bullet dot (triángulo brand)
      doc.setFillColor(...CYAN);
      doc.triangle(x + 6, y - 2, x + 9, y - 3.5, x + 9, y - 0.5, 'F');
      doc.setTextColor(...INK);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9.5);
      doc.text(wrap, x + 12, y);
      y += blockH;
    }
  }

  return y;
}

function drawFooter(
  doc: jsPDF,
  pageW: number,
  pageH: number,
  page: number,
  total: number,
) {
  // Línea brand cyan/teal en la base
  const stripH = 4;
  const segments = 60;
  for (let i = 0; i < segments; i++) {
    const t = i / segments;
    const r = Math.round(CYAN[0] + (TEAL[0] - CYAN[0]) * t);
    const g = Math.round(CYAN[1] + (TEAL[1] - CYAN[1]) * t);
    const b = Math.round(CYAN[2] + (TEAL[2] - CYAN[2]) * t);
    doc.setFillColor(r, g, b);
    doc.rect((pageW / segments) * i, pageH - stripH, pageW / segments + 0.5, stripH, 'F');
  }

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(...MUTED);
  doc.text(
    'Gestión Global · Aliados de tu tiempo · gestionglobal.ar',
    pageW / 2,
    pageH - stripH - 3,
    { align: 'center', charSpace: 0.5 },
  );
  doc.text(
    `Página ${page} de ${total}`,
    pageW - 18,
    pageH - stripH - 3,
    { align: 'right' },
  );
}

function drawWatermarkTriangles(doc: jsPDF, pageW: number, pageH: number) {
  doc.setFillColor(...CYAN_MIST);
  const groups: Array<[number, number, number]> = [
    [pageW * 0.78, pageH * 0.20, 0.9],
    [pageW * 0.08, pageH * 0.50, 1.1],
    [pageW * 0.88, pageH * 0.66, 0.7],
    [pageW * 0.45, pageH * 0.82, 0.85],
    [pageW * 0.12, pageH * 0.18, 0.5],
  ];
  for (const [cx, cy, scale] of groups) {
    const s = 14 * scale;
    doc.triangle(cx, cy + s, cx + s, cy, cx + s, cy + s, 'F');
    doc.triangle(cx + s + 2, cy + s, cx + 2 * s + 2, cy, cx + 2 * s + 2, cy + s, 'F');
    doc.triangle(cx + 2 * s + 4, cy + s, cx + 3 * s + 4, cy, cx + 3 * s + 4, cy + s, 'F');
  }
}

export function descargarTutorialArca(): Promise<void> {
  return generateArcaTutorialPdf().then((doc) => {
    doc.save('Gestion-Global-Tutorial-ARCA.pdf');
  });
}
