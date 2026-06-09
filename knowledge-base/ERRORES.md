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

## E-GG-49 · Adjunto del gestor no abre ("Bucket not found")
- **Síntoma**: Pablo (2026-06-04 captura): la línea de tracking "Aporte de
  gestoría externa" con un adjunto (el certificado del trámite). Al abrir
  el adjunto, la URL
  `.../storage/v1/object/public/gestor-uploads/<path>` devuelve
  `{"statusCode":"404","error":"Bucket not found"}`.
- **Causa raíz**: el bucket `gestor-uploads` se creó **privado**
  (`public=false`) en la mig 0095, pero TODO el código que sube ahí
  (`subirAdjuntoGestor` en accesoExterno.ts:62, `subirAdjuntoTracking`
  en trackings.ts:624) usa `getPublicUrl()`. Una URL pública no resuelve
  sobre un bucket privado — Supabase devuelve el mensaje engañoso
  "Bucket not found" (en realidad es "el bucket no es público"). La URL
  pública se guardaba en `archivos_urls` de la línea y el componente la
  abría directo con `<a href>` → 404.
- **Por qué no se detectó antes**: el contenido es visible para gerencia
  por la policy `gestor_up_staff_select`, pero gerencia accede vía la app
  con su sesión; el bug se ve al abrir la URL pública cruda (como hizo
  JL). El cliente, que NO es staff, nunca podría haberlo abierto.
- **Fix** (decisión de Pablo vía AskUserQuestion): **mig 0191** marca el
  bucket `gestor-uploads` como **público**, igual que
  `tramite-documento-final` (que ya es público y contiene el mismo tipo
  de contenido: documentos finales del trámite). El path es
  no-adivinable (token/tracking-id + timestamp + random de 6 chars).
  Sin cambios de código — el código ya usaba `getPublicUrl()`
  correctamente; sólo faltaba que el bucket fuera público.
  - **Verificado en vivo**: la URL del adjunto que JL reportó roto
    ahora responde `HTTP 200` (curl real contra producción).
- **Auditoría transversal** (getPublicUrl × buckets privados): barrido de
  los 12 matches de `getPublicUrl` del código contra el estado
  público/privado de cada bucket. Reconciliación completa:
  - **9 calls reales** a buckets públicos correctos (avatars,
    encuesta-testimonios, tramite-documento-final, campus-media,
    emisor-logos, formulario-previews, formulario-descargas, y los 2 de
    gestor-uploads ahora público).
  - **2 son comentarios**, no llamadas (accesoExterno.ts:6 y
    solicitudes.ts:215 — el código real ahí usa `createSignedUrl()`
    porque `form-adjuntos` es privado: patrón correcto).
  - **1 hallazgo: `partners.ts:146` usa `getPublicUrl()` sobre
    `partner-facturas` que es PRIVADO** → mismo bug latente, **resuelto
    en la misma sesión (mig 0192)**. El partner sube su factura PDF, la
    URL pública rota se guarda en `comprobantes.partner_factura_pdf_url`,
    y **el CLIENTE la descarga desde su portal**
    (`PortalComprobanteDetailPage.onDescargarPdf` → `fetch(url).blob()` →
    "el cliente recibe LA FACTURA, no una réplica"). El cliente NO es
    staff ni partner → ni la RLS del bucket lo dejaría leer: es
    **exactamente el patrón de gestor-uploads** (lector no-staff). Hoy el
    bucket tiene 0 archivos → era latente, no manifiesto. **Fix (decisión
    de Pablo, mismo criterio que gestor-uploads): mig 0192 marca
    `partner-facturas` público.**
    - Nota de honestidad técnica: un análisis inicial supuso "sólo leen
      staff+partner → conviene URL firmada"; era **incorrecto** — el
      cliente la descarga y no satisface la RLS. La reconciliación
      completa del flujo write→store→read lo corrigió.
  - **Resultado tras 0191+0192**: TODOS los `getPublicUrl()` del código
    apuntan a buckets públicos, y el único bucket privado consumido
    (`form-adjuntos`) usa `createSignedUrl()` correctamente. Clase de bug
    cerrada, sin latentes restantes.
- **Prevención**: cualquier `upload()` a un bucket seguido de
  `getPublicUrl()` requiere que el bucket sea público. Si es privado,
  usar `createSignedUrl()`. Smell check: cruzar cada `getPublicUrl` con
  `storage.buckets.public`. Y al rastrear quién lee una URL, seguir el
  flujo completo write→store→read (la URL puede guardarse en una columna
  y consumirse desde un módulo distinto y por un rol distinto al que
  sube).
- **Fecha / módulo:** 2026-06-04 · `supabase/migrations/0191`
  (gestor-uploads) + `0192` (partner-facturas). Clase de bug cerrada.

## E-GG-48 · "Se salió del sistema" tras enviar formulario desde portal cliente
- **Síntoma**: José Luis (2026-06-04): "Después de enviar, desde el portal
  del cliente, la solicitud del Certificado de Acreditación, confirmó el
  envío y se salió del sistema." Reproducción manual confirmó el
  comportamiento.
- **Causa raíz** (NO es un logout técnico, es UX): el flujo "Nuevo
  servicio" del portal navega al cliente desde `/portal/nuevo-servicio`
  hacia `/formulario/:slug?origen=portal`. Esa ruta es la página
  PÚBLICA `FormularioPublicoPage` que renderiza `SiteNav` + `SiteFooter`
  públicos en lugar del `PortalLayout`. La sesión sigue válida en
  memoria, pero el cliente visualmente queda "fuera" del portal:
  - No ve el sidebar con Mis Gestiones / Mi cuenta / etc.
  - Ve el SiteNav con el botón "Ingresar" que sugiere "no estás
    logueado".
  - Tras enviar, ve la pantalla verde "¡Listo!" pero sin link de vuelta
    al portal. Para volver, debe tipear `/portal` en la URL o tocar el
    logo (que va a la landing pública).
- **Fix**:
  - **`FormularioRunner.tsx`**: tras submit OK, si `origenCanal === 'cliente'`
    y NO hay `redirect_url_after` configurado, redirige automáticamente
    a `/portal/gestiones` usando `useNavigate()` (NO `window.location`,
    así la SPA preserva la sesión sin recargar). Además, en la pantalla
    de confirmación verde se muestra:
    - Mensaje "Te llevamos de vuelta a tu portal en un instante…"
    - Botón "Volver a mi portal ahora" (link a `/portal/gestiones`).
  - **`SiteNav.tsx`**: usa `useAuth()`. Si `user` no es null, reemplaza
    el botón "Ingresar →" por "Mi portal" (icono LayoutDashboard,
    link a `/portal`). Resuelve también el caso del cliente que ya
    estaba en el portal y aterriza en cualquier página pública.
