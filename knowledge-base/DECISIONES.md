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

## DGG-10 · Campus = aula virtual real (Punto 6) — alcance definido
- **Decisión:** Rebuild de Campus de catálogo → aula virtual con:
  - **Cursos → módulos → lecciones**. Videos vía **embeds externos**
    (YouTube/Vimeo no listados), NO Supabase Storage (costo de egress).
  - **Acceso por asignación manual de gerencia** (sin autoservicio ni
    inscripción abierta). El gerente habilita alumno × curso.
  - **Alumnos**: administradores clientes (y potencialmente sus designados).
  - **Evaluación**: quiz de opción múltiple **autocorregido** (única
    condición que se completa sola).
  - **Certificado**: PDF automático con **QR verificable** (verifica que se
    emitió desde el campus). Diseño según modelo que el usuario proveerá
    (ASSET PENDIENTE).
  - **Condiciones del certificado configurables por curso** (combinación de
    opciones 3+1): cada curso define qué exige (aprobación de examen +
    asistencia a encuentros sincrónicos + pago completo + las que se
    definan). Gerencia/instructor tilda manualmente cada condición a medida
    que se cumple; la aprobación del examen es la única automática. **El
    envío del certificado por mail se dispara SOLO cuando TODAS las
    condiciones activas del curso están verificadas.**
- **Razón:** El usuario quiere un campus pedagógico real y un certificado
  con valor (verificable, condicionado), no un catálogo de videos.
- **Fecha:** 2026-05-22

### DGG-10bis · Refinamientos de Campus (2026-05-22, tras auditoría + diseño)
- **Estado base:** Campus YA existe (10 tablas, quiz autocorregido server-side,
  video embed, progreso, portal alumno). El rebuild es **extender + corregir**,
  no rehacer. Ver `CAMPUS_DESIGN.md`.
- **Cerrar autoservicio:** hoy el alumno se auto-inscribe (catálogo público +
  `matricularse()`). DGG-10 exige **asignación manual de gerencia** → cerrar el
  self-service, agregar RPC `curso_asignar_alumno` + drawer de asignación, y
  restringir `cursos_select_public`.
- **Pago del curso:** lo registra **gerencia manualmente** al verificar la
  acreditación (requiere revisión humana). NO emite facturación necesariamente
  (pero la habilita) y **SÍ registra un asiento de ingreso en la parte
  financiera** (movimiento de ingreso). Es una de las condiciones del
  certificado.
- **Asistencia sincrónica:** **registro formal por encuentro desde el MVP** —
  tabla de encuentros sincrónicos (fecha, link Zoom, tema) + asistencia
  tildada por alumno por encuentro. (Reutilizable para Webinars / DGG-11.)
- **Verificación del certificado:** página **pública sin login**
  (`/verificar/:codigo`) que confirma autenticidad con datos mínimos no
  sensibles.
- **Datos del certificado:** nombre del alumno + curso + fecha de emisión +
  instructor + **código verificable (QR)** + **nota del examen** + **logos y
  leyendas de entidades habilitadas** (aprobación oficial). Diseño visual:
  el usuario provee un **modelo de referencia** (ASSET — para construir algo
  similar). Fase 2.
- **ASSET del certificado RECIBIDO (2026-05-22):** 4 modelos FUNDPLATA en
  `~/Desktop/Diplomas FUNDPLATA2.pdf` (visual), `Diplomas FUNDPLATA.zip` (4
  PNG) y `Diplomas FUNDPLATA (3).zip` (4 **SVG editables** — usar estos como
  plantilla). Estructura: apaisado, título "CERTIFICADO", curso en dorado +
  año, nombre en cursiva script, cuerpo legal (habilitación FU.DE.CO.IN, Ley
  14.701 / Decreto 1734/22 / Disposición 27/23), fecha, 2 firmas (Pablo M.
  Parente – Presidente FU.DE.CO.IN · Dr. Pablo E. Acuña – Coordinador
  Académico), sello dorado con isotipo GG, banda "FUNDPLATA", "ORGANIZADO POR
  GESTIÓN GLOBAL". 4 temas de color: marino+dorado / dorado / cyan-teal /
  violeta. **Implementación Fase 2:** SVG como plantilla → reemplazar nodos de
  texto (nombre/curso/fecha) + inyectar QR (abajo-der o junto al sello) +
  código + nota → render a PDF. Copiar los SVG al repo al arrancar Fase 2.
