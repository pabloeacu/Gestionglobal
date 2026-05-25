// ============================================================================
// ReportPdfTemplate — DGG-26
//
// Template HTML/CSS para PDFs premium con la estética Gestión Global:
// header con logo + título, chips de filtros aplicados, KPI strip opcional,
// tabla con header ink + filas alternadas + tabular nums, footer con marca
// y pagining. Captura por html2canvas a scale 3 → PNG → jsPDF (mismo enfoque
// que el certificado del campus, DGG-13).
//
// Diseño:
// - A4 vertical 210x297mm @ 96dpi ≈ 794x1123 px (cara de captura)
// - Padding ~32px laterales, header 100px, table fluida, footer 36px
// - Acentos triangulares cyan/teal en esquinas (consistente con la marca)
// - Tipografía: Manrope (display) + Inter (sans), tabular para números
// ============================================================================

import type { ReactNode } from 'react';

export const REPORT_W = 794; // px (A4 vertical)
export const REPORT_H = 1123; // px

export interface ReportColumn<T> {
  key: keyof T | string;
  label: string;
  align?: 'left' | 'right' | 'center';
  width?: string; // ej '20%'
  format?: (row: T) => ReactNode;
}

export interface ReportKpi {
  label: string;
  value: string;
  tone?: 'cyan' | 'emerald' | 'amber' | 'rose' | 'ink';
}

export interface ReportPdfTemplateProps<T = Record<string, unknown>> {
  titulo: string;
  subtitulo?: string;
  filtros?: Array<{ label: string; value: string }>;
  kpis?: ReportKpi[];
  columns: ReportColumn<T>[];
  rows: T[];
  pagina?: number;
  totalPaginas?: number;
  fechaGeneracion?: Date;
}

const TONE_COLORS: Record<NonNullable<ReportKpi['tone']>, { bg: string; text: string }> = {
  cyan: { bg: '#0e9bc81a', text: '#0e9bc8' },
  emerald: { bg: '#10b9811a', text: '#10b981' },
  amber: { bg: '#f59e0b1a', text: '#b45309' },
  rose: { bg: '#f43f5e1a', text: '#e11d48' },
  ink: { bg: '#0f172a0d', text: '#0f172a' },
};

