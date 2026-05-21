# DECISIONES.md — Plataforma Gestión Global

> Registro de decisiones de arquitectura (D## / D10 — desde el día 1). Las
> D## fundacionales heredadas de MANAXER están en
> `05_REGLAS_ERRORES_DECISIONES.md` §3. Acá van las decisiones propias de
> Gestión Global.

<!--
## D## · Título
- **Decisión:**
- **Razón:**
- **Alternativas descartadas:**
- **Fecha:**
-->

## DGG-01 · Single-tenant (sin tabla empresas)
- **Decisión:** La plataforma gestiona únicamente Gestión Global. No hay tabla
  `empresas` ni `empresa_id`. Configuración global en fila singleton
  `config_global`.
- **Razón:** Requerimiento explícito del usuario (2026-05-19): no será
  multiempresa.
- **Adaptación:** El guard de regla 12 / E45 / E49 se reorienta al eje
  `administracion` (portal de clientes): `assert_administracion_access`.
- **Fecha:** 2026-05-19

## DGG-02 · Orden de construcción
- **Decisión:** Fase 1 = núcleo cliente + facturación + cuenta corriente
  (orden probado MANAXER 00 §8). Landing/formularios/trámites/campus en fases
  siguientes.
- **Razón:** Valor operativo y de cobro primero.
- **Fecha:** 2026-05-19

## DGG-03 · ARCA self-service desde el día 1
- **Decisión:** Wizard de vinculación ARCA (CSR → cert → test) + comprobantes
  simples disponibles desde el arranque. ARCA es plugin (P-ARCA-04).
- **Razón:** Gestión Global no tiene certificados; el sistema debe producir
  todo lo necesario para obtenerlos, como MANAXER.
- **Fecha:** 2026-05-19

## DGG-04 · Administración Global = servicio del catálogo
- **Decisión:** "Administración Global" es un servicio más (precio por unidad
  funcional), integrado al mismo flujo de comprobantes/cta. cte. No es una
  rama separada ni se construye ahora el producto SaaS de expensas.
- **Razón:** Requerimiento del usuario (2026-05-19).
- **Fecha:** 2026-05-19

## DGG-05 · Agenda con patrón MDC (Ronda 5.5)
- **Decisión:** Adoptar el patrón MDC en su totalidad
  (`/Users/paulair/Desktop/MDC Plataforma/mdc-platform/AGENDA_GERENCIAL_HANDOFF.md`):
  4 tablas (`agenda_categories`, `agenda_events`, `agenda_event_overrides`,
  `agenda_reminders_log`), recurrencia virtual con overrides, parser NL
  rioplatense, cadencia humana de recordatorios (inicial → re-alerta 5h →
  cierre 20:00 → atrasados 09:00-09:20).
- **Descartado:** recordatorios configurables tipo Google/Apple para eventos
  personales (ruido innecesario por experiencia MDC). EXCEPCIÓN: vencimientos
  sí los tienen (DGG-07) — son obligaciones legales con cliente externo.
- **Razón:** El patrón MDC está en producción y capitaliza 14 lecciones
  (E1-E14) de uso real. Reescribirlo de cero sería pagar las mismas curvas.
- **Fecha:** 2026-05-21

## DGG-06 · Unificación temporal "proyección, no duplicación" (Ronda 6)
- **Decisión:** La Agenda se vuelve el hub único de todo lo que tiene fecha.
  Cada módulo (vencimientos, trámites, comprobantes, solicitudes) sigue
  siendo dueño de sus datos y workflows; la Agenda los proyecta vía VIEW
  `vw_agenda_unificada`. Eventos proyectados son read-only desde Agenda
  (icono `Lock`, color tenue, badge de fuente); click navega al módulo
  origen. Sólo los eventos `personal` son editables full.
- **Filtros:** chips de fuente (`Todo` / `Personal` / `Vencimientos` /
  `Trámites` / `Cobranzas` / `Solicitudes`) con persistencia en localStorage.
- **Razón:** El usuario explicitó que la integración orgánica del flujo es
  uno de los pilares de la "delicia del usuario". Ningún módulo con fechas
  puede vivir aislado. Proyectar (no duplicar) preserva la versatilidad de
  cada módulo origen y elimina drift.
- **Fecha:** 2026-05-21

## DGG-07 · Tracking → vencimiento automático con alarmas configurables (Ronda 6)
- **Decisión:** Al cerrar el ciclo de un servicio en un tracking, se puede
  programar el próximo vencimiento con alarmas **multi-select**: 30 / 15 / 7
  / 2 / 1 / 0 días antes / personalizado. Cada alarma dispara push interno
  para el gerente **+ email automático al cliente administrador** si
  `notificar_cliente = true`.
- **Schema:** `vencimientos.alarmas_offsets integer[] DEFAULT '{30,7,2}'`,
  `vencimientos.notificar_cliente boolean DEFAULT true`,
  `vencimientos.tracking_id uuid`. RPC `tracking_cerrar_ciclo(p_tracking_id,
  p_proxima_fecha, p_alarmas_offsets[], p_notificar_cliente)`. RPC
  `gg_vencimientos_planificar_alertas(fecha)` que el cron consume.
- **Razón:** Requisito explícito del usuario. Es un punto de "delicia
  premium" — el cliente recibe avisos en cadencia esperada, el gerente no
  se olvida, todo automatizado desde una sola acción.
- **Excepción a DGG-05:** las alarmas configurables (descartadas para
  eventos personales) sí aplican acá porque (a) son obligaciones legales
  con consecuencias para el cliente, (b) el cliente externo espera el aviso
  en plazos estándar de la industria.
- **Fecha:** 2026-05-21

## DGG-08 · Sin Vencimientos en sidebar (Ronda 6)
- **Decisión:** La entrada `Vencimientos` se quita del sidebar de gerencia.
  Vencimientos vive como **tab dentro de Agenda** + ruta deep-link
  `/gerencia/agenda/vencimientos`. La ruta antigua `/gerencia/vencimientos`
  se mantiene por compat de links contextuales.
- **Razón:** Unificar el flujo temporal (DGG-06), reducir cantidad de
  menús, mantener todo lo que tiene fecha bajo un solo techo. Mejora la
  ergonomía mental del gerente.
- **Fecha:** 2026-05-21

## DGG-09 · Registro vivo de continuidad (PROJECT_STATUS.md)
- **Decisión:** Mantener `PROJECT_STATUS.md` en raíz como archivo vivo de
  estado de sesión a sesión. Se actualiza después de cada chunk verificado
  y cerrado. Toda sesión nueva debe leerlo PRIMERO. Adicionalmente,
  `BACKLOG.md` para plan/rondas, este archivo para decisiones, y
  `ERRORES.md` para bugs >30 min.
- **Razón:** Las sesiones pueden romperse y la continuidad debe sobrevivir.
  La plataforma es ambiciosa, ningún dato/elemento puede pasar desapercibido.
- **Fecha:** 2026-05-21
