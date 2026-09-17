# INFORME DE AUDITORÍA ARQUITECTÓNICA INTEGRAL — Plataforma Gestión Global

**Fecha:** 2026-09-12 · **Modalidad:** diagnóstico read-only (cero mutaciones, cero código, cero migraciones) · **Alcance:** transversal, 12 dominios.
**Método:** relevamiento cuantitativo del repo + BD viva + advisors de Supabase; 12 auditores especializados en paralelo; **verificación adversarial** de cada hallazgo CRÍTICO/ALTO (29 verificados, 29 confirmados, 0 descartados); síntesis transversal; y **4 verificaciones en vivo propias** de los hallazgos flagship (policies+grants de `profiles`, ausencia de trigger bloqueante, superficie SECURITY DEFINER, estado de las 9 RPCs sensibles).
**Magnitud auditada:** ~136K LOC front (TS/TSX) · ~69K LOC SQL (466 migraciones) · ~10K LOC edge (48 functions) · 123 tablas (100% con RLS, 237 policies) · 379 funciones public (345 SECURITY DEFINER) · 141 triggers · 22 cron jobs · 28 módulos · 56 servicios de API.

---

> ## ✅ ESTADO A 2026-09-17 — LA ALERTA DE APERTURA ESTÁ NEUTRALIZADA (re-certificado en vivo)
> **Las DOS vías de compromiso total ya NO existen.** Certificación adversarial multi-agente contra la
> base viva (DGG-190, 4 agentes / 102 tool-uses read-only):
> - **C1 (auto-escalada de rol) → CERRADO (alta confianza).** Triple defensa verificada: grant columnar
>   (`authenticated` sólo UPDATE de `avatar_url/full_name/phone`, `has_column_privilege` en vivo = false
>   para role/administracion_id/partner_id) + trigger `private.profiles_guard_privilegios` (RAISE 42501) +
>   auditoría. Se enumeró el conjunto COMPLETO de funciones que escriben `profiles` (6 + `handle_new_user`):
>   todas staff-gated o self-scope no-sensible. 0 bypasses.
> - **C2 (`alta-cliente-portal`) → CERRADO (alta confianza).** v11 con auth-gate real (service_role o JWT
>   staff ∈{gerente,operador} → 403) + 409 anti-secuestro. La anon key ya no pasa. 0 vías laterales de
>   creación/vínculo de cuentas alcanzables por no-staff.
> - **T1 (clase SECURITY DEFINER sin guard) → sin exploit urgente.** 154 escrituras auth-reachable barridas:
>   0 cross-tenant sin guard. El WARN de advisors persiste por ser técnicamente secdef+grant, pero cada fn
>   tiene guard correcto (`is_staff`/`assert_administracion_access`/self-scope). `zz-wipe-storage-oneshot`
>   RETIRADA. RLS InitPlan (T7) YA envuelto (advisor `auth_rls_initplan` = 0).
>
> **% de hardening del audit efectivamente resuelto/neutralizado ≈ 85%** (los 2 CRÍTICOS + 6/9 ALTOS cerrados;
> restan 3 ALTOS supervisados: rotar valor de `CRON_SECRET`, barrido T1 de REVOKE, timeouts del resto de
> integraciones). Lo que falta es defensa-en-profundidad e higiene, NO vías explotables abiertas. Detalle y
> evidencia: DGG-190 en `DECISIONES.md`. **Todo lo que sigue debajo es el diagnóstico ORIGINAL del 2026-09-12
> — leerlo con este encabezado en mente: los ítems marcados CRÍTICO ya están cerrados.**

## ⚠️ ALERTA DE APERTURA — DOS VÍAS DE COMPROMISO TOTAL, VIVAS EN PRODUCCIÓN HOY *(← histórico 2026-09-12; NEUTRALIZADO, ver encabezado ✅ arriba)*

La auditoría encontró **dos vulnerabilidades críticas explotables en este momento** por cualquier usuario con una cuenta (o incluso con la anon key pública que viaja en el bundle). No son teóricas: ambas fueron **confirmadas contra la base viva**. Respetando tu instrucción de **solo diagnóstico, no las toqué**. Cada fix es de **una línea, quirúrgico y reversible**; puedo aplicarlos apenas lo autorices.

1. **Auto-escalada de rol a gerente en una sola llamada.** `authenticated` tiene `UPDATE` sobre la columna `role` de `public.profiles`, y la única policy de UPDATE (`profiles_update_self`) solo valida `id = auth.uid()` sin restringir columnas. Cualquier cliente/alumno/partner logueado puede ejecutar `supabase.from('profiles').update({role:'gerente'}).eq('id', <su id>)` y volverse staff → acceso total a los datos de los 79 clientes. **Verificado por mí en vivo.**
2. **`alta-cliente-portal` abierta a internet.** Deployada con `verify_jwt=false` y su único control es "el bearer mide ≥20 chars" → la anon key pública lo pasa. Con service_role crea cuentas `role=administrador` apuntadas a **cualquier** `administracion_id` y manda la contraseña por mail → toma de control cross-tenant.

> **Recomendación:** autorizar el **P0 de seguridad** (5 statements, ver §9/§10) antes que cualquier otra cosa. Todo lo demás del informe es importante pero no es "explotable hoy".

---

## Scorecard de salud (1–10)

