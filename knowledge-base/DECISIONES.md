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

## DGG-45 · Motor de reglas de banners ("oportunidades") del portal

- **Origen** (Pablo, 2026-06-04): Estudio Save ya se matriculó (trámite
  "Inscripción al RPAC" cerrado) pero seguía viendo el banner "Matriculate
  como administrador" en el inicio del portal. Causa: el motor definía
  "matriculado" SÓLO como `administraciones.matricula_rpac IS NOT NULL`, y
  gerencia nunca cargó el número de matrícula. Pablo pidió repasar las reglas
  de banners de "publicidad" como un motor coherente.

- **Decisión — "matriculado" robusto** (Pablo, opción elegida): un cliente es
  matriculado si `matricula_rpac IS NOT NULL` **O** tiene un trámite de
  matrícula cerrado (servicio `Inscripción al RPAC%`). Así, aunque falte el
  número, el sistema ya no le ofrece matricularse. Banner "Matriculate" sólo
  si NO matriculado.

- **Reglas del motor** (todas en `cliente_portal_dashboard`, mig 0196):
  | Prioridad | Banner | Condición | Bucket |
  |---|---|---|---|
  | 10 | DDJJ vence pronto | DDJJ vigente 0-60d | acción |
  | 20 | Renová matrícula | matriculado + vence 0-60d | acción |
  | 30 | Matriculate | NO matriculado | acción |
  | 40 | Cumplí tu actualización | matriculado + sin actualización este año | acción |
  | 55 | DDJJ — arrancá temprano (NUEVO) | diciembre + matriculado + DDJJ sin iniciar | suave |
  | 60 | Certificado de acreditación (NUEVO) | matriculado, cada 90d | suave |
  | 70 | Consultoría jurídica (NUEVO) | matriculado, cada 120d | suave |
  | 80 | Webinar gratuito | no inscripto al próximo | suave |

- **Decisiones de Pablo** (vía AskUserQuestion):
  1. **Cantidad**: máx **2** banners — top-1 acción/obligación + top-1 suave.
  2. **Recurrencia** (suaves): "desde la última vez mostrado" — el banner se
     marca visto hoy (`last_shown_at`) y no reaparece hasta N días después.
  3. **Posponer**: los suaves tienen botón "Recordar más tarde" → snooze 30d.

- **Infra** (mig 0195): tabla `cliente_oportunidad_eventos`
  (administración, código → `last_shown_at`, `snoozed_until`) + RPCs
  `cliente_oportunidad_marcar_mostrada(text[])` y `_posponer(text)`. El
  dashboard (DEFINER) lee la tabla para decidir; el front llama `marcar` al
  renderizar suaves y `posponer` desde el botón. CTAs → `/formulario/:slug`.

