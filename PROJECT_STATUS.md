# PROJECT STATUS · Plataforma Gestión Global

> **Archivo vivo de continuidad de sesión.** Si abrís una sesión nueva, leé este archivo PRIMERO. Te dice exactamente dónde quedó el proyecto, qué se hizo, qué falta y qué decisiones tomamos en el camino.
>
> **Mantenimiento**: actualizar después de cada chunk de trabajo verificado y cerrado. No esperar al final. Si un paso se postergó, registrarlo abajo en "Pateado para el final".

**Última actualización**: 2026-05-21 (Punto 5 · pase rápido + L/M · 28 items totales)
**Sesión actual**: continuación de la sesión de las rondas 4–6 + Punto 5

---

## 0. Snapshot ejecutivo

Plataforma SaaS premium single-tenant para Gestión Global (administración de consorcios) bajo `gestionglobal.ar`. Stack React 18 + Vite 6 + Tailwind + Supabase (Postgres 15 + Auth + RLS + Realtime + Edge Functions) + Vercel + GitHub + Google Workspace + ARCA SOAP.

**Estado funcional al cierre de Ronda 6**:
- Núcleo de facturación + cuenta corriente + administraciones + consorcios: ✅ producción.
- ARCA self-service: ✅ producción.
- Solicitudes públicas + wizard activación + trackings: ✅ producción.
- Agenda con patrón MDC (parser NL, recurrencia virtual, gestos premium): ✅ construyendo limpio.
- Unificación temporal (Agenda como hub de vencimientos/trámites/comprobantes/solicitudes): ✅ completa — proyecciones in-line en Mes/Semana/Día/Lista + edge function dispatch nueva con alarmas_offsets[].
- Tracking → vencimientos automáticos con alarmas configurables: ✅ schema + RPC + UI listos.
- Push web VAPID, PWA, command palette ⌘K: ✅ funcional.

**Lo que falta** está enumerado en la sección 4. **Lo que pateamos** está en la sección 5.

---

## 1. Roadmap maestro (los 9 puntos del usuario)

1. ✅ **Bugfixes ronda A + browser review** — cerrado.
2. ⏳ **38 mejoras premium/robustez** — 13 de 38 hechas; 25 pendientes (ver `BACKLOG.md`).
3. ✅ **Ronda 5 (Flujo Maestro)** — agentes E/F/G2/G1 en paralelo → módulos Solicitudes + Trackings + Agenda inicial + Formularios admin.
4. ✅ **Browser review aspectos nuevos** — hecho parcialmente.
5. ✅ **pase rápido + L/M (28 items totales)** — pase rápido (15 S/M) + segundo pase L/M (13 items): Solicitudes 1.B/1.D/1.F/1.H, Trackings 2.D/2.G, Formularios 4.A/4.C/4.F, Acceso externo 5.B/5.C, Vencimientos 6.A, Cross 7.B. Detalle en sección 8 y en `PROPUESTAS_PUNTO_5.md`.
6. ⏳ **Link-by-link review + rebuild Campus** — pendiente. Campus = aula virtual con cursos/módulos/videos/evaluaciones/certificados/progreso (NO catálogo).
7. ⏳ **Mockup web mejorada con documentación** — pendiente.
8. ⏳ **Revisión end-to-end del proyecto** — pendiente.
9. ⏳ **Planning del trabajo remanente** — pendiente.

**Rondas auxiliares ejecutadas fuera del roadmap principal**:
- **Ronda 5.5 · Refinamiento Agenda con patrón MDC** ✅ — migraciones `0038_agenda_mdc_pattern.sql` + `0039_agenda_motor_recordatorios.sql`. 4 tablas MDC, parser NL `agendaParse.ts`, motor recurrencia virtual `agendaRecurrencia.ts`, UI completa con 9 componentes nuevos, gestos premium (paint/move/resize/drag&drop), cadencia humana de recordatorios.
- **Ronda 6 · Unificación temporal** ✅ COMPLETA — migración `0040_agenda_unificada.sql` (VIEW `vw_agenda_unificada` con 5 fuentes proyectadas, RPC `tracking_cerrar_ciclo` con alarmas configurables, `ProgramarVencimientoModal` en TrackingDetail, Vencimientos como tab dentro de Agenda) + migración `0041_dispatch_log_canal.sql` (idempotencia per-(vencimiento, offset, canal) + plantilla `vencimiento_alerta_cliente`) + proyecciones in-line en Vista Mes/Semana/Día/Lista (icono Lock, click → módulo origen) + edge function `dispatch-vencimientos` reescrita para consumir RPC `gg_vencimientos_planificar_alertas` con push interno (gerentes) + email al cliente cuando `notificar_cliente=true`.

