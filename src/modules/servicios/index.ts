// Subsistema 3 + 5 · Catálogo de servicios + Tabulador de costos.
// Listo para que `App.tsx` agregue:
//   <Route path="servicios" element={<ServiciosListPage />} />
//   <Route path="servicios/:id" element={<ServicioDetailPage />} />
// y para que el sidebar de gerencia incluya un link al listado.
export { ServiciosListPage } from './pages/ServiciosListPage';
export { ServicioDetailPage } from './pages/ServicioDetailPage';
export { ServicioFormDrawer } from './components/ServicioFormDrawer';
export { PrecioDrawer } from './components/PrecioDrawer';
export { AjusteMasivoModal } from './components/AjusteMasivoModal';
