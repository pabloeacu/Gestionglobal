# Backlog · Plataforma Gestión Global

> Estado vivo del proyecto. Se actualiza con cada ronda.

---

## Estado actualizado 2026-05-25 (post P2 ola 1+2)
**Progreso 25→24 mejoras P2 hechas** · 14 pendientes:
- 4 audits visuales menores (#1, #3, #4, #6)
- 2 features con valor pendientes (#13 período global, #26 filtros guardados)
- 8 grandes L que requieren decisión del usuario (#10 tour, #23 email tracking, #24
  dashboard avanzado, #25 exports programados, #31 Sentry, #33 2FA, #37 i18n, #38 OpenAPI)

## 9-Step Roadmap del usuario

1. **Bugfixes ronda 1** → ✅ Completado (commit `054ffd2`)
2. **38 mejoras premium / UX / robustez** → 🟡 En progreso (13 / 38 hechos)
3. **Agentes E, F, G, H** (form builder, push, búsqueda, finanzas) → 🟡 Replanificado: ahora arranca como **Ronda 5** con Flujo Maestro
4. **Revisión completa browser** → ⏳ Pendiente tras Ronda 5
5. **Mejoras premium nueva ronda** → ⏳ Pendiente
6. **Revisión link-por-link** (Campus rebuild incluido) → ⏳ Pendiente
7. **Mockup web mejorada con presentación** → ⏳ Pendiente
8. **Revisión punta a punta del proyecto** → ⏳ Pendiente
9. **Planificación de lo que reste** → ⏳ Pendiente

---

## Backlog de los 38 puntos del Punto 2

### Hechos (24 / 38) — actualizado 2026-05-25 post P2 olas 1+2

- [x] #2 AnimatedNumber sin "0→N" inicial
- [x] #5 Footer institucional mini con versión
- [x] #7 Grilla de atajos completa (11 items)
- [x] #8 Dashboard analítico con KPI strip + sparkline en home
- [x] #9 FAB con quick actions (P2-ola1 · QuickActionsFAB)
- [x] #11 Búsqueda global ⌘K end-to-end con RPC (+ DGG-29 solicitudes/trackings)
- [x] #12 Docs de atajos de teclado en palette `?` (P2-ola1 · KeyboardShortcutsModal)
- [x] #14 Tabs sticky en ConfiguracionLayout
- [x] #15 Indicador Realtime dot en header (P2-ola1 · RealtimeStatus)
- [x] #16 Botón "Copiar como CSV" en tablas (P2-ola1 · ExportButtons + csvCopy)
- [x] #17 Editor visual de schema JSONB drag&drop (Ronda 5 / FormularioBuilderPage)
- [x] #18 Plantillas de formularios (Ronda 5 / "Desde plantilla" botón en /gerencia/formularios)
- [x] #19 Embed iframe + JS snippet (Ronda 5 / EmbedCodeModal)
- [x] #20 Editor templates con autocomplete `{{vars}}`
- [x] #21 Botón "Enviar prueba a mí"
- [x] #22 Preview email desktop/mobile sandboxed
- [x] #27 Code splitting React.lazy (35 páginas)
- [x] #28 Avatar WebP con fallback JPEG
- [x] #29 PWA service worker + manifest installable
- [x] #30 Push notifications VAPID (Ronda 5 · push_subscriptions + dispatch-push)
- [x] #32 Health check page `/health` (P2-ola2 · HealthPage)
- [x] #34 Audit log unificado (P2-ola2 / DGG-35 · mig 0067 + AuditoriaPage)
- [x] #35 Sesiones activas en Perfil (P2-ola2 / DGG-36 · mig 0068 + PerfilSesionesActivas)
- [x] #36 DNS gestionglobal.ar → Vercel (DGG-28 · NIC.ar → Cloudflare → Vercel)

### Pendientes (14 / 38) — todos S/M residuales o L "agency-grade"

**Estética & branding · audits visuales menores**
- [ ] #1 Tipografía de cards homogénea (32px vs 36px) — pasada visual, ajustar Skeleton CSS
- [ ] #3 IllustratedEmpty consistente en todas las páginas vacías — algunas listas siguen con texto plano
- [ ] #4 Skeleton loaders con timeout/fallback — Skeleton existe, falta wrapper "si tarda >2s mostrar toast"
- [ ] #6 Iconografía stroke-width audit — verificar consistencia lucide (1.75 vs 2)

**Operación · features con valor**
- [ ] #13 Selector de período global en header — dropdown 7d/30d/90d/1a/custom
- [ ] #26 Filtros guardados ("Mis vistas") — tabla `vistas_guardadas` + UI por listado

**Grandes (L) — requieren integración / decisión del usuario**
- [ ] #10 Tour de bienvenida (Shepherd.js) — primera vez del gerente, tour de 6 pasos
- [ ] #23 Tracking de aperturas y clicks de emails — pixel + redirect proxy + tabla logs
- [ ] #24 Dashboard analítico con gráficos avanzados (recharts/nivo) — distinto al sparkline actual
- [ ] #25 Exportes programados (cron mensual + email PDF/XLS)
- [ ] #31 Sentry / error tracking — requiere DSN del usuario
- [ ] #33 2FA TOTP opcional — Supabase Auth MFA + UI enroll
- [ ] #37 Multi-idioma EN/PT (i18n) — refactor masivo con i18next
- [ ] #38 API pública con OpenAPI — Supabase REST + docs Swagger

---

## Flujo Maestro (subsistema agregado en Punto 3)

26 puntos del documento "Flujo Maestro de Solicitudes, Tracking, Activación de Clientes y Agenda Operativa".

**Cubierto por agentes de Ronda 5:**

| Bloque | Cubre puntos | Agente |
|---|---|---|
| Centro de solicitudes recibidas | 1-5 (filosofía + alertas + revisión) | G1 |
| Wizard operativo de activación (3 pasos) | 6-8 (derivación, alta cliente, tracking) | G1 |
| Acceso externo seguro (sin login) | 7 (links a terceros gestores) | F |
| Sistema de tracking como entidad | 9-15 (estructura, estados, líneas, categorías) | G2 |
| Integración tracking con cuenta cte + automatizaciones | 16-17 | G2 |
| Activación de cliente nuevo / existente + email | 18-22 (credenciales + recurrencia + cierre) | G1 |
| Módulo de agenda / calendario operativo | 23-25 (eventos, alertas, vistas) | F |

---

## Pendientes específicos del Campus virtual (Punto 6)

Detectado durante test browser: **el editor de cursos crashea** con React #310, y la estructura de aula virtual no está completa.

**Fases anotadas para Punto 6:**
- **A** · Fix React #310 en `CursoEditorPage`
- **B** · Constructor completo: editor de clases (YouTube embed + docente + descripción), bibliografía (archivo o link), exámenes (MC + V/F + retroalimentación)
- **C** · Vista alumno end-to-end: navegación módulo > clase > examen con autocorrección
- **D** · Conexión: inscripción al curso (formulario) → matrícula automática

---

## Otros pendientes del Documento Maestro original

- **Finanzas** · caja, bancos, conciliación (único módulo "PRONTO" del sidebar) → **Ronda 6**
- **Recupero R1/R2/R3** · ✅ Hecho
- **Partners + rendiciones** · ✅ Hecho
- **Vencimientos + alertas estratégicas** · ✅ Hecho
- **DNS apuntando a Vercel** · ⏳ Pendiente (acción del usuario en Cloudflare/NIC.ar)
- **Importador histórico Excel** · ✅ Hecho

---

## Agenda ultra-premium · referencia obligada

El usuario aportó el documento `/Users/paulair/Desktop/MDC Plataforma/mdc-platform/AGENDA_GERENCIAL_HANDOFF.md` (1030 líneas) — handoff de la Agenda Gerencial que armaron en la plataforma MDC. Después de que F termine la versión inicial (CRUD + push + accesos), aplicar las **mejoras del patrón MDC** en una segunda pasada:

1. **Parser NL rioplatense** — "comprar pañales mañana 9am #personal" → evento listo (incluye fechas relativas, horas, categoría con `#`, prioridad con `!`, recurrencia textual).
2. **Recurrencia virtual** — regla en fila madre + tabla `event_overrides` con status `moved/skipped/done`. Las ocurrencias se calculan en runtime, no se materializan.
3. **Gestos premium** sobre Semana/Día — drag para mover bloque (con ghost preview de rango), resize por borde inferior, paint franja vacía para crear (sin persistir hasta confirmar — regla E1).
4. **Círculo de tilde Apple Tasks** embebido (stopPropagation en pointerdown — regla E12).
5. **AccionesMenu flotante** con clamp robusto que recalcula con `useLayoutEffect` (regla E7).
6. **Posponer relativo a la fecha del evento** (regla E11), no a hoy.
7. **Cadencia humana de recordatorios** — 1° aviso a la hora, re-alerta cada 5 h, cierre a las 20:00, pendientes 09:00-09:20 una sola vez. Descartar alarmas configurables tipo Google.
8. **Modal con panel lateral animado** (NO expandir hacia abajo — regla E8).
9. **Command palette ⌘K** ya existe global; agregar acciones scope-aware "saltar a hoy/mañana/próximo lunes".
10. **Copy rioplatense** ("no te cuelgues", "te marco de nuevo", "última por hoy") + emojis SOLO en notifications (UI usa lucide).

**14 lecciones (E1-E14) en el documento — releerlas antes de tocar Agenda.**

Adaptaciones para Gestión Global:
- Owner: ya tenemos rol `gerente` (no `gerencia`).
- Categorías default: Liquidaciones, Asambleas, Cobranzas, Proveedores, Reclamos, Personal, Banco, Otros.
- Vínculos: consorcios, administraciones, comprobantes, trámites/trackings (en vez de edificios/empleados/facturas de MDC).
- Color primario: cyan/teal Gestión Global (NO turquesa).
- Tono: mantener rioplatense pero alineado a la voz de Gestión Global (institucional pero cercano).

---

## Unificación temporal · Agenda como hub de TODO lo que tiene fecha (Ronda 6 — decisión 2026-05-21)

**Pilar estratégico**: el usuario explicitó que la **integración orgánica del flujo** es uno de los pilares de optimización, experiencia premium y "delicia del usuario". Ningún módulo con fechas puede vivir aislado.

### Arquitectura "proyección, no duplicación"

La **Agenda** se vuelve la ventana única hacia todo lo temporal. Cada módulo sigue siendo dueño de sus datos y workflows; la Agenda los proyecta como ocurrencias virtuales vía `vw_agenda_unificada`.

Fuentes que se proyectan:
1. **`agenda_events`** → fuente `personal` (editable full desde Agenda).
2. **`vencimientos`** → fuente `vencimiento` (read-only desde Agenda; click abre modal del módulo origen embebido).
3. **`tramites`** con `fecha_objetivo` → fuente `tramite`.
4. **`comprobantes`** con `fecha_vencimiento` y `estado != pagado` → fuente `comprobante`.
5. **`solicitudes`** con `fecha_objetivo` → fuente `solicitud`.

Reglas:
- Eventos proyectados llevan icono `Lock` + color tenue + badge del tipo origen. No se editan desde Agenda.
- Click → modal embebido del módulo origen (renovar, marcar pagado, etc.). Al cerrar, Agenda refresca.
- "Recordatorio personal" en cualquier item del módulo origen crea un evento Agenda **vinculado** (sí editable, complementa al proyectado).
- Filtros por fuente en chips: `Todo` · `Personal` · `Vencimientos` · `Trámites` · `Cobranzas` · `Solicitudes` (persistente en localStorage).
- **Vencimientos** sale del sidebar y vive como **tab dentro de Agenda** (con su workflow renovar/config intacto).

### Tracking de servicios → vencimientos automáticos con alertas (CRÍTICO)

Cuando se cierra el ciclo de un servicio en un tracking (ej.: "renovación matrícula RPAC 2026" completada), debe poder **programarse automáticamente** el próximo vencimiento con alertas configurables. El usuario quiere botones de acceso directo en cada ficha de tracking para esto.

**Modelo de alertas configurables**:
- Offsets preset (días antes): **30**, **15**, **7**, **2**, **1**, **0**.
- Personalizado (input numérico libre).
- Multi-selección: la gerente puede programar 30+15+7+2 al mismo tiempo.
- Cada alerta dispara **dos canales**: push interno (para nosotros, vía cron `gg_agenda_procesar_recordatorios` o un cron paralelo) **y email automático al cliente administrador** (vía cola `email_outbox` con plantilla parametrizada).

**Esquema de datos sugerido** (a confirmar en implementación):
- `vencimientos` ya tiene columna `dias_alerta_antes` (revisar tipo actual): migrar/agregar `alarmas_offsets integer[] NOT NULL DEFAULT '{30,7,2}'` y `notificar_cliente boolean NOT NULL DEFAULT true`.
- `tracking_lineas` (o tabla equivalente del módulo trackings): al cerrar ciclo, RPC `tracking_cerrar_ciclo(p_tracking_id, p_proxima_fecha, p_alarmas_offsets[])` que:
  1. Marca el ciclo actual como cerrado.
  2. INSERT en `vencimientos` con `fecha_vencimiento = p_proxima_fecha`, `alarmas_offsets`, `administracion_id` y `consorcio_id` heredados.
  3. Devuelve el id del nuevo vencimiento para feedback al UI.
- Cron de dispatch existente (`venc_auto_clasificar_vencido` + dispatcher de mails) extendido para respetar el array de offsets (hoy probablemente usa un único offset).

**UI esperada en la ficha de tracking**:
- Botón "Programar próximo vencimiento" → modal con:
  - Date picker (próxima fecha, sugerido = fecha cierre + 1 año o periodo del servicio).
  - Chips multi-select: `1 mes` · `15 días` · `1 semana` · `2 días` · `1 día` · `el día` · `Personalizado…`.
  - Switch "Notificar al administrador por email" (default ON).
  - Preview de cronograma: "Se enviarán 4 avisos: 30/03 (1 mes), 30/04 (...) ..." con fechas calculadas.
- Confirmación → toast "Vencimiento programado · 4 avisos en agenda".

### Fix UX de gestos del calendario (parte del mismo entregable)

Hoy los gestos (paint, drag, resize, drag&drop día↔día) **están implementados** pero ocultos: la vista default es Lista. Acciones:
- **Default = Semana** (Lista queda como opción del toggle).
- Cursor `crosshair` en áreas vacías de Semana/Día (afford visual).
- Hint flotante al hover en columna vacía: "Pintá para crear · arrastrá un bloque para mover · borde inferior para duración".
- Manijas de drag/resize visibles al hover del bloque.
- Ghost de drop reforzado en Mes (chip-fantasma con fecha destino, no solo ring).

### Sidebar tras la unificación

`Inicio · Solicitudes · Clientes · Servicios · Facturación · Trámites · **Agenda** (con tabs internos: Mi agenda / Vencimientos) · Cuenta corriente · Recupero · Partners · Finanzas · Formularios · Campus · Reportes · Configuración`.

Vencimientos deja de ser entrada de sidebar; queda accesible como tab y desde links contextuales (tracking, ficha de cliente, etc.).