- **PENDIENTE futuro (verificación Fase 1):** la constatación COMPLETA del
  circuito de pago requiere verificar que el asiento de ingreso se **acredite
  correctamente en la caja** (saldo, conciliación). Hoy sólo se inserta el
  `movimientos` (ingreso); el chequeo de impacto en caja/saldo no se puede
  validar hasta tener el **módulo de Finanzas** (PRONTO). Tenerlo presente al
  construir Finanzas. (2026-05-22)
- **Fases:** Fase 1 (M) = cerrar autoservicio + asignación manual + condiciones
  configurables por curso + checklist por matrícula + encuentros/asistencia +
  pago manual con asiento de ingreso. Fase 2 (M-L) = certificado PDF con QR +
  motor "certificado listo" + email + página pública de verificación (el render
  final espera el modelo del usuario).
- **Fecha:** 2026-05-22

## DGG-13 · Certificado ultra-premium (rediseño 2026-05-22)
- El PDF jsPDF-vector inicial quedó "berreta": logo GG diminuto/invisible,
  sin logo FUNDPLATA, diseño pobre. **Rediseño**: HTML/CSS premium con la
  misma estética de la web (gradiente cyan/navy, acentos triangulares, fuentes
  de marca, logos GG + FUNDPLATA reales, sello dorado con isotipo GG) →
  exportar con `html2canvas`→jsPDF (agregar html2canvas). 4 temas de color.
- **QR**: debe llevar a la URL pública premium de verificación (`/verificar/:codigo`)
  que muestra alumno, curso, nota, estilo. Robustecer la base URL (config en
  vez de sólo origin vercel) y dejar la página `/verificar` premium.
- Fecha: 2026-05-22.

## DGG-14 · Campus Fase 3 · Integración Zoom (clases sincrónicas dentro del campus)
- Las clases sincrónicas se organizan/dictan/asisten DENTRO del campus vía
  **Zoom (API + Meeting Web SDK)**: meeting embebido autenticado, **asistencia
  computada por login** (no manual), **grabación automática**, sin salir del
  campus. Roles a contemplar: alumno, docente, moderadora.
- Config de Zoom: el usuario está logueado y quiere que la haga yo
  (Marketplace app S2S OAuth / Meeting SDK) — requiere sus credenciales/acceso;
  a definir el flujo (browser automation sobre marketplace.zoom.us o guía).
- Premium sin gastar más en Zoom: maximizar SDK gratuito, simplificar gerencia.
- Evaluar accesos externos solo-por-link (no hay roles docente/moderador aún;
  a futuro: docente con acceso de edición a material/ejercicios).
- **Decisiones del usuario (2026-05-22, tras `CAMPUS_FASE3_DESIGN.md`):**
  - **Plan Zoom: Pro** → cloud recording disponible (grabación automática que
    queda como clase asincrónica), reuniones largas. 
  - **Crear roles `docente` y `moderador` en la plataforma YA** (no solo link
    host/co-host): auth + permisos + acceso al campus; a futuro el docente
    edita material/ejercicios.
  - **Config del Marketplace por browser automation** (Claude in Chrome con el
    usuario logueado en Zoom): crear las 2 apps (S2S OAuth + Meeting SDK),
    obtener las 6 credenciales, cargarlas en Supabase secrets.
  - Webinars con Meetings normales (no add-on). Acceso de prospecto sin login
    vía magic-link (molde acceso-externo) → `/webinar/:token`.