export function ReportPdfTemplate<T>({
  titulo,
  subtitulo,
  filtros = [],
  kpis = [],
  columns,
  rows,
  pagina = 1,
  totalPaginas = 1,
  fechaGeneracion = new Date(),
}: ReportPdfTemplateProps<T>) {
  return (
    <div
      style={{
        width: REPORT_W,
        height: REPORT_H,
        backgroundColor: '#ffffff',
        color: '#0f172a',
        fontFamily: 'Manrope, Inter, -apple-system, system-ui, sans-serif',
        position: 'relative',
        overflow: 'hidden',
        boxSizing: 'border-box',
        padding: '32px 36px',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Triángulos decorativos cyan/teal · estética marca */}
      <svg
        style={{ position: 'absolute', top: 0, right: 0, opacity: 0.08 }}
        width="180" height="180" viewBox="0 0 180 180"
      >
        <polygon points="180,0 180,80 100,0" fill="#0e9bc8" />
        <polygon points="180,40 180,120 140,80" fill="#0d9488" />
      </svg>
      <svg
        style={{ position: 'absolute', bottom: 0, left: 0, opacity: 0.06 }}
        width="160" height="160" viewBox="0 0 160 160"
      >
        <polygon points="0,160 0,80 80,160" fill="#0d9488" />
      </svg>

      {/* Header · logo + título */}
      <header
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          paddingBottom: 20,
          borderBottom: '2px solid #e2e8f0',
          marginBottom: 18,
        }}
      >
        <div style={{ flex: 1 }}>
          <img
            src="/brand/logo-h-slogan.png"
            alt="Gestión Global"
            crossOrigin="anonymous"
            style={{ height: 48, width: 'auto', display: 'block' }}
          />
        </div>
        <div style={{ textAlign: 'right', flex: 1 }}>
          <p
            style={{
              fontSize: 11,
              color: '#0e9bc8',
              fontWeight: 600,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              margin: 0,
            }}
          >
            Reporte
          </p>
          <h1
            style={{
              fontSize: 22,
              fontWeight: 700,
              color: '#0f172a',
              margin: '2px 0 4px 0',
              lineHeight: 1.2,
            }}
          >
            {titulo}
          </h1>
          {subtitulo && (
            <p style={{ fontSize: 12, color: '#64748b', margin: 0 }}>{subtitulo}</p>
          )}
        </div>
      </header>

      {/* Filtros aplicados como chips */}
      {filtros.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
          {filtros.map((f, i) => (
            <span
              key={i}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                padding: '4px 10px',
                fontSize: 11,
                backgroundColor: '#f1f5f9',
                color: '#0f172a',
                borderRadius: 999,
                border: '1px solid #e2e8f0',
              }}
            >
              <span style={{ color: '#64748b' }}>{f.label}:</span>
              <span style={{ fontWeight: 600 }}>{f.value}</span>
            </span>
          ))}
        </div>
      )}

      {/* KPI strip */}
      {kpis.length > 0 && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${Math.min(kpis.length, 4)}, 1fr)`,
            gap: 8,
            marginBottom: 18,
          }}
        >
          {kpis.map((k, i) => {
            const tone = TONE_COLORS[k.tone ?? 'ink'];
            return (
              <div
                key={i}
                style={{
                  padding: '10px 14px',
                  borderRadius: 10,
                  border: '1px solid #e2e8f0',
                  backgroundColor: tone.bg,
                }}
              >
                <p
                  style={{
                    fontSize: 10,
                    fontWeight: 600,
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                    color: '#64748b',
                    margin: 0,
                  }}
                >
                  {k.label}
                </p>
                <p
                  style={{
                    fontSize: 18,
                    fontWeight: 700,
                    color: tone.text,
                    margin: '2px 0 0 0',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {k.value}
                </p>
              </div>
            );
          })}
        </div>
      )}

      {/* Tabla */}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontSize: 11,
          }}
        >
          <thead>
            <tr style={{ backgroundColor: '#0f172a', color: '#ffffff' }}>
              {columns.map((c, i) => (
                <th
                  key={i}
                  style={{
                    textAlign: c.align ?? 'left',
                    padding: '8px 10px',
                    fontWeight: 600,
                    fontSize: 10,
                    letterSpacing: '0.04em',
                    textTransform: 'uppercase',
                    width: c.width,
                  }}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr
                key={i}
                style={{
                  backgroundColor: i % 2 === 0 ? '#ffffff' : '#f8fafc',
                  borderBottom: '1px solid #e2e8f0',
                }}
              >
                {columns.map((c, j) => {
                  const val = c.format
                    ? c.format(row)
                    : String((row as Record<string, unknown>)[c.key as string] ?? '');
                  return (
                    <td
                      key={j}
                      style={{
                        textAlign: c.align ?? 'left',
                        padding: '7px 10px',
                        fontVariantNumeric: c.align === 'right' ? 'tabular-nums' : 'normal',
                        color: '#0f172a',
                      }}
                    >
                      {val}
                    </td>
                  );
                })}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={columns.length}
                  style={{
                    padding: 30,
                    textAlign: 'center',
                    color: '#94a3b8',
                    fontStyle: 'italic',
                  }}
                >
                  No hay datos para mostrar con los filtros aplicados.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Footer */}
      <footer
        style={{
          marginTop: 'auto',
          paddingTop: 14,
          borderTop: '1px solid #e2e8f0',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: 10,
          color: '#94a3b8',
        }}
      >
        <p style={{ margin: 0 }}>
          Generado por <span style={{ fontWeight: 600, color: '#0e9bc8' }}>Gestión Global</span>
          {' · '}gestionglobal.ar
          {' · '}
          {fechaGeneracion.toLocaleString('es-AR', {
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit',
          })}
        </p>
        <p style={{ margin: 0, fontVariantNumeric: 'tabular-nums' }}>
          Página {pagina} de {totalPaginas}
        </p>
      </footer>
    </div>
  );
}
