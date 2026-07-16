// Subsistema 7 (Documento Maestro): Campus virtual.
//
// Páginas (listas para cablear en App.tsx — no tocamos App.tsx en este commit):
//
//   <Route element={<Protected allow={['gerente','operador']}><GerenciaLayout/></Protected>} path="/gerencia">
//     <Route path="campus" element={<CampusListPage />} />
//     <Route path="campus/:id" element={<CursoEditorPage />} />
//   </Route>
//
//   <Route element={<Protected allow={['administrador']}><PortalLayout/></Protected>} path="/portal">
//     <Route path="campus" element={<MisCursosPage />} />
//     <Route path="campus/:slug" element={<CursoDetalleAlumnoPage />} />
//   </Route>

export { CampusListPage } from './pages/CampusListPage';
export { CursoEditorPage } from './pages/CursoEditorPage';
export { CursoDetalleAlumnoPage } from './pages/CursoDetalleAlumnoPage';
export { MisCursosPage } from './pages/MisCursosPage';
export { VerificarCertificadoPage } from './pages/VerificarCertificadoPage';
export { CertificadoSandboxPage } from './pages/CertificadoSandboxPage';
export { CertificadoPlantillasPage } from './pages/CertificadoPlantillasPage';
export { ConstanciaPlantillasPage } from './pages/ConstanciaPlantillasPage';

export { CursoCard } from './components/CursoCard';
export { ClasePlayer } from './components/ClasePlayer';
export { ExamenRunner } from './components/ExamenRunner';
export { ExamenEditor } from './components/ExamenEditor';
export { ProgresoBar } from './components/ProgresoBar';