- Fecha: 2026-05-22.

## DGG-15 · Webinars dictados dentro del campus (públicos para prospectos)
- Los webinars (DGG-11) se dictan dentro del campus. Pueden ser **gratuitos y
  públicos**: para NO-alumnos (prospectos) sin permiso al resto de cursos.
- Mecanismo: el prospecto que se inscribe (form evento) recibe **acceso
  temporal y exclusivo al webinar SIN contraseña** (token/magic-link), pero
  dentro de la estructura premium del campus.
- Fecha: 2026-05-22. (Diseño pendiente, post-Fase-3 Zoom.)

## DGG-19 · Dual platform Zoom (simplificada) + Webex (embebido) · Webex parked
- **Contexto:** Iteramos 13+ versiones de embed Zoom (Meeting SDK Component
  View, luego Video SDK custom canvas) y verificamos en producción los límites
  duros del SDK: NO expone polls, breakouts, share screen propio ni gallery
  toggle. Para clases reales el alumno necesitaba salirse a Zoom oficial igual.
- **Decisión final (2026-05-23):**
  1. **Zoom = opción simplificada (link externo).** Botón grande "Unirme a la
     clase Zoom" → abre Zoom oficial en pestaña nueva. Bajo el botón:
     indicador "Tu asistencia se registra automáticamente". Los webhooks de
     Zoom siguen poblando `curso_encuentro_zoom_eventos` + asistencia
     (`fuente='zoom_auto'`) → todas las funciones de Zoom + asistencia
     automática garantizada. **Esto es lo que va a producción.**
  2. **Webex = opción embebida (scaffold, parked).** Toda la pila quedó armada
     y commiteada para activar de un click cuando el usuario suba al plan
     pagado: mig 0048 (`plataforma` enum + columnas `webex_*`), mig 0049
     (RPCs webex paralelos a los de Zoom), edge fn `webex-guest-token` (firma
     JWT), edge fn `webex-webhook` (HMAC SHA-1), `WebexLiveEmbed.tsx`
     (@webex/widgets + webex SDK), modal `WebexSetupModal` en EncuentrosTab,
     selector de plataforma con badge "Plan pagado · Scaffold listo".
- **Bloqueo Free plan (E-GG-15):** Los TRES caminos a guests embebidos en
  Webex requieren plan pagado:
  1. **Guest Issuer JWT** → DEPRECADO por Cisco (no se pueden crear nuevos).
  2. **Service App Guest Management** → "Only paid Webex subscribers may
     create guests" + requiere admin approval en Control Hub.
  3. **Instant Connect (G2G/WebRTC)** → "G2G site is accessible upon
     subscription/license activation".
- **Acción visible en UI:** El selector Webex en `EncuentrosTab` está
  deshabilitado con badge ámbar "Plan pagado" y tooltip explicativo. El
  gerente NO puede crear encuentros Webex hoy. Toda la BD y los componentes
  quedan compilados y deployados (cero deuda de migración).
- **Reactivación futura:** cuando el usuario suba a Webex pago, los pasos
  serán: (a) crear Service App en developer.webex.com con scopes Guest
  Management, (b) obtener admin approval en Control Hub, (c) cargar 3 secrets
  en Supabase (`WEBEX_SERVICE_APP_CLIENT_ID/SECRET`, `WEBEX_WEBHOOK_SECRET`),
  (d) habilitar el radio button (quitar `disabled` y badge "Plan pagado"),
  (e) registrar webhooks meetings.started/ended + meetingParticipants.*.
- **Fecha:** 2026-05-24.

## DGG-20 · Webinars públicos · dual canal Zoom + YouTube Live + magic-link
- **Decisión final (2026-05-24):** subsistema Webinars implementado completo
  (Fases A-G) como **tab dentro de /gerencia/formularios** (decisión del
  usuario: "lo que pasa después de un formulario tipo evento" vive junto).
