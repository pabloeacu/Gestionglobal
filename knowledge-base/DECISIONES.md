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
- **Fases:** Fase 1 (M) = cerrar autoservicio + asignación manual + condiciones
  configurables por curso + checklist por matrícula + encuentros/asistencia +
  pago manual con asiento de ingreso. Fase 2 (M-L) = certificado PDF con QR +
  motor "certificado listo" + email + página pública de verificación (el render
  final espera el modelo del usuario).
- **Fecha:** 2026-05-22

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
