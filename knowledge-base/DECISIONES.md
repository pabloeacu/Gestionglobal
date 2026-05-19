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