- **Estrategia dual de canal:**
  1. **Zoom**: cupo configurable (Free=100). FCFS al inscribirse. Asistencia
     automática vía webhook (match por email del participante).
  2. **YouTube Live**: fallback público ilimitado. Cuando se llena Zoom, los
     nuevos inscriptos van a YouTube. Sin asistencia automática (no hay
     webhook de quién entra a un stream público).
- **Identidad del inscripto:** XOR cliente / prospecto.
  - Si el email matchea `administraciones.email` → vincula como cliente.
  - Si no → crea entidad `prospecto` liviana (separada de administraciones).
  - Email UNIQUE por webinar (idempotencia).
- **Magic-link `/webinar/:token`:** ruta pública (verify_jwt=false) que
  muestra: hero personalizado · countdown si futuro · botón "Unirme al
  webinar" si en vivo (Zoom o YouTube según canal asignado) · grabación
  si finalizado · CTA "Conocé Gestión Global" si es prospecto.
- **Conexión Formularios → Webinar (Fase E):** campo `formularios.webinar_id`
  + trigger AFTER INSERT en `formulario_submissions`: si categoria='evento'
  y webinar_id seteado → llama `inscribir_a_webinar` automáticamente.
- **Centro de prospectos (Fase F):** `/gerencia/formularios/prospectos` lista
  + filtros + botón "Convertir a cliente" (picker administración existente)
  → RPC `convertir_prospecto_a_cliente` relinkea inscripciones.
- **Recordatorios automáticos (Fase G):** plantillas seedeadas en
  `email_templates` (webinar-bienvenida + recordatorio-24h + recordatorio-1h).
  Trigger en `webinar_acceso_tokens` envía bienvenida al crear el token.
  Cron `gg-webinars-recordatorios` cada 15 min revisa webinars próximos en
  24h ±30min y 1h ±15min, idempotente por flags
  `recordatorio_24h_enviado_at` y `recordatorio_1h_enviado_at`.
- **Limitación documentada:** el match por email en webhooks de Zoom sólo
  funciona si el participante entra logueado en Zoom o escribe el email al
  unirse. Casos sin email (entrada por número de meeting + nombre suelto)
  quedan registrados en log sin vincular a inscripto.
- **Fecha:** 2026-05-24.

## DGG-21 · Módulo Finanzas · Bloque 1 (operaciones diarias)
- **Decisión (2026-05-24):** primer bloque del módulo Finanzas operativo,
  saca "PRONTO" del sidebar. Capitaliza la base ya construida (mig 0005 ·
  cajas + categorias + movimientos + imputaciones + VIEW cajas_con_saldo) y
  agrega las RPCs operativas faltantes.
- **Alcance Bloque 1 (mig 0055):**
  1. `fz_crear_movimiento_manual` · alta de ingreso/egreso manual con
     imputación opcional a comprobante.
  2. `fz_crear_transferencia` · atómica entre dos cajas (mismo moneda),
     pareja con `transferencia_pair_id`.
  3. `fz_revertir_movimiento` · contrasiento atómico (mueve a estado
     revertido + crea el inverso). Si era transferencia, **revierte ambas
     patas**. Borra imputaciones (trigger recalcula saldo comprobante).
  4. `fz_anular_movimiento` · soft delete (`estado='anulado'`) sin impacto
     en saldo. Bloqueado si tiene imputaciones.
  5. `fz_dashboard_kpis` · saldo_total, ingresos_mes, egresos_mes,
     pendientes, cajas_activas.
  6. `fz_listar_movimientos` · paginado con filtros (caja, tipo, fechas,
     search, anulados, revertidos).
- **UI (`/gerencia/finanzas`):** dashboard con KPI strip + grid de cajas
  con saldo + tabla de movimientos con filtros + modales (nuevo, transferir,
  revertir, anular).
- **Multi-moneda parked:** ARS only por ahora (decisión del usuario). Las
  cajas USD existen en seed pero la transferencia entre monedas distintas
  devuelve error. Multi-moneda con tipo de cambio queda para futuro.
