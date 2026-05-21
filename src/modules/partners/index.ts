// Subsistema 6 (Documento Maestro): Partners + rendiciones.
//
// Páginas (listas para que App.tsx las cablee):
//   <Route path="partners" element={<PartnersListPage />} />
//   <Route path="partners/:id" element={<PartnerDetailPage />} />
//   <Route path="partners/:partnerId/rendiciones/:id" element={<RendicionDetailPage />} />

export { PartnersListPage } from './pages/PartnersListPage';
export { PartnerDetailPage } from './pages/PartnerDetailPage';
export { RendicionDetailPage } from './pages/RendicionDetailPage';

export { PartnerFormDrawer } from './components/PartnerFormDrawer';
export { ConvenioDrawer } from './components/ConvenioDrawer';
export { NuevaRendicionModal } from './components/NuevaRendicionModal';
export { RendicionResumenCard } from './components/RendicionResumenCard';
