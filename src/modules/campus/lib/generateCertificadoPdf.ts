import jsPDF from 'jspdf';
import QRCode from 'qrcode';
import type { CertificadoParaPdf } from '@/services/api/campus';
import { verificacionUrl } from '@/services/api/campus';

// ============================================================================
// Render del certificado verificable (Campus Fase 2 · DGG-10).
//
// Enfoque: PDF recreado a vector con jsPDF (NO se reusa el SVG/PNG FUNDPLATA
// original, cuyo texto está horneado/vectorizado a paths — ver CAMPUS_DESIGN
// y DGG-10bis). Recreamos el layout (apaisado A4, banda de color por tema,
// sello dorado, leyenda legal de habilitación, doble firma, QR de verificación)
// con los campos dinámicos como TEXTO REAL. Esto da control total y evita el
// problema del texto vectorizado.
//
// 4 temas de color (según certificados.tema):
//   1 = marino + dorado (Curso de Formación / Integral)
//   2 = dorado          (Actualización 2024)
//   3 = cyan / teal     (Actualización 2025)
//   4 = violeta         (Actualización 2026)
// ============================================================================

type RGB = [number, number, number];

interface Tema {
  primario: RGB; // banda / acentos
  oscuro: RGB; // títulos
  dorado: RGB; // sello + curso
}

const TEMAS: Record<number, Tema> = {
  1: { primario: [16, 42, 74], oscuro: [12, 28, 51], dorado: [184, 134, 11] },
  2: { primario: [180, 138, 38], oscuro: [92, 68, 14], dorado: [180, 138, 38] },
  3: { primario: [0, 158, 202], oscuro: [13, 74, 92], dorado: [184, 134, 11] },
  4: { primario: [109, 64, 168], oscuro: [58, 32, 92], dorado: [184, 134, 11] },
};

const INK: RGB = [13, 30, 47];
const MUTED: RGB = [100, 116, 139];
const WHITE: RGB = [255, 255, 255];

// Leyenda legal de habilitación (DGG-10bis · FUNDPLATA / FU.DE.CO.IN).
const LEYENDA_LEGAL =
  'Certificado emitido conforme a la habilitación de FU.DE.CO.IN, Ley N° 14.701, ' +
  'Decreto N° 1734/22, Disposición N° 27/23. Organizado por GESTIÓN GLOBAL.';

let cachedLogo: string | null | undefined;
async function loadLogo(): Promise<string | null> {
  if (cachedLogo !== undefined) return cachedLogo;
  try {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = '/brand/logo-white.png';
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext('2d');
    if (!ctx) {
      cachedLogo = null;
      return null;
    }
    ctx.drawImage(img, 0, 0);
    cachedLogo = c.toDataURL('image/png');
    return cachedLogo;
  } catch {
    cachedLogo = null;
    return null;
  }
}

function fechaLarga(iso: string): string {
  const d = new Date(iso);
  const meses = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
  ];
  return `${meses[d.getMonth()]} de ${d.getFullYear()}`;
}