- **CSV bancario (Bloque 2):** formato propio definido por el usuario:
  **fecha, descripción, ingreso, egreso (puede ser una columna con signo),
  observaciones, saldo**. El usuario descargará el Excel y completará con
  los datos de su cuenta. Universaliza independiente del banco.
- **Roadmap Bloque 2 (próximo):** importador CSV custom + motor de
  conciliación chunked (capitaliza MANAXER 0101) + UI de conciliación
  interactiva con borrador + decisiones + patrones aprendidos.
- **Fecha:** 2026-05-24.

## DGG-22 · Finanzas Bloque 2 · conciliación bancaria con formato CSV universal
- **Decisión (2026-05-24):** subsistema de conciliación bancaria construido
  con un **formato CSV universal propio**, no por banco. El usuario descarga
  una plantilla con columnas fijas (fecha, descripcion, ingreso, egreso,
  observaciones, saldo), completa con los datos de SU cuenta (cualquier
  banco), y sube. Esto universaliza el flujo sin depender de parsers
  específicos por entidad bancaria.
- **Arquitectura (mig 0057):**
  1. `historico_banco_lotes` · cada importación queda auditada
     (archivo, total, nuevas, duplicadas).
  2. `historico_banco` · líneas del extracto. Hash SHA-256 de
     caja|fecha|desc|ingreso|egreso|saldo como dedup global por caja
     (re-importar el mismo CSV no duplica). CHECK XOR ingreso/egreso.
     FK opcional a `movimientos` cuando se concilia.
  3. `patrones_conciliacion` · aprendizaje opcional pattern→categoría/admin
     para sugerir auto-categoría en líneas futuras similares.
- **Motor de matching (fz_sugerir_matches):** busca movimientos del sistema
  con MISMO monto exacto, misma caja, mismo tipo, en ventana de ±5 días.
  Excluye anulados, revertidos, reversiones y los ya vinculados. Score
  = 100 - dias_diff*5. Ordena por proximidad de fecha.
- **3 flujos de conciliación por línea:**
  1. **Vincular** con movimiento existente sugerido.
  2. **Crear nuevo** movimiento (origen='conciliacion_auto') con
     categoría + admin + descripción custom + opción "Aprender patrón".
  3. **Ignorar** (saldo inicial, error del banco, línea informativa).
- **CSV parser robusto (papaparse + helpers):** tolerante a separadores
  `,`/`;`, fechas DD/MM/YYYY o YYYY-MM-DD, montos formato AR (1.234,56) y
  US (1,234.56). Headers flexibles con aliases (descripcion/concepto/detalle,
  ingreso/haber/credito, egreso/debe/debito, monto con signo).
- **Decisiones descartadas:**
  - **Parsers por banco** (Galicia/Santander/BBVA): rechazado por
    fragilidad — cada banco cambia formato; el universal es estable.
  - **Importar Excel directo (.xlsx)**: rechazado por simplicidad — CSV es
    más simple, exportable desde cualquier banco/Excel y editable.
  - **Multi-moneda en CSV**: cada caja es mono-moneda; conciliación es
    por caja. Multi-moneda con tipo de cambio queda para futuro.
- **Verificado e2e en navegador**: 4 líneas importadas → 1 vinculada con
  match sugerido (mismo día del Campus) → 1 creada como egreso nuevo con
  categoría aprendida → 1 ignorada. Dedup confirmado (re-import = 0 nuevas).
- **Fecha:** 2026-05-24.