- **Aprovechado en el mismo chunk**: cambio del formulario
  `certificado-rpac` solicitado por Pablo. Se eliminó la sección
  "Destino del certificado" (campos: destino, CUIT consorcio,
  denominación consorcio) y se reemplazó por una sección informativa
  ("El certificado es válido 30 días para cualquier destinatario,
  incluyendo consorcios y entidades que lo requieran"). Aplicado vía
  UPDATE directo al `schema.sections` jsonb.
- **Auditoría transversal** (1 agente Explore con scope "portal→público
  sin retorno"). Otros lugares con el mismo patrón pero menor impacto,
  pateados a backlog:
  - `PortalWebinarsPage` → "Unirme al webinar" abre link externo en
    nueva tab. Es esperado (Zoom/Webex), bajo impacto.
  - `VerificarCertificadoPage` (pública) no detecta si el visitante es
    el dueño del cert para personalizar la UI ("Este es tu
    certificado", link a Mis certs). Mejora futura, no es bug.
- **Prevención (regla nueva propuesta)**: cualquier flujo que navegue
  desde una sección autenticada (portal/gerencia) a una página pública
  debe (a) preservar contexto visual del usuario logueado en la nav
  (SiteNav adaptativo) y (b) garantizar un camino claro de vuelta al
  contexto autenticado post-acción. Anti-patrón: usar
  `window.location.href` cuando se puede usar `navigate()` de react
  router (el primero recarga la SPA y pierde estado in-memory; el
  segundo lo preserva).
- **Fecha / módulo:** 2026-06-04 · `src/modules/public/components/FormularioRunner.tsx`,
  `src/components/site/SiteNav.tsx`, schema BD del formulario
  `certificado-rpac`.

## E-GG-47 · Cobranza · Anular movimiento del par revertido descalibra la caja
- **Síntoma**: Pablo (2026-06-04 análisis conceptual): "si cobré $1000 y lo
  revierto, el par suma 0. Si después anulo el ingreso original que tuvo
  la reversión, queda el contrasiento de −$1000 huérfano. Caja queda en
  −$1000". Confirmado en producción real:
  - Caja "MP. Gestión Global", par revertido $175.000: si anulamos el
    original revertido → delta −$175k, saldo de la caja queda en
    −$50.000. Si anulamos el contrasiento → delta +$175k, saldo
    queda en $300.000. Ambas posibilidades eran reales y la RPC las
    dejaba pasar.
- **Causa raíz**:
  1. **Modelo conceptual mezclado en el código**. "Anular" debería ser
     para movimientos que NUNCA participaron de un ciclo contable;
     "Revertir" cierra un ciclo y, una vez cerrado, **ningún miembro
     del par puede tocarse más**. La RPC `fz_anular_movimiento` no lo
     entendía así: sólo vetaba el caso de "tiene imputaciones".
  2. Cuando se revierte, el RPC `fz_revertir_movimiento` borra las
     imputaciones del original (eso es correcto — devuelve el
     comprobante a "pendiente"). Resultado: el original queda con
     `revertido_at` seteado pero **sin imputaciones**, y el guard
     existente lo dejaba pasar a anulado.
  3. El contrasiento (`origen='reversion'`) nunca tiene imputaciones
     por diseño. También pasaba el guard.
  4. La UI sólo bloqueaba el botón Anular para movimientos ya
     revertidos / anulados. No miraba si el movimiento era un
     contrasiento.
- **Fix**:
  - **Mig 0186**: `fz_anular_movimiento` ahora tiene 3 guards en este
    orden: (1) `revertido_at IS NOT NULL` → `movimiento_revertido_no_se_puede_anular`,
    (2) `origen='reversion'` → `movimiento_contrasiento_no_se_puede_anular`,
    (3) imputaciones > 0 → `movimiento_con_imputaciones_usar_revertir`
    (existente).
  - **`FinanzasDashboardPage.tsx`**: agregamos `&& m.origen !== 'reversion'`
    a la guarda del botón Anular. Ahora el botón sólo aparece en
    movimientos que pueden anularse sin riesgo.
  - **`errors.ts`**: 6 nuevos mappings humanizados para los códigos de
    error del ciclo anular/revertir (defensa en profundidad por si
    alguien llama la RPC directamente y la UI no filtró el botón).
  - **Smoke e2e in-mig**: aplica `fz_anular_movimiento` sobre el par
    revertido REAL en producción y verifica los 2 rejects.
  - **Browser test en Vercel**: confirmamos que los 2 contrasientos
    visibles en la tabla muestran 0 botones y los originales revertidos
    también. Movimientos normales muestran Revertir + Anular OK.
- **Auditoría a fondo posterior** (Pablo: "audita este chunk a fondo, no
  quiero que se repercuta en ningún otro lugar"). 3 agentes en paralelo
  (RPCs/triggers con patrón soft-delete + UI botones acción + invariantes
  contables BD). Capitalizado en mig 0187 dos invariantes adicionales
  que el frontend asumía pero la BD no enforce:
  - **CHECK `chk_cae_no_anulable`** en `comprobantes`: `cae IS NULL OR
    estado <> 'anulado'`. La UI ya bloqueaba pero un UPDATE manual
    podía romperlo. 0 violaciones en producción al momento de aplicar.
  - **Trigger `trg_imp_validar_sum`** en `movimiento_imputaciones`:
    bloquea inserts/updates que sobre-imputen un movimiento (suma >
    monto). Defensa en profundidad al recálculo del saldo del
    comprobante. 0 violaciones en producción al momento de aplicar.
- **Pateado a otro chunk** (no aplicado acá):
  - Bloqueo de reapertura de trámite cerrado (requiere decidir si
    "reabrir" es válido como operación normal o nunca).
  - Partner rendición cancelada con re-atribución de movimientos
    (más complejo, requiere análisis de flujo).
- **Prevención (regla nueva propuesta para CLAUDE.md)**: cualquier RPC
  que haga **soft-delete sobre una entidad que pueda pertenecer a un
  par/ciclo contable** (reversión, transferencia, NC/ND, rendición)
  DEBE vetar la eliminación si la entidad ya está dentro del ciclo.
  Smoke obligatorio sobre el par real al cerrar la mig. Y en UI, el
  botón de la acción no debería mostrarse si la BD la veta — no
  esperar al toast de error.
- **Fecha / módulo:** 2026-06-04 · `supabase/migrations/0186, 0187`,
  `src/services/api/finanzas.ts`, `src/lib/errors.ts`,
  `src/modules/finanzas/pages/FinanzasDashboardPage.tsx`.

## E-GG-46 · Patrón estado-derivado-vs-propagado en otros 2 lugares (auditoría preventiva pos E-GG-45)
- **Síntoma (preventivo)**: José Luis (2026-06-04): "auditá este chunk a fondo,
  quiero que esta falla no se repercuta en ningún otro lugar ni en la
  visión de ningún usuario". Lanzados 3 agentes en paralelo (vistas
  gerencia, vistas cliente/partner/gestor/alumno, RPCs+análogos
  directos). Encontrados 2 lugares con el MISMO patrón causa raíz que
  E-GG-45:
  1. **Banner "Necesitamos documentación" en PortalHome** (cliente):
     `listPedidosAbiertosCliente()` filtra pedidos por `estado='abierto'`
     pero no mira el estado del trámite vinculado. Si el trámite ya está
     `cerrado`/`cancelado` (CIERRE-EXT/DGG-38), el cliente sigue viendo
     el banner urgente "Necesitamos documentación para tu trámite" para
     una gestión que ya terminó.
  2. **Grilla de Prospectos** (`ProspectosListPage`):
     `listProspectos()` no joinea con `administraciones`. Cuando un
     prospecto se convierte (`convertido_at`+`convertido_a_administracion_id`)
     pero el cliente convertido después se da de baja
     (`administraciones.activo=false` / `estado='baja'`/'suspendido'`),
     el prospecto sigue mostrándose como "Convertido ✓" verde sin pista
     de que el cliente ya no está activo. El gerente puede confundirse
     contando "prospectos convertidos" como clientes activos.
- **Causa raíz común** (idéntica a E-GG-45): A genera B con ciclo
  propio; B llega a estado terminal pero A no se propaga (por diseño).
  La UI tiene que derivar el estado real combinando ambos via join.
- **Fix**:
  1. `listPedidosAbiertosCliente()` (`src/services/api/tramitePedidosDoc.ts`):
     ahora joinea `tramites.estado` y filtra en memoria los pedidos
     cuyo trámite está en `TRAMITE_TERMINAL_PARA_BANNER = {cerrado,
     cancelado}`. El banner desaparece automáticamente cuando la
     gestión está terminada.
  2. `listProspectos()` (`src/services/api/webinars.ts`): joinea
     `administraciones:convertido_a_administracion_id(activo,estado)` y
     expone `cliente_activo` + `cliente_estado` en un nuevo tipo
     `ProspectoListItem`. La UI muestra badge gris **"Cliente de baja"**
     cuando `cliente_activo===false` o badge amber **"Cliente
     suspendido"** cuando `cliente_estado='suspendido'`. El badge
     verde "Convertido" sigue mostrándose porque la conversión sí pasó
     históricamente — pero el gerente ahora ve el contexto.
- **Lo que NO se cambió** (decisiones explícitas):
  - **No** se agregó propagación por trigger (cierre de trámite → cierre
    de pedido_doc; baja de cliente → flag en prospecto). Misma razón que
    E-GG-45: las entidades A son registro histórico, B tiene ciclo
    propio; mantener la separación en BD y derivar en UI es más limpio.
  - **No** se quitaron los prospectos convertidos de la grilla "Convertidos".
    El gerente puede querer ver el historial completo de prospectos
    captados. La info del estado actual del cliente sí se agrega.
- **Análogos menores pateados a mejora futura** (auditoría detectó pero
  no son del patrón visual exacto que pidió JL):
  - `cliente_tramites_listar` / `cliente_webinars_listar` no validan
    `administracion.activo` del cliente logueado. Si se da de baja pero
    aún tiene sesión activa, sigue viendo todo. Es más tema de auth/RLS
    que del patrón #14 — fuera del scope de este chunk.
  - `partner_mis_comprobantes` no refleja baja de cliente. Reporte
    interno, bajo impacto.
- **Prevención (Patrón #14 refinado)**: cualquier RPC/service que
  liste entidades cuyo `*_id` apunta a una entidad con estados
  terminales DEBE joinear el estado de la entidad referida. La UI
  consumidora decide si filtrar, agregar badge contextual o cambiar
  el CTA. Tres patrones canónicos al respecto:
  - **Filtrar** (banner docs): si A es accionable y B terminal, A no
    debería aparecer.
  - **Badge contextual** (prospecto convertido): mantener la fila pero
    agregar info del estado de B.
  - **CTA condicional** (solicitud + trámite, E-GG-45): mantener la
    fila y la acción pero cambiar el verbo del CTA.
- **Fecha / módulo:** 2026-06-04 · `src/services/api/tramitePedidosDoc.ts`,
  `src/services/api/webinars.ts`, `src/modules/webinars-admin/pages/ProspectosListPage.tsx`.

## E-GG-45 · "Procesar" en card de solicitud cuyo trámite ya está cerrado
- **Síntoma:** José Luis (2026-06-04 capture): en la grilla de Solicitudes
  Recibidas (`/gerencia/solicitudes`) aparece una card del **Curso inicial
  de formación de administradores** con estado `ACTIVADA` y CTA "Procesar →"
  apuntando al detalle. JL: "el trámite ya está Cerrado". Click → entra al
  SolicitudDetailPage, ve badge verde "Activada" + link al trámite cerrado.
  La acción de "procesar" ya no aplica, pero el CTA insinúa que sí.
- **Causa raíz:** dos cosas:
  1. El cierre del trámite (`tracking_cerrar`, DGG-38) **no propaga** al
     `estado` de la solicitud que lo originó. La solicitud queda en
     `activada` perpetuamente, sea cual sea el destino del trámite. Esto
     es por diseño (la solicitud es registro histórico), no un bug — pero
     la UI no compensa.
  2. `SolicitudCard.tsx` hardcodea la label "Procesar" sin mirar ni el
     estado de la solicitud ni el del trámite vinculado.
- **Fix:**
  - `listSolicitudes` y `getSolicitud` ahora hacen join con
    `tramites:tramite_id(estado,codigo)` y exponen `tramite_estado` +
    `tramite_codigo` en `SolicitudListItem`.
  - `SolicitudCard.tsx` calcula el CTA con un switch sobre el ciclo de
    vida real combinando ambos estados:
    - `activada` + trámite cerrado/cancelado → "Trámite cerrado" en gris
      slate + mini-chip emerald "Trámite XX cerrado" arriba del bloque
      solicitante.
    - `activada` + trámite abierto → "Ver trámite".
    - `descartada` / `rechazada` → "Ver detalle".
    - Resto (recibida/en_revision/derivada) → "Procesar" (original).
- **Prevención:** **Patrón #14** del catálogo de auditoría — "estado
  de entidad derivado vs estado propagado". Cada vez que una entidad A
  genera una entidad B y B tiene un ciclo de vida (estados terminales),
  preguntarse si las grillas de A muestran info engañosa cuando B llega
  a terminal. Si no se propaga (decisión arquitectural), la UI tiene que
  derivarlo con un join. Hay 2 otras vías análogas que merece auditar
  más adelante: (a) `formulario_submissions` cuyo `solicitud_id`
  generado está activado, y (b) `prospectos` cuyo cliente convertido
  está dado de baja.
- **Fecha / módulo:** 2026-06-04 · `src/modules/solicitudes/`.

## E-GG-44 · Mensajes técnicos crudos de servicios externos llegan al cliente (sweep preventivo Pattern-5)
- **Síntoma:** mandato de auditoría preventiva pos-E-GG-39 (José Luis, "no
  dejés nada para mañana"). El bug E-GG-39 (Supabase Auth devolvió "Password
  is known to be weak..." en inglés al cliente del portal) capitalizó el
  patrón. El sweep transversal sobre todas las edge fns reveló **19 hits**
  donde `error.message` crudo de servicios externos (Supabase Auth, Gmail API,
  ARCA SOAP, Zoom) se propagaba al frontend sin humanizar.
- **Clasificación de los hits** (cliente-facing vs background-only):
  - **8 cliente-facing** (el usuario VE el mensaje en un toast): humanizadas
    en este sweep.
    1. `crear-gerente/index.ts:97,114` · gerencia crea otro usuario.
    2. `alta-cliente-portal/index.ts:122,160` · alta de cliente con acceso.
    3. `send-comprobante-email/index.ts:115` · Gmail API al enviar comprobante.
    4. `cj-enviar-pdf/index.ts:117` · Gmail al enviar PDF jurídico.
    5. `zoom-meeting-create/index.ts:153` · creación de reunión Zoom.
    6. `zoom-webinar-create/index.ts:145` · creación de webinar Zoom.
    7. `arca-autorizar-comprobante/index.ts:57` · job lookup ARCA.
  - **11 background-only** (cron/webhook, errores van a logs sin llegar al
    UI): se dejan con `error.message` crudo. Incluye: `dispatch-emails`,
    `dispatch-push`, `dispatch-vencimientos`, `dispatch-recupero`,
    `dispatch-arca-emission`, `notify-vencimientos`, `email-bounce-harvester`,
    `gmail-pubsub-webhook`, `webex-webhook`, `health-flows-check`,
    `db-health-alert-check`.
- **Fix:**
  - Helper centralizado nuevo: `supabase/functions/_shared/humanize.ts`
    con `humanizeUpstream(rawMessage, fallback?)` y `humanizeUpstreamMsg()`.
    Mapas regex para los 22 casos comunes de Supabase Auth + Gmail + ARCA
    + Zoom + red/infra. Fallback genérico en español que NO incluye el
    mensaje técnico crudo (no leakea info al cliente).
  - 8 edge fns cliente-facing parchadas para usar el helper. Pattern:
    ```ts
    if (errCreate || !newUser?.user) {
      console.error('crear-gerente: createUser falló', { err: errCreate?.message });
      const h = humanizeUpstream(errCreate?.message, 'No pudimos crear el usuario. Verificá el email y reintentá.');
      return json(h.status, { ok: false, error: h.message });
    }
    ```
    Se mantiene el `console.error` con el msg técnico (va a logs de
    Supabase para debugging), pero al cliente le llega solo el copy humano.
  - Las 7 funciones deployadas vía Supabase Management API (incluyen
    `_shared/humanize.ts` y deps existentes como `arca.ts`, `emisor.ts`).
- **Auditoría transversal** (R12): grep `(e as Error).message`, `err.message`,
  `error.message` en `supabase/functions/*/index.ts`. 19 hits totales. La
  clasificación cliente-facing vs background fue decidida según el flujo:
  ¿el JSON con el error llega a un `toast.error()` del frontend? Si sí,
  humanizar. Si va a un cron log o queue retry, dejar crudo.
- **Prevención:** patrón canónico ya consolidado en R17/R18 de CLAUDE.md
  + helper compartido. Smell check para futuras edge fns: si tu fn devuelve
  `error: err.message` sin pasarlo por `humanizeUpstream()`, y NO es un
  cron/webhook background, es un bug latente. Reglas R18 y R19 de CLAUDE.md
  ya capitalizan el patrón "humanizar antes de devolver".
- **Fecha / módulo:** 2026-06-02 · Edge functions · `_shared/humanize.ts` +
  7 funciones deployadas.

## E-GG-43 · KPI "Resueltos" muestra 0 en tab Activos hasta que se cambia a Historial
- **Síntoma:** José Luis (2026-06-02) abre el portal cliente → tab
  Activos → ve "Resueltos: 0" pero claramente el cliente tiene un
  trámite cerrado (TRM-2026-00014 "Curso de Formación RPAC", estado
  "RESUELTO" en BD). Al click "Todo el historial", el contador se
  refresca y muestra "1". Inconsistencia entre los KPIs y la realidad
  hasta que cambia el tab.
- **Causa raíz:** `PortalGestionesPage.tsx` línea 38 hacía:
  ```ts
  const res = await fetchClienteTramites(filter === 'abiertos');
  ```
  Cuando el tab era 'abiertos', el RPC backend filtraba y devolvía
  SOLO estados abiertos. El array `items` quedaba parcial. Los stats
  (`useMemo`) calculaban `resueltos = items.filter(estado === 'resuelto')`
  sobre ese array filtrado → siempre 0 en tab Activos. Al cambiar a
  'todos', fetch traía todo, items se completaba, stats reflejaba el
  conteo real → ilusión de "se refresca al ir al historial".
- **Bug secundario** (DGG-38 EXT): el filtro contaba SOLO `estado='resuelto'`.
  Pero el flujo de cierre con motivo (DGG-38 EXT) deja `estado='cerrado'`.
  Desde la óptica del cliente ambos son trámites terminados.
- **Fix:**
  - Un único fetch sin filtro backend (`fetchClienteTramites(false)`).
  - `useEffect` sin dependencia en `filter` → no refetch al cambiar tab.
  - `visibleItems` nuevo `useMemo` aplica el filtro UI en memoria.
  - `stats` sigue calculando sobre `items` completo → KPIs correctos
    desde el primer load.
  - `stats.resueltos` cuenta tanto `'resuelto'` como `'cerrado'`.
- **Auditoría transversal** (R12): grep de componentes con
  `useState<X[]> + fetch(filtro) + useMemo stats sobre X`. Resultado:
  0 hits adicionales en el codebase. PortalGestionesPage era el único
  caso del anti-patrón.
- **Capitalizada como R19** en CLAUDE.md: "KPIs/contadores se calculan
  sobre el universo completo; los filtros viven en memoria". Smell
  check: si tu `useEffect` re-fetchea cuando cambia un filtro UI,
  probablemente estás cometiendo este error.
- **Fecha / módulo:** 2026-06-02 · Portal cliente · `PortalGestionesPage.tsx`.

## E-GG-42 · `column "fuente" of relation "curso_matriculas" does not exist` al asignar alumno a curso
- **Síntoma:** José Luis (2026-06-02) abre el drawer "Asignar al curso"
  desde el detalle del Curso de Formación RPAC, elige Estudio Save y
  click "Asignar al curso" → toast: *"column \"fuente\" of relation
  \"curso_matriculas\" does not exist"*. Bloqueo total del flujo de
  asignación manual de alumnos.
- **Causa raíz:** la migración 0172 (`audit_d_fixes`, 2026-05-30)
  modificó la RPC `public.curso_asignar_alumno()` agregando el campo
  `fuente = 'gerencia_manual'` al INSERT:
  ```sql
  INSERT INTO public.curso_matriculas (curso_id, administracion_id, profile_id, fuente)
  VALUES (p_curso_id, p_administracion_id, v_profile_id, 'gerencia_manual')
  ```
  Pero **nunca agregó la columna `fuente`** a la tabla. La mig fue
  half-shipped: tocó la RPC pero olvidó el `ALTER TABLE`. Bug latente
  desde esa mig hasta que JL fue el primero en disparar el flujo en
  producción.
- **Por qué no se detectó antes:** la mig 0172 era parte de DEEP-AUDIT-D
  (auditoría técnica BD), que era una pasada amplia de fixes. El
  `apply_migration` no falla aunque la RPC tenga refs a columnas
  inexistentes (Postgres compila plpgsql en runtime con search_path),
  y los smokes de ese chunk no incluyeron una llamada real a
  `curso_asignar_alumno`. Tampoco había browser walkthrough específico
  del flujo "asignar alumno desde gerencia" en QA.
- **Fix (mig 0183):**
  ```sql
  ALTER TABLE public.curso_matriculas ADD COLUMN IF NOT EXISTS fuente text;
  -- Backfill semántico
  UPDATE public.curso_matriculas
     SET fuente = CASE WHEN submission_origen IS NOT NULL
                       THEN 'formulario_publico' ELSE 'gerencia_manual' END
   WHERE fuente IS NULL;
  ALTER TABLE public.curso_matriculas
    ALTER COLUMN fuente SET DEFAULT 'gerencia_manual';
  ```
  Sin check constraint a propósito — admite valores futuros (`webinar_auto`,
  `import_legacy`, etc) sin requerir cambios de schema.
- **Smoke e2e** (BEGIN/ROLLBACK con simulación de role gerente JL):
  curso + administracion + profile sintéticos → `curso_asignar_alumno()`
  → matrícula creada con `fuente='gerencia_manual'` ✓.
- **Auditoría transversal** (R12 / regla 9):
  - Otras RPCs que insertan en `curso_matriculas`: `curso_matricular`
    (no usa `fuente`, su INSERT está sano).
  - Otras tablas con misma deuda potencial — `grep` por columnas
    referenciadas en RPCs pero no presentes en pg_attribute:
    ```sql
    -- patrón sugerido para futuras auditorías
    SELECT p.proname, regexp_matches(pg_get_functiondef(p.oid),
      'INSERT\s+INTO\s+public\.(\w+)\s*\([^)]+\)', 'g') AS matched
    FROM pg_proc p ...
    ```
    Sin tiempo para correr exhaustivo en este chunk; sumada a backlog
    auditoría tipo "schema drift entre RPC y tabla".
- **Prevención:** patrón canónico — toda mig que modifique INSERT/UPDATE
  de una RPC debe ir acompañada de **smoke e2e** que ejecute la RPC
  realmente (con `BEGIN; PERFORM rpc(...); ROLLBACK;`). Si la mig
  toca columnas que no existen, el smoke lo detecta antes del push.
  Lección complementaria al método doble del usuario.
- **Cambio de método en curso:** este es el segundo bug que el browser
  testing visual habría detectado en segundos (E-GG-41 + E-GG-42 en el
  mismo día). Necesito creds de un usuario gerente de prueba o que el
  usuario haga walkthrough post-deploy para que el ciclo "revisar +
  ejercitar" sea completo.
- **Fecha / módulo:** 2026-06-02 · Campus · `curso_matriculas` · mig 0183.

## E-GG-41 · Tab "Documentación" muestra 0 adjuntos cuando el cliente subió archivos vía PedidoDoc
- **Síntoma:** José Luis (2026-06-02) reporta que en el detalle de un
  trámite con una línea "Cliente envió 1 archivo(s) de documentación para
  revisión", la tab **Documentación** muestra "Sin adjuntos · 0 ADJUNTOS"
  cuando claramente hay al menos 1 archivo.
- **Causa raíz:** el flujo "Pedido de Documentación" (N2/N3) guarda los
  archivos del cliente en su propio bucket privado `pedidos-doc-cliente`
  y referencia el path en la columna
  `public.tramite_pedidos_doc_items.archivo_path`. La línea
  "Cliente envió N archivos" (categoría `pendiente_revision`) se inserta
  con `archivos_urls=[]` VACÍO — la URL pública nunca se materializó en
  la línea porque el bucket es privado (signed URL expira).
  El componente `TrackingDetailPage` calculaba `adjuntosTodos` SOLO
  mirando `data.lineas[].archivos_urls`:
  ```ts
  for (const l of data.lineas) {
    for (const u of l.archivos_urls ?? []) out.push({url: u, ...});
  }
  ```
  → Resultado: archivos invisibles en la tab Documentación. El badge
  "Adjuntos (0)" en KPIs y en la tab del header igual.
- **Verificación en BD** (smoke directo sobre el trámite reportado):
  - `tramite_adjuntos`: 0 filas.
  - `tracking_lineas.archivos_urls`: TODAS las 3 líneas con `[]` vacío.
  - `tramite_pedidos_doc_items` con `archivo_path IS NOT NULL`: 1 fila
    ("Transferencia Renovación de Mariana V. Calanna.pdf").
  La inconsistencia 100% confirmada antes de tocar código.
- **Fix:**
  - **Service nuevo** `listAdjuntosPedidosDocDeTramite(tramiteId)` en
    `src/services/api/tramitePedidosDoc.ts`. Lista todos los items de
    pedidos del trámite que tienen `archivo_path NOT NULL`, genera
    signed URL (60min) para cada uno y devuelve `PedidoDocAdjunto[]`
    con `archivoNombre`, `descripcion`, `estado` (`aprobado` /
    `subido` / etc), `subidoAt`.
  - **TrackingDetailPage** carga `adjuntosPedidoDoc` en `useEffect`
    paralelamente al detalle. El `useMemo adjuntosTodos` ahora mergea
    **(a)** archivos de `lineas[].archivos_urls` + **(b)** items con
    archivo del flujo PedidoDoc, en una única lista ordenada por fecha
    desc. Tipo `AdjuntoUnif` con `origen: 'linea' | 'pedido_doc'`.
  - **UI de la tab**: cada card muestra el nombre real del archivo
    (no más `url.split('/').pop()` que daba paths feos), `download`
    attribute para descarga limpia, y un **badge "Cliente"** en los
    items de origen `pedido_doc` para que gerencia sepa el origen.
- **Auditoría transversal** (R12 / regla 9): la lección es que el
  inventario unificado de archivos del trámite debe contemplar las 3
  fuentes: (1) `tramite_adjuntos` (no usado hoy), (2) `tracking_lineas.
  archivos_urls`, (3) `tramite_pedidos_doc_items.archivo_path`. Si en
  el futuro aparece un 4to flujo (ej. acceso externo de gestoría que
  ya guarda en otro bucket), el mismo patrón aplica.
- **Por qué no se detectó antes:** los chunks anteriores (N2, M1-M4)
  capitalizaron la UX del PedidoDoc pero solo en el panel
  `PedidosDocPanel` del Resumen. Nunca se cruzó con la tab Documentación
  que vivía con su propia query parcial. Mea culpa metodológica: estuve
  haciendo auditoría estática + BEGIN/ROLLBACK pero no abrí browser
  para mirar la tab. José Luis llamó la atención sobre esto el mismo
  día y aceleró el método doble.
- **Mejora de método:** desde acá, todo fix de UX se valida también
  visualmente en `https://gestionglobal.ar` (Chrome MCP) o con captura
  del usuario antes de declarar "completo". El testing en BD detecta
  inconsistencias de datos; el testing visual detecta gaps de
  agregación como éste.
- **Fecha / módulo:** 2026-06-02 · Trámites · `tramitePedidosDoc.ts`
  + `TrackingDetailPage.tsx`.

## E-GG-40 · "Invalid key" al subir adjunto con tildes/ñ desde el Wizard de Activación
- **Síntoma:** José Luis (2026-06-02) intenta subir "Transferencia
  Inscripción de Jorge Adrián Alejandro Prieto.pdf" desde el Wizard de
  Activación (acceso externo a la gestoría) → toast:
  *"No pudimos subir Transferencia Inscripción de Jorge Adrian Alejandro
  Prieto.pdf · Invalid key: 47c76049-fcad-4125-9e6e-b52d70c17dbb/
  1780432483789-Transferencia_Inscripción_de_..."*. El nombre tiene una
  "ó" (Inscripción) y una "á" (Adrián) que Supabase Storage rechaza
  como caracteres no válidos en la key.
- **Causa raíz:** `src/services/api/solicitudes.ts:uploadAdjuntoGestoria`
  construía el path como:
  ```ts
  const path = `${solicitudId}/${Date.now()}-${file.name.replace(/\s+/g, '_')}`;
  ```
  El sanitizer SOLO reemplazaba espacios con `_`. Los acentos y la `ñ`
  pasaban tal cual al path. Supabase Storage es estricto con la key:
  caracteres fuera de `[a-zA-Z0-9._-]` pueden ser rechazados según el
  runtime con error `Invalid key`. El resto de los services del repo
  (`tramites`, `trackings`, `partners`, `formularios-admin`,
  `accesoExterno`, `campus`, `encuestas`) ya usaban regex equivalentes
  como `[^\w.\-]` que sí remueven los acentos — pero `solicitudes.ts`
  quedó atrás como deuda inconsistente.
- **Fix:** creado `src/lib/storageKeys.ts` con dos helpers centralizados:
  - `safeStorageKey(filename)` → normaliza NFKD + quita diacríticos
    (combining marks U+0300..U+036F) + reemplaza no-ASCII-safe con `_`
    + colapsa runs de `_` + recorta a 200 chars + fallback `archivo` si
    queda vacío.
  - `buildStorageKey(scope, filename)` → conveniente para el patrón
    típico `<scope>/<timestamp>-<safe>`.
  `uploadAdjuntoGestoria` ahora usa `buildStorageKey()`. Ejemplo:
  `'Transferencia Inscripción Niño.pdf'` → `'Transferencia_Inscripcion_Nino.pdf'`.
- **Auditoría transversal** (`grep file.name.replace`): 11 lugares con
  sanitizers. Solo `solicitudes.ts:276` estaba roto. Los otros 10
  usaban patrones equivalentes. Como acción de fondo se centraliza
  en `storageKeys.ts` para no volver a tener inconsistencias —
  los services existentes pueden migrar gradualmente al helper.
- **Prevención:** patrón canónico al subir archivos a Supabase Storage:
  **siempre pasar `file.name` por `safeStorageKey()` antes de construir
  el path**, nunca usar el nombre crudo ni un regex parcial (`/\s+/g`,
  etc.). El helper hace el `normalize('NFKD')` que descompone los
  caracteres acentuados y elimina los marks — eso es lo que `\w` no
  hacía solo.
- **Fecha / módulo:** 2026-06-02 · Solicitudes / Storage · `src/lib/storageKeys.ts`.

## E-GG-39 · Cliente no puede cambiar contraseña — mensaje técnico en inglés crudo ("Password is known to be weak and easy to guess")
- **Síntoma:** un cliente reporta desde su portal (2026-06-02) que no
  puede actualizar su contraseña. Toast: *"No pudimos actualizar la
  contraseña: Password is known to be weak and easy to guess, please
  choose a different one."* El mensaje técnico en inglés viola el
  estándar premium (todo copy al cliente debe ser en español y accionable),
  rompe la confianza, y NO le explica al cliente qué hacer para resolverlo.
- **Causa raíz:** en AUDIT acción 2 #270 activamos "Leaked password
  protection" en Supabase Auth (chequea HaveIBeenPwned). Cuando el
  cliente eligió una contraseña que aparece en filtraciones públicas,
  Supabase rechaza con ese mensaje. La edge fn `cambiar-mi-password`
  (línea 99-103 v1) hacía:
  ```ts
  if (updErr) {
    return json(500, {
      ok: false,
      error: `No pudimos actualizar la contraseña: ${updErr.message}`,
    });
  }
  ```
  → propagaba el `updErr.message` literal sin traducir. El frontend
  pasa el error por `humanizeError`, pero `humanizeError` solo conoce
  los códigos / regex registrados — y este patrón nuevo no estaba.
- **Fix (edge fn v2 + lib/errors.ts):**
  1. Edge fn `cambiar-mi-password` ahora humaniza ANTES de devolver
     (defensa en origen): detecta los patrones conocidos y devuelve
     mensajes en español con la acción que el usuario tiene que tomar.
     Status code apropiado (422 unprocessable, 429 rate limit).
     Patrones mapeados:
     - `known to be weak` / `compromised` →
       "La contraseña que elegiste aparece en filtraciones públicas
        conocidas. Por seguridad, elegí una más original (combiná
        mayúsculas, minúsculas, números y un símbolo)."
     - `should be at least` / `is too short` →
       "La contraseña es muy corta. Probá con una de al menos 8 caracteres."
     - `should be different` / `same as the old` →
       "La contraseña nueva tiene que ser distinta a la anterior."
     - `should contain` / `character types` →
       "La contraseña no cumple los requisitos mínimos…"
     - `rate limit` / `too many` →
       "Hiciste muchos intentos seguidos. Esperá unos minutos…"
     - fallback genérico humano.
  2. `lib/errors.ts` (HUMAN_BY_MESSAGE): agregué los mismos patrones
     como **defensa en profundidad** por si el mensaje crudo escapa
     desde otro flujo (signup, reset por email nativo de Supabase, etc.)
     y llega al frontend sin pasar por la edge fn.
- **Auditoría transversal** (R12 / regla 9): grep de
  `auth.updateUser | admin.updateUserById | resetPasswordForEmail`
  en `src/` y `supabase/functions/`. Resultado: el **único** punto donde
  cambiamos contraseña en código propio es la edge fn `cambiar-mi-password`
  (línea 96). El reset-por-email usa el flujo nativo de Supabase que
  controla el copy desde el dashboard. Los `setPassword` que aparecen
  en `LoginPage`/`EncuentrosTab` son state locales de inputs (no auth).
  → un único punto de fix cubre el universo. Frontend `PerfilPage:423`
  ya invoca con `humanizeError`, no requiere cambios.
- **Prevención:** patrón canónico — **toda edge fn que envuelve un
  servicio externo (Supabase Auth, ARCA, Resend, Zoom) debe traducir
  errores técnicos a copy humano en español ANTES de devolver al
  cliente**. El "fallback al `humanizeError` del frontend" funciona
  para casos genéricos (RLS, FK violation) pero NO para mensajes
  proprietarios del servicio. Smoke check al cierre de cualquier
  chunk que toque edge fns wrappers: ¿devuelve el error tal cual o
  lo traduce? Si lo devuelve tal cual → bug latente.
- **Fecha / módulo:** 2026-06-02 · Portal cliente · Auth · edge fn
  `cambiar-mi-password` v2.

## E-GG-38 · Mover trámite en kanban niega permisos al gerente (RLS bloquea trigger INVOKER que escribe en `tramite_eventos`)
- **Síntoma:** José Luis (gerente, máxima autoridad) intenta mover un trámite
  en `/gerencia/tramites/kanban` (TRM-2026-00014, Abiertos → En progreso)
  y aparece toast: **"No pudimos mover el trámite: No tenés permisos para
  realizar esta acción"**. El error 42501 sale en el UPDATE de `tramites`,
  pero el rol del usuario sí es `gerente` y la policy `tramites_staff_all`
  (ALL) sobre `tramites` está pasada (`private.is_staff()` = true).
- **Causa raíz:** el bug NO está en la policy de `tramites` — está dentro
  del trigger BEFORE UPDATE `tramite_on_update()` que, al cambiar
  `estado/prioridad/asignado_a`, inserta una fila en `public.tramite_eventos`
  para dejar bitácora. Esa tabla tiene RLS habilitada y SOLO tiene 2
  policies, ambas de **SELECT** (`eventos_staff_select` y `eventos_admin_select`).
  No hay policy de INSERT. El trigger NO era `SECURITY DEFINER`, así que
  el INSERT corría con los permisos del invoker (gerente), y RLS lo
  rechazaba con 42501. El error de PostgREST refleja el último statement
  fallido — el UPDATE — pero la causa está adentro del CONTEXT del trigger.
  Reproducción exacta en BD (`BEGIN; SET LOCAL role authenticated; UPDATE …; ROLLBACK;`):
  ```
  ERROR:  42501: new row violates row-level security policy for table "tramite_eventos"
  CONTEXT: PL/pgSQL function tramite_on_update() line 8 at SQL statement
  ```
  Confirmado: aplica a **TODO usuario authenticated** (no solo JL). 4
  triggers afectados, todos NO-DEFINER, todos escribiendo en
  `tramite_eventos`:
    - `tramite_on_insert` (al crear trámite manual)
    - `tramite_on_update` (estado/prioridad/asignado_a)
    - `tramite_on_adjunto_insert` (al subir adjunto)
    - `tramite_on_comentario_insert` (al comentar)
  El bug estuvo **latente** desde la creación de `tramite_eventos`. No se
  detectó antes porque (a) en QA siempre se reasignaba o se trabajaba
  desde el detail, no del kanban; (b) cuando el trámite venía con
  `formulario_submission_id`, el primer evento "creado" se insertaba
  desde otro trigger (`crear_tramite_desde_submission_auto` que SÍ es
  SECURITY DEFINER) y enmascaraba el problema en el INSERT inicial.
- **Fix (mig 0179):** convertir las 4 funciones a `SECURITY DEFINER` con
  `SET search_path = 'public', 'pg_temp'`. Es lo correcto:
    - Los logs de eventos son automáticos del sistema, no acción del
      usuario — naturalmente quieren ejecutar con privilegios elevados.
    - `auth.uid()` sigue retornando el usuario original (queremos el
      actor real para `actor_id` / `actor_nombre`).
    - No requiere abrir policy INSERT en `tramite_eventos` (mantiene
      cero superficie de escritura directa cliente).
- **Smoke e2e** (BEGIN; SET LOCAL role authenticated; ... ROLLBACK; con
  uid de JL): UPDATE estado ✓ + UPDATE prioridad+asignado_a ✓ + INSERT
  comentario ✓. En los 3 casos el evento aparece en `tramite_eventos`
  con `actor_id = JL` y `actor_nombre = 'José Luis Saveriano'`.
- **Auditoría transversal** (para no dejar bombas como ésta): query que
  cruza TODAS las tablas RLS con policies SOLO-SELECT contra TODAS las
  funciones públicas que las escriben. Resultado: las **14 tablas
  restantes** con patrón SOLO-SELECT (audit_log, push_notifications_queue,
  arca_emision_queue, health_flow_*, etc.) ya tienen TODAS sus funciones
  escritoras como `SECURITY DEFINER`. Solo `tramite_eventos` estaba
  expuesta. Tablas escritas por edge fns con service_role (email_throttle,
  frases_*, salud_alertas_log) no aparecen en la query porque no tienen
  función public — están cubiertas por service_role bypass.
- **Prevención:** patrón canónico. **Todo trigger que escriba en una
  tabla con RLS habilitada DEBE ser `SECURITY DEFINER` con `SET
  search_path = 'public', 'pg_temp'`**, salvo que la tabla destino tenga
  policy de INSERT explícita para los roles esperados del invoker. Este
  patrón ya estaba implícito en el resto del schema (todas las _audit /
  _notif son DEFINER), pero `tramite_*` lo violaba. Agregar el query
  transversal como smoke check al cierre de chunks que toquen triggers:
  ```sql
  -- "Triggers no-DEFINER que escriben en tablas RLS sin policy de write"
  WITH rls_tables AS (
    SELECT c.oid, c.relname FROM pg_class c
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity
      AND NOT EXISTS (
        SELECT 1 FROM pg_policy p WHERE p.polrelid=c.oid
          AND p.polcmd IN ('a','w','d','*')
      )
  )
  SELECT t.relname, p.proname
  FROM rls_tables t
  JOIN pg_proc p ON pg_get_functiondef(p.oid) ~* ('insert\s+into\s+(public\.)?'||t.relname)
  WHERE NOT p.prosecdef;
  -- Debe devolver 0 filas.
  ```
- **Fecha / módulo:** 2026-06-02 · Trámites · mig 0179.

## E-GG-37 · Overloads ambiguos de RPC rompen el frontend ("Could not choose the best candidate function")
- **Síntoma:** José Luis (2026-06-02) intenta confirmar el paso 3 de la
  cobranza de la matrícula del curso (X 00001-00000017, $125.000) y el
  toast tira:
  ```
  No pudimos registrar la cobranza
  Could not choose the best candidate function between:
    public.registrar_cobranza_comprobante(p_comprobante_id ⇒ uuid, ...,
      p_categoria_id ⇒ uuid),
    public.registrar_cobranza_comprobante(p_comprobante_id ⇒ uuid, ...,
      p_categoria_id ⇒ uuid, p_partner_id_atribucion ⇒ uuid)
  ```
  La cobranza queda **bloqueada para toda gerencia**. Es un bug de
  producción crítico que aparece tan pronto como se intenta cobrar el
  primer comprobante post-mig.
- **Causa raíz:** cuando una migración EXTIENDE una RPC agregando un
  parámetro nuevo con `DEFAULT NULL`, Postgres NO reemplaza la firma vieja
  — crea **OTRO** overload con la firma extendida. Quedan dos firmas
  coexistentes:
    1. `registrar_cobranza_comprobante(... p_categoria_id uuid)` (vieja).
    2. `registrar_cobranza_comprobante(... p_categoria_id uuid,
        p_partner_id_atribucion uuid DEFAULT NULL)` (extendida).
  PostgREST (el cliente HTTP que usa Supabase) no puede decidir cuál
  invocar cuando recibe exactamente los 7 args originales (matcha ambas),
  y devuelve este error genérico. El frontend nunca vio el bug en QA
  porque pruebas pasadas usaban la firma extendida con partner_id_atribucion,
  pero la cobranza estándar (sin partner) pasa los 7 args base y hace
  estallar la resolución.
- **Por qué la auditoría DEEP no lo cazó completo:** DEEP-AUDIT-D (mismo
  día, antes de este reporte) detectó UN caso exacto del patrón:
  `fz_crear_movimiento_manual` con 2 overloads (10 vs 11 args). Lo trató
  como "ambiguity hazard" en el reporte y lo dropeó en mig 0172. Pero
  **no hizo el query transversal** para detectar TODOS los casos del
  mismo patrón en el schema. Si lo hubiera hecho, habría encontrado los
  otros 3 antes de que José Luis tropezara. Lección capturada en R16
  (abajo).
- **Auditoría transversal post-incidente** con
  `SELECT p.proname, count(*) FROM pg_proc p JOIN pg_namespace n ON
   n.oid=p.pronamespace WHERE n.nspname='public' GROUP BY p.proname
   HAVING count(*) > 1`:
  | RPC | overload viejo | overload extendido (DEFAULT) | riesgo |
  |---|---|---|---|
  | `registrar_cobranza_comprobante` | 7 args | +`p_partner_id_atribucion uuid` | **rompió la cobranza de José Luis** |
  | `partner_marcar_facturado` | 3 args | +`p_pdf_url text` | rompía el adjuntar PDF si se llamaba sin él |
  | `solicitud_derivar` | 5 args | +`p_dias_validez integer` | rompía las derivaciones con TTL |
- **Fix (mig 0173):** DROP de los 3 overloads viejos. El extendido es
  retro-compatible porque todos los nuevos params tienen `DEFAULT`. El
  frontend no necesita cambios — el service ya construía args correctos.
- **Verificación e2e** (vía DO block en BD con args originales):
  ```sql
  PERFORM public.registrar_cobranza_comprobante(<7 args sin partner>);
  -- Antes: ERROR "Could not choose the best candidate function".
  -- Después: ERROR "Solo gerencia/operacion puede registrar cobranzas"
  --   (porque service_role no es staff — esperado; no es de ambigüedad).
  ```
  Confirma que el resolver eligió la única firma disponible y entró al
  cuerpo de la función. ✓
- **Prevención:**
  - **R16 (nueva, propuesta para CLAUDE.md)**: "Cuando una migración
    EXTIENDE una RPC pública agregando un nuevo parámetro (incluso con
    `DEFAULT`), hacer **`DROP FUNCTION ... ; CREATE FUNCTION ...`** en
    vez de `CREATE OR REPLACE FUNCTION` solo. `CREATE OR REPLACE` no
    sobrescribe la firma vieja cuando cambia la cantidad de parámetros
    — crea un overload paralelo que rompe el resolver de PostgREST. La
    única forma segura es DROP previo (con `IF EXISTS` para idempotencia)."
  - **Smoke check de cierre de chunk SQL**: después de cada mig que crea
    o modifica una RPC pública, correr la query de overloads ambiguos
    arriba — `HAVING count(*) > 1` debe dar 0. Si da > 0, DROP el viejo
    antes de cerrar el chunk.
- **Fecha / módulo:** 2026-06-02 · facturación/cobranza · migración 0173.

## E-GG-36 · Trigger `_notif_cobranza_recibida_trg` fallaba cuando comprobante_id IS NULL
- **Síntoma:** SMOKE 2 e2e (insertar movimiento ingreso/facturacion sin
  comprobante_id) falló con:
  ```
  ERROR: 55000: record "v_comp" is not assigned yet
  CONTEXT: PL/pgSQL function _notif_cobranza_recibida_trg() line 22
  ```
  Sin el smoke test, el bug habría llegado a producción y roto la PRIMERA
  cobranza registrada sin comprobante vinculado.
- **Causa raíz:** mig 0170 (DGG-33) introdujo el trigger declarando
  `v_comp record` y populando vía `SELECT INTO v_comp ... WHERE c.id =
  NEW.comprobante_id`. Si NEW.comprobante_id IS NULL, el SELECT no se
  ejecuta y v_comp queda sin asignar. Después referenciar `v_comp.numero`
  hace que plpgsql tire 55000 porque el tipo de tupla no está determinado
  para un `record` no asignado.
- **Fix (`apply_migration audit_d_fix_cobranza_trigger`):** reemplazar la
  variable `v_comp record` por tres escalares (`v_comp_tipo text`,
  `v_comp_numero bigint`, `v_comp_punto int`) que arrancan en NULL por
  default y se populan condicionalmente. Postgres trata NULL como valor
  válido, no tira 55000.
- **Verificación:** SMOKE 2 retry inmediato post-hotfix: insert sin
  comprobante_id → trigger dispara `notify_all_gerentes('cobranza_recibida',
  ...)` → 2 in-app + 2 emails + 1 push (los 2 gerentes, push sólo en quien
  tiene subs). ✓
- **Prevención:**
  - Para variables que se populan dentro de un `IF`, **siempre** usar
    escalares con default NULL en vez de `record` sin asignar. El `record`
    funciona sólo si SIEMPRE se asigna ANTES del primer uso.
  - **Regla operativa nueva**: todo trigger introducido en un chunk debe
    pasar smoke test e2e CON Y SIN parámetros opcionales (NULL en cada
    FK opcional) antes de cerrar el chunk. Habría detectado este bug en
    el chunk DGG-33 antes de pushear, no en el DEEP siguiente.
- **Fecha / módulo:** 2026-06-02 · trigger cobranza · mig 0170 (fix
  in-place vía apply_migration).

## E-GG-35 · Columna "Asignado" sin UI accesible + anti-patrón fan-out por `asignado_a`
- **Síntoma:** en `/gerencia/tramites` la columna "Asignado" mostraba
  "Sin asignar" casi siempre. El usuario preguntó "¿dónde se asigna?" y al
  investigar descubrimos dos cosas:
  1. El selector `<Select>` para setear `asignado_a` vivía en
     `src/modules/tramites/pages/TramiteDetailPage.tsx:333-345` (legacy).
     Esa ruta se redirige a `/gerencia/trackings/:id` desde E-GG-01, y el
     `TrackingDetailPage` nuevo **no tiene el selector** → la columna
     se renderea pero no hay UI alcanzable para mutarla.
  2. En paralelo, varios triggers (mig 0090, 0098, **0105 vigente**) tenían
     el anti-patrón:
     ```
     IF v_asignado_a IS NOT NULL THEN
       notif_emitir(v_asignado_a, ...);   -- sólo a la persona asignada
     ELSE
       notif_emitir_staff(...);            -- fan-out al staff
     END IF;
     ```
     Resultado: si el trámite tenía `asignado_a` poblado, **los otros
     gerentes nunca se enteraban** de movimientos del cliente. Si el
     asignado estaba de licencia → caso huérfano silencioso.
- **Causa raíz:**
  - (i) Regresión de E-GG-01: la unificación legacy `/gerencia/tramites/:id` →
    `/gerencia/trackings/:id` migró todo (cierre de ciclo, alarmas,
    recurrencia) pero **no migró el control de asignación**. Quedó
    huérfano hace ~7 meses.
  - (ii) El anti-patrón notif fue introducido en migs 0090/0098 antes
    de tomar la decisión de "todos ven todo" (DGG-33). Quedó replicado
    por copy-paste cuando 0105 reescribió la función.
  - (iii) La auditoría doble ("auditar a fondo" §6 CLAUDE.md) detecta gaps
    DENTRO del chunk auditado, no regresiones viejas en módulos no
    tocados. No tenía un check de paridad "columna grilla ↔ control
    edición" transversal.
- **Fix:**
  1. Decisión arquitectónica DGG-33: no hay asignaciones individuales.
  2. Mig `0170_notify_all_gerentes_y_fanout.sql`:
     - Helper `public.notify_all_gerentes(...)` (3 canales unificados).
     - Reescritura de `tracking_linea_on_insert` quitando el
       `IF v_asignado_a` y usando el helper (suma email).
     - Migración de `_notif_tracking_cerrado_trg` y
       `dispatch_alarmas_tracking_hoy` al helper.
     - Trigger nuevo sobre `movimientos` (cobranza recibida).
  3. Frontend: removidos columna "Asignado", KPI "Sin asignar",
     parámetros de filtro/insert/update, sidebar del legacy.
  4. Campo `tramites.asignado_a` se mantiene en BD por compatibilidad
     histórica (datos pre-decisión + import de Excel viejo).
- **Verificación e2e** (en producción, mig aplicada):
  | Test | Resultado esperado | Real |
  |---|---|---|
  | `SELECT notify_all_gerentes('_test', ...)` | int = count gerentes activos | 2 ✓ |
  | Inserciones en notificaciones_internas | 2 | 2 ✓ |
  | Inserciones en email_queue | 2 | 2 ✓ |
  | Inserciones en push_notifications_queue | 1 (sólo gerente con subs) | 1 ✓ |
  | `pg_get_functiondef(tracking_linea_on_insert)` contiene `v_asignado_a IS NOT NULL` | false | false ✓ |
  | Trigger `trg_notif_cobranza_recibida` enabled | 'O' (enabled) | 'O' ✓ |
- **Prevención:**
  - Auditoría UI-coverage transversal (ASIG-A) corrida para detectar
    todos los gaps "columna visible sin control editable" en gerencia.
    Resultado: la columna "Asignado" era el caso más visible; otros
    gaps menores quedan en BACKLOG.
  - **Regla candidata para CLAUDE.md** (a discutir con el usuario): "toda
    columna persistida visible en grilla debe tener al menos una de:
    editor en el detail ruteado, control en form drawer, quick-edit
    inline, o tag AUTO documentado (trigger/derivada). Si ninguna aplica,
    es deuda y se documenta como GAP en ERRORES.md."
  - **Regla candidata para CLAUDE.md**: "cuando se redirige una ruta
    legacy a una página nueva, hacer diff de campos editables entre
    las dos páginas; cualquier control presente en la legacy y ausente
    en la nueva = E## obligatorio (habría detectado E-GG-01 → este
    E-GG-35)."
- **Fecha / módulo:** 2026-06-02 · trámites / notif · mig 0170, DGG-33,
  ASIG-A/B/C.

## E-GG-34 · Páginas se abrían "desde abajo" (body como scroll container fantasma)
- **Síntoma:** José Luis (y luego el dueño) reporta: "entrá a la landing,
  bajá hasta el medio, clickeá cualquier card (Plataforma, Capacitaciones,
  DDJJ) — la página de destino se abre desde abajo, con el header fuera
  de vista". El usuario lo dijo dos veces, la segunda con malestar:
  "Arreglalo de una puta vez". Un primer intento de fix (commit f030304,
  removió `height: 100%` de `#root`) NO solucionó el problema y se
  vió igual al re-testearlo.
- **Causa raíz:** la CSS base de `src/index.css` tenía un grupo conjunto:
  ```
  html, body { height: 100%; overflow-x: hidden; max-width: 100vw; }
  ```
  Esa combinación en BODY tiene un efecto que no es obvio: como `overflow-x`
  está explícitamente seteado, el browser deriva `overflow-y: auto` en body
  por CSS Overflow spec. Pero body además está clipeado a `height: 100%`
  del html (= la altura del viewport, ~725px), mientras que su CONTENIDO
  (toda la landing, ~7800px) es mucho más alto. Resultado: body se vuelve
  SU PROPIO scroll-viewport, encima del html. El usuario ve y scrollea body,
  pero `window.scrollY` SIEMPRE devuelve 0 porque el html nunca se mueve.
  Cuando React Router cambia de ruta, nuestro `ScrollToTopOnRouteChange`
  llama `window.scrollTo({ top: 0 })` — que opera sobre el html (el
  scrolling element según el spec) — pero el scroll real vive en body, así
  que no resetea nada. La página nueva monta con body.scrollTop = el del
  body anterior (porque body persiste a través de SPA navigations),
  rindiendo "abierta desde abajo".
- **Por qué el primer intento (remover height de #root) NO alcanzó:**
  removí el height:100% de `#root` pensando que #root era el scroll
  container fantasma. Pero el problema en realidad estaba un nivel más
  arriba: era body, no #root. #root con `min-height: 100%` ya era inocuo,
  body seguía siendo el viewport fantasma.
- **Cómo lo encontré (método):** abrí la URL de Vercel en Chrome MCP y
  corrí en consola:
  ```js
  console.log({
    canScroll_html: html.scrollHeight > html.clientHeight,  // false
    canScroll_body: body.scrollHeight > body.clientHeight,  // true ← !
    windowScrollY: window.scrollY,                          // 0
    scrollingEl: document.scrollingElement.tagName          // 'HTML'
  })
  ```
  El hecho de que html NO pudiera scrollear y body SÍ fue el smoking gun.
  El sesgo a confiar en `document.scrollingElement` (que dice "HTML") sin
  comprobar **qué elemento realmente tiene contenido overflowable** me
  costó un push intermedio que no resolvía el bug.
- **Fix:** body ahora usa `min-height: 100%` en vez de `height: 100%`. Body
  crece con su contenido, no queda clipeado al viewport, no genera su
  propio scroll-viewport. Html sigue con `height: 100%` (+ `overflow-x:
  hidden`) — eso lo deja como el viewport scroll container, y
  `window.scrollY` / `window.scrollTo` operan sobre html, como esperamos.
  - `index.css`: regla separada para html (height fijo) y body
    (min-height), con bloque de comentarios explicando por qué la asimetría
    no es opcional.
  - `#root` ya estaba con `min-height` (f030304); se mantiene.
- **Verificación en producción** (Chrome MCP en `gestionglobal.ar`, post
  commit 966b4af):
  | Acción del usuario | Antes | Después |
  |---|---|---|
  | window.scrollTo(0, 2500) | scrollY=0 | scrollY=2500 ✓ |
  | Click "Plataforma" en card medio | aterriza scrollY=N | scrollY=0 ✓ |
  | Click "Capacitaciones" | aterriza scrollY=N | scrollY=0 ✓ |
  | Click "Declaraciones juradas" | aterriza scrollY=N | scrollY=0 ✓ |
- **Prevención:**
  - **Nunca confiar solo en `document.scrollingElement` para diagnosticar
    bugs de scroll**: medir explícitamente cuál elemento tiene
    `scrollHeight > clientHeight`. El elemento que tiene overflow es el
    scroll container real, independientemente de lo que el spec diga sobre
    cuál es el "scrollingElement".
  - **Setear `overflow-x: hidden` en body sin pensar en height** convierte
    al body en un scroll-viewport latente. Si vas a usar overflow-x:hidden
    en body por iOS PWA u otra razón, body NUNCA debe tener height fijo
    igual al viewport — siempre `min-height` para que crezca con su
    contenido.
  - Comment block en `index.css` con la explicación, para que la próxima
    persona que toque ese archivo entienda por qué la asimetría html/body
    importa.
- **Fecha / módulo:** 2026-06-02 · `src/index.css` (commit 966b4af —
  fix definitivo) + commit previo f030304 (parcial).

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

## E-GG-02 · Detalle de solicitud roto: `getSolicitud` con nombres de columna inventados
- **Síntoma:** abrir cualquier solicitud (`/gerencia/solicitudes/:id`)
  mostraba toast rojo `column formulario_submissions_1.payload does not exist`
  y pantalla "Solicitud no encontrada". El detalle de solicitudes quedó
  **100% inutilizable** en producción. `npm run build` y `tsc --noEmit`
  pasaban limpios — el error es de runtime SQL (PostgREST), invisible para
  el compilador. **Sólo se detectó con browser test en vivo** (validación
  del método obligatorio del usuario).
- **Causa raíz:** la propuesta 1.C (payload con labels legibles) reescribió
  `getSolicitud` en `src/services/api/solicitudes.ts` asumiendo nombres de
  columna que NO existen: (a) `formulario_submissions.payload` — la columna
  real es `datos`; (b) `formulario_adjuntos.campo` / `.nombre_original` —
  reales son `field_name` / `filename_original`; (c) usaba
  `storage.getPublicUrl()` sobre el bucket `form-adjuntos` que es **privado**
  (`public=false`), lo que devuelve URLs que dan 403. El agente no verificó
  el schema real antes de escribir el query (violación de regla 8 / E43).
- **Fix:** corregí los tres: `payload`→`datos` (select, tipo TS y mapeo),
  `campo`/`nombre_original`→`field_name`/`filename_original`, y
  `getPublicUrl`→`createSignedUrl(path, 3600)` con `Promise.all` (es async).
- **Prevención:** **regla 8 / E43 es obligatoria también para los agentes**:
  antes de escribir un query/RPC sobre una tabla existente, correr
  `SELECT column_name FROM information_schema.columns WHERE table_name='...'`.
  Y — central — **todo cambio de UI/datos debe browser-testearse en vivo**:
  el build verde NO garantiza que la pantalla funcione (método obligatorio
  2026-05-21).
- **Fecha / módulo:** 2026-05-21 · solicitudes (detalle) · descubierto en
  recorrido de verificación post-Punto 5.

## E-GG-03 · `ProgramarVencimientoModal.tsx` desaparecido del filesystem
- **Síntoma:** `tsc --noEmit` fallaba con `Cannot find module
  './components/ProgramarVencimientoModal'` aunque el archivo estaba
  commiteado (b5a824b). Causó builds transitorios rotos intermitentes.
- **Causa raíz:** el archivo fue borrado del working tree (probable sync de
  Finder / iCloud o limpieza de duplicados macOS "* 2.tsx"). git lo marcaba
  como `D`. El repo remoto sí lo tenía.
- **Fix:** `git checkout HEAD -- src/modules/trackings/components/ProgramarVencimientoModal.tsx`.
- **Prevención:** vigilar archivos `D` en `git status` antes de cada build;
  los duplicados "* 2.tsx" de Finder/iCloud son una fuente recurrente de
  ruido (ya removidos `App 2.tsx`, `database 2.ts`, `ToastViewport 2.tsx`).
  Evaluar `.gitignore` para `* 2.*` y desactivar sync de iCloud en la carpeta
  del proyecto.
- **Fecha / módulo:** 2026-05-21 · trackings · infraestructura local.

## E-GG-04 · Detalle de tracking roto: embed self-referencial de PostgREST + schema cache stale
- **Síntoma:** activar una solicitud (wizard) creaba el cliente y el tracking
  OK (toast verde "¡Solicitud activada!"), pero el redirect a
  `/gerencia/trackings/:id` tiraba toast rojo `Could not find a relationship
  between 'tramites' and 'tramites' in the schema cache` y rebotaba al
  listado `/gerencia/tramites`. El detalle de cualquier tracking quedaba
  inaccesible. Invisible para tsc/build (runtime PostgREST). Detectado en
  browser test en vivo.
- **Causa raíz:** `getTracking` embebía el tracking padre con un self-join
  PostgREST: `parent:tramites!tramites_parent_tracking_id_fkey(...)`. El FK
  existe en la BD, pero PostgREST resuelve relaciones vía un **schema cache**
  que quedó stale tras crearse el FK por migración → no "ve" la relación.
  `NOTIFY pgrst, 'reload schema'` no surtió efecto inmediato (pooler Supabase).
- **Fix:** eliminé el embed self-referencial; el parent se trae con una
  **query separada** (`select id,periodo,estado where id=parent_tracking_id`)
  sólo si `parent_tracking_id` no es null. Robusto e independiente del cache.
- **Prevención:** **evitar embeds self-referenciales de PostgREST** (mismo
  tabla → misma tabla); son frágiles ante cambios de schema. Para relaciones
  recursivas (parent/continuación), preferir query separada. Si se usa embed,
  recordar que el cache puede quedar stale tras DDL.
- **Bonus detectado:** `TrackingDetailPage.load()` ante error hace
  `navigate('/gerencia/tramites')` (listado legacy) en vez de mostrar el error
  in-place — enmascara fallos. Queda como mejora UX de baja prioridad.
- **Fecha / módulo:** 2026-05-22 · trackings (detalle) · descubierto en QA
  del Flujo Maestro (wizard de activación).

## E-GG-05 · generar_acceso_externo: "function gen_random_bytes(integer) does not exist"
- **Síntoma:** "Compartir externo" (tracking) y toda generación de acceso
  externo fallaban con toast rojo `function gen_random_bytes(integer) does
  not exist`. El token nunca se generaba.
- **Causa raíz:** pgcrypto está instalada en el schema `extensions` (default
  de Supabase), pero el RPC `generar_acceso_externo` tenía `SET search_path
  TO 'public','pg_temp'` y llamaba `gen_random_bytes(32)` sin calificar →
  no la encontraba.
- **Fix (mig 0043):** `encode(extensions.gen_random_bytes(32),'hex')` +
  `search_path TO 'public','extensions','pg_temp'`. Validado en vivo: el
  acceso se genera y copia OK.
- **Prevención:** cualquier RPC `SECURITY DEFINER` que use funciones de
  extensiones (pgcrypto, etc.) debe schema-calificarlas o incluir
  `extensions` en el search_path. Revisar otros RPCs que usen pgcrypto.
- **Fecha / módulo:** 2026-05-22 · acceso externo · descubierto en QA.

## E-GG-06 · Acceso externo público mostraba "Sin datos disponibles"
- **Síntoma:** `/externo/:token` cargaba el shell (hero, saludo, expiración,
  footer) pero el bloque DETALLE decía "Sin datos disponibles". No se veían
  las tarjetas 5.A (agregar al calendario) ni 5.E (última actualización).
  5.C (registro de apertura) SÍ funcionaba. (5.B contacto responsable no se
  mostraba porque el tracking de prueba tiene responsable_id NULL — eso es
  falta de dato, no bug.)
- **Causa raíz:** el edge function `acceso-externo` seleccionaba de `tramites`
  las columnas `fecha_solicitud` y `fecha_estimada` que **no existen** (las
  reales: `vence_at`, `fecha_inicio`, `fecha_fin`, `periodo`). PostgREST
  devolvía error → `data=null` → `recurso=null` → "Sin datos". El branch
  `solicitud` tenía el mismo problema con `formulario_slug` (real:
  `formulario_id`; el slug vive en `formularios`).
- **Fix (edge v3):** columnas reales en el select de tramites; en el branch
  solicitud, embed `formularios:formulario_id(slug,titulo)`. Validado vía
  curl: el edge devuelve `recurso` con datos completos.
- **Prevención:** mismo aprendizaje que E-GG-02 — verificar
  `information_schema.columns` antes de escribir queries; el browser/curl test
  detecta lo que tsc no ve. Las edge functions Deno NO pasan por tsc del
  proyecto → testear siempre su respuesta real.
- **Bug menor relacionado (anotado, no crítico):** el wizard de activación NO
  guarda el `periodo` ni `fecha_inicio` en el tracking creado (quedan NULL
  pese a cargarse 2026 / fecha en el paso 3). Revisar `solicitud_activar`.
- **Fecha / módulo:** 2026-05-22 · acceso externo (edge function) · QA.

## E-GG-07 · Sesión se cae cada ~1h (sin refresh de token)
- **Síntoma:** durante el QA la sesión se caía repetidamente al navegar (parecía
  asociado a volver de `/externo`, pero era coincidencia temporal). El usuario
  quedaba deslogueado y había que reingresar.
- **Causa raíz:** el cliente Supabase usa `autoRefreshToken: false` y
  `persistSession: false` (a propósito: los locks de supabase-js cuelgan las
  queries bajo StrictMode/HMR). Pero NO había refresh manual → el access token
  vencía (~1h) y `readStoredSession` borraba la sesión por `expires_at` pasado,
  descartando también el refresh_token (que dura ~30 días).
- **Fix:** (a) `readStoredSession` ya NO descarta la sesión por access token
  vencido si hay refresh_token (sólo si falta el refresh_token). (b)
  `AuthContext` ahora tiene un **scheduler de refresh manual**: refresca con
  `supabase.auth.refreshSession({refresh_token})` ~60s antes del vencimiento y
  reprograma; en el bootstrap, si el token ya venció, refresca antes de seguir.
- **Prevención:** cuando se desactiva `autoRefreshToken`, hay que implementar
  refresh manual sí o sí. No descartar el refresh_token al vencer el access.
- **Fecha / módulo:** 2026-05-22 · auth (AuthContext + lib/supabase) · QA.

## E-GG-08 · React #310 en CursoEditorPage (hook tras early return)
- **Síntoma:** abrir el editor de un curso (`/gerencia/campus/:id`) daba
  **pantalla blanca total**. Consola: `Minified React error #310` (rendered
  more hooks than during the previous render).
- **Causa raíz:** Campus Fase 1 agregó `const [activeKey] = useState('datos')`
  DESPUÉS del early return de loading (`if (loading || !data) return <Loader/>`).
  En el primer render (loading=true) ese hook nunca se llamaba; en el segundo
  (cargado) sí → cambia la cantidad de hooks entre renders.
- **Fix:** mover el `useState` de `activeKey` arriba, junto a los demás hooks,
  antes de cualquier early return.
- **Prevención:** **TODOS los hooks van antes de cualquier return condicional**
  (regla de hooks de React). Al agregar estado a un componente que ya tiene un
  guard de loading, ponerlo arriba. El build/tsc NO detecta esto → sólo se ve
  en runtime (browser test obligatorio).
- **Fecha / módulo:** 2026-05-22 · campus (CursoEditorPage) · Fase 1 · QA.

## E-GG-09 · CORS preflight OPTIONS daba 500 con verify_jwt=true (edge fns)
- **Síntoma:** primer click en "Crear sala Zoom" devolvía toast rojo
  "Failed to send a request to the Edge Function". Logs Supabase mostraban
  `OPTIONS | 500 | zoom-meeting-create`. El POST nunca llegaba.
- **Causa raíz:** con `verify_jwt=true` el runtime de Supabase intercepta la
  request antes de la función y rechaza si no hay Authorization. El navegador
  hace **preflight CORS** con OPTIONS SIN Authorization (es estándar) →
  rechazado con 500 → el POST real nunca se manda.
- **Fix:** `verify_jwt=false` a nivel runtime; la función valida adentro
  leyendo `Authorization: Bearer ...` + `getUser()`. Aplicar a TODA edge
  function llamada desde el navegador (que necesite CORS preflight).
- **Prevención:** edge functions llamadas desde el browser → `verify_jwt=false`
  + handler propio (lee Bearer + getUser). Solo dejar `verify_jwt=true` en
  funciones llamadas server-to-server (cron / webhooks).
- **Fecha / módulo:** 2026-05-22 · campus Fase 3 · Zoom edge fns.

## E-GG-10 · profiles.rol no existe (columna real `role`); profiles no tiene `email`
- **Síntoma:** la edge fn retornaba 403 `only_staff` aún con gerente logueado.
- **Causa raíz:** asumí `prof.rol` (en español, como otras tablas E43) pero la
  columna real es `role`. Además `email` no vive en profiles sino en
  `auth.users`. SELECT devolvía undefined → check fallaba.
- **Fix:** SELECT `role` y leer `email` desde `ures.user.email` (el getUser
  resultado).
- **Prevención:** **regla 8 / E43**: antes de SELECT en tabla pre-existente,
  consultar `information_schema.columns` para confirmar nombres reales. La
  convención inglés/español es híbrida.
- **Fecha / módulo:** 2026-05-22 · campus Fase 3 · zoom edge fns.

## E-GG-11 · POST /v2/users/{gerente_email}/meetings → 404 (no es usuario Zoom)
- **Síntoma:** la edge fn devolvía 502 `zoom_create_failed` aún con creds S2S
  válidas. Test directo con curl creaba la reunión sin problema.
- **Causa raíz:** la edge fn usaba el email del **gerente del CRM**
  (`pabloeacu@gmail.com`) como host de Zoom. Pero ese email NO es un usuario
  Zoom en la cuenta — el owner real es `contacto@gestionglobal.ar`. Zoom
  rechaza con 404 user_does_not_exist.
- **Fix:** default `hostEmail = "me"` = owner del S2S app. Solo aceptar email
  custom si viene en `body.host_email` y la cuenta tiene un usuario Zoom con
  ese email.
- **Prevención:** **gerentes del CRM ≠ usuarios Zoom**. Para crear meetings
  hostear siempre en `me` (la cuenta primaria) salvo plan multi-user con
  hosts adicionales y mapeo explícito de emails.
- **Fecha / módulo:** 2026-05-22 · campus Fase 3 · zoom-meeting-create.

## E-GG-12 · @zoom/meetingsdk v6 ya no acepta `sdkKey` en joinOptions
- **Síntoma:** al clickear "Conectar a la sala", el viewport del SDK se montaba
  pero aparecía un toast rojo "Error de conexión".
- **Causa raíz:** `client.join({sdkKey, ...})`. Desde v4.0.0 del SDK web, el
  sdkKey vive sólo dentro del JWT firmado (signature), NO en los joinOptions.
  Si lo pasás, el SDK warna ("removed since v4.0.0") y `join()` puede tirar
  error como falso positivo.
- **Fix:** quitar `sdkKey` del objeto pasado a `client.join()`. Mantenerlo
  dentro del payload del JWT que firma el edge fn.
- **Prevención:** verificar la API del SDK al actualizar mayor versión. Los
  warnings de la consola hablan en serio.
- **Fecha / módulo:** 2026-05-23 · campus Fase 3 · ZoomLiveEmbed.

## E-GG-13 · "Meeting not started" no es error, es sala de espera
- **Síntoma:** mismo toast rojo cuando el host (gerencia) todavía no inició la
  reunión. El viewport igual mostraba "La reunión no ha comenzado".
- **Causa raíz:** con `join_before_host: false` en la creación de la sala
  Zoom (correcto para evitar gente entrando antes), Zoom rechaza el `join()`
  con `errorCode 3008` (MEETING_NOT_STARTED). Mi catch genérico trató eso
  como "error fatal" → toast rojo, aunque la conexión funcionó OK y el
  alumno está en la sala de espera.
- **Fix:** detectar errorCode 3008 o regex `not.?started|waiting.?for.?host`
  en el catch y setear `state='ready'` sin mostrar error.
- **Prevención:** los SDKs de videoconf modelan "esperando al host" como
  estado normal, no error. Siempre interpretar errorCodes antes de mostrar
  UI de fallo.
- **Fecha / módulo:** 2026-05-23 · campus Fase 3 · ZoomLiveEmbed.

## E-GG-14 · Embed Zoom se desmontaba al admitir alumno (refresh fantasma del campus)
- **Síntoma reportado por el usuario:** "cuando se admite al alumno, la página
  del campus se refresca y sale de la sección. Al volver a entrar se produce
  una solicitud de admisión doble. El ingreso nunca configura cámara ni audio."
- **Causa raíz:** `CursoDetalleAlumnoPage.reload()` llamaba `setLoading(true)`
  en CADA refetch (carga inicial, realtime, cambios del objeto `user`). El
  `useEffect` dependía de `[reload]` que dependía de `[slug, user]`. Cualquier
  cambio en el objeto `user` (token refresh, onAuthStateChange) cambiaba la
  referencia → useEffect re-firaba → `setLoading(true)` → el componente caía
  a `<Skeleton>` → el `<ZoomLiveEmbed>` se DESMONTABA → su cleanup invocaba
  `leaveMeeting()` mientras el alumno estaba siendo admitido → al volver
  `loading` a `false`, el embed re-montaba y disparaba `client.join()` OTRA
  VEZ → Zoom interpretaba como **segunda solicitud de admisión**.
- **Fix:** separar `initialLoading` (única que muestra Skeleton) de los
  refreshes silenciosos. `reload({silent:true})` no toca loading. Deps de
  reload pasaron a `userId` (string) en lugar del objeto `user`. `userName`
  memoizado por `[fullName, email]` para referencia estable hacia el embed.
- **Verificación e2e (browser test real con dos sesiones simultáneas):**
  - Host (Pablo) en su propio Chrome con cámara y mic activos.
  - Alumno (Sol y Luna) en Chrome MCP con embed inline.
  - Admit por host → alumno NO se desmontó, NO hubo doble admisión, recibió
    video del host (chroma confirmado).
  - BD: 1 evento `join` con customer_key=matricula_id correcto, asistencia
    fuente=zoom_auto acumulando tiempo_conectado_seg.
- **Prevención:** **NUNCA mostrar Skeleton en refreshes silenciosos**. Toda
  página con componentes "live" (Zoom, iframes externos, WebRTC) debe
  separar el estado de carga inicial del de refreshes para que el árbol no
  se desmonte. Las dependencias de useCallback deben ser strings estables
  (`userId`, no `user`).
- **Fecha / módulo:** 2026-05-23 · campus Fase 3 · CursoDetalleAlumnoPage.

## E-GG-15 · Webex embebido imposible en Free plan (3 caminos, 3 bloqueos)
- **Síntoma:** tras armar scaffolding completo de Webex (mig 0048+0049 + 2
  edge fns + `WebexLiveEmbed` + selector + modal), al intentar configurar las
  credenciales me encontré con que ninguno de los tres caminos a guest tokens
  funciona con el plan Free recién creado:
  1. **Guest Issuer JWT** (camino "clásico" pre-2025): el form para crear
     nuevos Guest Issuer ya no existe en developer.webex.com. La doc de
     `/docs/guest-issuer` lo confirma: *"The Guest Issuer application type
     has been removed. New Guest Issuer applications can no longer be
     created."* Camino MUERTO en cualquier plan.
  2. **Service App Guest Management** (reemplazo oficial): el form de
     creación funciona, pero la doc `/docs/sa-guest-management` aclara:
     *"Only paid Webex subscribers may create guests."* y *"This Service App
     must be approved by an admin in Control Hub."* Requiere plan pagado +
     admin approval — dos bloqueos.
  3. **Instant Connect (G2G WebRTC)** (alternativa moderna sin email): la
     doc `/help.webex.com/.../Webex-Instant-Connect` dice: *"The G2G site is
     accessible upon subscription/license activation."* También paid.
- **Causa raíz:** Cisco monetiza el "embed con guests" como feature
  enterprise. El plan Free permite usar Webex como anfitrión/participante
  con cuenta propia, pero NO emitir tokens para que terceros sin cuenta
  joinen embebidos en una app propia. Esto contradice la promesa pública
  de "@webex/widgets gratis para integrar" — el widget en sí es OSS pero
  necesita un accessToken válido emitido por alguno de los 3 mecanismos
  (todos paid hoy).
- **Decisión:** ver **DGG-19**. Zoom queda como solución productiva (link
  externo + asistencia automática por webhooks); Webex queda 100%
  scaffoldeado (BD + edge fns + componentes + UI) con el radio del selector
  deshabilitado y badge "Plan pagado". El día que el usuario suba al plan
  pagado, la activación es: 3 secrets en Supabase + quitar `disabled` del
  radio → embedded Webex operativo.
- **Lección:** **investigar el modelo de monetización del SDK ANTES de
  escribir scaffolding pesado.** El widget gratis no implica que el flujo
  de auth sea gratis. Si una integración requiere "guest tokens", chequear
  el pricing page específico (no la doc del SDK) antes de la 2da hora.
  Habría ahorrado varios commits si lo hubiese verificado primero.
- **Fecha / módulo:** 2026-05-24 · campus Fase 3 · Webex investigation.

## E-GG-16 · gen_random_bytes() en RPCs SD de Webinars (regresión de E-GG-05)
- **Síntoma:** `inscribir_a_webinar()` fallaba con `ERROR: 42883: function gen_random_bytes(integer) does not exist`.
- **Causa raíz:** mismo patrón que E-GG-05 (mig 0043 lo fixeó para `generar_acceso_externo`): pgcrypto vive en schema `extensions`, y las RPCs `SECURITY DEFINER` con `SET search_path = public, pg_temp` NO lo encuentran. Al escribir mig 0050 olvidé el precedente.
- **Fix:** mig 0052 cambia las dos llamadas a `encode(extensions.gen_random_bytes(32), 'hex')` con el schema explícito.
- **Prevención:** **toda RPC SD que use gen_random_bytes/digest/pgp_sym_encrypt/etc. debe usar `extensions.<func>()` explícito** o `SET search_path = public, extensions, pg_temp`. Documentado a nivel del repo. Agregar a la checklist de QA antes de mergear cualquier migración con RPC nueva.
- **Fecha / módulo:** 2026-05-24 · subsistema Webinars · descubierto en test e2e.

## E-GG-17 · React error #310 en WebinarPublicoPage (regresión de E-GG-08)
- **Síntoma:** página pública `/webinar/:token` quedaba en "Cargando webinar…" para siempre. Console: `Minified React error #310` (hook called conditionally).
- **Causa raíz:** mismo patrón que E-GG-08 (CursoEditorPage). El hook custom `useCountdown()` (interno: useState + useEffect) se llamaba DESPUÉS de los early returns `if (state === 'loading') return ...` y `if (state === 'error') return ...`. Cuando state cambiaba `loading` → `ok`, el orden de hooks cambiaba → React lanzaba error #310 → componente quedaba colgado en el último render exitoso (= loading).
- **Fix:** mover `useCountdown(resp?.webinar?.fecha_hora ?? new Date().toISOString())` ANTES de los early returns. El hook se llama siempre con un valor seguro fallback; el resultado solo se usa cuando el webinar es futuro.
- **Prevención:** **TODOS los hooks se llaman ANTES de cualquier `return`**, incluso los condicionales de "loading" o "error". Esto incluye hooks custom como `useCountdown`. Patrón verificable: si tu componente tiene `useState` (o cualquier hook) DESPUÉS de un `return ...;`, está roto. Regla a internalizar (Rules of Hooks de React).
- **Fecha / módulo:** 2026-05-24 · subsistema Webinars · WebinarPublicoPage.

## E-GG-18 · Webinars · link sin protocolo + fecha en inglés
- **Síntoma:** al inspeccionar `email_queue.variables` post-inscripción, el `link_acceso` salía como `gestionglobal.ar/webinar/xxxx` (sin `https://`) y la `fecha_humana` como `"Tuesday 26 de May"` (mezcla EN/ES).
- **Causa raíz 1:** `config_global.sitio_web` está guardado como `gestionglobal.ar` sin protocolo. La RPC `private.webinar_email_vars` lo usaba como `v_base_url || '/webinar/' || p_token` → URL sin protocolo no clickeable en cliente de email.
- **Causa raíz 2:** `to_char(... 'TMDay DD "de" TMMonth')` usa el locale del servidor. En Supabase ese locale es `en_US`, no `es_AR` → "Tuesday" en lugar de "Martes".
- **Fix:** mig 0053 fuerza `https://` si el sitio_web no incluye protocolo. mig 0054 reemplaza el TMDay/TMMonth por arrays explícitos ES (`['domingo','lunes',...]`, `['enero','febrero',...]`).
- **Prevención:** **nunca depender del locale del servidor para output en español**. Usar arrays explícitos o helpers JS en frontend. Y **siempre validar URLs construidas en SQL** asegurando protocolo + slash sanitization.
- **Fecha / módulo:** 2026-05-24 · subsistema Webinars · webinar_email_vars.

## E-GG-19 · Finanzas · KPIs inflados por movimientos de reversión
- **Síntoma:** Al revertir un egreso de $15.000, el KPI "Ingresos del mes"
  saltó de $180.000 a $195.000. Conceptualmente incorrecto: la reversión
  de un egreso no es un ingreso nuevo, es una corrección.
- **Causa raíz:** La RPC `fz_dashboard_kpis` sumaba TODOS los movs tipo
  ingreso/egreso del mes con `revertido_at IS NULL`, pero NO filtraba por
  `origen <> 'reversion'`. Los contrasientos generados por
  `fz_revertir_movimiento` (que tienen origen='reversion') sumaban a sus
  totales correspondientes.
- **Fix (mig 0056):** agregar `AND origen <> 'reversion'` a los dos SUM.
  El `saldo_total` se mantiene tal cual (viene de cajas_con_saldo que sí
  debe considerar reversiones para el saldo real).
- **Prevención:** **toda función de KPI / agregación temporal en finanzas
  debe filtrar explícitamente movimientos de reversion** (y eventualmente
  de transferencias internas si se reporta por administración). El "saldo"
  y los "totales operativos del mes" son métricas conceptualmente distintas.
- **Fecha / módulo:** 2026-05-24 · Finanzas Bloque 1 · fz_dashboard_kpis.

## E-GG-20 · Finanzas · cajas linkeaban a ruta inexistente
- **Síntoma:** Click en cualquier card de caja del dashboard llevaba a
  `/gerencia` (Inicio) en vez de a un detalle. Fallback de React Router
  silencioso.
- **Causa raíz:** Las cards eran `<Link to={`/gerencia/finanzas/cajas/${id}`}>`
  pero esa ruta NO estaba definida en `App.tsx`. React Router no encontraba
  match exacto y caía al `<Route index>` de `/gerencia`.
- **Fix:** En lugar de crear una página detalle separada (mayor scope), las
  cards ahora son `<button onClick={() => setFiltroCaja(id)}>` que filtran
  los movimientos de la tabla inferior. UX más útil: ver los movimientos
  de la caja sin cambiar de página. Indicador visual "Filtrada" + ring
  cyan cuando una caja está seleccionada. Click sobre la caja activa la
  desfiltra (toggle).
- **Prevención:** **toda `<Link to>` que se introduzca debe acompañarse
  por la ruta en `App.tsx` en el mismo commit**. Si la página detalle no
  está lista, no exponer el link. Alternativa común: convertir en filtro
  in-page (menos clicks, mantiene contexto).
- **Fecha / módulo:** 2026-05-24 · Finanzas Bloque 1 · FinanzasDashboardPage.

## E-GG-21 · Finanzas Bloque 3 · `supabase.rpc` pierde `this` al extraerlo
- **Síntoma:** Las RPCs nuevas del Bloque 3 (`fz_listar_cajas_admin`,
  `fz_listar_categorias_admin`, reportes, importador) devolvían silenciosamente
  array vacío. RPC funcionaba perfecto vía curl directo (200 + datos
  correctos), pero desde el front siempre `data=[]`. Sin errores en consola.
  Sin requests al servidor (fetch interceptor mostraba 0 calls).
- **Causa raíz:** En `src/services/api/finanzas-admin.ts` extraje el
  método `rpc` del cliente Supabase para evitar el chequeo estricto de
  type-safety sobre los nombres (porque los types `Database` no fueron
  regenerados aún · token pendiente del usuario):
  ```ts
  const rpc = supabase.rpc as unknown as <T>(...) => ...;
  ```
  Eso desreferencia el método del objeto. Cuando se llama `rpc(name, params)`,
  el `this` es `undefined` y Supabase JS necesita el contexto del cliente
  para construir el builder. Internamente el builder queda incompleto
  (sin URL base ni headers de auth), y la "promise" devuelta resuelve a
  algo silencioso (sin rejection), interpretado por nuestro wrapper como
  data null → `ok([])`.
- **Fix:** Reemplazar la extracción por un wrapper function que llame
  `supabase.rpc(...)` directamente (preserva el this):
  ```ts
  function rpc<T>(name: string, params?: Record<string, unknown>): RpcResult<T> {
    return (supabase.rpc as any)(name, params) as RpcResult<T>;
  }
  ```
- **Prevención:** **Nunca extraer métodos de un cliente con state** —
  perderlos del objeto pierde el `this`. Si necesitás un alias tipado,
  envolvelo en una función. Regla general para clientes JS (Supabase,
  fetch wrappers, etc.).
- **Fecha / módulo:** 2026-05-25 · Finanzas Bloque 3 · finanzas-admin.ts.


## E-GG-22 · Sidebar 15→9 · 2 rutas inválidas en Configuración
- **Síntoma:** Tras el refactor del sidebar (DGG-25), 2 sub-items de
  Configuración llevaban a destinos incorrectos:
  1. "Plantillas email" → `/gerencia/configuracion/emails` → redirect a
     Inicio (la ruta no existía).
  2. "Datos fiscales" → `/gerencia/configuracion` → redirect a /arca
     (no había página específica de datos fiscales).
- **Causa raíz:** El refactor del NAV se hizo sin verificar contra
  `App.tsx` las rutas reales de cada destino. La ruta REAL del template
  email es `/gerencia/configuracion/emails/templates` (con `/templates`);
  y la página de "Datos fiscales" simplemente no existe (config_global
  sin UI dedicada).
- **Fix:** (a) Plantillas email apunta ahora a la ruta correcta.
  (b) Datos fiscales eliminado del menú (no hay página) · queda para
  futuro DGG cuando se construya la UI de config_global.
- **Prevención:** Al definir NAV_GROUPS, validar cada `to` contra el
  router con `npm run dev` o un script automatizado. Idealmente,
  generar el sidebar a partir del router (single source of truth) ·
  hoy es manual.
- **Fecha / módulo:** 2026-05-25 · GerenciaLayout.tsx (DGG-25).


## E-GG-23 · Cortina mostraba flash de landing al cargar
- **Síntoma:** Visitantes anónimos a gestionglobal.ar veían un microflash
  donde aparecía "el sitio debajo de la cortina" antes de que la
  ComingSoonCoverPage se renderizara correctamente.
- **Causa raíz:** En `RoleHomeOrLanding`, el estado inicial del flag
  `coverEnabled` era `null`. Eso forzaba renderizar `BrandLoaderScreen`
  (fondo blanco) entre el primer paint y la respuesta del API
  `getLandingCoverStatus()`. El cambio blanco → gradient oscuro de la
  cortina parecía un "flash de landing" para el ojo del usuario.
- **Fix:** Cambiar default a `true` (optimista: cubierto) + leer de
  `localStorage.gg.cover.enabled` para visitas recurrentes. Primer render
  ya muestra la cortina sin pasar por loader blanco. La API sigue
  consultándose en background y actualiza el cache.
- **Prevención:** Al diseñar gates basados en feature flags remotos,
  cachear el último valor conocido en localStorage y usarlo como default.
  Evita que el primer frame sea inconsistente con el estado real del
  feature. Aplica a cualquier toggle similar (A/B tests, beta gates).
- **Fecha / módulo:** 2026-05-25 · App.tsx RoleHomeOrLanding (DGG-27).


## E-GG-24 · Cortina seguía haciendo flash de landing (continuación E-GG-23)
- **Síntoma:** Tras el fix E-GG-23 el usuario reportó que el flash persistía:
  "Sigo con el flash entre la cortina y la landing".
- **Causa raíz (descubierta al revisar el useEffect):** El gate tenía una
  línea trampa: `if (loading || session) setCoverEnabled(false); return;`.
  Durante `loading=true` ese branch corría y *forzaba* `coverEnabled=false`,
  pisando el default optimista cacheado. Cuando `loading` pasaba a `false`,
  el render era `coverEnabled=false + !user` → `<LandingPage />` durante los
  ~200 ms que tardaba la RPC `get_landing_cover_status()` en responder. Ese
  intervalo era el flash. Además, aunque la cortina ganaba al terminar el
  fetch, antes del fix los visitantes pasaban por `BrandLoaderScreen` blanco
  → cortina oscura, lo que también se percibía como flash.
- **Fix multi-capa (commit ec12de8):**
  1. `useEffect`: si `loading`, retornar sin tocar `coverEnabled`. Solo
     setear a `false` cuando `session` está confirmada. Solo fetchar la
     RPC cuando `loading=false` y `session=null`.
  2. `RoleHomeOrLanding` JSX: para anónimos (`!session`) saltar el
     `BrandLoaderScreen` blanco — ir directo a cortina o landing según
     el `coverEnabled` cacheado. Elimina la transición blanco→oscuro.
  3. `index.html`: splash inline (`<div id="boot-splash">` con gradient
     ink→teal + logo + halo cyan) que cubre el viewport en el **primer
     paint del browser**, antes incluso de que React boot. React, una
     vez listo (`useEffect` con `!loading`), setea `data-app-ready="1"`
     en `<html>` y el splash hace fade-out 220 ms. Si el destino final
     es la cortina, el reemplazo es visualmente idéntico → 0 flash.
  4. Splash se elimina del DOM tras `transitionend` para no interceptar
     nada (aunque tiene `pointer-events: none` igual).
- **Prevención:**
  - **Nunca toques un estado optimista durante `loading`**. Si tenés un
    default sensato y un fetch async, dejá el default visible hasta que
    el fetch responda. Setear a un valor "transitorio" durante loading
    es lo que generó el flash acá.
  - **Para feature gates anti-flash, garantizar el primer paint**.
    `useState` con default + `localStorage.cache` no es suficiente si
    además mostrás un loader intermedio con bg distinto al destino. El
    splash inline en `index.html` es defense-in-depth: cubre el gap
    entre primer paint del browser y la mount de React.
  - QA: testear con localStorage limpio, SW desregistrado, en una pestaña
    de incógnito. Si pasa esos tres, está sólido.
- **Fecha / módulo:** 2026-05-25 · App.tsx + index.html (DGG-27 cierre).

## E-GG-25 · Wizard ARCA · cadena de bugs (Deno crypto + UX + AFIP CAs)

- **Síntoma inicial:** usuario gerente clickea "Generar CSR" en
  `/gerencia/configuracion/emisores` y el toast muestra "Edge Function
  returned a non-2xx status code" (mensaje genérico).
- **Cadena de 5 bugs en cascada** (cada uno apareció después de fixear
  el anterior):

  **E-GG-25.a · `Not implemented: crypto.generateKeyPairSync`**
  - Causa: `forge.pki.rsa.generateKeyPair(2048)` en modo sync invoca
    `crypto.generateKeyPairSync` de `node:crypto`. Esa API NO está
    implementada en Deno → 500.
  - Intento de fix: pasar a la variante callback (async) de forge.
    NO funcionó: la callback también usa `crypto.generateKeyPair`
    (sin Sync) que tampoco está implementada.
  - Fix definitivo: usar **WebCrypto nativo** (`crypto.subtle.generateKey`
    + `exportKey('pkcs8' | 'spki')`) para el par RSA. Dejar forge SÓLO
    para construir el CSR PKCS#10 (parsing ASN.1 puro JS). Helper
    `derToPem()` para convertir el ArrayBuffer a PEM.

  **E-GG-25.b · `Attribute type not specified`**
  - Causa: el código heredado usaba `{ shortName: 'serialName' }` en el
    subject DN del CSR. `serialName` no es un short name reconocido por
    `forge.pki.oids` → forge tira error.
  - Bug latente: nunca había salido a la luz porque siempre fallaba
    antes en la keygen (E-GG-25.a).
  - Fix: cambiar a `{ name: 'serialNumber' }` (OID 2.5.4.5, correcto
    para AFIP).

  **E-GG-25.c · CSR generado pero sin botón Descargar**
  - Causa: tras `handleGenerarCsr`, el wizard hacía `setActiveStep(1)`
    automáticamente. Eso saltaba al Paso 2 (instrucciones AFIP) sin
    dejar al usuario ver los botones Descargar/Copiar del Paso 1.
  - Fix: no auto-avanzar — dejar al usuario en Paso 1 con el CSR
    visible + botones, y que él clickee "Siguiente · subir a AFIP"
    cuando esté listo. Bonus: panel pinned en Paso 2 con Descargar/
    Copiar siempre a mano por si vuelve.

  **E-GG-25.d · Paso 3 sin manera de avanzar a Paso 4**
  - Causa: cuando el cert ya estaba instalado (`emisor.cert_subido_at`
    seteado), el botón "Validar e instalar" quedaba disabled (porque
    el textarea está vacío) y "Atrás" sólo retrocede. Usuario bloqueado
    sin poder ir a probar.
  - Fix: agregado botón "Siguiente · probar conexión" en Paso 3 que
    aparece sólo cuando hay cert instalado.

  **E-GG-25.e · `cms.cert.untrusted` en WSAA**
  - Causa: AFIP tiene **dos portales separados** para certificados,
    cada uno con su propia CA:
    - **Producción**: https://auth.afip.gob.ar → "Administración de
      Certificados Digitales" → CA Producción.
    - **Homologación**: https://wsass-homo.afip.gob.ar → "Autogestión
      Certificados Homologación" → CA Homologación.
    Un cert emitido por la CA de Producción NO funciona contra WSAA
    Homologación (devuelve `cms.cert.untrusted`) y viceversa.
  - El copy original del Paso 2 sólo apuntaba al portal de producción
    independientemente del ambiente seleccionado. Usuario que probaba
    homologación con cert de producción se chocaba con error confuso.
  - Fix: el Paso 2 ahora muestra banner crítico arriba que advierte
    sobre los dos portales según el ambiente actual del emisor.
    Instrucciones específicas por ambiente: si producción → link a
    AFIP regular; si homologación → link a WSASS. Subtítulo del paso
    también cambia.

- **Aprendizajes:**
  - **Forge en Deno**: usar SÓLO para parsing/construcción ASN.1.
    Nunca para keygen. WebCrypto nativo (`crypto.subtle`) para todo
    lo que toque node:crypto subyacente.
  - **AFIP dos portales**: nunca olvidar que homologación es un
    entorno completamente separado de producción, incluyendo CA. El
    copy en UI debe ser explícito sobre cuál usar.
  - **Wizards multi-paso**: nunca auto-advance crítico — el usuario
    pierde contexto y no puede volver fácilmente. Siempre dar opt-in
    explícito y mantener acciones críticas (Descargar) accesibles en
    múltiples pasos.
  - **Status disabled ≠ no hay próximo paso**: si un botón principal
    está disabled por estado válido (cert ya instalado), hay que
    proveer ruta alternativa para avanzar.

- **Fix en disco:** `supabase/functions/_shared/arca.ts` + edge fn
  `arca-generar-csr` deployada v8 + `src/modules/configuracion/pages/
  EmisoresPage.tsx`.
- **Commits:** `25bf2b7` (b), `b2b43c6` (c), `3833945` (d), `425d77f`
  (e); a se mergeó con c9fbaa2 (WebCrypto).
- **Fecha / módulo:** 2026-06-01 · ARCA wizard (DGG-31 fallout).

## E-GG-26 · Regresión silenciosa · captación por formulario (cursos) sin solicitud ni emails

- **Síntoma reportado por usuario (José Luis):** persona se inscribió al
  servicio "Curso inicial de formación de administradores" con mail
  estudio.saveriano@gmail.com. La persona NO recibió email de recepción
  y la solicitud NO apareció en el panel de gerencia. ADN del circuito
  de captación silenciosamente roto.
- **Diagnóstico (2 bugs en cascada):**

  **Bug A · filtro de categoría restrictivo:** el trigger
  `crear_tramite_desde_submission_auto` tenía:
  ```sql
  IF v_form.categoria NOT IN ('tramite','servicio','consulta') THEN
    RETURN NEW;
  END IF;
  ```
  Los 2 formularios de cursos (`curso-formacion`, `curso-actualizacion`,
  categoría `'curso'`) cumplían el predicado NOT IN → trigger salía sin
  crear solicitud. **2 productos públicos perdían clientes silenciosamente
  desde quién-sabe-cuándo.**

  **Bug B · regresión silenciosa de mig 0135:** la mig 0074 (2026-05-26)
  había agregado al trigger los `INSERT INTO email_queue` para el acuse
  al solicitante (template `formulario-submission-recibido`) y el aviso
  a cada gerente (template `solicitud-nueva-gerencia`). La mig 0135
  (voucher pipeline) redefinió la función entera con `CREATE OR REPLACE`
  para sumar campos `precio_*` y `voucher_*` — pero al hacerlo
  **eliminó los dos bloques de email_queue sin querer**. Nada falló,
  nada loggeó error, simplemente dejaron de enviarse emails. Tipo de
  bug imposible de detectar sin testing real de e2e del flujo.

  Esto significa que entre la fecha de mig 0135 y este fix
  (E-GG-26), TODAS las inscripciones por formulario público a categorías
  `tramite`/`servicio`/`consulta` (las que sí pasaban el filtro)
  generaban solicitud OK pero NO mandaban emails.

- **Fix (mig 0161):**
  1. **Denylist por categoría**: invertimos a `IF v_form.categoria = 'evento'
     THEN RETURN NEW;`. Sólo `evento` (webinars) queda fuera porque tiene
     su propio trigger `inscribir_webinar_desde_submission`. Cualquier
     categoría presente o futura genera solicitud por default. Defensa
     contra futuras categorías huérfanas.
  2. **Re-incorporar acuse al solicitante** (`formulario-submission-recibido`).
  3. **Re-incorporar aviso a gerencia** (`solicitud-nueva-gerencia` a cada
     gerente/operador activo).
  4. **Conservar la lógica de voucher/precio de mig 0135.**
- **Backfill:** ejecutado manualmente para la submission de Saveriano
  (`36007898-120b-494c-8360-42dae1a1bace`) creando su solicitud
  (`af95214f-bb69-4458-b101-89ff1ce1d8e8`) y encolando los 3 emails
  (acuse + 2 gerentes).
- **Aprendizajes:**
  - **CREATE OR REPLACE en triggers/funciones largas es peligroso.** Cuando
    una mig redefine una función completa, hay alto riesgo de perder
    código de migraciones anteriores si no se lee la versión vigente.
    Defensa: antes de `CREATE OR REPLACE` de una función con N+ líneas,
    correr `pg_get_functiondef()` y diff'ear contra la versión local.
  - **Allowlist por valor es frágil.** Usar denylist o filtro positivo
    explícito ("evento queda fuera porque X"). Allowlist olvida que existen
    valores nuevos y deja huérfanos.
  - **El circuito de captación necesita test e2e periódico.** Una vez por
    semana al menos: enviar un formulario público real y verificar que
    (a) aparece en panel, (b) llega email al solicitante, (c) llegan
    emails a gerentes. La mig 0135 rompió esto hace ~5 días y nadie lo
    detectó hasta que un gerente humano hizo un test real.
  - **Subsistemas críticos merecen pruebas snapshot.** Para el flujo
    captación, idealmente: una RPC de test que simule submission e
    inspecciona efectos colaterales (solicitudes, email_queue, notifs)
    devolviendo un veredicto. Conectarla al panel de Salud del sistema.

- **Estado:** mig 0161 aplicada, backfill ejecutado, solicitud y emails
  encolados. Cron `dispatch-emails` envía los 3 emails en su próximo
  tick.
- **Fecha / módulo:** 2026-06-01 · captación pública (mig 0161).

## E-GG-27 · Sistema asíncrono 100% caído desde AUDIT-011 (mismatch CRON_SECRET pg_cron ↔ edge fn)

- **Síntoma detectado al investigar E-GG-26:** la cola email_queue tenía
  `0 sent` en TODA su historia. Los emails que mig 0161 reactivó nunca
  iban a salir porque el cron `dispatch-emails-1min` estaba 401
  Unauthorized.
- **Alcance del bug:** 3 edge fns afectadas — dispatch-emails (ningún email
  workflow saliendo), dispatch-push (ninguna notif push saliendo),
  dispatch-arca-emission (ningún comprobante autorizado en ARCA si
  hubiéramos emitido facturas A/B/C reales). Desde la fecha de AUDIT-011
  (~3 días).
- **Causa raíz:** AUDIT-011 (2026-05-28, Fase 5 de auditoría pre-launch)
  endureció las 3 dispatch fns para exigir `Authorization Bearer` =
  `CRON_SECRET` o `SUPABASE_SERVICE_ROLE_KEY`. Los pg_cron jobs usaban
  `current_setting('app.service_role_key', true)` — setting que NUNCA
  fue seteado (devuelve NULL). El cron mandaba `Authorization: Bearer `
  (vacío) → 401 silencioso desde la edge fn.
- **Por qué nadie lo detectó (lección dura):** los logs del cron pg_cron
  mostraban "ejecución OK" porque `net.http_post` no falla aunque la
  edge fn devuelva 401. El 401 vivía adentro del log de la edge fn que
  nadie monitoreaba. El panel "Salud del sistema" (DGG-30) mide DB
  metrics pero no observa flujos de negocio (emails enviados,
  notificaciones push entregadas).
- **Fix aplicado (mig 0162):**
  1. Generado nuevo `CRON_SECRET`:
     `gg_cron_c3500aaaf64c4304bd4f775d3b141136`
  2. Hardcodeado el bearer en cada cron job vía `cron.alter_job()`
     (Supabase managed no permite `ALTER DATABASE … SET app.*`).
  3. Usuario lo seteó en Supabase Dashboard → Edge Functions → Secrets
     → `CRON_SECRET = <valor>`. Al guardarlo, Supabase re-deployó las
     3 edge fns automáticamente.
- **Verificación post-fix:** logs muestran las 3 edge fns pasaron de 401
  a 200 inmediatamente. dispatch-emails respondió
  `{"ok":true,"throttled":true,"wait_ms":289188}` al primer tick post-fix,
  confirmando que SÍ procesó algo (throttle de 5min activado por el
  primer drain real). Los 3 emails encolados de E-GG-26 (acuse Saveriano
  + 2 avisos a gerentes) saldrán en ~15 min con throttle entre cada uno.
- **Aprendizajes (críticos):**
  - **Cron pg_cron success ≠ trabajo completado.** Si la edge fn devuelve
    401/500, el cron mismo logguea "200 OK" porque la HTTP POST se
    ejecutó. Para detectar regresiones tenés que mirar los logs de la
    edge fn, no los del cron job.
  - **Auditorías estáticas (lint, code review, deploy OK) son insuficientes
    para flujos asincrónicos.** Necesitamos un health check que
    ejercite los caminos críticos cada N minutos y reporte si algo no
    funciona (cola que no avanza, secret rechazado, throttle infinito).
  - **CRON_SECRET hardcoded en pg_cron** es más confiable que
    `current_setting` que puede silenciosamente devolver NULL si nunca
    se setteó. Si el secret cambia, el rotate manual es explícito.
  - **El panel de Salud del sistema necesita una métrica más:** "emails
    enviados últimas 24h", "push enviados últimas 24h", "ARCA cola
    pending > 1h". Estas 3 alarmarían inmediatamente este tipo de bug.
- **TODO recomendado:** próxima ola → construir health check de flujos
  críticos (RPC + cron + panel Salud), para que la próxima regresión
  silenciosa la detecte el sistema en <1h.
- **Estado:** mig 0162 aplicada, CRON_SECRET seteado en Supabase
  Dashboard, las 3 edge fns dispatch funcionando (200 OK).
- **Fecha / módulo:** 2026-06-01 · cron + edge fns dispatch (E-GG-27).

## E-GG-28 · notif_emitir no escalaba a push web (gap arquitectónico)

- **Síntoma detectado en AUDIT-2:** la tabla `push_notifications_queue`
  solo tenía 1 fila histórica: la "Frase del día" del cron dedicado.
  TODOS los demás eventos críticos (solicitud nueva, tracking avance,
  derivar, factura partner, rechazo) generaban campanita 🔔 in-app
  vía `notif_emitir`/`notif_emitir_staff` pero **JAMÁS push web**
  aunque los gerentes tuvieran VAPID activado.
- **Causa raíz:** `private.notif_emitir(user_id, ...)` insertaba SÓLO
  a `public.notificaciones_internas`. La cadena
  `notif → push_notifications_queue` nunca se cableó. No es una
  regresión silenciosa: es una funcionalidad NUNCA TERMINADA. Las
  tasks #160 (push solicitudes), #188 (VAPID keys), #189 (push real)
  cerraron como completed porque la infraestructura push web
  funciona (lo demuestra "Frase del día") pero el escalado desde
  notif staff/cliente nunca se conectó.
- **Fix (mig 0163):** modificar `notif_emitir` para que, además del
  insert a notificaciones_internas, haga insert a
  `push_notifications_queue` SI el user tiene al menos una entrada
  en `push_subscriptions`. El insert va en BEGIN..EXCEPTION para no
  bloquear la notif principal si el push falla.
- **Impacto del fix:** UN cambio propaga push a TODOS los eventos
  que pasan por `notif_emitir` (que es la mayoría). Sin tocar 13
  llamadores distintos uno por uno.
- **Aprendizajes:**
  - **"Push activado" ≠ "push funcionando".** Las VAPID keys y
    suscripciones estaban OK desde mayo, pero nadie verificó que
    el escalado existía en el código. Test e2e real lo habría
    detectado en minutos.
  - **Funciones compartidas (`notif_emitir`) son punto de
    palanca.** Cambiarlas propaga a todos los callers, lo cual es
    bueno cuando agregás funcionalidad transversal pero peligroso
    cuando hacés `CREATE OR REPLACE` sin diff (cf. E-GG-26).
- **Fecha / módulo:** 2026-06-01 · notificaciones (mig 0163).

## E-GG-29 · Toasts genéricos "non-2xx status code" / "duplicate key" (mensaje técnico al usuario)
- **Síntoma:** durante el follow-up de E-GG-26 una persona intentó
  enviar un formulario y recibió el toast "No pudimos enviar el
  formulario · Edge Function returned a non-2xx status code".
  Imposible accionar — el usuario no sabía qué corregir. Una
  auditoría rápida mostró 280+ lugares en el frontend donde se
  hacía `description: res.error.message` mostrando texto técnico
  PG/Supabase crudo ("duplicate key violates unique constraint",
  "row-level security", "Failed to fetch", etc.).
- **Causa raíz:** dos huecos en el patrón de errores P-API-01:
  (1) Cuando una edge function devolvía 4xx con
  `{"error":"Datos inválidos: nombre: requerido"}` útil en el
  body, el front mostraba el mensaje genérico HTTP del
  `FunctionsHttpError` (`.message`) en vez del body.
  (2) Los services pasaban el `error.message` original al
  `ApiResponse`, pero los componentes lo renderizaban directo
  sin traducir códigos comunes a frases en español.
- **Fix (commit c116697):** dos helpers nuevos en
  `src/lib/errors.ts`:
  - `extractEdgeFnError(err)` lee el body real del
    FunctionsHttpError de supabase-js. Aplicado en todos los
    `supabase.functions.invoke` de services/api/.
  - `humanizeError({code, message} | string)` mapea códigos PG
    (42501, 23505, 23503, PGRST116...) + reglas regex sobre
    mensajes técnicos ("non-2xx", "Failed to fetch", "jwt
    expired", "duplicate key", "row-level security"...) a
    frases en español accionables. Si el mensaje ya es humano
    (vino del backend tras extractEdgeFnError), pasa intacto.
  - 119 componentes/páginas modificados: reemplazo masivo de
    `description: res.error.message` por
    `description: humanizeError(res.error)`. 305 sustituciones.
    tsc + vite build limpios.
- **Aprendizajes:**
  - **El message del backend vale oro.** Cuando la edge fn
    devuelve un mensaje accionable, perderlo en el front es
    desperdicio. El patrón `extractEdgeFnError` debe ser default
    en todos los `functions.invoke`.
  - **"Códigos" no son humanos.** El mismo PG code (23505) puede
    venir de email/CUIT/slug; el mapeo central a "Ya existe un
    registro con esos datos. Revisá los campos únicos" es
    suficientemente bueno y mucho mejor que el técnico.
  - **Excepción a la deuda:** rpc/storage directos en
    componentes (regla 4) quedaron sin tocar a propósito (sus
    StorageError/PostgrestError no son ApiResponse).
- **Fecha / módulo:** 2026-06-01 · lib/errors + frontend global
  (commit c116697).

## E-GG-30 · Falta de health check ejercitando flujos asíncronos
- **Síntoma:** las 3 fallas silenciosas de mayo-junio 2026
  (E-GG-26 captación huérfana, E-GG-27 cron 401, E-GG-28 push web
  sin escalar) vivieron en producción 3-30 días sin alertas. El
  panel "Salud del sistema" existente (SALUD-1/2/3) cubre KPIs de
  BD/storage pero nunca *ejercita* los flujos. Resultado: si un
  trigger se pisa con CREATE OR REPLACE, si el secret del cron se
  desalinea, si una fn compartida pierde una rama del INSERT —
  nada lo detecta hasta que un cliente reporta.
- **Causa raíz:** ausencia de cobertura "vivencial" de los flujos
  asíncronos. Las migraciones se firman "build limpio" pero la
  cadena real (formulario público → trigger → INSERT solicitud →
  INSERT email_queue → cron POST → Gmail OAuth → DKIM → inbox)
  nunca se prueba post-deploy.
- **Fix (DGG-32):** sistema de health check periódico:
  - **Migración 0164**: tablas `health_flow_runs` (bitácora) +
    `health_flow_alerts` (vigentes/históricas con auto-resolución
    >24h) + RPCs `health_flow_record_run/runs_recent/
    alerts_active/alert_resolve/alerts_garbage_collect`.
  - **Migración 0165**: helpers de introspección
    (`health_check_cron_jobs_status`, `_trigger_existe`,
    `_fn_contains`) llamadas SOLO desde service_role.
  - **Edge fn `health-flows-check`**: 7 checks que ejercitan
    email_queue, push_queue, los 3 cron jobs, secret alineado
    (POST a cada dispatcher), trigger captación, escala
    notif→push en el body de la fn, y atascos ARCA.
  - **Migración 0166**: pg_cron `health-flows-check-12h`
    schedule `0 3,15 * * *` UTC = 00:00 y 12:00 ART.
  - **UI**: nueva sección "Flujos críticos asíncronos" en
    /gerencia/configuracion/salud con timeline de 20 corridas,
    alertas activas con "Marcar resuelta", botón "Correr ahora".
  - **Banner global**: `HealthFlowsBanner` sticky en
    GerenciaLayout con poll cada 5min; si hay alerta crítica →
    fondo rosa con CTA "Revisar Salud", si warning → ámbar.
  - **Push web**: cuando se crea una alerta nueva, la RPC
    `health_flow_record_run` llama `private.notif_emitir` (que
    desde mig 0163 ya escala a push web) → todos los gerentes
    reciben campanita + push.
- **Aprendizajes:**
  - **Validar el primer run en vivo descubrió 3 falsos
    positivos** (push_notifications_queue usa `intento` no
    `intentos`, trigger captación se llama `trg_subm_auto_tramite`
    no `*solicitud*`, arca usa `arca_emision_queue` no
    `comprobantes.estado_arca`). Si no se hubiera testeado real,
    el sistema habría disparado alertas falsas todos los días.
  - **Auto-resolución funciona**: las 2 alertas falsas se
    cerraron solas en el segundo run con `resolved_by='auto'`.
    No queda manual cleanup pendiente.
  - **El propio health check confirma E-GG-26/27/28 fixes**: los
    7 checks devuelven OK en producción al 2026-06-01.
- **Fecha / módulo:** 2026-06-01 · health-flows-check (DGG-32).

## E-GG-31 · Tres reportes simultáneos de José Luis Saveriano (PRimerosMinutos vuelve, Atajos redundantes, Contraseña en inglés)
- **Síntomas (3):**
  1. **PrimerosMinutos vuelve al refresh** aunque el usuario cierra con la X.
  2. **Bloque "Atajos" del dashboard duplica el sidebar** y agranda la pantalla sin valor.
  3. **Cambio de contraseña falla** con mensaje en inglés "Current password
     required when setting new password.", aunque el usuario puso la correcta.
- **Causa raíz #1:** `getChecklist()` (services/api/onboardingChecklist.ts) hacía
  `.from('profiles').select(...).single()` sin filtrar por `auth.uid()`. La
  RLS de `profiles` permite a staff ver TODOS los profiles, así que `.single()`
  rompía con "more than one row" → componente caía a `setState({})` → el
  asistente reaparecía al refresh. Confirmado en BD: Pablo tenía
  `{"dismissed":true}` guardado y aun así veía el asistente.
- **Causa raíz #2:** UX legacy — la grilla "Atajos" se diseñó cuando el
  sidebar tenía menos hubs. Tras DGG-25 (15→9 grupos) el sidebar ya cubre
  toda esa navegación. Es ruido visual neto.
- **Causa raíz #3:** AUDIT bonus #272 activó "Secure password change" y
  "Require current password" en Supabase Auth. En ese modo,
  `supabase.auth.updateUser({password})` desde el cliente RECHAZA porque
  supabase-js v2 NO expone `password_current` en el body — la API REST
  espera ese campo y no hay forma estándar de mandarlo. El `signInWithPassword`
  previo NO satisface la verificación (Supabase requiere `password_current`
  en el mismo request, no un re-auth previo).
- **Fix #1:** `getChecklist()` ahora hace
  `getUser()` → `.eq('id', user.id).maybeSingle()`. Si no hay sesión,
  devuelve `NO_SESSION`. tolerante a 0 rows.
- **Fix #2:** removido el `<section>Atajos</section>` de
  `src/modules/gerencia/pages/GerenciaHome.tsx` + limpieza de imports.
  Comment para el próximo que abra el archivo: "si reintroducís Atajos,
  considerá mostrar SOLO los destinos personalizados al rol".
- **Fix #3:** edge fn `cambiar-mi-password` (verify_jwt=true):
  - identifica al user a partir del JWT del caller (anon + Authorization)
  - en un cliente aislado, `signInWithPassword(email, current)` para verificar
  - si OK, `admin.updateUserById(userId, {password: new})` con service_role
    → bypassea la restricción "Secure password change" que aplica solo al
    self-update desde el cliente.
  - `changeMyPassword()` (services/api/perfil.ts) ahora invoca esta edge fn
    en vez de hacer signInWithPassword + updateUser. Mantiene el código
    semántico `CONTRASEÑA_ACTUAL_INVALIDA` para que el toast muestre el
    mensaje específico.
- **Aprendizajes:**
  - **Las queries a tabla sin filtro explícito son frágiles ante cambios de
    RLS.** Aunque el patrón "RLS te devuelve solo lo tuyo" suena suficiente,
    `.single()` con N>1 rows rompe. Siempre `.eq('id', auth.uid())` cuando
    se busca SU registro.
  - **Settings de Supabase Auth no testeados en QA real.** AUDIT bonus #272
    cerró como "completed" sin verificar UX del cambio de contraseña post-
    activación. El primer usuario externo que lo intentó lo descubrió.
  - **El sidebar es la SSOT de navegación.** Cualquier sección "atajos" /
    "menú rápido" / "tarjetas grandes" duplica esa SSOT y queda desincronizada.
- **Fecha / módulo:** 2026-06-02 · dashboard + auth + onboarding.

## E-GG-32 · Detalles de Jose Luis sobre los 4 formularios RPAC + CTAs plataforma SaaS
- **Pedido del usuario (2026-06-02, PDF de Jose Luis Saveriano):**
  - Matriculación-RPAC, Renovación-RPAC, Certificado-RPAC, DDJJ-anual:
    agregar padre/madre, clave fiscal ARCA, legajo RPAC; renombrar
    AFIP→ARCA + Código de Actividad 682010; planilla Excel de consorcios;
    bloque "Costos del trámite" + cuenta MP; para Certificado simplificar
    urgencia a "5 días hábiles"; para DDJJ deshabilitar 2026 y quitar
    comprobante de pago DGR.
  - Ícono WhatsApp universal en TODOS los formularios.
  - Los 2 CTAs "Conocer/Probar la plataforma" del landing redirigen a
    `/ingresar` (panel propio); deben llevar a una página "Muy pronto"
    que NO revele el nombre interno (que va a cambiar).
- **Causa raíz #1 (formularios):** los schemas legacy traían terminología
  AFIP, no preveían padre/madre, legajo ni clave fiscal, y mostraban opciones
  de urgencia 24h/48h que ya no aplican. La info de costos vivía sólo en el
  catálogo de servicios pero no se rendereaba al cliente que llena el form.
- **Causa raíz #2 (CTAs):** ambos apuntaban a `/ingresar`, que es el login
  del panel interno. El cliente externo no debería ver eso aún.
- **Fix:**
  1. **Mig 0167**: agrega 4 columnas a `administraciones`
     (`padre_apellido_nombre`, `madre_apellido_nombre`, `legajo_rpac`,
     `clave_fiscal_arca`) + 4 a `config_global` (cuenta MP). RPC
     `cliente_perfil_datos_formulario` extendida para exponer todo eso al
     autofill cuando el cliente entra logueado.
  2. **Mig 0168**: actualiza el JSON schema de los 4 formularios con
     todos los cambios. Se introduce un nuevo tipo de campo `costos_info`
     que renderea tarifas + datos cuenta MP + nota_total / nota_extra.
  3. **`FormularioRunner`**: agrega el case `costos_info` → renderiza
     `CostosInfoCard` con copy-to-clipboard de cada dato de la cuenta.
     El campo NO se valida ni se envía en el payload (es informativo).
  4. **`FieldPalette`** del builder: agrega el tipo a la paleta así
     gerencia puede insertarlo en otros formularios.
  5. **`WhatsAppFloatingButton`**: componente sticky bottom-right
     reutilizable. Levanta el número de `config_global.whatsapp` (con
     fallback `+5492214317914`) y abre `wa.me` con mensaje pre-rellenado.
     Inyectado en `FormularioPublicoPage` + `PlataformaMuyProntoPage`.
  6. **`PlataformaMuyProntoPage`** (ruta `/plataforma`): página simple
     "Muy pronto" + CTA volver + WhatsApp. NO menciona "Administración
     Global" porque el nombre va a cambiar (decisión del usuario).
  7. Los 2 CTAs del landing apuntan a `/plataforma`.
- **AFIP→ARCA en otros lugares del sistema:** el usuario eligió
  "solo lo visible al cliente". Las menciones en pantallas de gerencia
  (`EmisoresPage`, `ComprobanteFormDrawer`, `AdministracionFormDrawer`,
  `generateArcaTutorialPdf`) son contextuales y se dejan en backlog.
- **Aprendizajes:**
  - **Los formularios son la cara externa más sensible** — un cliente
    que llena 7 campos y se pierde el contexto del costo se va sin pagar.
    El bloque `costos_info` con copy-to-clipboard del CVU es lujo barato.
  - **Tratamiento simétrico público-portal** se mantiene gracias al
    autofill: los campos nuevos (padre/madre/legajo/clave) se persisten
    en `administraciones`, así un cliente logueado completa una vez y
    nunca más los re-tipea.
  - **Una página "Muy pronto" buena vale por sí sola.** Hasta que la
    plataforma SaaS para externos esté lista, ese único placeholder
    construye expectativa sin comprometer naming. WhatsApp universal
    funciona como captura de prospectos sin pedir email.
- **Fecha / módulo:** 2026-06-02 · formularios + landing + WhatsApp +
  página plataforma + administraciones.

## E-GG-33 · Auditoría exhaustiva E-GG-32: 9 hallazgos (5 críticos + 4 menores)
- **Trigger del pedido:** el usuario citó la lección "auditorías con sesgo
  de revisar vs ejercitar" del health check (DGG-32) y la aplicó al chunk
  Jose Luis recién cerrado. La consigna: "que los campos queden todos bien
  guardados y consolidados en todos los aspectos".
- **Metodología:** 3 agentes en paralelo (gerencia+builder · naming+downstream
  · WhatsApp+plataforma) + test e2e en BD con ROLLBACK simulando una
  submission completa de matriculación-rpac y verificando persistencia,
  trigger, y disponibilidad para autofill.
- **Hallazgos críticos (5):**
  1. **Sync submission → administración roto.** El cliente declaraba
     `clave_fiscal_arca`/`legajo_rpac`/padre/madre en un formulario,
     pero nada de eso volvía a su ficha. La próxima vez retipeaba.
     Rompía la promesa "lo declarás una vez". Confirmado por test e2e
     en BD (UPDATE de administraciones se quedaba NULL post-submission).
  2. **Gerencia no podía editar los 4 campos nuevos** en el
     `AdministracionFormDrawer`: el `FormState`, `EMPTY`, `rowToForm` y
     payload del PATCH ni los conocían. La única forma de cargarlos era
     una submission pública del propio cliente (que tampoco persistía,
     por hallazgo #1).
  3. **Builder no editaba `costos_info`.** El `PropertiesPanel` no tenía
     editor del subobjeto `costos` (items/cuenta/nota_total/nota_extra).
     Si cambiaba el precio del trámite, la única forma era SQL directo
     contra `formularios.schema`.
  4. **Click-add insertaba `costos_info` sin defaults.** `makeFieldFromType`
     no contemplaba el tipo. El campo se insertaba con `costos = undefined`
     y `CostosInfoCard` devolvía `null` silencioso. El gerente clickeaba
     "Agregar costos" y no veía nada.
  5. **Clave fiscal en plano.** La directiva del usuario era "***" + ojito,
     pero todos los schemas usaban `type:"text"` sin flag. La clave se veía
     mientras se tipeaba, quedaba en el DOM y se exponía en screen-share.
- **Hallazgos menores (4):**
  6. `AdministracionDetailPage` no mostraba los 4 campos.
  7. WhatsApp button vivía en el wrapper `FormularioPublicoPage` en
     lugar del runner → si mañana se embebe el runner desde otro flujo
     (modal, webinar), el botón se omite.
  8. 2 CTAs grandes del landing decían "Ingresar a la plataforma" pero
     apuntaban a `/ingresar` (login interno), inconsistente con los otros
     CTAs que ya iban a `/plataforma`.
  9. RLS de `config_global` solo permite SELECT a `authenticated`. El
     `WhatsAppFloatingButton` para visitantes anónimos caía al fallback
     hardcoded; el número no era editable desde la UI sin redeploy.
- **Fixes (todos en mismo chunk):**
  - **Mig 0169**: (a) trigger `trg_subm_sync_admin` con COALESCE para
    cada uno de los 7 campos importantes que viajan en `datos`; (b)
    `UPDATE formularios SET schema = jsonb_set(...)` marcando
    `clave_fiscal_arca.sensitive = true` en los 3 schemas; (c) RPC
    `get_public_whatsapp()` con `GRANT EXECUTE TO anon, authenticated`.
  - `FormularioFieldDef.sensitive?: boolean` + `PasswordRevealInput`
    reusable (input password + botón ojito) + render del runner cuando
    `field.sensitive && type==='text'`.
  - `AdministracionFormDrawer`: 4 inputs nuevos (con `PasswordRevealInput`
    para la clave fiscal) en el step "Matrículas y notas". Update completo
    de `FormState`, `EMPTY`, `rowToForm` y payload.
  - `AdministracionDetailPage`: 2 DataRows nuevas en TabGeneral
    (padre/madre con `InlineEdit`) + 2 en TabRegistral (legajo + clave
    fiscal con componente `ClaveFiscalReveal` con dots+ojito+copy).
  - `CanvasFormulario.makeFieldFromType`: default razonable cuando se
    inserta `costos_info` desde la paleta (1 tarifa vacía + cuenta MP
    pre-completada con la de Gestión Global). `defaultLabel` actualizado.
  - `PropertiesPanel`: `CostosInfoEditor` con repeatable de items
    (label/precio/nota) + 4 inputs de cuenta + nota_total + nota_extra.
    También flag `sensitive` con checkbox visible para campos text/textarea.
  - `FormularioRunner`: WhatsApp ahora vive adentro del propio runner.
    `FormularioPublicoPage` deja de inyectarlo (evita doble botón).
  - `WhatsAppFloatingButton`: usa `supabase.rpc('get_public_whatsapp')`
    en vez de query directa a `config_global`.
  - `LandingPage`: los 2 CTAs cambian texto a "Conocer la plataforma" y
    apuntan a `/plataforma`. El "Ingresar" del SiteNav sigue vivo para
    quien tiene credenciales del panel interno.
- **Verificación post-fix:**
  - Segundo test e2e en BD: misma submission ahora SÍ poblaba
    `administraciones.padre_apellido_nombre = 'PADRE AJL'`,
    `madre = 'MADRE AJL'`, `clave_fiscal_arca = 'CLAVE_AJL_xyz'`,
    `telefono = '+5491100000000'`. Trigger working.
  - Schemas confirmados con `sensitive=true` en los 3 formularios.
  - `SELECT public.get_public_whatsapp()` devuelve `+5492214317914`.
  - `tsc --noEmit` + `vite build` limpios.
- **Aprendizaje:**
  - **Auditar = ejercitar.** El test e2e en BD (con ROLLBACK) descubrió
    el GAP crítico #1 antes que ningún ojo humano lo viera en prod.
    Esto debería ser parte del flujo estándar post-mig: insertar un
    row sintético, dispararlo, observar el side-effect esperado.
  - **El builder es tan importante como el runner.** Un tipo de campo
    sin editor en `PropertiesPanel` es código zombie: nadie lo modifica,
    pero todos lo ven en el runner. Mismo con `makeFieldFromType` sin
    default: lo inserta vacío, renderiza null, no hay error.
  - **Persistencia en la ficha = palanca de UX.** Tener triggers de
    sync submission→admin es la diferencia entre "lo declarás una vez"
    y "lo declarás cada vez". Vale más que cualquier optimización del
    formulario.
- **Fecha / módulo:** 2026-06-02 · auditoría E-GG-32 cierre.

---

## E-GG-50 · El creador de clientes nunca creaba el usuario de login (2026-06-04)

- **Síntoma (Pablo):** "quise crear un cliente nuevo y el creador se saltó el
  último paso, me sacó de la pantalla y no me creó el usuario".
- **Reproducción:** quedó la administración `Administración TEST`
  (`pabloeacu+test@gmail.com`) creada, **sin** `auth.users` ni `profiles`, sin
  rastro en los logs de la edge function de alta. → la falla fue **en el
  frontend, antes de llamar al backend**.
- **Causa raíz:** `AdministracionFormDrawer` (el creador de clientes) sólo hace
  `createAdministracion()` y cierra el drawer. **Nunca** crea el acceso al
  portal. La creación del usuario (`altaClientePortal` → edge fn
  `alta-cliente-portal`) sólo existía dentro de `WizardActivacion` (activar
  solicitud). No había NINGÚN punto de entrada para dar acceso al portal a una
  administración creada directo → cliente huérfano, no-transaccional, sin feedback.
- **Fix:** (1) ficha del cliente (`AdministracionDetailPage`): botón "Crear
  acceso al portal" cuando `user_id` es null (usePrompt para el email) + chip
  "Acceso al portal activo" cuando ya tiene; (2) creador
  (`AdministracionFormDrawer`): checkbox opcional "Crear acceso al portal para
  este cliente" en el último paso (sólo alta nueva, con guarda de email),
  que tras `createAdministracion` llama `altaClientePortal`. La edge fn ya era
  idempotente + manda credenciales por mail.
- **Lección:** todo flujo de "alta de entidad con acceso" que separa la
  creación del registro de la creación de la credencial DEBE ofrecer la
  credencial en el mismo lugar (o dejar un punto de entrada visible en la
  ficha), o queda el hueco "creé el cliente pero no puede entrar".
- **Fecha / módulo:** 2026-06-04 · clientes · commit `39aada4`.

## E-GG-51 · TRAMIX: el modal abría pero la consulta fallaba (CORS preflight) (2026-06-04)

- **Síntoma:** QA en vivo del modal TRAMIX (DGG-46): abría perfecto pero la
  consulta tiraba toast "No pudimos consultar… Failed to send a request to the
  Edge Function" (`FunctionsFetchError`).
- **Causa raíz:** `supabase.functions.invoke` agrega los headers
  `x-client-info` y `x-supabase-api-version` al request. El **preflight CORS**
  pedía permiso para esos headers y mi `Access-Control-Allow-Headers` sólo
  listaba `authorization, apikey, content-type` → el navegador **bloqueaba** el
  POST antes de mandarlo (de ahí "failed to send", no un 4xx/5xx). En Fase 0
  había validado la función con **curl**, que NO hace preflight → pasó.
- **Fix:** `Access-Control-Allow-Headers` ahora incluye `x-client-info,
  x-supabase-api-version` + `Access-Control-Allow-Methods: POST, OPTIONS`
  (mismo patrón que `alta-cliente-portal`). Deployado v6. Verificado en vivo:
  6 expedientes del legajo 284265 + detalle, render nativo.
- **Lección:** validar edge functions cliente-facing **desde el browser** (con
  supabase-js), no sólo con curl — el preflight CORS sólo aparece en el browser.
  Headers mínimos para functions.invoke: `authorization, x-client-info, apikey,
  content-type, x-supabase-api-version`.
- **Fecha / módulo:** 2026-06-04 · tramix-consulta · commit `6ac2d08`.

## E-GG-52 · El examen filtraba las respuestas correctas al browser del alumno (2026-06-05)

- **Síntoma:** al ampliar el diseñador de exámenes (DGG-47) para cargar el examen
  real de Actualización RPAC 2026, la doble auditoría (3 agentes) detectó que el
  alumno recibía `curso_opciones.correcta`, la retroalimentación y
  `curso_preguntas.explicacion` en el payload de red. Un alumno matriculado abría
  DevTools → Network y veía la respuesta correcta de cada pregunta **antes** de
  responder. Para un examen habilitante (matrícula RPAC) invalida la evaluación.
- **Causa raíz:** el loader del alumno `getCurso` hacía
  `curso_examenes(*, curso_preguntas(*, curso_opciones(*)))` — el `*` traía la
  columna sensible `correcta`. La policy `curso_opciones_select` (mig 0029)
  concedía SELECT de la fila COMPLETA a cualquier matriculado, confiando en que el
  front "no la mostrara" → seguridad por ocultamiento del lado del cliente. Es lo
  que la propia mig 0029 anticipó como "pragmático, endurecer si hace falta".
  Viola la regla 3 (sin secretos en el front).
- **Fix (a nivel datos, no front — mig 0200):** (a) RPC
  `curso_examen_rendir(p_examen_id)` SECURITY DEFINER que devuelve examen +
  secciones + preguntas + opciones **sanitizadas** (sin `correcta`, sin
  retroalimentación, sin `explicacion`); tenancy staff/matriculado (R12). (b) RLS
  endurecida: SELECT directo de `curso_preguntas`/`curso_opciones` queda SOLO para
  staff; el alumno accede al contenido únicamente por la RPC. (c) La justificación
  se revela recién al responder, vía el `detalle` de `curso_responder_examen` (la
  corrección siempre fue 100% server-side). Front: `getExamenParaRendir` +
  `ExamenRunner` consume la RPC; la explicación del resultado sale de
  `resultado.detalle`, no del payload.
- **Verificación:** smoke 0200 (BEGIN/ROLLBACK): la RPC no incluye
  correcta/explicacion; un alumno no-staff ya no lee `curso_opciones` directo.
- **Lección:** "el front no lo muestra" NO es seguridad — si el dato viaja, está
  filtrado. Datos que el cliente no debe ver se ocultan en la FUENTE (RPC
  sanitizada / RLS por rol), no en el render. (Regla 3.)
- **Fecha / módulo:** 2026-06-05 · campus exámenes · mig 0200.

## E-GG-53 · Cerrar un trámite por el kanban no avisaba al cliente (solo a gerentes) (2026-06-06)

- **Síntoma (caso JL):** el 05/06 JL cerró el trámite "Certificado de
  acreditación RPAC" de Estudio Save. La gerencia recibió el mail "Trámite
  cerrado · …" y el portal del cliente mostraba el trámite cerrado, pero el
  cliente (estudio.saveriano@gmail.com) NUNCA recibió el mail del cierre.
- **Descartado DNS/DMARC:** esa casilla venía recibiendo todo `sent` (bienvenida,
  avances, "nuevo servicio") sin bounce. El mail del cierre no figuraba en
  `email_queue` NI en `sent_emails` → nunca se generó. No era entrega, era
  encolado: el correo nunca se creó.
- **Causa raíz:** hay DOS vías de cerrar un trámite y solo una avisaba al cliente.
  (a) **modal "Cerrar trámite"** (`tracking_cerrar`) → inserta una línea
  `visible_cliente=true` → `tracking_linea_on_insert` → email + push + campanita al
  cliente. (b) **kanban / cambio de estado** (UPDATE directo estado='cerrado') →
  solo `_notif_tracking_cerrado_trg` → `notify_all_gerentes` (gerencia). JL usó
  (b): el trámite quedó `estado='cerrado'` pero con `motivo_cierre`/`fecha_fin`/
  `cierre_satisfactorio` = NULL y SIN línea de cierre — firma inequívoca del cierre
  por kanban (`tramite_on_update` setea resuelto_at/resuelto_por), no del modal.
  Alcance: 2 de 4 cierres desde el lanzamiento fueron por kanban → 2 clientes sin
  aviso.
- **Fix (mig 0201 · decisión Pablo "avisar siempre al cliente"):**
  `_notif_tracking_cerrado_trg` (el hook universal que ya corre en CUALQUIER
  transición a cerrado/resuelto) ahora inserta la línea de cierre visible cuando el
  cierre NO vino del modal — discriminador `motivo_cierre IS NULL` (el modal lo
  setea NOT NULL en el mismo UPDATE; `tracking_reabrir` lo limpia) y solo en la 1ª
  transición a terminal (evita doble en resuelto→cerrado). Reusa la maquinaria de
  líneas: el cliente recibe email + push + campanita + lo ve en el portal, idéntico
  al modal, sin duplicar.
- **Verificación (R18, BEGIN/ROLLBACK):** smoke A (kanban) → 1 línea 'cierre' + 1
  mail al cliente; smoke B (modal) → 0 líneas del trigger (no duplica) + 1 línea del
  modal + 1 solo mail. Retroactivo: encolado el aviso de cierre a los 2 clientes
  afectados (Estudio Save + Expensas Pagas).
- **Lección:** un evento terminal de negocio (cierre) debe notificar a TODOS los
  públicos relevantes, no a uno. Si hay 2 caminos que producen el mismo estado
  final, ambos deben disparar el mismo fan-out. Patrón hermano de E-GG-26/E-GG-28
  (gaps de fan-out) y E-GG-35 (paridad entre 2 vías de la misma acción).
- **Fecha / módulo:** 2026-06-06 · trackings/notificaciones · mig 0201.

## E-GG-54 · Reabrir por kanban no avisaba a nadie + envenenaba el fix del cierre (2026-06-06)

- **Hallazgo de la doble auditoría** (3 agentes paralelos + e2e) sobre el fix
  E-GG-53. Espejo exacto del mismo patrón:
  - **#1** Reabrir un trámite arrastrando la tarjeta en el kanban
    ('cerrado'→'abierto'/'en_progreso', UPDATE directo de estado) **NO
    notificaba a NADIE** (ni cliente ni gerencia). Solo el modal
    `tracking_reabrir` notifica.
  - **#2** Ese reabrir por kanban **no limpiaba `motivo_cierre`** (solo lo hace
    la RPC). Como el fix 0201 usa `motivo_cierre IS NULL` para decidir si
    notifica al cliente en el CIERRE, un re-cierre posterior por kanban quedaba
    **envenenado** por el motivo viejo → suprimía el aviso. Hueco en el propio
    fix 0201.
- **Fix (mig 0202, decisión Pablo "simetría total"):** `tramite_on_update`
  (BEFORE) limpia la metadata de cierre al reabrir por kanban (desactiva el
  envenenamiento de #2) y `_notif_tracking_cerrado_trg` (AFTER) inserta una
  línea `'reapertura'` visible → fan-out al cliente (email + push + campanita)
  por `tracking_linea_on_insert`. Discriminador anti-doble: **`reabierto_count`**
  (la RPC lo incrementa en el mismo UPDATE; el kanban no) → no duplica con
  `tracking_reabrir`. + seed de las categorías `'cierre'`/`'reapertura'` en
  `tracking_categorias_config` (no estaban → el chip mostraba el slug crudo).
- **Verificación R18 (BEGIN/ROLLBACK):** smoke C (kanban-reopen) → motivo NULL +
  1 línea reapertura + 1 email cliente; smoke E (re-cierre tras reabrir) → 1
  cierre + 1 email (envenenamiento curado).
- **Lección:** cada acción terminal con doble-vía (modal/RPC vs kanban/directo)
  debe producir el MISMO fan-out en AMBOS sentidos (cerrar Y reabrir). Y un
  discriminador heurístico (`motivo_cierre IS NULL`) tiene que mantenerse
  coherente en TODAS las transiciones que lo afectan, o se envenena.
- **Fecha / módulo:** 2026-06-06 · trackings/notificaciones · mig 0202.

## E-GG-55 · tracking_reabrir con "notificar cliente" tildado estaba roto (2026-06-06)

- **Descubierto por el smoke e2e de E-GG-54** (ejercitar, no leer).
  `tracking_reabrir(.., p_notificar_cliente => true)` lanzaba error y abortaba
  TODA la reapertura por 2 bugs en el bloque de notificación:
  1. `encolar_email(.., 1)` pasa `1` (integer) donde la firma única de
     `encolar_email` espera `smallint` → 42883 "function does not exist". Drift
     tipo E-GG-42: `encolar_email` se redefinió a smallint y este caller (mig
     0188) quedó desfasado; plpgsql no lo valida al aplicar la migración.
  2. el push hacía `INSERT ... FROM profiles WHERE p.rol='cliente'`, pero
     `profiles` no tiene columna `rol` (es `role`) y no existe el rol `'cliente'`
     (los clientes son `role='administrador'`) → 42703.
  Efecto en prod: el gerente que reabría desde el modal con el check "notificar
  al cliente" tildado recibía un error y la reapertura **NO se hacía**.
- **Fix (mig 0203):** `encolar_email(.., 1::smallint)` + push vía
  `encolar_push(v_admin.user_id, ...)` (el `user_id` de la administración es el
  perfil del cliente en el portal), cada notificación envuelta en
  `BEGIN/EXCEPTION` para que un fallo de notificación NO aborte la reapertura.
- **Verificación R18:** smoke D (modal reabrir notify=true) → la RPC completa
  sin error + email `tramite-reabierto` encolado + sin doble línea (mi trigger
  de 0202 se abstiene por `reabierto_count`).
- **Lección:** las RPCs que llaman a otras funciones por nombre+args son
  frágiles al drift de firmas (plpgsql resuelve en runtime, no al migrar). Toda
  RPC con un branch "raro" (notificar opcional) necesita un smoke e2e que
  ejercite ESE branch, no solo el happy path.
- **Fecha / módulo:** 2026-06-06 · trackings/reapertura · mig 0203.

## E-GG-56 · Doble auditoría a fondo del wizard de activación v2 (DGG-54)

- **Contexto:** método §6 (3 agentes paralelos + e2e en vivo) sobre el wizard
  rediseñado. La activación e2e en browser pasó perfecta; la lectura estática
  encontró hallazgos que el happy-path no exponía. Fixeados en el mismo chunk.
- **Hallazgos FIXEADOS:**
  1. **(Crítico) Duplicación de comprobante al cerrar el modal a mitad de
     proceso.** Si la emisión del comprobante sale OK pero la cobranza falla, y
     el gerente cierra con la X/Escape (en vez de *Reintentar*) y reabre el
     wizard, el prop `solicitud` quedaba stale (sin `comprobante_id`) → la op
     comprobante re-emitía OTRO comprobante. **Fix:** (a) `onRunningChange` →
     `procesando` bloquea el cierre del modal (`onClose` no-op) mientras corre;
     (b) refetch de la solicitud en `onClose` del wizard (no sólo en
     `onActivated`) → al reabrir ve `comprobante_id`/`tramite_id` reales y
     saltea. El guard `listCobranzasDeComprobante` ya prevenía doble cobranza.
  2. **Campus/webinar frenaban toda la activación si fallaban** (siendo
     "opcionales"). El trámite ya quedaba abierto pero un error de matrícula/
     inscripción abortaba la secuencia. **Fix:** ops `campus`+`webinar` →
     `bestEffort` (avisan, no detienen). También mitiga el email faltante al
     inscribir webinar de un cliente existente.
  3. **`observacionesTracking` fantasma** (regla 1 suave: se juntaba pero no se
     persistía). **Fix:** op best-effort que agrega una línea interna del
     tracking (`categoria='alta'`, `visible_cliente=false`) con la observación.
  4. **Comentario R17 de la mig 0206 inexacto** (decía que las colas de notif
     "tienen policies de write propias"; 2 de 3 NO las tienen y se salvan por
     ser SECURITY DEFINER). Reescrito.
- **Verificado sólido (sin acción):** firmas RPC (sin patrón E-GG-42),
  no-duplicación de cliente (`solicitud_activar` aborta si ya `activada`),
  idempotencia/resume por estado real, regla 4 (0 `supabase.from` en
  componentes), R5/R12/R16/R17 de la mig 0206, paridad de variables del
  template, downstream de `en_revision` (listSolicitudes/SolicitudCard ok),
  R20 en uploads, ramas terminales Q2.
- **DIFERIDO (decisión de Pablo):**
  - **Partner + servicio gratuito/$0:** el selector de partner se oculta en $0
    (no hay movimiento de cobranza que atribuir). Probablemente by-design (un
    servicio $0 no se rinde ni se factura), pero si se quiere atribuir partners
    en bonificados-100%, falta un mecanismo de atribución sin cobranza.
  - **Operador (no-gerente) en ramas terminales:** `pedir_docs_revision` y
    `rechazar` exigen `role='gerente'` estricto (`descartar` acepta operador).
    Un operador que elija revisión/rechazo recibe error humanizado (dead-end).
  - **`esGratuito` falso-positivo si `precio_final=0` por error de carga** y
    **`esWebinar` sin guard `!esDDJJ`:** riesgo bajo (el gerente edita el precio
    en Paso 3; un slug webinar+ddjj es improbable). A monitorear.
- **Lección:** un wizard que difiere mutaciones al final debe (a) impedir el
  cierre mientras procesa y (b) refrescar su fuente de verdad al cerrar, o la
  idempotencia basada en el prop inicial se rompe al reabrir sobre un estado
  parcial. Las ops "opcionales" (campus) deben ser best-effort para no frenar
  el núcleo (cliente+trámite+cobranza).
- **Fecha / módulo:** 2026-06-08 · solicitudes/wizard v2 · DGG-54.

## E-GG-57 · "Crear sala Zoom" no generaba la sala — el bundle de `@supabase/supabase-js` crasheaba el cold-start de la edge function (Lista JL · F9) (2026-06-08)

- **Síntoma:** JL (gerente): en el Campus, el botón **"Crear sala Zoom"** de un
  encuentro sincrónico fallaba con un toast de error; en consola
  `FunctionsFetchError / Failed to send request / CORS Missing Allow Origin`
  (`TypeError: Failed to fetch`). El encuentro nunca quedaba con sala. La
  edge function era `zoom-meeting-create`.
- **Causa raíz:** la función **crasheaba en el COLD-START** del edge runtime
  actual de Supabase. Cuando una edge function revienta en el arranque, su
  handler de `OPTIONS` (preflight) devuelve **500 SIN headers CORS** → el
  browser lo reporta como "CORS faltante / Failed to fetch", ocultando que el
  verdadero problema está en el boot, no en CORS. El disparador del crash era
  **instanciar el cliente `@supabase/supabase-js`** (`createClient`) — su
  bundle (vía esm.sh) no resuelve/inicializa en este runtime y tira el boot.
- **Diagnóstico (qué se descartó, cada uno con redeploy + prueba en vivo):**
  versión de supabase-js (2.45→2.46), el import type-only `jsr:@supabase/
  functions-js/edge-runtime.d.ts`, el shared-import `_shared/humanize.ts`,
  `verify_jwt`, y el slot/slug (un nombre nuevo tampoco booteaba). La pista
  decisiva: una **probe mínima** que SÓLO importaba supabase-js (sin
  instanciarlo) booteaba OK; la función completa que hacía `createClient` NO
  → el bundle instanciado era el culpable.
- **Fix:** **reescribir la función SIN `@supabase/supabase-js`**, usando
  `fetch` crudo contra la REST/Auth/RPC de Supabase:
  - validar token de usuario: `GET ${SUPABASE_URL}/auth/v1/user` con
    `{Authorization: Bearer <token>, apikey: ANON_KEY}`.
  - leer/escribir con service-role: `GET/POST ${SUPABASE_URL}/rest/v1/<tabla>`
    y `POST .../rest/v1/rpc/<fn>` con `{apikey: SERVICE_ROLE, Authorization:
    Bearer ${SERVICE_ROLE}}`.
  - Nuevo slug **`zoom-encuentro-create`** (la vieja `zoom-meeting-create`
    quedó como slot huérfano deployado — no hay tool MCP para borrar edge
    functions; se elimina del dashboard). Frontend (`campus.ts` `crearSalaZoom`)
    repunteado al slug nuevo. Carpeta vieja removida del repo.
  - **Paridad verificada (§6):** settings del meeting, los 6 params del RPC
    `curso_encuentro_set_zoom` (uuid,bigint,text,text,text,integer — overload
    único, R16 OK), shape de respuesta y validaciones son idénticos a la vieja.
  - **Hardening §6:** TODO el cuerpo va dentro de un **try/catch global** que
    devuelve 500 **CON** CORS — sin esto, un fallo de red interno o un
    `.json()` sobre respuesta no-JSON volvería a escaparse como "500 sin CORS"
    (la misma clase de bug). Además regex UUID canónica 8-4-4-4-12.
- **Verificado en vivo (prueba del botón, frontend v76cd1b7):** gerente →
  Campus → "Curso de Actualización 2026" → encuentro "Asambleas Virtuales" →
  click "Crear sala Zoom" → toast "Sala Zoom creada ✓" + la fila pasa a
  "Iniciar como host / Link público / ID 85225512738 · pwd 493485". BD:
  `curso_encuentros.zoom_meeting_id=85225512738`, join `us06web.zoom.us/j/
  85225512738`, pwd 493485 (coincide). Smoke OPTIONS sobre la v5 → **204 con
  CORS** (boot sano). Consola sin errores del app (sólo ruido de extensión).
- **Prevención (→ DGG-57):** las edge functions del proyecto **evitan
  `@supabase/supabase-js`**; usan `fetch` crudo a REST/Auth/RPC. Smell check
  al tocar/crear una edge fn: si importa `createClient` de supabase-js,
  reescribir con fetch crudo. Check de boot al deployar: `curl -i -X OPTIONS
  <fn-url>` debe dar 2xx **con** `access-control-allow-origin`.
- **Deuda relacionada (F6 webinars):** `zoom-webinar-create` arrastra el
  MISMO patrón roto (importa+instancia supabase-js 2.45.0) → se reescribirá
  igual al abordar el formulario de webinar. Su handler de error
  (`webinars.ts:crearReunionZoom`) tampoco usa `extractEdgeFnError`.
- **Fecha / módulo:** 2026-06-08 · campus/encuentros · edge fn
  `zoom-encuentro-create` (reemplaza `zoom-meeting-create`) · Lista JL F9.

## E-GG-58 · Reuniones Zoom huérfanas al borrar encuentros + app S2S sin scope de delete (F9-bis · Lista JL) (2026-06-08)

- **Síntoma:** Pablo (captura del portal Zoom): quedaron 2 reuniones
  programadas en la cuenta Zoom con el mismo nombre ("Curso de Actualización
  2026…"). Temor a (a) duplicación de salas y (b) confusión del host (que
  inicia desde el portal Zoom, no desde el campus).
- **Diagnóstico:** El sistema **NO duplica** — doble guarda: el botón "Crear
  sala" sólo aparece `{!tieneSala}` (EncuentrosTab.tsx) y la edge fn tiene
  guarda 409 `meeting_already_created`. Las 2 reuniones eran **artefactos de
  testing de F9** (una por invoke directo + de-linkeada por SQL, otra por el
  botón). PERO la revisión destapó 2 gaps reales:
  1. **Huérfanos al borrar:** `borrarEncuentro` (campus.ts) sólo hacía
     `delete()` de la fila de `curso_encuentros` — **nunca borraba la reunión
     en Zoom**. Borrar un encuentro con sala dejaba la reunión fantasma en la
     cuenta Zoom para siempre.
  2. **Nombre ambiguo:** el `topic` era `Curso · Encuentro`; en la lista del
     portal Zoom el texto se trunca al inicio → dos encuentros del mismo curso
     se ven idénticos → el host no sabe cuál iniciar.
- **Fix:**
  - Nueva edge fn **`zoom-encuentro-delete`** (raw fetch, DGG-57): S2S
    `DELETE /v2/meetings/{id}` + limpia la fila. Modos `{encuentro_id}` (app)
    y `{meeting_id}` (limpieza de huérfanos). Idempotente (Zoom 404 = OK).
  - `eliminar(encuentro)` borra la reunión Zoom **antes** de la fila;
    botón **"Eliminar sala"** por fila para regenerar; `topic` ahora
    `Encuentro · Curso` (el host distingue en el portal).
- **Sub-bug capitalizado (root del "no borra"):** al testear en vivo, el
  DELETE a Zoom devolvió **400 · code 4711 "Invalid access token, does not
  contain scopes:[meeting:delete:meeting:admin, meeting:delete:meeting]"**.
  La **app S2S de Zoom puede CREAR reuniones pero no BORRARLAS** — le falta el
  scope de delete (config del Marketplace de Zoom; sólo el dueño de la cuenta
  lo agrega). Mitigaciones:
  - La fn detecta el 4711 y devuelve un **mensaje claro** ("falta activar
    «meeting:delete:meeting:admin» en la app de Zoom") en vez de un código
    técnico — verificado en vivo (toast).
  - `borrarEncuentro` pasa a **best-effort**: si Zoom rechaza el borrado de la
    reunión, **no bloquea** el borrado del encuentro (avisa con `toast.warning`
    y sigue). Sin esto, sin el scope no se podrían borrar encuentros con sala.
  - **RESUELTO (mismo chunk, vía browser):** se agregó el scope
    `meeting:delete:meeting:admin` a la app S2S **"Gestion Global Campus"**
    (Zoom Marketplace → la app → Scopes → Add Scopes → Meetings → "Eliminar
    una reunión" `:admin` → Save). Como la app S2S pide token fresco por
    llamada, tomó efecto de inmediato. **Verificado e2e EN VIVO:** crear sala
    (naming "Encuentro · Curso" confirmado en el portal Zoom: "Asambleas
    Virtuales · Curso de Actualización…"), botón "Eliminar sala" (borra la
    reunión en Zoom + limpia BD; toast "Sala Zoom eliminada"; Zoom devuelve
    204, y un re-delete por meeting_id devuelve 404 = confirmado borrado), y
    **limpieza de las 2 reuniones huérfanas** (87640319662 + 85225512738 →
    204). La cuenta Zoom quedó limpia (0 reuniones de prueba).
- **Prevención:** al integrar una API externa con S2S/OAuth, verificar que la
  app tenga **todos** los scopes del ciclo de vida (create **y** delete/update),
  no sólo el de creación. Un flujo que crea recursos sin poder borrarlos
  acumula huérfanos. Smell check al diseñar: "¿puedo deshacer lo que esta fn
  crea?".
- **Fecha / módulo:** 2026-06-08 · campus/encuentros · `zoom-encuentro-delete`
  + EncuentrosTab + campus.ts · Lista JL F9-bis.

## E-GG-59 · "El curso no genera deuda en CC" — bug del wizard VIEJO + hardening de la matrícula (F1 · Lista JL)

- **Síntoma (JL):** al activar una solicitud de categoría `'curso'` el sistema
  **no generaba el comprobante** → el curso no quedaba como deuda en la Cuenta
  Corriente del cliente.
- **Causa raíz:** era el **wizard de activación VIEJO** (previo a la reescritura
  v2, commits `c532f1a`/`e1d87a7` del **2026-06-08**). El wizard v2 SÍ emite el
  comprobante para curso (`comprobante.omitir = flags.esDDJJ` → `false` para
  curso; sólo DDJJ se omite). **Evidencia en datos reales:** 2 solicitudes
  `curso-formacion` del **06-05** quedaron `activada` con `comprobante_id = NULL`
  y esos clientes con **0 comprobantes** — anteriores al swap del wizard v2
  (06-08). Confirma el diagnóstico de Pablo: "la falla fue antes de modificar el
  wizard". (Las 2 viejas se dejaron como están — decisión de Pablo.)
- **Verificación (§6: ejercitar en BD + prueba en vivo, no asumir):**
  1. **Circuito e2e en BD** (mismas RPCs que dispara el wizard, con rollback):
     `solicitud_activar` → `emitir_comprobante_manual` (**cargo $180k en CC**) →
     `registrar_cobranza_comprobante` (**abono $180k, saldo 0**) →
     `curso_asignar_alumno` (matrícula). OK.
  2. **Prueba en vivo end-to-end**: el gerente procesa una solicitud de curso
     real por el wizard → comprobante visible en **Facturación** (`00001-…22`,
     $180.000, Pagado/Autorizado), matrícula en **Campus → curso → Alumnos**, y
     **portal del cliente** (logueado como el alumno): "1 cursos activos" +
     **Mi cuenta → Cargos $180.000** (la deuda) + curso accesible. **Reflejado
     en gerencia Y en el portal**, no sólo en tablas.
- **Hardening capitalizado (la "particularidad del curso" — matricular desde la
  solicitud):** `curso_asignar_alumno` resuelve el `profile_id` desde
  `administraciones.user_id`, que crea el paso best-effort `altaClientePortal`.
  Si ese alta fallaba, la matrícula fallaba **en silencio** (ámbar) → un curso
  **cobrado podía quedar sin matricular**. Fix (commits `a2ff588` + `74bd0c4`):
  paso "Acceso al portal" **bloqueante para curso** (idempotente → Reintentar
  seguro; captura el `user_id`), matrícula **bloqueante** (no ámbar) + helper
  `asegurarUsuarioAlumno` (`usuarios.ts`) que **resuelve o crea** el usuario del
  alumno chequeando `user_id` PRIMERO (evita re-crear/"hijackear" un user con
  otro email; el mail de bienvenida sólo se encola al crear uno nuevo). Cubre
  cliente nuevo, cliente existente sin usuario, y modal reabierto. **Lo cazó la
  auditoría §6** (BUG-A/BUG-B) antes de la prueba en vivo.
- **Prevención (lección del chunk):** al verificar un flujo financiero, **dejar
  el dato VISIBLE en la UI real (gerencia + portal del cliente)** y que el dueño
  lo confirme **antes** de limpiar el dato de prueba. Acá limpié el comprobante
  + matrícula apenas verifiqué en tablas, y Pablo no podía verlos en la gerencia
  → reclamó con razón ("¿en vivo o sólo en tablas? necesito que esté reflejado
  en gerencia y en el portal"). El smoke en tablas NO alcanza: la prueba en vivo
  es ver el efecto en las pantallas que usa el usuario.
- **Fecha / módulo:** 2026-06-09 · solicitudes/wizard (`ProcesadorFinal.tsx`,
  `useWizardActivacion.ts`) + `usuarios.ts` · Lista JL F1.

## E-GG-60 · TRAMIX: el legajo de test "pegado" aparecía precargado a otros clientes (F3 · Lista JL)

- **Síntoma (JL):** en QA consultamos un legajo de test en TRAMIX (Mesa de
  Entradas Virtual PBA). Después JL entró como **otro cliente** de prueba **en el
  mismo navegador** y, al abrir TRAMIX, apareció **precargado ese mismo número de
  test**. La consulta y el botón funcionan perfecto; el bug era *de dónde tomaba
  el número precargado*.
- **Causa raíz:** la clave `localStorage['gg.tramix.legajo']` era **por-NAVEGADOR,
  no por-usuario**, nunca se limpiaba al cerrar sesión, y al reabrir el modal
  **ganaba sobre el legajo propio del cliente** (de su ficha). → un cliente
  heredaba el último legajo consultado por OTRO usuario en esa máquina. Fuga
  cross-usuario + privacidad (no sólo el legajo de test: cualquier legajo de un
  usuario previo). **NO era la BD:** sólo un cliente (Estudio Save) tiene
  `legajo_rpac` cargado en su ficha, sin duplicados → el número de test no se
  guardó en ninguna ficha.
- **Fix (NO toca la lógica de consulta de TRAMIX, que funciona):** la clave del
  "recordar último legajo" se scopea por usuario — `gg.tramix.legajo:<userId>`
  (vía `useAuth()`) — + **purga one-time de la clave global vieja** (limpia el
  legajo de test de los navegadores que ya lo tienen). Un usuario fresco arranca
  con su propio legajo de la ficha (`initFromFicha`) o vacío; se preserva la UX
  de "recordar" pero aislada por usuario. `TramixConsultaModal.tsx`.
- **Verificación EN VIVO:** simulé la fuga (`localStorage['gg.tramix.legajo']='999999'`)
  + login como Estudio Save (legajo propio 284265) → TRAMIX mostró **284265**
  (no 999999), trajo sus 6 expedientes reales, y el localStorage quedó:
  clave global **purgada** + nueva `gg.tramix.legajo:<uid>` = `284265`. ✓
- **Prevención:** cualquier estado "recordado" en `localStorage` debe scopearse
  por usuario (o limpiarse al logout). `localStorage` es por-origen/navegador y
  **persiste entre sesiones de usuarios distintos** en la misma máquina — nunca
  guardar ahí datos de un usuario que otro no debería ver. Smell check: claves
  globales (`gg.*`) que guarden datos específicos de un usuario.
- **Fecha / módulo:** 2026-06-09 · portal · `TramixConsultaModal.tsx` · Lista JL F3.

## E-GG-61 · El aviso de "nuevas solicitudes" filtraba un estado inexistente → nunca se mostró (F7 · Lista JL)

- **Síntoma (JL):** el gerente no veía en el dashboard el aviso de solicitudes
  nuevas que ingresan por los formularios públicos. Se enteraba sólo por la
  campanita / mail, no por un banner en el Inicio.
- **Causa raíz:** `listSolicitudesPendientes` (que alimenta
  `NuevasSolicitudesWidget`) filtraba `estado = 'nueva'`, pero **`'nueva'` NO
  está en el CHECK de `solicitudes`** (`recibida` / `en_revision` / `derivada` /
  `activada` / `rechazada` / `descartada`). Las solicitudes nuevas nacen
  `'recibida'` (trigger submission→solicitud, migs 0035/0074/0135/0161).
  Resultado: el `count` daba **siempre 0** → el widget mostraba permanentemente
  el estado vacío. El aviso **nunca se disparó** desde que se creó (Bloque B /
  obs 1, tarea #160). Lo descubrí en la prueba en vivo de F7: un `UPDATE
  estado='nueva'` voló con `23514 violates check constraint`.
- **Por qué pasó inadvertido:** `.eq('estado','nueva')` no es error de compilación
  ni de runtime (Postgres acepta el literal en el filtro; sólo no matchea
  ninguna fila). La grilla de Solicitudes sí usaba el filtro correcto
  (`in ('recibida','en_revision','derivada')`), así que el dato existía — sólo el
  widget del dashboard miraba un valor fantasma, y su estado vacío parecía
  normal. Patrón hermano de **E-GG-43** (KPIs/contadores con universo mal
  filtrado): un literal de estado inexistente pasa silencioso.
- **Fix:** `listSolicitudesPendientes` filtra `estado IN ('recibida',
  'en_revision')` (las que esperan la PRIMERA acción de la gerencia: derivar o
  activar). El link "Ver todas" del widget → `?estado=activas`. Capitalizado
  junto al realtime (DGG-62): el banner ahora aparece **y** se actualiza en vivo.
  **Verificado en vivo:** el banner pasó a mostrar las 2 pendientes reales (Paul
  Test `recibida` + Expensas Pagas `en_revision`) que estaban invisibles, y al
  flipear una 3ª a `recibida` el contador subió a 3 **sin recargar** (realtime) y
  volvió a 2 al revertir.
- **Prevención:** todo `.eq('estado', '<literal>')` debe validarse contra el CHECK
  real (`pg_constraint`/`information_schema`) — un valor fantasma no falla, sólo
  devuelve 0 en silencio. Smell check: contadores que dan siempre 0 / widgets que
  nunca salen del estado vacío.
- **Fecha / módulo:** 2026-06-09 · gerencia · `solicitudes.ts` +
  `NuevasSolicitudesWidget.tsx` · Lista JL F7.

## E-GG-62 · Fuga de secretos Zoom/Webex en `webinars` (policy RLS `USING(true)`)

- **Síntoma:** capitalizado en la auditoría §6 de F6 (2026-06-09). La policy
  `webinars_authenticated_select` (mig 0050) era `FOR SELECT TO authenticated
  USING (true)`: CUALQUIER usuario `authenticated` —incluido un `administrador`
  (cliente del portal)— podía, desde la consola del navegador,
  `supabase.from('webinars').select('*')` y leer columnas SECRETAS:
  `zoom_start_url` (URL de **host**: inicia/controla la reunión), `zoom_password`,
  `zoom_meeting_id`, `zoom_meeting_number`, `webex_join_url`, `webex_password`.
  Viola la regla 3 (sin secretos en el front). No es regresión de F6 — deuda
  heredada de 0050; ningún flujo de F6 lo explota.
- **Causa raíz:** la tabla tenía DOS policies — `webinars_staff_all` (FOR ALL,
  `is_staff()`) y la permisiva `webinars_authenticated_select` (SELECT, `true`).
  Postgres combina policies del mismo comando con OR, así que el SELECT quedaba
  `is_staff() OR true` = siempre verdadero. La permisiva se agregó en 0050 con el
  comentario "para el portal alumno/cliente vea sus inscripciones", pero el portal
  NUNCA lee la tabla directo: usa RPCs SECURITY DEFINER (`cliente_webinars_listar`,
  `webinar_inscripcion_activa`, `administracion_webinars`) y la edge fn
  `webinar-acceso` (service-role, llave = token). Quedó como puerta abierta sin uso
  legítimo. El único read directo del front alcanzable por no-staff
  (`resolverEsquemaParaCert`, `campus.ts`, lee sólo `cert_esquema_id`) está
  neutralizado: la emisión de cert de webinar (0088) persiste `esquema_snapshot`,
  así que el front retorna antes de tocar la tabla.
- **Fix (mig 0214, opción (a) decidida con Pablo):** `DROP POLICY
  webinars_authenticated_select`. La tabla se lee SÓLO por gerencia
  (`webinars_staff_all` FOR ALL ya cubre el SELECT de staff). Se ELIMINÓ —en vez
  de reescribirla a `is_staff()`— para no dejar dos policies SELECT redundantes.
- **Por qué (a) y no separar secretos / vista pública:** en Supabase gerentes y
  clientes comparten el MISMO rol DB `authenticated`; la distinción staff/cliente
  es por RLS vía `is_staff()` (lee `profiles.role`), NO por rol DB. Por eso los
  GRANTs por columna NO pueden distinguirlos (revocar el SELECT de `zoom_start_url`
  a `authenticated` rompería el `select('*')` de gerencia) → **la RLS es la única
  capa válida** para el límite staff/cliente, y con la permisiva fuera queda
  correcta. Las tres formas reales de conectarse son transparentes al cambio:
  prospecto → mail con magic-link → edge fn `webinar-acceso` (service-role);
  cliente logueado → portal vía RPC SD; gerencia → staff.
- **Verificación (doble vía):** (1) **smoke R18 e2e en BD** (`DO`+`RAISE
  EXCEPTION` para rollback, lección E-GG-54): webinar sintético con secreto →
  cliente (`administrador`) ve **0 filas / 0 password**, gerente ve **1 fila + el
  password**. (2) **Prueba en vivo contra PRODUCCIÓN:** cliente QA efímero (creado
  por SQL) + login real por Auth REST → `GET /rest/v1/webinars?select=…,zoom_password,
  zoom_start_url` con su JWT → **`200 []`** (bloqueado incluso para columnas
  no-secretas); flip a gerente con el MISMO token → **ve `zoom_password`**. Cleanup
  total, residuo 0. **§6 (3 agentes):** completitud OK; **sin regresión** (todas las
  superficies reales van por SD/service_role; tenancy de `administracion_webinars`
  OK regla 12); **barrido de bugs hermanos SIN otra fuga** (ARCA cert/csr/p12,
  `curso_encuentros` zoom/webex, tokens, `cajas.cbu`, `clave_fiscal_arca` — todos
  bien gateados; los `USING(true)` restantes son catálogos públicos sin secretos).
- **Prevención:** una policy `USING (true)` de SELECT sobre una tabla con columnas
  secretas es anti-patrón aunque exista otra policy staff (el OR las suma). Toda
  `USING(true)` de SELECT requiere comentario que justifique que NO hay columnas
  secretas legibles (regla 2). **Residual aceptado** de la opción (a): si una mig
  futura re-abre un SELECT a `authenticated`, los secretos vuelven a filtrarse —
  mitigado por el COMMENT de advertencia que dejé en `webinars_staff_all` + esta
  entrada (la separación física de secretos, opción (c), lo blindaría del todo si
  algún día se justifica el costo).
- **Fecha / módulo:** 2026-06-09 · seguridad/webinars · mig
  `0214_webinars_rls_secretos_staff_only.sql` · capitalizado en auditoría §6 de F6.
