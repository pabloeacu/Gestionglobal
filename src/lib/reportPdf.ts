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
import type { ReactNode } from 'react';
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
  /** DGG-250 · bloque libre (paneles/gráficos) en la primera página, entre KPIs y tabla. */
  headerExtra?: ReactNode;
  /** Filas en la primera página (default = ROWS_PER_PAGE). Bajalo si hay headerExtra alto. */
  firstPageRows?: number;
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
  const firstPageRows = input.firstPageRows ?? ROWS_PER_PAGE;
  // página 1 toma firstPageRows; las siguientes, ROWS_PER_PAGE.
  const restRows = Math.max(0, input.rows.length - firstPageRows);
  const totalPaginas = Math.max(1, 1 + Math.ceil(restRows / ROWS_PER_PAGE));
  const fechaGeneracion = new Date();
  const sliceFor = (p: number): T[] => {
    if (p === 0) return input.rows.slice(0, firstPageRows);
    const start = firstPageRows + (p - 1) * ROWS_PER_PAGE;
    return input.rows.slice(start, start + ROWS_PER_PAGE);
  };

  // Container offscreen
  const container = document.createElement('div');
  container.style.position = 'fixed';
  container.style.left = '-99999px';
  container.style.top = '0';
  container.style.width = `${REPORT_W}px`;
  container.style.zIndex = '-1';
  // DGG-136 · escape del tema gg-brand: los PDFs son INTOCABLES (identidad clásica siempre)
  container.setAttribute('data-gg-classic', '');
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
      const pageRows = sliceFor(p);

      root.render(
        createElement(ReportPdfTemplate, {
          titulo: input.titulo,
          subtitulo: input.subtitulo,
          filtros: input.filtros,
          // KPIs y bloque libre solo en la primera página
          kpis: p === 0 ? input.kpis : [],
          headerExtra: p === 0 ? input.headerExtra : undefined,
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