## DGG-11 · Webinars/Eventos = subsistema de captación (post-Campus)
- **Decisión:** Los formularios tipo `evento` dejan de ser submission crudo
  y alimentan un subsistema de captación comercial:
  - **Lista de inscriptos por evento** con recordatorios programados + link
    de Zoom hasta la fecha del encuentro.
  - **Segmentación cliente vs no-cliente** (no mandar invitaciones
    redundantes a clientes existentes).
  - **Centro de promociones** para empujar a la contratación efectiva.
  - Cada inscripto se registra como **servicio gratuito en cuenta corriente**
    para capitalizar la info del formulario, medir conversión webinar→cliente
    y fidelización de clientes existentes.
  - **No-cliente → entidad `prospecto` liviana** (separada de la cartera de
    clientes reales) con su línea de servicio $0 en cuenta corriente;
    convertible a cliente con un click al contratar. NO se ensucia la lista
    de clientes con leads no convertidos.
- **Momento:** se construye **después de Campus** (Punto 6). Por ahora queda
  documentado; el comportamiento actual (evento no genera solicitud) se
  mantiene hasta entonces.
- **Razón:** Los webinars son la fuente principal de captación de potenciales
  clientes; el subsistema debe ser un motor comercial, no un buzón pasivo.
- **Fecha:** 2026-05-22

## DGG-29 · Cierre Track A · decisiones sobre items parqueados (pre-E2)
- **Contexto:** Antes de la revisión end-to-end (E2) y el manual oficial (K),
  se revisaron todos los items parqueados del Punto 2 (P2) y del backlog
  general para tomar decisiones explícitas de descarte, posposición o
  ejecución. El objetivo es que no quede nada "en el tintero" al cerrar el
  ciclo del producto MVP.
- **Decisiones tomadas (2026-05-31):**

  | Item | Decisión | Racional |
  |---|---|---|
  | **Webex como proveedor de video** (DGG-19) | **Dejar scaffold latente** | Edge fns webex-* y secrets WEBEX_* se mantienen; UI selector queda deshabilitada. Permite reactivar a futuro sin re-build si Zoom presenta problemas o un cliente lo solicita. |
  | **Multi-moneda (USD)** | **Descartar** | Mercado argentino. Si surgen casos puntuales, se anota el monto en notas del comprobante. No justifica columna `moneda` ni cuenta corriente segmentada. |
  | **#37 Multi-idioma EN/PT (i18next)** | **Descartar** | Plataforma diseñada para administradores argentinos; el copy rioplatense es feature, no bug. Refactor masivo sin demanda. |
  | **#38 API pública OpenAPI/Swagger** | **Descartar** | Sin demanda de integradores externos. PostgREST de Supabase está disponible si surge un caso, documentable on-demand. |
  | **#23 Email tracking pixel** (open/click) | **Posponer** | Los emails ya funcionan; tracking no es bloqueante para el manual. Considerar para fase de optimización de marketing. |
  | **#25 Exportes programados (cron)** | **Descartar** | ExportButtons manuales cubren el caso. Los administradores pueden agendarse manualmente cuando lo necesiten. |
  | **Gmail Pub/Sub (real-time vs cron)** | **Descartar** | El cron de 30 min para bounce/reply harvester es robusto, simple y suficiente. <1 respuesta/día de clientes; bounces raros porque validamos email al alta. La complejidad de GCP Pub/Sub + renovación 7d del watch() no se justifica. |
  | **2FA con hardware keys (WebAuthn)** | **Descartar** | Supabase Auth no soporta WebAuthn nativo (requiere AAL2 custom). TOTP (D6) ya cubre 99% de la necesidad. Reconsiderar cuando Supabase lo añada oficialmente. |
  | **Campus L2** (foros, badges, learning paths, SCORM) | **Descartar** | Campus L1 cubre el caso real (cursos+webinars para administradores). L2 sería producto educativo separado, no roadmap MVP. |
  | **Mejoras MDC handoff a Agenda** (10 items del doc `AGENDA_GERENCIAL_HANDOFF.md`) | **Implementar todo** | Segunda pasada premium sobre la Agenda. Incluye gestos drag/resize/paint, cadencia humana de recordatorios, modal panel lateral animado, copy rioplatense, círculo tilde Apple Tasks, AccionesMenu flotante con clamp, posponer relativo a evento. (Parser NL ya hecho en B6). |