| Dimensión | Nota | Síntesis en una frase |
|---|---|---|
| **Arquitectura** | **7/10** | Capas limpias, RPC-first, R4 casi perfecta; lastrada por god-objects, la migración `trámite→tracking` inconclusa y la ausencia total de red automatizada. |
| **Seguridad** | **4/10** | Cimientos correctos (RLS 100%, token-capability ejemplar, sin secretos en front) **pero ≥2 vías de compromiso total confirmadas hoy** + una clase sistémica de ~29 RPCs sin guard. La dimensión más urgente. |
| **Integridad de datos** | **7/10** | Núcleo financiero verificado sano en vivo (0 drift de saldos/emails/RPAC, buen `FOR UPDATE`); pero el pago de campus no tiene fuente única, faltan idempotencia y optimistic-locking, y la deuda neta se replica en 5 superficies. |
| **Escalabilidad** | **6/10** | Sobra para el volumen actual; el techo real es la evaluación de RLS por-fila sobre `profiles`, el bloat de `pg_net` y los límites de conexión/email a 10x. |
| **Observabilidad** | **5/10** | Herramientas por encima del promedio pero fragmentadas y con "falso verde": auditoría dividida que excluye finanzas, crons que reportan OK sobre 401/500, cambios de rol/fiscales sin registrar. |
| **Mantenibilidad** | **6/10** | Disciplina documental excepcional (20 reglas capitalizadas, DGG/E-GG, doble auditoría §6) que compensa mucho; pero sin tests ni CI la única red es humana. |

**Conteo de hallazgos:** 101 totales → **CRÍTICO 2 distintos** (3 registros, deduplicados) · **ALTO ~9 distintos** · **MEDIO 51** · **MEJORA 21**.

---

## 1. Diagnóstico general de salud

La plataforma es, en su forma, **notablemente sólida y disciplinada** para su tamaño: arquitectura en capas limpias (componentes → `src/services/api` → RPC/PostgREST → Postgres) con adherencia casi perfecta a las reglas del contrato (R4: 0 `supabase.from()` en componentes; R13: 0 diálogos nativos; R16: 0 overloads ambiguos; RLS al 100%). El **núcleo financiero está verificado sano en vivo** (0 drift entre `comprobantes.saldo_pendiente` y `total − Σimputaciones`, 0 divergencias de email canónico↔snapshot, montos siempre `numeric` y NOT NULL, `FOR UPDATE` en los caminos de dinero). Hay una **cultura de calidad real**: cada incidente se capitaliza en una regla verificable (R16–R20 nacieron de bugs de producción) y existe un ritual de doble auditoría.

El problema es que esa calidad **descansa en dos redes puramente humanas**: (a) no hay tests ni CI, así que toda regresión se descubre en producción; y (b) el aislamiento entre clientes (single-tenant lógico) no vive en un modelo de permisos, sino en el *guard* que cada una de ~300 funciones recuerde poner. Donde esas redes humanas fallaron, aparecen los agujeros más graves — incluyendo las dos vías de compromiso total de la apertura.

**Veredicto de salud:** es una base **por encima del promedio** con una **superficie de seguridad de autorización peligrosamente ancha** y un **déficit estructural de automatización de QA**. No está "en llamas" (funciona, el dinero cuadra), pero hoy es **una persona curiosa a una llamada de API de un breach total**. Cerrado el P0, pasa a ser una plataforma sólida y confiable.

---

## 2. Mapa de riesgos principales

```
                 IMPACTO →
   ALTO │  (A1) 29 RPCs sin guard      │  (C1) Auto-escalada de rol
        │  (A2) CRON_SECRET en git     │  (C2) alta-cliente-portal abierta
        │  (M) idempotencia dinero     │  (A5) auditoría no cubre finanzas
        │  (M) campus estado_pago SSOT │
   ─────┼──────────────────────────────┼──────────────────────────────
   MEDIO│  (A3) sin tests/CI           │  (A6) cron falso-verde/401
        │  (A4) integraciones sin TO   │  (M) auth refresh manual SPOF
        │  (T7) RLS por-fila (escala)  │  (A7) deep-link salud roto
        │  (M) net._http_response bloat│  (M) drift R7 / wipe-storage
        └──────────────────────────────┴──────────────────────────────
             LATENTE / A ESCALA              INMEDIATO / EXPLOTABLE HOY
```

**Los 8 temas transversales** (cruzan varias capas — se atacan como *clase*, no hallazgo por hallazgo):

- **T1 — Autorización-por-grant.** El default ACL de Supabase da `EXECUTE` a `anon`/`authenticated` sobre TODA función `public`; el aislamiento cuelga del guard interno de cada RPC. 273 SECURITY DEFINER ejecutables por authenticated, 24 por anon, **29 sin guard** (18 alcanzables por anon). Raíz de casi todo el bloque crítico de seguridad.
- **T2 — El invariante de negocio vive fuera de la BD** (en el front, en un grant demasiado ancho, o en ningún lado). Peor caso: la auto-escalada de rol (C1). Familia: DV de CUIT solo en front, override "cerrar sin cobrar" por regex, gate de deuda en el cliente.
- **T3 — Migración `trámite`→`tracking` inconclusa.** Dos módulos + dos servicios sobre la **misma tabla** `tramites`, dos vocabularios → es la raíz del clúster de incoherencias de UX (cerrar/reabrir/deuda se comportan distinto por superficie).
- **T4 — Cero tests + cero CI + push-a-main = deploy a prod** sobre lógica plpgsql compilada en runtime. Origen del patrón "bugs en prod por usuarios reales". Faceta de secretos: `CRON_SECRET` commiteado.
- **T5 — Lógica canónica que existe pero se abandona (SSO por deserción).** `useRefreshableData` (0 usos) vs ~74 `load()` caseros; `cliente_deuda_neta` canónico vs deuda recalculada en 5 superficies; transporte de email central vs 5 edge fns que lo saltean.
- **T6 — Observabilidad fragmentada y "falso verde".** Dos sistemas de auditoría; `pg_cron` marca OK sobre 401/500; cambios de rol/fiscales sin auditar.
- **T7 — El techo de escala es la evaluación de RLS por-fila,** no el volumen (163/237 policies con `is_staff()`/`auth.uid()` sin envolver → `profiles` = objeto más escaneado, ~16M scans).
- **T8 — Integraciones sin timeout y webhooks fail-open** (salvo TRAMIX, ejemplar).

