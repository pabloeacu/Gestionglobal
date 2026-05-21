// ============================================================================
// Subsistema Reportes + Importador.
//
// Páginas:
//   - ReportesHubPage   → /gerencia/reportes
//   - ImportadorPage    → /gerencia/reportes/importador
//
// Componentes reusables:
//   - ReporteDrawer       (drawer con filtros + export PDF/Excel)
//   - KpiPreviewStrip     (vista previa de KPIs antes de exportar)
//
// Generadores (cliente · sin BD):
//   - generateComprobantesReportePdf / Xlsx
//   - generateCtaCteReportePdf / Xlsx
//   - generateRecuperoReportePdf
//   - generateTabuladorXlsx
// ============================================================================

export { ReportesHubPage } from './pages/ReportesHubPage';
export { ImportadorPage } from './pages/ImportadorPage';
export { ReporteDrawer, type ReporteTipo } from './components/ReporteDrawer';
export { KpiPreviewStrip, type KpiItem } from './components/KpiPreviewStrip';
