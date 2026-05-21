# ERRORES.md — Plataforma Gestión Global

> Bitácora viva (regla 9 / D10). Todo bug que cueste >30 min se documenta acá,
> el mismo día. Formato por entrada. Los E## históricos heredados de MANAXER
> están en `05_REGLAS_ERRORES_DECISIONES.md` §2 — no se recopian; acá van los
> NUEVOS de este proyecto.

<!--
## E## · Título corto
- **Síntoma:**
- **Causa raíz:**
- **Fix:**
- **Prevención:**
- **Fecha / módulo:**
-->

## E-GG-01 · Wizard de activación lleva al detalle viejo (`tramites/:id` vs `trackings/:id`)
- **Síntoma:** al activar una solicitud, `WizardActivacion.handleActivar`
  navegaba a `/gerencia/tramites/${trackingId}`. Esa ruta resuelve a
  `TramiteDetailPage` (módulo legacy pre-Ronda 5) en lugar de
  `TrackingDetailPage` (subsistema nuevo). El gerente termina en la
  pantalla vieja, sin acceso al cierre de ciclo, alarmas configurables ni
  recurrencia introducidos en la Ronda 6 (DGG-07).
- **Causa raíz:** dos rutas en `App.tsx` coexistían — `/gerencia/tramites/:id`
  (legacy) y `/gerencia/trackings/:id` (nueva). Los componentes nuevos
  apuntaban a la primera "por costumbre / copy-paste". Faltaba decisión de
  cuál es el camino canónico.
- **Fix:** (a) Unifiqué todos los `navigate(...)` y `<Link to=...>` nuevos
  para que apunten a `/gerencia/trackings/:id` (`WizardActivacion`,
  `SolicitudDetailPage`, `RecurrenciaList`). (b) Reemplacé el componente
  asociado a `/gerencia/tramites/:id` por un `TramiteLegacyRedirect` que
  hace `<Navigate to="/gerencia/trackings/:id" replace />`, así también los
  links del listado/kanban viejo y bookmarks históricos caen en la pantalla
  nueva. `TramiteDetailPage` queda en el repo como archivo pero ya no se
  renderiza desde el router.
- **Prevención:** en futuras refactorizaciones de módulos heredados, si una
  ruta vieja queda "para no romper links", redirigir a la nueva con
  `Navigate replace` en lugar de mantener un componente fantasma que
  alguien podría volver a usar por accidente. Citar la decisión acá y en
  `PROJECT_STATUS.md`.
- **Fecha / módulo:** 2026-05-21 · solicitudes / trackings (pase rápido
  Punto 5 — propuesta 7.A).
