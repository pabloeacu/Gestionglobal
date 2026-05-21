// Subsistema: Centro de Solicitudes + Wizard Operativo de Activación.
// Cita Doc "Flujo Maestro" §1-8. Wirea en App.tsx el parent agent:
//
//   <Route path="solicitudes" element={<SolicitudesListPage />} />
//   <Route path="solicitudes/:id" element={<SolicitudDetailPage />} />

export { SolicitudesListPage } from './pages/SolicitudesListPage';
export { SolicitudDetailPage } from './pages/SolicitudDetailPage';
export { WizardActivacion } from './components/WizardActivacion';
export { SolicitudCard } from './components/SolicitudCard';