---

## 3. Inconsistencias arquitectónicas encontradas

1. **`trámite` vs `tracking` (dominio dual).** `src/modules/tramites` + `src/modules/trackings`, `tramites.ts` + `trackings.ts`, sobre `public.tramites`. Consecuencia funcional real: la acción "cerrar/reabrir" y el gate de deuda difieren entre kanban, lista, detalle y moderación (5 hallazgos de UX colapsan acá).
2. **God-objects.** `src/services/api/campus.ts` (3.011 líneas), `TrackingDetailPage.tsx` (2.162 líneas, 37 `useState`). Difíciles de testear/evolucionar.
3. **Refresh de sesión reimplementado a mano** (677 líneas en `AuthContext`) reemplazando el mecanismo de la librería — SPOF de auth de los 3 planos con historial de incidentes (E-GG-07/144/155).
4. **Drift de infraestructura (R7):** 4 edge functions en prod sin archivo en el repo, una destructiva (`zz-wipe-storage-oneshot`) aún ACTIVE; `verify_jwt` real no versionado en `config.toml`.
5. **Data-fetching manual sin descarte de respuestas obsoletas** en ~74 páginas, con el helper correcto (`useRefreshableData`) escrito pero sin usar.

---

## 4. Fuentes de verdad y duplicación de lógica