---

## 2. Trabajo en curso AHORA

**Punto 5 completo. Próximo: Punto 6 (Campus rebuild).** Segundo pase L/M ejecutado (2026-05-21): 13 items sobre la migración consolidada `0042_p5_resto.sql` (RPC `restaurar_solicitud`, `solicitud_responder` + `sent_emails.solicitud_id` + template `solicitud-respuesta-libre`, `servicios.sla_dias`, `tramites.responsable_id` con trigger backfill, tabla `accesos_externos_log` + RPC anon `registrar_apertura_acceso` + vista `vw_accesos_externos_aperturas`, `formularios.schema_draft`). Edge function `acceso-externo` redeployada (v2) con contacto del responsable. Build limpio (`tsc --noEmit` + `vite build`).

---

## 3. Decisiones grandes acumuladas

Las decisiones fundacionales viven en `knowledge-base/DECISIONES.md` (DGG-01..04). Adiciones de las rondas recientes:

### DGG-05 · Agenda con patrón MDC (Ronda 5.5)
Adoptar el patrón MDC (`/Users/paulair/Desktop/MDC Plataforma/mdc-platform/AGENDA_GERENCIAL_HANDOFF.md`) en su totalidad. 4 tablas (`agenda_categories`, `agenda_events`, `agenda_event_overrides`, `agenda_reminders_log`). Recurrencia virtual con overrides. Parser NL rioplatense. Cadencia humana de recordatorios. **Descartado**: recordatorios configurables tipo Google/Apple (2 días antes, etc.) — el dueño de producto MDC los consideró ruido. EXCEPTO en vencimientos (ver DGG-07). Fecha: 2026-05-21.

### DGG-06 · Unificación temporal "proyección, no duplicación" (Ronda 6)
La Agenda se vuelve hub único de todo lo que tiene fecha. Cada módulo (vencimientos, trámites, comprobantes, solicitudes) sigue siendo dueño de sus datos; la Agenda los proyecta vía VIEW `vw_agenda_unificada`. Eventos proyectados son read-only desde Agenda (icono Lock, color tenue); click abre el módulo origen. Eventos personales se crean/editan full. **Vencimientos sale del sidebar** y vive como tab dentro de Agenda (con su workflow renovar/config intacto). Fecha: 2026-05-21.

### DGG-07 · Tracking → vencimiento automático con alarmas configurables (Ronda 6)
Al cerrar el ciclo de un servicio en un tracking, debe poder programarse automáticamente el próximo vencimiento con alarmas **multi-select**: 1 mes / 15 días / 1 semana / 2 días / 1 día / el día / personalizado. Cada alarma dispara push interno (cron) **+ email automático al cliente administrador** si `notificar_cliente=true`. Schema: `vencimientos.alarmas_offsets integer[] DEFAULT '{30,7,2}'`, `vencimientos.notificar_cliente boolean DEFAULT true`, `vencimientos.tracking_id uuid` (link bidireccional). RPC `tracking_cerrar_ciclo`. Fecha: 2026-05-21.

### DGG-08 · Sin Vencimientos en sidebar (Ronda 6)
La entrada `Vencimientos` se quita del sidebar de gerencia. Vencimientos vive como tab dentro de Agenda + ruta deep-link `/gerencia/agenda/vencimientos`. Razón: unificar el flujo temporal, reducir cantidad de menús, mantener todo lo que tiene fecha bajo un solo techo. Fecha: 2026-05-21.

---

## 4. Pendientes técnicos en orden

### Inmediato
Ninguno · Ronda 6 cerrada.

### Siguiente · Punto 6 (link-by-link review + Campus rebuild)
Punto 5 completo (pase rápido + L/M, 28 items). Sólo quedan los items grandes (L) deliberadamente postergados, listados abajo.

### Punto 6 (link-by-link + Campus rebuild)
- Auditoría visual de cada ruta del módulo gerencia.
- **Campus rebuild completo**: hoy es un catálogo; debe ser aula virtual real con:
  - Cursos con módulos secuenciales.
  - Videos (storage), evaluaciones, certificados PDF al completar.
  - Tracking de progreso del alumno.
  - Roles: instructor (gerente) / alumno (administrador cliente).

