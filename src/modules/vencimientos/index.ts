// Subsistema 9 (Documento Maestro): Datos estratégicos y vencimientos.
// Lo que diferencia a Gestión Global vs MANAXER (allá no existía).
//
// Páginas:
//   - VencimientosListPage      → /gerencia/vencimientos
//   - VencimientosConfigPage    → /gerencia/vencimientos/configuracion
//
// Widget standalone para incrustar en dashboards:
//   - ProximosVencimientosWidget
//
// Componentes:
//   - VencimientoFormDrawer  (alta y edición)
//   - VencimientoCard        (card premium para listas)
//   - RenovarModal           (renovación con date picker)

export { VencimientosListPage } from './pages/VencimientosListPage';
export { VencimientosConfigPage } from './pages/VencimientosConfigPage';
export { ProximosVencimientosWidget } from './components/ProximosVencimientosWidget';
export { VencimientoFormDrawer } from './components/VencimientoFormDrawer';
export { VencimientoCard } from './components/VencimientoCard';
export { RenovarModal } from './components/RenovarModal';
