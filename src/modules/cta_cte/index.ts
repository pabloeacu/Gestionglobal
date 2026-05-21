// Subsistema · Cuenta Corriente (gerencia).
//
// Construido sobre las RPCs de migración 0031:
//   - cuenta_corriente_resumen / extracto / morosos / resumen_global
// Reusa el drawer de facturación para registrar cobranzas
// (`RegistrarCobranzaDrawer`).
//
// Para activar el módulo en App.tsx (cuando se quite el `disabled: true`
// del sidebar de gerencia):
//
//   import { CtaCteListPage, CtaCteDetailPage } from '@/modules/cta_cte';
//   <Route path="cuenta-corriente" element={<CtaCteListPage />} />
//   <Route path="cuenta-corriente/:adminId" element={<CtaCteDetailPage />} />
//
// Para enchufar en GerenciaHome (regla 13):
//   import { MorososWidget } from '@/modules/cta_cte';
//   <section><MorososWidget limit={5} /></section>

export { CtaCteListPage } from './pages/CtaCteListPage';
export { CtaCteDetailPage } from './pages/CtaCteDetailPage';
export { MorososWidget } from './components/MorososWidget';
export { KpiStripCtaCte } from './components/KpiStripCtaCte';
export { ExtractoTable } from './components/ExtractoTable';