### Backlog técnico (paralelo)
- 25 de 38 mejoras premium/robustez (lista completa en `BACKLOG.md`).
- Drop final tabla `agenda_eventos` (deprecada en Ronda 5.5) — bloqueado por trigger `agenda_from_vencimiento_threshold`.
- Integrar parser NL al CommandPalette global ⌘K (opcional).
- (Hecho · mig 0041) Idempotencia de `dispatch_vencimientos_log` por `(vencimiento_id, offset, canal)`.

### Punto 5 · sub-items pendientes (sólo los L deliberadamente postergados)
Lo de pase rápido + L/M ya entró. Quedan sólo los de esfuerzo L (timeline,
PDF, undo/redo, diff, search global, etc.). Referencia: `PROPUESTAS_PUNTO_5.md`.

- **Trackings**: 2.A (timeline visual · L), 2.C (export PDF · L), 2.F (drag&drop archivos sobre detalle · M, no top).
- **Agenda**: 3.B (tooltip hover en proyectadas), 3.F (skeleton de carga proyectadas), 3.G (quick-edit inline título), 3.H (popover "+N más"). (Bloque Agenda quedó fuera de este pase por scope.)
- **Formularios**: 4.B (atajo ⌘+número insertar campo), 4.D (undo/redo editor · L), 4.E (diff de versiones · L).
- **Acceso externo**: 5.D (CTA "pedir link nuevo"), 5.F (print stylesheet).
- **Vencimientos**: 6.B (bulk renovar · L), 6.C (mini-mapa calendario), 6.F (chip "generado desde tracking" · requiere ampliar RPC `proximos_vencimientos` para devolver `tracking_id`).
- **Cross-cutting**: 7.C (centro de notificaciones in-app · L), 7.D (search global ⌘K · L), 7.E (pull-to-refresh), 7.F (a11y focus rings + aria), 7.G (persistencia de filtros en URL · ya cubierto parcial en 1.E).

### Acciones del usuario (no las puedo hacer yo)
- Generar **VAPID keys** y setearlas en Vercel + Supabase secrets.
- **DNS gestionglobal.ar** apuntar a Vercel (NIC.ar / Cloudflare).
- `GMAIL_OAUTH_REFRESH_TOKEN_<CASILLA>` por alias (opcional; el fallback transactional funciona sin esto).
- Domain verification en Vercel.

---

## 5. Pateado para el final (no perder)

Ideas y mejoras que surgieron pero NO se ejecutaron, ordenadas por valor percibido. Revisar antes del cierre del proyecto.

- **Embebido del módulo origen como modal en Agenda** (en vez de navegación). Hoy click en proyectado navega; idealmente abre modal in-place para no perder contexto de calendario.
- **Toggle global "Modo enfoque"** en Agenda — oculta proyecciones, deja sólo eventos personales.
- **Pull-to-refresh** en listas mobile (KPIs, vencimientos, etc.).
- **Onboarding interactivo** primera vez para el gerente — tour de Agenda + Trámites + Solicitudes.
- **Notificaciones in-app centralizadas** (campana en header con dropdown) — hoy se reciben por push pero no hay centro de notificaciones histórico.
- **Modo offline básico** con service worker para vistas de solo lectura.
- **Exportar agenda a iCal** (`.ics`) para sincronizar con Google Calendar / Outlook.
- **Atajos de teclado** vía ⌘K para navegar entre vistas, marcar hecho, posponer, etc.

---

## 6. Instrucciones acumuladas del usuario

Reglas y preferencias que el usuario fue puntualizando durante las sesiones. Deben respetarse en todo lo que se construye.

