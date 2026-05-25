// ============================================================================
// reportPdf — DGG-26
//
// Genera PDFs con branding Gestión Global desde cualquier tabla/lista.
// Patrón: monta <ReportPdfTemplate> offscreen, espera fuentes+imágenes,
// captura con html2canvas y arma PDF multi-página con jsPDF.
// Capitaliza la estrategia probada en certificados Campus (DGG-13).
// ============================================================================

import { createRoot } from 'react-dom/client';
import { createElement } from 'react';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import {
  ReportPdfTemplate,
  REPORT_W,
  type ReportColumn,
  type ReportKpi,
} from '@/components/reports/ReportPdfTemplate';

const ROWS_PER_PAGE = 28; // ajustado a la altura A4 vertical menos header/kpis/footer

export interface GenerateReportPdfInput<T> {
  filename: string;
  titulo: string;
  subtitulo?: string;
  filtros?: Array<{ label: string; value: string }>;
  kpis?: ReportKpi[];
  columns: ReportColumn<T>[];
  rows: T[];
}

async function esperarRecursos(node: HTMLElement): Promise<void> {
  try {
    if (document.fonts?.ready) await document.fonts.ready;
  } catch {/* noop */}
  const imgs = Array.from(node.querySelectorAll('img'));
  await Promise.all(
    imgs.map((img) =>
      img.complete
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            img.onload = () => resolve();
            img.onerror = () => resolve();
          }),
    ),
  );
  // micro-frame extra para que el layout asiente
  await new Promise((r) => requestAnimationFrame(() => r(null)));
}

export async function generateReportPdf<T>(
  input: GenerateReportPdfInput<T>,
): Promise<void> {
  const totalPaginas = Math.max(1, Math.ceil(input.rows.length / ROWS_PER_PAGE));
  const fechaGeneracion = new Date();

  // Container offscreen
  const container = document.createElement('div');
  container.style.position = 'fixed';
  container.style.left = '-99999px';
  container.style.top = '0';
  container.style.width = `${REPORT_W}px`;
  container.style.zIndex = '-1';
  document.body.appendChild(container);
  const root = createRoot(container);

  const pdf = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });
  const pageWidthMm = 210;
  const pageHeightMm = 297;

  try {
    for (let p = 0; p < totalPaginas; p++) {
      const sliceStart = p * ROWS_PER_PAGE;
      const sliceEnd = sliceStart + ROWS_PER_PAGE;
      const pageRows = input.rows.slice(sliceStart, sliceEnd);

      root.render(
        createElement(ReportPdfTemplate, {
          titulo: input.titulo,
          subtitulo: input.subtitulo,
          filtros: input.filtros,
          // KPIs solo en la primera página
          kpis: p === 0 ? input.kpis : [],
          columns: input.columns,
          rows: pageRows,
          pagina: p + 1,
          totalPaginas,
          fechaGeneracion,
        } as React.ComponentProps<typeof ReportPdfTemplate>),
      );

      // Esperar a que React monte
      await new Promise((r) => setTimeout(r, 60));
      const node = container.firstElementChild as HTMLElement;
      if (!node) throw new Error('No pude montar el template del reporte');
      await esperarRecursos(node);

      const canvas = await html2canvas(node, {
        scale: 2,
        backgroundColor: '#ffffff',
        useCORS: true,
        logging: false,
      });
      const img = canvas.toDataURL('image/png');

      if (p > 0) pdf.addPage();
      pdf.addImage(img, 'PNG', 0, 0, pageWidthMm, pageHeightMm, undefined, 'FAST');
    }

    pdf.save(input.filename.endsWith('.pdf') ? input.filename : `${input.filename}.pdf`);
  } finally {
    // Cleanup
    root.unmount();
    container.remove();
  }
}