// Genera el PDF del certificado y lo descarga en el navegador.
export async function generateCertificadoPdf(
  cert: CertificadoParaPdf,
): Promise<void> {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth(); // 297
  const H = doc.internal.pageSize.getHeight(); // 210
  const tema = TEMAS[cert.tema] ?? TEMAS[1]!;

  // Fondo
  doc.setFillColor(...WHITE);
  doc.rect(0, 0, W, H, 'F');

  // Bandas de color superior/inferior por tema
  doc.setFillColor(...tema.primario);
  doc.rect(0, 0, W, 10, 'F');
  doc.rect(0, H - 10, W, 10, 'F');

  // Marco interior fino dorado
  doc.setDrawColor(...tema.dorado);
  doc.setLineWidth(0.8);
  doc.rect(12, 16, W - 24, H - 32);
  doc.setLineWidth(0.3);
  doc.rect(14, 18, W - 28, H - 36);

  // Logo Gestión Global (arriba centro)
  const logo = await loadLogo();
  if (logo) {
    // logo blanco sobre banda de color: lo ponemos dentro de un chip oscuro
    doc.setFillColor(...tema.oscuro);
    doc.roundedRect(W / 2 - 26, 22, 52, 13, 2, 2, 'F');
    try {
      doc.addImage(logo, 'PNG', W / 2 - 23, 24, 46, 9, undefined, 'FAST');
    } catch {
      /* noop */
    }
  }

  // Título CERTIFICADO
  doc.setTextColor(...tema.oscuro);
  doc.setFont('times', 'bold');
  doc.setFontSize(34);
  doc.text('CERTIFICADO', W / 2, 52, { align: 'center' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.setTextColor(...MUTED);
  doc.text('Se otorga el presente certificado a', W / 2, 62, { align: 'center' });

  // Nombre del alumno (script/cursiva grande)
  doc.setFont('times', 'italic');
  doc.setFontSize(30);
  doc.setTextColor(...INK);
  doc.text(cert.alumno_nombre, W / 2, 78, { align: 'center' });

  // Subrayado decorativo bajo el nombre
  const nombreW = Math.min(
    doc.getTextWidth(cert.alumno_nombre) + 20,
    W - 80,
  );
  doc.setDrawColor(...tema.dorado);
  doc.setLineWidth(0.5);
  doc.line(W / 2 - nombreW / 2, 82, W / 2 + nombreW / 2, 82);

  // Cuerpo: por haber completado el curso
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.setTextColor(...MUTED);
  doc.text('por haber completado satisfactoriamente el', W / 2, 92, {
    align: 'center',
  });

  doc.setFont('times', 'bold');
  doc.setFontSize(17);
  doc.setTextColor(...tema.dorado);
  const cursoLines = doc.splitTextToSize(cert.curso_titulo, W - 90) as string[];
  doc.text(cursoLines, W / 2, 101, { align: 'center' });

  let y = 101 + cursoLines.length * 7 + 4;

  // Datos: fecha · nota · horas
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(...INK);
  const partes: string[] = [fechaLarga(cert.emitido_at)];
  if (cert.nota_examen !== null && cert.nota_examen !== undefined) {
    partes.push(`Nota del examen: ${cert.nota_examen}`);
  }
  if (cert.duracion_horas) partes.push(`${cert.duracion_horas} horas`);
  doc.text(partes.join('   ·   '), W / 2, y, { align: 'center' });
  y += 4;

  // Leyenda legal (pequeña, centrada)
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(7);
  doc.setTextColor(...MUTED);
  const legalLines = doc.splitTextToSize(LEYENDA_LEGAL, W - 110) as string[];
  doc.text(legalLines, W / 2, y + 4, { align: 'center' });

  // Firmas (dos columnas en la parte baja)
  const firmaY = H - 30;
  doc.setDrawColor(...SOFTLINE());
  doc.setLineWidth(0.3);
  doc.line(45, firmaY, 105, firmaY);
  doc.line(W - 105, firmaY, W - 45, firmaY);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...INK);
  doc.text('Pablo M. Parente', 75, firmaY + 4, { align: 'center' });
  doc.text('Dr. Pablo E. Acuña', W - 75, firmaY + 4, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(...MUTED);
  doc.text('Presidente FU.DE.CO.IN', 75, firmaY + 8, { align: 'center' });
  doc.text('Coordinador Académico', W - 75, firmaY + 8, { align: 'center' });

  // Sello dorado central (entre firmas)
  doc.setFillColor(...tema.dorado);
  doc.circle(W / 2, firmaY + 2, 11, 'F');
  doc.setFillColor(...tema.oscuro);
  doc.circle(W / 2, firmaY + 2, 8.5, 'F');
  doc.setTextColor(...WHITE);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6);
  doc.text('GESTIÓN', W / 2, firmaY + 0.5, { align: 'center' });
  doc.text('GLOBAL', W / 2, firmaY + 4, { align: 'center' });

  // QR de verificación (esquina inferior derecha) + código
  const url = verificacionUrl(cert.codigo);
  try {
    const qrDataUrl = await QRCode.toDataURL(url, {
      margin: 1,
      width: 240,
      color: { dark: '#0d1e2f', light: '#ffffff' },
    });
    const qrSize = 22;
    doc.addImage(qrDataUrl, 'PNG', W - 18 - qrSize, H - 16 - qrSize, qrSize, qrSize);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6);
    doc.setTextColor(...MUTED);
    doc.text('Verificá este certificado', W - 18 - qrSize / 2, H - 16, {
      align: 'center',
    });
  } catch {
    /* si el QR falla, igual mostramos el código */
  }

  // Código de verificación (esquina inferior izquierda)
  doc.setFont('courier', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...tema.oscuro);
  doc.text(`Código: ${cert.codigo}`, 18, H - 14);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6);
  doc.setTextColor(...MUTED);
  doc.text('gestionglobal.ar/verificar', 18, H - 10.5);

  const filename = `certificado-${cert.codigo}.pdf`;
  doc.save(filename);
}

function SOFTLINE(): RGB {
  return [148, 163, 184];
}