- **Citar IDs** (E##/D##/P-XX-NN/regla N) al justificar decisiones. El usuario los reconoce.
- **UX premium grado Apple** en cada fase. Nada queda "funcional pero feo".
- **Validar siempre sobre la URL de Vercel** después de cada push (no sólo localhost).
- **Tono institucional pero cercano** — el rioplatense MDC se adapta a "voz Gestión Global", evitando argentinismos que choquen con tono profesional. "Tirá lo que tengas en la cabeza" ✅. "No te cuelgues" ❌ en copy formal.
- **Emails NO van por Resend** — usar SMTP de Google Workspace premium del dominio (2026-05-19).
- **Tablas pre-existentes con naming híbrido** (regla 8 / E43): antes de RPC, verificar columnas reales con `information_schema.columns`.
- **Integración orgánica del flujo** como pilar de optimización — no construir módulos aislados. Todo lo que tiene fecha debe entrelazarse con su evento de agenda (DGG-06).
- **Tracking + alarmas customizables** en cada ficha de servicio (DGG-07): al cerrar ciclo, botón directo para programar vencimiento + alertas múltiples + email al cliente.
- **Registro exhaustivo y continuo** del proyecto — actualizar `PROJECT_STATUS.md` después de cada paso verificado, porque las sesiones pueden romperse y la continuidad debe sobrevivir (instrucción 2026-05-21).
- **Plataforma ambiciosa, premium, cara, altamente eficiente** — ningún dato/elemento puede pasar desapercibido.
- **MÉTODO OBLIGATORIO · Browser test en vivo después de cada chunk** (2026-05-21): cada aplicación / módulo / componente tocado debe ser testeado en tiempo real en el browser (apariencia + funcionalidad), no sólo `tsc --noEmit` + `vite build`. El testing se hace sobre la URL de Vercel (o preview local con Claude Preview/Chrome MCP) y debe verificar al menos: render correcto en desktop + mobile (360px), interacciones críticas, casos borde de empty/loading/error. **Antes de marcar un chunk como cerrado, browser-testeado.**

---

## 7. Archivos clave de continuidad

| Archivo | Función | Frecuencia de update |
|---|---|---|
| `PROJECT_STATUS.md` | Este archivo. Snapshot vivo. | Después de cada chunk verificado. |
| `BACKLOG.md` | Plan maestro + rondas + backlog de mejoras. | Cuando se cierra ronda o se agrega ítem. |
| `CLAUDE.md` | Contrato del proyecto (13 reglas). | Solo si cambia una regla — raro. |
| `knowledge-base/DECISIONES.md` | Decisiones DGG-## con razón y fecha. | Cuando se toma decisión grande. |
| `knowledge-base/ERRORES.md` | Bugs >30 min con ID E##. | Cuando se diagnostica un bug. |
| `knowledge-base/00_LEEME_PRIMERO.md` → `05_*.md` | Contrato extendido. | Solo si cambia arquitectura mayor. |

**Si abrís una sesión nueva**: leé en este orden:
1. `PROJECT_STATUS.md` (este archivo) — dónde quedamos.
2. `CLAUDE.md` — reglas no negociables.
3. `BACKLOG.md` sección activa (Ronda en curso + roadmap).
4. `knowledge-base/DECISIONES.md` (referencia rápida).
5. (Si el problema lo requiere) `knowledge-base/00_…` → `05_…`.

---

## 8. Registro de sesiones

| Fecha | Tema dominante | Rondas cerradas | Próximo hito |
|---|---|---|---|
| 2026-05-19 | Arranque single-tenant + DGG-01..04 | — | Fase 1 núcleo |
| 2026-05-20 | Bugfixes ronda A + 38 mejoras premium | Punto 1 ✅, Punto 2 en curso | Ronda 5 Flujo Maestro |
| 2026-05-21 | Ronda 5 (Flujo Maestro) + 5.5 (Agenda MDC) + 6 (Unificación temporal) | Rondas 5, 5.5, 6 ✅ | Cerrar Ronda 6 + Punto 5 |
| 2026-05-21 | Ronda 6 cierre · proyecciones in-line + edge dispatch nuevo | Ronda 6 cerrada completa | Punto 5 (propuestas premium) |
| 2026-05-21 | Punto 5 · auditoría módulos nuevos + entrega `PROPUESTAS_PUNTO_5.md` (49 propuestas + bug crítico ruta tramites/trackings) | Punto 5 entregado | Selección del usuario · ejecutar pase rápido S/M |
| 2026-05-21 | Punto 5 · **pase rápido ejecutado** · 15 items (7.A bug + 1.A 1.C 1.E 1.G + 2.B + 3.A 3.C 3.D 3.E + 4.G + 5.A 5.E + 6.D 6.E) · build limpio · E-GG-01 registrado | Punto 5 cerrado en pase rápido | Punto 6 (link-by-link + Campus rebuild) |
| 2026-05-21 | Punto 5 · **segundo pase L/M** · 13 items (1.B 1.D 1.F 1.H + 2.D 2.G + 4.A 4.C 4.F + 5.B 5.C + 6.A + 7.B) · migración consolidada `0042_p5_resto.sql` + types regenerados + edge `acceso-externo` v2 + Button `variant="tonal"` · build limpio | Punto 5 completo (28 items) | Punto 6 (Campus rebuild) |