- **Refinamientos DGG-45r (mig 0197 · implementados, Pablo "no dejés nada
  pendiente")**:
  1. **No upsell con deuda**: certificado + consultoría (cross-sell pago) se
     callan si `cliente_deuda_neta.total > 0`.
  2. **Gracia recién llegados**: certificado + consultoría + webinar no se
     muestran los primeros 15 días desde `administraciones.created_at`.
     (`v_puede_crosssell = NOT deuda AND NOT recién_llegado`.) `ddjj_diciembre`
     y las obligaciones NO se suprimen; el webinar (gratis) se gatea por
     gracia pero no por deuda.
  3. **Operativo**: trigger `trg_tramite_matricula_recordar_numero`
     (AFTER UPDATE OF estado en `tramites`) → al cerrar un trámite de matrícula
     inicial con `matricula_rpac` NULL, llama `notify_all_gerentes` (campana,
     sin email) para que gerencia cargue el número. Cierra la causa raíz.
  - Verificado e2e: Estudio Save (recién llegado) → cross-sell suprimido (sólo
    queda la obligación); el trigger creó 2 notif a gerencia al cerrar la
    matrícula sin número.

- **Verificado e2e** bajo JWT real del cliente Estudio Save: `matricula_inicial`
  ausente (matriculado por trámite cerrado); oportunidades = {curso_actualizacion,
  certificado_acreditacion}; posponer certificado lo oculta y entra consultoría.

- **Fecha:** 2026-06-04 · migs 0195+0196 · `portal-dashboard.ts` · `PortalHome.tsx`.

## DGG-44 · Gate de cobranza al avanzar un trámite en el kanban

- **Decisión** (Pablo, 2026-06-04): al **avanzar** un trámite en el kanban
  (botón → o drag&drop hacia una columna posterior), si el trámite tiene un
  **comprobante con costo (total > 0) e impago (saldo_pendiente > 0)**, el
  sistema muestra una ventana de confirmación:
  *"Este trámite no tiene cobranza registrada. Por lo tanto, está impago.
  ¿Desea avanzar la gestión de todos modos?"* con botones **Avanzar** /
  **Cancelar**. Es un **soft gate**: el operador siempre puede continuar.

- **Origen**: Pablo avanzó el certificado de acreditación TRM-2026-00023 de
  Abierto → En progreso sin haber cargado el cobro. "Excepto DDJJ, el resto,
  para avanzar, requiere pagos previos." En vez de hardcodear la excepción
  DDJJ, se generaliza con la señal de cobranza.

- **Por qué la regla es general** (cubre los 3 casos de Pablo sin listas
  hardcodeadas de servicios):
  - **Sin comprobante** (típico DDJJ) → no hay cargo → no advierte.
  - **Comprobante $0,00** (webinar, servicio bonificado al 100%) → total 0
    → no advierte.
  - **Comprobante con costo, ya cobrado** (saldo 0) → no advierte.
  - **Comprobante con costo, impago** (saldo > 0) → **advierte**.

- **Modelo de datos** (verificado en vivo): el comprobante del trámite se
  vincula vía `solicitudes.comprobante_id` (con `solicitudes.tramite_id`),
  NO por el campo directo `tramites.comprobante_id` (siempre NULL en flujos
  de formulario). La señal contempla ambos caminos por robustez.

- **Implementación**:
  - **Backend** (mig 0193 + hardening 0194): computed column
    `cobro_pendiente(public.tramites)` — función SQL `STABLE SECURITY INVOKER`
    que PostgREST expone como columna virtual. `EXISTS` de un comprobante no
    anulado, `total>0`, `saldo>0`, por cualquiera de los dos caminos.
    `GRANT EXECUTE` sólo a `authenticated` (anon revocado). Índice parcial en
    `solicitudes(tramite_id)`.
    - **Hardening (mig 0194)**: la 0193 la creó `SECURITY DEFINER` y el
      advisor `0029` la marcó (un autenticado podía invocarla vía
      `/rest/v1/rpc/cobro_pendiente` salteando RLS → fuga del booleano
      "impago"). Se pasó a `SECURITY INVOKER`: para el kanban (staff, que
      lee todo por `comprobantes_select` + `sol_staff_all`) el resultado es
      idéntico, y un cliente sólo vería sus propias filas. Verificado bajo
      RLS real de gerente (impago→true, sin_comprobante→false) y advisor
      limpio.
  - **Frontend** (`tramites.ts`): `listTramites` selecciona `cobro_pendiente`;
    helper `esAvanceTramite(from,to)` que usa `ESTADO_ORDEN`
    (abierto<en_progreso<esperando_cliente<resuelto<cerrado; cancelado=-1).
  - **Kanban** (`TramitesKanbanPage.mover`): antes del optimistic update, si
    `esAvanceTramite(...) && t.cobro_pendiente` → `useConfirm()` (R13, sin
    `window.confirm`). Cancelar deja la tarjeta donde está.

- **Alcance**: sólo **avances** (no regresiones, no a/desde cancelado). El
  único punto de avance es el kanban — `/gerencia/tramites/:id` es redirect
  legacy muerto (E-GG-35), el MetadataDrawer no edita estado, y "Reabrir" es
  flujo aparte con su propio diálogo. Sin bypass.

- **Nota abierta**: el warning también salta al mover a "Esperando cliente"
  (que a veces es justo donde se deja un trámite *porque* se espera el pago).
  Se dejó uniforme ("cualquier avance", palabras de Pablo); excluir ese
  estado sería 2 líneas si molesta.

- **Alternativas descartadas**: (a) hard gate en BD/trigger — descartado,
  Pablo quiere poder avanzar igual; (b) hardcodear "DDJJ exento" — frágil,
  no contempla webinars/bonificados; (c) embeber comprobante en el select
  y computar el booleano en el front — más datos y lógica en el cliente
  (viola el espíritu de R4).

- **Fecha:** 2026-06-04 · mig 0193 · `tramites.ts` · `TramitesKanbanPage.tsx`.

## DGG-43 · Derivación a gestoría con asiento contable integrado

- **Decisión** (Pablo, 2026-06-04): cuando gerencia deriva una solicitud
  a la gestoría externa y declara un monto que la empresa paga, el
  sistema **debe asentar ese egreso en la caja automáticamente**. No
  hay que hacer el doble registro manual (derivar + cargar movimiento)
  ni dejar que se descuadre la contabilidad.

- **Cómo funciona**:
  - En el wizard de derivación (`WizardActivacion.tsx` paso 1), cuando
    el operador escribe un monto > 0 aparece un sub-bloque cyan:
    **"💼 Imputación contable"** con un selector de caja que pre-elige
    la caja default (`cajas.es_default`). El operador puede confirmar
    o cambiar.
  - Si confirma con caja: la RPC `solicitud_derivar_v3` (mig 0189)
    llama internamente a `solicitud_derivar_v2` (que envía el email y
    persiste adjuntos) y, en la misma transacción, **inserta un
    movimiento egreso** con:
    - `tipo='egreso'`, `estado='identificado'`
    - `origen='derivacion_gestoria'` (valor nuevo agregado al CHECK)
    - `categoria_id` → "Gastos de gestoría" (creada idempotente)
    - `referencia='SOL:<solicitud_id>'`
    - `descripcion='Pago a gestoría · <destinatario> · solicitud <id8>'`
    - `administracion_id` heredado del cliente de la solicitud
  - Vincula `solicitud_derivaciones.movimiento_id` con el mov creado.
  - Toast premium: "Solicitud derivada y pago registrado. Mail enviado
    a X. Egreso de $Y imputado en `<caja>`."

- **Si el operador NO elige caja**: la derivación funciona como antes
  (v2), sin movimiento. Eso preserva el caso "registro nominal sin
  impacto financiero".

- **Categoría del egreso · "Servicios de Gestoría"** (corrección DGG-43 v2,
  Pablo 2026-06-04): inicialmente (mig 0189) creé una categoría nueva
  "Gastos de gestoría" siguiendo el "si no existe, creala". Pablo
  corrigió: *"Servicios de gestoría es una buena categoría. No hace
  falta crear una nueva. Si ya lo hiciste, eliminala y redirigí el
  gasto bajo la categoría existente."*
  - **Mig 0190**: el RPC ahora hace lookup default a la categoría
    EXISTENTE "Servicios de Gestoría" (id `4d2019ef-…`). La categoría
    "Gastos de gestoría" se eliminó (verificado: 0 movimientos, 0
    derivaciones vinculadas → borrado seguro con guarda NOT EXISTS).
  - Aprendizaje: antes de crear una categoría nueva por instrucción
    literal, chequear si ya existe una semánticamente equivalente y
    proponer reusarla. El catálogo de finanzas debe quedar chico y
    legible para los reportes.

- **Operación del movimiento post-creación** (requisito: "que opere
  como cualquier otro pago"):
  - Aparece en Finanzas → Dashboard → Movimientos recientes con su
    categoría, descripción y monto.
  - Se puede **revertir** con `fz_revertir_movimiento` → crea
    contrasiento ingreso y el original queda `revertido_at` seteado.
  - Se puede **anular** con `fz_anular_movimiento` si NO está revertido
    y no es contrasiento (guardas E-GG-47 aplican).
  - Los KPIs de finanzas (saldo total, egresos del mes) lo cuentan.

- **Alternativas descartadas**:
  - **Auto-crear el movimiento siempre** que haya monto: descartado
    porque rompería derivaciones legítimas sin impacto financiero
    (ej. retroactivos, transferencias ya hechas por afuera).
  - **Pedir la caja después** en un modal aparte tras derivar:
    descartado porque pierde atomicidad. Si el operador deriva y
    después se distrae, queda derivación sin asiento → contabilidad
    descuadrada.
  - **Crear NUEVA categoría con código fijo + slug**: descartado
    porque el catálogo ya tiene solo `nombre` como identificador y el
    lookup es por nombre exacto. Es simple y consistente.

- **Smoke e2e in-mig**: BEGIN; deriva con $35.000 en MP. Gestión
  Global; verifica delta = -35.000 + vinculación derivación ↔
  movimiento; ROLLBACK. Producción intacta. Confirmado.

- **Auditoría a fondo** (2 agentes paralelos):
  - Integridad contable del nuevo flujo: OK. Movimiento pasa por las
    guardas de E-GG-47 al intentar anular (sin imputaciones, sin
    revertido, no contrasiento → permitido). Revertir crea
    contrasiento + deja `revertido_at` en el original; la UI no
    rompe.
  - GAP detectado análogo (no del chunk DGG-43 pero del mismo patrón):
    `partner_marcar_rendicion_pagada` SOLO cambia el flag a 'pagada'
    sin crear movimiento egreso. Lo dejo como **mejora futura
    (DGG-44 propuesto)**: cuando se marca una rendición como pagada,
    pedir caja y crear movimiento egreso atómico también.

- **Pateado a backlog**:
  - Idempotencia hard contra doble click (hoy se mitiga con `busy1`
    del frontend, pero no hay constraint UNIQUE en BD).
  - Indicador visual en derivación cuando su movimiento vinculado
    fue revertido o anulado posteriormente.

- **Fecha**: 2026-06-04. Migs: 0189 (mig principal), 0189b (fix
  columna `codigo`), 0189c (CHECK constraint origen).

## DGG-42 · Reapertura de trámites como evento de primera clase

- **Decisión** (Pablo, 2026-06-04): el cierre de un trámite NO es
  irreversible. Gerencia puede reabrir un trámite cerrado y el efecto
  debe propagarse a TODAS las vistas (cards del cliente, KPIs, reportes,
  chips de solicitudes). Implementado como evento explícito con
  registro de historia + opt-in de notificación al cliente.

- **Modelo conceptual**:
  - `tramites.estado='cerrado'` no implica inmutabilidad. Es un estado
    como cualquier otro.
  - Al reabrir: `estado='en_progreso'`, se VACÍAN los campos del cierre
    (`fecha_fin`, `motivo_cierre`, `cierre_satisfactorio`,
    `resuelto_at`, `resuelto_por`). Estos quedaban como "huella" del
    cierre vigente, no como historia. Si el trámite se cierra de nuevo,
    estos se vuelven a poblar con el nuevo cierre.
  - La HISTORIA queda en 3 columnas nuevas:
    - `reabierto_count` (int, default 0) — cuántas veces se reabrió.
    - `ultima_reapertura_at` (timestamptz) — cuándo.
    - `ultima_reapertura_motivo` (text) — por qué.
  - La línea de tracking de cierre NO se borra, queda en el historial
    visible. Se agrega encima una línea nueva con
    `categoria='reapertura'`, `estado_asociado='reabierto'`, descripción
    `"Trámite reabierto. Motivo: <texto>"`, visible al cliente.

- **Notificación al cliente — opt-in**:
  - Default OFF. El operador decide caso por caso.
  - Si la reapertura es interna (corregir error de gerencia que el
    cliente nunca vio) → OFF.
  - Si la reapertura cambia algo que ya comunicamos (mail de cierre,
    push, banner celebración cert) → ON.
  - Cuando es ON: encola email con plantilla `tramite-reabierto`
    (kicker "GESTIÓN ACTUALIZADA", color cyan, motivo destacado como
    cita) + push a todos los usuarios del cliente.

- **Cobertura del impacto** (verificado, no nuevas RPCs necesarias):
  - **Card en CC del cliente / Mis Gestiones**: `cliente_tramites_listar`
    filtra por `estado IN ('abierto','en_progreso','esperando_cliente')`.
    Trámite reabierto vuelve a aparecer automático.
  - **KPI "Resueltos"**: `PortalGestionesPage` calcula en memoria sobre
    el universo completo (E-GG-43); cuenta `estado === 'cerrado'`. Al
    reabrir, deja de contar.
  - **Card en Solicitudes Recibidas** (E-GG-45): `listSolicitudes`
    joinea `tramites.estado`. El chip "Trámite cerrado" desaparece
    porque el join devuelve el estado actual.
  - **Banner celebración cert (DGG-41)**: el banner mira
    `certificados.celebracion_vista_at`, NO el estado del trámite. Si
    el cert se mantuvo (no se revocó), el banner sigue siendo válido.
    Si querés que desaparezca, hay que revocar el cert aparte (flujo
    separado, no incluido en DGG-42).

- **Alternativas descartadas**:
  - **Bloquear reapertura con trigger**. Era la opción defensiva, pero
    Pablo es claro: la reapertura ES un caso de uso real (errores de
    gerencia). Bloquearla obligaría a hacer trampa con un nuevo trámite.
  - **Generar línea de tracking sin cambiar estado**. Mantendría la
    auditoría pero no propagaría a las cards/KPIs. Anti-patrón
    contradice DGG-42 (debe impactar en todos los reportes).
  - **Cerrar el cert/celebración al reabrir**. El cert es independiente
    (puede emitirse con el trámite abierto o cerrado). Mezclarlos
    confunde modelos.

- **Smoke e2e**:
  - 3 guards in-mig: no existe / no cerrado / motivo vacío. OK.
  - Reabrir TRM-2026-00015 en BEGIN/ROLLBACK: estado pasó
    `cerrado`→`en_progreso`, `fecha_fin` a NULL, `motivo_cierre` a NULL,
    `reabierto_count` 0→1, línea automática con `categoria='reapertura'`.
    Producción intacta post-rollback.

- **Mig**: `0188_tramite_reabrir_email_y_partner_dedup.sql`.
  Componente UI nuevo: `ReabrirTramiteDialog.tsx`.
  Servicio nuevo: `reabrirTracking()` en `services/api/trackings.ts`.

- **Fecha**: 2026-06-04.

## DGG-42 audit · Dedup atribuciones de rendiciones partner

- **Decisión**: `partner_crear_rendicion` excluye comprobantes y
  movimientos que YA están atribuidos a OTRA rendición, sin importar
  el estado de esa rendición (borrador / cerrada / pagada / cancelada).
- **Razón**: hallazgo de la auditoría E-GG-47 (Agente A): rendiciones
  canceladas dejaban los movs disponibles para re-atribuir en la
  próxima → doble contabilización si la cancelación fue por error.
- **Política**: una vez que un mov está atribuido a una rendición, está
  fuera del pool hasta que se des-atribuya explícitamente (limpiar
  `movimientos.partner_id_atribucion`). Esto incluye los de rendiciones
  canceladas — la cancelación NO es señal automática de "estos movs
  vuelven al pool".
- **Cómo "re-incluir" si fue error**: el operador debe des-atribuir el
  movimiento manualmente (futuro: UI para reasignar
  `partner_id_atribucion`).
- **Fecha**: 2026-06-04.


## DGG-41 v2 (auditoría doble) · Cierre de huecos del chunk celebración

Después de cerrar DGG-41 corrió la **doble auditoría a fondo** (método
del CLAUDE.md §6) con 3 agentes en paralelo. Hallazgos y fixes:

| Sev | Hallazgo | Fix |
|---|---|---|
| 🔴 | **R6 GAP**: 0184 no otorga `GRANT EXECUTE` de las 2 RPCs nuevas a `authenticated`. Funcionaría hoy por el grant default histórico, pero el 30/10/2026 Supabase cambia ese default y rompería | **Mig 0185** con GRANTs explícitos + bloque smoke `BEGIN; SET LOCAL role authenticated; PERFORM ...; ROLLBACK;` que cierra R6 + R18 al mismo tiempo |
| 🔴 | **Banner inline sin vínculo curso↔trámite**: `PortalGestionDetailPage` renderizaba `<CertCelebracionBanner variant="inline" />` cuando `tramite.categoria === 'curso'`, pero `tramites` NO tiene `curso_id` ni el RPC `cliente_tramites_listar` lo devuelve. El banner mostraba TODOS los certs del alumno, no solo el del trámite. Redundante con el banner de PortalHome | Quitar el banner inline del detail page. Queda sólo en PortalHome (al tope). El alumno ve la celebración apenas entra al portal, no hace falta repetirla |
| 🟡 | **Variant prop muerto** | Quitada — el componente ya no recibe `variant`, sólo `cursoId?` opcional |
| 🟡 | **`load()` silenciaba errores** | `console.warn` con el error en vez de fallar mudo. No usamos toast porque el banner es opcional, no queremos interrumpir al alumno con un error técnico si la RPC falla |

**Lo que la auditoría confirmó OK**:
- R5 (RPCs SECURITY DEFINER + search_path).
- R12 (las RPCs no cruzan administraciones, son por `auth.uid()`).
- R16 (funciones nuevas, no overload ambiguo).
- R17 (trigger es SECURITY DEFINER + escribe en `push_notifications_queue` que tiene RLS solo-SELECT).
- Cobertura: todas las vías de emisión (Campus auto, cron, cierre manual DGG-38) terminan en INSERT a `certificados` → trigger dispara.
- Ownership de `cert_marcar_celebracion_vista` (sólo dueño o staff).
- Filtro de `cliente_certs_celebrar` por `auth.uid()`.
- Idempotencia (segundo llamado a marcar → 0 rows affected, no error).
- Fallbacks de datos nulos (alumno sin profile, cert sin snapshot).

**Dudas pateadas a mejora futura** (no son bugs):
- Realtime listener para cert emitido en vivo mientras alumno está en PortalHome (bajo impacto, queda como F5).
- Push también a campanita in-app además de push web (decisión: push es push, son canales distintos).
- Excepción del trigger `RAISE WARNING` sin tabla de auditoría (chequeable vía logs de Postgres si pasa algo raro).

**Aprendizaje incorporado**: cualquier chunk que agrega RPCs públicas
debe incluir `GRANT EXECUTE` + smoke `BEGIN/PERFORM/ROLLBACK` en la
misma mig (R6+R18 juntas), no en una siguiente. R6 dice "explícito en
la misma migración", lo respetamos en 0185 por compromiso pero es
deuda haber tenido que hacer una mig separada.

- **Fecha:** 2026-06-02 · ref CELEB-AUDIT-1 a 4, mig 0185.

## DGG-41 · Celebración del cert: banner + push + email premium con frase fija
- **Decisión:** la emisión de un certificado de curso (sea por cert auto
  del Campus o por cierre manual con motivo "Concluyó el curso") dispara
  **3 canales celebratorios** orquestados desde un único trigger BD:
  push notification, email premium MANAXER y banner persistente en el
  portal cliente. La frase fija (acordada con JL): *"¡FELICITACIONES!
  terminaste el curso ___. Sin lugar a dudas, tu esfuerzo valió la
  pena. Recordá: el éxito no se basa en encajar, sino en sobresalir"*.
- **Razón:** José Luis (2026-06-02): "el cierre con certificado es un
  momento importante, no podemos desperdiciarlo. Banner, mail y push
  especiales que destaquen el evento y den acceso directo a la
  descarga". Es un punto de inflexión emocional en el journey del
  alumno y la plataforma tiene que estar a la altura.
- **Implementación:**
  - **Mig 0184** ALTER `certificados` ADD `celebracion_vista_at timestamptz`
    (NULL hasta que el alumno descargue o descarte). Trigger
    `trg_certificado_celebrar` AFTER INSERT en `certificados`
    (SECURITY DEFINER, EXCEPTION WHEN OTHERS para no abortar emisión
    del cert por fallos de side-effects):
    - Encola **push** vía INSERT en `push_notifications_queue` con
      title `🎓 ¡Felicitaciones!`, body con nombre del curso, click_url
      al portal de Mis Cursos.
    - Encola **email** vía `encolar_email('curso-felicitacion', ...)`
      con plantilla nueva (`titulo_visual` con emoji, `color_acento`
      dorado #f59e0b, cuerpo HTML con frase destacada estilo cita).
    - Dispara para CUALQUIER cert emitido (no requiere submission_origen) →
      cubre alumnos asignados manualmente desde Campus también.
  - **2 RPCs nuevas**:
    - `cliente_certs_celebrar()` → lista certs del alumno logueado con
      `celebracion_vista_at IS NULL`. Para alimentar el banner.
    - `cert_marcar_celebracion_vista(p_cert_id)` → marca el cert como
      celebrado (al descargar o descartar el banner). Sólo el dueño
      o staff puede llamarla.
  - **Frontend**:
    - `src/modules/campus/components/CertCelebracionBanner.tsx` —
      componente reusable con variantes `home` y `inline`. Banner
      cyan/dorado con frase + botón "Descargar mi certificado" + link
      "Ver verificación pública" + X para descartar. Click descarga →
      genera PDF cliente con `generateCertificadoPdf` + marca como
      vista → banner desaparece.
    - **PortalHome**: banner al tope, antes del DocsPendientesBanner.
    - **PortalGestionDetailPage**: banner inline arriba del timeline
      cuando `tramite.categoria === 'curso'` (filtra por cert del
      curso si lo identifica, pero como simple compromise muestra
      todos los pendientes del alumno).
  - **Service**: `listCertsCelebrarCliente`, `marcarCelebracionVista`,
    `getCertCompleto` en `campus.ts`. Tipos casteados con `as never`
    para los nuevos RPCs hasta que se regeneren los types de Supabase.
- **Por qué frase fija (no rotativa)**: JL prefiere consistencia. Si
  más adelante quiere rotar, el copy vive en la plantilla email +
  componente — un edit puntual.
- **Por qué PDF directo (no página de verificación)**: JL: "al click,
  que descargue el PDF". El link a verificación pública queda como
  secundario por si el alumno quiere compartir el link de verificación.
- **Por qué dispara para CUALQUIER cert**: tratar igual a los alumnos
  vengan o no de formulario. La gerencia también asigna manual desde
  Campus — ese alumno merece la misma celebración.
- **Smoke e2e** (BEGIN/INSERT/verificar/ROLLBACK): cert insertado →
  push_notifications_queue=1 row con título "¡Felicitaciones!" + email
  encolado con plantilla `curso-felicitacion` + subject con emoji ✓.
- **Fecha:** 2026-06-02 · ref CELEB-1 a 7, mig 0184.

## DGG-39 · Cobranza · emparejamiento de campos entre las dos vías de registro
- **Decisión:** las dos formas de registrar una cobranza (modal simple
  desde el panel de Solicitud recibida y wizard de 3 pasos desde Cuenta
  Corriente / Facturación) deben ofrecer **el mismo conjunto de campos**.
  No se achica ninguna — se les agregan los faltantes a cada una para
  emparejarlas al máximo.
- **Razón:** José Luis (2026-06-02): "la carga de una cobranza debe ser
  igual de completa en cuanto a sus características por cualquiera de
  las vías. Faltaba `Referencia` en la del panel y `Participa Partner`
  en el wizard. Revisar ambas e igualar al máximo".
- **Mapa de campos antes vs. después:**
  | Campo | Modal simple (solicitudes) | Wizard 3 pasos (CC) |
  |---|---|---|
  | Caja | ✓ | ✓ |
  | Fecha | ✓ | ✓ |
  | Monto | ✓ | ✓ |
  | Descripción | ✓ | ✓ |
  | Participa partner | ✓ | **❌ → ✓** ← agregado |
  | Referencia | **❌ → ✓** ← agregado | ✓ |
  | Categoría caja | **❌ → ✓** ← agregado | ✓ |
  | Botón "Cobrar todo" | **❌ → ✓** ← agregado | ✓ |
  | Caja favorita pre-seleccionada | **❌ → ✓** ← agregado | ✓ |
- **Implementación:**
  - **Modal simple** (`PanelComprobanteCobranza.tsx · ModalRegistrarPago`):
    - Carga `listCategoriasIngreso()` además de cajas y partners,
      pre-selecciona la categoría que match "cobranza/honorario/servicio".
    - Pre-selecciona la caja con `es_default=true` (consistencia con
      JL-CAJA mig 0174 / DGG-35).
    - Agregado `Field Categoría` antes de Fecha/Monto.
    - Agregado botón "Total" al lado del input Monto (clamp a saldo).
    - Agregado `Field Referencia` entre Monto y Descripción.
    - El payload de `registrarCobranza()` ahora incluye `referencia`
      y `categoria_id` además del ya existente `partner_id_atribucion`.
  - **Wizard 3 pasos** (`RegistrarCobranzaDrawer.tsx`):
    - Imports `listPartnersActivos` + `PartnerOpcion`.
    - Carga partners en paralelo con cajas y categorías.
    - Step 2 (Monto e identificación) gana un `Field Participa Partner`
      después de "Descripción interna" (solo si `partners.length > 0`,
      mismo gating que el modal simple para no mostrar el dropdown si
      no hay partners registrados).
    - Step 3 (Confirmar) suma `KV Participa partner` al resumen.
    - El payload de `registrarCobranza()` ahora incluye
      `partner_id_atribucion`.
- **Backend sin cambios:** el service `registrarCobranza()` y la RPC
  `registrar_cobranza_comprobante` ya aceptaban los 3 args opcionales
  (`p_referencia`, `p_categoria_id`, `p_partner_id_atribucion`) desde
  #145 / DGG-23. El emparejamiento es 100% UI.
- **Auditoría transversal:** `grep -rn registrarCobranza` en src/modules
  devuelve solo 2 callsites (PanelComprobanteCobranza + RegistrarCobranzaDrawer)
  — ambos quedan emparejados al cierre del chunk.
- **Fecha:** 2026-06-02 · ref COB-EQ-1/2/3.

## DGG-38 EXT · Cierre de trámite con motivo + observaciones + adjunto condicional
- **Decisión:** el cierre de cualquier trámite (no sólo cursos) ofrece
  un **catálogo de motivos predeterminados por categoría** + un campo de
  **observaciones libres** + un **documento opcional** que sólo se
  requiere si el motivo lo justifica. El motivo + observaciones se
  vuelven la **última línea del tracking** ("Trámite cerrado: <motivo>.
  <observaciones>") con `estado_asociado` = `finalizado` (satisfactorio)
  o `frustrado` (no satisfactorio). El cierre **no exige certificado**:
  un trámite puede cerrarse por abandono, rechazo o cualquier otro motivo.
- **Razón:** José Luis (2026-06-02): "el cierre del trámite debe poder
  ocurrir en cualquier instancia, aunque no se tenga el certificado.
  En esos casos, debería aparecer una serie de opciones, por ejemplo:
  Abandonó el curso, Se arrepintió, Desaprobó, Concluyó el curso. Esta
  última es la única que debería subirse el certificado. Cada cierre
  podría acompañarse con observaciones y deberían ser parte del último
  tracking, para dejar constancia." Y extendido: "es importante prever
  el cierre de cualquier trámite — no sólo los cursos — y permitir
  resultados satisfactorios como frustrados".
- **Catálogo** (`MOTIVOS_CIERRE_POR_CATEGORIA` en `src/services/api/tramites.ts`):
  | Categoría | Motivos (✓ satisfactorio / ✗ frustrado / 📎 requiere doc) |
  |---|---|
  | curso | Concluyó el curso ✓📎 · Abandonó el curso ✗ · Desaprobó ✗ · Se arrepintió o se equivocó en la solicitud ✗ |
  | matricula / renovacion | Matrícula otorgada ✓📎 · Matrícula rechazada ✗ · Abandono del trámite ✗ |
  | dj / consulta_juridica / reclamo / otro | Satisfactorio ✓ · Sin éxito ✗ · Abandono del trámite ✗ |
  El motivo final persiste en `tramites.motivo_cierre text` (libre).
- **Implementación:**
  - **Schema** (mig 0182): `ALTER tramites ADD motivo_cierre text +
    cierre_satisfactorio boolean` (NULL hasta cierre).
  - **RPC** (R16: DROP firma vieja + CREATE nueva):
    `public.tracking_cerrar(p_tramite_id uuid, p_motivo_cierre text,
    p_satisfactorio boolean, p_observaciones text DEFAULT NULL,
    p_documento_final_url text DEFAULT NULL)` SECURITY DEFINER.
    Valida motivo no vacío + satisfactorio NOT NULL. Update tramites
    con los 5 campos. Inserta línea con
    `categoria = certificado_emitido | cierre_frustrado`,
    `estado_asociado = finalizado | frustrado`,
    `descripcion = 'Trámite cerrado: <motivo>. <observaciones>'`,
    `archivos_urls = [url]` solo si vino, `visible_cliente=true`.
  - **Service** (`trackings.ts`): firma extendida
    `cerrarTracking(id, motivo, satisfactorio, obs?, url?)`.
  - **Tipo** (`tramites.ts`): `MotivoCierreOpcion` con
    `{ value, label, satisfactorio, requiere_documento, descripcion? }`.
  - **Componente** (`CerrarTramiteDialog.tsx`): refactor completo con
    3 secciones — motivo (radio cards con ícono verde/rojo + badge
    "Adjunto" si requiere), observaciones (textarea opcional, máx
    2000 char), documento condicional (solo si motivo.requiere_documento;
    tabs "Subir archivo" / "Pegar URL", obligatorio con badge rosa).
  - **Trigger auto-cierre cert Campus** (DGG-38 base): se actualizó
    para insertar `motivo_cierre='Concluyó el curso'` +
    `cierre_satisfactorio=true` (consistente con el catálogo).
- **Smoke e2e** (BEGIN/ROLLBACK):
    - 1 · Sat + doc + obs (matricula otorgada con URL + observación
      de la comisión) → finalizado ✓
    - 2 · Frustrado sin doc + obs (curso abandonado vía WhatsApp) →
      frustrado ✓ con archivos_urls vacío + descripcion correcta
    - 3 · Sat sin doc ni obs (consulta jurídica satisfactoria) →
      finalizado ✓ con descripcion mínima
    - 4 · Motivo vacío → rechazado con 23502 ✓
    - R16 · `tracking_cerrar` con 1 sola firma ✓
- **Por qué motivo libre y no enum:** la lista evoluciona (cada tipo de
  servicio nuevo puede traer su propio vocabulario). Mantener `text`
  permite seed/data evolutiva sin tocar el schema. El frontend ofrece
  el catálogo como guía pero no obliga.
- **Por qué satisfactorio bool y no enum 'estado':** los estados del
  trámite ya cubren el ciclo de vida (`cerrado` es el estado final).
  Lo que el cierre necesita marcar es el **resultado del cierre**
  (success/fail), no un nuevo estado — y un boolean basta. Refleja en
  la UI con badge verde/rojo en el detalle del trámite.
- **Fecha:** 2026-06-02 · ref CIERRE-EXT-1 a 4, mig 0182.

## DGG-38 · Cierre de trámite: subir archivo o pegar URL + auto-cierre por cert Campus
- **Decisión:** el modal "Cerrar trámite" deja de ser un `usePrompt()` que
  sólo aceptaba URL. Ahora abre `CerrarTramiteDialog` con dos tabs:
    - **Subir archivo** (PDF, imagen, Office, hasta 20 MB).
    - **Pegar URL** (link externo, Drive, etc.).
  Y además: cuando un alumno aprueba un curso del Campus y se le emite el
  certificado automáticamente, el trámite se cierra **solo** con una línea
  de sistema "Aprobación exitosa del curso con emisión de certificado".
- **Razón:** José Luis (2026-06-02) reportó que el modal sólo aceptaba
  URL, lo que obligaba a subir el documento en otro lado (Drive, etc.) y
  pegar el link — fricción evitable. Y además observó que cuando la
  plataforma misma emite el certificado, el cierre manual es redundante:
  el último eslabón ya ocurrió, el trámite tiene que cerrar solo.
- **Implementación:**
  - **Bucket** (mig 0181): `tramite-documento-final` PÚBLICO, 20 MB,
    permite PDF + JPG/PNG/WebP + Word + Excel. Public porque la URL se
    comparte con el cliente y queremos links estables (no signed
    expirables). Write solo staff (`private.is_staff()`).
  - **Service** (`src/services/api/tramites.ts`):
    `subirDocumentoFinalTramite(tramite_id, file)` → URL pública.
  - **Componente** (`src/modules/trackings/components/CerrarTramiteDialog.tsx`):
    Modal con tabs "Subir archivo" / "Pegar URL". El botón Aceptar
    sube el archivo (si aplica), llama `cerrarTracking(id, url)` y
    cierra. Conserva el chaining a `ProgramarVencimientoModal` cuando
    el servicio tiene `vigencia_meses`.
  - **TrackingDetailPage**: `handleCerrar` ahora abre el dialog en
    vez de hacer `prompt()`. El estado del flag de renovación se
    pasa al callback `handleCerradoOk`.
  - **Trigger auto-cierre** (mig 0181, R17 SECURITY DEFINER):
    `trg_certificado_cierra_tramite_curso` AFTER INSERT en
    `certificados`. Si `matricula.submission_origen` NOT NULL, busca
    el trámite (categoria='curso', formulario_submission_id =
    submission_origen, estado ≠ cerrado/cancelado) y lo cierra con
    `documento_final_url = https://gestionglobal.ar/verificar/{codigo}`.
    Inserta línea con `autor_id=NULL` (sistema), descripcion =
    "Aprobación exitosa del curso con emisión de certificado.",
    estado_asociado='finalizado', visible_cliente=true.
    Idempotente: si el trámite ya está cerrado, NO inserta nada.
    `EXCEPTION WHEN OTHERS` traga errores para no abortar la emisión
    del cert por un fallo de side-effect.
- **Smoke e2e** (BEGIN/ROLLBACK):
    - Positivo: cert con `submission_origen` → trámite queda cerrado
      con la URL pública correcta y línea automática del sistema.
    - Negativo: cert SIN `submission_origen` (alumno manual) → no
      altera ningún trámite.
    - Idempotencia: trámite YA cerrado → trigger no inserta línea
      duplicada.
- **Modelo de vínculo** elegido: `tramites.formulario_submission_id ↔
  curso_matriculas.submission_origen`. Es 1-1 cuando el alumno se
  inscribió por formulario público (caso de uso esperado). Para
  inscripciones manuales se pierde el vínculo automático y el gerente
  cierra a mano con el dialog nuevo — coherente con la naturaleza
  manual del flujo.
- **Por qué URL pública de verificación y no PDF directo:** el bucket
  `certificados` es privado (los PDFs requieren signed URL con
  expiración). La página `/verificar/:codigo` muestra el certificado
  completo + datos verificables y es pública y estable. Mejor experiencia
  para el cliente (también puede compartir el link como prueba).
- **Fecha:** 2026-06-02 · ref CIERRE-1 a 4, mig 0181.

## DGG-37 · Previsualización de documentos en campos file ("ojito")
- **Decisión:** los campos `file` del formulario público pueden mostrar un
  ícono ojo al lado del label; al click, un popover muestra una imagen
  de ejemplo del documento esperado + el nombre del archivo bajo la
  imagen. Mecánica genérica reusable para cualquier campo a futuro.
- **Razón:** José Luis (2026-06-02): "muchas personas no entienden bien
  de qué archivos se trata". El copy + hint no alcanza para documentos
  específicos como constancias fiscales — una imagen vale mil palabras.
- **Implementación:**
  - **Tipo** (`src/services/api/formularios.ts`): `FormularioFieldDef`
    extendido con `preview?: { url: string; filename: string; alt?: string }`.
  - **Runner** (`src/modules/public/components/FormularioRunner.tsx`):
    componente `FieldPreviewEye` con popover (cierra con click afuera,
    ESC, botón X). El helper `fieldLabel(field, prefilled)` lo integra
    al lado del label cuando `field.preview` existe. `FileUploader` pasa
    `fieldLabel(field, false)` al `Field` para que el ojito aparezca
    en fields tipo `file`.
  - **Builder** (`src/modules/formularios-admin/components/PropertiesPanel.tsx`):
    nuevo `FilePreviewEditor` que aparece para campos `type='file'`.
    Sube la imagen al bucket `formulario-previews` (vía
    `subirImagenPreview` en `formularios-admin.ts`), permite editar
    `filename` y `alt`. Validación: PNG/JPG/WebP hasta 5 MB.
  - **Bucket** (mig 0177): `formulario-previews` público, write solo
    gerente/operador. Mismo patrón que `formulario-descargas`.
- **Aplicación inmediata** (mig 0178 + complemento):
  | Slug | Campo | Preview |
  |---|---|---|
  | matriculacion-rpac | constancia_inscripcion_arca | ARCA ejemplo |
  | matriculacion-rpac | constancia_arba_iibb | ARBA ejemplo |
  | renovacion-rpac | constancia_arca_actualizada | ARCA ejemplo |
  | renovacion-rpac | constancia_arba_iibb | ARBA ejemplo |
- **Imágenes**: subidas como assets del repo en
  `public/form-previews/constancia-{inscripcion-arca,arba-iibb}-ejemplo.png`,
  servidas como `/form-previews/*.png` por Vercel. Las próximas las puede
  cargar el dueño desde el panel del builder (van al bucket).
- **Auditoría transversal**: ambos formularios RPAC fueron mapeados;
  `renovacion-rpac` usa `constancia_arca_actualizada` en vez de
  `constancia_inscripcion_arca` (es de actualización, no inicial) —
  fix complementario aplicado en la misma mig.
- **Verificación e2e:** query post-mig confirma 4 hits con `preview`
  configurado correctamente. Build TS + vite OK.
- **Fecha:** 2026-06-02 · ref JL-PREVIEW-1 a 6, migs 0177 + 0178.

## DGG-36 · RPAC matrícula · consolidar 2 campos del título
- **Decisión:** en el formulario `matriculacion-rpac`, los 2 campos
  `titulo_secundario_o_superior` ("Título emitido por entidad habilitada
  por el RPAC") y `certificado_curso_administradores` ("Certificado del
  curso de administradores") eran el MISMO documento (lo dijo José Luis
  2026-06-02). Se consolidan en uno solo:
  - `name`: `certificado_curso_administradores` (sobrevive — `titulo_
    secundario_o_superior` era confuso, "título secundario" no es RPAC).
  - `label`: "Certificado del Curso de formación de Administrador de
    Consorcios".
  - `hint`: "Emitido por una entidad habilitada por el RPAC".
- **Auditoría transversal previa** (lección de E-GG-37):
  | Slug | Tenía los 2 campos? | Acción |
  |---|---|---|
  | `matriculacion-rpac` | sí | consolida |
  | `matriculacion-rpac-juridica` | no (anexo societario; persona jurídica no rinde el curso, lo rinde el administrador titular) | sin cambios |
  | `renovacion-rpac` | tiene `certificado_curso_actualizacion_vigente` distinto (curso bianual para mantener matrícula) | sin cambios |
  | `certificado-rpac` | ninguno (solo emite certificado de matrícula activa) | sin cambios |
- **Submissions afectadas**: 0 con datos en cualquiera de los 2 campos
  (verificado con `count(*) FILTER (WHERE datos ? '...')` previo a la
  mig). Safe refactor sin migrar datos.
- **Implementación (mig 0176):** DO block plpgsql que recorre
  `formularios.schema->sections->fields`: skip
  `titulo_secundario_o_superior`, update label/hint en
  `certificado_curso_administradores`, conserva todos los demás.
  El frontend lee `formularios.schema` directo
  (`getFormularioPorSlug`), la tabla `formulario_versiones` es solo
  historial → solo se actualiza la fila de `formularios`.
- **Verificación**: query post-mig confirma 1 solo campo con el copy
  unificado.
- **Fecha:** 2026-06-02 · ref JL-RPAC-1/2/3, mig 0176.

## DGG-35 · Módulo Cajas premium (José Luis · 4 mejoras)
- **Decisión:** capitalizar los 4 pedidos de José Luis sobre cajas:
  1. Editar tipo post-alta.
  2. Eliminar (hard delete) con bloqueo si saldo ≠ 0 o si tiene historial.
  3. Caja favorita / default que se pre-selecciona en cobranza.
  4. Campo "orden" en el drawer (la columna ya existía pero no se exponía).
- **Razón:** mandato del dueño de tener el sistema "más estable, sólido y
  premium". El módulo cajas era de los que mostraban inconsistencias UX
  ("Tipo" sólo en alta, sin eliminar, sin favorita, orden sólo backend).
- **Implementación:**
  - **Mig 0174** · `ALTER TABLE cajas ADD COLUMN es_default boolean
    DEFAULT false` + unique partial index (max 1 default). DROP + CREATE
    `fz_caja_actualizar` extendido con `p_tipo` y `p_es_default` (R16
    compliant — no `CREATE OR REPLACE` solo). Nuevas RPCs:
    `fz_caja_eliminar` (con check saldo ≠ 0 → "caja_con_saldo" + check
    n_movs > 0 → "caja_con_historial" sugiere archivar);
    `fz_caja_marcar_default` (set 1 + unset todos los demás en tx).
  - **Mig 0175** · DROP + CREATE de `fz_listar_cajas_admin` para extender
    el `RETURNS TABLE(...)` con la nueva columna `es_default boolean`
    (R16: cambiar shape de retorno requiere DROP explícito).
  - **Frontend** (`FinanzasAdminPage.tsx`):
    - Cards ordenadas por `activa DESC, es_default DESC, orden ASC,
      nombre ASC`.
    - Badge ★ "Favorita" cuando `es_default=true`.
    - Botón estrella (con relleno cuando es default) por card.
    - Botón papelera (solo si activa y `cantidad_movimientos === 0`)
      con confirm bloqueante.
    - Drawer alta/edit: tipo editable en ambos modos, input numérico
      `Orden`, checkbox `Caja favorita` con copy explicativo.
  - **Frontend cobranza** (`RegistrarCobranzaDrawer.tsx`):
    - En `useEffect` post-fetch, pre-seleccionar la caja con
      `es_default=true`. Fallback al comportamiento anterior (si solo
      hay 1 caja, esa).
- **Verificación e2e** (smoke tests BD):
  - SMOKE A · `fz_caja_eliminar` sobre caja con movs → bloquea con
    `caja_con_historial` ✓.
  - SMOKE B · `fz_caja_eliminar` sobre caja test sin movs → DELETE ✓.
  - SMOKE C · `fz_caja_marcar_default`: setear default en caja A, luego
    en caja B → solo B queda con `es_default=true` ✓.
  - R16 query `HAVING count(*) > 1` filtrando `fz_caja*` → 0 hits ✓.
  - Build TS + vite ✓.
- **Fecha:** 2026-06-02 · ref JL-CAJA-1 a 7, migs 0174 + 0175.

## DGG-34 · Capitalización auditoría DEEP — 3 drawers + reglas R14/R15 + sweep BD
- **Decisión:** después del cierre de DGG-33, hacer un chunk completo
  ("auditoría profunda") que (a) cierre TODOS los GAPs UI-coverage que
  quedaron en el reporte ASIG-A; (b) agregue reglas no negociables R14 y
  R15 para que este tipo de gap no se repita; (c) ejecute dos auditorías
  transversales en paralelo (BD profunda + superficie de código) y
  capitalice los hallazgos prioritarios; (d) corra smoke tests e2e en BD
  de los flujos críticos antes de cerrar el chunk.
- **Razón:** mandato explícito del dueño 2026-06-02: "Necesitamos que
  quede todo impecable. Como política general, tenemos que tener el
  sistema más estable, sólido y premium. Así que con esa filosofía no se
  pueden escatimar recursos en las auditorías ni tampoco dejar nada
  postergado. Cuando se encuentra algo, por más pequeño que sea, se
  resuelve A FONDO y, luego, se prueba y testea."
- **Implementación:**
  - **UI (3 drawers nuevos)**:
    - `TrackingMetadataDrawer` integrado en `TrackingDetailPage` con
      botón "Editar metadata" → edita titulo, categoria, prioridad,
      vence_at, descripcion, admin/consorcio, solicitante_*. Cierra GAPs
      #1 + #2 del reporte ASIG-A.
    - `ProspectoEditDrawer` en `ProspectosListPage` con botón "Editar"
      por fila → edita nombre/email/teléfono. Cierra GAP #3 (email mal
      escrito desde formulario quedaba enterrado).
    - `UsuarioEditDrawer` en `UsuariosPage` con botón "Editar" por fila
      → edita full_name + role (gerente/operador). Cierra GAP #4.
  - **SQL (migs 0171 + 0172)**:
    - 0171 · RPC `actualizar_gerente` con guards (actor gerente/superadmin,
      role target IN gerente/operador, no muta clientes/partners).
    - 0172 · capitalización DEEP-AUDIT-D:
      - DROP overload viejo `fz_crear_movimiento_manual` (10 args,
        deprecado; el frontend usa 11 args).
      - `assert_administracion_access` en `curso_asignar_alumno` (R12).
      - RLS lockdown explícito de `arca_tokens` (`FOR ALL USING(false)`,
        sólo service_role accede via edge functions).
      - Comentarios justificatorios en las 5 policies `USING(true)`
        (R2 cumplida en docs).
      - Índice `idx_health_flow_alerts_origen_run_id` (R11 — única FK
        formal sin índice del repo).
    - Hotfix en mig 0170 del trigger `_notif_cobranza_recibida_trg`
      (E-GG-36): record sin asignar → escalares con default NULL.
  - **Reglas (CLAUDE.md, 13 → 15)**:
    - **R14** Paridad columna-grilla ↔ control de edición. Toda columna
      persistida visible en grilla debe tener al menos una de: editor en
      detail ruteado, control en form drawer, quick-edit inline, o tag
      AUTO documentado. Si ninguna aplica → deuda y GAP en ERRORES.md.
    - **R15** Diff legacy ↔ nueva al redirigir rutas SPA. Cuando una mig
      de UI redirige una ruta legacy a una página nueva, antes del
      merge correr diff de campos editables entre las dos páginas;
      cualquier control de mutación presente en la legacy y ausente en
      la nueva es un E## obligatorio.
  - **Code quality**:
    - Sweep `humanizeError` en 12 sitios que pasaban `error.message`
      crudo al toast (auditoría DEEP-AUDIT-E Frente 4).
    - `humanizeError()` firma extendida para aceptar `unknown` (sin
      cast en catch blocks). Maneja Error / PostgrestError /
      StorageError / FunctionsHttpError uniformemente.
  - **Smoke e2e en BD**:
    - SMOKE 1 · solicitud nueva → trigger `_notif_solicitud_nueva_trg`
      dispara 2 notif in-app (1 por gerente activo). ✓
    - SMOKE 2 · movimiento ingreso/facturacion → trigger
      `_notif_cobranza_recibida_trg` → `notify_all_gerentes` → 2 in-app
      + 2 emails + 1 push. ✓ (descubrió E-GG-36 en el primer intento.)
- **Parqueado a BACKLOG** (DEEP-AUDIT-E Frente 1 — R4):
  - 15 violaciones de "supabase.from/rpc/functions/storage en componentes"
    (top: WizardActivacion functions.invoke, LineaTrackingCard +
    AlarmasHoyWidget RPCs, PortalWebinarsPage RPC, 4 storage ops en
    PartnerPortal/TrackingDetail/PropertiesPanel/AccesoExterno). Es un
    sweep por sí mismo (extender 5+ services existentes + crear
    `accesoExterno.ts`). Próximo chunk.
- **Verificación e2e en producción**:
  - Build limpio (tsc + vite).
  - SMOKE 1 + SMOKE 2 con side-effects observados.
  - Mig 0172 aplicada con verificación de policies, índice, drop overload.
  - `notify_all_gerentes` retorna 2 (gerentes activos correctos).
- **Fecha:** 2026-06-02 · ref DEEP-1 a DEEP-7, AUDIT-D/E, E-GG-36, migs
  0171/0172.

## DGG-33 · Sin asignación individual — fan-out a TODOS los gerentes en 3 canales
- **Decisión:** Gestión Global NO tiene asignaciones individuales de
  trabajo. Todos los usuarios con rol `gerente` (y `operador`) ven todo y
  se ocupan de todo. Hay UNA SOLA agenda compartida. **Consecuencia
  operativa**: cualquier evento que merezca atención de la gerencia
  dispara push + banner in-app + email a TODOS los gerentes activos
  (fan-out por rol, no por persona).
- **Razón:** Decisión del dueño (2026-06-02). El equipo es chico, atiende
  como grupo y el patrón "asignar al gerente X" introducía bugs silenciosos
  (los otros gerentes nunca se enteraban — anti-patrón
  `IF asignado_a IS NOT NULL THEN notif_emitir(uno) ELSE notif_emitir_staff()`).
- **Implementación:**
  - Helper único `public.notify_all_gerentes(evento, titulo, cuerpo, url,
    payload, send_email, template_slug, email_vars, prioridad,
    related_table, related_id)` que dispara los 3 canales en una sola
    llamada (mig `0170_notify_all_gerentes_y_fanout.sql`).
  - Template default `gerencia-notif-generica` para que cualquier evento
    tenga email sin crear template específico.
  - Triggers migrados a usar el helper (suma email a los que antes eran
    sólo in-app+push): `tracking_linea_on_insert` (cliente sube nota /
    gestor avance), `_notif_tracking_cerrado_trg`,
    `dispatch_alarmas_tracking_hoy`.
  - Trigger NUEVO sobre `movimientos` cuando ingreso/facturacion →
    notifica "cobranza recibida" a toda la gerencia (cierra GAP-2 de
    ASIG-B).
- **Frontend:** removidos del módulo trámites: columna "Asignado", KPI
  "Sin asignar", filtro `asignadoA`, parámetro `asignado_a` en
  `createTramite` y `UpdateTramitePatch`, sidebar `<Select>` "Asignado a"
  en `TramiteDetailPage` (legacy, no ruteada).
- **BD:** el campo `tramites.asignado_a` SE MANTIENE para datos
  históricos y registros importados de Excel. El índice parcial sólo
  cubre filas con valor (overhead nulo). El audit trigger
  `tramite_on_update` sigue capturando eventos `asignado`/`desasignado`
  históricos.
- **Alternativas descartadas:**
  - Reponer el `<Select>` en el detalle nuevo — descartada porque el
    equipo decidió que no hay asignaciones, no porque la UI fuera mala.
  - Mantener la columna en grilla pero siempre "Sin asignar" — confuso
    e implica acción que no existe.
- **Verificación e2e** (`SELECT notify_all_gerentes(...); → assert
  side-effects; cleanup`): 2 gerentes activos → 2 filas in-app, 2 emails
  encolados, 1 push (sólo gerente con suscripción) ✓.
- **Fecha:** 2026-06-02 · ref ASIG-A/B/C, E-GG-35, mig 0170.

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

## DGG-31 · ARCA multi-emisor · unificar arca_config en arca_emisores

- **Origen:** bug live (2026-06-01) — usuario gerente quiso generar el CSR
  en `/gerencia/configuracion/arca` y recibió 400. Diagnóstico expuso un
  gap arquitectónico mayor: el sistema tenía **dos modelos cohabitando**:
  - **Singleton legacy** (`config_global.cuit/razon_social` +
    `arca_config` id=1 con csr/key/cert): lo usaban las 4 edge fns ARCA.
  - **Multi-emisor** (`arca_emisores` UUID, DGG mig 0103 task #149
    Fundplata): se creó para etiquetar comprobantes con `emisor_id` pero
    **NO existía UI** para gestionarlo y `config_global.cuit` estaba en
    NULL, lo que producía el 400.

- **Decisión:** migrar **TODO** al modelo multi-emisor. Una sola fuente
  de verdad fiscal: `arca_emisores`. `config_global` queda para datos
  no-fiscales (branding, email, landing, próximos servicios).

- **Migración 0159 (aplicada):**
  - Extender `arca_emisores` con todas las columnas técnicas de
    `arca_config`: `csr_b64`, `key_b64`, `cert_b64`, `csr_generado_at`,
    `cert_subido_at`, `cert_alias`, `cert_valido_desde`,
    `cert_valido_hasta`, `ultimo_test_*`, `ultimo_test_latencia_ms`,
    `punto_venta_default`.
  - Migrar datos de `arca_config (id=1)` al emisor default existente.
  - Ampliar CHECK de `ambiente` para aceptar `('test','prod',
    'homologacion','produccion')` por compat con seed viejo.
  - Permitir CUIT nullable (`DROP NOT NULL`) durante onboarding.
  - Borrar placeholder `00000000000` → NULL.
  - Nuevas RPCs SECURITY DEFINER: `arca_emisor_default()` (devuelve o
    crea el default) y `arca_emisor_set_default(uuid)` (cambio atómico).
  - **NO se dropea `arca_config` ni `config_global.cuit/razon_social/
    condicion_iva/domicilio_fiscal`** — backward compat hasta que una
    migración posterior verifique que nadie los lee.

- **Edge functions refactorizadas (4):** helper `_shared/emisor.ts` con
  `resolverEmisor(admin, emisorId?)` que lee de `arca_emisores`. Las 4
  fns aceptan ahora `emisor_id` opcional en el body; si no viene usan
  el `es_default`.
  - `arca-generar-csr`: respondió 400 "El emisor X no tiene CUIT cargado"
    en vez del genérico anterior.
  - `arca-inspeccionar-cert`: valida CUIT del cert contra el del emisor.
  - `arca-test-conexion`: actualiza `ultimo_test_*` del emisor.
  - `arca-autorizar-comprobante`: resuelve por `comprobantes.emisor_id`
    (el trigger lo setea al default si null) → usa cert/key correctos.

- **Frontend `services/api/arca.ts`:**
  - CRUD nuevo: `listEmisores`, `getEmisor`, `crearEmisor`,
    `actualizarEmisor`, `archivarEmisor`, `reactivarEmisor`,
    `marcarDefault`, `getEmisorDefault`.
  - `generarCsr/inspeccionarYGuardarCert/testConexion` aceptan
    `emisor_id` opcional.
  - **`extractInvokeError(err)`**: parsea el body real del
    `FunctionsHttpError` cuando supabase-js devuelve error genérico
    ("Edge Function returned a non-2xx status code"). Esto era parte
    del bug original — la UX mostraba el genérico en vez del mensaje
    real del backend.
  - `getArcaConfig` y `updateArcaConfig` se mantienen como wrappers que
    actúan sobre el emisor default (backward compat con código viejo).

- **UI nueva `/gerencia/configuracion/emisores` (`EmisoresPage.tsx`):**
  - Lista en cards con: nombre, CUIT, razón social, ambiente badge,
    badge default, estado del wizard (paso 1-4), warning si cert
    próximo a vencer.
  - Botón "+ Nuevo emisor" → Modal con form (nombre, razón social,
    CUIT, condición IVA, punto venta, ambiente inicial).
  - Card "Configurar" → Drawer lateral con tabs:
    - **Datos fiscales**: form editable (nombre, razón social, CUIT,
      condición IVA, domicilio, punto venta).
    - **Wizard ARCA**: los 4 pasos clásicos (Generar CSR → Subir AFIP
      → Subir cert → Probar) ahora por emisor_id. Bloqueado si no hay
      CUIT — guía al usuario a la tab "Datos fiscales".
  - Acciones quick por card: Marcar default, Archivar, Reactivar.
  - Filtro "Mostrar archivados" en header.
  - Tutorial PDF descarga (reusa `generateArcaTutorialPdf`).

- **Sidebar + ruteo:**
  - GerenciaLayout: "ARCA · facturación" → "Emisores fiscales (ARCA)".
  - ConfiguracionLayout tabs: "ARCA" → "Emisores fiscales".
  - App.tsx: ruta nueva `/gerencia/configuracion/emisores` con lazy
    chunk para `EmisoresPage`. `/gerencia/configuracion/arca` queda
    como redirect legacy (`<Navigate to="../emisores" replace />`).
  - Borrado `ArcaConfigPage.tsx` (singleton legacy reemplazado).
  - `ComprobanteFormDrawer` actualizado: mensajes apuntan al nuevo path.

- **Conservamos retrocompat:**
  - `arca_config` (tabla legacy) y `config_global.cuit/razon_social/
    condicion_iva/domicilio_fiscal` NO se dropean.
  - `getArcaConfig`/`updateArcaConfig`/`ArcaConfig` (frontend) siguen
    funcionando como wrappers sobre el emisor default.
  - El trigger `comprobantes_set_emisor_default` (mig 0103) garantiza
    que comprobantes históricos sin `emisor_id` se asignan al default
    al insertarse.

- **Estado post-deploy:**
  - Migración aplicada en BD prod. RPCs creadas.
  - 4 edge fns deployadas (v5 cada una).
  - Build limpio (tsc --noEmit + vite build OK).
  - Commit `86cac19` en `origin/main`. Vercel autodeploy.

- **Próximo paso (acción del usuario):** entrar a
  `/gerencia/configuracion/emisores`, click en el emisor "Gestión Global"
  default, ir a tab "Datos fiscales", cargar el CUIT real de la empresa
  + razón social + condición IVA. Después ir al wizard y completar
  Paso 1 (CSR) → Paso 2 (subir a AFIP) → Paso 3 (subir cert) → Paso 4
  (probar). El CSR ya no falla con 400.

- **Fecha:** 2026-06-01 · commit `86cac19`.

## DGG-32 · Health check periódico de flujos críticos + humanización de errores

**Contexto:** las 3 fallas silenciosas E-GG-26/27/28 dieron 3 lecciones:
(1) los toasts del sistema mostraban texto técnico crudo, los usuarios no
podían accionar; (2) no había un check periódico que ejercitara los flujos
asíncronos (los KPIs de BD no detectan un trigger pisado ni un cron 401);
(3) cuando algo se rompía, nadie se enteraba hasta que un cliente reportaba.
El usuario lo pidió en dos requerimientos simultáneos.

- **CHUNK 1 · `humanizeError` + `extractEdgeFnError`** (commit `c116697`):
  - Helpers nuevos en `src/lib/errors.ts`.
    - `extractEdgeFnError(err)` lee el body real (4xx/5xx) del
      `FunctionsHttpError` de supabase-js. Sin esto el toast queda con
      "non-2xx status code" aunque el backend devolvió un mensaje útil.
    - `humanizeError({code,message}|string)` mapea códigos PG/Supabase
      típicos (42501, 23505, 23503, PGRST116...) + regex sobre mensajes
      técnicos comunes a frases en español accionables. Si el mensaje ya
      es humano (vino del backend después de extractEdgeFnError), pasa
      tal cual.
  - 7 services en `services/api/` y 119 componentes/páginas modificados.
    305 sustituciones automáticas de `description: res.error.message` por
    `description: humanizeError(res.error)`. tsc + vite build limpios.
  - Excluido a propósito: `supabase.rpc/.storage` directos en componentes
    (regla 4 deuda separada), `catch(err)` no-ApiResponse, propagación
    `throw new Error(...)`.

- **CHUNK 2 · health-flows-check** (commit `<DGG-32>`):
  - **Migración 0164** · tablas `health_flow_runs` + `health_flow_alerts`:
    runs guarda 1 row cada corrida con jsonb por check; alerts tiene UNIQUE
    parcial sobre activas (`resolved_at IS NULL`) para garantizar 1 alerta
    por check_key a la vez. RLS ON. SELECT a gerente/superadmin.
  - **RPC `health_flow_record_run(overall, duration_ms, checks, origen)`**:
    SECURITY DEFINER. Inserta el run, crea alertas nuevas cuando un check
    pasa a warning/critical, cierra alertas con `resolved_by='auto'` cuando
    vuelve a 'ok'. Cuando crea una alerta nueva, dispatcha
    `private.notif_emitir` a cada gerente — desde mig 0163 esa fn ya
    escala a push web automáticamente. Triple canal: banner + campanita +
    push.
  - **RPCs auxiliares**: `health_flow_runs_recent(limit)`,
    `health_flow_alerts_active()`, `health_flow_alert_resolve(id)`,
    `health_flow_alerts_garbage_collect()` (auto-cierre >24h sin
    reconfirmación).
  - **Migración 0165** · helpers de introspección
    (`health_check_cron_jobs_status`, `_trigger_existe`, `_fn_contains`)
    con GRANT solo a service_role — la edge fn los usa para verificar
    cron.job, pg_trigger y pg_get_functiondef.
  - **Edge fn `health-flows-check`** · 7 checks (cada uno aislado, idempotente):
    1. `email_queue_atascada` — rows en email_queue >30min sin enviar
       (intento < max_intentos)
    2. `push_queue_atascada` — rows en push_notifications_queue >30min sin enviar
    3. `cron_dispatchers_activos` — los 3 jobs (dispatch-emails-1min,
       dispatch-push-2min, arca-dispatch-every-min) están active=true
    4. `cron_secret_alineado` — POST a cada dispatcher con bearer del env;
       si alguno 401 → critical (detecta exactamente E-GG-27)
    5. `trigger_captacion` — existe `trg_subm_auto_tramite` en
       formulario_submissions (detecta E-GG-26)
    6. `notif_escala_push` — `pg_get_functiondef(private.notif_emitir)`
       contiene 'push_notifications_queue' (detecta E-GG-28)
    7. `arca_comprobantes` — arca_emision_queue status='pending' +
       scheduled_at >2h + finished_at NULL (sin atascos)
    Cada check tiene 3 status: ok / warning / critical (+ skipped si la
    consulta no aplica al env). overall = max severity. Auth = mismo
    patrón que dispatch-emails (CRON_SECRET o SERVICE_ROLE_KEY en Bearer).
  - **Migración 0166** · pg_cron `health-flows-check-12h` con schedule
    `0 3,15 * * *` UTC = 00:00 y 12:00 ART (UTC-3). Bearer = mismo
    CRON_SECRET de mig 0162.
  - **UI** · `FlujosCriticosSection` dentro de `/gerencia/configuracion/salud`:
    timeline de 20 corridas (status badge + expandible con detalle por
    check), bloque de alertas activas con botón "Marcar resuelta"
    (confirm dialog regla 13), botón "Correr ahora" que invoca la edge
    fn con `origen='manual'`. `HealthFlowsBanner` sticky en
    `GerenciaLayout` con poll cada 5min: si hay alerta crítica → fondo
    rosa con CTA "Revisar Salud", si warning → ámbar.

- **Validación en vivo (2026-06-02 01:55 UTC):**
  - Primera corrida real expuso 3 falsos positivos por mismatch de
    schema (push_queue `intento` vs `intentos`, trigger
    `auto_tramite` vs `solicitud`, arca `arca_emision_queue` vs
    `comprobantes.estado_arca`). Corregidos en edge fn v2.
  - Segunda corrida: 7/7 checks OK. Las 2 alertas falsas se cerraron
    solas con `resolved_by='auto'`.
  - El propio health check **valida en producción** que E-GG-26/27/28
    están vigentes (trigger captación presente, secret alineado,
    notif_emitir escala a push).

- **Fecha:** 2026-06-01 / 2026-06-02 · commit `<DGG-32>`.

---

## DGG-46 · TRAMIX — consulta nativa de expedientes DPPJ-PBA en el portal (2026-06-04)

- **Qué:** botón "Consultar en Mesa de Entradas Virtual PBA" en *Mis gestiones*
  (portal cliente) → modal que muestra, **nativo**, el estado de los expedientes
  del legajo del administrador en la Mesa de Entradas Virtual de la Dirección
  Provincial de Personas Jurídicas (TRAMIX/DPPJ-PBA), con detalle expandible
  (header + actuaciones) y salvavidas oficial.

- **Premisa de Pablo (innegociable):** "esta ventana debe adaptarse a nuestra
  tecnología, no al revés. Si se puede, buenísimo; si no, no la implementamos."
  → El "Route Handler de Next.js" del brief se implementó como **Supabase Edge
  Function (Deno) aislada** (`tramix-consulta`). **Egress verificado EN VIVO**
  desde el runtime de Edge a `tramix.persjuri.gba.gov.ar:8080` (HTTP, puerto no
  estándar): 200, JSESSIONID, 238ms → se puede → se implementó. Cero impacto
  sobre lo existente (additivo).

- **Privacidad por construcción:** el legajo NO lo manda el front. La Edge fn
  resuelve `auth.getUser()` → `profiles.administracion_id` →
  `administraciones.legajo_rpac` (server-side, service_role). El cliente sólo ve
  SU legajo. La acción `detalle` valida que el `detalle_ref` pertenezca a un
  expediente del legajo del usuario (según cache) antes de pegarle a TRAMIX
  (`FORBIDDEN` si no).

- **Anti-martilleo (sitio gov frágil de 2006):** cache-first (`tramix_cache` /
  `tramix_detalle_cache`, 15' fresco) + gate atómico
  `tramix_gate(p_user,p_legajo,p_force)` (SECURITY DEFINER, `FOR UPDATE` sobre
  `tramix_throttle` singleton: throttle global 3.5s + cooldown 30s por
  usuario+legajo en refresco forzado + tope 30/h) + circuit-breaker
  `tramix_record` (5 fallos → 10' abierto) + sesión JSESSIONID+T&C reutilizable
  (`tramix_session`, 18', re-aceptación automática ante muro de T&C).

- **Flujo TRAMIX (latin1):** `GET /` → `POST /jsp/Instrucciones.jsp` (acepta
  T&C) → `POST /LoginServlet` → `GET /QueryExped?txtLegajo=...` (¡por GET!) →
  `GET /ExpedDetails?o&t&n&a`. Parsers `deno-dom` **validados sobre HTML real**
  (legajo modelo 284265 / EZEQUIEL CARLOS GOMEZ): 6 expedientes con todos los
  campos + `detalle_ref`, y detalle (header 11 campos + actuaciones).

- **Taxonomía → salvavidas:** `OK·NOT_FOUND·SIN_LEGAJO·SIN_ADMIN·RATE_LIMITED·
  CIRCUIT_OPEN·TRAMIX_DOWN·TIMEOUT·PARSE_ERROR·TC_BLOCKED·FORBIDDEN`. Ante
  cualquier fallo, el modal ofrece el **deep-link oficial** con el legajo a la
  vista. El "i" cita la fuente (Disp. DPPJ 148/06: informativo, no vinculante).

- **Límite honesto (documentos diferidos):** ningún expediente del legajo modelo
  tiene PDF adjunto (`ActuacionDetails` de la observación no expone binario), así
  que **no se construyó un descargador a ciegas** ("no quedar atrapado en un
  desarrollo imperfecto"). `tramix_documentos_cache` + bucket privado quedan
  listos para cerrar el patrón con un expediente con adjunto real.

- **Capa de datos (mig 0198, aislada):** 6 tablas + bucket. RLS en todas (R2);
  las 5 internas sin policy (deny-all a clientes, sólo Edge fn con service_role)
  → advisor `rls_enabled_no_policy` nivel **INFO** = diseño buscado. GRANTs
  explícitos (R6). Gate/record SECURITY DEFINER con `REVOKE FROM authenticated`
  → no disparan advisor 0029. Smoke e2e de los RPCs en la migración (R18).

- **Verificación:** egress (vivo) · parsers consultar+detalle (vivo sobre 284265)
  · gate/record (smoke mig) · auth gate (401/NO_AUTH, vivo) · composición BD
  (Estudio Save → legajo_rpac 284265). **Pendiente:** click-through visual del
  modal logueado como cliente (gateado por credenciales del portal). Legajo de
  Estudio Save apuntado a 284265 para que ese test muestre los 6 expedientes.

- **Reglas:** R2, R4, R6, R7, R13, R18. Doc viva: `docs/tramix.md`.
- **Fecha:** 2026-06-04 · commit `69896b4`.

- **Addendum 2026-06-05 — documentos resueltos + legajo editable (en vivo):**
  - **Documentos** (supera el "límite honesto" de arriba): Pablo mostró que la
    actuación SÍ trae texto completo + documento. `tramix-doc-proxy` (verify_jwt):
    `actuacion` (extracto+fecha_firma+texto+tiene_documento) y `documento` (baja el
    `.doc` de `/DownloadActWord` server-side → bucket privado `tramix-documentos` →
    URL firmada 5'). Verificado en vivo (EXP 22178/25: `.doc` de 36.780 B).
  - **Legajo editable** (supera "el front NUNCA manda el legajo"): como TRAMIX es
    consulta **pública** (Disp. 148/06), el legajo pasa a ser **editable**. Default =
    legajo del cliente (`localStorage gg.tramix.legajo` = su última consulta) **o** el
    de la ficha (`legajo_rpac`); siempre editable. `tramix-consulta` (v7) y
    `tramix-doc-proxy` (v2) aceptan `b.legajo` y devuelven `legajo_default`; el
    ownership de detalle/actuacion/documento se valida contra `tramix_cache[legajo]`
    efectivamente consultado; `titular` = `expedientes[0].denominacion`. Modal con
    modos `form` (`[campo][Buscar]`) / `results` (`[campo][Actualizar][Cambiar de
    legajo]`); al reabrir auto-busca el último legajo. **Click-through visual COMPLETO
    en vivo** (Administración TEST): first-open→284265 (6 exp) · "Cambiar de legajo"→
    form preseleccionado · buscar 999999→salvavidas al portal con ese legajo ·
    "Actualizar" 284265→6 exp · actuación OBSERVACION GENERICA con extracto+fecha+texto
    completo+botón documento. Log server-side: 284265→OK×6, 999999→PARSE_ERROR×1.
  - **Reglas extra:** R4 (services), R7 (edge fns en repo), R8 (cols verificadas),
    R13 (sin window nativo). Fecha: 2026-06-05.

## DGG-47 · Diseñador de exámenes completo del campus (2026-06-05)

- **Qué:** se amplió el motor + la UI de exámenes del campus para cargar exámenes
  reales tipo "Examen Curso de Actualización FUNDPLATA 2026 (RPAC-PBA)" (6
  secciones temáticas por instructor, 15 preguntas ponderadas 6/7 pts = 100,
  aprobación 60%, única chance, justificación por pregunta). Pablo: "todo lo que
  necesitamos para este examen y los futuros".
- **Origen:** mapeo de las consignas del examen contra el diseñador existente. El
  motor ya hacía bien lo conceptual (puntaje ponderado → % → aprueba ≥
  nota_aprobacion; intento único server-side; condición examen-auto del
  certificado). Faltaban 3 recursos: **secciones**, **puntaje editable en la UI**
  (la UI siempre mandaba 1) y **justificación por pregunta**; + **edición** del
  examen/pregunta (antes sólo se podían borrar).
- **Mig 0199:** tabla `curso_examen_secciones` (RLS espejo de preguntas + GRANTs
  R6) + `curso_preguntas.seccion_id` + `curso_preguntas.explicacion`. RPC atómica
  `curso_iniciar_intento` (regla 4; advisory lock anti doble-click; el trigger de
  ventana/cap sigue validando). `curso_responder_examen` devuelve `explicacion`
  por pregunta en el detalle (MISMA firma (uuid,jsonb) → sin overload, R16; el
  cálculo de nota NO cambió). Smoke R18: correcto=100/aprobado, parcial=54/no.
- **Front:** `ExamenEditor` (gerencia) — descripción del examen, editar
  examen/pregunta, puntaje por pregunta, secciones (título+descr), explicación por
  pregunta, retroalimentación por opción, toggles mostrar_resultados/mezclar.
  `ExamenRunner` (alumno) — render agrupado por sección, respeta mezclar, radio
  single-correcta, resultado con feedback por pregunta + justificación (respeta
  mostrar_resultados).
- **Seguridad (E-GG-52 / mig 0200):** la doble auditoría (3 agentes) cazó que el
  alumno recibía `correcta`/`explicacion` en el payload de red. Se cerró con la
  RPC sanitizada `curso_examen_rendir` + RLS de preguntas/opciones staff-only
  (regla 3). La justificación se revela recién al responder.
- **Decisiones de Pablo:** secciones reales (sí), descartar la "Sección 1 · Datos
  del participante" del Google Forms por redundante (el alumno rinde logueado y
  matriculado; identidad/email automáticos), MC/VF de una sola respuesta correcta.
- **Pendiente:** carga del examen real (depende del curso "Actualización RPAC
  2026" en nuestro campus, que Pablo arma manual) + walkthrough visual logueado
  (gerente + alumno) — gateado por credenciales.
- **Reglas:** R2, R3, R4, R6, R12, R16, R18. Build limpio. Migs 0199 + 0200.
- **Fecha:** 2026-06-05.

## DGG-48 · El cierre de trámite notifica al cliente por cualquier vía (2026-06-06)

- **Qué:** unificamos la notificación al cliente del cierre de trámites. Antes solo
  el modal "Cerrar trámite" avisaba al cliente; cerrar moviendo la tarjeta en el
  kanban avisaba solo a gerencia (E-GG-53). Ahora cualquier transición a
  cerrado/resuelto notifica al cliente (email + push + campanita + línea en el
  portal), sin duplicar cuando se usa el modal.
- **Cómo:** el trigger universal `_notif_tracking_cerrado_trg` inserta la línea de
  cierre visible cuando `motivo_cierre IS NULL` (cierre fuera del modal), delegando
  el fan-out a `tracking_linea_on_insert`. No se reimplementa la notificación: un
  solo lugar de verdad.
- **Por qué así:** reusar la maquinaria de líneas garantiza paridad exacta con el
  modal (mismo email/push/campanita/portal). El discriminador por `motivo_cierre`
  es robusto porque `tracking_reabrir` lo limpia al reabrir.
- **Regla candidata (a confirmar con Pablo):** "todo evento terminal de negocio
  notifica a TODOS los públicos (gerencia + cliente); si hay N vías que llegan al
  mismo estado final, todas disparan el mismo fan-out."
- **Reglas:** R1, R17, R18. Mig 0201. Build limpio.
- **Fecha:** 2026-06-06.

## DGG-49 · Simetría total cierre↔reapertura del trámite + fix de reabrir-notify roto (2026-06-06)

- **Qué:** completando DGG-48 (avisar al cliente en el cierre por kanban), la
  **doble auditoría a fondo** (3 agentes paralelos + e2e, a pedido de Pablo)
  encontró el espejo: reabrir por kanban no avisaba a nadie y envenenaba el
  discriminador del cierre (E-GG-54), y el modal Reabrir con "notificar"
  tildado estaba ROTO en producción (E-GG-55). Pablo: "limpiar metadata +
  avisar al cliente" (simetría total).
- **Cómo:** **mig 0202** — reabrir por kanban limpia la metadata de cierre +
  inserta línea `'reapertura'` visible (fan-out al cliente por
  `tracking_linea_on_insert`), discriminado de la RPC por `reabierto_count`; +
  seed de categorías `'cierre'`/`'reapertura'` en `tracking_categorias_config`.
  **Mig 0203** — `tracking_reabrir(notify=true)` corregido (`encolar_email`
  smallint + `encolar_push` por `user_id`; cada notif envuelta).
- **Por qué:** un evento terminal de negocio y su inverso deben tratarse igual
  por TODAS las vías; y los smokes e2e del branch "notificar" cazaron un bug que
  la lectura estática no veía.
- **Regla candidata (a confirmar con Pablo):** "todo evento terminal de negocio
  (y su inverso) notifica a TODOS los públicos relevantes; si hay N vías que
  llegan al mismo estado final, todas disparan el mismo fan-out."
- **Reglas:** R1, R16, R17, R18. Migs 0202 + 0203. Build limpio. Verificado R18
  (smokes C/D/E). DB verificada limpia tras los smokes.
- **Fecha:** 2026-06-06.

## DGG-50 · Docente a cargo por asignatura + carga del curso Actualización 2026 RPAC (2026-06-06)

- **Qué:** Pablo armó las 5 asignaturas asincrónicas del curso "Actualización
  2026 RPAC" (cada módulo = una asignatura, con su docente a cargo y sus videos
  de YouTube). El modelo tenía instructor solo a nivel curso (uno) y foto por
  clase sin nombre → faltaba el **docente por módulo**.
- **Mig 0204:** `curso_modulos` += `docente_nombre`/`docente_foto_url`/
  `docente_bio` (ALTER, GRANTs vigentes). Editor de gerencia (`ContenidoTab`):
  bloque "Docente a cargo" (nombre + `ImageUploader` scope `modulo-docente` +
  bio). Vista del alumno (`CursoDetalleAlumnoPage` + `ClasePlayer`): docente
  encabezando cada asignatura en el nav + "Con <docente>" + avatar (foto o
  inicial) junto al reproductor.
- **Contenido cargado** (curso 488b58c3, publicado): 5 asignaturas / 19 clases
  asincrónicas con sus videos: (1) Comunicación efectiva y resolución de
  conflictos · Lic. Ximena González · 6; (2) Traspaso de Administración · Dr.
  Raúl Castro · 2; (3) Proceso administrativo ante el RPAC · Dra. Mayra Lucero ·
  3; (4) Obligaciones: libros, DDJJ · Fabián Beuchel · 2; (5) Auditoría interna y
  externa · Dra. Tamara Suken · 6. Coincide con las secciones del examen
  (DGG-47). Descripción por asignatura redactada; duraciones en blanco.
- **Verificado en vivo** (alumno de prueba, prod): 0/19 clases, las 5
  asignaturas con su docente, videos de YouTube embebidos y reproduciendo el
  correcto, el examen coexiste.
- **Fotos cargadas** (2026-06-06): las 5 fotos de docentes (zip de Pablo,
  nombre de archivo = docente) subidas a `campus-media/modulo-docente/<id>/` y
  asignadas a `docente_foto_url`. Para pasar la policy `campus_media_write_staff`
  (exige `is_staff()`; `get_user_role()` lee `profiles.role` en vivo) se elevó
  temporalmente el rol del alumno de prueba a gerente y se revirtió en el acto.
  Renderizan en vivo (HTTP 200, naturalWidth 314). Sin pendientes.
- **Reglas:** R1, R4, R6, R20. Mig 0204. Build limpio.
- **Fecha:** 2026-06-06.

## DGG-51 · Examen/bibliografía/encuentros como nodos propios del curso + CV del docente (2026-06-06)

- **Origen** (Pablo): en la vista del alumno el examen (y, a futuro, la
  bibliografía) se renderizaba como una sección FIJA debajo del reproductor de
  CADA clase ("se ve debajo de cada clase"), confundiendo la vista de la clase
  con la del examen, que es un estadio aparte (el último). Pablo pidió que el
  examen, la bibliografía y los encuentros sincrónicos "funcionen como un
  módulo": nodos propios del menú. Además: un campo de CV del docente
  descargable, y subir bibliografía como PDF (hoy sólo aceptaba link).
- **Decisión — nodos por tipo, NO módulos tipados** (Pablo, opción A de 2):
  el menú del curso del alumno tiene un nodo por cada clase y — como estadios
  propios, en orden fijo y lógico — encuentros sincrónicos → bibliografía →
  examen (último) → "Mi certificado". Click en un nodo = SOLO ese contenido a
  la derecha. Se descartó "módulos tipados y ordenables" (columna `tipo` en
  `curso_modulos` + relinkear examen/biblio/encuentros a módulos + rehacer el
  editor de gerencia) por mayor costo/riesgo sin necesidad: examen, bibliografía
  y encuentros YA son entidades propias colgadas del curso; el problema era 100%
  de presentación en `CursoDetalleAlumnoPage`.
- **Implementación frontend:** la selección se generalizó de `claseActivaId`
  (string) a `NodoSel` (clase/sincronico/bibliografia/examen/certificado); el
  panel derecho conmuta por nodo (default = primera clase). Se quitó el render
  fijo de encuentros + condiciones que colgaba arriba del reproductor; se agregó
  un aviso fijo de "encuentro en vivo ahora" (sólo si `zoom/webex_status =
  'en_curso'`) que salta al nodo sincrónico sin tocar el flujo delicado del
  embed (E-GG-14). La bibliografía como nodo soporta descarga de PDF
  (`archivo_url`) además del link.
- **CV del docente:** mig 0205 `ADD COLUMN curso_modulos.docente_cv_url`.
  Editable en gerencia (`ContenidoTab`, componente `FileUploader` nuevo) y
  descargable por el alumno en el nav de cada asignatura ("CV") y bajo el título
  de la clase ("CV del docente"). `FileUploader` (PDF, sin cropper) sube por
  `uploadCampusMedia` (R20), reutilizado para CV y bibliografía; scopes nuevos
  `modulo-docente-cv` y `biblio-archivo`.
- **Verificado en vivo** (alumno de prueba, prod, con datos de QA temporales ya
  borrados): vista de clase limpia (sólo la clase); nodos Encuentros (1 en vivo)
  · Bibliografía (Descargar PDF + Abrir) · Examen (último, abre el ExamenRunner
  sin colgar de ninguna clase); CV del docente descargable en nav y reproductor.
  Consola sin errores.
- **Reglas:** R1, R4, R6, R8, R20. Mig 0205. Build limpio (tsc + vite).
- **Fecha:** 2026-06-06.

## DGG-52 · Examen Integrador del Curso de formación RPAC cargado (2026-06-06)

- **Qué:** Pablo pasó el examen integrador del "Curso inicial de formación ·
  Administradores RPAC" (curso `202d8ec3`) en un .docx (export de Google Forms).
  Cargado con el mismo diseñador que FUNDPLATA (DGG-47): **14 secciones
  temáticas, 35 preguntas** (15 V/F + 20 opción múltiple), **100 pts**,
  aprobación **60**, **intentos 1** (sin recuperatorio, decisión de Pablo), sin
  mezclar, justificación por pregunta donde el origen la traía.
- **Datos del alumno NO se piden** (decisión de Pablo, igual que FUNDPLATA): el
  .docx traía una "Sección 1 · Datos del alumno" (8 campos: email, nombre,
  apellido, DNI, CUIT, matrícula, legajo, mail RPAC) → **omitida por completo**
  (ya los tenemos del perfil/administración; el alumno rinde logueado).
- **6 preguntas sin clave en el origen** (el .docx las marcaba "SIN RESPUESTA
  CORRECTA CONFIGURADA": P22, P23, P29, P30, P34, P35 = 17 pts inganables si se
  cargaban así). Se le consultaron a Pablo, que respondió: **P22=A, P23=C,
  P29=C, P30=B, P34=A, P35=C**. Con eso el examen es 100% respondible.
- **Carga:** DO block atómico (guarda anti-duplicado) con el patrón exacto de
  FUNDPLATA (V/F = 2 opciones Verdadero/Falso; MC = N opciones; `correcta`
  bool). No es migración (es contenido, como los módulos/clases del campus).
- **Verificado:** estructura (14 sec / 35 preg / 100 pts / exactamente 1 opción
  correcta por pregunta / totales por sección 1:1 con el doc). **Smoke de
  scoring** con las RPCs reales (`curso_iniciar_intento` + `curso_responder_examen`,
  todo revertido): todas correctas → **100/aprobado**; preguntas 1-18 mal (54
  pts) → **46/no aprobado**; 2º intento **bloqueado** por el trigger de ventana
  (única chance enforced). Motor sanitizado (E-GG-52): el alumno rinde por RPC
  sin recibir la clave.
- **Pendiente menor:** walkthrough visual logueado como alumno (la sesión del
  browser de QA se cayó; el render del nodo Examen + ExamenRunner ya se validó
  en vivo en el curso de Actualización, mismo componente).
- **Reglas:** R1, R3, R4. Sin migración (contenido).
- **Fecha:** 2026-06-06.

## DGG-53 · Acordeón de módulos en el menú del alumno (2026-06-07)

- **Origen** (Pablo, estética del campus): el menú lateral del alumno
  (`CursoDetalleAlumnoPage`) listaba TODOS los módulos con TODAS sus clases
  expandidas → scroll largo. Pablo pidió módulos colapsables: **nombre del
  módulo + docente siempre visibles**, clases colapsables, y **un solo módulo
  abierto a la vez** (abrir el 3 cierra el 2) — para acortar el scroll y
  concentrar la experiencia (más premium).
- **Implementación:** estado único `openModuloId` (string|null) + `accordionTocado`
  (distingue el default del estado elegido). `openModuloEfectivo = accordionTocado
  ? openModuloId : moduloDeActivaId`: hasta que el alumno toca el acordeón se abre
  el módulo de la clase activa (o el primero); después respeta su elección,
  incluido "todos colapsados". Cada módulo es una card (badge nº + título +
  chevron) con el bloque docente (foto/nombre/CV) SIEMPRE visible y las clases
  bajo `{open && <ul motion-safe:animate-fade-up>}`. El header SÓLO togglea (no
  cambia la clase activa); sólo los botones de clase setean `nodoSel`. Punto cyan
  en el header del módulo colapsado que contiene la clase activa. Los nodos de
  tipo (encuentros/bibliografía/examen/certificado, DGG-51) quedan como están,
  después de los módulos.
- **Verificado en vivo** (alumno de prueba, prod): default abre el módulo de la
  clase activa; abrir M3 cierra M1 (uno-a-la-vez); docente visible en colapsados;
  scroll mucho más corto; sesión persiste tras recarga; 0 errores de consola.
  Código revisado (header sólo togglea; estado único garantiza uno-abierto).
- **Reglas:** frontend puro, sin migración. Build limpio (tsc + vite).
- **Fecha:** 2026-06-07.

## DGG-54 · Rediseño del wizard de activación de solicitudes (collect-only + procesador final)

- **Pedido (Pablo, PDF "Wizard rediseñado"):** reorganizar flujo/orden/
  presentación del wizard de conversión solicitud→trámite **sin tocar la
  mecánica interna** de lo que ya funciona. Núcleo: el wizard **junta toda la
  info en pasos y NO procesa nada hasta el final** ("Comenzar proceso"), que
  recorre todo con una **barra de progreso** mostrando cada proceso.
- **Decisiones (4 preguntas a Pablo antes de codear):**
  - **Q1 · Procesamiento:** secuencial + reintento desde el paso fallido,
    reusando los RPCs existentes (no RPC orquestadora monolítica). Realista:
    emails/alta-usuario/campus no son reversibles.
  - **Q2 · Paso 2 docs incompletas:** revisión/rechazo/descarte son
    **terminales** (no generan comprobante/cobranza/tracking); "pedir docs y
    avanzar" completa todo y deja el PedidoDoc como primer tracking.
  - **Q3 · Sin cobro:** DDJJ saltea el comprobante (se emite al cerrar el
    trámite); gratuito/100% bonificado → comprobante **$0 sin cobranza**.
  - **Q4 · Paneles standalone:** se mantienen intactos (el wizard orquesta los
    mismos servicios) — mínimo riesgo de regresión.
- **Arquitectura:** `src/modules/solicitudes/components/wizard/` — `types.ts`
  (estado collect-only + flags + helpers `totalComprobante`/`adjKey`),
  `useWizardActivacion` (estado, flags curso/webinar/DDJJ/gratuito/origen, pasos
  condicionales, draft, navegación), 6 paneles (Cliente/Documentación/
  Comprobante/Gestoría/Tracking/Campus), `ProcesadorFinal` (runner secuencial +
  checklist en vivo + reintento + idempotencia por estado real), shell
  `WizardActivacionV2` con encabezado de contexto fijo. Swap del mount en
  `SolicitudDetailPage`; wizard viejo (`WizardActivacion.tsx`) eliminado.
- **Backend (mínimo):** mig **0206** `solicitud_pedir_docs_revision` (RPC +
  template `solicitud-docs-revision`, espeja `solicitud_rechazar` mig 0125) —
  única pieza nueva, para la rama terminal "revisión". El resto reusa RPCs
  existentes (solicitud_activar, emitir_comprobante_manual,
  registrar_cobranza_comprobante, solicitud_derivar_v3, curso_asignar_alumno,
  inscribir_a_webinar, tramite_pedido_doc_crear).
- **Trazabilidad (regla 8):**

  | Paso original | Nuevo paso | Motivo | Deps | Pruebas | Resultado |
  |---|---|---|---|---|---|
  | 1 Derivar (commit inmediato) | 4 Gestoría (opcional · diferido) | no procesar hasta el final | solicitud_derivar_v3 | build | OK |
  | 2 Alta cliente | 1 Cliente (primero) | orden PDF | solicitud_activar | build | OK |
  | 3 Tracking | 5 Tracking (+ observaciones) | orden PDF | solicitud_activar | build | OK |
  | panel aparte | 3 Comprobante (en wizard) | dentro del wizard | emitir_comprobante_manual, registrar_cobranza | smoke $0 | OK |
  | — | 2 Revisar documentación (✓/✗) | nuevo (PDF) | formulario_adjuntos, pedidoDoc, mig 0206 | smoke revisión | OK |
  | — (manual) | 6 Campus (curso/webinar) | nuevo (PDF) | asignar_alumno, inscribir_a_webinar | build | OK |
  | N commits sueltos | Procesador final secuencial + checklist | barra de progreso | todos | smoke + build | OK |

- **Cambios de comportamiento (capitalizados):** (1) derivación pasa de commit-
  inmediato a commit-al-final; (2) comprobante/cobranza entra al wizard; (3) se
  habilita comprobante $0 (la UI vieja bloqueaba precio ≤ 0).
- **Verificado:** smoke R18 mig 0206 (en_revision + observación + 1 email,
  revertido por RAISE EXCEPTION); smoke $0 (total=0.00 + cobranza $0 rechazada
  por la RPC, revertido); build limpio (tsc + vite) en cada chunk (A–F); push por
  chunk (código no montado hasta el swap → pushes intermedios seguros).
- **Pendiente:** prueba e2e en browser (gerente → portal cliente · Chunk G) +
  doble auditoría a fondo §6 (Chunk H).
- **Fecha:** 2026-06-08.

## DGG-55 · Chip + filtro "Comprobante pendiente" en trámites

- **Pedido (Pablo, 2026-06-08):** tras el wizard v2, todos los trámites generan
  comprobante (los gratuitos en $0.00) EXCEPTO las DDJJ (su comprobante se emite
  al cerrar). Para no perder de vista el seguimiento/cobranza de esos casos: un
  **chip + filtro "Comprobante pendiente"** dentro de trámites.
- **Definición:** "comprobante pendiente" = el trámite NO es terminal
  (cerrado/cancelado) Y no tiene NINGÚN comprobante no-anulado vinculado (por
  `tramites.comprobante_id` o `solicitudes.tramite_id→comprobante_id`). Capta las
  DDJJ y cualquier hueco. Distinto de `cobro_pendiente` (DGG-44: tiene
  comprobante pero impago) — son estados sucesivos.
- **Implementación:** mig **0207** computed column
  `comprobante_pendiente(tramites)` (SECURITY INVOKER, espejo de
  `cobro_pendiente`). Service `tramites.ts`: `TramiteListItem.comprobante_pendiente`
  + select. UI: chip violeta "Comprobante pendiente" en las cards del kanban y las
  filas de la lista + toggle en el header del kanban "Comprobante pendiente (N)"
  que filtra el board.
- **Verificado:** smoke read-only — 3 pendientes (los 3 trámites no-terminales
  reales hoy sin comprobante), **0 terminales** y **0 con comprobante no-anulado**
  falsamente marcados. Build limpio (tsc + vite). Types: entrada de función
  agregada a database.ts a mano (el regen local no tiene token; el computed
  column se consume vía select crudo + `TramiteListItem`, igual que cobro_pendiente).
- **Nota de proceso:** `scripts/generate-types.sh` sin token válido vacía
  database.ts (el `>` trunca antes de fallar) → siempre verificar `wc -l` y
  restaurar de git si quedó en 0.
- **Fecha:** 2026-06-08.

## DGG-56 · Referencia del campo (consigna) en cada documento adjunto

- **Qué/por qué (Pablo 2026-06-08):** "cada documento adjunto debe tener la
  referencia del campo que completa" (ej. "DNI Frente: archivo.jpg"). Antes se
  mostraba el slug crudo (`dni_frente`) o nada. Que los documentos no queden
  sueltos sino anclados a su consigna, en **todas** las superficies.
- **Superficies:** (1) wizard Paso 2 "Revisar documentación", (2) panel del
  gestor (acceso externo), (3) **mail al gestor** (`solicitud-derivada-gestoria`,
  nueva var `documentos` = lista "— Consigna: archivo"), (4) PDF del trámite,
  (5) ficha de gerencia (`SolicitudDetailPage`).
- **Modelo:** la etiqueta vive en el **schema** del formulario
  (`{sections:[{fields:[{name,label}]}]}`); `formulario_adjuntos.field_name` es
  el slug (join key). No hay tabla relacional de campos.
- **Implementación:** `src/lib/formSchema.ts` (NUEVO, extraído de
  `SolicitudDetailPage`, DRY) + mig **0208** `private.form_field_label(schema,slug)`
  (espejo SQL — jsonpath recursivo, fallback humanize idéntico al TS: sólo 1ra
  letra, NO `initcap`). `gestor_obtener_info_solicitud` devuelve `label`;
  `solicitud_derivar_v2` arma `documentos`. Firmas intactas (**R16**); UPDATE de
  plantilla idempotente; smoke embebido (**R18**). Mail SIN tocar el dispatcher:
  texto plano + `<div style="white-space:pre-line">{{documentos}}</div>`,
  `renderVars` escapa `&<>` (sin XSS), vacío = div invisible.
- **Verificado (§6):** 3 agentes (SQL sólido sin regresión, XSS cerrado; front
  sin bugs, `docChecks` intacto; coherencia) + e2e BD con ROLLBACK (panel:
  `label="DNI - Frente"`; mail: var `documentos` con 9 consignas reales). El
  smoke embebido del helper capturó una divergencia (initcap vs 1ra-letra) →
  corregida. Build limpio. Prueba en vivo OK.
- **Fecha:** 2026-06-08.

## DGG-57 · Las edge functions del proyecto evitan `@supabase/supabase-js` (raw fetch a REST/Auth/RPC)

- **Qué/por qué (capitalizado de E-GG-57, Lista JL · F9, 2026-06-08):**
  instanciar el cliente `@supabase/supabase-js` (`createClient`, vía esm.sh)
  **crashea el cold-start** del edge runtime actual de Supabase. Cuando una
  edge fn revienta en el boot, su `OPTIONS` devuelve 500 **sin** headers CORS,
  y el browser lo reporta como "CORS faltante / Failed to fetch" — un síntoma
  totalmente engañoso que cuesta horas de diagnóstico (ver E-GG-57: se
  descartó versión de supabase-js, import jsr, shared-import, verify_jwt y
  slug antes de aislar el bundle como culpable con una probe mínima).
- **Decisión:** **no usar `@supabase/supabase-js` en edge functions nuevas o
  reescritas.** Usar `fetch` crudo contra los endpoints REST/Auth/RPC:
  - Validar token de usuario: `GET ${SUPABASE_URL}/auth/v1/user`
    `{Authorization: Bearer <token>, apikey: ANON_KEY}`.
  - Service-role: `GET/POST ${SUPABASE_URL}/rest/v1/<tabla|rpc>`
    `{apikey: SERVICE_ROLE, Authorization: Bearer ${SERVICE_ROLE}}`.
  - Envolver TODO el handler en un try/catch global que devuelva 500 **con**
    CORS, para que ningún fallo no previsto se escape como "500 sin CORS".
- **Matices:** las edge fns viejas que YA funcionan con supabase-js (dispatch-*,
  submit-formulario, etc.) no se tocan preventivamente (andan); se migran sólo
  si fallan o si se las edita por otra razón. La excepción conocida pendiente
  es **`zoom-webinar-create`** (mismo bug latente, se reescribe en F6 webinars).
- **Check de cierre al deployar una edge fn:** `curl -i -X OPTIONS <fn-url>`
  debe devolver 2xx **con** `access-control-allow-origin`. Si da 500 sin CORS,
  la fn no bootea — revisar imports pesados.
- **Primer caso:** `zoom-encuentro-create` (reemplaza `zoom-meeting-create`),
  verificado en vivo creando una reunión Zoom real desde el botón de gerencia.
- **Fecha:** 2026-06-08.

## DGG-58 · Encuentros: fecha/hora obligatoria + el acceso del alumno se habilita 10 min antes (F9-ter · Lista JL)

- **Qué/por qué (JL 2026-06-08):** un encuentro sincrónico mostraba "Sin fecha"
  (el campo era opcional) y el botón del alumno para unirse aparecía apenas
  existía la sala, sin importar la hora → el alumno podía (a) conectarse a
  cualquier sala en cualquier momento y (b) que se le tome el "presente"
  temprano. JL: "la sala la crea el gerente cuando quiere, pero la fecha y el
  horario deben ser obligatorios; así, para el alumno, se condiciona su acceso
  a ese día y horario; el botón de conectarse debe habilitarse recién el día,
  10 min antes". Aplica a TODAS las modalidades (Zoom y Webex).
- **Decisiones:**
  1. **Fecha/hora OBLIGATORIA** al crear el encuentro (`EncuentrosTab`: Field
     `required` + guard en `crear()`). La creación de la SALA sigue siendo
     on-demand del gerente; lo obligatorio es la fecha.
  2. **Gating temporal del botón del alumno** (`EncuentrosEnVivoAlumno`):
     habilitado SÓLO en **[fecha_hora − 10 min, fecha_hora + duración]**, o si
     el encuentro está en vivo (`status='en_curso'`, vía webhook). Fuera →
     `<span>` no-click (regla 13) con "Se habilita {fecha+hora}" / "El encuentro
     finalizó" / "Pendiente de programar la fecha". Hook `useNow(30s)` para que
     cruce solo la ventana sin refrescar. **El host (gerente) NO se gatea**
     (entra antes a preparar). Ventana elegida por Pablo: "fin exacto" (sin
     colchón).
  3. **Misma regla en el HotCard "clase de hoy" de PortalHome** (lo cazó la
     §6: era un 2º botón "Unirme" que linkeaba directo a la sala sin gate). Si
     no está en ventana, el CTA lleva al curso (no a la sala). Así no hay dos
     botones de unirse con criterios distintos.
- **Alcance / límite conocido:** el gate es **client-side** (UX + integridad de
  asistencia). El ingreso real anticipado igual lo bloquea Zoom
  (`waiting_room:true` + `join_before_host:false`). Enforcement server-side
  (replicar la ventana en `zoom-sdk-signature` + no exponer `zoom_join_url`
  antes de `opensAt`) queda como **hardening opcional DESCARTADO explícitamente
  por Pablo (2026-06-08)**: se verificó en código que el "presente" lo registra
  SÓLO el webhook `meeting.participant_joined` (`zoom-webhook/index.ts:129-160`
  → RPC `curso_encuentro_zoom_evento`), **NO el click del botón** (el de Zoom es
  un `<a href={zoom_join_url}>` plano; el de Webex sólo abre el embed vía
  `setEncuentroEnVivoId`; `registrarAsistencia` no tiene caller en el flujo del
  alumno). Por ende un click temprano no puede falsear asistencia. Sumado al
  backstop de Zoom, el gate client-side cubre el único objetivo restante
  (prevención de confusión del alumno), así que el server-side no aporta. Edición de encuentros existentes (p. ej. setear
  fecha a uno viejo "Sin fecha" como "Asambleas Virtuales") → diferido a **F10**
  (encuentros como módulos); por ahora la fecha es obligatoria sólo en el alta.
- **§6 (2 agentes):** gate correcto (boundaries inclusivos, override isLive,
  legacy null cubierto, comparación UTC sin bug de tz, `useNow` sin leak, regla
  13) + `crearEncuentro` único caller (nada se rompe por la obligatoriedad);
  cobertura: árbol de entrada del alumno estrecho, único bypass real (HotCard)
  fixeado. **Prueba en vivo:** fecha-obligatoria verificada (toast de error +
  campo required + no crea). Gate del alumno verificado por §6 + build **y por
  render en vivo con sesión real de alumno matriculado** (2026-06-08): 2
  encuentros DEMO en el curso RPAC — uno dentro de ventana → botón "Unirme al
  encuentro" activo; uno futuro (+3 h) → chip "Se habilita {fecha − 10 min}"
  no-click. Capturado para Pablo; demo limpiado y sesión de gerente restaurada.
  Build limpio.
- **Fecha:** 2026-06-08.

## DGG-59 · El curso SÍ genera comprobante; la matrícula desde la solicitud nunca queda en silencio (F1 · Lista JL)

- **Qué/por qué (JL · F1):** JL observó que "el curso no genera deuda en CC". El
  diagnóstico (E-GG-59): el wizard v2 (2026-06-08) **sí** emite el comprobante
  del curso (cargo en CC) — el bug era del wizard **viejo**. Pablo aclaró el
  modelo: **el curso NO es como la DDJJ; el curso SIEMPRE genera comprobante**.
  La particularidad del curso es otra: el wizard, además, **matricula** al
  cliente desde la solicitud. Mandato de Pablo: "no rompamos eso; asegurémonos
  de que funciona bien".
- **Decisiones:**
  1. **El curso emite comprobante como cualquier servicio** (no se omite). Sólo
     DDJJ usa `comprobante.omitir`. Verificado e2e (BD) + en vivo: comprobante
     en Facturación + CC del cliente con cargo, todo reflejado en gerencia **y**
     portal.
  2. **La matrícula del curso es robusta y visible, nunca silenciosa.** Como
     `curso_asignar_alumno` resuelve el `profile_id` desde
     `administraciones.user_id` (que crea `altaClientePortal`), antes podía
     fallar en silencio (un curso **cobrado sin matricular**). Ahora: paso
     "Acceso al portal" **bloqueante para curso** (asegura el usuario *antes* de
     cobrar; idempotente → Reintentar seguro), paso "Matricular" **bloqueante**
     (error claro + Reintentar, no ámbar), `profileId` explícito desde el alta,
     y helper `asegurarUsuarioAlumno` que **resuelve o crea** el usuario del
     alumno chequeando `user_id` PRIMERO (sin re-crear/"hijackear"; el mail de
     bienvenida sólo al crear uno nuevo). Cubre cliente nuevo, existente sin
     usuario, y modal reabierto.
  3. **Las 2 solicitudes de curso viejas (06-05) sin comprobante se dejan como
     están** (no se hace backfill) — decisión de Pablo.
- **§6 (1 agente) + e2e BD + prueba en vivo:** la auditoría cazó BUG-A (cliente
  existente sin usuario quedaba atrapado) y BUG-B (modal reabierto perdía el
  ctx) → ambos cubiertos por el helper antes de la prueba en vivo. Prueba en
  vivo end-to-end (gerente procesa curso → comprobante `00001-…22` $180k +
  matrícula visible + portal del cliente con la deuda en Mi cuenta). Dato QA
  limpiado tras confirmar Pablo. Build limpio. Commits `a2ff588` + `74bd0c4`.
- **Lección de proceso (capitalizada):** verificar flujos financieros **en la
  UI real (gerencia + portal del cliente)** y que el dueño lo confirme **antes**
  de limpiar el dato de prueba. El smoke en tablas no alcanza.
- **Fecha:** 2026-06-09.

## DGG-60 · F2 · Referencia del egreso a gestoría: cliente · trámite (no reiterativa)

- **Contexto (Lista JL · F2):** el movimiento de egreso a la gestoría
  (`origen='derivacion_gestoria'`, generado por `solicitud_derivar_v3` —
  DGG-43) mostraba en Cajas/Movimientos sólo la gestoría destinataria + un id
  opaco de la solicitud. No se podía saber **a qué cliente** ni **a qué
  trámite** correspondía el pago. Además el `administracion_id` del movimiento
  quedaba NULL cuando la derivación ocurría antes de vincular el cliente.
- **Decisión:** descripción CLARA y **no reiterativa**. Pablo: "una
  concatenación clara, pero que no se reitere… porque podría ser que el mismo
  cliente pida más de una vez el mismo trámite a través del tiempo". El
  distinguidor único es el **código TRM-XXXX** del trámite (o, si todavía no hay
  trámite, la solicitud corta `Sol. XXXXXXXX`). Formato:
  `Egreso gestoría · <Cliente> · <TRM-XXXX — Servicio> · <Gestoría>`.
- **Trampa evitada (reiteración):** el título del trámite ya es
  `"<servicio> · <cliente>"`, así que usarlo embebía el nombre del cliente
  **dos veces**. El helper usa el **servicio limpio** (`servicios.nombre` →
  `servicio_slug`), no el título del trámite. Detectado y corregido en el
  backfill **antes** de cerrar.
- **Implementación (mig 0209):** helper `private.egreso_gestoria_ref(solicitud,
  gestoria) RETURNS jsonb` (DRY entre la RPC y el backfill) → `{descripcion,
  referencia, admin_id}`. `referencia = 'SOL:<uuid>[ · TRM:<codigo>]'` para
  trazabilidad de máquina. `solicitud_derivar_v3` (misma firma → R16 ok,
  CREATE OR REPLACE) lo invoca. Backfill de los egresos históricos + resuelve
  `administracion_id` si quedó NULL. Smoke R18 al cierre (`DO $smoke$` verifica
  que la descripción matchea `'Egreso gestoría · %'`).
- **Reglas aplicadas:** R8 (E43 · `information_schema` antes de tocar tablas con
  naming híbrido), R16 (misma firma → no overload), R18 (smoke e2e en mig que
  cambia el INSERT de una RPC).
- **Fecha:** 2026-06-09.

## DGG-61 · F5 · Bloque de costos en el formulario de consultoría jurídica ($20k/$36k)

- **Contexto (Lista JL · F5):** el formulario público `consultoria-juridica`
  era el único de los 5 formularios que NO mostraba el bloque "Costos del
  trámite" (`costos_info`); los 4 RPAC (matriculación/renovación/certificado/
  DDJJ) ya lo tenían. Hueco de paridad entre formularios.
- **Decisión (Pablo):** dos tarifas alineadas al campo `requiere_analisis` que
  el form **ya** pregunta ("¿Requiere análisis de actas o reglamentos?"):
  - **Consulta jurídica → $20.000** ("sin análisis de documentación").
  - **Consulta con análisis de actas o reglamentos → $36.000** ("incluye la
    revisión de la documentación adjunta").
  El servicio del catálogo (`juridico_consulta`, precio $25.000) **NO se toca**:
  el bloque es informativo (igual que en los otros formularios). El precio del
  comprobante lo ajusta el gerente según corresponda.
- **Implementación (mig 0210):** insert quirúrgico del bloque `costos_info` como
  primer campo de la sección "Pago" (antes de "Adjuntar comprobante de pago"),
  vía rebuild por secciones (preserva los 10 campos existentes y el `condition`
  de `docs_analisis`). Reusa la cuenta MP estándar (CVU/alias/titular/CUIT) y la
  forma JSON idéntica a los otros 4 forms. **Idempotente** (si ya hubiera un
  `costos_info`, no hace nada) + smoke R18 (verifica 1 bloque / 2 ítems /
  comprobante intacto). `schema_draft` se limpia (el builder muestra lo
  publicado). **Sin cambios de frontend**: el render de `costos_info`
  (`CostosInfoCard`) y el editor del builder ya existen (AJL-4); el campo es
  presentacional (excluido de validación/submission por el runner).
- **§6 doble auditoría (2 agentes + verificación):** A (integridad/render) y B
  (downstream/submission) **ambos OK** — ningún campo perdido, el bloque no
  entra al payload → no afecta submission/email/`documentos` (DGG-56)/PDF/ficha/
  cross-match (Bloque J)/builder. Prueba en vivo en el form público: las dos
  tarifas + cuenta + notas renderizan premium (desktop), consola sin errores de
  app. **Hallazgo menor diferido** (no bloqueante): el edge fn `submit-formulario`
  y el `onSave` del builder no listan `costos_info`/`file_download` en sus
  skip-lists como sí lo hace el runner — hoy inerte (el bloque no es `required`
  ni aporta key al payload); se difiere a un chunk de consistencia aparte.
- **Fecha:** 2026-06-09.

## DGG-62 · F7 · Banner de solicitudes nuevas en tiempo real (Inicio de gerencia)

- **Contexto (Lista JL · F7):** la gerencia quería un aviso claro en el dashboard
  cuando entra una solicitud nueva (formulario público). Ya existía un
  `NuevasSolicitudesWidget` (Bloque B / obs 1, tarea #160), pero (a) **estaba roto**
  — filtraba un estado inexistente, ver E-GG-61 — y (b) cargaba una sola vez, sin
  realtime.
- **Decisión de Pablo:** "banner en el Inicio + tiempo real", énfasis **sutil**
  (aparición + número, sin sonido ni toast). No global (sólo el Inicio).
- **Implementación (puro frontend, sin migración):**
  1. **Fix del estado (E-GG-61):** `listSolicitudesPendientes` ahora filtra
     `estado IN ('recibida','en_revision')` (antes `'nueva'`, inexistente). El
     banner por fin muestra las solicitudes que esperan la primera acción.
  2. **Tiempo real:** el widget se suscribe a Realtime de `solicitudes`
     (`useRealtimeRefresh`; la tabla ya estaba en la publicación
     `supabase_realtime`; la RLS `sol_staff_all` filtra por staff) → el banner
     aparece/actualiza el contador **sin recargar**.
  3. **UI:** estado activo = banner ámbar prominente con punto "en vivo"
     (`animate-ping`) + número animado al cambiar (`key={total}` +
     `animate-fade-in`). Estado vacío = barra slim "Todo al día" (no roba foco).
     **Reubicado arriba de todo** en el Inicio (antes de los asistentes).
- **§6 (2 agentes) + prueba en vivo:** realtime/correctness + UX/regresiones,
  ambos OK (suscripción + cleanup, RLS solo-staff, debounce de ráfagas → 1
  recarga, sin loops, guard mounted, tour desacoplado, sin imports muertos).
  **Prueba en vivo (gerente, deploy):** el banner mostró las 2 pendientes reales
  que estaban invisibles y, al flipear una 3ª a `recibida`, subió a 3 **en vivo
  sin recargar** y volvió a 2 al revertir. Consola sin errores de app. La sesión
  de gerente había expirado y los 2 únicos gerentes son personas reales → **NO
  creé cuentas QA ni toqué sus contraseñas** (regla de seguridad); Pablo se
  relogueó para la prueba.
- **Commits:** `c48e907` (realtime + reubicación) + `29e5d25` (fix del estado).
- **Fecha:** 2026-06-09.

## DGG-63 · F6 · Webinars con esquema rico + inscripción CONDICIONAL (form compartido + inscribe al vigente)

- **Contexto (Lista JL · F6):** los webinars debían dejar de ser un alta seca y
  pasar a tener identidad tipo curso (banner + docente(s) con foto), y la
  inscripción (landing + portal) debía ser **condicional**: si hay un webinar
  vivo se muestra su identidad + formulario; si no, una página de espera.
- **Decisiones de Pablo (lockeadas):**
  - **Esquema rico:** `banner_url` + `docentes` jsonb roster `[{nombre,foto_url}]`
    (varios, foto opcional) + toggle `publicado`.
  - **Vigencia** = hasta `fecha_hora + duracion_min` (la inscripción se mantiene
    hasta que el webinar termina).
  - **"El más próximo gana":** si hay varios publicados+vigentes, se muestra el de
    fecha más cercana aún no terminado; **no se bloquea** publicar un 2º.
  - **Disposición condicional:** con webinar vigente → branded (banner + nombre +
    descripción + docentes con foto) + el formulario vinculado; sin webinar →
    página de TEXTO propia: «Estate atento a nuestra próxima capacitación
    gratuita. / Creemos que la capacitación es clave para la excelencia… que no
    encajen, sino que sobresalgan. / #AliadosDeTuTiempo» (NO la página "Muy
    pronto").
  - **Form compartido + inscribe al vigente** (decisión de chunk 3): todos los
    webinars usan el form `webinarios` (categoría `evento`); el editor **no** lleva
    selector de form; enviar ese form inscribe SIEMPRE al webinar vigente.
  - **Edición completa** del webinar en el detalle (título/descr/fecha/hora/
    duración además de banner/roster/publicar) y **aviso suave** al publicar (no
    se bloquea; se avisa si falta banner/docentes/canal).
- **Implementación (4 chunks):**
  1. **Chunk 1 (mig 0211):** `webinars` += `banner_url`/`publicado`/`docentes`;
     índice parcial `idx_webinars_publicado_fecha`; RPC pública
     `webinar_inscripcion_activa()` (anon, SECURITY DEFINER, SÓLO campos públicos
     —sin secretos Zoom—).
  2. **Chunk 2 (frontend):** editor en `WebinarDetailPage` — `PublicacionCard`
     (toggle + estado de vigencia + aviso suave), `DatosWebinarCard` (edición
     completa), `BannerCard` + `DocentesCard` (roster: agregar/quitar, nombre +
     foto c/u) reusando el bucket `campus-media` con scopes nuevos
     `webinar-banner`/`webinar-docente` vía `ImageUploader`→`safeStorageKey`
     (R20). Pill "Publicado/Borrador" en la lista (R14). Tipos `webinars`
     reflejados a mano en `database.ts` (precedente DGG-55; el regen completo con
     token queda para cuando esté disponible).
  3. **Chunk 3 (migs 0212/0213 + frontend):** `private.webinar_vigente_id()` como
     ÚNICA fuente de "el más próximo gana", reusada por la RPC (qué se muestra) y
     por el trigger `inscribir_webinar_desde_submission` (a quién se inscribe:
     `COALESCE(form.webinar_id, vigente)`). La RPC cae al form `evento`
     compartido cuando el webinar no tiene uno propio (`COALESCE` + LATERAL).
     Frontend: `WebinarInscripcionShared` (hook `useWebinarVigente` +
     `WebinarIdentidad` + `WebinarTextoEspera`), página pública **`/webinars`**
     (identidad + `FormularioRunner` embebido por `formulario_slug`, ó texto) —
     destino del CTA de webinar de la landing (antes `/formulario/webinarios`);
     **portal**: hero branded del vigente + inscripción one-click
     (`cliente_webinar_inscribirme`), manteniendo "mis inscripciones"/grabaciones
     (el vigente se excluye de las listas para no duplicar; sin vigente → texto).
  4. **Chunk 4:** §6 + prueba en vivo + docs.
- **§6 doble auditoría (3 agentes + e2e en BD):** hallazgos corregidos en el mismo
  chunk: `DocentesCard` identificaba docentes por índice (riesgo de perder una
  edición / aplicar foto al docente equivocado) → reescrito con id estable de
  sesión + `rowsRef` + persist deduplicado; `darkHero` en `/webinars` dejaba el
  nav blanco sobre blanco → quitado; validación de duración/fecha en
  `DatosWebinarCard`; doble `<h1>` en el portal → prop `as` en `WebinarIdentidad`;
  aviso de docentes sin nombre. **e2e (BEGIN/ROLLBACK):** el trigger inscribe al
  **vigente** al enviar el form compartido (canal youtube), la RPC devuelve
  identidad rica + `formulario_slug='webinarios'` por fallback con
  `formulario_id` NULL, y NULL al despublicar/vencer. **R16** (0 overloads) y
  **R17** (0 triggers inseguros) limpios; **R3** OK (la RPC pública no filtra
  secretos Zoom/Webex). **Hallazgo PRE-F6 derivado a tarea aparte** (no es
  regresión de F6): la policy `webinars_authenticated_select USING(true)` (mig
  0050) deja a cualquier `authenticated` leer secretos Zoom por `select *`
  directo; ningún flujo F6 lo explota (el portal usa RPCs curadas).
- **Prueba en vivo (URL Vercel):** **chunk 2 (editor, sesión de gerente)** —
  Publicación (toggle + pill emerald "Publicado y vigente"), Datos (Guardar
  deshabilitado si no hay cambios), Banner (preview + Reemplazar), Docentes
  (roster 2 filas + Agregar + fotos), edición de nombre de un docente que
  **persistió sin corromper al otro** (fix validado en vivo), pill "Publicado" en
  la lista. **chunk 3 público (`/webinars`, anónimo)** — branded (banner +
  título + meta + descripción + docentes con foto + form embebido) y, al
  despublicar, la página de texto; nav nítido (fix darkHero); **consola sin
  errores**. Mobile 360 verificado por código (la tool de resize no refleja
  360px en la captura, mismo límite que DGG-51). **Portal cliente (sesión de
  cliente QA creada por SQL a pedido de Pablo):** hero branded (banner + título
  como `h2` + meta + descripción + docentes con foto) + botón **one-click
  "Inscribirme gratis"** → `useConfirm` (regla 13) → toast **"¡Inscripto!"** → el
  botón pasa a **"Ya estás inscripto"** (`yaInscriptoVigente` tras reload) y el
  vigente NO se duplica en las listas. Verificado end-to-end.
- **Cleanup QA:** el cliente QA (auth.users + identity + profile + administración)
  y el webinar de prueba se **eliminaron por completo** (0 webinars; 0
  usuario/profile/administración/identity/inscriptos QA; cascadas FK verificadas).
  Browser deslogueado.
- **Nota de proceso:** Pablo confirmó que los **clientes/usuarios QA efímeros se
  crean por SQL** para la prueba en vivo y se limpian — NO aplica a los 2
  gerentes reales (sus contraseñas no se tocan).
- **Commits:** `3692660` (chunk 2) · `da1b1dc` (chunk 3) · `64e9ab3` (§6 fixes).
- **Fecha:** 2026-06-09.

## DGG-64 · Límite staff/cliente en webinars = RLS, NO grants por columna (E-GG-62)

- **Contexto:** al cerrar la fuga de secretos Zoom/Webex de `webinars` (E-GG-62)
  había 3 caminos: (a) RLS de la tabla a sólo-gerencia, (b) vista pública de
  columnas no-secretas + base cerrada, (c) mover los secretos a una tabla hija
  `webinar_secretos`. Pablo eligió **(a)**.
- **Por qué (a):** hoy hay 0 webinars / 0 secretos / 0 certs → cualquier opción es
  no-destructiva, y (a) es 1 sola línea (drop de la policy permisiva) sin tocar
  RPCs ni edge functions. (b) y (c) agregan superficie (vista a mantener / 2 RPCs +
  2 edge fns) para el **mismo resultado práctico**.
- **Insight reusable (clave):** en Supabase, gerentes y clientes son el **mismo rol
  DB `authenticated`**; la distinción se hace por **RLS** vía `private.is_staff()`
  (que lee `profiles.role`), no por rol de Postgres. Corolario: **los GRANTs por
  columna NO sirven para separar staff de cliente** (lo que se revoca a
  `authenticated` se le revoca a AMBOS, rompiendo gerencia). Por eso, para
  proteger columnas que SÓLO gerencia debe ver, la herramienta correcta es **RLS de
  fila** (o separar la data en otra tabla/RPC SECURITY DEFINER), nunca
  `REVOKE … (columna) FROM authenticated`. Esto aplica a todo el proyecto.
- **Residual:** (a) deja la tabla con columnas secretas; si una mig futura re-abre
  un SELECT a `authenticated` se reabre la fuga. Mitigación: COMMENT de advertencia
  en `webinars_staff_all` + E-GG-62. Si algún día se justifica blindarlo, (c) es el
  upgrade. **Verificado** e2e en BD + en vivo contra prod (ver E-GG-62).
- **Fecha:** 2026-06-09 · mig 0214.

## DGG-65 · F8 · Sistema de filtros premium en Solicitudes y Trámites (triage a escala)

- **Contexto (Lista JL · F8):** José Luis pidió "un sistema de filtros premium para
  solicitudes y trámites que segmente la visión del gerente… pronto serán cientos…
  filtro predeterminado que sólo muestre activos (esconde lo cerrado, no lo borra)…
  no todo multiselect: switches y cards que funcionen como filtros… los encabezados
  de la lista también filtros". Pablo sumó: "entendé la empresa para sugerir algo
  superador; asumí cientos en simultáneo".
- **Lectura del problema (lo que guió el diseño):** a escala el dolor del gerente
  no es "filtrar por atributo" sino **triage**: ¿qué necesita mi acción HOY? Por eso
  los filtros estrella son **segmentos inteligentes** que responden esa pregunta, no
  selects crudos.
- **Decisiones de Pablo (lockeadas):** (1) **"Solo activos" ON por default** (switch;
  al apagarlo aparece todo, lo cerrado nunca se borra); (2) estado de filtro
  **EFÍMERO** (no URL ni localStorage); (3) Solicitudes **mantiene cards** + barra
  premium (no se convierte en tabla); (4) las **KPI cards de arriba funcionan como
  filtros** (segmentos clickeables); (5) **encabezados ordenables** en la tabla de
  Trámites.
- **Implementación (3 chunks):**
  1. **Toolkit compartido** (`components/common/Filters.tsx`): `Switch`,
     `FilterChips<T>`, `FilterMultiSelect` (popover + búsqueda + click-outside),
     `SegmentCard` (KPI-card-filtro), `SortHeader` + `useSort<T>` (asc→desc→sin
     orden, nulls al final), `ResultCount`. Estado efímero (vive en cada página).
  2. **Trámites** (`tramitesFilter.ts` + `TramitesFiltros.tsx` + lista tabla +
     kanban): activos = abierto/en_progreso/esperando_cliente/resuelto (cerrado/
     cancelado ocultos con el switch). Segmentos: Vencidos · Vence ≤7d · Esperando
     cliente · Por cobrar · Sin comprobante. Barra: chips Estado (sólo lista) +
     Prioridad, multiselect Categoría + Servicio (búsqueda; se oculta si no hay),
     búsqueda. Encabezados ordenables (Cliente/SLA/Prioridad/Estado). Kanban:
     mismos segmentos + barra **sin chips de estado** (las columnas SON los
     estados); con "Solo activos" ON oculta las columnas Cerrados/Cancelados;
     drag&drop + gate de cobranza DGG-44 intactos. `listTramites` += join aditivo
     `servicios(id,nombre)`.
  3. **Solicitudes** (cards + barra): segmentos = los estados de triage como
     cards-filtro (Sin revisar/En revisión/Derivadas; +Activadas/Rechazadas/
     Descartadas al apagar el switch) — sin chips de estado redundantes. Barra:
     búsqueda + Categoría/Servicio multiselect + chips de Origen (landing/portal/
     público). Se quitó la sync a URL (efímero); el deep-link del widget F7
     `?estado=activas` sigue OK porque coincide con el default.
- **Escala / R19:** el universo se trae por backend según "Solo activos" (limit
  1000) y **los conteos de segmentos + filtros + orden se resuelven en memoria**
  (conteos sobre el universo, regla 19); aviso ámbar si se excede el tope (lista y
  kanban, sin truncado silencioso). Para cientos, instantáneo; si algún día son
  miles, se revisa con server-side. **DGG-33 respetado:** ningún filtro/columna por
  "asignado" (Gestión Global no tiene asignaciones individuales).
- **§6 doble auditoría:** chunk 2 con **2 agentes en paralelo** (0 bloqueantes; 3
  menores fixeados: aviso de truncado en el kanban, clase `group` faltante en
  `SortHeader`, ocultar el multiselect de Servicio vacío) + **e2e en BD**
  (BEGIN/ROLLBACK): `vence_at` pasado en un activo cuenta como "vencido" (input del
  segmento Vencidos), el join de servicio devuelve nombre, las columnas computadas
  `cobro_pendiente`/`comprobante_pendiente` son legibles. El toolkit y el patrón
  R19/filtro quedaron auditados ahí; el chunk 3 los reutiliza.
- **Prueba en vivo (gerente, prod):** **Trámites lista** — segmento "Sin
  comprobante"→3 (card activa, "3 de 5"); "Solo activos" 5↔9 con chips de Estado
  dinámicos; multiselect Servicio (popover+búsqueda+conteos+badge+click-outside)→4;
  orden por Cliente A→Z; Limpiar. **Trámites kanban** — columnas 4↔6 (Cerrados/
  Cancelados ocultos con el switch ON, visibles al apagarlo). **Solicitudes** —
  segmentos 3↔6, "Solo activas" 2↔9, "Activadas"→7, chips de Origen. **Consola sin
  errores de app** (sólo ruido de extensiones `:0:0`). Mobile 360 verificado por
  código (la tool de resize no refleja 360px, mismo límite que DGG-51). Sin
  mutaciones (sólo toggles de filtro).
- **Commits:** `1afc509` (toolkit) · `d42c269` (Trámites) · `a4c3cc3` (Solicitudes).
- **Fecha:** 2026-06-11.

## DGG-66 · F4 · Moderación de aportes del gestor (cambio de paradigma)

- **Contexto (Lista JL · F4):** "cada envío del gestor sobre un trámite será una
  SOLICITUD DE REVISIÓN para la gerencia" que decide: (a) publicar tal cual, (b)
  publicar editado (redacción/adjuntos), (c) publicar + cambiar estado, (d) dejar
  interno (no visible al cliente).
- **El flujo real (que había que interceptar):** el gestor externo, desde su
  magic-link (`/externo/:token` → `gestorCargarAvance` → RPC `gestor_cargar_avance`),
  insertaba una `tracking_lineas` con `categoria='gestor_avance'` y
  `visible_cliente=true` → el trigger notificaba al cliente AL INSTANTE. O sea, se
  publicaba directo.
- **Decisiones de Pablo:** moderar en **AMBAS** superficies (bandeja dedicada +
  inline en el detalle del trámite) · al gestor **sólo "recibido, en revisión"**
  (no se le notifica el resultado) · acciones **a/b/c/d + Descartar** (5ª: soft,
  con motivo, queda como auditoría, NO se publica ni queda como línea visible) ·
  al editar se **PRESERVA el texto original** del gestor.
- **Implementación (2 chunks):**
  - **Chunk 1 (backend, mig 0215, commit `10a9a3b`):** `tracking_lineas` += columnas
    de moderación (`moderacion_estado`/`gestor_descripcion_original`/`gestor_label`/
    `moderada_at`/`moderada_por`/`descarte_motivo`). `gestor_cargar_avance` ahora
    inserta `visible_cliente=false` + `moderacion_estado='pendiente'` (el cliente NO
    se entera; `cliente_tracking_lineas` ya filtra `visible_cliente=true`, sin
    tocarla). `tracking_moderar_gestor_avance` (staff): publicar (edita texto/
    adjuntos opcional + estado opcional + notifica al cliente vía helper) / interno /
    descartar. `tracking_moderacion_pendientes` (cola). Helper
    `private.tracking_notificar_avance_cliente` extraído (email+push+notif), reusado
    por el trigger (líneas de staff visibles) y por la RPC al publicar — sin drift;
    el trigger reetiqueta la alerta de gestor_avance como "PENDIENTE de revisión".
  - **Chunk 2 (frontend, commits `c6bd9fe` + `fffa318`):** tipos (`tracking_lineas`
    en database.ts); API (`moderarGestorAvance` + `fetchModeracionPendientes`);
    **bandeja `ModeracionPage`** (`/gerencia/moderacion` + ítem de nav, realtime);
    **`ModeracionCard`** con las 5 acciones (Editar/Estado-select/Descartar/Interno/
    Publicar); **sección inline** ámbar en `TrackingDetailPage` (los pendientes van
    ahí, NO al timeline; los descartados se ocultan; los internos siguen visibles
    para gerencia; contadores/badge/KPI/chips/PDF sobre `lineasVisibles`); **lado
    gestor** (`AccesoExternoPage`): "Recibido · en revisión de la gerencia" + nota.
- **§6 doble auditoría:** **backend e2e en BD** (BEGIN/ROLLBACK, impersonando
  gerente): el aporte entra pendiente+invisible, la cola lo lista (3/3),
  publicar→visible+publicado, interno→invisible+interno, descartar→descartado+motivo;
  R16 (0 overloads) y R17 (0 funciones inseguras en tracking_lineas) limpios.
  **Frontend (1 agente):** 0 bloqueantes; 2 menores fixeados (contadores sobre
  `lineasVisibles` en vez de `data.lineas` crudo; botonera de la card deshabilitada
  mientras una acción corre).
- **Prueba en vivo (gerente, prod):** la **bandeja** muestra el aporte pendiente
  (TRM + servicio + cliente + gestor_label + texto + 5 acciones); el **detalle del
  trámite** muestra la sección inline "1 aporte pendiente" arriba de todo, con
  contadores correctos (LÍNEAS 2 = excluye el pendiente); **Descartar** end-to-end
  (prompt de motivo regla 13 → toast "Aporte descartado" → la sección desaparece,
  sin notificar al cliente). Consola sin errores de app. Aporte QA sintético creado
  y **eliminado** (0 residuo). Publicar/interno verificados por el e2e del backend
  (no se publicó en vivo para no notificar a un cliente real); el "en revisión" del
  gestor es cambio de copy verificado por build.
- **Commits:** `10a9a3b` (backend) · `c6bd9fe` (frontend) · `fffa318` (§6 fixes).
- **Fecha:** 2026-06-11.

## DGG-67 · F4 · Cierre real: live test de 3 roles + doble auditoría §6 → fix de fuga RLS (E-GG-63)

- **Qué:** completa el cierre de DGG-66 (la "prueba en vivo" previa fue parcial:
  sólo gerente + Descartar). A pedido de Pablo se corrió el **flujo modelo
  completo de las 3 partes** en producción con cliente QA efímero por SQL, +
  la **doble auditoría §6 a fondo** (3 agentes en paralelo + e2e en BD).
- **Live test 3 roles (prod):** **gestoría** (magic-link `/externo/:token`) carga
  4 aportes → "Recibido · en revisión", *Historial publicado* vacío (no llegan al
  cliente). **gerencia** (`/gerencia/moderacion`) modera los 4 ejercitando las
  alternativas: publicar tal cual / **editar+publicar+cambiar estado→Esperando
  cliente** / interno / descartar (con motivo, regla 13). **cliente** (portal) ve
  **sólo los 2 publicados** — B en su **versión editada** (no el crudo "fui a afip"),
  badge "TU ACCIÓN" por el cambio de estado, home "2 nuevos avances" (no 4); interno
  y descartado **ocultos**. Mobile (≤640) sin overflow; consola sólo ruido de
  extensión. Cliente QA + trámite + solicitud + token **eliminados** (residuo 0).
- **§6 → hallazgo crítico (E-GG-63):** la RLS `tl_admin_select` de `tracking_lineas`
  no filtraba `visible_cliente` → un cliente podía saltear la RPC SD vía PostgREST y
  leer aportes interno/descartado/pendiente + el texto crudo del gestor + el motivo
  de descarte de SUS trámites. Confirmado e2e (cliente real: 4 filas, 2 ocultas).
- **Decisión (mig 0216): `DROP POLICY tl_admin_select`** (no "endurecer con
  `visible_cliente=true`"). Razón: el cliente NO lee la tabla directo en ningún
  flujo (sólo por `cliente_tracking_lineas` SD); una policy SELECT de cliente es
  superficie de ataque sin uso → **denegar por defecto** cierra filas Y columnas
  sensibles de una. **Refuerza DGG-64/E-GG-62:** en Supabase staff y cliente comparten
  el rol DB `authenticated`; la RLS (no los grants por columna) es el límite, y una
  tabla que el cliente sólo lee por RPC SD no debe tener policy SELECT de cliente.
  Menores del mismo §6, fixeados igual: validación de `p_estado_asociado`+texto vacío
  (bug "banana"), índice FK `moderada_por` (R11), copy/comentario stale, type gap
  (RPCs F4 faltaban en `database.ts` → regeneradas, `as never` del nombre fuera).
- **Verificación post-fix:** e2e BD (cliente directo 4→**0** filas, RPC sigue **2**;
  validaciones rechazan banana/vacío 22023; publicar sin regresión; R16 0 overloads),
  build limpio, y portal del cliente re-chequeado en vivo (sigue mostrando los 2).
- **Fecha:** 2026-06-11.

## DGG-68 · F10 · Encuentros sincrónicos como MÓDULOS (docente + 3 modalidades de condición) — última de la Lista JL

- **Qué (verbatim JL):** que los encuentros sincrónicos sean "módulos" con **docente
  (nombre + foto + CV, como los módulos asincrónicos DGG-50/51)** y que se pueda
  configurar la condición de asistencia en **3 modalidades**: **encuentro único**
  (presente en ese), **encuentros alternativos** (presente en ≥1 del bloque) o
  **serie/bloque** (presente en TODOS). + poder **editar encuentros viejos** (F9-ter).
- **Aclaración de Pablo (clave para el modelo):** un curso puede tener VARIOS módulos
  sincrónicos, cada uno con su modalidad; el "presente" se toma igual que hoy (enlace
  10 min antes + Zoom devuelve asistencia); lo que cambia es cómo se computa "condición
  cumplida" para el certificado.
- **Modelo (reusa el sistema de condiciones, sin tocar el gate del cert):** un **módulo
  sincrónico = una fila de `curso_condiciones_config` tipo='asistencia'** enriquecida
  con `modalidad` + `docente_nombre/foto_url/cv_url` + `descripcion`; cada
  `curso_encuentro` apunta a su módulo vía `condicion_id`. La condición se **auto-computa**
  (triggers SECURITY DEFINER, mig 0220): único/alternativos → ≥1 presente; serie →
  todos. El gate de emisión (mig 0139) lee `matricula_condiciones.cumplida` igual que
  cualquier condición → se integra sin cambios. **Decisión de coexistencia:** `asistencia`
  se administra SÓLO en la pestaña Encuentros (CRUD fino); `CondicionesTab` la excluye
  del full-sync (`.neq('tipo','asistencia')` + filtro en load/botones/select) para no
  pisarla.
- **3 chunks:** (1) backend mig **0220** (columnas + condicion_id + `eval_asistencia_cumplida`
  + `recompute_asistencia` + 2 triggers; smoke e2e). (2) gerencia: `campus.ts` CRUD de
  módulos + encuentros extendidos; `EncuentrosTab` reescrito (agrupa por módulo; docente
  foto+CV; modalidad; obligatorio; **editar** encuentros; reasignar sueltos; Zoom/Webex+
  asistencia intactos); `CondicionesTab` cede asistencia. (3) alumno: `EncuentrosEnVivoAlumno`
  agrupa por módulo con docente + requisito por modalidad; el cert auto-computa.
- **Pipeline de asistencia automática:** YA existe en código (edge fns `zoom-webhook`/
  `webex-webhook` + upsert mig 0047 en `curso_encuentro_asistencias`); F10 construye
  encima. **Nunca se ejercitó con sesión real** (0 asistencias) → pendiente: test e2e con
  una reunión Zoom real con un participante (no se pudo simular acá).
- **Doble auditoría §6 (3 agentes + e2e) → 3 hallazgos, fixeados en el mismo chunk:**
  - **Alumno (crítico, latente):** el requisito ("asistí a 1 de N / a los N") contaba
    sólo los encuentros VISIBLES (con sala), no TODOS los del módulo como el backend →
    un *serie* con un encuentro sin sala sub-reportaba y el alumno creía cumplir sin
    certificar (anti-patrón **R19**). Fix: contar sobre todos los encuentros del módulo.
    **Verificado en vivo:** serie con 3 encuentros (2 con sala, 1 sin) muestra "los **3**
    encuentros", no 2.
  - **Gerencia (residual):** el `<Select>` de tipo por-fila de `CondicionesTab` aún
    ofrecía 'asistencia' → crearía un módulo fantasma sin modalidad. Fix: filtrado +
    defensa en `guardarCondicionesConfig`.
  - **Backend (R7):** `tg_asistencia_recompute`/`tg_encuentro_cond_recompute` sin REVOKE
    de anon/authenticated → mig **0221** (ACL final `{postgres,service_role}`).
- **Prueba en vivo (alumno QA por SQL, prod):** curso con 3 módulos (único/alternativos/
  serie), foto+"Con Dra. Castro" en los 3, requisitos correctos. **Las 3 variables de
  condición chequeadas:** único 1/1→✅; alternativos 1/2→✅ (basta 1); serie 1/2→✗
  pendiente, 2/2→✅ (todas). Cert: 2/3 pendiente → 3/3 → **auto-emitido** ("¡Listo!
  Descargá tu certificado", código GG-QAFE-...). Consola sólo ruido de extensión. QA
  **eliminado** (residuo 0). **Nota:** la prueba en vivo de la UI de GERENCIA (crear/
  editar módulos) quedó pendiente de sesión de gerente (no creo gerentes QA, regla); el
  modelo + la consunción del alumno + las condiciones quedaron verificados e2e, y el
  código de gerencia §6-auditado + build limpio.
- **Commits:** `2796213` (backend) · `2fd7b6e` (gerencia) · `e324edf` (alumno) ·
  `76d413c` (§6 fixes). Migs 0220 + 0221.
- **Fecha:** 2026-06-11. **🏁 Lista JL COMPLETA** (F1, F3, F2, F5, F7, F6, F8, F4, F10).

## DGG-69 · "Duplicar" curso/webinar (clon profundo del material, sin alumnos)

- **Pedido (Pablo):** que cualquier curso o webinar tenga un botón **"Duplicar"** que
  genere un clon con TODO el material para reusarlo y editarlo. **Lo único que NO se
  duplica son los alumnos matriculados/inscriptos. Todo lo demás, sí.**
- **Backend (clon profundo con remapeo de FK):**
  - `curso_duplicar(p_curso_id)` (migs **0222**→**0223**→**0225**, SECURITY DEFINER +
    `is_staff()` + `search_path`): clona en una transacción `cursos` + `curso_modulos` +
    `curso_clases` + `curso_examenes` + `curso_examen_secciones` + `curso_preguntas` +
    `curso_opciones` + `curso_condiciones_config` + `curso_encuentros` +
    `curso_bibliografia` + `curso_encuestas`, remapeando todos los FK vía una temp table
    `_clone_cmap (kind, old_id, new_id)`. **Excluye** `curso_matriculas` y todo lo
    por-alumno (progreso, intentos, asistencias, certificados, respuestas, condiciones-de-
    matrícula) — por construcción (no hay código que los toque).
  - `webinar_duplicar(p_webinar_id)` (mig **0224**): clona la fila como borrador,
    manteniendo `formulario_id` (form de evento **compartido** — no se clona el form).
    Excluye `webinar_inscriptos` y per-persona.
- **Decisiones de diseño:** (1) el clon nace **BORRADOR** (`activo=false`/`publicado=false`,
  sin publicar). (2) Título **"… (copia)"** + slug único `…-copia[-N]` (curso; webinar no
  tiene slug). (3) Los **encuentros** copian fecha/docente/condición pero **NULLean la sala
  Zoom/Webex** (`zoom_status='programado'`) → se recrean. (4) Las **clases**
  `sincronica_zoom` también NULLean `zoom_url`/`zoom_fecha_hora` (§6 #C3); `youtube_url`/
  `material_url` (contenido) **sí** se preservan. (5) Banner, fotos de docentes y
  `formulario_id` se **comparten** (editables luego) — acoplamiento acotado, aceptable.
- **Frontend:** botón "Duplicar" (overlay con `preventDefault`+`stopPropagation` para no
  disparar el `<Link>`) en `CursoCard` (prop opcional → sólo gerencia; el alumno no lo ve)
  vía `CampusListPage`, y en la card de `WebinarsListPage`. Confirm `useConfirm` (R13),
  estado `duplicating` anti-doble-submit, navega al editor del clon. Services
  `duplicarCurso`/`duplicarWebinar` (R4).
- **Premisa de cierre — EJERCITAR (e2e en BD):** 2 e2e sintéticos `BEGIN/INSERT/clonar como
  gerente (`set_config` jwt.claims)/verificar/RAISE ROLLBACK`. **El e2e cazó un bug ANTES de
  shippear:** el INSERT de `curso_encuentros` no tenía `WHERE o.curso_id = p_curso_id` →
  clonaba encuentros de OTROS cursos (el LEFT JOIN al mapa no filtra). Fix en 0223. (Nunca
  llegó a prod → no es E-GG, pero valida la premise de ejercitar.)
- **§6 (3 agentes REVISAR) → 4 hallazgos, todos resueltos:** #C3 clase.zoom_url→sala vieja
  (fix 0225, verificado e2e); #A26 0223 sin re-GRANT (idempotencia → 0225 self-contained);
  #A28 TOCTOU de slug (cubierto por UNIQUE `cursos_slug_key` → rollback, sin corrupción);
  #C7 **mantenibilidad: las RPC enumeran columnas explícitas → un `ADD COLUMN` futuro se
  pierde callado** (mitigado con comentario ⚠ en la función; candidato a regla nueva o test
  e2e que compare columnas vs INSERT — pendiente decisión de Pablo).
- **Prueba en vivo (sesión de gerente de Pablo, prod):** **curso** — Duplicar en
  "Actualización 2026" → confirm R13 → el clon abrió en el editor (título "(copia)", slug
  `…-copia`, Borrador, módulo+6 clases, examen, encuentro sin sala manejado, **Alumnos 0**);
  consola sin errores de app. **Webinar** (sintético por SQL) — Duplicar → clon "(copia)",
  "Borrador · no se muestra", **Inscriptos 0**, **"No hay sala Zoom creada"**. Cleanup total
  → **residuo 0** (0 huérfanos, 2 cursos reales intactos). Mobile por clases (tool clampea
  ~606, DGG-51).
- **Pase §6 final adversarial (3 agentes + e2e sobre la función VIVA, a pedido de Pablo):**
  diff de **181 columnas en 12 tablas** contra la función viva → **cero GAPs**; paridad del
  examen sobre el curso REAL (15 preguntas / 44 opciones / 5 secciones, todos remapeados);
  2 hardenings en **mig 0226**: advisory lock por curso-base (#14 TOCTOU de slug, benigno
  pero lo cierra) + guard `is_staff() IS NOT TRUE` (#12, atrapa auth.uid() NULL — redundante
  con el REVOKE a anon); gaps de verificación cerrados por e2e: webinar rich-copy (docentes
  jsonb + banner + form compartido), publicar-el-clon, y bloqueo de uid-sin-profile. **Único
  e2e-only (no live, sin datos reales):** el remapeo condición→encuentro de módulos
  sincrónicos F10 (ningún curso real usa F10 aún → no hay fuente para live-test).
- **Fecha:** 2026-06-11.

## DGG-70 · Contenido FUNDPLATA + "Encuesta" como condición de certificado

- **Pedido (Pablo):** (1) cargar el contenido del docx "Videos Formacion - Curso FUNDPLATA"
  como módulos/clases del curso de formación asincrónico (cada asignatura con nombre, nº
  de clases, vínculo y docente; reusar foto de docente si ya existe en otro curso). (2)
  Agregar "Encuesta" como condición configurable del certificado para cursos o webinars
  (completarla pasa a ser requisito). (3) Live test con QA alumno. (4) Doble auditoría.
- **Parte 1 · contenido (data, vía DO block):** 20 asignaturas (módulos) + 32 clases
  (videos YouTube `youtu.be/*`, que el helper `youtubeIdFromUrl` ya maneja) + docente por
  asignatura. Sólo **Dr. Raúl Castro** tenía foto cargada en otro curso → reutilizada
  (módulos 7 y 8). Módulo 11 "Asambleas Virtuales" decía "Dr. Cingolani > Dr. Acuña" →
  interpretado como reemplazo → Dr. Acuña.
  - **⚠ Corrección de target:** cargué primero en `202d8ec3` ("Curso **inicial** de
    formación"), pero Pablo había creado (vía el botón Duplicar de DGG-69) y nombrado
    **`f76f9ab3` "Curso de formación · RPAC (asincrónico)"** vacío como target. Mi búsqueda
    por slug exacto no matcheó el clon (`...-copia`). Detectado en el cleanup del §6 (curso
    extra + created_by Paul). Confirmado con Pablo → **moví los 20 módulos + 32 clases a
    f76f9ab3** (UPDATE curso_id; las clases viajan por modulo_id) y dejé 202d8ec3 vacío.
    Lección: al cargar contenido a "un curso por nombre", listar TODOS los candidatos por
    título (no sólo por slug exacto) y confirmar el id antes de escribir.
- **Parte 2 · condición "Encuesta" (mig 0227 + frontend):** el requisito de encuesta ya
  existía como gate separado (flag `curso_encuestas.requerida_para_cert` +
  `matricula_cumple_encuesta`). Se lo sube a **condición de primera clase**: tipo
  `'encuesta'` en `curso_condiciones_config`; el gate honra **flag O condición activa**;
  trigger en `curso_encuesta_respuestas` (`tg_encuesta_respuesta_sync` →
  `matricula_sync_encuesta`) marca la condición + dispara la emisión (arregla un gap real:
  responder la encuesta no auto-emitía el cert). Frontend: `'encuesta'` en
  CONDICION_TIPOS/LABEL/AUTOMATICA (auto "al responder"); `guardarCondicionesConfig` setea
  `requerida_para_cert` al guardar; nota en CondicionesTab. **Webinars: deferido** (hoy no
  tienen encuestas + emiten cert a mano; feature aparte — decidido con Pablo).
- **Live test (QA alumno por SQL, prod) — cazó un bug que el e2e no vio:** el QA alumno vio
  el contenido (32 clases, docentes, foto de Castro, video YouTube reproduciendo), la
  encuesta como "Requerida para emitir tu certificado", la respondió → **pero la respuesta
  fallaba con "Solo gerencia puede emitir certificados" (42501)**. Causa: el trigger
  EXISTENTE `trg_condicion_cumplida_emitir` (sobre `matricula_condiciones`) llamaba
  `emitir_certificado` sin protección; al marcar la condición, el guard `auth.uid() NOT
  NULL AND NOT is_staff()` bloqueaba al alumno y reventaba toda la respuesta. El e2e no lo
  cazó porque corrí con claims de gerente (is_staff). **Fix:** emisión síncrona BEST-EFFORT
  (migs **0228** sync_encuesta + **0229** trg_condicion_cumplida_emitir): marcar la
  condición/responder nunca falla; gerencia emite al instante, alumno emite vía el **cron
  gg-campus-certificados** (cada 5 min, auth nula → sin guard). Re-test: respuesta OK,
  condición cumplida, cron emitió el cert **GG-FORM-2026-2368F1**, y el alumno vio "¡Listo!
  Descargá tu certificado". Cleanup total (QA alumno + cert + mail + restauración de
  Formación), residuo 0.
- **§6 doble auditoría (3 agentes + e2e) → 1 crítico + menores:** **CRÍTICO** —
  `matricula_sync_examen` tenía el MISMO landmine (PERFORM sin proteger) → un examen-última-
  condición + auto reventaría el envío del examen del alumno (verificado e2e por el agente;
  hoy ningún curso real lo tiene). Fix mig **0230** (mismo wrap). Menores de frontend
  (fixeados): la condición 'encuesta' se mostraba como tilde-manual en `GestionMatriculasTab`
  y en el panel del alumno (`CursoDetalleAlumnoPage`) → ahora es read-only/Automática como
  examen. Diferidos (notados, no bloqueantes): dualidad flag-vs-condición (claridad UI);
  alerta si el cron de certs se cae; `WHEN OTHERS THEN NULL` ciego a errores no-42501;
  flag-only-sin-condiciones nunca emite (landmine preexistente, las RPAC reales se salvan).
- **Lección capitalizada:** un trigger/sync que emite el certificado al marcar una condición
  debe ser **best-effort** — la acción del alumno (responder encuesta / cerrar examen) nunca
  debe fallar porque el guard de emisión lo bloquee; el cron es el backstop. Y los e2e que
  corren con claims de gerente NO cubren el path no-staff del alumno → el live test con QA
  alumno real es insustituible.
- **Fecha:** 2026-06-12. Migs 0227-0230.

## DGG-71 · Bibliografía URL-o-archivo (50 MB) + banco de fotos de docentes (cobertura completa)

- **Pedido (Pablo):** (1) en Bibliografía, poder **subir el archivo O pegar la URL en el
  mismo paso del alta** (antes había que crear el ítem y recién después subir), con límite
  **50 MB** (no 10). (2) Armar un **banco de imágenes de docentes**: al subir una foto de
  docente, ofrecer "cargar una nueva **o** elegir una de las ya cargadas", sembrado con las
  fotos de los docentes ya configurados.
- **Bibliografía (frontend + mig 0231):** el form "Nueva bibliografía" ahora trae
  Título/Autor + Link externo + **Subir archivo** inline (sin crear primero), hint "Cargá el
  link externo O subí el PDF · ≤ 50 MB". `crearBibliografia` ya aceptaba `archivo_url`; el
  `FileUploader` del alta usa un `tempOwnerId` (uuid) y sube al instante; la URL del PDF se
  guarda con el ítem. Mig **0231**: `UPDATE storage.buckets SET file_size_limit=52428800
  WHERE id='campus-media'` (50 MB punta a punta: front `maxMb=50` + bucket). e2e: INSERT de
  bibliografía **solo-archivo (url NULL)** persiste OK (url es nullable).
- **Banco de docentes (`listDocentesBanco` + `ImageUploader` + consumidores):** el
  `ImageUploader` gana props `bankEnabled`/`onPickBank` y un `BankModal` (grilla
  `grid-cols-2 sm:grid-cols-3`, búsqueda si >6, foto circular + nombre). `listDocentesBanco`
  junta los pares {nombre, foto} de **todas** las fuentes con nombre: `curso_modulos`,
  `curso_condiciones_config`, `cursos.instructor_*` y `webinars.docentes` (jsonb, parseo
  defensivo); dedup por `nombre.toLowerCase()|foto`. `curso_clases` sólo guarda foto sin
  nombre → no alimenta el banco, pero sí lo consume.
- **Cobertura / R14 (hallazgo del §6, capitalizado en el mismo chunk):** la 1ª versión
  cableaba el picker SÓLO al editor de módulo asincrónico. El pedido ("cuando suba una imagen
  de docente") es universal → se agregó "Elegir del banco" también a: **encuentro docente**
  (sincrónico → `curso_condiciones_config`), **instructor del curso** (`cursos`) e
  **instructor de clase** (`curso_clases`, sólo foto). El picker de **webinars queda diferido**
  (alineado con "solo cursos por ahora" de DGG-70), pero sus fotos sí alimentan el banco. Hoy
  hay 0 fotos fuera de módulos → cobertura latente, correcta a futuro.
- **Fix R20 (E-GG-40) en el mismo archivo:** `ImageUploader.onCropConfirmed` sanitizaba con
  `originalFileName.replace(/[^a-zA-Z0-9._-]/g,'_')` (regex parcial prohibido, no normaliza
  NFKD) → migrado a `safeStorageKey()`.
- **Cierre §6 + live test:** 3 agentes (persistencia/UI · naming/seguridad · regresiones) +
  e2e en BD (bucket=52428800, banco=5 docentes, RLS de cursos/webinars permite el SELECT del
  gerente, INSERT biblio solo-archivo OK) + live test logueado: modal del banco centrado y
  visible (tras fix E-GG-65), pick de "Dr. Raúl Castro" en instructor del curso → persiste
  nombre+foto en `cursos` (verificado en BD, luego **revertido a NULL — residuo 0**), 20
  botones de banco en módulos, form de bibliografía con URL+archivo+50MB. Las 5 fotos cargan;
  grid responsive. Mobile 360px: verificado estructural (grid-cols-2 + card w-full + portal);
  no se pudo forzar viewport 360 (el tab MCP rinde a 1440 lógico fijo).
- **Diferidos (menores, notados):** archivos huérfanos si subís un PDF en el alta de
  bibliografía y no clickeás "Agregar" (no se limpia el storage); sin validación real de MIME
  en uploads (heredado); sweep de los 2 modales con el bug de portal (E-GG-65).
- **Fecha:** 2026-06-12. Commits `74eacd3` (portal) + `4904f97` (banco+R20). Mig 0231.

## DGG-72 · "Material extra" por módulo (links/archivos, visible al alumno si tiene contenido)

- **Pedido (Pablo):** cada módulo, además de la lista de clases, suma una sección
  **"Material extra"** que opera como la bibliografía pero a nivel MÓDULO: el gerente carga
  entradas con URL **o** archivo (cualquier tipo). Al alumno la sección aparece **sólo si el
  módulo tiene ≥1 ítem** — "es parte del módulo siempre pero visible sólo si posee contenido".
- **Datos (mig 0232):** tabla `curso_modulo_material` (FK `curso_modulos` ON DELETE CASCADE;
  `titulo`/`url`/`archivo_url`/`descripcion`/`created_at`, naming espejo de `curso_bibliografia`).
  **Sin** campos de publicación (a diferencia de bibliografía): la visibilidad la decide sólo el
  "≥1 ítem". RLS espejando `curso_clases` — SELECT `is_staff() OR curso_matriculado(subquery
  módulo→curso)`, CUD staff-only; GRANT explícito (R6), índice FK (R11), single-table sin RPC (R5).
- **API:** `getCurso` anida `material` por módulo (embedded `curso_modulo_material(*)`, ordenado
  por created_at) igual que `clases`; `crear/actualizar/borrarMaterialModulo`; scope
  `CampusMediaScope` `'modulo-material'` (reusa bucket campus-media + safeStorageKey, R20).
- **Gerente (ContenidoTab):** `MaterialExtraSection` + `MaterialItem` por módulo (copia de
  Bibliografía sin autor/publicación; valida título + url-o-archivo; `accept="*/*"` para "archivos
  varios", ≤50 MB; R13 useConfirm para borrar).
- **Alumno (CursoDetalleAlumnoPage):** sección compacta dentro del acordeón del módulo, guardada
  por `{open && m.material.length > 0}`; se aflojó el filtro que descartaba módulos sin clases
  (`clases.length>0 || material.length>0`) para que un módulo con sólo material igual aparezca.
- **§6 (3 agentes + e2e) → 1 GAP crítico fixeado en el mismo chunk:** la §6 detectó que
  **`curso_duplicar` (mig 0222) NO clonaba `curso_modulo_material`** (la tabla es posterior al clon,
  que enumera tablas explícitas) → un curso duplicado perdía todo el material extra de sus módulos,
  rompiendo la promesa de DGG-69. **Fix mig 0233:** paso 3b que clona el material remapeando
  modulo_id vía `_clone_cmap` (CREATE OR REPLACE, firma intacta, R16 smoke = 0 overloads). **Smoke
  R18:** curso con 2 materiales → duplicar → el clon trae los 2 (+ 19 clases). Menores notados (no
  bloqueantes): blobs huérfanos en storage al borrar (heredado de bibliografía); bucket público +
  accept */* (upload staff-only/trusted); copy del panel principal si un curso fuera 100% sin clases
  pero con material (caso borde improbable).
- **e2e RLS + live:** matriculado VE el material (1), otro alumno NO (0), alumno no-staff no puede
  INSERT (42501) — todo en tx auto-revertida. Live (gerente, prod): la sección "Material extra"
  renderiza en el módulo, agregar un material persiste en BD y el editor lo muestra (prueba que
  getCurso anida `material` en vivo); limpiado, residuo 0. **Live alumno (browser, prod):** se
  creó un alumno QA efímero por SQL (rol administrador + matrícula en f76f9ab3 + 2 materiales en
  el módulo 1), login real, y se verificó que el módulo CON material muestra la sección "Material
  extra" (ambos ítems + links Abrir/Descargar correctos) y que el módulo SIN material NO la
  muestra (regla "≥1 ítem" en vivo); consola limpia; render OK en columna ~300px. Todo el QA
  (usuario + identidad + sesión + matrícula + materiales) borrado → residuo 0 verificado.
- **Fecha:** 2026-06-12. Migs 0232 (tabla) + 0233 (Duplicar). Commits `68549bc` + `e201144`.

## DGG-73 · Banco de CV de docentes (espejo del banco de fotos) + poblado de fotos y CVs

- **Pedido (Pablo):** generar un "banco de CV" de docentes igual que el banco de imágenes
  (DGG-71): crear la feature, subir los CVs, y asignarlos a los docentes de TODOS los cursos.
- **Feature (commit `87b41fa`):** `listDocentesCvBanco()` + `DocenteCvBancoItem` en campus.ts
  (agrega `docente_cv_url` de `curso_modulos` + `curso_condiciones_config` — cursos/webinars no
  tienen CV); `FileUploader` gana `bankEnabled`/`onPickBank` + un `CvBankModal` (lista de docentes
  con su CV, porteado a `document.body` por E-GG-65, búsqueda si >6); picker "Elegir del banco"
  cableado en los 2 uploaders de CV (`modulo-docente-cv` en ContenidoTab, `encuentro-docente-cv`
  en EncuentrosTab; `onPickBank` setea docente_nombre + docente_cv_url). Reusa los scopes -cv
  (no re-sube). La vista del alumno ya refleja `docente_cv_url` (link "CV").
- **Datos del mismo turno (fotos + CVs):**
  - **Fotos (banco DGG-71):** 14 fotos (13 de un collage 1080×1350 + Chiesa) recortadas
    circulares con fondo transparente (Python/PIL, detección por proyecciones) → **20/20 módulos
    de f76f9ab3 con foto**; banco de imágenes con 10 docentes nuevos.
  - **CVs:** 15 subidos (13 PDF + Biel jpeg + Bercovsky png → PDF) a
    `campus-media/modulo-docente-cv/banco-formacion/`; **11 asignados** a sus docentes en los 2
    cursos (incl. Mayra Lucero + Ximena González de "Actualización 2026"). Banco de CV = 11.
  - Subida a storage (write staff-only): edge function efímera con secreto + service-role, usada
    y **borrada** (no había service key local; la CLI no autenticaba storage). Patrón reusable.
- **Sin CV provisto:** Castro, Tamara Suken, Fabián Beuchel, Martín Saveriano. **Extras (no
  docentes, subidos/disponibles):** Antonela Peralta, Gerardo Rodríguez Arauco, Bercovsky
  (tarjeta de contacto, no CV) + el 2º CV de Ortiz de Zárate (se usó el "SOZ feb 2025" reciente
  para Soledad).
- **§6 + verificación:** doble auditoría (feature/regresiones del FileUploader compartido +
  datos/identidad de los CVs); e2e SQL (banco CV=11, asignaciones correctas, PDFs 200/
  application-pdf); R20 slugs safe; edge fn borrada. Browser: el picker visual quedó pendiente
  (Pablo editando en la sesión compartida, página cacheada) — data verificada + render del alumno
  ya refleja los CVs.
- **Fecha:** 2026-06-12. Commit `87b41fa`. Sin migración (`docente_cv_url` ya existía).

## DGG-74 · Tipo de pregunta "casillas" (multi-respuesta) + encuesta del Curso de Actualización 2026

- **Pedido (Pablo):** cargar la encuesta de satisfacción de un docx en el "Curso de Actualización
  2026 (RPAC-PBA)" (488b58c3), sin duplicar datos del alumno ni secciones ya cubiertas.
- **Mapeo (con Pablo):** el docx tenía 11 preguntas. **Descartadas** Q1 (Nombre) + Q2 (Mail) = datos
  del alumno que ya tenemos, y Q9-Q11 (¿publicar?/frase/foto) = ya cubiertas por la **sección
  testimonio** integrada (comentario + foto + permite_publicar). Quedaron 6 (Q3-Q8). Q5/Q6 (escala
  lineal 1-5 con etiquetas) → `escala_10` con etiquetas como ayuda (elección de Pablo). Q7 ("marcá
  todos") → multi-select, que el motor NO tenía → **se extendió el motor**.
- **Feature `casillas` (commit `26248d8`):** nuevo `PreguntaTipo='casillas'` (valor = string[]).
  `EncuestaAlumnoCard`/PreguntaRunner: checkboxes multi-select (toggle inmutable; la validación
  required ya trataba array vacío como vacío). `EncuestaTab`: palette + addPregunta + editor de
  opciones (reusa el de 'multiple') + StatCard (cuenta cada opción aplanando arrays, % sobre
  respondientes) + renderRespuesta (join). El RPC `encuesta_responder` y `encuesta_emular_de_curso`
  guardan/copian el array sin tocar backend (jsonb). Hardening: la agregación ignora arrays vacíos.
- **Carga (datos):** encuesta del curso 488b58c3, título "Queremos saber TU OPINIÓN", descripción del
  docx, **publicada**, no obligatoria para cert. 6 preguntas: 2 estrellas (audio/video, docentes),
  2 escala_10 (interés, aplicación —etiquetas en ayuda), 1 casillas (beneficios, 5 opc), 1 multiple
  (curso previo, 3 opc).
- **Bug de alcance cazado en browser (E-GG-66, commit `8dea638`):** la encuesta publicada NO
  aparecía para el alumno — `EncuestaAlumnoCard` colgaba sólo del nodo 'certificado', que no
  existe en cursos sin condiciones (este curso tiene 0). Fix: nodo de navegación propio
  ("Encuesta de satisfacción") gateado por `encuestaActiva`. Ver E-GG-66.
- **§6 — auditoría estática:** APROBADA (único `Record<PreguntaTipo>` exhaustivo actualizado;
  sin colisión con el PreguntaTipo de exámenes; regresión de los 4 tipos previos OK; tsc exit 0).
  Agente fidelidad/seguridad: encuesta fiel al docx; RLS e2e (matriculado responde OK, intruso
  bloqueado 42501, sin fuga cross-alumno; array de casillas persiste correcto).
- **§6 — live test (gerente + alumno QA efímeros por SQL, residuo 0):** **alumno** → render de
  los 6 tipos (10 estrellas, 20 botones escala, 6 checkboxes [5 casillas + permiso], 3 radios,
  etiquetas de ayuda de escala) + **2 casillas marcadas a la vez** + envío con diálogo de
  permiso + estado "Encuesta completada". BD: respuesta guardada 1:1 incl. `p_beneficios` como
  array de 2. **Gerencia** → Configuración (6 preguntas, "Casillas (varias)" en paleta) +
  Respuestas (StatCards: estrellas 4.0/5.0, escala 8.0/9.0, **casillas "multi" 1(100%) c/u**,
  multiple "A veces"; testimonio en "Disponibles para campañas"; respuesta individual con
  casillas joineadas). Consola limpia, desktop.
- **Fecha:** 2026-06-12. Commits `26248d8` (casillas) + `da9c89b` (hardening) + `8dea638`
  (nodo encuesta propio / E-GG-66). Sin migración (schema jsonb).

## DGG-75 · Las solicitudes 'derivada' salen del default "Solo activas" (JL 2 · obs 2)

- **Pedido (JL):** las solicitudes ya derivadas a trámite (en progreso) seguían apareciendo en
  "Solicitudes recibidas". JL las quiere fuera del default ("ya se pasaron a Trámites en
  Proceso pero siguen apareciendo acá").
- **Decisión:** 'derivada' = handoff (la solicitud ya tiene su `tramite_id`; el trabajo vive en
  el trámite) → deja de contar como "activa". Se mueve de `ACTIVE_SOL` a `CLOSED_SOL`
  (`SolicitudesListPage`) y se saca del filtro API `'activas'` (queda `['recibida','en_revision']`,
  idéntico a `listSolicitudesPendientes` del widget realtime → consistencia). **No se borra ni
  se pierde:** sigue accesible con el switch "mostrar todo" + su segmento "Derivadas".
- **Reversa parcial de DGG-65 (F8):** ahí "activas" incluía 'derivada' como parte del triage.
  JL refinó el criterio: el triage activo es sólo lo que espera la 1ª acción del gerente
  (recibida/en_revision).
- **§6:** 2 agentes (correctitud/consistencia + downstream/UX, ambos OK; único caller de
  'activas' es la página; widget ya consistente) + **live test** (default: derivadas ocultas,
  KPI cards 3→2, "1 solicitudes"; mostrar todo: 6 segmentos, "2 Derivadas", 11 solicitudes;
  segmento Derivadas filtra a las 2 reales). Solicitud recibida sintética QA por SQL, residuo 0.
- **Follow-up RESUELTO (commit `d7f451f`):** se quitó el `?estado=activas` muerto del link "Ver
  todas" del `NuevasSolicitudesWidget` → queda `/gerencia/solicitudes` (cae igual en el default
  activas, alineado con F8 = sin estado en URL). Verificado en vivo (con 6 recibidas: "Ver todas
  (6)" → href sin param → navega a la lista activa con las 6).
- **Fecha:** 2026-06-12. Commit `a59cef9`. Sin migración (cambio de filtro frontend/API).

## DGG-76 · Datos de pago propios en los forms de curso RPAC (cuenta FU.DE.CO.IN, no Gestión Global) (JL 2 · obs 3)

- **Pedido (JL):** en los forms de curso (formación + actualización RPAC) la cuenta de pago NO
  es de Gestión Global → el hint "depósito a nombre de Gestión Global" era incorrecto. Poner
  los datos adecuados y sacar las referencias concretas a GG en estos 2 forms.
- **Datos (JL + Pablo):** cuenta de **FU.DE.CO.IN - Fundación para el Desarrollo, Conocimiento e
  Investigación** (titular confirmado por Pablo vía AskUserQuestion): CBU 0140114701205005476802,
  alias BECADO.PLATO.DIETA, CUIT 30-71753148-1, CC 2050-54768/0.
- **Mig 0234:** agrega el bloque presentacional `costos_info` ('costos_curso') a la sección
  "Pago" de los 2 forms con esa cuenta (items:[] — sin precio, se fija en la activación; la CC
  va en nota_extra) y reemplaza el hint del comprobante por uno sin GG ("…a la cuenta indicada
  arriba…"). jsonb order-preserving (WITH ORDINALITY), sólo los 2 slugs. **0 referencias GG** en
  el schema tras el cambio (las de marca/plataforma no existían en estos forms). costos_info NO
  se valida ni se envía (presentacional, DGG-61 / verificado §6).
- **Renderer (`CostosInfoCard`):** "CVU" → **"CBU / CVU"** (es un CBU bancario en los cursos y un
  CVU de MP en los otros 4 forms; el label sirve para ambos) + titular sin `font-mono` (es un
  nombre, no un número) + wrap de valores largos (min-w-0/break-words, para el titular largo) +
  skip de filas vacías. No regresiona los otros 4 forms (cuenta MP de GG, intactos).
- **§6:** 2 agentes (migración/presentacional + renderer/regresión, ambos **PASS**) + smoke BD
  (Pago=[costos_info, comprobante], cuenta correcta, 0 GG, orden de secciones intacto) + **live
  test** del form público (curso-formacion: bloque "Datos para realizar el pago" con
  FU.DE.CO.IN/CBU/alias/CUIT/CC + hint del comprobante sin GG; curso-actualizacion idéntico
  confirmado por DOM).
- **Fecha:** 2026-06-12. Commit `e012fbe`. Mig 0234.

## DGG-77 · Atajo "Generar comprobante" desde el trámite pendiente (JL 2 · obs 1)

- **Pedido (JL):** para emitir el comprobante de un trámite con "Comprobante pendiente" había que
  volver a Solicitudes, buscar el cliente/trámite y correr el wizard — demasiados pasos. Quiere un
  atajo directo desde el trámite.
- **Solución (sin backend nuevo):** botón "Generar comprobante" en el header de `TrackingDetailPage`
  (visible sólo si `comprobante_pendiente`), abre `GenerarComprobanteTramiteModal` (nuevo) — modal
  enfocado que emite un comprobante simple (tipo X) prefilleado desde el servicio del trámite
  (descripción + `precio_base`) y lo vincula con `updateTramite({comprobante_id})` → el computed
  column `comprobante_pendiente` (mig 0207) se limpia y el botón desaparece. Reusa la RPC tested
  `emitir_comprobante_manual` (la misma del wizard) + pasa el `consorcio_id` del trámite. La
  cobranza queda en su flujo existente (el comprobante queda en Facturación).
- **R15 (lección aplicada):** el detalle del trámite vive en `TrackingDetailPage` (`tramites/:id`
  redirige a `trackings/:id`); `TramiteDetailPage` es legacy/código muerto → el botón va en el
  primero. El agente Plan lo cazó antes de tocar el archivo equivocado.
- **getTracking** ahora expone `comprobante_pendiente` (computed column) + `servicio.precio_base`.
- **Decisiones (defaults sensatos, no bloquearon):** DDJJ → atajo habilitado con precio manual (+
  hint); `precio>0` requerido (= modal de solicitudes, no $0 por ahora); alcance = emisión (no
  cobranza); componente aislado (sin tocar `PanelComprobanteCobranza`).
- **§6:** 3 agentes (correctitud del modal / getTracking+integración / seguridad-tenancy, todos
  **PASS**: guards `is_staff` + `assert_administracion_access` + RLS de tramites; consorcio→admin
  validado por la RPC; sin regresión al flujo de solicitudes) + **e2e en vivo** (trámite sintético
  `comprobante_pendiente=true`: el botón aparece → modal prefilleado (precio 12000 del servicio) →
  emite → **comprobante X autorizado $12.000 creado + linkeado**, `comprobante_pendiente`→false,
  botón desaparece; verificado en BD; QA por SQL, **residuo 0**). Hardening de la auditoría:
  `fmtMoney` con `maximumFractionDigits`.
- **Follow-up RESUELTO (commit `d7f451f`):** el trámite ahora muestra "Comprobante" → link a
  `/gerencia/facturacion/:id` (tipo + punto_venta-numero) cuando `tramites.comprobante_id` está
  seteado → tras el atajo, el gerente salta al comprobante (ver/registrar cobranza). `getTracking`
  embebe el comprobante. Verificado en vivo (emitió X 00001-00000027, el link apareció en DATOS y
  abrió el comprobante). Limitación conocida (no bug): sólo si el comprobante está en
  `tramites.comprobante_id`; el flujo viejo lo linkea a la solicitud → ese caso no muestra el link.
- **Fecha:** 2026-06-12. Commit `35c0a97`. Sin migración (reusa `emitir_comprobante_manual` + mig 0207).

## DGG-78 · Carga de contenido del curso Actualización RPA-CABA (Gestar) (mig 0235)

- **Pedido (Pablo):** cargar TODO el contenido del docx en el curso ya creado "Gestar: Curso de
  Actualización 2026 (RPA - CABA)" (eaafb7af · **NO** el RPAC-PBA, Pablo enfatizó no confundirse):
  módulos con docente (foto/CV del banco), videos por módulo, bibliografía con links, examen.
  "Sin redundancias y acorde a nuestro estilo."
- **Contenido (mig 0235, DO block atómico idempotente con guard anti-duplicado):**
  - 5 módulos: M1 Administrador/honorarios/expensas/ruidos (Dra. Diana Sevitz), M2 Obligaciones/
    infracciones/procedimiento (Dra. Silvia Bercovsky), M3 Auditoría interna y externa (Dra.
    Tamara Suken), M4 Comunicación efectiva (Lic. Ximena González), M5 Traspaso de administración
    (Dr. Raúl Castro).
  - 23 clases (videos YouTube + duración en min). Títulos sin el sufijo "- Dra./Lic. X" ni el
    número (redundantes; el módulo ya muestra el docente): M1/M2 títulos descriptivos por video;
    M3/M4/M5 "Clase N" (el docx sólo numeraba). 23 URLs YouTube verificadas char-por-char.
  - Docentes con foto/CV del banco. Huecos (NULL, el banco no los tiene): foto de Bercovsky, CV
    de Suken, CV de Castro.
  - 2 bibliografías (carpetas Drive: Material obligatorio + complementario).
  - Examen "RPA 2026: Examen Curso de Actualización GESTAR": 5 secciones temáticas / 15 preguntas
    / 100 pts / 60 para aprobar / 1 intento; V/F como `verdadero_falso`, resto `multiple_choice`;
    justificación en `explicacion`. Se DROPEÓ la sección "Datos del alumno" (redundante: ya
    tenemos al matriculado; mismo criterio que la encuesta DGG-74).
- **§6 doble auditoría:** smoke BD (5 mód / 23 clases / 2 biblio / 15 preg / puntaje 100 /
  exactamente 1 correcta por pregunta) + 3 agentes (examen **CRITICAL PASS** — todas las
  respuestas correctas coinciden con el docx; módulos/clases fieles; docentes/biblio/estilo OK,
  sin artefactos del docx, sin cruces tipo E-GG-67) + verificación propia char-por-char de las
  23 URLs.
- **Live test:** gerencia (módulo 1 renderiza: título/desc/docente foto+CV, "Visible para los
  alumnos" ✓) + **vista del alumno** (QA alumno matriculado por SQL, residuo 0): los 5 módulos
  con docentes (Sevitz foto+CV, Bercovsky "B"+CV, Suken foto, González foto+CV, Castro foto), 23
  clases con títulos limpios, **el video de YouTube embebe y reproduce**, bibliografía con
  "Abrir" a los 2 Drive, examen "RPA 2026" como nodo. Curso intacto tras el cleanup.
- **Huecos flagueados:** foto de Bercovsky, CV de Suken, CV de Castro (el banco no los tiene;
  cuando Pablo los pase, se asignan como en el flujo Chiesa/Gerardo).
- **Fecha:** 2026-06-12. Mig 0235. Commit `c3333fc`.

## DGG-79 · Encuentros sincrónicos COMPARTIDOS entre cursos (F11) — 2026-06-14

**Problema (Pablo):** Gestar (RPA-CABA · `eaafb7af`) y FUNDPLATA (RPAC-PBA ·
`488b58c3`) dan los mismos encuentros sincrónicos: UNA sola sala Zoom (sin
conflicto), y el alumno doble-matriculado que se conecta tiene el presente en
AMBOS cursos. Pueden ser alumnos distintos o el mismo. Excepcional pero real.

**Las 4 decisiones que definió Pablo:**
1. Presente **por persona** (profile/email), en TODOS sus cursos enganchados.
2. Alcance: compartir **encuentros puntuales** que elige el gerente (no el curso
   entero).
3. Requisito de asistencia **independiente por curso** (cada uno su modalidad).
4. Vista del alumno: en cada curso, con **sello "Compartido · tu presente cuenta
   en ambos"**.

**Modelo: "sesión compartida desacoplada" (aditivo, retrocompatible).**
- `encuentro_sesiones_compartidas` = LA sesión real (UNA sala Zoom + fecha +
  duración + docente). Verdad única, sin curso "dueño" (simétrico).
- `curso_encuentros.sesion_compartida_id` (nullable) = cada curso engancha su
  participación, conserva su `condicion_id` (modalidad propia), su `curso_id` y
  SUS asistencias. NULL = encuentro normal de hoy → **cero cambio para lo
  existente** (las 4 filas previas quedaron intactas, verificado).
- **Descartado** el modelo "espejo" (dos encuentros sincronizados): choca con el
  índice UNIQUE de `zoom_meeting_id`, obliga a un dueño y duplica la verdad.
- **La sala SIEMPRE nace en un encuentro** (flujo existente); "compartir" la
  MUEVE a la sesión (DB pura, sin llamar a la API de Zoom). "Descompartir" con 1
  curso restante hace **demote** (le devuelve la sala) y disuelve la sesión; si el
  módulo clonado queda sin encuentros se borra (un módulo obligatorio vacío
  bloquearía el certificado).
- **Presente por persona:** el webhook resuelve la matrícula (`customer_key` del
  Meeting SDK) → profile → abanica a todas sus matrículas activas en los cursos
  enganchados. La cadena `asistencia → trigger(0220) → matricula_condiciones →
  certificado` sigue **por curso sin tocarse**. Más robusto que matchear texto de
  email; honra "en todos sus cursos".
- **Coalesce:** `listEncuentros` trae sala/fecha/estado **desde la sesión**
  (verdad única) para que la UI de display/unirse (gate ±10min) no cambie. La URL
  de host (`zoom_start_url`) NO viaja al alumno (solo el gerente la pide).

**Entregables:** migs 0236 (modelo) · 0237 (fan-out RPCs) · 0238
(compartir/descompartir) · 0239 (fixes auditoría). Edge fns: `zoom-webhook` v6 +
`zoom-sdk-signature` v6. UI: `EncuentrosTab` (botón "Compartir con otro curso",
modal, sello "Compartido con X", "Quitar de la sesión", edición de fuente única)
+ `EncuentrosEnVivoAlumno` (sello + nota). Funciones `campus.ts` (R4).

**§6 doble auditoría:** e2e en BD por fase (compartir→fan-out→demote, modalidades
distintas `unico`/`serie`, alumno doble vs único, idempotencia ante reenvío de
webhook — todo con ROLLBACK) + 3 agentes estáticos. Hallazgos y paridad legacy →
`E-GG-69`. **Live test (URL Vercel):** gerencia (encuentro con badge COMPARTIDO +
nota + "Compartir"/modal + crear/eliminar sala oculta) + alumno doble QA (ve
ambos cursos; sello "Compartido — tu presente cuenta en ambos cursos" + gate "Se
habilita"). Consola sin errores de app. QA por SQL, **residuo 0**, "Encuentro
Julio" real intacto.

- **Fecha:** 2026-06-14. Migs 0236-0239. Commit `26dc5e3`.

## DGG-80 · Dependencia curso↔alianza en landing + formularios — 2026-06-14

**Pedido (Pablo):** remarcar qué entidad habilitante dicta cada curso, en la
landing y en los formularios. Cosmético — no debe romper nada operativo.

**Landing (cards de cursos):** isologo de la entidad a la derecha del ícono
lucide, mismo alto (h-10), prolijo. FUNDPLATA (rombos) en "Curso de formación
RPAC" + "Actualización RPAC"; GESTAR (swoosh) en "Actualización RPA·CABA". Los
isologos se recortaron de los logos completos del banco de alianzas con PIL
(misma fuente, sin pérdida): `public/landing/partners/fundplata-iso.png` (72×73)
+ `gestar-iso.png` (364×374). Mapa `ALIANZA_ISOLOGO` por título en LandingPage.

**Formularios:** el header público muestra el logo COMPLETO de la entidad en un
chip blanco (contraste perfecto sobre el gradiente cian) + un subtítulo de
alianza. Mapa `FORM_ENTIDAD` por slug en FormularioPublicoPage (sin columna
nueva): curso-formacion + curso-actualizacion → FUNDPLATA (RPAC);
curso-actualizacion-caba → GESTAR (RPA). Subtítulo: "<ENTIDAD> es una entidad
habilitada para el dictado de cursos por el <RPAC|RPA> que, en una alianza
académica, ha encomendado la coordinación académica a Gestión Global…".

**Form propio de Gestar (mig 0240):** las cards "Actualización RPAC" y
"Actualización RPA·CABA" apuntaban al MISMO `curso-actualizacion` (RPAC). Se
creó `curso-actualizacion-caba` (clon adaptado a RPA-CABA) y se recableó la card.
**La cuenta de pago de FUNDPLATA (FU.DE.CO.IN) se DEJÓ EN BLANCO** en el form de
Gestar — clonarla habría inducido pagos a la cuenta equivocada. Queda "te
enviamos los datos por correo" + comprobante opcional. `CostosInfoCard` ahora
oculta el bloque "Datos para transferencia" si la cuenta está vacía (los forms
con cuenta real no se afectan).

**§6 doble auditoría:** 2 agentes REVISAR (forms + landing → 0 GAP, 0 DUDA) +
EJERCITAR en BD (los 8 forms con costos_info: solo curso-actualizacion-caba con
cuenta vacía; el resto intacto → cero fuga de FUNDPLATA, cero regresión).
**Live test (Vercel, en vivo):** landing con isologos + form Gestar (logo +
subtítulo RPA) en prod; FUNDPLATA (logo + subtítulo RPAC + cuenta completa) y
Pago de Gestar (sin recuadro vacío, hint correcto) en preview. Build + consola
limpios.

**FLAGS pendientes para Pablo:** (1) cargar la cuenta de pago real de Gestar en
`curso-actualizacion-caba`. (2) ese form comparte `servicio_id` con el de RPAC →
si la actualización RPA-CABA necesita tarifa/vouchers propios, asignarle un
servicio aparte. (3) ajeno a esto: hay un cambio sin commitear en
`zoom-encuentro-create` (prefijo del módulo en el topic Zoom, ~2026-06-09) que
no es de este chunk — decidir si se commitea/descarta.

- **Fecha:** 2026-06-14. Mig 0240. Commit `de136e2`.

## DGG-81 · Programa + Enlace de conexión en cursos · cuenta+precio en forms — 2026-06-14

**Pedido (Pablo):** (a) cargar el programa de cada curso en su formulario; (b) dos
nodos de curso nuevos en el campus ("Programa" con archivo, "Enlace de conexión"
con título+descripción+URL→botón), ARRIBA DE TODO en el menú del alumno y solo
cuando tienen contenido; + cerrar los flags de DGG-80 (cuenta Gestar + precio).

**Forms de actualización (migs 0241 + 0243):**
- Cuenta de Gestar (curso-actualizacion-caba) = Mercado Pago · GestionGlobal.ar
  (CVU 0000003100053534352305, CUIT 27225982746 — la misma de inscripción al
  RPAC, dato de Pablo). Restaurado el flujo de pago normal (hint + comprobante
  obligatorio), revirtiendo el "te enviamos por correo" temporal de 0240.
- Precio $80.000 informado en AMBOS (RPAC/FUNDPLATA + RPA-CABA/Gestar).
- PDF del programa como descarga en la sección "Programa del curso" de cada form
  (RPAC ← su programa; RPA-CABA ← el de Gestar). Sin cruces.

**Campus · nodos Programa + Enlace (mig 0242):**
- 4 columnas en `cursos`: programa_url, enlace_titulo, enlace_descripcion,
  enlace_url (tabla pre-0130, GRANT ya existía).
- Gerente: sección "Recursos del curso" en Datos generales (FileUploader PDF →
  scope curso-programa + onPersist; 3 campos del enlace).
- Alumno: nodos 'programa' + 'enlace' ARRIBA de los módulos en el menú, cada uno
  con guard por contenido (`programa_url` / `enlace_url`). ProgramaPanel
  (ver/descargar) + EnlacePanel (título+descripción+botón "Ir al enlace").
- Programas subidos a campus-media (curso-programa/{cursoId}/) vía JWT de gerente
  QA + curl (sin service_role local), y wired en FUNDPLATA 488b58c3 + Gestar
  eaafb7af + en los 2 forms (mig 0243).

**§6 doble auditoría:** 2 agentes REVISAR (campus + forms → 6/6 OK, 0 GAP/DUDA) +
EJERCITAR BD (cero fuga de cuenta FUNDPLATA en el form de Gestar — verificado por
texto y estructura; precio en ambos; cada form/curso con SU programa sin cruces,
verificado contra storage físico; nodos solo con contenido; sin regresión).
**Live test (Vercel, en vivo):** ambos forms (precio $80.000 + cuenta correcta +
programa con tamaño), alumno doble del curso RPAC (nodos Programa + Enlace arriba
de todo + ambos paneles), gerente (sección "Recursos del curso" con el PDF + los
3 campos del enlace). QA por SQL, residuo 0 (enlace de prueba limpiado; los 2
programa_url quedan definitivos).

**FLAGS de DGG-80 resueltos:** cuenta Gestar ✓ (Mercado Pago), precio $80.000 ✓
(ambos; el servicio sigue compartido entre RPAC y RPA-CABA, mismo valor, Pablo lo
confirmó). El cambio sin commitear de `zoom-encuentro-create` se dejó intacto
(otro agente lo retoma — Pablo).

## DGG-82 · Ciclo de acceso post-finalización de curso (ventana de repaso) — 2026-06-14

**Pedido (Pablo):** al TERMINAR un curso el alumno conserva acceso un tiempo para
repasar contenido asincrónico / descargar material, y luego se desvincula (deja de
ver el curso). Aplica a CUALQUIER curso. En el card del curso terminado:
*"¡Felicitaciones! Ya terminaste el curso. Te quedan XX días para acceder y repasar
lo que quieras!"*. Origen: reencuadre del ítem 3 del hardening de E-GG-69
(`zoom-sdk-signature` rechazaba `completada`).

**Decisiones tomadas (Pablo, AskUserQuestion):**
- **Disparador de finalización** = se emite el certificado. Cubre las DOS vías
  (emisión automática al cumplir condiciones, y gerencia que adjunta el cert +
  cierra el trámite): ambas crean fila en `certificados`. El estado `completada`
  nunca se seteaba antes — este trigger es el primero en usarlo.
- **Ventana**: configurable por curso, `cursos.dias_acceso_post` (default 30).
- **El que NO termina**: queda `activa` indefinidamente (el reloj arranca SOLO al
  finalizar; no se toca `vigencia_hasta` de las activas).
- **Al vencer**: `estado='vencida'` — se conserva el registro + certificado, oculto
  del campus del alumno (no se borra).
- **Recordatorio**: SOLO la leyenda en el card (sin email).

**DB (mig 0245):**
- `cursos.dias_acceso_post int NOT NULL DEFAULT 30` + `curso_matriculas.completada_at`.
- Trigger `trg_certificado_marca_completada` (AFTER INSERT en `certificados`,
  SECURITY DEFINER — R17): setea `estado='completada'`, `completada_at=COALESCE`
  (re-emitir no reinicia el reloj), `vigencia_hasta = completada_at(AR)::date +
  dias_acceso_post`. Separado del trigger que cierra el trámite (0181) para no
  entrelazar responsabilidades. Cert de webinar (matricula_id NULL) → no-op.
- Gating `private.curso_matriculado`: `activa OR (completada AND (vigencia_hasta IS
  NULL OR vigencia_hasta >= hoy AR))`. NULL en completada = grandfather (matrículas
  previas, acceso pleno; SIN backfill — no expiramos retroactivamente).
- Cron diario `gg-campus-matriculas-vencer` (04:17 UTC = 01:17 AR): completada
  vencida → `vencida`. Índice parcial `idx_curso_matriculas_vigencia_completada`.

**Frontend:**
- `campus.ts`: helpers `diasAccesoRestantes` + `matriculaTieneAcceso` (espejo
  exacto del gate SQL).
- `MisCursosPage`: filtra a sólo-con-acceso (oculta vencida/anulada/completada-
  vencida) y muestra la leyenda en completada-en-ventana (variantes 0/1/plural,
  CTA "Repasar").
- `CursoDetalleAlumnoPage`: guard "Tu acceso a este curso finalizó" cuando venció
  (el contenido viene vacío por RLS).
- `CursoEditorPage`: campo "Acceso post-curso (días)" en Datos generales (R14
  paridad — la columna nueva tiene control de gerencia).

**Edge fn `zoom-sdk-signature` (v8):** el guard de matrícula pasó de `!= 'activa'`
a la VENTANA (activa O completada-en-ventana), espejo del gate. Cierra el ítem 3 de
E-GG-69.

**Zona horaria (capitalizado de §6):** TODA la lógica de la ventana se evalúa en
`America/Argentina/Buenos_Aires` (no UTC) — trigger, gate, cron, edge fn y frontend
— para coincidir con la convención del repo (0039/0054) y que la ventana venza a
medianoche local, no a las 21:00. Los 3 agentes §6 REVISAR lo marcaron como única
inconsistencia (no bloqueante); se corrigió igual por calidad.

**§6 doble auditoría:** 3 agentes REVISAR (DB / frontend / integraciones-seguridad)
→ 0 GAP bloqueante; EJERCITAR e2e en BD (`BEGIN/ROLLBACK` vía DO+RAISE): cert→
completada + completada_at + vigencia=hoyAR+dias; gate activa/dentro=TRUE,
vencida=FALSE; cron→vencida; re-emisión conserva completada_at. Residuo 0.
**Live test:** (1) preview local con viewport real 360px y (2) **en vivo sobre
Vercel producción (`www.gestionglobal.ar`)** con TODAS las variantes: alumno QA con
las 3 leyendas (12 días / 1 día singular / "hoy es tu último día"), curso activo
("Continuar"), vencido oculto, guard de detalle del vencido, y el caso borde
"último día" (vigencia=hoy) dando acceso NORMAL; mobile responsive (columna única
sin overflow); gerente QA con el campo "Acceso post-curso (días)" renderizado (30)
y guardado (60, verificado en BD). Consola sin errores en ambos roles. Cuentas QA
por SQL, residuo 0, sesión del navegador cerrada al final. El cambio sin commitear
de `zoom-encuentro-create` se mantuvo intacto (otro agente).

- **Fecha:** 2026-06-14. Migs 0241-0243. Commit `6bb1277`.

## DGG-83 · Nombre de la sala Zoom de encuentros con prefijo del módulo (2026-06-14)

- **Pedido (Pablo):** al crear por API la sala Zoom de un encuentro sincrónico,
  anteponer el nombre del módulo al nombre de la reunión, para distinguir de un
  vistazo a qué módulo corresponde en el portal Zoom. Antes: `<encuentro> · <curso>`
  ("Encuentro Junio · Curso de Actualización 2026 (RPAC - PBA)"). Ahora:
  `<módulo>: <encuentro> · <curso>` ("Asambleas Virtuales: Encuentro Junio · Curso
  de Actualización 2026 (RPAC - PBA)"). Aplica SÓLO a salas NUEVAS (las existentes
  Pablo las edita a mano).
- **Cambio:** edge fn `zoom-encuentro-create` (v9). El "módulo" de un encuentro
  sincrónico es su condición de asistencia (`curso_condiciones_config.etiqueta`,
  vía `curso_encuentros.condicion_id` — modelo F10, mig 0220). La fn ya traía el
  curso; ahora además resuelve la etiqueta del módulo (fetch service-role) y arma
  `topic = moduloEtiqueta ? "<mod>: <enc> · <curso>" : "<enc> · <curso>"`. Si el
  encuentro no tiene módulo (`condicion_id` NULL) → sin prefijo (comportamiento
  previo). **Sin cambios de frontend ni de types** (el front no pasa `topic`; el
  default vive en la fn). `verify_jwt=true` preservado.
- **Hardening de la auditoría §6** (mismo chunk): (1) el fetch del módulo va en
  `try/catch` local → si falla, degrada a topic-sin-prefijo en vez de abortar la
  creación (el prefijo es cosmético, nunca debe bloquear la sala); (2) truncado
  defensivo del topic a ≤200 chars (Zoom rechaza >200 con code 300) preservando el
  inicio (módulo + encuentro) con "…".
- **Verificado:** bytes desplegados v9 == repo; **e2e REAL (3 casos, salas Zoom
  reales creadas+borradas, residuo 0)**: con módulo → prefijo correcto; sin módulo
  → sin prefijo; título de 224 chars → truncado a 198 con "…" y **Zoom lo aceptó
  (200)** (sin el fix daría code 300). **§6 (3 agentes):** downstream 0 gaps (nadie
  parsea el topic; no afecta asistencia/recompute; delete+409 intactos) · seguridad
  0 riesgos (RLS bypass apropiado por service-role, etiqueta no sensible, gate de
  gerente intacto y previo, sin inyección, hardening cold-start respetado) ·
  correctness OK (de ahí los 2 hardenings).
- **Fecha:** 2026-06-14. Sin migración (sólo edge fn, versionada en repo — R7).

## DGG-84 · Cobrar (total o parcial) en el mismo acto de emitir un comprobante (JL · 2026-06-16)

- **Pedido (Pablo):** al generar un comprobante, poder elegir la **caja**, la
  **categoría de ingreso** y la **participación del partner**, y registrar la
  **cobranza en el mismo acto** — y que esa cobranza pueda ser **parcial** (el
  comprobante se emite por el total del servicio, pero la cobranza imputada puede
  ser por un valor menor). Alcance (decisión de Pablo): TODAS las superficies de
  emisión. Sólo ingresos por ahora (los egresos se cargan como movimientos en
  Cajas, otra pantalla).
- **Hallazgo clave:** caja + categoría + partner + cobranza parcial YA existían,
  pero sólo en el flujo de cobranza (`registrar_cobranza_comprobante`, que soporta
  parcial nativo: valida `monto ≤ saldo`, deja `estado_cobranza='parcial'`), no en
  el de emisión (`emitir_comprobante_manual`). El wizard de activación ya
  encadenaba ambas. Se llevó ese patrón a las 3 superficies, **sin tocar ninguna
  RPC ni el schema**.
- **Componente reusable** `CobrarAhoraSection` (facturacion/components): toggle
  **Sin cobro / Cobrar total / Cobrar parcial** + caja (prefill favorita) +
  categoría (sugiere "Cobranza/honorario/servicio") + participa partner + monto
  parcial (max=total, botón "Todo") + referencia + preview "cobrás / queda
  pendiente". Espeja `RegistrarCobranzaDrawer`.
- **Helpers** (services/api/cobranzas): `CobroAhoraState` + `cobroInicial()` +
  `validarCobroEnEmision(cobro,total)` + `registrarCobranzaEnEmision(compId,cobro)`
  — este último **re-lee el saldo real** del comprobante recién emitido (evita
  desfasajes de redondeo: total cobra el saldo exacto; parcial clampea a él) y
  llama la RPC de cobranza. Si la cobranza falla, el comprobante igual queda
  creado + warning "registrala desde el detalle" (no atómico, recuperable — mismo
  criterio que el wizard).
- **Superficies cableadas:** (B) `GenerarComprobanteTramiteModal` (el de la
  captura de Pablo), (C) `ModalGenerarComprobante` del panel de Solicitud, (A)
  `ComprobanteFormDrawer` (Nuevo comprobante, paso Confirmar). En (A) el cobro-al-
  emitir aplica SÓLO al tipo X (autorizado inmediato); los fiscales A/B/C van a la
  cola ARCA → la cobranza se hace desde el detalle tras el CAE (sección oculta).
- **§6 / verificación:** build limpio (tsc+vite). **EJERCITAR e2e BD**
  (BEGIN/ROLLBACK): emitir X $100k → pendiente/saldo 100k; cobranza **parcial**
  $40k con caja+categoría+partner → estado **parcial**, saldo 60k, movimiento
  ingreso/origen=facturacion con caja✓ categoría✓ **partner_id_atribucion✓** +
  imputación $40k; cobranza del resto $60k → **pagado**, saldo 0.
- **Live test EN PRODUCCIÓN (gestionglobal.ar · gerente QA · administración QA
  aislada):** las **3 superficies con emisión REAL**: (A) Nuevo comprobante X $2.420
  + cobranza **parcial** $1.000 + **partner Funplata** → parcial/saldo $1.420; (B)
  modal del trámite X $1.500 + parcial $900 → parcial/saldo $600; (C) panel de
  solicitud X $3.000 + cobro **total** → pagado/saldo 0. Todas con caja "MP. Gestión
  Global" + categoría "Cobranza servicios", verificadas en BD. **Limpieza a residuo
  0**: borrados comprobantes/movimientos/imputaciones + admin/usuario/trámite/
  solicitud QA, y el **numerador X/PV1 restaurado a 27** (cero rastro en producción).
- **§6 REVISAR (3 agentes, post-implementación):** 0 GAP bloqueante. Se aplicaron 2
  fixes de UX detectados: (1) reset de `cobro` al reabrir el modal/drawer en A y B
  (no arrastrar el cobro de una emisión anterior → evita una cobranza no
  intencionada; C ya monta condicional, OK); (2) re-clamp de `montoParcial` si el
  operador baja el precio tras elegir parcial. Sin riesgo de plata mal imputada en
  ningún caso (el re-read del saldo + `min()` lo evitan). **Punto PRE-EXISTENTE (NO
  introducido por DGG-84, a confirmar con Pablo):** la rendición de partner atribuye
  el TOTAL del comprobante aunque la cobranza sea parcial (lógica `EXISTS`, agnóstica
  al monto, igual que el flujo de cobranza canónico); el cobro-parcial-al-emitir lo
  vuelve un camino habitual → conviene definir si la participación es sobre lo
  facturado o lo cobrado.
- **Fecha:** 2026-06-16. Sin migración ni cambio de RPC — reusa
  `registrar_cobranza_comprobante` (parcial nativo). Archivos: `cobranzas.ts` +
  `CobrarAhoraSection.tsx` + los 3 emisores.

## DGG-85 · Sábana / resumen de cuenta del partner (base COBRADO) + adjuntos de constancias en egresos (2026-06-16)

- **Pedido (Pablo):** el partner debe recibir un **resumen de cuenta estilo sábana**
  con: fecha, descripción del ingreso/egreso, **adjunto** (si posee), total/saldo
  del comprobante, total de la operación, **chip status** (total/parcial) y **monto
  de participación**. La suma/resta de la cuenta es **siempre por la participación**;
  el total de la operación es **informativo**. Parcial = el total del comprobante no
  se condice con la operación; al completarse el pago se **repite la línea** y el
  total/saldo refleja lo pendiente. Además: poder **adjuntar constancias** (factura,
  transferencia…) en los egresos, con un **clip** descargable cuando existan. "Esto
  no toca las operaciones, es sólo un reporte" — pero sólido y blindado contablemente.
- **Decisiones (4 preguntas a Pablo):** (1) base = **COBRADO** (una línea por
  cobranza/imputación atribuida; participación = % vigente × lo cobrado en esa
  operación; un comprobante cobrado en partes → varias líneas que suman %×total al
  saldarse). (2) Egresos = **operación completa** (chip `total`); participación =
  %costos × monto (resta). (3) **Paridad ineludible** gerencia ↔ partner: mismo
  formato, tabla/grilla con filtros, exportable PDF/XLS. (4) **Extracto corrido +
  filtro por período**.
- **Cómo se logró la paridad con cero duplicación:** UNA sola RPC
  `partner_sabana(p_partner_id, p_desde, p_hasta)` (mig 0248, SECURITY DEFINER): si
  el caller es partner usa su propio `current_partner_id()` (ignora el arg); si es
  staff usa `p_partner_id`; si no, 42501. Y UN solo componente
  `SabanaPartner.tsx` montado en gerencia (`PartnerDetailPage` → tab "Resumen de
  cuenta", default) y en el portal (`PartnerPortalPage` → "Mi resumen de cuenta",
  sin prop → JWT). Ven exactamente lo mismo.
- **Contabilidad de la RPC:** `saldo_after` del comprobante = `c.total − SUM(monto_imputado)`
  por **window** sobre TODAS las imputaciones (`PARTITION BY c.id ORDER BY fecha,
  created_at, id`); chip `total` si `saldo_after≤0.009`, si no `parcial`. El % se
  toma del convenio vigente a la **fecha de cada línea** (LATERAL). Saldo corrido =
  `SUM(participación × signo)` window (ingreso +, egreso −). **El filtro de período
  se aplica DESPUÉS del window** → el saldo de participación que ve el partner es
  **absoluto** (arrastra historia previa), no recalculado sobre el subconjunto.
  Excluye `estado='anulado'`. Sin convenio a la fecha → % = 0 (no rompe).
- **Adjuntos (Fase A, mig 0246):** tabla `movimiento_adjuntos` + bucket privado
  `movimiento-adjuntos` (10MB) + signed URLs + `safeStorageKey` (R20). Múltiples por
  movimiento. Alta desde el modal de Nuevo movimiento y desde un clip por fila en
  Cajas (`MovimientoAdjuntosButton`: ver/descargar/agregar/eliminar). El partner
  sólo descarga los de los egresos/cobranzas donde participa. `fz_listar_movimientos`
  (mig 0247, DROP+CREATE por R16) suma `adjuntos_count`. Borrar una constancia pide
  `useConfirm()` (R13 / blindaje: es un comprobante de gasto, borrado irreversible).
- **Lección capitalizada en el mismo chunk (E-GG-70, mig 0249):** las policies
  partner de `movimiento_adjuntos` subqueriaban a `movimientos` (RLS staff-only) →
  el partner no veía/descargaba NI sus propias constancias. Fix: helpers SECURITY
  DEFINER (`partner_owns_movimiento`/`partner_owns_adjunto_path`). Ver ERRORES.md.
- **§6 + live test (premisa de cierre):** doble auditoría (3 agentes REVISAR +
  EJERCITAR e2e) → encontró E-GG-70 (fixeado). Live en prod (gestionglobal.ar, QA
  aislado, residuo 0): gerencia (sábana 3 líneas: parcial 100k/60k → total 100k/0 +
  egreso −3k, KPIs 30k/3k/saldo 27k; adjunto subido real → clip 1; delete-confirm) +
  portal partner (paridad idéntica; **descarga de la constancia OK** = el fix;
  filtro de período → saldo absoluto 27k; export PDF 184KB + XLS
  `sabana-partner-2026-06-16.xlsx`); mobile 360 sin overflow (tabla con scroll-x);
  consola limpia.
- **PENDIENTE de decisión de Pablo (heredado de DGG-84, NO tocado):** la
  **rendición** (`partner_crear_rendicion`, mig 0188) atribuye el **TOTAL facturado**
  del comprobante aunque la cobranza sea parcial; la **sábana** nueva es **COBRADO**.
  Conviven en el portal (sábana "Mi resumen de cuenta" vs. "Detalle por rendición")
  con labels y nota al pie aclaratoria, pero son **dos bases contables**. Definir si
  la rendición debe migrar a cobrado para alinear ambas. → **RESUELTO en DGG-86**:
  Pablo eligió "todo sobre lo cobrado" → la rendición pasó a cobrado, alineada con la sábana.
- **Fecha:** 2026-06-16. Migs 0246/0247/0248 (commit `b1b4798`) + frontend (commit
  `5e2f828`) + fix RLS 0249 & delete-confirm (commit `05ceb8e`). No toca ninguna
  operación/rendición existente (aditivo: tabla + RPC nuevas + 1 columna en un
  RETURNS TABLE).

## DGG-86 · La rendición del partner pasa a base COBRADO (alinea con la sábana) (2026-06-16)

- **Decisión de Pablo:** ante la pregunta facturado vs cobrado (heredada de DGG-84/85),
  eligió **"todo sobre lo cobrado"** + el principio **"la rendición debe tener el mismo
  esquema para ingresos y egresos"**. Antes la rendición era **devengado/facturado**
  (atribuía `c.total` del comprobante al emitir, cobrado o no — 1 fila por comprobante);
  la sábana (DGG-85) era cobrado → no coincidían. Ahora ambos son **percibido/cobrado**.
- **Concepto que se le explicó:** el partner gana su % **cuando entra la plata**, no al
  emitir. Ejemplo (30%): comprobante $100k cobrado $40k (jun) + $60k (jul) → participación
  $12k en junio + $18k en julio (no $30k de una al emitir). Los egresos ya eran por su
  monto (entran pagados) ⇒ ingresos y egresos quedan con el mismo criterio.
- **Cambio (mig 0250):** `partner_crear_rendicion` reescribe el bloque ingreso: itera
  `movimiento_imputaciones` (cobranzas del partner) cuya **fecha de cobro** cae en el
  período; `monto_base = monto_imputado` (lo cobrado), una fila por cobranza. El bloque
  costo (egreso) queda igual. Nueva columna `partner_atribuciones.imputacion_id`
  (granularidad/dedup/fecha de cobro). `partner_rendicion_movimientos` deriva la fecha
  del ingreso desde la cobranza (`COALESCE(cobranza, egreso, emisión)`). Frontend sin
  cambios (lee `monto_base`/`monto_atribuido`/totales genéricos; headers "Base" neutros).
- **Histórico NO se recalcula:** la RPC sólo CREA rendiciones nuevas; las atribuciones
  viejas (base facturado, `imputacion_id` NULL) quedan intactas. Dedup nuevo por
  `imputacion_id` (no por comprobante) ⇒ soporta cobro parcial multi-período sin doble
  conteo.
- **§6 (premisa de cierre) — doble auditoría:** EJERCITAR e2e (jun cobra 40k→12k no 100k;
  jul 60k→18k; dedup 2 filas sin duplicar) + **REVISAR (agente adversarial) que cazó un
  GAP crítico**: el índice único `uq_pat_rend_comprobante (rendicion_id, comprobante_id,
  tipo)` venía del modelo facturado (1 fila/comprobante) y con cobro parcial multi-cobranza
  en el mismo período disparaba `unique_violation` y abortaba la rendición. **Fix (mig
  0251):** drop de ese índice + `uq_pat_rend_imputacion (rendicion_id, imputacion_id)` —
  la unicidad correcta del modelo cobrado. Re-e2e: 2 parciales del mismo comprobante en
  junio → 2 líneas (70k/21k), sin abortar. (Ver E-GG-71: un índice ÚNICO no aparece en
  `pg_constraint`, sólo en `pg_indexes` — por eso mi chequeo inicial no lo vio.)
- **Live test EN PRODUCCIÓN (gestionglobal.ar, gerente+partner QA, residuo 0):** desde la
  UI de gerencia "Nueva rendición" de junio → la rendición muestra **Ingresos atribuidos
  $12.000 / base $40.000** (cobrado), NO $30.000/$100.000 (facturado); costos $3.000/$10.000;
  neto $9.000. Portal partner: sábana ($12k/−$3k) y "Detalle por rendición" (base $40k /
  atrib $12k) **coinciden** en cobrado. Consola limpia.
- **Límite de alcance conocido (consistente con la sábana):** la participación se computa
  sobre cobranzas imputadas a un **comprobante**. Una cobranza imputada sólo a cuenta
  corriente de la administración (sin comprobante) no se atribuye. Hoy 0 casos; los
  servicios del partner siempre llevan comprobante.
- **Derivado a tarea aparte (no de este cambio):** off-by-one de zona horaria en el período
  de la rendición mostrado en el **portal** ("31 may → 29 jun" en vez de "01 jun → 30 jun");
  gerencia lo muestra bien. Es display-only.
- **Fecha:** 2026-06-16. Migs 0250 + 0251. Sin cambios de frontend. Reusa el patrón de
  imputaciones de la sábana (DGG-85). Resuelve el pendiente facturado-vs-cobrado.

## DGG-87 · Atajo de avance de estado en la LISTA de trámites (hook compartido con el kanban) (2026-06-17)

- **Pedido (Pablo):** en el kanban se cambia el estado (abierto → en progreso → esperando
  cliente → …) arrastrando/con el botón →, pero en la **lista** no había cómo. Sumar un
  "pequeño botón de acción" para avanzar. Requisito explícito: **una sola fuente de verdad**
  — lo que pase en el kanban repercute en la lista y viceversa; el botón es sólo un atajo.
- **Decisión / cómo se logró la fuente única:** se EXTRAJO el `mover` del kanban a un hook
  compartido `src/modules/tramites/lib/useAvanzarTramite.tsx` que ahora usan AMBAS vistas.
  El hook encapsula: gate de cobranza DGG-44 (`esAvanceTramite` + `cobro_pendiente` →
  `useConfirm` "Trámite impago"), update optimista (callback por vista), la mutación
  **`updateTramite(id,{estado})`** (la BD es la fuente de verdad) y los toasts. El kanban
  pasa `onOptimistic=setUniverse`, `onError=load`, `play` (sonidos); la lista pasa
  `onOptimistic=setUniverse`, `onError=load` (sin sonidos). La reconciliación entre vistas
  la da `useRealtimeRefresh(['tramites'])` que ya tenían ambas. No hay lógica duplicada que
  pueda derivar (alineado con R14/R15).
- **UI lista:** en la columna Estado, si `NEXT_ESTADO[estado]` existe (no en cerrado/
  cancelado), un botón `→ {siguiente estado}` (mismo de la card del kanban), fuera del
  `<Link>` de navegación. Click → `avanzar(r, nextEst)` → mismo flujo que el kanban.
- **Sin cambios de BD/RPC:** reusa `updateTramite` (ya existente y e2e-probado). Cambio
  puramente de frontend.
- **§6 / verificación (doble auditoría completa):** build limpio (tsc strict + vite).
  **REVISAR** (agente adversarial): extracción 1:1 sin drift, fuente única, botón gateado
  y aislado del Link, kanban sin regresión, sin imports muertos — sin GAP. Seguridad
  (verificado en BD): RLS de UPDATE en `tramites` = `tramites_staff_all` (USING/WITH CHECK
  `private.is_staff()`) → sólo staff cambia estado; triggers `tramite_on_update/insert`
  SECURITY DEFINER (R17, escriben `tramite_eventos` sin 42501). **EJERCITAR e2e EN VIVO**
  (prod, gerente QA, 4 trámites QA, residuo 0): avance simple sin confirm (cobro_pendiente
  false) ✓; gate "Trámite impago" → Avanzar (cobro_pendiente true) ✓; persistió en BD
  (estado + 2 eventos del trigger) ✓; **sync lista→kanban** (2 avanzados desde la lista
  aparecen en columna En progreso del kanban) ✓; **sync kanban→lista** (avancé uno desde el
  kanban → la lista lo muestra Resuelto) ✓; edge resuelto→cerrado (sin botón en cerrado,
  sale de "Solo activos" al recargar) ✓; los 4 estados finales correctos en BD ✓; mobile
  360 (botón ok, sin overflow, tabla scroll-x) ✓; consola sin errores ✓.
- **Fecha:** 2026-06-17. Commit `e802799`. Archivos: `lib/useAvanzarTramite.tsx` (nuevo) +
  `TramitesKanbanPage` (refactor) + `TramitesListPage` (botón).

## DGG-88 · Criterio "resuelto" vs "cerrado" + gate duro: no se cierra impago (2026-06-17)

- **Criterio (definido con Pablo):**
  - **Resuelto** = el trabajo está hecho / entregamos el resultado. Estado operativo;
    **puede estar impago**.
  - **Cerrado** = además **cobrado** y sin pendientes; estado terminal (archivo).
  - El **cobro es el límite** entre uno y otro. **Regla dura: no se cierra impago.** La
    excepción (incobrable/bonificado) se ejerce resolviendo la cobranza (anular o bonificar
    el comprobante → saldo 0 → `cobro_pendiente`=false). Mismo criterio para cualquier
    trámite, incluidos los de categoría 'curso'.
- **Implementación (decisión #1, "no cerrar impago"):**
  - **mig 0252:** trigger `trg_tramite_cerrar_exige_cobrado` BEFORE UPDATE OF estado en
    `tramites`, acotado por `WHEN (NEW.estado='cerrado' AND OLD.estado IS DISTINCT FROM
    'cerrado')`, SECURITY DEFINER, que hace `RAISE` si `public.cobro_pendiente(NEW)`. Trigger
    SEPARADO (no toca el `tramite_on_update` existente). Es el backstop universal: vale para
    la lista, el kanban, el dropdown del detail y cualquier API/RPC. Smoke e2e (rollback):
    cerrar impago → bloqueado; tras saldar → cierra.
  - **UI:** `useAvanzarTramite` (hook compartido lista+kanban) bloquea client-side con un
    toast claro antes de pegarle a la BD; el detail page muestra el mensaje del trigger vía
    `humanizeError`. El aviso *soft* DGG-44 ("impago, ¿avanzar igual?") se mantiene para
    avances intermedios (no-cierre).
- **Cursos (decisión #2, "cerrar al vencer el acceso") — IMPLEMENTADO (mig 0253):** el nexo
  cert→trámite SÍ existe (`cert.matricula_id → curso_matriculas.submission_origen →
  tramites.formulario_submission_id`, categoría 'curso'). Antes, un trigger AFTER INSERT en
  `certificados` **cerraba** el trámite al emitir el cert. Realineado al criterio:
  - **(A)** `trg_certificado_cierra_tramite_curso_fn` ahora pone el trámite en **`resuelto`**
    (no cerrado) + guarda la URL del certificado en `documento_final_url`. → *resuelto = cert
    emitido*.
  - **(B)** nueva `gg_campus_vencer_matriculas()`: (1) vence el acceso (igual que el cron
    DGG-82) y (2) **cierra** el trámite del curso si está `resuelto` **y** `NOT
    cobro_pendiente` (matrícula ya vencida). El cron diario `gg-campus-matriculas-vencer`
    pasa a llamarla. → *cerrado = acceso vencido + cobrado*. Si está impago, queda `resuelto`
    (el gate de #1 lo bloquearía igual). El filtro `NOT cobro_pendiente` es clave: evita que
    el RAISE del gate aborte el batch.
  - Dos ejes del curso: **matrícula** (`activa→completada→vencida`, acceso académico, NO se
    gatea por cobro) y **trámite/expediente** (`…→resuelto→cerrado`, sí gateado por cobro).
  - **certs_total=0 al aplicar** → sin data que migrar; el realineo entró antes de que se
    emita ningún certificado.
- **§6 / verificación (doble auditoría):** build limpio. **EJERCITAR e2e BD** (rollback):
  #1 gate (cerrar impago bloqueado; tras saldar, cierra); #2 (cert→resuelto; cron cierra el
  curso cobrado y deja resuelto el impago; la matrícula-vencer intacta). **Live test en prod**
  (gerente QA, residuo 0): #1 — desde la lista, cerrar un resuelto IMPAGO → bloqueado con
  toast claro y queda resuelto; resuelto sin deuda → cierra; vía el modal "Cerrar trámite"
  del tracking, impago → bloqueado por el trigger; consola limpia. **REVISAR** (agentes
  adversariales): #1 sin GAP (gate sólo en →cerrado, sin bypass en las 3 vías); #2 sin GAP
  (cert→resuelto conserva todo, cron no aborta por el filtro, sin regresión a DGG-82).
- **Doble notificación → RESUELTO (mig 0254, decisión de Pablo opción 1):**
  `_notif_tracking_cerrado_trg` avisaba a gerencia en CADA transición a resuelto O cerrado
  (doble aviso en resuelto→cerrado; p.ej. cursos: al emitir cert y al vencer acceso) y con
  título siempre "Trámite cerrado". Ahora avisa **una sola vez al ENTRAR a "terminado"**
  (`OLD∉done AND NEW∈done`), copy según estado ("Trámite resuelto"/"Trámite cerrado"); NO
  re-avisa en resuelto→cerrado. La línea visible al cliente toma el copy correcto y se
  saltea en curso→resuelto (la deja el trigger del cert, sin duplicar). e2e (rollback):
  resuelto=1 push "resuelto"; resuelto→cerrado=0 push; cerrado-directo=1 push "cerrado";
  curso→resuelto=sin línea genérica. REVISAR sin GAP. (Sin browser test a propósito: dispararía
  emails reales a los gerentes; el e2e en BD es la verificación sin efectos.)
- **Deuda menor latente (NO de DGG-88, preexistente desde mig 0202, hoy inalcanzable por UI):**
  la rama de reapertura de ese trigger captura también `resuelto→cancelado` y deja la línea
  "Tu trámite fue reabierto…" (copy impreciso para una cancelación). Anotado para pulir si
  alguna vez se habilita el paso a `cancelado`.
- **Copy del gate diferenciado (E-GG-73, mig 0255/0256):** el confirm/toast del gate
  decía siempre "no tiene cobranza registrada", aun con **pago a cuenta**. Se agregó el
  campo calculado `cobro_estado(tramites)` (`'parcial'`|`'sin_cobranza'`|NULL) y el copy
  ahora distingue ambos (parcial → "pago a cuenta, queda saldo" / "Completá"; sin pagos →
  "no tiene ninguna cobranza" / "Registrá"), en el hook (kanban/lista) y en el backstop de
  cierre en BD (trigger 0252, vía detail page). El gate sigue gobernado por el booleano
  `cobro_pendiente`; `cobro_estado` es sólo para el texto. Verificado e2e + en vivo.
- **Fecha:** 2026-06-17. Commits `652291e` (#1: gate, mig 0252 + `useAvanzarTramite.tsx`) +
  `62ccacb` (#2: cursos, mig 0253) + `1fa5f43` (notif una vez, mig 0254) +
  `02ba903`/`ea6e0a0` (E-GG-73: copy parcial vs sin cobranza, migs 0255/0256).

## DGG-89 · Inscripciones duplicadas a cursos (reenvío del formulario) — prevenir + señalar (2026-06-17)

- **Problema (reportado por Pablo):** una alumna con dos inscripciones al mismo curso
  aparecía **una vez** en el campus del alumno pero **dos** del lado de gerencia
  (TRM-2026-00037 y -00041). Causa: el alumno impaciente reenvía el formulario público →
  2 `formulario_submissions` → el trigger crea 2 `solicitudes` → gerencia activa ambas →
  `solicitud_activar` inserta **2 trámites sin dedup**. El campus deduplica estructuralmente
  por `uq_curso_matricula(curso_id, profile_id)` (1 matrícula); gerencia lista trámites crudos.
- **Decisión de Pablo (priorizando MÍNIMO riesgo, plataforma en pulido):** fusionar 2 capas
  de bajo riesgo, **sin tocar el formulario público ni el trigger** (el camino ya pulido):
  1. **Aviso al activar (soft gate en el wizard):** antes de "Comenzar proceso", si ya existe
     un trámite no-cancelado del mismo **servicio + período + solicitante (email)**, se muestra
     un `useConfirm` "Posible inscripción duplicada · Ya existe TRM-XXXX. ¿Activar igual?".
     Previene el 2º trámite en el punto donde nace (la activación manual). No aplica al camino
     terminal (revisión/rechazo/descarte) ni si el trámite ya existe. `buscarTramiteDuplicado`
     en `tramites.ts`; gate en `WizardActivacionV2.comenzarProceso`. Es la ÚNICA vía de
     activación (verificado §6: `solicitud_activar` tiene un único caller).
  2. **Badge "Posible duplicado"** en la lista y el kanban de gerencia, vía computed field
     `posible_duplicado(tramites)` (misma identidad). Señala (no bloquea, no borra) y cubre el
     caso ya existente. Read-side puro.
- **Por qué NO la 3ª opción (idempotencia en el origen):** tocar el form/trigger público es
  más invasivo y puede bloquear reenvíos legítimos (corrección de datos, otro curso). Pablo la
  descartó por riesgo.
- **Identidad de duplicado:** `servicio_id` + `período` + `lower(solicitante_email)`, no
  cancelado. Distingue curso-formación de curso-actualización (servicio distinto) y reinscripción
  en otro período (período distinto) → sin falsos positivos. Verificado: marca exactamente los 2
  trámites de Lucía, 0 falsos positivos en toda la plataforma.
- **Verificación (§6 doble, completa):** **3 agentes REVISAR** (A: SQL/gate · B: wiring/vías de
  activación · C: lateral/downstream/rol) sin GAP crítico; 2 menores cerrados en mig 0258
  (SECURITY INVOKER explícito) + guard de doble-click. **EJERCITAR e2e sintético `BEGIN/ROLLBACK`**
  (8 casos borde, residuo 0): par→t/t, único→f, distinto período→f, distinto servicio→f, hermano
  cancelado→f/f (cancelar uno apaga el badge del otro), email case-insensitive→t, email NULL→f,
  query del wizard→2 filas. Cross-tenant verificado e2e (un administrador no infiere trámites de
  otro tenant vía el badge: INVOKER + RLS). **Prueba en vivo** (badge en `vafa5532`, sin falso
  positivo en la Matrícula, consola limpia). El aviso del wizard se verificó por e2e + estático
  (no se click-eó en vivo para no activar una solicitud real; el render del confirm es determinista).
- **Fecha:** 2026-06-17. Commits `572172d` (capas 1+2, mig 0257 + `tramites.ts` +
  `WizardActivacionV2.tsx` + badges) + `afa5532` (§6: mig 0258 SECURITY INVOKER + guard doble-click).

### DGG-89 · Reportes JL: mail de "dejar en revisión" + responder pedido con texto (2026-06-18)

Dos reportes de José Luis sobre "pedir algo al cliente" (ver E-GG-74 y E-GG-75):
- **#1 (E-GG-74):** "Pedir y dejar en revisión" mandaba mail VACÍO (plantilla manaxer-v1 con
  cuerpo visual vacío → ignora el `body_html` donde estaba `{{mensaje}}`). Decisión de Pablo:
  **arreglar el mail** (no abrir portal: esa rama es email-first por diseño). Mig 0259 puebla el
  template + corrige ruta rota `/portal/solicitudes`→`/portal`. Sweep §6: misma falla en
  `gerencia-notif-generica` (alto tráfico) → mig 0262.
- **#2 (E-GG-75):** el pedido de documentación era archivo-only → pedir un dato (legajo) trababa
  al cliente. Decisión de Pablo: **cualquier ítem se responde con texto O archivo**. Mig 0260
  (`respuesta_texto` + RPC `responder_texto_item`) + `PedidosDocPanel` (input cliente + ver
  respuesta en gerencia). §6 e2e cazó un hueco de seguridad (RPC nueva anon-ejecutable + bypass
  por `v_role NOT IN` con auth NULL) → **mig 0261** (REVOKE anon/PUBLIC + GRANT authenticated +
  guard `IF auth NULL` + `COALESCE`). Patrón NULL latente en las hermanas (no anon-exec → no
  explotable) anotado para sweep.
- **Verificación:** 3 agentes REVISAR + EJERCITAR e2e (role-context, cross-tenant, no-auth) +
  prueba en vivo (cliente QA responde "LEGAJO-99887" → "Respondido" + "Enviar a gerencia"; gerencia
  ve el dato + Aprobar/Rechazar; consola limpia; QA residuo 0).
- **Fecha:** 2026-06-18. Commits `3114f6f` (migs 0259/0260/0261 + frontend) + docs/0262.

### DGG-91 · Reporte JL #3: saldo a favor de un comprobante anulado, imputable a otra deuda (2026-07-01)

**Problema (JL).** Al anular un comprobante YA PAGADO (típico: una inscripción duplicada), el pago
quedaba como un ingreso sin imputar = saldo a favor del cliente, pero **invisible** y sin forma de
aplicarlo a otra deuda. JL quería poder tomar ese crédito y aplicarlo a otro comprobante pendiente.

**Decisión (Enfoque A · sin DDL).** El modelo ya soportaba multi-imputación: `movimientos`
(ingreso) + `movimiento_imputaciones` (N por movimiento, destino XOR comprobante/administración;
trigger recalcula saldo + estado_cobranza; trigger valida Σ ≤ monto). Sólo faltaba **exponer** el
crédito y **aplicarlo**: 2 RPCs nuevas (`listar_creditos_administracion` +
`imputar_credito_a_comprobante`, mig 0265) + drawer `AplicarSaldoAFavorDrawer` con botón en
`ComprobanteDetailPage` (junto a "Registrar pago", sólo con saldo pendiente). Guards: auth, staff,
cross-admin, monto ≤ min(crédito, saldo comp), FOR UPDATE (concurrencia).

**Hallazgos de la doble auditoría §6 (todos fixeados en el mismo chunk).** E-GG-76 (el e2e cazó la
violación del XOR antes de prod), **E-GG-77 (CRÍTICO)**: desimputar un crédito aplicado lo
destruía (`desimputar_cobranza` borraba el movimiento) → fix por discriminador de destino;
E-GG-78: guarda en `fz_revertir_movimiento`. Nota A-4b (aceptada, no se cambia): `listar` muestra
cualquier ingreso con residual = crédito legítimo (anulación **o** pago adelantado); es el
comportamiento correcto de un "saldo a favor".

**Verificación.** 3 agentes REVISAR + EJERCITAR e2e (happy + guards + regresión) + **prueba en
vivo** (v68ebc20: crédito $150.000 aplicado a comprobante QA → saldo $500k→$350k, badge "Saldo a
favor" + fecha de aplicación, toast, consola limpia; luego "quitar saldo a favor" → crédito
sobrevive y vuelve a estar disponible; QA residuo 0). Mobile: preview a `grid-cols-[1fr_auto_1fr]`.

- **Fecha:** 2026-07-01. Commits `ea75afc` (mig 0265 + drawer + wiring) + `68ebc20` (mig 0266
  guards §6 + UI) + `4017248` (mobile). Capitaliza reporte JL #3.

### DGG-92 · Reporte JL #4: desasignar (baja manual) alumnos de un curso, reasignable (2026-07-01)

**Problema (JL).** Gerencia sólo podía ASIGNAR alumnos a un curso del campus
(`curso_asignar_alumno`); no había forma de DESASIGNAR. JL quería poder dar de baja (y
volver a asignar) alumnos manualmente, sin límite.

**Decisión.** Desasignar = **DELETE físico** de la matrícula (RPC `curso_desasignar_alumno`,
mig 0267). Las hijas (`curso_progreso`, `examen_intentos`, `matricula_condiciones`,
`curso_encuentro_asistencias`, `curso_encuentro_zoom_eventos`, `curso_encuesta_respuestas`)
son `ON DELETE CASCADE` → se limpian solas. `certificados.matricula_id` es `ON DELETE RESTRICT`
→ si el alumno YA tiene certificado emitido, la RPC lo bloquea con un mensaje claro (anular el
cert primero) en vez del error críptico de FK. Tras la baja, `uq_curso_matricula` queda libre y
`curso_asignar_alumno` re-inserta fresh ⇒ **asignar/desasignar sin límite**. UI: botón
"Desasignar" por fila en `GestionMatriculasTab` con `useConfirm` (R13). Elegí DELETE (no soft
'anulada') porque el idempotente `curso_asignar_alumno` devolvería la matrícula anulada sin
reactivarla → el DELETE es lo que hace el re-asignar limpio.

**§6.** El e2e cazó que `private.is_staff()` devuelve **NULL** con `auth.uid()` NULL (misma
trampa NULL de E-GG-75) → se agregó guard explícito `IF auth.uid() IS NULL THEN RAISE` (no
explotable: la RPC está REVOKEda de anon, pero defensa en profundidad). e2e (rollback):
asignar→existe · desasignar→borrada · re-asignar (id nuevo) · guard certificado · guard no-auth.
**Prueba en vivo** (v066fedc, curso "Formación inicial · Administradores RPAC"): asigné a la
cuenta de prueba "Paul Test" por SQL, la desasigné desde la UI → roster 4→3, los 3 reales
intactos, confirm personalizado, consola limpia, BD sin residuo.

- **Fecha:** 2026-07-01. Mig 0267, commit `066fedc`. Capitaliza reporte JL #4.

### DGG-93 · Reporte JL #5: recuperación de contraseña (no existía) (2026-07-01)

**Problema (JL).** El usuario `estudio.saveriano@gmail.com` (= José Luis Saveriano, el propio JL)
no podía iniciar sesión ni cambiar la contraseña. Diagnóstico: la cuenta está **sana** (confirmada,
activa, provider email, logueó el 09/06), pero **no existía NINGÚN flujo de recuperación** — ni
"¿Olvidaste tu contraseña?" en el login, ni pantalla de reset, ni reset desde gerencia. Un usuario
que olvida su clave queda bloqueado, porque "cambiar contraseña" (`cambiar-mi-password`) exige estar
logueado. Catch-22.

**Decisión.** Implementar recuperación por **link seguro** (el usuario fija su propia clave; el
server nunca la ve — no seteamos contraseñas). Como este proyecto NO usa el SMTP de Supabase Auth
(los users se crean con `email_confirm=true` → `resetPasswordForEmail` nativo no es confiable), se
usa el **pipeline de email propio** (Google Workspace):
- Edge fn `enviar-reset-password` (pública): `admin.generateLink(recovery)` + encola el correo
  (template `password-reset`, mig 0268). Respuesta genérica anti-enumeración + throttle (3 min +
  5/24h). Link `{{reset_url}}`.
- Pantalla `/restablecer` (`RestablecerPage`): recibe la sesión de recovery y fija la clave con
  `updateUser({password})`. Sólo muestra el form ante un link de recovery real (no ante una sesión
  normal). `supabase.ts` expone `arrivedWithRecoveryHash/isPasswordRecovery`; AuthContext no
  restaura la sesión guardada en ese caso (la de recovery es autoritativa).
- `LoginPage`: link "¿Olvidaste tu contraseña?" → email → mensaje genérico.

**§6 (doble auditoría, 3 agentes REVISAR + EJERCITAR + live).** El agente C cazó **E-GG-79 CRÍTICO**:
`dispatch-emails` doble-escapaba el `&` del link (`renderVars` + `escapeAttr`) → los params del link
se perdían → correo inútil. Fix: `renderVarsRaw` para `cta_url`/`body_text` (dispatch-emails v13).
El agente A pidió cap diario anti mail-bombing (aplicado). Redirect defensivo por la allow-list.
EJERCITAR (edge fn HTTP): anti-enumeración + reset_url→/restablecer type=recovery. Live: forgot form
genérico + /restablecer sin token = enlace inválido (sin desloguear al usuario).

- **Fecha:** 2026-07-01. Migs 0268 + dispatch-emails v14 + enviar-reset-password v2 + frontend.
  Commits `818f5fc`+`2692738`+`324f58b`+`87ae71f`. Capitaliza reporte JL #5.

### DGG-94 · Reporte JL #6: autoscroll al elegir sección en el campus del alumno (2026-07-01)

**Problema (JL).** En `CursoDetalleAlumnoPage` (vista del alumno), al elegir una sección del
sidebar (módulo/clase, bibliografía, examen, encuentros, encuesta, certificado), el viewport no
cambiaba. En **mobile** (sidebar arriba, contenido abajo) el alumno quedaba mirando el menú sin
notar que el contenido se actualizó abajo.

**Primer intento (incompleto) — corregido por feedback de Pablo.** La v1 (`a34f43a`) hizo el
autoscroll SÓLO en mobile, asumiendo que en desktop el contenido "ya está al lado". Pablo corrigió:
el problema **también es de escritorio**. El **QA en vivo lo confirmó**: en el curso más largo
(`formacion-inicial-administradores-copia`, 20 módulos / 32 clases), el sidebar es MUCHO más alto
que el contenido; al bajar y elegir la última sección ("Encuesta de satisfacción"), el contenido se
renderiza arriba a la derecha y el alumno queda mirando **el panel derecho vacío** (screenshot).

**Decisión final (UX, sin DB) — `46a3b2b`.** DOS mecanismos combinados, resultado consistente
(el alumno SIEMPRE ve la sección que eligió, en cualquier entorno):
- **Sticky desktop** (`<main lg:sticky lg:top-6 lg:self-start>`): mientras se navega el sidebar
  largo, el contenido lo sigue y queda a la vista.
- **Autoscroll en AMBOS entornos** (`useEffect([nodoSel])`, sólo tras selección real, delay 80ms):
  scroll DETERMINISTA `window.scrollTo({top: scrollY + main.getBoundingClientRect().top - 16})`,
  sólo si el contenido está fuera de la zona cómoda (`top < 4` = arriba del viewport cuando el
  sticky se agotó cerca del fondo · `top > 140` = muy abajo en mobile). Si ya está visible arriba,
  no salta.
- **Por qué los dos + por qué scrollTo y no scrollIntoView (iteración del QA):** el QA en vivo
  mostró (1) que el sticky **solo** no alcanza — cerca del fondo del sidebar de 20 módulos se agota
  y el contenido vuelve a quedar fuera de vista (el caso "última sección" que marcó JL); y (2) que
  `scrollIntoView` se **confunde con el elemento sticky** (saltaba a la portada en unas secciones,
  no se movía en otras). El `window.scrollTo` calculado con `getBoundingClientRect` es determinista
  y convive con el sticky. Además hubo que **desregistrar el service worker** (Web Push) para que el
  browser tomara el bundle nuevo — cacheaba los chunks viejos entre deploys.
- **CAUSA RAÍZ (la que hizo que "nunca funcionara" en la QA):** `window.scrollTo({behavior:'smooth'})`
  **no se ejecuta** en ciertos contextos (reduce-motion / navegador automatizado); `behavior:'auto'`
  sí. El autoscroll corría pero el scroll smooth se descartaba silenciosamente. Fix final:
  `behavior:'auto'` (instantáneo, verificado: el contenido pasa de -1523px a top:16). Además se pasó
  el scroll de un `useEffect` a un handler compartido `seleccionar()` (determinista respecto del
  click). E-GG-80 (smell): no asumir que `scrollTo({behavior:'smooth'})` scrollea siempre; para un
  scroll que DEBE ocurrir, usar `'auto'`.

**Verificación.** QA en vivo real: para acceder a la vista de alumno (role-gated bajo
`/portal/campus/:slug`, redirige gerentes) sin tipear contraseña, usé el propio flujo de recovery
de JL-5 sobre la cuenta de prueba `pabloeacu+test` (administrador) — de paso **confirmó que la
allow-list de Supabase Auth SÍ incluye `/restablecer`** (resuelve la duda §6 de JL-5). Reproduje el
bug (panel vacío al elegir la última sección) y validaré el sticky post-deploy. La sesión de Pablo
se respaldó y restauró; la matrícula QA se limpió.

- **Fecha:** 2026-07-01. Commits `a34f43a` (v1 mobile) + `c24e8c4` (sticky desktop). Capitaliza reporte JL #6.