- **Acciones de cleanup ejecutadas en este chunk:**
  1. **A1 · alta-cliente-portal** · agregados `console.error` estructurados
     en las 3 rutas de error (administración no encontrada, createUser
     falló, vincular admin↔user falló) para observabilidad en deploy.
  2. **A2 · CtaCteListPage** · empty state plano reemplazado por
     `<IllustratedEmpty>` (variant 'edificio' si rows=0 con CTA Importar
     histórico, 'busqueda' si filtros sin match).
  3. **A3 · .env.example** · documentación completa de TODAS las variables
     del proyecto agrupadas por área (Supabase core, Cron auth, Email
     Workspace + OAuth, Web Push VAPID, Zoom, Webex). Comentarios sobre
     origen y dónde setearlas (Supabase secrets vs Vercel env vars).
  4. **A4 · este documento** · decisiones explícitas sobre 10 items
     parqueados.

- **Auditoría B-MDC post-commit Track A (2026-05-31):** Antes de levantar el
  sub-proyecto, auditamos cada uno de los 10 items del handoff contra el
  código actual. Resultado: **TODOS YA ESTÁN IMPLEMENTADOS** a través de
  rondas previas. Inventario:

  | # | Item handoff | Dónde se implementó |
  |---|---|---|
  | 1 | Parser NL rioplatense | `src/lib/agendaParse.ts` + BarraMagica + B6/CommandPalette (task #215) |
  | 2 | Recurrencia virtual + overrides | mig 0038 (`agenda_event_overrides`) + `src/lib/agendaRecurrencia.ts` |
  | 3 | Gestos drag/resize/paint | `VistaSemana.tsx` líneas 194-560 (paint en col vacía, drag con snap 15min, resize por manija inferior) |
  | 4 | Círculo tilde Apple Tasks con stopPropagation | `CirculoHecha.tsx` (E12 aplicado) |
  | 5 | AccionesMenu flotante con clamp robusto | `AccionesMenu.tsx` con `useLayoutEffect` recalculando con `subOpen` (E7) |
  | 6 | Posponer relativo a fecha del evento | `AgendaPage.tsx` línea 369 + `calcularPosponer()` (E11) |
  | 7 | Cadencia humana recordatorios (1° + 5h + cierre 20:00 + atrasados 09:00-09:20) | mig 0039 `gg_agenda_procesar_recordatorios()` + cron `agenda-recordatorios` |
  | 8 | Modal panel lateral animado para vínculos | `EventoModal.tsx` líneas 120/223/407 con `panelOpen` + transición `max-w-md ↔ max-w-3xl` (E8) |
  | 9 | Command palette ⌘K scope-aware | B5 task #214 + B6 task #215 |
  | 10 | Copy rioplatense + emojis en notif | mig 0039 con "👀 No te cuelgues" / "⏰ Te marco de nuevo" / "🌙 Última por hoy"; subtítulo "Tirá lo que tengas en la cabeza — yo lo ordeno" en AgendaPage línea 596 |

- **Conclusión:** la decisión "Implementar todo MDC handoff" se cierra como
  **YA EJECUTADA**. El backlog item original era stale (refería a un
  estado del proyecto previo a Bloque A Fase 2 + B5/B6). No queda
  implementación pendiente sobre MDC handoff. Pasamos directo a **E2 ·
  Revisión end-to-end del proyecto**.

## DGG-30 · Auth multi-rol · reintentos+backoff+signOut en loadProfile

- **Origen:** handoff de MDC del 2026-06-01
  (`docs/handoff-auth-multirole-checklist.md`) sobre un incidente real:
  una usuaria con rol `gerencia` no podía entrar; cuando logró entrar
  fue tratada como `empleado` con UI vacía. Causa raíz: el frontend
  **fabricaba un usuario sintético con rol mínimo** cuando la carga
  del profile fallaba por timeout/red. RLS del backend funcionaba bien;
  el bug era 100% del frontend.

- **Diagnóstico aplicado a Gestión Global:** auditamos
  `src/contexts/AuthContext.tsx::loadProfile` contra las 3 reglas de
  oro del handoff. Resultado:
  - **Regla 1 (no fabricar perfil):** PASA — Gestión Global nunca
    inventó un usuario sintético.
  - **Regla 2 (reintentar antes de rendirse):** PARCIAL — había UN solo
    reintento de 350ms, sólo para el caso "trigger handle_new_user en
    vuelo" post-signup. No había reintentos por red flaky / timeout.
  - **Regla 3 (signOut si falla todo):** PARCIAL — no se hacía
    signOut, la sesión auth quedaba viva sin profile cargado (estado
    inconsistente).

  Además, no se distinguía "perfil no existe" vs "error técnico", y
  no se logueaba a consola con detalle (diagnóstico ciego en prod).

- **Decisión:** implementar los 3 huecos en `loadProfile`:

  1. **Watchdog + reintentos con backoff.** 3 intentos con timeouts
     crecientes `[8s, 9s, 12s]` usando `Promise.race` contra un
     `setTimeout` que rechaza. Backoff entre intentos: `350ms` (cubre
     el caso trigger-en-vuelo) y `1000ms` (cubre transients de red).
     Worst case ~31s hasta darse por vencido — mejor que el "Cargando…"
     infinito de antes si supabase-js cuelga la query.

  2. **Distinción null vs error técnico.** Cada intento clasifica su
     resultado en `'success' | 'null' | 'error'`. Si ≥2 intentos
     respondieron `null` y NINGUNO dio error técnico, marcamos
     `profileMissing=true` (perfil realmente no existe en DB → UI
     "Hablá con un gerente"). Si hubo CUALQUIER error técnico tras
     agotar reintentos, marcamos un flag nuevo `profileLoadFailed=true`.

  3. **`signOut()` automático tras N fallos técnicos.** Cuando
     `profileLoadFailed=true` se setea, el AuthContext llama
     `supabase.auth.signOut()`, limpia `persistSession(null)` y resetea
     `session`/`user` a `null`. `App.RoleHomeOrLanding` tiene una rama
     nueva que muestra "No pudimos completar el inicio de sesión.
     Verificá tu conexión a internet y volvé a ingresar." + CTA a
     `/ingresar`. La rama se evalúa **antes** de `profileMissing` y
     **antes** de cover/landing para evitar flash post-signOut.

  4. **Logging con `console.error`.** Cuando se agotan los reintentos
     con error técnico, se loguea `userId`, `lastError.message` y
     `nullCount` para diagnóstico desde DevTools.

- **Por qué NO replicamos otros patrones del handoff:**
  - Realtime sobre `profiles` del usuario actual (para expulsar al
    desactivar/cambiar rol en vivo) → al BACKLOG, no urgente: hoy
    `reloadProfile()` manual cubre los casos.
  - Página `/403` dedicada en vez de redirect a `/` cuando el rol no
    calza → al BACKLOG, menor; el dispatcher actual ya redirige bien.
  - Cache local del último perfil válido (offline-first) → descartado,
    igual que el handoff lo descarta: agrega complejidad sin caso de uso.
  - Indicador "reconectando..." durante reintentos → descartado por la
    misma razón.

- **Backend no cambia:** RLS (regla 2), tenancy guards (regla 12),
  role server-side (no en JWT claim) y RPCs SECURITY DEFINER siguen
  siendo la defensa real. Este chunk sólo cierra el agujero UX del
  frontend para que un transient de red no resulte en pantalla
  rara/colgada.

- **Archivos tocados:** `src/contexts/AuthContext.tsx` (refactor de
  `loadProfile` + nuevo flag `profileLoadFailed` en `AuthState`),
  `src/App.tsx` (nueva rama en `RoleHomeOrLanding`).

- **Fecha:** 2026-06-01 · commit `ffeac79`.
- **Fecha:** 2026-05-31