Ordenadas por radio de daño (la #1 viola directamente tu mandato "el mismo número en todas las superficies"):

| # | Concepto sin fuente única | Dónde se duplica | Por qué duele |
|---|---|---|---|
| 1 | **Deuda/saldo del cliente** | `cliente_deuda_neta` (canónico) vs `administraciones_con_deuda`, `cuenta_corriente_morosos`, `cuenta_corriente_resumen`, `ctaCte.getResumenGlobal`, `getPortalDashboard` (muerto, recalcula **bruta** → reintroduce E-GG-120 si se reusa) | Es el número que ve el cliente; consistencia contable |
| 2 | **`estado_pago` de matrícula de campus** | Flag heurístico (un solo pago, sin acumular) desacoplado del dinero; `movimientos` sin `matricula_id` | Único concepto de dinero SIN fuente única real |
| 3 | **Comprobante del trámite** | `tramites.comprobante_id` (columna **muerta**, 115/115 NULL) vs `solicitudes.comprobante_id` (115/115) | Link "Ver comprobante" roto en el camino feliz |
| 4 | **Auditoría** | `audit_log` (`_audit_log_trg`) + `auditoria_cambios` (`audit_row`) — doble escritura en 7 tablas; la UI no cubre finanzas | Forense financiero solo por SQL crudo |
| 5 | **IVA** | preview en front vs cálculo autoritativo en `emitir_comprobante_manual` | Bajo grado (la RPC recalcula) pero divergencia latente |
| 6 | **Email del cliente** | `administracion_emails` (0 filas / 107 admins, tabla dormida) vs `administraciones.email` | Modelo muerto que confunde |
| 7 | **Etiqueta/color de estado del trámite** | `TRAMITE_ESTADO_LABEL` vs `tracking_estados_config` (el detalle muestra el slug crudo) | Cosmético, 100% de las fichas |
| 8 | **DV de CUIT** (mód 11) | solo en el front; el backend y el importador aceptan 11 dígitos cualquiera | Datos fiscales inválidos por el importador |

---

## 5. Evaluación de seguridad · **4/10** — la más urgente

Cimientos correctos: RLS al 100%, patrón token-capability implementado con rigor (gestor_*, accesos externos), buckets sensibles privados, edge fns de staff bien gateadas (`crear-gerente`, `blanquear-password`), sin secretos en el front. El talón de Aquiles es **T1 (autorización-por-grant)**: el aislamiento depende del guard interno de cada RPC, y varios quedaron sin guard o con REVOKE incompleto (olvidan `authenticated`).

Ver hallazgos **C1, C2, A1, A2** en §13.

---

## 6. Evaluación de base de datos e integridad · **7/10**

Modelo sano y con disciplina superior: 100% RLS, montos `numeric` NOT NULL, grafo de FKs con `ON DELETE` deliberado (RESTRICT en dinero, CASCADE en hijos, SET NULL en actores), R16 limpio, E-GG-195 sostenido. **Integridad financiera verificada en vivo: 0 drift.** Latentes: pago de campus sin fuente única (§4 #2), falta de idempotencia server-side y de optimistic-locking, columna muerta `tramites.comprobante_id`, `administracion_emails` dormida, 4 FKs sin índice. Ver **M-INTEG** en §13.

---

## 7. Evaluación de rendimiento y escalabilidad · **6/10**

Bueno para el volumen actual (~79 clientes, 114 trámites, colas en miles) y sin cliffs a 10x: indexado deliberado (parciales, compuestos que cubren el ORDER BY), listados de un solo round-trip y paginados. **El techo estructural es RLS por-fila:** 163/237 policies usan `is_staff()`/`auth.uid()` sin envolver en `(select …)` → `profiles` es el objeto más escaneado (~16M scans para ~109 filas). Acompañan el bloat de `net._http_response` (322 MB = 47% de la base) y techos duros (conexiones, 1 mail/min serializado). Clase "aparece a 10x o en un pico". Ver **A-RLS, M-BLOAT** en §13.

---

## 8. Evaluación de observabilidad y capacidad de diagnóstico · **5/10**

Por encima del promedio (un "Sentry casero" en `errores_runtime`, auditoría con diff campo-a-campo, dos health-checks que *ejercitan* flujos, persistencia de error por-item en las colas). Pero **fragmentada y con falso-verde**: dos sistemas de auditoría que se pisan y cuya UI excluye finanzas; `pg_cron` marca `succeeded` aunque la edge devuelva 401/500 (**`notify-vencimientos` 401-eando en silencio con token viejo → 0 avisos históricos**); deep-link de alertas críticas a una ruta inexistente; cambios de rol y de config fiscal **sin auditar**. Ver **A5, A6, A7** en §13.

---

## 9. Plan de estabilización priorizado

### 🔴 P0 — HOY (neutraliza casi todo el bloque crítico; cada uno reversible)
1. **Cerrar la auto-escalada de rol (C1).** `REVOKE UPDATE (role, administracion_id, partner_id) ON public.profiles FROM authenticated` (+ re-GRANT columnar del resto de autoservicio), o `WITH CHECK` que impida cambiar esas columnas.
2. **Cerrar `alta-cliente-portal` (C2):** `verify_jwt=true` + validar rol staff / service_role adentro + rechazar re-vínculo de un `administracion_id` ya asignado.
3. **Barrido de REVOKE sobre la clase T1 (A1):** empezar por `notificar_usuario`, `admin_login_email`, `_comunicacion_resolver_audiencia`, `voucher_incrementar_uso`, las 4 `webex_*`, `reset_arca_jobs_colgados`; luego las 29 completas.
4. **Retirar `zz-wipe-storage-oneshot`** de prod (destructiva, ACTIVE).
5. **Rotar `CRON_SECRET` (A2)** — está en git en claro — coordinado con las ~10 edge functions.

### 🟠 P1 — próximas semanas (integridad + observabilidad)
- Idempotencia server-side en RPCs de dinero (reusar `uq_mov_hash_dedup`, hoy ocioso).
- Unificar la deuda neta en el único helper `cliente_deuda_neta`; retirar `getPortalDashboard` muerto.
- Arreglar el falso-verde de `pg_cron` (heartbeats) + re-alinear/retirar `notify-vencimientos`.
- Auditar `profiles.role` y `config_global` (hoy sin rastro); extender la bitácora a las tablas financieras.
- Deep-link de salud (`salud` → `salud-sistema`) + redirect de compatibilidad.
- Timeouts/AbortController en integraciones (patrón TRAMIX) empezando por ARCA.
- Campus: `movimientos.matricula_id` + `estado_pago` derivado de la suma acumulada (fuente única).

### 🟡 P2 — trimestre (estructura + escala)
- **CI mínimo como gate** (Action con `tsc --noEmit` + `vite build`; luego smoke SQL de R18 sobre las ~30 RPC mutantes; Vitest sobre `lib/` puras).
- Consolidar `tramites`/`trackings` (elimina el clúster de UX).
- Envolver las quals de RLS en `(select …)` (barato, advisor-backed).
- Pruning de `net._http_response` (VACUUM FULL + retención) y política de retención de logs/colas/auditoría.
- Gatear el refresh manual de sesión al entorno DEV (dejar que la librería lo maneje en prod).

---

## 10. Orden recomendado de intervención — y qué NUNCA tocar simultáneamente

**Secuencia:** P0-1 y P0-2 primero (independientes entre sí, se pueden hacer en paralelo). Luego P0-3 (barrido REVOKE) función por función, verificando con `has_function_privilege` que ningún caller de front la use. P0-4 y P0-5 después. Recién con el P0 cerrado, avanzar a P1 y P2.

**Reglas de no-simultaneidad (para no cruzar variables ante un incidente):**
- **Auth (P0-1/P0-2) aislado de todo lo demás.** Nunca mezclar un cambio de permisos/auth con un cambio de RLS o de refactor de sesión en el mismo deploy: si algo desloguea usuarios, tenés que saber cuál fue.
- **RLS-wrapping (P2) y el barrido de REVOKE (P0-3) van en migraciones separadas.** Ambos tocan la superficie de autorización; juntarlos hace imposible bisecar una regresión de acceso.
- **La rotación de `CRON_SECRET` (P0-5) sola,** y verificando cada uno de los ~10 crons post-rotación (un cron con el token viejo empieza a 401 en silencio — ver A6).
- **`VACUUM FULL` de `net._http_response` (P2)** en ventana de bajo tráfico y solo; toma lock exclusivo breve.
- **Nunca combinar** una migración de datos (backfill) con un cambio de esquema en el mismo statement/deploy: aplicar el DDL, verificar, luego el DML.
- **El refactor de sesión (P2)** solo en preview de Vercel primero, jamás directo a main.

---

## 11. Quick wins (bajo riesgo, alto impacto)

| Quick win | Esfuerzo | Riesgo impl. | Impacto |
|---|---|---|---|
| `REVOKE` de `notificar_usuario`/`admin_login_email`/`_comunicacion_resolver_audiencia`/`webex_*` | 1 migración | Muy bajo (sin callers de front) | Cierra phishing + fuga de PII + fraude de asistencia |
| `verify_jwt=true` en `alta-cliente-portal` | 1 flag + config.toml | Bajo | Cierra toma de control cross-tenant |
| `REVOKE UPDATE(role,administracion_id,partner_id)` en `profiles` | 1 migración | Bajo | Cierra la auto-escalada #1 del informe |
| Retirar `zz-wipe-storage-oneshot` + probes del deploy | undeploy | Bajo | Elimina función destructiva viva |
| Deep-link de salud + `<Route path="salud" Navigate>` | 2 líneas | Bajo | La respuesta a incidentes deja de aterrizar en 404 |
| GitHub Action con `npm run build` como status check | 1 día | Nulo (aditivo) | Primera red automatizada; base para el resto |
| Envolver quals RLS en `(select …)` | por policy | Bajo (semántica idéntica) | Baja el costo de RLS a escala |

---

## 12. Estado objetivo de arquitectura

Cuando el proceso termine, la plataforma debería quedar así:

- **Autorización en el modelo, no en el hábito.** Default ACL endurecido (nada de `EXECUTE` a `anon`/`authenticated` por defecto); helpers internos en schema `private` (no expuesto por PostgREST); cada RPC pública con GRANT explícito y guard verificado por un smoke de cierre. El invariante "el rol solo lo cambia gerencia" vive en la BD (WITH CHECK/trigger), no en el front.
- **Una sola fuente de verdad por concepto,** empezando por la deuda neta y el pago de campus, con las superficies leyendo del mismo helper.
- **Un solo dominio `trámite`** (consolidado `tramites`/`trackings`), con cierre/reapertura/gate-de-deuda idénticos en toda superficie.
- **Red automatizada:** CI que corre tipos + build + smoke SQL de las RPC mutantes en cada PR; preview obligatorio; el ritual §6 pasa de "memoria humana" a "gate de merge".
- **Observabilidad convergente:** una bitácora que cubre finanzas, crons con heartbeat real (nada de falso-verde), y auditoría de los cambios sensibles (rol, config fiscal).
- **Integraciones con timeout y webhooks con firma verificada;** RPCs de dinero idempotentes.
- **Escala desacoplada del volumen:** RLS en InitPlan, colas/logs con retención acotada, límites de conexión/email dimensionados.
- **Sin drift:** todo lo que corre en prod existe en el repo (`config.toml` como fuente de verdad de `verify_jwt`).

---

## 13. Hallazgos detallados (Hallazgo → Riesgo → Impacto → Causa → Propuesta → Prioridad → Riesgo de implementación)

### 🔴 CRÍTICO

**C1 · Auto-escalada de privilegios: cualquier autenticado se hace gerente vía UPDATE de `profiles.role`** *(authz · SSO)*
- **Hallazgo:** `authenticated` tiene `UPDATE` a nivel tabla y columna sobre `role`, `administracion_id`, `partner_id` de `public.profiles`; la única policy de UPDATE (`profiles_update_self`) es `USING/WITH CHECK (id = auth.uid())` sin restringir columnas; no hay trigger guard. **Confirmado en vivo.**
- **Riesgo/Impacto:** una sola llamada PostgREST (`update profiles set role='gerente' where id=<self>`) convierte a cualquier cliente/alumno/partner en staff → `is_staff()`=true y `assert_administracion_access()` lo deja pasar para TODA administración: lectura/mutación total de datos de los 79 clientes (finanzas, PII, trámites).
- **Causa probable:** `GRANT UPDATE ON profiles TO authenticated` a nivel tabla (patrón R6 sin acotar columnas), delegando el control de columnas sensibles al front.
- **Propuesta:** `REVOKE UPDATE ON public.profiles FROM authenticated` + `GRANT UPDATE (full_name, phone, avatar_url, onboarding_checklist, pwa_installed_at, pwa_last_seen_at) ON public.profiles TO authenticated` (whitelist de autoservicio). Alternativa: `WITH CHECK` que fije `role/administracion_id/partner_id` iguales a los actuales.
- **Prioridad:** Inmediata (P0). **Riesgo impl.:** Bajo — el cliente ya solo escribe columnas de autoservicio; único cuidado: incluir en el GRANT las columnas `pwa_*`/`onboarding` que sí escribe.

**C2 · `alta-cliente-portal`: toma de control cross-tenant con la anon key pública** *(seguridad+authz · SSO)*
- **Hallazgo:** edge fn deployada con `verify_jwt=false` (confirmado en `list_edge_functions`, v8), único control `if (bearerToken.length < 20) return 401`. Con service_role crea `auth.user` con `role='administrador'`, upsert de `profiles.administracion_id`, sobrescribe `administraciones.user_id` y encola el password temporal por mail.
- **Riesgo/Impacto:** cualquiera con la anon key (pública, en el bundle) POSTea con `{administracion_id:<víctima>, email:<atacante>}` → obtiene cuenta `administrador` del tenant víctima y recibe el password → entra al portal y ve deuda/trámites/comprobantes/PII; además puede hijackear una administración ya vinculada.
- **Causa probable:** se asumió que el único caller sería el trigger (service_role) o el wizard de gerencia (JWT staff); `verify_jwt=false` la dejó abierta.
- **Propuesta:** `verify_jwt=true` (declarado en `config.toml`) + adentro aceptar solo (a) `service_role` o (b) JWT con `role ∈ (gerente,operador)`; rechazar si `adminRow.user_id` ya existe (salvo re-vínculo idempotente); acotar CORS al dominio propio. Espeja `crear-gerente`/`blanquear-password`.
- **Prioridad:** Inmediata (P0). **Riesgo impl.:** Bajo — los dos callers legítimos ya mandan JWT/service_role.

### 🟠 ALTO

**A1 · Sobre-exposición sistémica de funciones SECURITY DEFINER sin guard (clase T1 — 29 funciones)** *(seguridad+backend+integraciones)*
- **Hallazgo:** el default ACL de Supabase da `EXECUTE` a anon/authenticated sobre toda función public; 273 SECURITY DEFINER ejecutables por authenticated, 24 por anon, **29 sin guard interno ni token**. Instancias verificadas: `notificar_usuario` (push/campanita arbitraria a cualquier user → phishing con la marca), `admin_login_email` + `_comunicacion_resolver_audiencia` (cosecha de emails y padrón de los 79 clientes → alimenta C2), `webex_*` (fraude de asistencia/certificados), `reset_arca_jobs_colgados` (interferir el pipeline AFIP), `voucher_incrementar_uso` (quemar vouchers).
- **Riesgo/Impacto:** cada función es un endpoint REST vivo alcanzable por roles no-confiables (cliente/alumno/partner). Un solo olvido = fuga o mutación cross-tenant. Es exactamente lo que marcan los advisors `anon_/authenticated_security_definer_function_executable`.
- **Causa probable:** ausencia de convención de cierre que obligue a REVOKE de funciones internas/cron; helpers internos dejados en `public` en vez de `private`.
- **Propuesta:** (1) `REVOKE EXECUTE FROM anon, authenticated` en las internas/cron (pg_cron corre como postgres y las edge usan service_role: no necesitan el grant); (2) convención: helpers internos a schema `private`, GRANT explícito por función pública, smoke de cierre con `has_function_privilege`; (3) evaluar endurecer el default privilege con allowlist.
- **Prioridad:** Alta (P0/P1). **Riesgo impl.:** Bajo por función (verificar caso por caso que no la use el front antes del REVOKE).

**A2 · `CRON_SECRET` (bearer compartido de ~10 edge functions) commiteado a git en claro** *(infra · SSO)*
- **Hallazgo:** `gg_cron_c3500…` hardcodeado en migraciones versionadas (0162, 0166, 0373) y en los comandos de `cron.job`. Es el único factor que autentica las edge con `verify_jwt=false` llamadas por pg_cron.
- **Riesgo/Impacto:** cualquiera con acceso al repo/historial obtiene control de los flujos asíncronos: envíos masivos de email/push a los 79 clientes, forzar emisiones ARCA, DoS del throttle. No hay segundo factor.
- **Propuesta:** rotar a un valor no-commiteado (env var), leer el bearer de Supabase Vault/GUC en runtime, re-crear los jobs. **Prioridad:** Máxima. **Riesgo impl.:** Medio — coordinar la rotación con los ~10 crons (uno con token viejo empieza a 401 silencioso; ver A6).

**A3 · Cero tests + cero CI + push-a-main = deploy a prod sobre lógica compilada en runtime** *(arquitectura+infra)*
- **Hallazgo:** sin vitest/jest/playwright, `tests/sql/` vacío, sin `.github/workflows`; único gate `tsc --noEmit` local + ritual manual §6. plpgsql se compila en runtime → una columna inexistente pasa el `apply`.
- **Riesgo/Impacto:** toda regresión se descubre en prod (historial: E-GG-42 latente 3 días, E-GG-43, E-GG-37, E-GG-38). En un SaaS financiero, un cambio que compila pero rompe lógica llega a los usuarios sin red.
- **Propuesta:** aditivo y sin tocar runtime — (1) Action con `tsc`+`vite build` como status check; (2) Vitest sobre `lib/` puras (dates, cuit, storageKeys, IVA); (3) codificar el smoke R18 como scripts SQL para las ~30 RPC mutantes; (4) Vercel previews obligatorios. **Prioridad:** P1. **Riesgo impl.:** Bajo (aditivo, gate en modo no-bloqueante primero).

**A4 · Sin timeout/AbortController en las integraciones externas (salvo TRAMIX)** *(integraciones)*
- **Hallazgo:** solo `tramix-*` usa `AbortSignal.timeout`. ARCA/AFIP, Gmail, Push (FCM), Zoom, Webex hacen `fetch` sin timeout. AFIP es conocido por colgarse.
- **Riesgo/Impacto:** un tercero colgado retiene la edge hasta el wall-clock limit. En `dispatch-arca-emission` (serie de 5 con `await`, cron cada 1 min) una llamada AFIP colgada consume toda la corrida y el comprobante queda en 'sending' hasta el watchdog (15-25 min de latencia).
- **Propuesta:** helper `fetchConTimeout()` (patrón TRAMIX) — AFIP 15-20s, Gmail 20s, push 10s, Zoom/Webex 10s. **Prioridad:** Alta. **Riesgo impl.:** Bajo (timeouts holgados para AFIP).

**A5 · Dos sistemas de auditoría; la "Bitácora unificada" excluye lo financiero** *(observabilidad · SSO)*
- **Hallazgo:** `audit_row→auditoria_cambios` (viejo) y `_audit_log_trg→audit_log` (nuevo, con UI); 7 tablas escriben doble; la UI de auditoría **no muestra** movimientos, cajas ni lotes de facturación.
- **Riesgo/Impacto:** ante una disputa contable, la bitácora que ve gerencia da falsa sensación de trazabilidad completa; la reconstrucción financiera depende de SQL directo del desarrollador. Doble escritura en cada mutación de las 7 tablas.
- **Propuesta:** `audit_log` como fuente única; extender `_audit_log_trg` a las tablas financieras (aditivo); agregarlas a la UI; luego DROP de los `audit_row` duplicados tras confirmar paridad. **Prioridad:** Alta. **Riesgo impl.:** Medio (el DROP, tras verificar paridad).

**A6 · Monitoreo ciego: `pg_cron` marca 'succeeded' aunque la edge devuelva 401/500 → `notify-vencimientos` 401-eando en silencio** *(infra+observabilidad)*
- **Hallazgo:** 13/22 crons son `net.http_post` (fire-and-forget): `job_run_details` registra 'succeeded' al encolar, no según el status HTTP. `notify-vencimientos` (jobid 2) manda un token viejo (`myRhvg…`) que no coincide con `CRON_SECRET` → 401 garantizado; evidencia: `comprobante_avisos_vencimiento` con 0 filas en toda la vida de prod. El único health-check cubre solo 3 dispatchers.
- **Riesgo/Impacto:** cualquier flujo cron que empiece a fallar lo hace en silencio; el operador ve todo verde. Detección tardía (días/semanas).
- **Propuesta:** heartbeat por edge (`cron_heartbeats`) + health-check que alerte si falta un latido en su ventana; decidir si `notify-vencimientos` se re-alinea o se retira. **Prioridad:** Alta. **Riesgo impl.:** Bajo (inserts idempotentes).

**A7 · Deep-link roto en las alertas de salud críticas (404 en el peor momento)** *(observabilidad)*
- **Hallazgo:** la ruta real es `/gerencia/configuracion/salud-sistema` pero el banner y el push de flujos críticos apuntan a `/gerencia/configuracion/salud` (sin sufijo).
- **Riesgo/Impacto:** durante un incidente, el gerente toca la notificación y aterriza en una ruta que no matchea → no llega a la pantalla de diagnóstico. La respuesta a incidentes se frena justo cuando importa.
- **Propuesta:** corregir las 2 referencias + `<Route path="salud" element={<Navigate to="salud-sistema" replace/>}/>` de compatibilidad (R15). **Prioridad:** Alta. **Riesgo impl.:** Bajo.

**A-INTEG (integridad) · RPCs de dinero sin idempotencia server-side** *(integridad+backend)*
- **Hallazgo:** `registrar_cobranza_comprobante` (parcial), `curso_registrar_pago` (sin `FOR UPDATE` ni guard) y `pago_conciliar` no deduplican la misma intención de pago; existe `uq_mov_hash_dedup` pero solo lo usa el importador.
- **Riesgo/Impacto:** un doble-click imputa dinero dos veces → comprobante sobre-imputado, cta.cte errónea, KPIs inflados, ingreso fantasma en campus (sin `matricula_id`). Viola "el mismo número en todas las superficies".
- **Propuesta:** computar `hash_dedup` server-side (o aceptar `p_idempotency_key`) en las 3 RPC → colisión = no-op idempotente. **Prioridad:** Alta. **Riesgo impl.:** Bajo-medio (aditivo + smoke R18).

**A-RLS (rendimiento) · RLS reevalúa `is_staff()`/`auth.uid()` por fila** *(rendimiento+authz)*
- **Hallazgo:** 163/237 policies llaman `is_staff()` y 43 `auth.uid()` sin envolver en `(select …)`; `profiles` = objeto más escaneado (~16M scans, ~109 filas).
- **Riesgo/Impacto:** cada request evalúa los helpers una vez por tabla RLS tocada × filas; a 10x en `comprobantes`/`curso_matriculas`/`notificaciones_internas` multiplica el lookup a `profiles`. Latente hoy, muerde a escala.
- **Propuesta:** envolver las quals en `(select …)` → InitPlan (1 vez/consulta), semántica idéntica, policy por policy con smoke. **Prioridad:** Alta (P2). **Riesgo impl.:** Bajo (mayor riesgo: olvidar alguna policy).

### 🟡 MEDIO (selección — 51 en total; el resto son variantes de los temas)

- **M-AUTH · Refresh de sesión reimplementado a mano (SPOF de auth).** `supabase.ts` con `persistSession/autoRefreshToken=false` incondicional + 677 líneas de refresh manual (E-GG-07/144/155). *Propuesta:* gatear el workaround a DEV, dejar la librería en prod (rollout en preview). *Riesgo impl.:* Alto (auth sensible) → requiere staging.
- **M-DRIFT · Drift R7 / `zz-wipe-storage-oneshot` destructiva ACTIVE + `verify_jwt` no versionado.** *Propuesta:* undeploy de las 4 huérfanas, declarar `verify_jwt` en `config.toml`, check de drift en CI.
- **M-COMPROB · `tramites.comprobante_id` columna muerta** (link "Ver comprobante" roto). *Propuesta:* que `getTracking` resuelva por `solicitudes.comprobante_id`, o trigger propagador + backfill.
- **M-CAMPUS · `estado_pago` de matrícula sin fuente única** (un pago parcial nunca completa → certificado no se emite). *Propuesta:* `movimientos.matricula_id` + `estado_pago` derivado de la suma acumulada.
- **M-MODERA · Cierre de trámite por moderación saltea el `CerrarTramiteDialog`** (queda sin `motivo_cierre`/`cierre_satisfactorio` → métricas de cierre mal clasificadas). *Propuesta:* rechazar `estado='cerrado'` en `tracking_moderar_gestor_avance` y enrutar por el diálogo.
- **M-OVERRIDE · Override "cerrar sin cobrar" (E-GG-139) solo en kanban/lista y por regex sobre el texto del error** (frágil + incoherente entre superficies). *Propuesta:* ERRCODE/HINT estable en el trigger + handler de cierre único compartido.
- **M-BLOAT · `net._http_response` a 322 MB (47% de la base).** *Propuesta:* `VACUUM FULL` en ventana + retención de pg_net + cron de mantenimiento.
- **Otros MEDIO por tema:** validaciones duplicadas front/back (CUIT), N+1 puntuales, `Modal/Drawer` sin focus-trap, CSP en report-only, `administracion_emails` dormida, 4 FKs sin índice, 62 índices sin uso, 52 multiple-permissive-policies, suscripciones realtime directas con canal fijo.

### 🟢 MEJORA (21 — no representan riesgo actual)

Consolidar god-objects (`campus.ts`, `TrackingDetailPage`); adoptar `useRefreshableData` en las ~74 páginas con `load()` casero; migrar a react-query/swr; unificar `TRAMITE_ESTADO_LABEL`↔`tracking_estados_config`; a11y (teclado/lectores/contraste); `npm audit`/Dependabot (front + Deno); dimensionar conexiones Auth (10 absolutas) y throttle de email; runbook de DR + prueba de restore PITR; retención acotada de logs/colas/auditoría.

---

## 14. Gaps de cobertura de ESTA auditoría (para no dar falsa completitud)

Fue estática/catálogo + verificación en vivo puntual. **No** se auditó: (1) corrección tributaria AFIP e2e (alícuotas por línea, tipos de comprobante, CAE, notas de crédito) — núcleo del riesgo fiscal; (2) DR real (restore PITR nunca probado; 466 migraciones forward-only sin down); (3) deliverability de email (SPF/DKIM/DMARC); (4) anti-abuso/rate-limit de superficies públicas sin login; (5) supply-chain (`npm audit`/deps Deno); (6) accesibilidad real; (7) timings con `EXPLAIN ANALYZE` bajo carga + prueba en browser desktop/mobile; (8) cumplimiento ley 25.326 y retención; (9) rotación del resto de secretos (service_role, VAPID, certs ARCA, Zoom/Webex); (10) concurrencia real con dos sesiones.

---

## 15. Conclusión — ¿qué tan confiable es hoy para operar años, crecer y evolucionar?

**Para operar en el día a día:** confiable — funciona, el dinero cuadra, la integridad del núcleo está verificada sana y hay disciplina real.

**Para la seguridad, hoy:** **no**, hasta cerrar el P0. Existen dos vías de compromiso total explotables ahora mismo por cualquier usuario. Es lo primero e ineludible.

**Para crecer 10-100x:** **sí, con trabajo acotado.** El modelo de datos y el indexado escalan; el techo real (RLS por-fila, bloat de pg_net, límites de conexión/email, retención de colas) es conocido, medido y se resuelve con cambios quirúrgicos ya identificados. No hay que rearquitecturar.

**Para evolucionar sin efectos secundarios inesperados:** **es la debilidad estructural de fondo.** Mientras cada cambio se valide solo con revisión humana (sin tests ni CI) y el aislamiento dependa de que cada función recuerde su guard, cada modificación seguirá teniendo un riesgo no acotado de regresión — el patrón "bug descubierto en prod por un usuario real" que el propio historial (E-GG-*) documenta.

**En una frase:** es una plataforma **bien construida y honestamente confiable en su núcleo, con una superficie de autorización peligrosamente ancha y sin red automatizada de QA.** Cerrado el P0 de seguridad e instalada una red mínima de CI + fuente única de autorización, alcanza sin problemas el estándar "premium" (coherente, predecible, segura, observable, mantenible, escalable, estable) que es el objetivo. Los cimientos ya están; lo que falta es endurecer los bordes y automatizar la red.

---
*Informe generado por auditoría multi-agente coordinada (42 agentes: 12 auditores + 29 verificadores adversariales + 1 sintetizador) con verificación en vivo de los hallazgos flagship. Todos los CRÍTICO/ALTO fueron confirmados contra la base de producción. Ningún cambio fue aplicado — este documento es diagnóstico y planificación.*

---

## 16. BITÁCORA DE REMEDIACIÓN — sesión nocturna 2026-09-13 (autónoma, sin usuarios)

Criterio de esta sesión (pedido de Pablo): **solo lo de riesgo cero al funcionamiento, 100% verificable y reversible, sin mails y sin requerir intervención**. Lo delicado (login/onboarding/secretos/dinero) queda para la sesión supervisada.

### ✅ APLICADO Y VERIFICADO EN VIVO

**Fase 1a · REVOKE de 10 funciones SECURITY DEFINER internas/cron/webhook** (mig `0474`, commit `9acadca`)
- Cierra la clase A1/T1 (phishing por `notificar_usuario`, fuga de PII cross-tenant por `admin_login_email`/`_comunicacion_resolver_audiencia`, fraude de asistencia por `webex_*`, abuso de `reset_arca_jobs_colgados`/`gg_agenda_procesar_recordatorios`/`health_flow_alerts_garbage_collect`).
- **Pre-verificado:** 0 callers de front (cada nombre solo en `database.ts`); callers legítimos = cron (postgres) / service_role (webex-webhook + health-flows-check, confirmados) / owner (helpers internos).
- **Smoke post-aplicación:** anon=f, authenticated=f, **service_role=t** en las 10.
- **Verificación en vivo:** "Salud del sistema" corre verde tras el cambio (health-flows OK, dispatchers 2xx, ARCA sin atascados) → los flujos asíncronos intactos.
- **Rollback:** `GRANT EXECUTE ON FUNCTION public.<fn>(<args>) TO authenticated;` (ver la mig para las firmas).

**Fase 1b · Deep-link de alertas de salud (A7)** (commit `819b3d5`, deploy verde)
- El banner/push de flujos críticos apuntaba a `/gerencia/configuracion/salud` (ruta inexistente → 404 en plena alerta). Fix: Link corregido a `salud-sistema` + Route de compatibilidad `salud`→`../salud-sistema`.
- **Verificado en vivo:** `/configuracion/salud` redirige a `salud-sistema` y la página carga; consola limpia.
- **Rollback:** revertir el commit (frontend puro).

### 🟡 EN CURSO / PENDIENTE DE ESTA SESIÓN
- **Fase 0 · Red de QA (CI + tests unitarios de libs puras).** Tests escritos (`tests/unit/cuit|storageKeys|diasHabiles.test.ts`, fuera del `include` de tsconfig → no pueden romper el build) + `vitest.config.ts` + workflow `.github/workflows/ci.yml`. Bloqueado por un `npm install -D vitest` anormalmente lento (cuelgue ambiental de la máquina). **No se pusheó** hasta poder correr `vitest` y verificar verde. El CI necesita que confirmes el primer run en GitHub (Actions).

### ⏸️ DELICADO — PARA LA SESIÓN SUPERVISADA (cuando te levantes)
En orden de urgencia: **C1** (auto-escalada de rol vía `profiles.role` — el más grave), **C2** (`alta-cliente-portal` `verify_jwt`), **A2** (rotar `CRON_SECRET`, tocar la cadena de mails → con vos), guard de `marcar_renovados_masivo`; luego idempotencia de RPCs de dinero, unificar deuda neta, falso-verde de cron, auditoría de `profiles.role`/`config_global`, `estado_pago` de campus, y las de escala (RLS InitPlan, bloat de pg_net, timeouts de integraciones).
