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

## E-GG-108 · "N emails atascados (cron caído?)" — dos bugs distintos detrás de un banner
- **Síntoma:** José (2026-07-13, doc wave 5) ve el banner de salud en el Inicio:
  *"Alerta crítica · Cola de emails: 5 emails atascados (cron caído?)"*.
- **Causa raíz (dos cosas independientes, no confundir):**
  1. **El banner en sí = falso positivo del throttle.** El dispatcher envía 1
     email cada 5 min (throttle global hard, E42/D05). Un burst de N emails
     legítimos tarda N×5 min en drenar, así que emails esperando +30min son
     NORMALES. El health check (`check_email_queue_atascada`) gritaba "crítico"
     ante cualquier backlog de +30min → falsa alarma recurrente. El check keyea
     `enviado_at IS NULL` (no `status`).
  2. **Bug latente separado de `status` (no era lo que veía JL).** El cron
     corría OK (2880 corridas 200) y los emails SÍ se entregaban (101 con
     registro real en `sent_emails`), pero el path de éxito de dispatch-emails
     seteaba `enviado_at` **sin avanzar `status` a 'sent'/`sent_at`** (ídem
     `failJob` agotado sin `status='failed'`). 101 emails entregados quedaban
     `'pending'` — invisible para JL (ni el health check ni EmailQueuePage leen
     `status`), pero deuda de reporting. Deriva de columnas duplicadas (R8).
- **Fix:** (a) **health-flows-check reescrito** — crítico SÓLO si hay cola
  due-sin-enviar Y el más viejo espera >20min Y el dispatcher no marcó envíos
  en ese lapso (`email_throttle.last_sent_at` stale). Distingue "throttle
  drenando" (ok) de "cron caído real". **Esto arregla el banner.** (b)
  dispatch-emails éxito → `status='sent', sent_at`; failJob agotado →
  `status='failed'` + backfill mig 0333 (las 101 → 'sent' con verdad). **Esto
  arregla la higiene de `status`, no el banner.**
- **Prevención:** una alarma cuyo umbral no contempla el throttle del sistema
  que vigila da falsos positivos crónicos. En tablas con columnas duplicadas
  legacy/nuevas (R8), toda transición de estado debe tocar AMBAS mitades.
- **Decisión de Pablo (2026-07-13):** NO tocar la tasa de envío (throttle
  heredado intacto), sólo la alarma. Verificado en vivo: health check → email
  OK "Cola de emails al día".
- **Fecha / módulo:** 2026-07-13 · emails · `health-flows-check` + `dispatch-emails` + mig 0333.

## E-GG-109 · Conciliar pago sin monto parcial ni atribución al partner
- **Síntoma:** José (2026-07-13, doc wave 5): al conciliar un pago informado
  desde "Pagos informados", el modal sólo mostraba el comprobante con su saldo
  total; *"si hace un pago parcial por acá no lo podemos imputar y tampoco
  aparece si Participa el partner"*. En cambio el flujo Cta.Cte.
  (RegistrarCobranzaDrawer) sí ofrece pago parcial + "Participa partner".
- **Causa raíz:** `pago_conciliar` imputaba `v_pago.monto` (correcto) pero el
  modal no lo mostraba ni permitía ajustarlo, y pasaba `NULL` al partner; sin
  paridad con el único otro writer de cobranzas.
- **Fix:** mig 0334 (DROP+CREATE por R16, +`p_monto` +`p_partner_id_atribucion`
  cableados a `registrar_cobranza_comprobante`, que valida monto≤saldo) +
  ConciliarModal con importe editable, preview saldo actual→este pago→saldo
  después, y selector "Participa partner". e2e: informar no mueve saldo →
  conciliar parcial $50k baja 205k→155k exacto, movimiento atribuido al partner.
- **Prevención:** consistencia contable — cada superficie que registra cobranza
  ofrece los mismos controles (parcial + partner) y pasa por el mismo writer.
- **Regresión de permisos (E-GG-109b, misma auditoría §6):** la mig 0334 usó
  `DROP FUNCTION` + `CREATE FUNCTION`. Como el proyecto tiene `ALTER DEFAULT
  PRIVILEGES` que auto-otorga EXECUTE a anon/PUBLIC en toda función nueva
  (E-GG-88), la nueva `pago_conciliar` quedó ejecutable por **anon** con la
  anon-key pública — el `DROP` borró el `REVOKE` que traía la versión original.
  Peor: el guard `IF NOT private.is_staff()` **falla-abierto para anon**
  (auth.uid()=NULL → is_staff()=NULL → `NOT NULL`=NULL → el IF no dispara).
  Fix mig 0336: `REVOKE ALL … FROM PUBLIC, anon` + guard endurecido a
  `IS NOT TRUE` (rebota NULL además de false). Verificado: anon → 42501.
  **Regla nueva de higiene:** toda mig que haga `DROP+CREATE` de una función
  staff-only debe re-emitir el `REVOKE ALL … FROM PUBLIC, anon` (no alcanza el
  GRANT); y los guards `is_staff()` deben usar `IS NOT TRUE`, no `NOT`.
- **Fecha / módulo:** 2026-07-13 · facturación · `pago_conciliar` + PagosInformadosPage + mig 0336.

## E-GG-110 · Gestoría no veía la Nota de texto que respondió el cliente
- **Síntoma:** José (2026-07-13, doc wave 5): el cliente responde un pedido de
  documentación con una **Nota de texto** (no archivo); al gestor le llega el
  mail "info nueva disponible" pero *"a gestoría no le aparece lo que completó
  el cliente (era una Nota, no era un archivo adjunto)"*.
- **Causa raíz:** `gestor_obtener_info_solicitud` agregaba los items del pedido
  con `AND it.archivo_path IS NOT NULL` → sólo los que tenían archivo; las
  respuestas de texto (`respuesta_texto`, sin archivo) quedaban excluidas del
  payload que ve el gestor.
- **Fix:** mig 0335 (CREATE OR REPLACE, misma firma): incluir items con archivo
  O `respuesta_texto`, y devolver el texto. AccesoExternoPage + generateTramitePdf
  renderizan la nota (📝) cuando no hay archivo. e2e: cliente responde
  "El Número de Legajo es 15635" → el RPC del gestor ahora devuelve el texto.
- **Prevención:** cuando un flujo acepta 2 formas de respuesta (archivo O texto),
  toda vista downstream debe contemplar ambas — no filtrar por una sola.
- **Fecha / módulo:** 2026-07-13 · gestoría · `gestor_obtener_info_solicitud` + AccesoExternoPage.

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

## E-GG-63 · Fuga de moderación en `tracking_lineas`: el cliente podía leer aportes `interno`/`descartado`/`pendiente` + texto crudo del gestor (RLS `tl_admin_select` sin `visible_cliente`) — F4 (2026-06-11)

- **Síntoma:** capitalizado en la **doble auditoría §6 de F4** (post live-test de 3
  roles gestoría→gerente→cliente). F4 introdujo aportes de gestoría que entran
  ocultos (`moderacion_estado` ∈ pendiente/interno/descartado, `visible_cliente=false`)
  y dos columnas sensibles de auditoría: `gestor_descripcion_original` (texto crudo
  del gestor, antes de la edición de gerencia) y `descarte_motivo`. La RPC del
  cliente (`cliente_tracking_lineas`, SECURITY DEFINER) filtra perfecto
  (`visible_cliente=true`, sin exponer esas columnas), PERO la **policy RLS del
  cliente `tl_admin_select`** sólo filtraba por tenancy (`tramite de su
  administración`) **sin `visible_cliente`**, y `authenticated` tiene `GRANT SELECT`
  directo. Un cliente logueado podía **saltear la RPC** con su anon key + JWT:
  `GET /rest/v1/tracking_lineas?select=gestor_descripcion_original,descarte_motivo&tramite_id=eq.<suyo>`
  y leer, de SUS propios trámites, las notas internas de gerencia, los aportes
  descartados (+ su motivo) y el texto crudo del gestor. **Hermano directo de
  E-GG-62** (misma clase: tabla con RLS por-fila para el cliente, que en realidad
  sólo debe leerse por RPC SD; F4 fue lo que creó las filas ocultas a proteger).
- **Causa raíz:** `tl_admin_select` (`USING EXISTS(tramite de current_administracion_id())`)
  predataba F4, cuando TODO aporte de gestoría era `visible_cliente=true` → no había
  nada oculto que filtrar. F4 agregó el concepto de fila oculta pero **no endureció
  la policy del cliente** (sesgo "revisar lo que está": el frontend y la RPC estaban
  bien, el agujero estaba en el camino que NINGÚN código usa pero PostgREST expone).
  El cliente nunca lee la tabla directo — el único read-path cliente es la RPC SD; no
  hay `from('tracking_lineas')` de cliente en el front (sólo gerencia, vía
  `tl_staff_all`).
- **Fix (mig 0216, `DROP POLICY tl_admin_select`):** el cliente NO necesita lectura
  directa → se elimina su policy de SELECT. Sin policy, PostgREST le deniega la tabla
  y lee SÓLO por `cliente_tracking_lineas` (SD, con su filtro `visible_cliente=true` +
  tenancy). Gerencia (`tl_staff_all`) y el INSERT del cliente (`tl_admin_insert`)
  intactos. (Mismo razonamiento que E-GG-62: gerentes y clientes comparten el rol DB
  `authenticated`; la RLS es la única capa válida del límite staff/cliente, los GRANT
  por columna no los distinguen.)
- **Hallazgos menores del mismo §6, fixeados en la misma mig/commit:**
  - **A1 (bug):** `tracking_moderar_gestor_avance` persistía `p_estado_asociado` en la
    línea **sin validar** contra el whitelist (sólo el cambio de `tramites.estado`
    filtraba) → publicar con `estado='banana'` lo guardaba. Fix: validar el estado
    temprano (`RAISE 22023`) + rechazar texto vacío al editar. Misma firma →
    `CREATE OR REPLACE` sin overload (R16 OK).
  - **A2 (R11):** FK `tracking_lineas.moderada_por` sin índice → índice parcial
    `idx_tracking_lineas_moderada_por`.
  - **Copy stale:** `AccesoExternoPage` decía bajo el textarea "El cliente recibirá un
    email y notificación push automáticamente" (contradecía el flujo de moderación);
    + comentario engañoso en `accesos.ts:gestorCargarAvance`. Reescritos al flujo F4.
  - **Type gap:** `tracking_moderar_gestor_avance` y `tracking_moderacion_pendientes`
    faltaban en `database.ts` (types sin regenerar) → enmascarado con `as never` en el
    NOMBRE de la RPC (un typo no se hubiera detectado). Regenerados (vía MCP, no el
    script CLI que pide `SUPABASE_ACCESS_TOKEN`) + quitado el `as never` del nombre.
- **Verificación (doble vía):** (1) **e2e en BD:** cliente real impersonado
  (`SET LOCAL ROLE authenticated` + JWT) — ANTES: lectura directa 4/4 filas (2 ocultas,
  1 motivo); DESPUÉS de la mig: **directo=0 filas, RPC=2 publicados** (portal intacto).
  Validaciones: `estado='banana'`→22023, texto vacío→22023, publicar normal sin
  regresión (`vis=true,mod=publicado,ea=resuelto,tramite=resuelto`). R16: 3 RPCs con
  `n=1`. (2) **Live test 3 roles en PRODUCCIÓN** (cliente QA efímero por SQL): gestoría
  carga 4 aportes vía magic-link → "Recibido · en revisión", *Historial publicado*
  vacío; gerencia modera los 4 (publicar tal cual / editar+estado→Esperando cliente /
  interno / descartar c/motivo) → toasts + cola se vacía; cliente ve **sólo los 2
  publicados** (B en su versión editada, NO el crudo "fui a afip"), badge "TU ACCIÓN",
  "2 nuevos avances" (no 4), interno/descartado ocultos; mobile sin overflow; consola
  sólo ruido de extensión. Cleanup total, residuo 0.
- **Prevención:** al agregar a una tabla columnas "ocultas/internas" o un flag de
  visibilidad por-fila, revisar que **la policy RLS del rol que la lee por-fila filtre
  esa visibilidad** — no alcanza con que la RPC SD filtre, porque el GRANT SELECT +
  policy permisiva dejan el bypass por PostgREST. Regla práctica: si una tabla se lee
  desde el cliente SÓLO por RPC SECURITY DEFINER, **no le pongas policy SELECT de
  cliente** (denegar por defecto). Smell de §6: "para cada columna nueva sensible,
  ¿quién la puede `select('*')` salteando la RPC?".
- **Fecha / módulo:** 2026-06-11 · seguridad/trackings · mig
  `0216_f4_fix_auditoria_moderacion.sql` · capitalizado en la doble auditoría §6 de F4.

## E-GG-64 · El gestor externo NO podía adjuntar documentos: el upload anon a `gestor-uploads` siempre falló (2 capas de RLS) (2026-06-11)

- **Síntoma:** Pablo, viendo la bandeja de moderación F4, preguntó "¿estamos seguros
  de que el gestor puede cargar documentación y se puede visualizar acá?, porque no
  hay ningún test con documento". Al testearlo de verdad (subir un PDF como gestor
  anónimo por la Storage API, replicando `subirAdjuntoGestor`): el upload fallaba.
  **Bug PRE-EXISTENTE** (la feature #154 de adjuntos del gestor **nunca funcionó**
  para anon); no es de F4, pero F4 lo expuso porque el flujo del gestor incluye subir
  documentación. El instinto de Pablo ("no hay test con documento") fue exacto.
- **Causa raíz (DOS capas de RLS, ambas en `storage.objects`):**
  1. **`permission denied for function is_staff`:** las 4 policies del bucket
     `certificado-assets` (`staff_insert/read/update/delete_cert_assets`) se crearon
     **`TO PUBLIC`** (en vez de `TO authenticated`) y su expresión llama
     `private.is_staff()`. Como `TO PUBLIC` aplica a TODOS los roles (incl. `anon`) y
     `anon` no tiene EXECUTE sobre `private.is_staff()`, **cualquier** operación anon
     sobre `storage.objects` (cualquier bucket) abortaba al evaluar esa policy. Esto
     rompía TODO upload anon — el del gestor y, potencialmente, uploads públicos de
     formularios.
  2. **`new row violates row-level security policy`:** una vez tapada (1), el INSERT
     seguía fallando. La policy `gestor_up_anon_insert` validaba el token con un
     `EXISTS (SELECT 1 FROM accesos_externos WHERE token = split_part(name,'/',1) …)`
     **inline**, pero `accesos_externos` tiene RLS staff-only (sin policy para anon) →
     el subquery, evaluado con los permisos de `anon`, **no ve ninguna fila** → el
     `WITH CHECK` da falso → deniega. (Un subquery dentro de una policy hereda la RLS
     de la tabla referenciada para el rol actual.)
- **Fix:**
  - **Mig 0217:** `ALTER POLICY staff_*_cert_assets … TO authenticated` (las 4). El
    bucket cert-assets es staff-only; staff es `authenticated`. Anon deja de evaluar
    `is_staff()`.
  - **Mig 0218:** helper `public.gestor_upload_path_ok(p_name) RETURNS boolean`
    **SECURITY DEFINER** (corre como owner → bypassa la RLS de `accesos_externos`;
    devuelve sólo boolean; `GRANT EXECUTE … TO anon, authenticated`) que valida que
    el 1er segmento del path sea un token de solicitud vigente. Se recreó
    `gestor_up_anon_insert` usando el helper en vez del `EXISTS` inline.
- **Verificación e2e (en vivo, anon real por Storage/REST API + portal):** ANTES:
  upload → `403 permission denied for function is_staff`; tras 0217 → `403 new row
  violates RLS`; tras 0218 → **`200`** (Key devuelta) + GET de la URL pública →
  **`200 · application/pdf · %PDF-`**. Luego `gestor_cargar_avance` con el adjunto →
  bandeja RPC `tracking_moderacion_pendientes` devuelve `archivos_urls` → publicar
  (gerente) → `cliente_tracking_lineas` devuelve el adjunto → **portal del cliente
  muestra "Descargar comprobante.pdf"** con `href` = la URL pública (200). Cadena
  completa gestoría→gerencia→cliente con documento, en vivo.
- **Prevención:** (a) una policy de `storage.objects` (o cualquier tabla) **`TO
  PUBLIC`** que llame una función de schema `private` (o cualquiera sin EXECUTE para
  anon) **rompe a TODOS los roles** que no puedan ejecutarla — toda policy con
  `is_staff()` debe ser `TO authenticated`. (b) Una policy que valide por **subquery
  a una tabla con RLS** debe usar un helper **SECURITY DEFINER** (el subquery hereda
  la RLS del rol que inserta). (c) Smell mayor: una feature "anon + token" sin un
  test e2e que ejercite el camino anon real — el sesgo "el código existe" la dio por
  funcionando durante meses.
- **Bonus (mismo turno, pedido de Pablo):** saqué el botón **WhatsApp** del estado de
  error del acceso externo (su `wa.me/5491100000000` era un placeholder roto y "no es
  el medio ideal"); queda **sólo el mail**, pre-armado con **cliente + trámite +
  servicio** vía RPC pública mínima `gestor_acceso_ref` (mig 0219, resuelve aunque el
  token venció) para que la gerencia identifique al toque qué link regenerar.
- **Fecha / módulo:** 2026-06-11 · seguridad/storage · migs
  `0217` + `0218` (+ `0219` el bonus del mail) · hallado por la pregunta de Pablo en
  el test de adjuntos de F4.

## E-GG-65 · Modal del "banco de fotos" abría fuera de pantalla (overlay `fixed` bajo ancestro con `transform`) (2026-06-12)

- **Síntoma:** al hacer clic en "Elegir del banco" (foto de docente), el modal NO
  aparecía. En el DOM existía (5 fotos), pero su `getBoundingClientRect` daba
  `top:-531, height:25036` → renderizado a ~12.500px de scroll, invisible. Cazado en
  el **live test** del chunk (no por el e2e/build, que no miran layout).
- **Causa raíz (CSS containing block):** el modal usa `className="fixed inset-0 ..."`.
  Por spec, un `position: fixed` se ancla al **viewport** SALVO que tenga un ancestro
  con `transform`/`filter`/`perspective` ≠ `none` → ese ancestro pasa a ser el
  *containing block*. El wrapper de ruta de la gerencia tiene `motion-safe:animate-route-in`
  (keyframe `route-in` con `translateY` + `animation-fill-mode: both`) → **deja un
  `transform` residual** aun terminada la animación. En una página larga (el curso
  FUNDPLATA mide ~25.000px con 20 módulos + 32 clases) el "viewport" del modal pasó a ser
  ese contenedor gigante → `inset-0` lo estiró a 25.036px y `place-items-center` lo centró
  a ~12.500px.
- **Fix:** `createPortal(<div className="fixed inset-0 ...">, document.body)` en
  `ImageUploader.tsx` para **ambos** modales (BankModal **y** CropperModal — el cropper
  arrastraba el mismo bug latente, sólo visible en páginas largas). Porteado a
  `document.body`, el overlay escapa del ancestro transformado y vuelve a anclar al
  viewport. Verificado en vivo: `parentElement === BODY`, `rect {top:0,left:0,w:1425,
  h:725}` = cubre exactamente el viewport, modal centrado y visible.
- **Prevención / deuda (agente §6):** cualquier `fixed inset-0` SIN portal bajo el
  wrapper `animate-route-in` tiene el mismo bug. El barrido halló 2 más: `EncuestaTab.tsx`
  (`fixed inset-0 z-50`) y `EncuentrosTab.tsx` (modal Webex `fixed inset-0 z-[9999]` — el
  z-index alto NO lo salva, el bug es de containing block, no de apilado). Quedan para un
  sweep aparte (sus páginas son cortas → no se disparó). Regla de dedo: **todo overlay
  `fixed` debe portearse a `document.body`** (como ya hacen `Modal`/`Drawer`/`DialogProvider`).
- **Sweep completo (commit `6355e56`):** se portearon a `document.body` los **11**
  overlays `fixed inset-0` restantes bajo el wrapper `animate-route-in` (gerencia +
  portal): campus **EncuestaTab** (emular) + **EncuentrosTab** (Webex); agenda
  **ProyectadaEmbebidaModal** + **AccionesMenu** (backdrop + menú posicionado);
  gerencia **TramiteDetailPage** (preview adjunto, inline `{preview&&}`) +
  **SolicitudDetailPage** (AdjuntoPreview) + **TrackingDetailPage** (flash drag-over,
  inline `{isDragOver&&}`) + **PartnerDetailPage** (crear usuario); finanzas
  **ConciliacionPage** (drawer); portal **PortalConsorciosPage** +
  **PortalOnboardingTour**. Los sidebars móviles de los layouts (GerenciaLayout:254 /
  PortalLayout:110) están FUERA del wrapper → no afectados, no tocados. Los modales
  comunes (Modal/Drawer/CommandPalette/CertificadoPreviewModal/EventoModal/
  FormularioRunner) ya porteaban. Build limpio; los 11 con `import:1 use:1`.
- **Fecha / módulo:** 2026-06-12 · campus/ImageUploader + sweep · commits `74eacd3`
  (banco) + `6355e56` (sweep) · cazado por el live test del banco de docentes (DGG-71).

## E-GG-66 · Encuesta de satisfacción inalcanzable para el alumno en cursos sin condiciones (2026-06-12)

- **Síntoma:** la encuesta del Curso de Actualización 2026 (DGG-74), aunque **publicada y
  con 6 preguntas**, NO aparecía por ningún lado en el campus del alumno: no tenía forma de
  responderla. Cazado en el **live test** del cierre de DGG-74 (no por el e2e de BD, que
  verifica el RPC pero no el árbol de navegación del front).
- **Causa raíz (gating de render):** en `CursoDetalleAlumnoPage.tsx` la `EncuestaAlumnoCard`
  se renderizaba SÓLO dentro del nodo `tipo === 'certificado'`. Ese nodo de navegación se
  materializa únicamente cuando el curso tiene **condiciones activas** o ya emitió
  certificado. El Curso de Actualización 2026 tiene **0 condiciones** → no existía el nodo
  'certificado' → la encuesta colgaba de un nodo que nunca se mostraba. Clase de bug R14:
  dato persistido y visible en gerencia (encuesta publicada) sin UI alcanzable que lo consuma
  del lado del alumno.
- **Fix (commit `8dea638`):** la encuesta pasó a tener **nodo de navegación propio**
  ("Encuesta de satisfacción", ícono `ClipboardList`), gateado por `encuestaActiva`
  (`!!encuesta?.activa && (schema.preguntas?.length ?? 0) > 0`), independiente del nodo
  certificado. Se carga `getEncuestaPorCurso` en el `Promise.all` de la página (con reset en
  la rama de error). `CondicionesAlumnoPanel` quedó solo en el nodo certificado.
- **Prevención (R14):** para features con superficie de alumno el live test debe ejercitar el
  curso **más simple** (sin condiciones, sin certificado), no solo el "completo" — los nodos
  condicionales esconden gaps. La doble auditoría estática miró el componente pero no el árbol
  de nodos que lo monta; el browser lo cazó en 1 reload.
- **Fecha / módulo:** 2026-06-12 · campus/CursoDetalleAlumnoPage · commit `8dea638` · cazado
  por el live test de DGG-74.

## E-GG-67 · Foto de docente cruzada en el banco: Gerardo Rodriguez Arauco mostraba a Raúl Castro (2026-06-12)

- **Síntoma:** en el módulo "Contratación de proveedores…" del curso de formación RPAC
  (f76f9ab3), el docente "Dr. Gerardo Rodriguez Arauco" mostraba la foto de OTRA persona
  (la cara del Dr. Raúl Castro). Reportado por Pablo con captura. **Error silencioso:** la
  foto es válida (existe, carga, recorte prolijo) — sólo es la persona equivocada → ni build
  ni e2e ni smoke lo detectan, únicamente el ojo humano.
- **Causa raíz (pick visual errado en bulk, DGG-71):** al poblar las 20 fotos de docentes del
  curso desde el banco, el módulo de Gerardo (`c54593cb`) quedó apuntando a
  `modulo-docente/14cb7ba8-…/castro.png` (la foto de Castro, scope de su módulo en OTRO
  curso) en vez de `modulo-docente/banco-formacion/gerardo-rodriguez-arauco.png` (su foto
  correcta, que SÍ se había subido bien al banco). Un pick equivocado en 1 de las 20; las
  otras 19 quedaron bien.
- **Diagnóstico anti-suposición:** la primera lectura de las 2 capturas de Pablo era ambigua
  (¿cuál cara es Gerardo?) e incluso me llevó a invertir la conclusión. Se resolvió con
  **ground truth**: las collages fuente (`Lic. Carlos C/2.png`) traen el NOMBRE arriba de
  cada foto → Gerardo = el señor de la biblioteca/saco gris (`gerardo-rodriguez-arauco.png`),
  Castro = el de barba candado (`castro.png`). Lección: ante fotos/identidades, verificar
  contra la fuente etiquetada, no contra la memoria ni la inferencia (regla §6: EJERCITAR).
- **Fix (data, sin migración):** `UPDATE curso_modulos SET docente_foto_url = <…/banco-formacion/gerardo-rodriguez-arauco.png>`
  en `c54593cb`, con guard por `docente_nombre` + `LIKE '%/castro.png'` + `RETURNING` (1
  fila). Sin pérdida de calidad: se reapunta al original que ya estaba en el banco, no se
  recorta de la captura. El módulo de Castro (otro curso, 488b58c3) quedó intacto (verificado
  en vivo: sigue su barba candado bajo "Dr. Raúl Castro").
- **Prevención / barrido:** auditadas las **20** fotos del curso (docente ↔ nombre de
  archivo): todas matchean tras el fix; Gerardo era la única cruzada. Regla de dedo: tras un
  poblado VISUAL en bulk (fotos/avatares desde un banco) correr un check nombre↔archivo + una
  pasada visual — los errores de "persona equivocada" son invisibles para build/e2e.
- **Hueco gemelo resuelto (a pedido de Pablo):** el CV de Gerardo estaba en el banco como
  `…/modulo-docente-cv/banco-formacion/gerardo-rodriguez-arauco.pdf` pero su módulo lo tenía
  en NULL (link que quedó sin hacer en DGG-73). Aplicando la misma cautela del cruce, se
  **verificó el contenido del PDF antes de enlazar** (es su CV real: "Estudio Rodriguez
  Arauco & Asociados", abogado UNMdP 1989, asesor CAPHPBA; idéntico byte-a-byte al del disco
  657518 B) y se enlazó con `UPDATE curso_modulos SET docente_cv_url` (guard `id` +
  `docente_cv_url IS NULL` + `RETURNING`, 1 fila). Verificado en vivo: el módulo muestra foto
  + "CV DEL DOCENTE · gerardo-rodriguez-arauco.pdf" descargable.
- **Fecha / módulo:** 2026-06-12 · campus/curso_modulos (data fix: foto + CV) · reportado por
  Pablo, ambos verificados en vivo (gerencia; foto vía gerente QA efímero residuo 0, CV vía
  reuso sólo-lectura de la sesión de Pablo).

## E-GG-68 · Wizard de activación: el paso 6 (Campus) se salía del modal (Stepper sin manejo de overflow) (2026-06-12)

- **Síntoma:** en el "Wizard de activación" de solicitudes de curso/webinar (que suman un 6º
  paso "Campus"), el 6º paso aparecía cortado / fuera del modal. Reportado por JL (JL 2 · obs
  4): "el paso 6 es como que está fuera del Wizard… es un tema de cómo se ve".
- **Causa raíz:** `Stepper.tsx` renderizaba `[círculo] ETIQUETA` por paso, cada `<li>` con
  `flex-1` y sin `min-w-0` → los flex items no encogen bajo su contenido (min-width auto). Con
  5 pasos la suma de anchos entraba en el modal de 820px; con 6 (Campus) la superaba y el
  último se clippeaba. En mobile (360px) ni 5 entraban.
- **Fix (commit `0283bf6` + hardening):** nuevo modo `compact` en el Stepper (prop opt-in,
  scopeado al wizard): círculos numerados + conector en una fila y el nombre del paso activo
  abajo ("Paso 3 de 6 · Comprobante"). Escala a cualquier cantidad de pasos y a 360px. Los
  otros 5 usos del Stepper (drawers de 3-5 pasos: cobranza, comprobante, emisores, cliente,
  consorcio) no pasan `compact` → quedan idénticos (regresión cero, verificado por agente).
  La auditoría §6 sumó `aria-current="step"` en el paso activo (ambos modos) + clamp defensivo
  del índice del caption.
- **Verificado en vivo:** wizard de curso (6 pasos, 6º visible, "PASO 1 DE 6" + progresión con
  check verde al avanzar) y wizard no-curso (5 pasos). Solicitudes sintéticas QA por SQL,
  residuo 0.
- **Prevención:** un Stepper horizontal con etiqueta por paso no escala; para N pasos o anchos
  chicos usar el modo compacto (círculos + nombre del activo). Todo flex con contenido que
  pueda desbordar necesita `min-w-0`/estrategia de shrink, o un layout que no dependa del
  ancho total.
- **Fecha / módulo:** 2026-06-12 · components/common/Stepper + solicitudes/wizard · commit
  `0283bf6`.

## E-GG-69 · Hallazgos de la auditoría §6 de encuentros compartidos (F11/DGG-79) — 2026-06-14

Auditoría §6 (3 agentes estáticos + e2e en BD) del feature DGG-79. Hallazgos y
tratamiento:

**Corregidos en el mismo chunk (mig 0239 + campus.ts):**
- **R11 — FK sin índice:** faltaba índice en
  `encuentro_sesiones_compartidas.created_by` → agregado.
- **Idempotencia del fan-out:** Zoom entrega webhooks *at-least-once*; un evento
  reenviado inflaba `tiempo_conectado_seg` (podía flipear `presente`→true). Fix:
  dedupe exacto `(evento, ocurrido_at)` en el CTE de `encuentro_sesion_zoom_evento`
  antes de aparear join/leave. Verificado e2e (doble entrega del mismo join+leave →
  tiempo estable en 2400s).
- **Coalesce con fecha stale:** `s.fecha_hora ?? row.fecha_hora` podía usar una
  fecha vieja de la fila de participación al gatear el ±10min. Fix: la sesión es
  la verdad única → se toma `s.*` directo.
- **URL host al alumno (widening):** el embed de la sesión traía `zoom_start_url`/
  `webex_start_url` (link de ANFITRIÓN) al payload del alumno. **Es paridad** con
  el flujo legacy (`curso_encuentros` ya lo exponía vía RLS + `select('*')`), pero
  F11 lo ensanchaba a todos los alumnos de los cursos enganchados. Fix:
  `listEncuentros(cursoId, { incluirHostUrl })` — sólo el gerente lo pide; para
  alumnos el embed de la sesión NO trae las URLs de host.

**Sin fugas de acceso entre cursos** (verificado e2e): la firma SDK valida contra
el `curso_id` del encuentro pedido (un alumno necesita su propia matrícula); el
fan-out sólo marca presente donde la persona tiene matrícula.

**Paridad pre-existente del pipeline legacy — hardering hecho 2026-06-14 (commit
`7c5c922`):**
1. **RESUELTO (mig 0244):** idempotencia en `curso_encuentro_zoom_evento` — dedupe
   exacto `(evento, ocurrido_at)` en el CTE, igual que el fan-out de sesiones
   (0239). Smoke e2e: doble entrega del mismo join+leave → tiempo estable (3600s).
2. **RESUELTO (campus.ts):** `listEncuentros` para alumnos ya NO trae
   `zoom_start_url`/`webex_start_url` en el select base (standalone), igual que el
   embed de la sesión. El gerente (`incluirHostUrl`) los sigue recibiendo.
3. **RESUELTO → DGG-82 (ciclo de acceso post-finalización, mig 0245):**
   `zoom-sdk-signature` rechazaba `completada`. Pablo lo reencuadró en un feature:
   al terminar un curso (se emite el cert — auto o por cierre de trámite de
   gerencia) la matrícula pasa a `completada` y conserva acceso N días
   (`cursos.dias_acceso_post`, default 30) para repasar; luego un cron la pasa a
   `vencida`. El guard de la firma SDK quedó alineado a la VENTANA (activa O
   completada-en-ventana), espejo de `private.curso_matriculado`. Ver DGG-82 en
   DECISIONES.md.

- **Fecha / módulo:** 2026-06-14 · F11 encuentros compartidos · mig 0239 +
  campus.ts/listEncuentros · commit `26dc5e3` (fixes ya incluidos en el commit del
  feature). Hardening legacy (ítems 1-2): mig 0244 + campus.ts · commit `7c5c922`.

## E-GG-70 · El partner no veía ni descargaba sus propias constancias (policy RLS con subquery a `movimientos` staff-only) — 2026-06-16

**Contexto (DGG-85 · Fase A).** Los adjuntos de egresos (`movimiento_adjuntos`,
mig 0246) deben poder descargarse por el partner desde su sábana. Las policies
partner — `mov_adj_partner_select` (tabla) y `mov_adj_obj_partner_select`
(storage.objects) — verificaban la pertenencia con un subquery
`EXISTS (SELECT 1 FROM public.movimientos m WHERE … m.partner_id_atribucion = private.current_partner_id())`.

**Causa raíz.** Una `USING`-expr de RLS evaluada por el rol del partner ejecuta ese
subquery **también bajo la RLS de `movimientos`**, que sólo tiene
`movimientos_select_staff USING is_staff()` — sin policy SELECT para partners. Para
un partner el subquery devuelve 0 filas ⇒ el predicado da **false siempre**.
Resultado: el partner NO veía (`fetchAdjuntosMovimiento` → 0 filas pese a
`adjuntos_count>0`) NI descargaba (`createSignedUrl` denegado) sus PROPIAS
constancias. Gerencia funcionaba sólo porque `is_staff()` corta por la staff-policy.
El aislamiento cross-partner SIEMPRE estuvo intacto (A nunca vio lo de B).

**Cómo se encontró.** §6 (agente A, EJERCITAR e2e bajo impersonación real de
partner): `A_ve_propio=0`, `A_sees_movimiento=0`. Los agentes B/C que sólo
revisaron lo estático o probaron el caso *deny* (A no ve a B) lo dieron por OK — la
lección refuerza la premisa §6: **el e2e bajo el rol real es lo que lo cazó**, no la
lectura estática.

**Fix (mig 0249).** Dos helpers SECURITY DEFINER que resuelven la pertenencia
esquivando la RLS de `movimientos`, **sin ampliar** el acceso directo del partner a
esa tabla: `private.partner_owns_movimiento(uuid)` y
`private.partner_owns_adjunto_path(text)`. Ambas policies partner recreadas para
llamarlos. Verificado e2e (rollback): A ve su propio adjunto (1), no ve el ajeno
(0), staff ve ambos (2); helpers own/other = t/f. Live en prod (partner QA): abre el
clip, lista la constancia y la descarga (signed URL 200, la imagen sirve).

**Regla / smell.** Toda policy RLS cuyo `USING` haga subquery a OTRA tabla con RLS
restrictiva queda **silenciosamente vacía** para el rol no privilegiado. Si una
policy depende de leer otra tabla con RLS, envolver el chequeo en un helper
`SECURITY DEFINER` (patrón `current_partner_id`/`is_staff`), nunca inline.

- **Fecha / módulo:** 2026-06-16 · DGG-85 Fase A · adjuntos del partner · mig 0249 ·
  commit `05ceb8e` (el mensaje de ese commit y el comentario original de la mig lo
  rotularon "E-GG-44" por error; el ID correcto es **E-GG-70**).

## E-GG-71 · Un índice ÚNICO de un modelo viejo aborta el modelo nuevo (y no aparece en `pg_constraint`) — 2026-06-16

**Contexto (DGG-86).** Al pasar la rendición del partner de FACTURADO (1 fila por
comprobante) a COBRADO (1 fila por cobranza/imputación), `partner_crear_rendicion`
empezó a insertar varias filas con el mismo `comprobante_id` cuando un comprobante se
cobra en partes dentro del mismo período.

**Causa raíz.** Sobrevivía un índice único del modelo viejo:
`uq_pat_rend_comprobante (rendicion_id, comprobante_id, tipo) WHERE comprobante_id IS NOT NULL`.
Con cobro parcial multi-cobranza en el período → dos filas `(rend, comprobante, 'ingreso')`
→ **`unique_violation`** → la RPC entera aborta y **NO crea la rendición**. Es justo el
caso de cobro parcial (DGG-84), el más común.

**Doble fallo de detección.** (1) Mi chequeo inicial de constraints consultó
`pg_constraint` — y **un `CREATE UNIQUE INDEX` NO aparece ahí**, sólo en `pg_indexes`
(las constraints UNIQUE creadas con `ALTER TABLE ADD CONSTRAINT` sí; los índices únicos
sueltos no). (2) Mi e2e inicial usó **una** cobranza por comprobante **por período**, así
que nunca chocó el índice. Lo cazó el **agente §6 (REVISAR)** ejercitando dos cobranzas
parciales del mismo comprobante en el mismo período — antes del merge.

**Fix (mig 0251).** `DROP INDEX uq_pat_rend_comprobante` + `CREATE UNIQUE INDEX
uq_pat_rend_imputacion (rendicion_id, imputacion_id) WHERE imputacion_id IS NOT NULL` —
la unicidad correcta del modelo cobrado (una atribución por cobranza por rendición). El
único de egresos (`uq_pat_rend_movimiento`) queda igual. Re-e2e OK (2 parciales → 2 líneas,
70k/21k, sin abortar).

**Reglas / smell.** (a) Al cambiar la **cardinalidad** de un modelo (de 1-por-X a
N-por-X), revisar **TODOS** los índices/constraints ÚNICOS de la tabla, no sólo los CHECK.
(b) Para listar la unicidad real consultar **`pg_indexes`** (o `\d tabla`), NO sólo
`pg_constraint`. (c) El e2e debe cubrir la **multiplicidad** (varias filas del mismo
padre en el mismo lote), no un caso 1:1 — si no, los únicos no se ejercitan.

- **Fecha / módulo:** 2026-06-16 · DGG-86 · rendición a cobrado · migs 0250 (cambio) +
  0251 (fix del índice). Hallado en §6 antes del merge (no llegó a producción).

## E-GG-72 · Fecha date-only corrida un día en el portal del partner (`new Date('YYYY-MM-DD')` parsea UTC) — 2026-06-16

**Síntoma.** En el portal del partner, la tabla "Rendiciones" mostraba el período corrido
un día: una rendición `periodo_desde=2026-06-01`/`periodo_hasta=2026-06-30` se veía como
"31 de may de 2026 → 29 de jun de 2026". Gerencia (`RendicionDetailPage`) lo mostraba bien.

**Causa raíz.** `PartnerPortalPage.tsx` tenía un helper LOCAL `fmtDate` que hacía
`new Date(iso).toLocaleDateString('es-AR', …)`. Para un `date` de Postgres ('YYYY-MM-DD'),
`new Date('2026-06-01')` se parsea como **UTC medianoche**; al formatear en AR (UTC-3)
retrocede al día anterior. El repo YA tiene `src/lib/dates.ts` (`parseLocalDate` +
`formatDateShort/Long`) creado para exactamente esto — gerencia lo usa, el portal no.
Afectaba 4 campos date-only del portal (período de rendición + 3 `fecha`).

**Fix.** El `fmtDate` local ahora parsea con `parseLocalDate` (mismo formato, sólo el día
correcto). `SabanaPartner` ya estaba bien (usa `formatDateShort`). `pasaFiltro` compara
strings ISO ('YYYY-MM-DD'), TZ-safe. Sólo display, no toca datos.

**Regla / smell.** NUNCA `new Date(str).toLocaleDateString()` sobre un `date` de Postgres:
usar `parseLocalDate`/`formatDateShort`/`formatDateLong` de `@/lib/dates`, o parsear
'YYYY-MM-DD' a mano. Los `timestamptz` (con hora/TZ) sí van con `new Date()` directo (o
`formatDateTime`); y para mostrar SÓLO la fecha de un `timestamptz` en hora local usar el
nuevo **`formatTimestampDate(ts, 'short'|'long')`** — NO `formatDateShort/Long` (ésos
cortan a 10 chars = fecha UTC y muestran el día siguiente para registros de la tarde-noche AR).

**Sweep completo (Pablo: "auditá a fondo, que no queden cuestiones pendientes") — 2026-06-16.**
Auditoría de TODO `src/` con 6 agentes en paralelo (por grupos de módulos disjuntos),
cruzando cada call-site contra el tipo real de la columna (36 columnas `date` vs 310
`timestamptz` en el schema). Resultado:
- **Bug primario (date-only + `new Date` crudo) — 11 fixes en 9 archivos** (todos a
  `parseLocalDate`, formato preservado): `facturacion/ComprobantesListPage` (export XLS
  comprobantes.fecha), `campus/GestionMatriculasTab` (curso_matriculas.vigencia_hasta),
  `vencimientos/MiniMapaVencimientos` (heatmap) + `vencimientos/VencimientosListPage`
  (export XLS) (fecha_vencimiento), `clientes/AdministracionDetailPage` ×2
  (matricula_rpac_vencimiento), `configuracion/EmisoresPage` (cert ARCA cert_valido_hasta),
  `reportes/generateComprobantesReporteXlsx` + `reportes/generateCtaCteReporteXlsx`
  (celdas XLSX con dateStyle), `portal/PortalHome` ×2 (vencimiento + vigencia_hasta del
  portal cliente). **Ojo XLS/PDF:** SheetJS/ExcelJS serializan el `Date` por componentes
  UTC ⇒ un `new Date(date-only)` exporta el día anterior, igual que en pantalla.
- **Bug secundario (`timestamptz` formateado con `formatDateShort/Long` → un día DESPUÉS
  para registros de tarde-noche) — 5 fixes** vía el nuevo `formatTimestampDate`:
  `servicios/VouchersTab` (expira_at, que se guarda 23:59:59 local ⇒ **siempre** salía un
  día tarde), `servicios/ServicioDetailPage` (precio_audit.created_at),
  `campus/EncuestaTab` ×2 (created_at), `recupero/AccionRecuperoCard` (enviado_at).
- **Ya correcto (confirmado, no se tocó):** Finanzas/Conciliación (`+'T00:00:00'`),
  gerencia rendición + `SabanaPartner` (`@/lib/dates`), PDF fiscal de comprobantes
  (`generateComprobantePdf` usa un `parseLocalDate` local), agenda (los 3 campos date-only
  no se formatean con `new Date` crudo; el único uso en cómputo de recurrencia ya es
  TZ-safe con `T23:59:59`), y todos los `*_at`/`fecha_hora` de webinars/encuentros/exámenes
  (timestamptz legítimos).
- **DUDAS resueltas:** `acceso-externo/AccesoExternoPage` mostraba `fecha_solicitud`/
  `fecha_estimada` que **no existen** en el payload de la edge fn (devuelve
  fecha_inicio/fecha_fin/vence_at) → `Item` retorna null en undefined ⇒ no se muestran, sin
  bug TZ (queda como nota: el seguimiento público no muestra las fechas del trámite porque
  lee campos inexistentes — gap funcional pre-existente, fuera de scope). El ICS cae a
  `vence_at` (timestamptz) → UTC en ICS es estándar, OK.

- **Fecha / módulo:** 2026-06-16 · portal partner · `PartnerPortalPage.tsx` (fmtDate →
  parseLocalDate). Display-only.

## E-GG-73 · El gate de cobranza decía "no tiene cobranza registrada" aun con pago a cuenta (copy hardcodeado, no miraba el saldo) — 2026-06-17

**Síntoma.** (Reportado por Pablo con captura.) Al avanzar un trámite con cobro pendiente,
el confirm decía *"Este trámite no tiene cobranza registrada. Por lo tanto, está impago."*
— pero el caso tenía un **pago a cuenta** (comprobante $410.000, saldo $205.000). La
reacción (advertir) era correcta; el mensaje era falso: no distinguía "sin ninguna
cobranza" de "saldo parcial".

**Causa raíz.** El gate (`useAvanzarTramite.tsx`) decide con el booleano `cobro_pendiente`
(= existe comprobante con `saldo_pendiente>0`), que es TRUE tanto sin pagos como con pago
parcial — **correcto**. El problema era 100% de **copy**: el string estaba hardcodeado y la
fila (`TramiteListItem`) sólo traía el booleano, sin el dato para diferenciar. No era un
error de lectura de datos.

**Fix.** Campo calculado `public.cobro_estado(tramites)` (mig 0255), hermano de
`cobro_pendiente`, mismo universo de comprobantes (propio o vía `solicitudes`; no anulado;
total>0; saldo>0): devuelve `'parcial'` (algún `saldo<total` → pago a cuenta),
`'sin_cobranza'` (todos `saldo=total` → impago sin pagos) o `NULL`. `listTramites` lo trae;
`TramiteListItem` lo tipa; el hook arma el copy según `cobro_estado` en el confirm de avance
(parcial → "tiene un pago a cuenta, queda saldo pendiente" / título "Trámite con saldo
pendiente"; sin pagos → "no tiene ninguna cobranza registrada") y en el toast de cierre
("Completá" vs "Registrá"). e2e datos reales: 410k/205k → `parcial`; 145k/145k → `sin_cobranza`.

**Hallazgos de la auditoría §6 (cerrados en mig 0256):**
- *(A)* `cobro_estado` no revocaba `EXECUTE` de `PUBLIC`/`anon` ni lo concedía a
  `authenticated`, a diferencia de sus hermanas `cobro_pendiente` (0194) y
  `comprobante_pendiente` (0207). RLS ya impedía el leak (anon sin policy en
  comprobantes/solicitudes → ve NULL), pero violaba R3 y dispararía el advisor. Alineado:
  ACL ahora idéntica a las hermanas. (Smell: toda función nueva expuesta a PostgREST debe
  REVOKE PUBLIC/anon + GRANT authenticated en la MISMA mig.)
- *(B)* El backstop de cierre en BD (`trg_tramite_cerrar_exige_cobrado`, mig 0252; vía del
  detail page `CerrarTramiteDialog` → RPC `tracking_cerrar`) mostraba siempre "Registrá la
  cobranza". Ahora el RAISE distingue parcial ("Completá") de sin cobranza ("Registrá"),
  espejando el hook. e2e (rollback): RAISE parcial sobre 00041 → "pago a cuenta … Completá";
  RAISE sin_cobranza sobre 00038 → "no tiene ninguna cobranza … Registrá".

**Regla / smell.** Si el copy de una advertencia afirma un hecho sobre los datos
("no tiene X", "está vacío", "venció"), ese hecho tiene que salir de los datos, no de un
string fijo. Si la fila no trae el dato para diferenciar, falta un campo calculado — no un
texto más prolijo. Prueba en vivo (sesión real de Pablo, sólo-lectura): confirm parcial y
toast sin_cobranza renderizan el copy correcto en `v02ba903`; consola limpia.

**Fecha / módulo:** 2026-06-17 · trámites · migs 0255/0256 + `tramites.ts` +
`useAvanzarTramite.tsx`. Capitaliza DGG-88.

## E-GG-74 · El mail de "Pedir y dejar en revisión" salía vacío (manaxer-v1 con cuerpo visual vacío ignora el `body_html`) — 2026-06-18

**Síntoma.** (Reporte JL.) Al usar "Pedir y dejar en revisión" en el wizard, al cliente le
llegaba el mail "Necesitamos algo más para tu solicitud" **vacío (sólo el logo)** — no decía
qué le faltaba. Y "no se cargaba nada en el portal".

**Causa raíz.** El dispatcher `dispatch-emails` bifurca el render por `layout_version`: para
`manaxer-v1` arma el cuerpo SÓLO desde los campos `titulo_visual`/`kicker`/`cuerpo_html_visual`
e **ignora `body_html`**. La plantilla `solicitud-docs-revision` estaba en `manaxer-v1` con esos
3 campos VACÍOS; el HTML rico con `{{mensaje}}` vivía en `body_html` (código muerto). El
`mensaje` se pasaba bien desde la RPC; se perdía en el render. (Lo de "nada en el portal" es
**por diseño**: esa rama NO abre trámite — el canal es el mail/respuesta; sólo el notif/push
apuntaban a `/portal/solicitudes`, ruta inexistente.)

**Fix.** Mig 0259: poblar los campos visuales del template con el detalle `{{mensaje}}` +
"respondé este correo"; corregir la ruta del notif/push a `/portal`. **Sweep §6:** se encontró
la MISMA falla en `gerencia-notif-generica` (alto tráfico: cierre/reapertura/fan-out/moderación/
trámite-resuelto) → mig 0262 puebla sus campos visuales. (Las otras 35 plantillas manaxer OK.)

**Regla / smell.** Plantilla `manaxer-v1` ⇒ el cuerpo va en `cuerpo_html_visual`, NO en
`body_html` (que el dispatcher ignora). Toda plantilla manaxer con `cuerpo_html_visual` vacío
manda mail vacío.

**Hardening implementado (2026-06-18, edge fn dispatch-emails v12).** (a) **Fallback en el
dispatcher:** si una plantilla `manaxer-v1` renderiza `cuerpo_html_visual` vacío Y existe
`body_html`, cae al render legacy completo (`renderVars(body_html)`) en vez de mandar "sólo
logo". Sólo se reemplaza todo el html (body_html es un documento entero; no se inyecta en el
layout). Verificado: unit test del decisor 5/5 + SQL (0 de 37 templates manaxer disparan el
fallback hoy → cero cambio de comportamiento en los vigentes; es defensa para el futuro). (b)
**Validación en el editor** (`EmailTemplatesPage.handleSave`): bloquea guardar una plantilla con
el cuerpo vacío (sin texto tras quitar tags y sin `<img>`).

**Fecha / módulo:** 2026-06-18 · email · migs 0259 + 0262 (datos de email_templates) +
`solicitud_pedir_docs_revision`.

## E-GG-75 · El pedido de documentación era archivo-only: pedir un DATO trababa al cliente — 2026-06-18

**Síntoma.** (Reporte JL.) Gerencia abrió el trámite y pidió el "número de legajo" en un Pedido
de documentación. El cliente, en el portal, **sólo podía SUBIR un archivo** — no había forma de
responder con texto el dato pedido → quedaba trabado (el botón "Enviar a gerencia" nunca se
habilitaba).

**Causa raíz.** El sistema `tramite_pedidos_doc_items` era archivo-only en las 4 capas (modelo,
RPC, portal, gerencia): un ítem se completaba sólo con `archivo_path`. No existía un campo de
respuesta de texto del cliente.

**Fix (decisión de Pablo: cualquier ítem se responde con texto O archivo).** Mig 0260: columna
`respuesta_texto` + RPC `tramite_pedido_doc_responder_texto_item` (deja el ítem en 'subido',
entra al flujo de aprobación). Frontend `PedidosDocPanel`: input de texto del cliente + render de
la respuesta (la ve gerencia para aprobar) + badge "Respondido" + gating por respuesta (no sólo
archivo). Servicio `responderTextoItem`.

**Hallazgo de seguridad (lo cazó el e2e §6) — mig 0261.** La RPC nueva quedó (a) con `EXECUTE`
para `anon`/PUBLIC (default de `CREATE FUNCTION`; las hermanas sólo lo tienen `authenticated`) y
(b) con el patrón heredado `v_role NOT IN ('gerente')` que con `auth.uid()` NULL evalúa NULL →
el `IF` no dispara → **bypass del guard**. Combinados, un anon con un item_id válido podía
escribir. Fix: REVOKE anon/PUBLIC + GRANT authenticated + guard robusto (`IF v_user_id IS NULL
THEN RAISE` + `COALESCE(v_role,'') <> 'gerente'`). e2e: bloqueo sin-auth ✓ y cross-tenant ✓.

**Deuda latente → CERRADA (mig 0263, sweep preventivo).** Barrido de TODAS las funciones
SECURITY DEFINER con el patrón `role ... NOT IN (...)` sin manejo de NULL → **7 funciones**, todas
NO anon-ejecutables (bypass latente, no explotable). Se endurecieron las 7 con `IF auth.uid() IS
NULL THEN RAISE` + `COALESCE(v_role,'')`: las 5 de pedidos de doc (subir/crear/aprobar/rechazar +
`enviar_revision`) + **`actualizar_gerente`** (gestión de roles — la más sensible) +
`restaurar_formulario_version`. e2e (rollback): no-auth → 7/7 RAISE "No autenticado"; wrong-role
crear → "Solo gerencia"; correct crear → pedido+2 items; actualizar_gerente op→gerente OK. ACL
sigue sólo {authenticated, service_role} (sin anon); 0 overloads (R16).

**Regla / smell.** En plpgsql `SECURITY DEFINER`, `x NOT IN (...)` con `x` NULL devuelve NULL
(el `IF` no entra) → NUNCA confiar sólo en eso para autorizar; abrir con `IF auth.uid() IS NULL
THEN RAISE` y usar `COALESCE`. Y toda función nueva expuesta a PostgREST: REVOKE anon/PUBLIC +
GRANT authenticated en la misma migración (las hermanas lo tenían; la nueva nació con el default).

**Verificación.** §6 (3 agentes REVISAR sin GAP crítico + EJERCITAR e2e con contexto de rol:
responder→subido+trim+subido_por admin; bloqueo sin-auth y cross-tenant) + prueba en vivo (cliente
QA responde "LEGAJO-99887" → "Respondido" + "Enviar a gerencia" habilitado; gerencia ve el dato +
Aprobar/Rechazar; consola limpia; QA limpiado residuo 0).

**Fecha / módulo:** 2026-06-18 · pedidos de documentación · migs 0260+0261 +
`tramitePedidosDoc.ts` + `PedidosDocPanel.tsx`. Capitaliza DGG-89.

---

## E-GG-76 · Saldo a favor: la 1ª versión violaba `chk_imp_destino_xor` (2026-07-01)

**Contexto (DGG-91 / reporte JL #3).** Al anular un comprobante ya pagado (inscripción duplicada)
el pago queda como ingreso sin imputar = crédito. La RPC nueva `imputar_credito_a_comprobante`
(mig 0265) lo aplica a otra deuda insertando en `movimiento_imputaciones`.

**Bug (lo cazó el e2e §6 ANTES de producción).** El INSERT seteaba `administracion_id =
v_comp.administracion_id` **junto con** `comprobante_id`. Pero el destino de una imputación es un
XOR: `chk_imp_destino_xor = (comprobante_id NOT NULL AND administracion_id NULL) OR (comprobante_id
NULL AND administracion_id NOT NULL)`. Setear ambos → violación de check → la RPC fallaba en el
primer uso real. **Fix:** `administracion_id = NULL` cuando el destino es un comprobante.

**Regla / smell.** Antes de insertar en una tabla con constraints XOR de destino, leer
`pg_get_constraintdef` y setear SÓLO la columna del destino elegido. El e2e sintético
(BEGIN/ROLLBACK que ejercita la RPC de verdad) lo encontró en el primer intento; el build limpio
y el smoke SELECT no lo habrían visto (R18).

**Fecha / módulo:** 2026-07-01 · cobranzas · mig 0265. Nunca llegó a producción.

---

## E-GG-77 · CRÍTICO: desimputar un saldo a favor destruía el crédito (2026-07-01)

**Contexto.** `desimputar_cobranza` (botón XCircle en `ComprobanteDetailPage`) limpiaba el
movimiento cuando quedaba en 0 imputaciones + `origen='facturacion'` (cleanup legítimo de una
cobranza registrada por error).

**Bug (lo cazó el agente C de la doble auditoría §6, e2e).** Un CRÉDITO (pago de un comprobante
anulado, `origen='facturacion'`) aplicado a otro comprobante y luego desimputado caía en esa misma
rama: `v_remaining=0 AND origen='facturacion'` → **DELETE del movimiento** → se destruía el crédito
remanente **y** el registro del pago original del comprobante anulado. Pérdida de dato irreversible,
alcanzable con un click. e2e: `credito sobrevive tras desimputar = false`.

**Fix (mig 0266).** Sólo borrar el movimiento si es una cobranza "fresca" del MISMO comprobante:
`AND v_mov.comprobante_id IS NOT DISTINCT FROM v_imp.comprobante_id`. Invariante:
`registrar_cobranza_comprobante` setea `mov.comprobante_id = imp.comprobante_id`; un crédito
aplicado a otro comprobante los tiene DISTINTOS → se conserva y vuelve a quedar disponible.
e2e (post-fix): crédito sobrevive ✓ · B restaurado ✓ · crédito disponible de nuevo ✓ · regresión
(cobranza normal SÍ borra su movimiento) ✓. **Verificado en vivo** (quitar saldo a favor en el
browser → `credito_movimiento_sobrevive=true`, disponible $150.000).

**Regla / smell.** Antes de un `DELETE` de cleanup condicionado por `origen`, verificar que la fila
no sea reutilizable/compartida por otro flujo. `origen='facturacion'` no distingue "pago de este
comprobante" de "crédito aplicado desde otro". El discriminador correcto fue comparar el destino
(`mov.comprobante_id` vs `imp.comprobante_id`).

**Fecha / módulo:** 2026-07-01 · cobranzas · mig 0266.

---

## E-GG-78 · Reversa de un ingreso con crédito ya aplicado (guarda faltante) (2026-07-01)

**Contexto/Bug (agente C §6).** `fz_revertir_movimiento` no tenía guarda para un ingreso cuyo
crédito ya fue aplicado a OTRO comprobante: generaba un contrasiento por el monto **total** del
ingreso (posible descuadre de caja si el crédito estaba parcialmente aplicado) y borraba
silenciosamente la aplicación al comprobante destino.

**Fix (mig 0266).** Bloquear la reversa si `EXISTS` una imputación a un comprobante distinto del
propio: exige desimputar esa aplicación primero (que ahora, por E-GG-77, restaura el crédito sin
destruirlo). e2e: reversa bloqueada ✓.

**Fecha / módulo:** 2026-07-01 · finanzas · mig 0266.

---

## E-GG-79 · CRÍTICO: el link de recuperación de contraseña llegaba roto (doble-escape) (2026-07-01)

**Contexto (DGG-93 / reporte JL #5).** Nuevo flujo de recuperación de contraseña: la edge fn
`enviar-reset-password` genera un link (`admin.generateLink` recovery) y lo encola en `email_queue`
(template `password-reset`, `cta_url='{{reset_url}}'`). El link es una URL de GOTrue con query
params: `…/verify?token=…&type=recovery&redirect_to=…`.

**Bug (lo cazó el agente C de la doble auditoría §6).** `dispatch-emails.buildManaxerHtml` renderiza
`cta_url` con `renderVars` (que llama `escapeHtmlIfNeeded` → `&`→`&amp;`) y **luego** lo mete en el
`href` con `escapeAttr` (que **vuelve** a hacer `&`→`&amp;`). Doble-escape: `&` → `&amp;amp;`.
Verificado en `sent_emails` real: `href="…verify?token=ac39…&amp;amp;type=recovery&amp;amp;redirect_to=…"`.
Al parsear el atributo, el navegador ve `&amp;` (literal) como separador → **se pierden
`type=recovery` y `redirect_to`** → el link NO dispara el recovery. Afecta a **cualquier** `cta_url`
con query params (los demás templates usaban URLs sin `&`, por eso estaba latente).

**Fix (dispatch-emails v13).** Helper `renderVarsRaw` (sustituye variables SIN escapar HTML). Se
usa para (a) `cta_url` — va a un `href`, `escapeAttr` hace el ÚNICO escape correcto de atributo; y
(b) `body_text` — es texto plano, no debe HTML-escaparse nunca. El `cuerpo_html_visual` y demás
campos HTML siguen con `renderVars` (escape correcto para contexto de texto HTML).

**Regla / smell.** Un valor no debe pasar por dos escapes de HTML. Si un `{{var}}` termina dentro
de un atributo (`href`, `src`) o en texto plano, NO usar el render que ya escapa + otro escape
encima. Para URLs en `href`: sustituir crudo + `escapeAttr` una sola vez. Smell: `escapeAttr(renderVars(...))`
sobre algo que puede contener `&`.

**Extras del chunk (defensa en profundidad).** (1) Redirect defensivo en `RoleHomeOrLanding`: si
Supabase Auth cae al Site URL (raíz) por la allow-list en vez de `/restablecer`, se enruta igual.
(2) `enviar-reset-password` v2: cap diario 5/24h por dirección (anti mail-bombing lento, hallazgo
agente A) + regex de email estricto. (3) `RestablecerPage` respeta el mensaje humanizado del
servicio. (4) La sesión de recovery es autoritativa (AuthContext no restaura la guardada si se llegó
por un link de recovery). Efecto conocido/aceptado: si un usuario logueado abre un link de recovery,
queda deslogueado del navegador tras fijar la clave (comportamiento seguro).

**Gotcha operativo (mismo chunk).** Al redeployar `dispatch-emails` con la MCP
`deploy_edge_function`, el parámetro **`verify_jwt` DEFAULTEA a `true`**. `dispatch-emails` es
llamada por `pg_cron` con `Authorization: Bearer <CRON_SECRET>` (NO un JWT) + validación interna →
requiere **`verify_jwt=false`**. El redeploy sin setear el flag lo puso en `true` → la plataforma
rechazó al cron con **401** antes de entrar a la función → el dispatch se frenó ~20 min (sólo estaba
encolado el mail de QA; ningún mail real afectado). Fix: redeploy v14 con `verify_jwt: false`.
**Regla:** al redeployar por MCP una edge fn cron-authed (CRON_SECRET/webhook), pasar SIEMPRE
`verify_jwt: false` explícito (las cron-authed: dispatch-*, *-harvester, arca-*). Las llamadas por
el front con anon key (p. ej. `enviar-reset-password`) sí pueden quedar `verify_jwt: true` (la anon
key es un JWT válido).

**Fecha / módulo:** 2026-07-01 · emails / auth · dispatch-emails v14 + enviar-reset-password v2 +
mig 0268 (template) + frontend. Capitaliza reporte JL #5.

## E-GG-81 · CRÍTICO: cancelar un trámite dejaba deuda fantasma en la cuenta corriente (2026-07-02)

**Síntoma (reporte JL, audio+imágenes).** JL cancela un trámite ya pagado parcialmente (Curso RPAC,
Saveriano). El trámite pasa a "Cancelado", pero en la cta cte el comprobante ($410.000) y su cobranza
($205.000) quedan intactos → al cliente le queda una **deuda** por el saldo, en vez de un **saldo a
favor** por lo ya pagado.

**Causa raíz.** Cambiar el estado de un trámite a `'cancelado'` era un `UPDATE tramites SET estado`
CRUDO, sin tocar el comprobante vinculado. Varios caminos lo hacían y NINGUNO anulaba el comprobante:
(1) kanban/lista (`useAvanzarTramite`), (2) **la página viva de detalle** (`TrackingDetailPage` →
`AgregarLineaDrawer` → RPC `tracking_agregar_linea` con "Cambiar estado = Cancelado"), (3) moderación
de aportes (`tracking_moderar_gestor_avance`). La maquinaria para dejar saldo a favor YA existía
(`anular_comprobante` borra imputaciones y deja el ingreso como crédito; `imputar_credito_a_comprobante`
de JL-3 lo reusa) — sólo faltaba invocarla al cancelar.

**Fix.** Nueva RPC `tramite_cancelar(p_tramite_id, p_anular_comprobante, p_motivo)` (mig 0269,
SECURITY DEFINER): anula el/los comprobante(s) no-fiscales → lo pagado queda como saldo a favor, y
**omite** los fiscales con CAE (requieren nota de crédito; decisión Pablo "avisar y frenar"). El
frontend pregunta al cancelar (decisión Pablo "preguntar al cancelar") vía el hook reusable
`useCancelarTramite` (lo comparten kanban/lista y el botón dedicado "Cancelar trámite" del tracking
detail). `AgregarLineaDrawer` ya no ofrece 'cancelado' en el dropdown. **Backstop BD** (mig 0272):
`tracking_agregar_linea` y `tracking_moderar_gestor_avance` redirigen `estado='cancelado'` a
`tramite_cancelar` — ningún caller (ni directo) deja deuda silenciosa. e2e verificado: comprobante
anulado + trámite cancelado + saldo a favor listado en `listar_creditos_administracion`.

**Fecha / módulo:** 2026-07-02 · finanzas / trámites · migs 0269+0270+0272 + frontend. Capitaliza
reporte JL (audio 2026-07-02). Relacionado con DGG-95, JL-3 (E-GG-77).

## E-GG-82 · Un pago de $205.000 se registraba como $204.999,98 (arrastre de float) (2026-07-02)

**Síntoma (reporte JL).** "El pago fue de $205.000 pero se registró por $204.999,98 (pasó en un par
de pruebas)". El comprobante quedaba con saldo $205.000,02.

**Causa raíz.** El servidor guarda exacto (verificado e2e: `registrar_cobranza_comprobante(205000)`
→ 205000.00). El valor **llegaba ya corrupto desde el navegador**: entró por "Cobrar ahora" (modo
parcial), donde el monto sale de `min(montoParcial, saldo)` y `montoParcial` viene directo del input
`<input type="number" step="0.01">` con `Number(e.target.value)` — un arrastre de float (o el spinner
de step 0.01) producía 204999.98 y se persistía sin sanear.

**Fix.** `round2()` en el borde (`cobranzas.ts`: `registrarCobranza` + `registrarCobranzaEnEmision`),
saneo on-change del input (`CobrarAhoraSection`), y `round(p_monto,2)` + guardia `NOT (p_monto>0)`
(atrapa NaN/NULL) del lado servidor en `registrar_cobranza_comprobante` (migs 0269+0271) — defensa en
profundidad. Dato de test corregido (X-1-36: $204.999,98 → $205.000). **Smell:** todo monto que viaja
del front a una RPC de dinero debe redondearse a centavos en el borde; `Number(input.value)` sin
`round2` es sospechoso.

**Fecha / módulo:** 2026-07-02 · finanzas · migs 0269+0271 + cobranzas.ts + CobrarAhoraSection.

## E-GG-83 · Meta-lección §6: arreglé la página LEGACY antes que la viva (2026-07-02)

**Síntoma.** En la 1ª pasada del fix de E-GG-81, cablée la cascada de cancelación en
`TramiteDetailPage.tsx` (por nombre, parecía el detalle del trámite). La §6 (agente de mapeo de
caminos) reveló que esa página **no se renderiza**: la ruta `/gerencia/tramites/:id` hace
`<Navigate to="/gerencia/trackings/:id">` → la página viva es `TrackingDetailPage` (módulo trackings),
con otro modelo de estados (slugs configurables) y otra vía de cambio de estado. El fix inicial era
inocuo pero estaba en código muerto; el bug real seguía abierto en la página viva.

**Aprendizaje.** Al arreglar una superficie de UI, **confirmar cuál componente se renderiza de verdad**
(seguir los `<Navigate>`/redirects en `App.tsx` y, si se puede, mirar la URL real en el browser) antes
de editar — no asumir por el nombre del archivo. La doble auditoría §6 con un agente dedicado a "mapear
TODOS los caminos" (no sólo revisar el archivo obvio) fue lo que lo detectó. Refuerza regla 15 (diff
legacy↔nueva al redirigir rutas): acá la "nueva" era TrackingDetail y la "legacy" TramiteDetail.

**Fecha / módulo:** 2026-07-02 · proceso / trámites. Capitaliza la 2ª pasada del fix DGG-95.

## E-GG-84 · Portal cliente: "1 nuevo avance" fantasma con todas las gestiones cerradas (2026-07-03)

**Síntoma (reporte JL).** En la home del portal de un cliente aparecía "1 nuevo avance en tus
gestiones" + badge "1 nuevo" en Mis gestiones, aunque TODAS sus gestiones estaban cerradas/resueltas
(ninguna activa). Engañoso: sugiere una gestión nueva/activa cuando no hay.

**Causa raíz.** `cliente_tracking_avances_nuevos_count()` contaba `notificaciones_internas` tipo
'tracking_avance' no-leídas SIN filtrar por estado del trámite. Al cerrar un trámite por kanban se
auto-genera un avance visible "Tu trámite fue resuelto." (mig 0201) → emite la notif → cuenta como
"novedad". Y NUNCA se marca leída: el único punto que la marca es abrir el detalle del trámite
(`PortalGestionDetailPage`), y el cliente no reabre trámites cerrados. El eco del cierre queda como
"novedad" para siempre.

**Fix (mig 0274).** El contador JOINea `tramites` y excluye estados terminales (cerrado/resuelto/
cancelado) → un cliente sin nada activo deja de ver el enganche; la notif sigue en la campanita.
e2e: count Expensas Pagas 1→0; caso activo (abierto/esperando_cliente) sigue contando.

**Bug lateral (R15) resuelto en el mismo fix.** La notif/email guardaba url
`/portal/mis-gestiones/<id>`, ruta que NO existe (la real es `/portal/gestiones/:id`) → el click caía
en ruta muerta. Corregido en `private.tracking_notificar_avance_cliente` + backfill de 37 notifs.

**Fecha / módulo:** 2026-07-03 · portal cliente / notificaciones · mig 0274. Capitaliza reporte JL.

## E-GG-85 · No se podía guardar una nota interna en una solicitud (2026-07-04)

**Síntoma (reporte JL).** En el detalle de una solicitud nueva (RECIBIDA), escribir en
"Observaciones internas" y no poder guardarlo: "no me deja guardar una nota interna".

**Causa raíz.** La textarea de observaciones (`SolicitudDetailPage.tsx`) no tenía acción de
guardado propia. El valor `observ` SÓLO se persistía como efecto lateral de `handleEnRevision`
→ `marcarEnRevision` (RPC `solicitud_marcar_en_revision`), que además cambia el estado a
'en_revision'. Un gerente que quería dejar una nota en una solicitud recibida sin cambiarle el
estado no tenía cómo → "no me deja guardar".

**Fix (mig 0275).** RPC dedicada `solicitud_guardar_observaciones(p_solicitud_id, p_observaciones)`
(SECURITY DEFINER, staff-only) que guarda SÓLO las observaciones (`NULLIF(btrim(...),'')` → trim
+ vacío=NULL) **sin tocar el estado** + botón "Guardar nota" bajo la textarea (deshabilitado si
no hay cambios; oculto si la solicitud está activada/descartada). §6 e2e: staff guarda + trim,
estado sin cambiar (recibida/en_revision/derivada), administrador/partner bloqueado (42501),
inexistente→P0002, sin overloads. Live: nota guardada en la solicitud del reporte (recibida) →
estado intacto, consola limpia.

**Fecha / módulo:** 2026-07-04 · solicitudes · mig 0275. Capitaliza reporte JL.

## E-GG-86 · Saldo a favor invisible en la cuenta corriente (la plata "no figura en ningún lado") (2026-07-04)

**Síntoma (reporte JL).** Comprobante X-00000037 ("Est Sav", $360.000) anulado tras haber sido
pagado: "Se anuló pero el dinero ingresado no figura en ningún lado. En nuestra caja está, pero en
la Cta. Cte. del cliente no lo veo." Pablo pidió auditoría doble a fondo con TODAS las posibilidades
+ emular los asientos en QA, bajo "una sola fuente de verdad y consistencia contable absoluta", sin
romper lo que funciona.

**Causa raíz.** La cuenta corriente (extracto + resumen + portal + reporte) arma el HABER desde
`movimiento_imputaciones` (usado como "libro de cobranzas"). Pero `anular_comprobante` **BORRA
físicamente** las imputaciones del comprobante. El ingreso sobrevive en la caja como crédito
huérfano, pero **ninguna superficie de cta cte lo representaba** → desaparecía. **3 vías** producen
el mismo saldo a favor invisible: (a) anular un comprobante ya pagado, (b) pago a cuenta (imputación
a `administracion_id`), (c) residual de una cobranza parcial. La auditoría §6 (4 agentes + e2e)
encontró además que **6 superficies mostraban 3 números distintos para la misma plata**: caja +$
(real) · cta cte/portal $0 (invisible) · reporte PDF −$ (saldo acreedor fantasma, query divergente
sin join a imputaciones · R15) · analítica lo contaba como cobranza · sábana partner evaporaba la
línea · `listar_creditos` +$ (correcto).

**Blindaje latente (Audit B, no explotado por bajo volumen):** `fz_crear_movimiento_manual` imputaba
a un comprobante **sin chequear saldo ni estado** (#8) e `imputar_credito_a_comprobante` leía el
comprobante destino **sin `FOR UPDATE`** → dos créditos concurrentes al mismo comprobante lo
sobre-aplicaban y el clamp `GREATEST(0, total−Σimp)` del recálculo lo enmascaraba (#9). No existía el
trigger simétrico `Σ(imputaciones por comprobante) ≤ total` (sí el del lado movimiento).

**Fix (mig 0276, opción NO destructiva elegida por Pablo).** No se cambia `anular_comprobante` (el
ingreso sigue quedando como crédito); se lo hace **visible y consistente**:
- `cuenta_corriente_extracto`: 3ª rama HABER "Saldo a favor" (residual `monto − Σimputado_a_comprobante`
  de ingreso vivo `identificado + revertido_at IS NULL`) + `saldo_inicial` que netea el crédito
  previo. Fila con ícono alcancía (violeta) en gerencia y portal.
- `cuenta_corriente_resumen` / `_resumen_global`: nuevo campo `saldo_a_favor` + `saldo_actual`
  neteado (puede ser acreedor; la UI ya interpretaba saldo negativo como "acreedor / a tu favor").
- **Blindaje estructural:** trigger `trg_imp_validar_sum_total` (Σ imputaciones ≤ total) — atrapa de
  raíz #8/#9 y cualquier vía futura + `FOR UPDATE` del comprobante en `imputar_credito` + guarda de
  saldo/estado en `fz_crear_movimiento_manual`.
- **Reporte PDF/XLSX (R15):** `fetchCtaCteData` consume la MISMA RPC del extracto → el PDF == la
  pantalla (antes: DEBE sólo 'autorizado', HABER ingresos brutos → saldo con signo equivocado).
- **UX (pedido Pablo):** anular un comprobante con pago abre un diálogo que advierte "ya tiene $X
  cobrado → queda como saldo a favor del cliente…, el dinero sigue en la caja". `AplicarSaldoAFavorDrawer`
  (JL-3) ya existía; sólo faltaba que el crédito fuera visible.

**`observado`/`compensado` NO se tocan** (criterio contable de Pablo): el compensado se empata con su
nota de crédito de signo contrario que también vive en la cta cte; el observado es deuda real sin
comprobante fiscal. Ambos siguen sumando como deuda.

**§6 e2e (13/13 OK, BEGIN/…/RAISE→rollback).** Caso real Est Sav → `saldo_a_favor=360.000`,
`saldo_actual=−360.000`, `listar_creditos=360.000`, caja intacta (los 3 números coinciden).
Sintético: anular pagado → saldo a favor + CONSISTENCIA (favor=listar=−actual=−extracto); aplicar
crédito a otro comprobante (JL-3); over-impute bloqueado; imputar-a-anulado bloqueado; trigger
Σ≤total bloqueó INSERT directo; pago-a-cuenta permitido; reversión baja el crédito. Sin overloads (R16).

**Addendum (mig 0277, decisiones de Pablo sobre los 2 puntos que quedaron abiertos).**
(1) **Partner — sin cambio de código, verificado e2e.** Pablo: "dejalo como está — si el
dinero aplica a un comprobante en el que no participa el partner, no debería ser parte de su
rendición; si se vuelve a aplicar a uno del que sí participa, vuelve a aparecer." El modelo
atribuye por `movimientos.partner_id_atribucion` (la plata que trajo el partner), y `partner_sabana`
JOINea imputaciones a comprobantes `<> 'anulado'`. e2e: cobranza tagueada al partner → aparece en su
sábana → anular el comprobante la saca → re-aplicar el crédito a otro comprobante la reaparece.
Coincide exactamente con el criterio → no se toca.
(2) **Analítica — corregida (mig 0277).** Pablo: "cobranza debe significar lo mismo en todos lados."
`analitica_cobranzas_mensual` sumaba ingresos brutos (contaba saldos a favor y pagos de comprobantes
anulados como cobranza). Ahora suma `movimiento_imputaciones.monto_imputado` de ingresos vivos
imputados a comprobantes vigentes = misma definición que `total_cobrado` de la cta cte. e2e: la
cobranza cuenta al imputar (+100k), deja de contar al anular el comprobante (vuelve a baseline),
y vuelve a contar al re-aplicar el crédito (+40k).

**Fecha / módulo:** 2026-07-04 · cuenta corriente / finanzas / partners / analítica · migs 0276 + 0277. Capitaliza reporte JL + auditoría doble a fondo (4 agentes) pedida por Pablo.

## E-GG-87 · Cliente duplicado desde formulario público + portal del cliente vacío (2026-07-04)

**Síntoma (reporte JL, 3 capturas = 1 bug).** (A) Se generó un cliente NUEVO "Est Sav." aunque ya
existía "Estudio Save" con el mismo email. (B) El trámite se autoflageó "Posible duplicado". (C) El
cliente entra al portal (estudio.saveriano@gmail.com) y **no ve nada** de su trámite/comprobante.

**Causa raíz (una sola).** Al activar la solicitud del Curso RPAC, la gerencia eligió "crear cliente
nuevo" en vez de "vincular" a "Estudio Save" (02036873, del 02/06, mismo email). `solicitud_activar`,
en la rama `p_crear_cliente_input`, hacía `INSERT INTO administraciones` **sin ninguna guarda de
email/CUIT duplicado** → creó "Est Sav." (2e05726b, 04/07). El match SÍ estaba disponible
(`solicitud_match_cliente` devolvía "Estudio Save" por email) pero el wizard lo mostraba como cartel
ámbar fácil de ignorar y el default para landing era "nuevo". El trámite + comprobante #38 + el saldo
a favor de $360k (E-GG-86) quedaron bajo el duplicado. Y como **`auth.users.email` es único**, el
portal-user del duplicado nunca se creó → el cliente sólo tiene el login del original y no ve lo nuevo.

**Fix.**
- **Reparación (merge de datos, decisión Pablo "fusionar en Estudio Save"):** se movió el footprint
  del duplicado (2 comprobantes, 2 movimientos, 1 trámite, 1 solicitud) al original 02036873, con
  asserts de no-orfandad; el duplicado quedó como tombstone (activo=false, email=NULL, renombrado).
  Ahora "Estudio Save" tiene 4 trámites (incl. RPAC abierto), 5 comprobantes y `saldo_a_favor=360.000`,
  y el cliente lo ve en su portal (su login resuelve a 02036873).
- **Prevención (mig 0278, decisión Pablo "bloqueo duro"):** `solicitud_activar` ahora **rechaza**
  crear un cliente si ya existe uno ACTIVO con el mismo email o CUIT → obliga a vincular. e2e 3/3:
  crear con email existente → bloqueado; crear con email fresco → permitido; vincular → permitido.
- **UI (`PasoCliente`):** ante una coincidencia, deja "vincular" por defecto y muestra el banner como
  confirmación con escape explícito a "cliente nuevo" (que limpia el vínculo). El backstop es la RPC.

**Nota (era el ÚNICO duplicado del sistema):** barrido de emails/CUITs → 0 otros duplicados.

**Fecha / módulo:** 2026-07-04 · solicitudes / clientes / portal · mig 0278 + merge de datos. Capitaliza reporte JL (3 capturas).

## E-GG-88 · Auditoría de seguridad (reels de influencers) — Etapa 1 de blindaje (2026-07-05)

**Origen.** Pablo mandó 2 reels de "seguridad para apps con IA" (captions: RLS, CORS, Security
Headers, Rate limiting, API keys en .env, anti SQL-injection) y pidió asegurar que estamos blindados.
Se auditó cada punto contra base + edge fns + hosting + front (no de memoria).

**Resultado del scorecard.** Sólido en 4/6: **RLS** (0 tablas sin RLS — advisor Supabase; R2),
**secretos** (.env gitignoreado, sólo anon key en el front, service_role sólo en edge fns; R3),
**SQL-injection** (RPCs parametrizadas, 1 solo `EXECUTE format()` seguro; R5), **CORS** (edge fns `*`
es el patrón Supabase; la defensa es JWT+RLS). **2 gaps reales + 1 hallazgo propio:**

1. **Security Headers (gap).** En vivo sólo había HSTS (Vercel). Faltaban X-Frame-Options
   (anti-clickjacking/embed), nosniff, Referrer-Policy. **Fix:** `vercel.json` → headers
   `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff`,
   `Referrer-Policy: strict-origin-when-cross-origin`, `X-DNS-Prefetch-Control: off`.
   (CSP queda para Etapa 2 — report-only → medir → bloqueante, porque una CSP mal puesta rompe la app.)
2. **Rate limiting en formularios públicos (gap).** `submit-formulario` logueaba la IP pero no la
   limitaba. **Fix:** rate-limit por IP (máx 12 envíos / 10 min) en la edge fn (v12), fail-open.
3. **Higiene de permisos `anon` (hallazgo propio, mig 0279).** Por el grant por defecto a PUBLIC,
   ~30 funciones SECURITY DEFINER quedaban invocables por `anon`. La mayoría YA rebotaban (guard
   is_staff/tenancy/rol), pero 3 mutaciones de bajo impacto estaban sin guard (vencer matrículas ya
   vencidas, incrementar uso de voucher, webhooks Webex). Se hizo `REVOKE ... FROM PUBLIC` en las
   no-públicas re-otorgando sólo a `authenticated` (gerencia) / `service_role` (webhooks Webex),
   dejando intactas las genuinamente públicas (verificar_certificado, voucher_validar, landing,
   catálogo de forms, webinar, gestoría-por-token). Verificado: anon perdió las no-públicas,
   authenticated/service_role las mantienen, ninguna pública rota.

**Nota (menor, no fixeado aún):** 4 buckets públicos permiten listar sus archivos (enumerar nombres).

**Addendum — Etapa 2: CSP en modo report-only → medir (2026-07-08).** Se agregó la
`Content-Security-Policy` PERO en `Content-Security-Policy-Report-Only` (NO bloquea; sólo reporta), que
es el paso correcto antes de una CSP bloqueante (una mal puesta rompe la app). Infraestructura para MEDIR:
- **mig 0285**: tabla `csp_reports` (staff-read, sin anon) + RPC `csp_report_registrar` (SECURITY DEFINER,
  sólo service_role; UPDATE-first con `hits` + INSERT con cap de 5000 filas distintas anti-bloat).
- **edge fn `csp-report`** (verify_jwt=false): recibe los reportes en ambos formatos (`report-uri`
  `application/csp-report` y `report-to` `reports+json`), los registra vía la RPC. Alcanzable SIN apikey
  (como postea el browser). Strip de query (no guarda tokens de URLs firmadas).
- **vercel.json**: header `Content-Security-Policy-Report-Only` + `Reporting-Endpoints`. Política = mejor
  estimación de la CSP final: `default-src 'self'`; script `'self' blob:`; style `'self' 'unsafe-inline'
  fonts.googleapis`; img `'self' data: blob: [supabase] gestionglobal.ar`; font `'self' data: gstatic`;
  connect `'self' [supabase https + wss]`; frame `'self' youtube`; worker `'self' blob:`; object `'none'`;
  base-uri/form-action/frame-ancestors `'self'`. Deja FUERA adrede Zoom/Webex y el `<script>` inline del
  boot-splash → para que el report-only los mida en vivo.
- **§6 EJERCITAR**: e2e del endpoint (204 sin apikey · dedup hits=2 · strip de query · cap hits=3) + **live
  en producción**: header presente; gerencia y el formulario público cargan normal (report-only NO bloquea);
  el browser reportó la 1ra violación real → `script-src-elem / inline / línea 89` = el script del
  boot-splash (`index.html:88`), aterrizado en `csp_reports`. Fonts/Supabase/wss NO violaron (bien previstos).
  §6 REVISAR: auditoría liviana (self-review) por ser scaffold NO-bloqueante (imposible que rompa prod);
  el riesgo del endpoint público está acotado por RPC service_role + dedup + cap + truncado.
- **Pendiente = Etapa 3 (enforce)**, tras medir unos días con tráfico real (incluye clases en vivo
  Zoom/Webex, que sólo reportan cuando hay una activa): revisar `csp_reports`, resolver el inline del
  boot-splash (hashear con `'sha256-...'` o externalizar a `/boot-splash.js`), agregar los orígenes de
  Zoom/Webex que aparezcan, y recién ahí cambiar el header a `Content-Security-Policy` (bloqueante).

**Fecha / módulo:** 2026-07-05 (Etapa 1) + 2026-07-08 (Etapa 2) · seguridad / hosting / edge fns / permisos ·
migs 0279 + 0285 + vercel.json + submit-formulario v12 + edge fn csp-report. Etapa 2 de 3 (enforce pendiente).
Capitaliza auditoría pedida por Pablo.

## E-GG-89 · El gestor externo no puede abrir los adjuntos del cliente (RLS storage) (2026-07-08)

**Síntoma (reporte JL, PDF + audios).** "gestoría no puede abrir el adjunto" — un PDF (comprobante de
transferencia del certificado de acreditación). El gestor externo ve el nombre del archivo pero no lo
abre. Latente: es la primera vez que JL probó el circuito de gestoría ("lo primero que estaba anotado
que no había probado").

**Causa raíz.** El panel del gestor (`/acceso/:token`) corre como **`anon`** (sin login). Para mostrar
los adjuntos del cliente, `firmarAdjuntoCliente` hacía `supabase.storage.from('form-adjuntos').createSignedUrl(path)`
**del lado cliente**. Pero `createSignedUrl` respeta la RLS de `storage.objects`, y `form-adjuntos`
sólo tiene policy de SELECT para **staff logueado** (`form_adj_select_staff`: `is_staff()`). No hay
policy para `anon` → el `anon` es rechazado → nunca se genera la URL → "no abre". No es regresión de
E-GG-88 (verificado: las 5 RPCs del gestor siguen `anon`-ejecutables; no se tocó ningún bucket).

**Barrido de patrón (pedido de Pablo).** Se auditaron las 24 superficies de storage de la plataforma:
**0 casos de bucket privado servido con `getPublicUrl`**. Flancos menores detectados: 2 lugares firman
al cargar la vista (vencen a la hora — `getSolicitud`, `listAdjuntosPedidosDocDeTramite`) y
`gestoria-adjuntos` no tiene lector (los docs que gerencia reenvía no se re-abren). Mismo circuito.

**Fix (E-GG-89).** Edge function nueva **`gestor-firmar-adjunto`** (`verify_jwt=false`): valida el
token de acceso externo, verifica que el path pertenezca a los `formulario_adjuntos` de ESA solicitud
(candado anti-arbitrario), y firma con `service_role` (que sí bypassa la RLS de storage). El panel la
llama en vez de firmar del lado cliente. **NO se amplió ninguna policy de storage** → no se abre ningún
hueco. §6 e2e (curl contra el edge fn real): token+path válidos → firma y el archivo reportado baja
**HTTP 200**; path ajeno → **403**; token falso → **401**.

**Fecha / módulo:** 2026-07-08 · acceso externo / gestoría / storage · edge fn `gestor-firmar-adjunto` v1 + `accesoExterno.ts`. Capitaliza reporte JL (PDF + 3 audios). Parte 1 de la auditoría integral de gestoría.

## E-GG-90 · Gerencia "no encuentra" el adjunto en el trámite + gestoria-adjuntos sin lector (2026-07-08)

**Síntoma (reporte JL, audio 2).** "voy a nuestro panel y voy al trámite, no lo encuentro. Dice que
hay un adjunto pero no encuentro el documento." Gerencia trabaja desde el detalle del TRÁMITE, pero
el comprobante del cliente sólo se veía en el detalle de la SOLICITUD (otra pantalla).

**Causa raíz.** `TrackingDetailPage` (detalle de trámite) listaba en su sección de adjuntos sólo (a)
los `archivos_urls` de las líneas (`gestor-uploads`, público) y (b) los del flujo PedidoDoc, pero NO
(c) los documentos originales del cliente (`form-adjuntos`) ni (d) los que gerencia reenvió a la
gestoría al derivar (`gestoria-adjuntos`). Además, `gestoria-adjuntos` **no tenía ningún lector** en
toda la app (barrido de E-GG-89): los docs que gerencia reenvía no se podían reabrir en ningún lado.

**Fix (mig 0280 + frontend).** RPC `tramite_docs_cliente(p_tramite_id)` (staff-only) que junta los
`form-adjuntos` (via el submission del trámite) + los `gestoria-adjuntos` (via `solicitud_derivaciones.
adjuntos_jsonb`) y devuelve `{bucket, path, nombre, origen}`. El service `listDocsClienteDeTramite`
los firma con la sesión de staff (las policies `form_adj_select_staff` y `gestoria_adjuntos_gerente_rw`
ya lo permiten; NO se tocó ninguna policy) y el trámite los muestra con badge "Cliente" / "A gestoría".
§6: la RPC devuelve el comprobante reportado ("Transferencia... Carlos A. Líbano") + el de derivación.

**Fecha / módulo:** 2026-07-08 · trackings / gestoría / storage · mig 0280 + `trackings.ts` + `TrackingDetailPage`. Parte 2 (a+b) de la auditoría integral de gestoría.

## E-GG-91 · Circuito gestoría ↔ gerencia ↔ cliente incompleto + saldo a favor en el wizard (2026-07-08)

**Síntoma (reporte JL, PDF + audios).** Cuatro huecos del mismo circuito + finanzas:
(c) el aporte de la gestoría no se ve en el INICIO de gerencia (sólo campanita/trámite);
(d) gerencia no puede ADJUNTAR un archivo al responder el aporte;
(e) falta avisar a la gestoría cuando el cliente completa la documentación pedida;
(f) al cobrar un trámite nuevo desde el wizard, no avisa que el cliente tiene SALDO A FAVOR.

**Fix (parte 3 de la auditoría integral de gestoría).**
- **(c)** `AportesGestoriaWidget` en `GerenciaHome` (mismo patrón que NuevasSolicitudes, tono violeta,
  en vivo). Vacío → no renderiza. mig 0281: `tracking_lineas` a la publicación realtime. §6/live:
  con un aporte pendiente sintético el widget aparece en el inicio ("Gestoría externa · en vivo").
- **(d)** botón "Agregar archivo" en la card de Moderación (sube a `gestor-uploads`, se publica con el
  aporte vía `moderarGestorAvance.archivosUrls`).
- **(e)** el mecanismo ya existía (botón "Avisar a la gestoría" → `derivacion_reavisar_gestoria`,
  regenera el token vencido + emailea · JL-2). Se agregó un BANNER de discoverability en el trámite
  cuando el cliente subió docs de un pedido y el trámite está derivado. **Pieza 2 HECHA (2026-07-08,
  ver addendum abajo):** que el gestor VEA en su panel los docs del "Pedido de Documentación".
- **(f)** en `PasoComprobante` del wizard, si el cliente existente tiene saldo a favor
  (`listar_creditos`), banner "Este cliente tiene $X a favor" + cómo aplicarlo (drawer JL-3).
- **(g) descartado** por Pablo (tiene que ver con la rendición a partners, sin definir aún).

**Lección (validada por el QA en vivo).** El browser test cazó un bug de runtime en E-GG-90 que el
build no ve: `const rpcAny = supabase.rpc as ...` desacopla el `this` del método → rompe en runtime
("reading 'rest'"). Regla ya escrita en `ctaCte.ts`; se repitió. Confirma por qué el QA en browser es
obligatorio y no reemplazable por build+§6.

**Addendum — Pieza 2 de (e): el gestor externo VE los docs del "Pedido de Documentación" (2026-07-08).**
El panel del gestor (`AccesoExternoPage`, entra como `anon` por token) mostraba SÓLO
`formulario_adjuntos` (lo del formulario inicial). Cuando gerencia le pide MÁS documentación al cliente
(`tramite_pedidos_doc` / `_items`, bucket `pedidos-doc-cliente`), esos archivos —justo los que la
gestoría necesita— no aparecían.
- **mig 0282**: `gestor_obtener_info_solicitud` suma la clave `pedidos_doc` (items del trámite con
  `archivo_path` y estado `subido`/`aprobado`; excluye `pendiente`=sin archivo y `rechazado`=invalidado
  por gerencia, que NO debe ofrecerse a un tercero externo). Misma firma → `CREATE OR REPLACE` sin
  overload (R16). **Asimetría deliberada** (confirmada §6): gerencia (`listAdjuntosPedidosDocDeTramite`)
  ve TODOS los items con archivo (incl. rechazado, porque modera); el gestor externo sólo subido/aprobado.
  No es inconsistencia contable — es control de exposición a un externo.
- **edge fn `gestor-firmar-adjunto` v2/v3**: firma también `pedidos-doc-cliente` (candado: el path debe
  pertenecer al trámite del token Y estar subido/aprobado). `.limit(1).maybeSingle()` evita 403
  falso-negativo ante colisión teórica de path.
- **frontend**: sección "Documentación pedida al cliente" en el panel + en el PDF descargable
  (`generateTramitePdf`), para que pantalla y PDF sean consistentes.
- **mig 0283 (blindaje, hallazgo §6):** `REVOKE ALL … FROM anon` sobre `tramite_pedidos_doc(_items)`.
  `anon` conservaba el set COMPLETO de privilegios directos por el default PUBLIC pre-0130 (12 grants);
  no filtraba (RLS sin policy anon), pero era el patrón que E-GG-88/0279 barrió en funciones. El gestor
  las lee sólo vía la RPC SECURITY DEFINER → verificado e2e que sigue devolviendo `pedidos_doc=1`
  post-REVOKE. **Pendiente (flag a Pablo):** barrido sistémico del mismo patrón en OTRAS tablas.
- **mig 0281 (recuperada):** estaba aplicada en la BD pero SIN archivo en el repo (drift R6/R7); se
  recuperó el SQL exacto (`ALTER PUBLICATION … tracking_lineas`).
- **§6**: 3 agentes REVISAR (SEGURO / OK / SIN REGRESIONES) + EJERCITAR e2e (RPC: neg=0/pos=1 + post-REVOKE;
  edge fn HTTP: 200 pedido · 403 cross-trámite · 403 rechazado · 200 regresión form). **Live** (Vercel,
  desktop): el panel muestra la sección con el doc aprobado, URL firmada real de `pedidos-doc-cliente`,
  descarga 200 · 64.7 KB · application/pdf; PDF con los 4 `<h2>` (incl. la sección nueva); consola limpia;
  token QA efímero creado y borrado (residuo 0). **GAP menor documentado (R14):** los tokens
  `recurso_tipo='tramite'` no ven el panel (gate a `'solicitud'`, pre-existente); el flujo real del gestor
  usa siempre `'solicitud'` (`solicitud_derivar_v2`), así que no afecta hoy.

**Fecha / módulo:** 2026-07-08 · gerencia / trackings / solicitudes / finanzas / acceso-externo · migs 0280–0283 + edge fn `gestor-firmar-adjunto` v3. Auditoría integral pedida por Pablo (PDF + 3 audios de JL). Capitaliza E-GG-89/90/91.

## E-GG-92 · Blindaje sistémico: over-grant PUBLIC→anon en TODAS las tablas (2026-07-08)

**Síntoma (hallazgo de la §6 de E-GG-91 pieza 2, ampliado).** Al limpiar el grant de `anon` sobre
`tramite_pedidos_doc(_items)` (mig 0283) se midió que **`anon` tenía el set COMPLETO de privilegios
(SELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER) concedido DIRECTAMENTE sobre las ~114 tablas
de `public`** — herencia del default `PUBLIC → anon` de Postgres pre-0130 (el mismo origen que motivó la
regla 6 y el barrido de funciones de E-GG-88 / mig 0279, que tocó funciones pero NO tablas).

**Riesgo.** HOY no filtra nada en las tablas internas: la RLS está activa y no tienen policy que le
aplique a `anon` (sin policy → PostgREST le niega las filas). Pero es un grant vivo latente: si mañana
alguien agrega por error una policy permisiva, o desactiva RLS en una tabla, o se cuela un `USING (true)`,
el dato queda expuesto al público. Defensa en profundidad = que `anon` no tenga el privilegio en primer
lugar, no depender sólo de la RLS.

**Fix (mig 0284).** `REVOKE ALL … FROM anon` en toda tabla `public` con RLS activa que NO tenga NINGUNA
policy aplicable a `anon` (ni directa ni vía rol PUBLIC) → **102 tablas internas**. Loop dinámico +
idempotente (en una BD nueva post-0130, sin el over-grant, es no-op). **NO toca:** (a) las 6 tablas de
flujos públicos donde una policy NOMBRA a `anon` (`formularios`/`servicios`/`categorias_servicio`/
`servicio_vouchers` SELECT + `formulario_submissions`/`formulario_adjuntos` INSERT); (b) las tablas con
policy de rol PUBLIC gateada por `is_staff()`/owner (audit_log, certificado_esquemas, errores_runtime,
notificaciones_internas, encuentro_sesiones_compartidas, vistas_guardadas) — anon no las puede usar igual,
se dejan por cero-riesgo; (c) `authenticated`/`service_role`.

**§6.** Dry-run `BEGIN`/rollback (102 revocadas; los 6 flujos públicos conservan su grant; tramites/
comprobantes sin anon) + e2e como **rol `anon`** (`SET LOCAL role anon`): `formularios`=10 y `servicios`=11
legibles; `tramites`/`comprobantes` → **`insufficient_privilege` (rechazo duro, ya no filtrado a 0 filas)**.
Live: `/formulario/certificado-rpac` carga como anon con 13 campos y sin errores de permiso.

**Lección / pendiente.** El default PUBLIC pre-0130 dejó over-grants en TODA tabla creada antes de 0130;
la regla 6 ya obliga GRANTs explícitos en tablas nuevas. Las policy-true "gateadas por USING" (grupo b)
conservan el grant muerto — un endurecimiento futuro podría estrecharlas a least-privilege, pero es marginal
(la RLS ya protege) y de mayor riesgo. E-GG-88 sigue con la Etapa 2 pendiente (CSP report-only → enforce).

**Fecha / módulo:** 2026-07-08 · seguridad / grants / RLS · mig 0284. Continúa E-GG-88 (0279 funciones) y
E-GG-91/0283 (pedidos_doc). Barrido pedido por Pablo ("sisi") sobre el hallazgo de la §6.

## E-GG-93 · Eventos (webinars→online/presencial/mixto): hallazgos de la §6 (2026-07-08)

Ver **DGG-99** en DECISIONES para el diseño del feature. Acá los 3 hallazgos que cazó la doble
auditoría §6 (3 agentes REVISAR + e2e en BD + prueba en vivo), todos fixeados en el mismo chunk:

1. **CRÍTICO (lógica) — mixto con cupo presencial lleno rechazaba en vez de derivar a online.** En
   `inscribir_a_webinar`, un evento `mixto` donde el inscripto elegía presencial y la sala física ya
   estaba llena tiraba `webinar_sin_cupo_presencial` aunque el evento tuviera Zoom/YouTube — rompía el
   principio "un mixto siempre tiene salida". **Fix (mig 0292):** si mixto+presencial sin cupo → cae a
   online (zoom FCFS → youtube) antes de rechazar. El presencial PURO sigue rechazando (no tiene canal
   online). e2e: mixto 2°→youtube · presencial puro 2°→rechaza.
2. **CRÍTICO (seguridad, línea E-GG-88/92) — funciones nuevas con `anon` EXECUTE heredado.**
   `crear_webinar`, `webinar_marcar_asistencia` (staff-only) e `inscribir_a_webinar` (interna: la usan
   el trigger SECURITY DEFINER / la edge fn submit-formulario service_role / el portal authenticated)
   tenían el grant `EXECUTE` a `anon` del default PUBLIC pre-0130 (`REVOKE FROM PUBLIC` no lo saca).
   Runtime-safe (rebotan por `is_staff()` / tenancy guard), pero se limpió: **`REVOKE EXECUTE … FROM
   anon`** en las 3 (mig 0292). Lección repetida: TODA función nueva staff/interna necesita `REVOKE
   FROM anon` explícito, no sólo `FROM PUBLIC`.
3. **R7 (drift) — 4 migraciones aplicadas sin archivo en el repo.** Las migs 0287/0288/0289/0290 se
   aplicaron vía `apply_migration` (MCP) pero olvidé escribir el `.sql` en `supabase/migrations/` →
   el repo no reproducía el schema en un entorno fresco. Se recuperó el SQL exacto de
   `supabase_migrations.schema_migrations` y se commitearon los 4 archivos. **Smell (repetido de 0281):
   cada `apply_migration` debe ir acompañado de su Write del archivo en el repo, en el mismo paso.**

**Prueba en vivo (Vercel, sesión gerente):** lista de Eventos con badge Presencial+tipo+lugar; detalle
con ModalidadCard/ArancelCard y Zoom oculto en presencial; página de acceso `/webinar/:token` de un
presencial mostrando lugar + "Cómo llegar" (mapa) + countdown, SIN botón de Zoom; sin errores de consola.
Los eventos ONLINE existentes: comportamiento idéntico (modalidad default 'online').

**Addendum (mismo día, pedido Pablo "no dejar nada pendiente").**
- **Landing:** la card de la home ("Capacitaciones gratuitas") seguía siendo webinar-only y no reflejaba
  los encuentros presenciales. Se cambió a "Capacitaciones y encuentros" (copy: online y presencial),
  CTA → `/eventos` (ruta nueva, alias de `/webinars` que se mantiene). La página de inscripción ya
  muestra por evento: banner/flyer + modalidad + lugar + arancel (fase 3).
- **Banner/flyer (consulta Pablo):** ya existía — `webinars.banner_url` (card "Banner" del detalle) se
  muestra arriba del formulario en `/eventos` y `/portal/webinars` (ambos usan `WebinarIdentidad`).
  Verificado por RPC (`webinar_inscripcion_activa` devuelve banner_url + modalidad + ubicación + arancel).
- **Limpieza:** borrado `listProspectos`/`ProspectoListItem` (código muerto tras la reescritura); **R20**
  cerrado en `submit-formulario` v13 (safeStorageKey inline NFKD; verificado: "Inscripción Ñoño.pdf" →
  "Inscripcion_Nono.pdf").
- **Re-auditoría consolidada:** 7 funciones del feature SECURITY DEFINER, `anon` sólo en la pública
  `webinar_inscripcion_activa`, staff/internas con anon revocado; 0 overloads (R16); RLS activa en las 5
  tablas; canal CHECK con 'presencial'. Todos los archivos de migración (0286-0292) en el repo (sin drift).

**Fecha / módulo:** 2026-07-08 · eventos / webinars / landing / seguridad · migs 0286–0292 + edge fns
webinar-acceso v5 + submit-formulario v13. Doble auditoría §6 del paquete Eventos pedido por Pablo.

## E-GG-94 · Refinamientos "Eventos" (banco disertantes + flyer + vigencia presencial + copy sweep): hallazgos de la doble auditoría §6

Chunk de refinamientos pedido por Pablo sobre DGG-99 (ver **DGG-100** en `DECISIONES.md`):
banco reutilizable de disertantes (foto+CV+bio), flyer 1080×1350 al costado del
formulario, vigencia presencial que cierra al inicio, copy sweep webinar→evento,
form slug 'webinarios'→'eventos'. La **doble auditoría §6 (3 agentes + e2e en BD)**
encontró y fixeó, en el mismo chunk, 5 bugs — 2 críticos:

1. **CRÍTICO (seguridad, línea E-GG-88/92 otra vez) — `public.disertantes` con `anon`
   full-grant heredado.** La tabla nueva (mig 0293) se creó con `GRANT … TO
   authenticated`, pero como el proyecto es **pre-0130** el `CREATE TABLE` ya había
   concedido TODO a `PUBLIC` (que incluye `anon`) → `anon` quedó con
   SELECT/INSERT/UPDATE/DELETE. RLS la tapaba (única policy `FOR ALL TO
   authenticated`), pero es la sobre-exposición exacta que el sweep 0284 (E-GG-92)
   vino a erradicar. **Fix:** `REVOKE ALL … FROM anon, PUBLIC` (mig 0297). Verificado
   e2e: `role_table_grants` de anon = ninguno. **Lección (3ª vez): toda `CREATE TABLE`
   pre-0130 necesita `REVOKE FROM anon` explícito además del `GRANT TO authenticated`
   — el grant no revierte el default. Agregar al checklist de cierre de migración.**

2. **CRÍTICO (pérdida de datos) — `webinar_duplicar` (mig 0224) no copiaba las columnas
   nuevas.** Al agregar `flyer_url` (0293) y, antes, toda la data de Eventos de DGG-99
   (`modalidad`, `tipo`, `ubicacion_*`, `cupo_presencial`, `es_arancelado`,
   `arancel_monto`, `arancel_nota`), nadie actualizó el `INSERT … SELECT` de la RPC de
   duplicado. Duplicar un evento **presencial arancelado con flyer daba un online
   gratuito sin lugar ni flyer, en silencio**. El botón "Duplicar evento" está wired y
   visible en la lista. **Fix:** mig 0300 agrega las 12 columnas al `INSERT/SELECT`
   (misma firma → `CREATE OR REPLACE`, R16). Verificado e2e (BEGIN/rollback, contexto
   gerente): la copia preserva flyer+banner+modalidad+tipo+arancel+ubicación+cupo+
   docentes y queda `publicado=false`. **Lección (R14 aplicada a RPCs de copia):
   cuando se agrega una columna persistida a una entidad, revisar TODA RPC que la
   INSERT/SELECT en bloque — duplicar/importar/snapshot — no sólo el alta.**

3. **Menor — `canal='presencial'` se renderizaba como "YouTube".** El tipo
   `InscriptoConCanal.canal` era `'zoom' | 'youtube'` (heredado de la fase online); un
   inscripto presencial (canal `'presencial'`, válido desde DGG-99 fase 3/4) caía al
   `else` del render y mostraba el ícono/label de YouTube en la grilla de inscriptos.
   **Fix:** ampliar el union a `… | 'presencial'` (4 sitios en `webinars.ts`) + rama
   `MapPin`/"Presencial" en el render (`WebinarDetailPage`).

4. **Menor (engaña al cliente) — card "Otros próximos eventos" del portal mostraba
   "GRATUITO" hardcodeado.** `WebinarAvailCard` tenía el kicker literal; la RPC
   `cliente_webinars_listar` no traía el arancel en `disponibles`. Un evento arancelado
   se anunciaba gratis. **Fix:** mig 0299 agrega `es_arancelado`+`arancel_monto` a
   `disponibles` (misma firma, `CREATE OR REPLACE`) + kicker condicional
   ("ARANCELADO · $X" / "GRATUITO").

5. **Menor (hardening) — `tg_disertantes_updated_at` sin `search_path`.** Advisor de
   Supabase "Function Search Path Mutable". Sólo hace `NEW.updated_at:=now()` (riesgo
   nulo), pero el estándar del repo es pinnearlo. **Fix:** `SET search_path = ''` (mig
   0298) + re-`REVOKE` de PUBLIC (el `CREATE OR REPLACE` re-concede).

**Copy sweep — 12 strings user-facing "webinar" sin migrar** (Agentes B+C): se
detectaron con 3 métodos independientes (grep dirigido + sweep por-línea + barrido
full-tree). Clúster: onboarding tour (gerencia + portal), landing card, WebinarsListPage
(subtítulo + loading), h1 de error público, toasts push del portal, certificados,
label de op del wizard, tab histórico del cliente. Todos corregidos. Se dejó SIN tocar
(legítimo): la opción de **tipo** `<option value="webinar">Webinar</option>`, rutas
(`/webinars`, `/webinar/:token`), nombres de tabla/columna/RPC, y el label de la casilla
de email `webinar@gestionglobal.ar` (**DUDA para Pablo**: la dirección real es `webinar@`,
renombrar sólo el label a "Eventos" podría confundir).

**Método que lo encontró:** la premisa §5 (doble auditoría **+ ejercitar en BD**). Los 2
críticos NO los agarra un build limpio ni un smoke SELECT: el over-grant sólo se ve
mirando `role_table_grants`, y la pérdida de datos de `webinar_duplicar` sólo se ve
ejecutando la RPC y comparando la copia contra el original (e2e con rollback). Sin la
premisa, ambos llegaban a producción.

**Fecha / módulo:** 2026-07-09 · eventos / disertantes / seguridad / portal · migs
0293–0300. Doble auditoría §6 (3 agentes + e2e BD) del chunk de refinamientos.

---

## E-GG-95 · Emisión por lote de certificados de evento: el render del PDF se cuelga en la pestaña de fondo (rAF pausado)

**Contexto (DGG-100 Etapa B):** al emitir certificados de un evento, el browser del
gerente renderiza cada PDF (React `CertificadoPremium` → `html-to-image` → `jsPDF`)
antes de subirlo al bucket y mailarlo. La emisión es un **loop secuencial** por
asistente.

**Síntoma (cazado por la QA en vivo):** al tocar "Emitir y enviar a asistentes", la
barra quedaba en "Emitiendo… 0/N" y algún cert fallaba con `El certificado no se
renderizó en el DOM`. Se reproducía de forma fiable cuando la pestaña **no estaba en
foco** durante el lote.

**Causa raíz:** el poll que esperaba a que React montara el nodo y a que las imágenes
del esquema cargaran usaba **`requestAnimationFrame`**. En una pestaña en segundo plano
Chrome **pausa por completo los callbacks de rAF** (no los throttlea: los congela).
Con la pestaña oculta, el render nunca avanzaba → deadline → error. El caso normal
(una descarga suelta con la pestaña visible) nunca lo mostró; sólo apareció con el
loop de lote, durante el cual el gerente puede cambiar de pestaña.

**Fix (commit `2f5aeb3`):**
1. `src/modules/campus/lib/generateCertificadoPdf.ts` — reemplazar TODO el polling y
   los delays de `requestAnimationFrame` por **`setTimeout`** (se throttlea a ~1s en
   background pero **no se pausa**), con deadline holgado (3s→10s) + reintento único
   de `toPng`.
2. `emitir_certificados_evento` (mig 0305) — el `RETURN` final ahora devuelve **todos**
   los certs del evento con `pdf_storage_path IS NULL` (nuevos + los que quedaron sin
   PDF por un fallo previo), para que volver a tocar "Emitir y enviar" **reintente los
   pendientes** en vez de saltarlos por el dedup `NOT EXISTS`.

**Verificación e2e (prod, cliente QA + prospecto QA):** con la pestaña visible, el lote
completó render→upload→mail para ambos (PDFs de 963 KB / 975 KB en el bucket
`certificados`, `application/pdf`; edge fn `send-certificado-email` 200; `enviado_email_at`
seteado). El re-click levantó el prospecto que había quedado pendiente.

**Lección:** cualquier trabajo que dependa de layout/paint dentro de un loop largo
(render offscreen, captura a canvas, medición de DOM) **no debe apoyarse en `rAF`**:
en background se congela. Usar `setTimeout`. Y toda operación por lote que pueda fallar
parcialmente debe poder **reintentar los pendientes** de forma idempotente.

**Fecha / módulo:** 2026-07-09 · campus / eventos / render PDF · commit 2f5aeb3 + mig 0305.

---

## E-GG-96 · Grilla de Inscriptos/Asistencia de gerencia vacía: join embebido a columna inexistente (`administraciones.razon_social`)

**Síntoma (cazado por la QA en vivo de Etapa B):** en la página de un evento con
inscriptos reales, las pestañas **Inscriptos (0)** y **Asistencia** mostraban
"Todavía no hay inscriptos para pasar lista" pese a que la BD tenía 2 inscriptos con
`asistio=true` (el RPC de emisión SÍ los veía y emitía sus certs). Como el ícono de
descarga/reenvío de cert (CertCell) vive en esa grilla, el bug **bloqueaba B5**.

**Causa raíz (R8/E43 — naming híbrido de tabla pre-existente):** `listInscriptos`
(`src/services/api/webinars.ts`) hacía el join embebido PostgREST
`administraciones:administracion_id(razon_social)`, pero la tabla `administraciones`
**no tiene `razon_social`** — su columna de nombre es **`nombre`** (`razon_social`
existe sólo en `arca_emisores`/`comprobantes`). PostgREST valida las columnas del
recurso embebido contra el schema cache → devolvía **400 `column
administraciones_1.razon_social does not exist` (42703)** → `listInscriptos` fallaba
y la UI caía al estado vacío (sin toast). Bug **pre-existente desde la Fase 4** de
DGG-99: nunca se había visto la grilla con un inscripto que tuviera `administracion_id`.

**Fix (E-GG-96):** `razon_social` → `nombre` en `listInscriptos` (3 sitios: select,
cast, mapeo). Verificado con fetch PostgREST crudo (token gerente): `razon_social` →
400; `nombre` → 200 con las 2 filas (`{nombre:"QA Cert Test"}` para el cliente, `null`
para el prospecto).

**Barrido de regresión (§6 Agente B):** cero otros usos vivos de
`administraciones.razon_social` en `src/`; todos los `razon_social` restantes son de
`arca_emisores`/`comprobantes`, tablas que sí la tienen.

**Hardenings §6 del mismo chunk (preventivos, no bugs manifestados):**
- **Dedup idempotente (mig 0306):** el dedup de `emitir_certificados_evento` era sólo
  `NOT EXISTS` + `disabled` del botón. Dos emisiones concurrentes podían duplicar el
  cert (y el email) del mismo asistente. Se agregaron **índices únicos parciales**
  `uq_cert_evento_cliente (webinar_id, alumno_profile_id)` y `uq_cert_evento_prospecto
  (webinar_id, prospecto_id)` (sólo `webinar_id NOT NULL`, para no tocar certs de
  curso) + `ON CONFLICT DO NOTHING` en el loop. Verificado e2e: el índice rechaza el
  duplicado y el ON CONFLICT lo vuelve no-op sin error.
- **Match CertCell por id (no email):** el ícono de cert por asistente se indexaba por
  `payload_snapshot.email`; dos inscriptos con el mismo email colapsaban al mismo cert.
  Se cambió a match por `alumno_profile_id`/`prospecto_id` (se expuso `profile_id` en
  `listInscriptos`), con email sólo como fallback.

**Lección (R8/E43 recapitulada):** antes de un join embebido PostgREST
`tabla:fk(col)` sobre una tabla pre-existente, verificar `col` con
`information_schema.columns` — el 400 sale como grilla vacía sin pista. Y una grilla
que sólo se probó sin cierto tipo de fila (acá, inscripto con `administracion_id`)
puede esconder el bug por meses (R14/R15: probar la grilla con datos reales de cada
tipo).

**Fecha / módulo:** 2026-07-09 · eventos / gerencia / naming · fix en `webinars.ts` +
mig 0306. Cazado por la QA en vivo mandada por §5 (no lo agarra build ni smoke SELECT).

---

## E-GG-97 · Barrido sistémico del over-grant a `anon` (cierre del linaje E-GG-88/89/90/91/92)

**Contexto:** PROJECT_STATUS tenía flageado "barrido sistémico del over-grant a anon en
OTRAS tablas" (deuda de los E-GG-88/92). Pre-0130, `CREATE TABLE public.*` concede el set
completo (SELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER) a anon por default; la
RLS tapa el acceso real, pero el grant es la sobre-exposición.

**Auditoría (2026-07-09):** 18 tablas/vistas tenían privilegios de anon. Triaje:
- **5 vistas** (`cajas_con_saldo`, `vw_comprobantes_para_avisar`, `vw_agenda_unificada`,
  `vw_administracion_webinars`, `vw_accesos_externos_aperturas`) — TODAS `security_invoker`
  → anon ya no leía los datos subyacentes (test: `permission denied for table cajas`). El
  grant sobraba igual.
- **7 tablas internas** (`audit_log`, `certificado_esquemas`, `csp_reports`,
  `encuentro_sesiones_compartidas`, `errores_runtime`, `notificaciones_internas`,
  `vistas_guardadas`) — 0 uso directo en el front, o gerencia-only, o mediadas por RPC (la
  verificación PÚBLICA de cert usa la RPC `verificar_certificado` SECURITY DEFINER, NO lee
  `certificado_esquemas` directo).
- **6 tablas de flujo público** (`formularios`, `formulario_submissions`,
  `formulario_adjuntos`, `servicios`, `categorias_servicio`, `servicio_vouchers`) — anon SÍ
  las necesita, pero sólo con un privilegio (el que su policy RLS define: SELECT o INSERT).

**Fix (mig 0308):** `REVOKE ALL … FROM anon` en las 12 internas; en las 6 públicas
`REVOKE ALL` + `GRANT <mínimo>` (SELECT para render/catálogo, INSERT para submit/upload).
Como los grants eran explícitos por rol (anon/authenticated/service_role separados, NO vía
PUBLIC), revocar anon NO tocó a authenticated/service_role (gerencia/cliente intactos).

**Verificación e2e (rol anon puro, sólo apikey sin bearer):** público OK (`formularios`,
`servicios`, `categorias_servicio` → 200 con filas); interno BLOQUEADO (`audit_log`,
`cajas_con_saldo`, `certificado_esquemas` → 401). `authenticated`/`service_role` conservan
6/6 grants. Post-barrido la superficie anon queda: formularios(SELECT),
formulario_submissions(INSERT), formulario_adjuntos(INSERT), servicios(SELECT),
categorias_servicio(SELECT), servicio_vouchers(SELECT) — y nada más.

**Lección (reforzada):** toda `CREATE TABLE` pre-0130 necesita `REVOKE FROM anon` explícito
(el `GRANT TO authenticated` no revierte el default). Ahora la superficie anon es un
allow-list mínimo y auditable. Chequeo de regresión futuro:
`SELECT table_name FROM information_schema.role_table_grants WHERE grantee='anon' AND
table_schema='public'` no debe crecer sin justificación de flujo público.

**Fecha / módulo:** 2026-07-09 · seguridad / RLS-grants · mig 0308. Cierre del flag de
PROJECT_STATUS pedido por Pablo ("cerrá todo, incluso lo postergado").

---

## E-GG-98 · Ficha del cliente mostraba un saldo distinto al de la cuenta corriente (reporte JL, 2026-07-09)

**Síntoma (JL, con capturas):** para "Saveriano Lucia", la ficha (Clientes → Cta corriente)
mostraba SALDO ACTUAL **$410.000**, pero Facturación → Cuenta corriente del MISMO cliente
mostraba **$205.000** (el correcto). Inconsistencia contable entre superficies.

**Causa raíz:** `AdministracionDetailPage.tsx` (TabCtaCte) tomaba `rows[0].saldo` del array
del extracto. El extracto viene **ASC** (más viejo primero) y ya filtra `saldo_inicial`, así
que `rows[0]` es el **primer movimiento** (saldo tras el 1er cargo = $410k), NO el saldo
actual (última fila = $205k). El mismo bug **ya se había arreglado en el portal**
(`PortalCtaCtePage` usa `rows[último]`, con comentario que lo documenta) pero **no se propagó
a la ficha de gerencia** — regresión de paridad (R14/R15). Bonus: la cajita "Cobranzas" sumaba
las filas `saldo_favor` como si fueran cobranzas → inflaba (Estudio Save: $1.634.000 vs
$774.000 reales).

**Fix:** la ficha ahora consume `cuenta_corriente_resumen` (la MISMA RPC que Facturación) para
saldo_actual/total_facturado/total_cobrado/saldo_a_favor; el extracto queda SÓLO para la tabla
de movimientos, nunca para calcular subtotales. **Fuente única** → imposible que vuelvan a
diferir. **Live-verificado** con gerente QA efímero: la ficha ahora muestra $205.000 = igual
que Facturación. **Lección: ninguna superficie recalcula el saldo desde el array del extracto;
todas usan la RPC resumen.** Blast radius barrido: sólo la ficha estaba mal (portal ok,
Facturación ok).

**Fecha / módulo:** 2026-07-09 · facturación / cta cte · `AdministracionDetailPage`, commit b248354.

---

## E-GG-99 · Submission huérfana → duplicación de clientes + datos no propagados + trámite invisible (raíz sistémica, reporte JL)

**Síntomas (JL):** (a) "se crearon 3 cuentas de Lucía" (1 persona con 5 administraciones por
usar mails distintos); (b) "los datos que carga el cliente no aparecen en la ficha" (responsable,
padre, madre, dirección = "Sin asignar", en TODOS los clientes); (c) el cliente no ve su trámite
abierto en el portal.

**Causa raíz (UNA rompe las tres):** `submit-formulario` insertaba la submission SIEMPRE con
`administracion_id NULL` (0/24). De ahí: `sync_submission_a_administracion` short-circuita en
`IF administracion_id IS NULL RETURN` (nunca propaga datos), y `crear_tramite_desde_submission_auto`
deja `solicitudes.cliente_id NULL` (el trámite nace huérfano → cliente-fantasma nuevo + invisible
en el portal del cliente logueado). Además el sync sólo mapeaba 7 campos (faltaban responsable/
dni/dirección/whatsapp), y `solicitud_activar` (path público) tampoco copiaba esos campos.

**Fix (verificado e2e BEGIN/rollback):**
- `submit-formulario` v10: si es cliente logueado (origen_canal='cliente' + JWT), liga la
  submission a SU administración por **identidad (JWT)**, no por el email tipeado → dispara el
  sync + liga el trámite. e2e: propaga padre/madre/cuit/tel + `solicitudes.cliente_id` = admin.
- mig 0310: `sync_submission_a_administracion` extendido a los 12 campos (responsable_nombre/
  apellido/dni, dirección armada de calle+nro+piso+depto, whatsapp).
- mig 0312: trigger AFTER INSERT en `tramites` que backfillea la ficha desde la submission
  ligada (COALESCE) → cubre el **path público** (activación de submission sin admin_id).
- mig 0311: índice único parcial sobre CUIT normalizado en admins activos → **un CUIT = una
  cuenta activa** (decisión Pablo), backstop sistémico contra duplicar por "misma persona,
  otro email" en cualquier vía. (dups viejos de Lucía tienen cuit NULL → excluidos; "prevenir
  nuevos, no tocar viejos".)

**Lección: toda vía de ingest debe resolver la identidad del cliente logueado por JWT (no por
el email del form), y el CUIT es la clave de dedup, no el email.** Follow-ups anotados (no
bloqueantes): inputs del wizard para editar responsable/padre/madre a mano (R14); RPC de fusión
para consolidar dups existentes; cerrar pedidos_doc huérfanos al cancelar trámite.

**Fecha / módulo:** 2026-07-09 · formularios / clientes / identidad · submit-formulario v10 +
migs 0310/0311/0312. Verificado e2e.

---

## E-GG-100 · Mail de "pedido de documentación" al email equivocado → el cliente no ve/actúa su trámite (JL puntos 1/5)

**Síntoma (JL, reiterado):** el cliente recibe el mail "Subir documentación" con link al portal,
entra, y ve **"No encontramos este trámite"** — el trámite abierto no aparece.

**Causa raíz:** `tramite_pedido_doc_crear` mandaba el mail a `tramites.solicitante_email` (texto
libre capturado en el alta), que puede diferir del email de **login** de la administración dueña
del trámite. Con la duplicación de cuentas (E-GG-99), TRM-2026-00071 vive bajo el login
`luciafotos4` pero el solicitante_email era `luciafotos` → Lucía recibe el mail en `luciafotos`,
entra con esa sesión, y el portal (que filtra por `current_administracion_id`) correctamente no
ve un trámite de otra cuenta. La notif interna y el push YA iban bien (por administracion_id);
sólo el mail estaba desacoplado.

**Fix (mig 0309):** el mail se dirige al email de **login real** de la administración dueña
(`profiles`→`auth.users` por administracion_id); fallback a solicitante_email. e2e con el caso
real: TRM-2026-00071 pasa de `luciafotos` → `luciafotos4` (la cuenta que sí ve el trámite). Con
E-GG-99, los trámites nuevos quedan bajo la cuenta correcta → el mail y la sesión coinciden de raíz.

**Fecha / módulo:** 2026-07-09 · trámites / mails · mig 0309. Verificado e2e con datos reales.

---

## E-GG-101 · Un cliente dado de baja seguía pudiendo loguearse y ver TODO su portal (Gap 1)

**Síntoma:** al dar de baja un cliente (`estado='baja'`, `activo=false`), su usuario de
portal seguía entrando y viendo comprobantes, trámites, cuenta corriente, etc. Latente hoy
(0 víctimas) pero abierto de par en par para el lanzamiento con 1000 clientes.

**Causa raíz:** ninguna capa miraba el estado del cliente. Login (`signInWithPassword`) sólo
valida credenciales; el guard de ruta sólo chequea rol; y **las 16 tablas del cliente cuelgan
de `private.current_administracion_id()`**, que devolvía el `administracion_id` del profile sin
gatear por `activo`/`estado`. `archiveAdministracion` era un `UPDATE` directo que no tocaba los
`profiles`. Confirmado por 2 análisis independientes (estático + barrido RLS en vivo: las 16
policies filtran sólo por `administracion_id`, ninguna por estado) + e2e real.

**Fix (mig 0318):** gatear el helper en una línea → `current_administracion_id()` devuelve NULL
si `p.activo=false` **o** `a.activo=false` **o** `estado='baja'`. Como todo (policies + 
`assert_administracion_access`) cuelga de él, el baja'd client pasa a ver 0 filas en todo el
portal. `SECURITY DEFINER` ⇒ sin recursión al leer `administraciones`. Baja/reactivar pasan a
RPC transaccional que además (des)habilita los `profiles`; el front hace `signOut` de un
administrador con `profile.activo=false` y muestra "tu acceso fue dado de baja" (no el portal
fantasma vacío) + botón Reactivar. e2e (rollback): cliente activo intacto, baja→NULL + profile
deshabilitado, reactivar→vuelve; 0 admins activos bloqueados por error.

**Fecha / módulo:** 2026-07-10 · seguridad / RLS / auth · mig 0318. Verificado e2e.

---

## E-GG-102 · Mails de trámite al `solicitante_email` en 5 sitios más (blast radius de E-GG-100)

**Síntoma:** el mismo síntoma de E-GG-100 (el cliente recibe el aviso en otra casilla y no ve el
trámite en el portal), pero repetido en TODO el circuito de trámites, no sólo en el pedido de docs.

**Causa raíz:** el 0309 arregló SÓLO `tramite_pedido_doc_crear`. La auditoría §6 (agente A)
encontró 5 sitios más que resolvían el destinatario del cliente como `solicitante_email` (o
`administraciones.email` de la ficha) en vez del email de **login**: `tramite_pedido_doc_enviar_revision`
(CRÍTICO, acción del portal), `tracking_notificar_avance_cliente` (CRÍTICO, emisor central de
avances+cierre+resuelto), `tramite_avisar_cancelacion`, `tracking_reabrir` (usaba
`administraciones.email`), y la rama recordatorio de `tracking_linea_on_insert`.

**Fix (mig 0319):** helper único `public.admin_login_email(administracion_id)` (mata el drift de
inlinear el join en cada caller) con prioridad login → `solicitante_email` → `administraciones.email`,
aplicado a los 5 sitios. e2e (rollback): con `solicitante_email` forzado a otra casilla, el fan-out
central Y `avisar_cancelacion` encolan al LOGIN; helper correcto para los 5 admins; R16 sin overloads.
Trámites sin admin-portal / personas sin cuenta caen al `solicitante_email` (correcto por diseño).

**Fecha / módulo:** 2026-07-10 · trámites / mails · mig 0319. Verificado e2e.

---

## E-GG-103 · KPIs del portal de comprobantes en $0 al filtrar (hermano de E-GG-43, R19)

**Síntoma:** en "Mis comprobantes" del portal, si el cliente filtraba Cobranza="Pagado", los KPIs
"Pendiente" y "Vencido" pasaban a **$0** aunque tuviera deuda real (igual que "Resueltos: 0" del
E-GG-43, pero con plata).

**Causa raíz:** `PortalComprobantesPage` pasaba estado/cobranza/período/búsqueda al backend
(`.eq()` encadenado en el service) y calculaba los KPIs financieros sobre `rows`, que ya venía
parcial. El grep transversal de E-GG-43 no lo cubrió porque acá el filtro no era un booleano sino
parámetros que la capa de servicio traducía a `.eq()`.

**Fix (R19):** traer el universo completo de la administración (es de UN cliente → acotado), KPIs
sobre el crudo, filtros en memoria con `useMemo`. Frontend-only.

**Fecha / módulo:** 2026-07-10 · portal / facturación · `PortalComprobantesPage.tsx`.

---

## E-GG-104 · Inscribirse a un evento desde el portal chocaba 23505 si ya eras prospecto

**Síntoma:** un cliente que ya figuraba como prospecto de un evento (por el form público, mismo
email) y luego se inscribía desde el portal recibía un error confuso ("ya existe un registro").

**Causa raíz:** `cliente_webinar_inscribirme` chequeaba idempotencia por `administracion_id`, pero
la clave única es `(webinar_id, email_snapshot)`. La fila del prospecto (admin NULL) no matcheaba
el chequeo → el INSERT chocaba `webinar_inscriptos_unique_email` (23505).

**Fix (mig 0320+0320b):** `ON CONFLICT (webinar_id, email_snapshot) DO UPDATE` adopta la fila del
prospecto (fija administracion_id+profile_id, **limpia prospecto_id** para respetar el XOR de
identidad) → idempotencia real + cubre la carrera de doble submit. El e2e cazó un bug propio (no
limpiaba `prospecto_id`, violaba `webinar_inscriptos_identidad_xor`) antes de producción. Además,
mensajes humanos por constraint en `errors.ts`.

**Fecha / módulo:** 2026-07-10 · eventos / inscripción · mig 0320/0320b. Verificado e2e.

---

## E-GG-105 · REGRESIÓN: activar una inscripción con CUIT en el formulario rompía toda la activación

**Síntoma (reporte JL, nueva tanda):** al activar una inscripción (RPAC/curso) desde el wizard de
activación, el proceso cortaba con **"Se detuvo el proceso: Alta del cliente + apertura del trámite"**
y el error `new row for relation "administraciones" violates check constraint "administraciones_cuit_check"`.
"Antes funcionaba" → clásica regresión.

**Causa raíz (migs 0310 y 0312, propias):** los triggers `sync_submission_a_administracion` (0310) y
`backfill_admin_desde_tramite_submission` (0312) —agregados para propagar los datos del formulario a
la administración— tomaban el CUIT de la submission con sólo `trim()`, **sin normalizar**, y hacían
`cuit = COALESCE(cuit, v_cuit)`. Cuando el solicitante cargaba el CUIT CON GUIONES en el form público
(ej. `30-64788883-2`), lo escribían tal cual → viola el check `administraciones_cuit_check (^\d{11}$)`.
Y como el **backfill dispara AL CREAR EL TRÁMITE dentro de `solicitud_activar`**, la violación abortaba
toda la RPC de activación. Antes de 0310/0312 no se backfilleaba el CUIT → no ocurría.

**Fix (mig 0322) en dos capas:**
1. **Normalizar** el CUIT a 11 dígitos (`regexp_replace(...,'[^0-9]','')`, basura → NULL) y el DNI a
   7-8 dígitos, en AMBOS triggers, antes de escribir.
2. **Best-effort:** el `UPDATE` de backfill/sync va envuelto en `EXCEPTION WHEN OTHERS THEN NULL` — un
   dato del formulario NUNCA debe romper el flujo padre (la creación de la submission o el trámite).
   Esto además blinda contra cualquier futura violación de check/unique (ej. el índice `uq_admin_dni_activo`
   de 0321) desde estos triggers de propagación.

**Frontend (reporte JL, mismo circuito):** el wizard de activación ahora (B) **pre-llena el CUIT** que
cargó el solicitante en el form (normalizado a dígitos), en vez de dejarlo vacío; y (C) usa **Consumidor
Final** como condición IVA por defecto cuando el formulario no la provee (antes Monotributo).

**Verificación:** e2e (rollback) del trigger (submission con `30-64788883-2` ya no rompe, guarda
`30647888832`; DNI `12.345.678`→`12345678`; CUIT basura→NULL) + **e2e end-to-end de `solicitud_activar`**:
crea cliente + trámite sin error, CUIT backfilleado normalizado.

**Lección:** todo trigger de propagación que escriba en una tabla con CHECK/UNIQUE debe (a) normalizar
al formato que exige el constraint y (b) ser best-effort (no romper el statement padre). Emparienta con
R17 (triggers y RLS) — acá el riesgo no era permisos sino un check de formato.

**Fecha / módulo:** 2026-07-10 · solicitudes / activación · mig 0322 + wizard. Regresión de 0310/0312.

**Barrido integral de regresión (migs 0306–0322, §6 · 3 agentes + e2e):** a raíz de esta regresión
se auditó TODA la ventana buscando el mismo patrón y vecinos. Resultado — **verificado LIMPIO:** las 5
funciones de mail reescritas en 0319 (side-effects idénticos, fan-out intacto), el gate de tenant de
0318 (sólo excluye baja; todo alta crea `activo=true/estado='activo'`), el índice DNI de 0321 (sólo lo
escriben los 2 triggers, ya best-effort), sin overloads (R16, 0 filas). **Hallazgos:**
- **#1 (regresión real, mig 0323):** `administracion_reactivar` (0318) podía tirar un 23505 crudo del
  índice `uq_admin_cuit_activo` al reactivar un cliente si ya existía otro activo con el mismo CUIT
  (reingreso "crear cuenta nueva"). Fix: guard que detecta el gemelo activo y avisa con mensaje humano.
- **#2 (blindaje, mig 0323):** trigger BEFORE en `administraciones` que normaliza `cuit`→11 dígitos y
  `responsable_dni`→dígitos. Cierra de raíz la familia E-GG-105 para CUALQUIER path (incl. el INSERT
  crudo latente de `solicitud_activar`/0278).
- **#8 (follow-up inerte):** `fusionar_administraciones` (0313) no reasigna 4 tablas de config per-admin
  (`patrones_conciliacion`, `recupero_config`, `vencimientos_config`, `tabulador_precios`) — todas con
  0 filas hoy, así que no orfana nada; agregar los 4 `UPDATE` si empiezan a usarse per-admin.

## E-GG-106 · Botón "Siguiente" que GUARDA/EMITE sin querer (reconciliación React) — 2026-07-12
**Reporte JL (docx2 #3):** al editar un cliente para cargar la matrícula, el drawer llega al paso 3
(Contacto) y al hacer "Siguiente" para ir al paso 4 "se guarda y se cierra". **Causa raíz (reproducida
en vivo + instrumentada con un listener de `submit`):** en los drawers multi-paso, "Siguiente" y el
botón submit final (`Guardar`/`Emitir`/`Registrar`) ocupan la MISMA posición del condicional
`{!isLast ? <Siguiente> : <Submit form="x-form">}`, así que React **reusa el mismo nodo `<button>`**.
Al cliquear "Siguiente" en el PENÚLTIMO paso, `onClick={next}` hace `setStep` → `isLast` pasa a true →
React muta ese mismo botón en el submit (le agrega `form="x-form"`) ANTES de que el browser ejecute la
acción por defecto del click → **submitea el form**. El listener capturó `submitter="Guardar",
form="admin-form"`. Por eso SÓLO ocurría en el penúltimo paso. **Latente/pre-existente**, no lo
introdujo ningún cambio reciente; afloró al editar un cliente completo (validación pasa → guarda).
**Sistémico:** el mismo patrón estaba en 4 drawers, 2 financieros (`ComprobanteFormDrawer` "Emitir",
`RegistrarCobranzaDrawer` "Registrar" → riesgo de emitir/cobrar sin querer). **Fix:** (a) `Button.tsx`
default `type="button"` (red global; también arregló la fragilidad de `EmisoresPage:809`); (b) `key`
distinta (`wiz-next`/`wiz-submit`) en el par condicional de los 4 drawers → React ya no reusa el nodo,
no puede mutarlo a submit. Verificado en vivo: "Siguiente" avanza al paso 4, `Guardar` sigue guardando
(1 solo submit). **Lección/regla:** en un condicional que alterna entre un botón de navegación y uno de
submit en la misma posición, SIEMPRE `key` distinta + `type="button"` explícito en el de navegación.

## E-GG-107 · Aviso mudo tras rechazar documentación (docs en tandas) — 2026-07-12
**Reporte JL (docx2 #5):** cuando a un cliente se le piden 2 constancias y no las envía juntas, o cuando
se le rechaza un item y lo re-sube, gerencia no se re-entera. **Causa raíz:** `tramite_pedido_doc_
rechazar_item` marcaba el item 'rechazado' pero NO limpiaba `tramite_pedidos_doc.enviado_para_revision_at`
(drift de la mig 0130 (e)). El botón "Enviar a gerencia" del portal exige `enviado_para_revision_at IS
NULL`; con el flag seteado, tras corregir y re-subir, el cliente no podía re-enviar → aviso mudo. **Fix
(mig 0325):** al rechazar un item, reabrir el pedido (`enviado_para_revision_at = NULL`). Además (#4, mig
0327) el widget de docs pendientes del Inicio keyea por item `subido`, así que la subida parcial/en
tandas aparece aunque el cliente aún no apriete "Enviar". e2e verificado (item rechazado + flag limpio).

## E-GG-111 · FUGA: el mail de recordatorio al cliente filtraba el email del gestor + notas internas
**Reporte JL (Doc wave 6 · P8-A):** el mail "TRACKING RECORDATORIO" que recibe el CLIENTE mostraba
"Envío a sector de gestoría — destinatario: adm.global.laplata@gmail.com". **Causa raíz:**
`tracking_linea_on_insert()` disparaba `encolar_email('tracking-recordatorio', v_to_email=login del
cliente, ..., 'descripcion', NEW.descripcion)` para CUALQUIER línea con `alerta_en > now()`, IGNORANDO
`visible_cliente`. La derivación (solicitud_derivar_v2/v3) crea una línea INTERNA (visible_cliente=false)
con alarma futura de seguimiento y descripción que embebe el email del gestor + las Observaciones
internas → el cliente recibía ambos. **Materializado en producción** (email_queue 2026-07-11/13). Mismo
trigger filtraba una "nota interna del equipo" si el gerente le ponía "alerta futura". **Fix (mig 0337):**
`AND NEW.visible_cliente = true` en la rama de recordatorio. Se preserva el recordatorio legítimo (línea
client-visible con alarma futura sigue avisando). e2e: derivación interna → 0 mails al cliente; línea
visible con alarma → 1 mail. Forward-only (los mails ya enviados son históricos).

## E-GG-112 · Cta.Cte del portal ocultaba movimientos con fecha futura → desincronizada del inicio
**Reporte JL (P5-B):** un pago con fecha 14/07 (futura) se reflejaba en el saldo del inicio del portal
pero NO en la Cta.Cte que ve el cliente. **Causa raíz:** `cliente_ctacte_extracto` capaba el extracto con
`v_hasta := COALESCE(p_hasta, CURRENT_DATE)`; un movimiento con fecha futura quedaba excluido, pero
`cliente_deuda_neta` (saldo del inicio) baja sin filtro de fecha al imputarse. **Fix (mig 0338):**
`v_hasta := COALESCE(p_hasta, 'infinity')` — sólo aplica cuando el portal/ficha no pasan tope; para fechas
pasadas/actuales 'infinity' >= la fecha, así el resultado es idéntico. e2e: pago futuro → abono visible +
saldo final reconcilia con la deuda del inicio. **Adyacente:** el saldo del portal derivaba de la última
fila de un extracto recortado a 1 año, así que un comprobante impago de +12 meses mostraba "cuenta saldada
$0" — se corrigió en `cobranzas.ts` conservando el `saldo_inicial` como fila "Saldo de períodos anteriores"
(monto 0, saldo = balance de arranque) en vez de descartarlo.

## E-GG-113 · Sobrepago no tenía destino: no se podía dejar saldo a favor en la cobranza
**Reporte JL (P10-A):** el cliente transfirió $85.000 y debía $75.000; no había forma de registrar los
$10.000 a favor. **Causa raíz:** `registrar_cobranza_comprobante` bloqueaba incondicionalmente
`p_monto > saldo` e imputaba el monto completo → nunca dejaba residual (la infra de crédito ya existía,
pero esa vía era inalcanzable). **Fix (mig 0339, R16 DROP+CREATE):** 9º param `p_permitir_excedente
boolean DEFAULT false`; con excedente, la transferencia entra completa a la caja pero se imputa sólo el
saldo → residual = saldo a favor automático. Default false → todos los callers actuales byte-idénticos
(fat-finger sigue dando error). Frontend: checkbox "El cliente pagó de más → saldo a favor" en el drawer
de cobranza. e2e: sin flag bloquea; con flag comprobante pagado + $10.000 a favor; 0 overloads.

## E-GG-114 · Campos del formulario que no llegaban a la ficha del cliente
**Reporte JL (P6-B) + barrido:** el N° de matrícula (y más) no se cargaba en el detalle del cliente.
**Causa raíz:** mismatch de claves form↔trigger. `certificado-rpac` guarda la matrícula bajo `matricula`
pero los triggers leían sólo `matricula_rpac`. Además: `cuit_persona_juridica` (una jurídica quedaba SIN
CUIT), `representante_legal_nombre/dni`, `condicion_iva` (relevante para emitir), `domicilio_fiscal`,
`localidad/provincia/codigo_postal` — ninguno se persistía. **Fix (mig 0340):** fallbacks COALESCE en los
DOS triggers (backfill sobre tramites + sync sobre la submission), + condicion_iva/domicilio_fiscal en el
INSERT de `solicitud_activar`, + backfill de lo ya activado. Aditivo/idempotente (nunca pisa valor
cargado). e2e: 7/7 campos persisten desde una submission de prueba.

## E-GG-115 · Movimientos ordenaban por UUID aleatorio, no por hora de carga
**Reporte JL (P6-A) + barrido:** en Cajas/Cta.Cte el último movimiento del día no quedaba arriba. **Causa
raíz:** `fz_listar_movimientos` ordenaba `fecha DESC, id DESC` donde `id` es un UUID v4 aleatorio → orden
intra-día arbitrario, aunque existe `created_at`. Mismo patrón en `listar_creditos_administracion`
(`ORDER BY fecha DESC` sin desempate). **Fix (mig 0341):** agregar `created_at DESC` al ORDER BY (con
SELECT explícito de las 20 columnas del RETURNS TABLE, respetando el orden exacto). e2e: columnas
alineadas + orden por created_at.

## E-GG-116 · Feature: "Con Deuda" en la lista + widget de pagos informados en el Inicio
**Reporte JL (P7-A/P5-A):** no había forma de ver de un vistazo qué cliente adeuda, ni aviso de pagos
informados en el Inicio. **Fix (mig 0342 + frontend):** RPC batched `administraciones_con_deuda()` (deuda
NETA, misma fórmula que `cuenta_corriente_morosos` → consistente con la ficha) → chip "Con Deuda" en la
lista de trámites; `PagosInformadosWidget` (tono ámbar, realtime) en el Inicio + `ALTER PUBLICATION` para
que `pagos_reportados` refresque en vivo. e2e: `administraciones_con_deuda` = morosos.

## E-GG-117 / E-GG-118 · UX del portal de documentación (P6-C / P9-A)
**Reporte JL:** (P6-C) si el cliente sólo adjunta el archivo sin escribir texto, "no lo deja enviar";
(P9-A) los dos botones "Enviar" confunden. **Causa raíz:** NO era bug funcional (adjunto-sin-texto SÍ se
envía, verificado en prod). El input de texto residual seguía visible tras subir el archivo (confundía), y
el "Enviar" por-ítem compartía verbo con "Enviar a gerencia". **Fix (frontend):** ocultar el input de texto
cuando el ítem ya está satisfecho por adjunto (estado 'subido' + archivo_path); relabel "Enviar" →
"Enviar dato". Cero cambio de lógica/RPC.

## Barrido de consistencia contable (detectado, NO reportado por JL) · pendiente-decisión
El barrido §6 encontró que las 4 superficies de saldo (inicio portal / cta.cte portal / cta.cte gerencia /
ficha) usan horizontes de fecha y neteo distintos → el MISMO cliente puede mostrar hasta 4 números en
casos borde. Se corrigieron los bugs CONCRETOS que el cliente ve (fecha futura E-GG-112, +12 meses cuenta
saldada, sobrepago E-GG-113). La **unificación canónica** (una sola función de saldo para todas las
superficies) se difirió a una pasada dedicada por decisión de Pablo (toca lecturas ya probadas en más
lugares; merece su propio §6 + live sin apurar la salida al mercado). GAP documentado.

## E-GG-119 · REGRESIÓN: `anon` recuperó EXECUTE sobre `registrar_cobranza_comprobante` + guard falla-abierto (idéntico a E-GG-109b)
**Detección:** auditoría adversarial del diff de wave 6 (agente de revisión de regresiones), NO reportado por
JL. **Causa raíz (misma que [E-GG-109b], mig 0336):** la mig 0339 reescribió
`registrar_cobranza_comprobante` con `DROP FUNCTION` + `CREATE FUNCTION`, y la 0342 creó
`administraciones_con_deuda` nueva. El schema `public` tiene `ALTER DEFAULT PRIVILEGES` que auto-otorga
EXECUTE a `anon`/PUBLIC en toda función nueva → ambas quedaron ejecutables por `anon` con la anon-key
pública. Ambas migraciones sólo hicieron `REVOKE … FROM PUBLIC`, que **NO** saca el grant explícito de
`anon` (hay que nombrar `anon` explícito). **Agravante (por qué era crítico, no "postura"):** el backstop
de ambas era `IF NOT private.is_staff()`, que **falla-abierto** para anon —
`auth.uid()=NULL → is_staff()=NULL → NOT NULL = NULL → el IF no dispara el RAISE/RETURN`. Verificado en
vivo: `private.is_staff()` sin auth devuelve NULL, y un `PERFORM registrar_cobranza_comprobante(...)` sin
JWT **pasaba el guard** (antes del fix). Como ambas son SECURITY DEFINER (bypassa RLS), un caller anónimo
con un comprobante_id+caja_id conocidos podría escribir un asiento contable (único writer contable) y
enumerar el set de administraciones morosas. **Fix (mig 0343, doble, patrón 0336):** (1) guard
`private.is_staff() IS NOT TRUE` (rebota NULL/anon además de false) — defensa en profundidad safe-by-default
ante futuros DROP+CREATE; (2) `REVOKE ALL … FROM PUBLIC, anon` + `GRANT … TO authenticated, service_role`.
**Verificación e2e (BEGIN/RAISE-rollback):** anon → SQLSTATE 42501 "Solo gerencia…" (bloqueado); staff →
default 400/400/saldo 600 y excedente 700/imput 600/saldo 0/a-favor 100 (writer intacto). R16 smoke = 0
overloads. **Lección grabada:** en este proyecto `REVOKE … FROM PUBLIC` **nunca** alcanza para sacar a
`anon` (por el `ALTER DEFAULT PRIVILEGES`) → **siempre** `FROM PUBLIC, anon`; y `IF NOT is_staff()`
falla-abierto para anon → **siempre** `IS NOT TRUE`. Todo `DROP+CREATE` de una función staff-only debe
re-aplicar ambos en la misma migración. (Ver [E-GG-109b].)

## E-GG-120 · Portal Inicio mostraba DEUDA BRUTA (no neteaba el saldo a favor) → inconsistente con la Cta.Cte.
**Detección:** unificación canónica de saldo (DGG-108), capitalizando el GAP de consistencia documentado en
wave 6. **Síntoma (ya visto por JL, comentario en `AdministracionDetailPage.tsx`):** un cliente con un
comprobante impago de $410.000 y un crédito/saldo a favor de $205.000 (p.ej. de una anulación) mostraba
**"$410.000 a regularizar" en el Inicio del portal** pero **"$205.000" en la Cta.Cte./ficha/gerencia**.
**Causa raíz:** de las 4 superficies de saldo, la única desalineada era el Portal Inicio, que usaba
`cliente_deuda_neta` devolviendo `Σ saldo_pendiente` (DEUDA BRUTA) **sin restar el crédito**; las otras 3 ya
netean (`cuenta_corriente_extracto`/`_resumen`). Además la gerencia-módulo cortaba el saldo en 31/12 del año
en curso (excluía comprobantes futuros del año próximo, divergiendo de portal/ficha que son all-time), y
`cliente_deuda_neta` no excluía `borrador`. **Canon definido:** `saldo_neto = Σ saldo_pendiente(comprobantes
vivos) − Σ créditos_residuales(ingresos no imputados)`. En el caso NORMAL (toda cobranza imputada completa)
el crédito es 0 → **neto == bruto → ningún número cambia**; sólo se corrige cuando hay saldo a favor real.
**Fix (mig 0344 + frontend):** (1) NUEVO helper canónico único `administracion_credito_disponible(uuid)`
(guard staff-o-dueño → 0 si no autorizado, sin filtrar a terceros); (2) `cliente_deuda_neta.total` =
`GREATEST(0, bruto − helper)` + excluye borrador; (3) `administraciones_con_deuda` y `cuenta_corriente_morosos`
usan el helper (refactor idempotente, mismos números, una sola fuente de verdad); (4) frontend gerencia-módulo
(`CtaCteDetailPage`): KPI "Saldo actual" = `deuda_total − saldo_a_favor` (all-time neto, ya expuestos por
`cuenta_corriente_resumen`) en vez del `saldo_actual` acotado por fecha → los KPIs "en período" y el ledger
siguen respetando el filtro. **Verificación e2e (BEGIN/RAISE-rollback):** clientes reales sin crédito
(Saveriano 100.000 / Pagas 75.000) **idénticos a antes**; escenario sintético con crédito (410k impago + 205k
no imputado) → `cliente_deuda_neta` = `cuenta_corriente_resumen(deuda_total−saldo_favor)` = `morosos` =
`cuenta_corriente_extracto` = **$205.000 en las 4 superficies** (antes el Inicio decía $410.000). R16 = 0
overloads; helper anon=false. **Lección:** el crédito/saldo-a-favor tenía 3 definiciones inline idénticas;
ahora hay UNA (`administracion_credito_disponible`). Toda superficie nueva de saldo debe consumir el helper y
mostrar el NETO. (Ver [feedback consistencia contable].)

**Addendum (revisión adversarial de 0344 → mig 0345 + frontend).** La doble auditoría §6 (3 agentes,
todo en BD con rollback) confirmó las 4 superficies convergiendo y destapó adyacencias de severidad baja,
todas cerradas: **(U2)** el KPI "Saldo actual" de la gerencia-módulo (all-time) no cuadraba con el ledger
(rango hasta 31/dic) si había un comprobante del año próximo → `defaultHasta` ampliado a fin del año
siguiente. **(U3, mig 0345/E-GG-120b)** `kpis_dashboard_global` (KPI "Deuda total" del Inicio de gerencia)
usaba universo `estado='autorizado'`, más angosto que el canon → alineado a `NOT IN ('anulado','borrador')`
(latente: 0 cambio de dato hoy, e2e home=175.000 intacto). **(U4)** la LISTA de cta.cte de gerencia
(`cuenta_corriente_resumen_global`) exponía `deuda_total` BRUTA → el frontend (`getResumenGlobal`) ahora
netea `GREATEST(0, deuda_total − saldo_a_favor)` en un solo lugar (columna+filtros+orden+KPI). **Moderación**
(atajo pedir-doc): blindado contra pedido duplicado si el paso 'interno' falla y se reintenta
(`pedidoCreadoRef`). **Asimetrías ACEPTADAS (no bugs):** (a) el Portal Inicio y la lista pisan el saldo a 0
en caso acreedor (widget de "deuda a regularizar"; el crédito se muestra por separado) — el detalle sí
muestra el acreedor negativo; (b) `cliente_deuda_neta` netea el total pero los counts siguen a nivel
comprobante (la banner del portal ya usa `total>0`, no se muestran). **Follow-up documentado:** el `cobrado`
de `kpis_dashboard_global` usa `m.estado<>'anulado'` en vez de `='identificado'` (métrica de período, no
saldo). Verificación e2e final: KPI home = morosos = lista neta = **$175.000**; chip "Con Deuda" = 2 admins;
R16=0, R17=0.

## WAVE 7 · Blindaje integral (auditoría exhaustiva de 8 circuitos) — E-GG-121..126

Origen: Pablo — "cada vez que JL revisa encuentra 10 cosas; blindar TODOS los circuitos,
única fuente de verdad, 100% de certeza sobre cada rol". Se corrió un workflow de 8 agentes
(landing/forms, portal, gerencia, gestor, partner, storage, contable, emails), cada uno
generando hipótesis por rol/operación y verificando en BD (rollback). Doble §6 adversarial.

### E-GG-121 · (pág.5 JL) El campo de "dato" del pedido de docs desaparecía al subir el adjunto
Regresión de [E-GG-117]: se ocultaba el input de texto cuando el ítem tenía archivo, pero un
pedido puede necesitar archivo Y dato (ej: subí el DNI y escribí el legajo). El cliente que
subía primero el archivo ya no podía cargar el dato. Fix (PedidosDocPanel): el input queda
disponible mientras el ítem no esté 'aprobado' (responder_texto_item no pisa archivo_path,
coexisten).

### E-GG-122 · (pág.4 JL) El extracto de Cta.Cte ordenaba lo más viejo arriba
Las Cajas ya mostraban lo último arriba (E-GG-115) pero el extracto del cliente (portal + ficha
+ gerencia) seguía ASC. Fix: invertir la PRESENTACIÓN (PortalCtaCtePage/AdministracionDetailPage/
ExtractoTable) — lo más reciente arriba; el saldo por fila (acumulado) y el saldoActual no
cambian (siguen calculándose sobre el orden cronológico).

### E-GG-123 · CRÍTICA · `private.is_staff()` falla-abierto para anon (sistémico) + fuga de mail del gestor
CAUSA RAÍZ: is_staff() = get_user_role() IN (...) devolvía NULL para anon (auth.uid()=NULL). Decenas
de RPC usan `IF NOT is_staff() THEN RAISE` que con NULL NO dispara → un ANÓNIMO con la anon-key podía
(confirmado e2e): leer los datos financieros de TODOS los clientes (cuenta_corriente_resumen_global),
CERRAR y REABRIR cualquier trámite (tracking_cerrar/reabrir). Fix de mayor palanca (mig 0346):
`is_staff() = COALESCE(get_user_role() IN ('gerente','operador'), false)` → nunca NULL, cierra TODOS
los call-sites `IF NOT is_staff()` de una vez (estrictamente más seguro). + defensa en profundidad:
REVOKE anon en resumen_global/resumen/tracking_cerrar/reabrir + REVOKE INSERT anon en
formulario_submissions/adjuntos (el alta pública va por el edge service_role; el INSERT directo
bypasseaba validación+rate-limit y permitía envenenar la ficha ajena). FUGA de email (lo que JL vio
en "otros mails", pág.2): solicitud_derivar insertaba la línea "Envío a sector de gestoría —
destinatario: <mail del gestor>" con visible_cliente=TRUE → se filtraba al cliente. [E-GG-111] tapó
sólo el recordatorio; ésta es OTRA ruta. Fix: visible_cliente=false + backfill. e2e: is_staff()_anon=
false; tracking_cerrar anon→42501; staff intacto; anon_exec revocado.

### E-GG-124 · Partner (sábana $0 tras cerrar convenio), fusión (huérfanos), ARCA rota, flujo de caja (revertidos)
mig 0347: (a) partner_sabana resolvía el convenio con `pc.activo` → tras cerrar/renovar el convenio,
TODA la historia del partner quedaba 0%; fix: resolver por rango de fechas (el que regía a esa fecha).
(b) fusionar_administraciones no movía pagos_reportados (pago del cliente imposible de conciliar),
profiles (el usuario seguía logueando contra una admin en baja) ni patrones_conciliacion; fix: se
agregan al fan-out. (c) arca_emisor_default/set_default referenciaban `public.is_staff()` (inexistente)
→ RPC ROTAS; fix: private.is_staff(). (d) fz_reporte_flujo_caja: un ingreso REVERTIDO seguía contando
(filtraba origen<>'reversion' pero no revertido_at); fix: + revertido_at IS NULL.

### E-GG-125 · R20 en subirArchivoItem (pedidos de doc)
La storage key usaba file.name.split('.').pop() → sin extensión, todo el nombre (con espacios/acentos)
pasaba a la key. Fix: extraer sólo extensión alfanumérica corta o 'bin'.

### E-GG-126 · FOLLOW-UPS DIFERIDOS (documentados, NO resueltos en wave 7 por riesgo/alcance)
- **Buckets públicos con docs privados** — ✅ **NÚCLEO RESUELTO 2026-07-17** (decisión Pablo "núcleo
  quirúrgico ya" · DGG-110 · migs 0364/0365 + edge fn gestor-firmar-adjunto v4 + commits cf8c4be…):
  `gestor-uploads` (5 docs reales de clientes), `partner-facturas` y `tramite-documento-final`
  (vacíos, cerrados ANTES de usarse) pasaron a **private**. Diseño clave que evitó el refactor
  temido: el identificador persistido SIGUE siendo la URL getPublicUrl completa (cero migración de
  datos, compatible con históricos y columnas polimórficas que mezclan URLs externas y /verificar/);
  los LECTORES resuelven a signed URL **on-click** con `src/lib/storageUrls.ts` (7 superficies
  convertidas), el cliente lee vía policies SELECT scoped con helpers `private.*` (patrón E-GG-70)
  y el gestor externo anónimo vía la edge fn v4 (candado por token). La doble auditoría §6 del
  chunk (workflow 3 scopes + verificación adversarial, 672k tokens) capturó ANTES de producción
  una regresión crítica latente: la edge fn v3 sólo resolvía bucket `gestor-uploads` en su fuente
  3c y filtraba `moderacion_estado='publicado'`, pero `gestor_listar_avances` lista toda línea
  `visible_cliente` (las de gerencia y la línea automática de cierre quedan con moderación NULL)
  y la línea de cierre lleva el documento final en bucket `tramite-documento-final` → el primer
  cierre con PDF habría dado 403 en el panel del gestor (regla 15: regresión vs bucket público).
  Fix v4: 3c(ii) espeja `visible_cliente=true` y resuelve el bucket real de la URL persistida con
  whitelist. Hardening adicional (mig 0365): helper del cliente pasó de `LIKE '%'||p_name` (comodines
  `_`, TRUE con vacío, sin ancla) a igualdad exacta de key; y la policy pre-existente
  `partner_facturas_auth_read` que dejaba a CUALQUIER partner leer todo el bucket ahora scopea por
  la atribución real de `partner_mis_comprobantes` (helper `private.partner_puede_ver_factura`).
  Verificado: e2e BD (8 asserts helpers, rollback forzado) + e2e HTTP edge fn (doc final ok/
  descarga 200/regresión ok/cross-trámite 403/token inválido 401/URL pública vieja 400) + en vivo
  las 3 superficies (gerencia, portal cliente por rol-swap, panel gestor por token QA — desktop y
  360px) + 0 residuos QA. `campus-media` y los candidatos avatars/emisor-logos/encuesta-testimonios
  quedan como decisión futura separada (DGG-110).
- **voucher_incrementar_uso / voucher_validar** anon: incrementar_uso no tiene guarda (anon con un
  voucher_id podría agotar un voucher); validar es un oráculo de enumeración. El fix limpio es mover
  el incremento server-side (edge submit) — refactor del flujo público. Mitigación actual: los ids son
  UUID no enumerables y los códigos deben ser de alta entropía. Diferido.
- **tramite_pedido_doc_subir_item**: no valida que archivo_path arranque con <tramite_id>/ (un cliente
  podría apuntar el ítem a un path de otro trámite dentro del mismo bucket privado). Guard barato,
  diferido al chunk de storage.
- **tracking_moderar_gestor_avance 'publicar'**: manda la descripción cruda del gestor al cliente si el
  gerente no la edita (por diseño hoy; el gerente revisa). Se documenta como decisión de producto.
- **crédito gateado por administraciones.user_id** vs tenancy canónica profiles.administracion_id
  (latente): riesgo teórico de divergencia Inicio(bruto)/Cta.Cte(neto) si difieren; hoy coinciden.

### E-GG-127 · REGRESIONES del propio wave 7 (capitalizadas por la doble auditoría §6)
La doble auditoría §6 de cierre (mandato Pablo) del wave 7 encontró que el root-fix de
[E-GG-123] (is_staff() NULL→false, mig 0346) — correcto y necesario para cerrar el fail-open de
anon — CERRÓ sin querer el "fail-open de service_role" del que dependían tres callers de confianza
que corren con SERVICE_ROLE_KEY y SIN JWT de usuario (auth.uid()=NULL → is_staff()=false → los
guards `IF NOT is_staff()` ahora DISPARAN 42501). Lección: al endurecer un helper de autz. usado
por edges/crons, verificar TODOS los call-sites service_role, no sólo los del front. Fix mig 0348:
- **CRÍTICA (cron cobranza muerto)**: edge `dispatch-recupero` (cron diario 12:30) llama
  `comprobantes_morosos(NULL)` + `disparar_recupero_manual(...)` con service_role → 42501 → la
  cobranza automática (recupero R1/R2/R3) dejaba de enviarse en silencio.
- **ALTA (meeting Zoom huérfano)**: edge `zoom-webinar-create` llama `webinar_set_zoom(...)` con
  service_role → el meeting se creaba en Zoom pero el INSERT fallaba → sala huérfana no persistida.
- **MEDIA (monitoreo caído)**: edge `db-health-alert-check` (cron diario 12:00) llama
  `db_health_metrics()` con service_role (su comentario dice "bypassa is_staff") → 42501.
Fix de mayor palanca: helper `private.is_staff_or_service()` = `is_staff() OR COALESCE(auth.role()=
'service_role', false)` (COALESCE para no reintroducir NULL; el service_role sólo vive server-side
—R3— y ya tiene god-mode, así que NO abre superficie: discrimina de anon, que es auth.role()='anon').
Los 4 gates pasan a usarlo. Verificado e2e: service_role pasa los 4 (llega a la lógica: P0002/OK),
anon sigue BLOQUEADO en los 4 (42501), staff intacto (morosos all=2/scoped=1).
Además, dos hallazgos adyacentes del mismo audit:
- **cert_marcar_celebracion_vista** (fail-open PRE-EXISTENTE, no regresión): la comparación
  `auth.uid()=v_alumno` propaga NULL para anon → cualquier anónimo podía marcar la celebración de
  un certificado como vista. Bajo impacto (un timestamp) pero es fail-open. Fix: `COALESCE(auth.uid()
  =v_alumno,false)` + REVOKE anon (verificado: anon sin EXECUTE; authenticated OK).
- **fusionar_administraciones** (regresión de mig 0347): la UPDATE de patrones_conciliacion que se
  sumó al fan-out abortaba con 23505 (patrones_unique) si origen y destino comparten un patrón (muy
  probable: ambos tienen "TRANSFERENCIA", etc.) → la fusión ENTERA se caía. Fix: dedupe-delete de los
  patrones del origen que colisionan (categoria_id nullable → IS NOT DISTINCT FROM) antes del move
  (patrones no tiene FKs entrantes, verificado). e2e: fusión OK, moved=1/descartados=1, destino=2/
  origen=0. (Los demás UNIQUE que incluyen administracion_id en fusionar —administracion_emails,
  cliente_oportunidad_eventos, comunicaciones_destinatarios, consorcios— son PRE-EXISTENTES y abortan
  limpio en 1 sola transacción sin corromper datos; se dejan como GAP conocido: consorcios no se puede
  dedupe-delete sin orfanar FKs, requiere resolución manual del código. Diferido con [E-GG-126].)

### E-GG-128 · (pág.4 JL) Conciliar pago > saldo del comprobante: faltaba "dejar el excedente a favor"
JL (captura pág.4): informó $85.000 contra un comprobante de saldo $75.000; el modal Conciliar (de
"Pagos informados") mostraba SÓLO el warning "El importe supera el saldo… Ajustá el monto o elegí otro"
y deshabilitaba el botón — sin la opción de dejar los $10.000 a favor. En el cierre de wave 6 afirmé que
el sobrepago→saldo a favor "andaba", pero eso era el flujo **Cobrar** (RegistrarCobranzaDrawer, [E-GG-113]);
el flujo **Conciliar** (`pago_conciliar`) NO exponía el opt-in → hueco real (mi claim no cubría este
camino). Causa: `pago_conciliar` llamaba a `registrar_cobranza_comprobante` (único writer contable, que
ya soporta el excedente) SIN pasarle el flag; y el modal `ConciliarModal` gateaba el botón con
`!excedeSaldo`. Fix (mig 0349 + front): `pago_conciliar` gana `p_permitir_excedente boolean DEFAULT false`
(R16: DROP firma vieja 7-args + CREATE 8-args, no CREATE OR REPLACE) que pasa al writer; el modal suma el
checkbox "dejar el excedente como saldo a favor" (paridad visual con Cobrar), des-gatea `puede` cuando se
marca, y muestra "A favor $X" en el preview. e2e (rollback): SIN opt-in sigue rechazando ("$85.000 supera
$75.000"); CON opt-in → comprobante saldo→$0 + `administracion_credito_disponible` 0→$10.000. El crédito
queda disponible para imputar a futuro (misma fuente de verdad que [E-GG-120]).

### E-GG-129 · CRÍTICA · la cobranza AUTOMÁTICA seguía muerta una capa MÁS adentro que [E-GG-127]
El QA blast-radius de wave 7 (workflow de 18 agentes, verificación e2e por contraste rol-a-rol)
descubrió que el cron `dispatch-recupero` (diario 12:30, service_role) SEGUÍA sin encolar nada, pese
a que [E-GG-127] (mig 0348) había arreglado el guard superior de `disparar_recupero_manual`
(is_staff→is_staff_or_service). CAUSA: `disparar_recupero_manual` llama a `encolar_email(...,
administracion_id NO-nulo, ...)` y `encolar_email` ejecuta INCONDICIONALMENTE
`private.assert_administracion_access(p_admin)` antes de encolar. Ese assert (regla 12) tenía 3 vías
de escape: `app.skip_admin_assert='on'` | `is_staff()` | `current_administracion_id()=p_admin`. Bajo
service_role NINGUNA aplicaba (skip sin setear; is_staff()=false tras [E-GG-123] NULL→false;
current_administracion_id()=NULL sin auth.uid()) → RAISE 42501 adentro de encolar_email. El cron
devolvía ok:true pero encolados=0, TODOS los morosos en errores[], 0 recupero_acciones, 0 email_queue,
comprobantes en 'pendiente'. Contraste e2e: con JWT del gerente real la MISMA RPC corría completa
(recupero_acciones=1, email_queue=1, estado='en_recupero') → el circuito staff/manual estaba OK, sólo
el service_role/cron roto. LECCIÓN (capitaliza [E-GG-127]): al endurecer un helper de autz, no basta
con arreglar los guards de PRIMER nivel de las RPC llamadas por edges; hay que seguir la cadena hasta
las funciones INTERNAS que también gatean (acá encolar_email→assert_administracion_access). Fix de
mayor palanca (mig 0350): el assert de tenencia reconoce al service_role como servidor de confianza
(`is_staff()`→`is_staff_or_service()`), igual que ya lo hacen los guards de nivel superior — arregla
de una TODA la clase de RPC service_role que bajen a assert. e2e verificado: service_role dispara
end-to-end (acciones=1, email_queue=1, en_recupero); anon SIGUE 42501; cliente tenencia intacta (su
admin OK, otra admin RAISE). Nota operativa: al deployar, la próxima corrida del cron va a procesar
los morosos acumulados de los días que estuvo caído (burst de recordatorios paceado por el throttle
de 5 min).

## WAVE 7 · Barrido e2e exhaustivo del circuito de CONTRATACIÓN — E-GG-130..135

Origen: Pablo — "probá la contratación de cada servicio, por ambos canales (landing/portal), cliente
nuevo/existente/duplicado, los 5 casos de pago, los 3 de doc, gestoría, evolución de estados, kanban y
alarmas; auditá cada punto de impacto; no presumas nada". Workflow de 46 agentes ejercitó la matriz en
BD (BEGIN/ROLLBACK, 0 datos persistidos) auditando cada tabla de impacto. NINGÚN escenario cerró OK —
todos con defecto en `solicitud_activar` o en los gates de cierre/precio. 6 bugs (mig 0351 fixea 5).

### E-GG-130 · (100% de las activaciones) la línea semilla del tracking nacía MUERTA
`solicitud_activar` sembraba la 1ª línea del timeline con `EXECUTE 'SELECT tracking_agregar_linea($1..$5)'`
— firma OBSOLETA de 5 args (la vigente es de 7). El 42883 quedaba tragado por `EXCEPTION WHEN OTHERS
THEN NULL` → la línea NUNCA se creaba → el timeline del cliente arrancaba VACÍO en cada activación
(anti-patrón R16/R18). Fix: `PERFORM` con firma real, categoría 'seguimiento_interno', visible_cliente=
true, `RAISE WARNING`. e2e: seed=1.

### E-GG-131 · UNIQUE(nombre) rompe activar un cliente HOMÓNIMO
`uq_administraciones_nombre` hacía fallar la activación del 2º cliente con igual nombre (23505 crudo); el
dedup real es por email/CUIT. El nombre no es clave natural. Fix: DROP unique + índice no único. e2e OK.

### E-GG-132 · trámite ARANCELADO se cerraba con CERO facturación (hueco contable)
`tramite_cerrar_exige_cobrado` sólo bloqueaba si había comprobante IMPAGO; sin comprobante emitido pasaba
→ matrícula $175.000 cerrada sin registrar el ingreso. Fix: si el servicio es arancelado (precio>0) y no
hay comprobante no-anulado ligado, bloquear con mensaje accionable. Sin servicio/gratis sigue cerrando.
e2e: arancelado sin comp→BLOQUEADO; sin servicio→cierra OK. **Refinado en la QA en vivo (mig 0352):**
la 1ª versión bloqueaba TODO cierre arancelado sin comprobante, incluso 'Matrícula rechazada' y
'Abandono del trámite' (cierres legítimos SIN ingreso) → habría roto ese circuito. `tracking_cerrar`
setea `cierre_satisfactorio` boolean (otorgada=true, rechazo/abandono=false) en el mismo UPDATE, así
que el gate ahora sólo exige comprobante si `NEW.cierre_satisfactorio=true`. e2e: otorgada sin
comp→BLOQUEADO; abandono sin comp→cierra OK. (Lección: verificar en vivo antes de cerrar evita romper
un flujo hermano no denunciado.)

### E-GG-133 · el email de activación NO se enviaba al cliente NUEVO (caso más común: landing)
Gate `AND NOT v_es_nuevo` → el cliente creado en la misma activación (landing→nuevo) no recibía la
confirmación. Fix: quitar la exclusión (email en v_email_admin vía RETURNING). e2e: email=1.

### E-GG-134 · precio/canal desde flag NO autenticado del body (spoofeable)
`crear_tramite_desde_submission_auto` tomaba canal/precio de `NEW.datos->>'_origen_canal'`. Fix: canal
'cliente' sólo con identidad verificada (administracion_id NOT NULL); sin admin→'publico'/precio_publico.
Impacto real $0.01 pero explotable. e2e: spoof sin admin→publico.

### E-GG-135 (mitigado, sin cambio) · duplicado silencioso de cliente
El Wizard (PasoCliente.tsx) YA invoca `solicitud_match_cliente` (email/CUIT/DNI) y muestra el match en
banner que defaultea a "vincular"; sólo se duplica si el gerente override + tipea otro email. Suficiente.

R16=0/R17=0, mig 0351 aplicada, todos los fixes e2e sin romper cierres legítimos.

### E-GG-136 · (alarma muerta en TODA superficie) "vencido" nunca se derivaba de la fecha
**Descubierto en la QA en vivo de PAGOS (tanda contratación).** Con un comprobante realmente vencido
(venc 2026-07-01, hoy 2026-07-15, saldo $30.000), el portal del cliente mostraba **VENCIDO $0** y el
row salía "Pendiente" (ámbar) en vez de "Vencido" (rojo). La ficha del comprobante en gerencia SÍ lo
pintaba "vencido" en rojo (deriva por fecha), pero los KPIs/alarmas de morosos NO. Causa raíz: nadie
**envejece** `comprobantes.estado_cobranza` a `'vencido'` — la columna sólo toma
`'pendiente'/'parcial'/'pagado'` (el único writer `registrar_cobranza_comprobante`, ningún cron/trigger
la mueve a 'vencido'; el valor es válido por CHECK pero muerto). Sin embargo, múltiples contadores de
KPI filtraban `estado_cobranza = 'vencido'` → **SIEMPRE 0**, aun con morosos reales (había 3 comprobantes
de-facto vencidos impagos en prod sin marcar). Blast radius (todo SOLO lectura/KPI):
- `cuenta_corriente_morosos` (venc + mayor_dias_vencido) → CtaCte gerencia
- `cuenta_corriente_resumen` (comprobantes_vencidos) → ficha administración + portal
- `cuenta_corriente_resumen_global` (comprobantes_vencidos) → lista CtaCte gerencia
- front `PortalComprobantesPage` y `ComprobantesListPage` (KPI "Vencido" + badge rojo + filtro "Vencido").

**El motor de cobranza/recupero NO estaba afectado**: `comprobantes_morosos` (dunning) y
`cliente_deuda_neta` (portal home, tono "urgente") YA derivaban por fecha (`vencimiento < current_date
AND saldo_pendiente > 0`). Sólo los contadores/badges de KPI estaban muertos.

**Fix (mig 0353 + front):** derivar "vencido" por FECHA en todas las superficies, idéntico al criterio
canónico (`saldo_pendiente>0`, comprobante vivo, `vencimiento < hoy`).
- mig 0353: reemplazado `estado_cobranza='vencido'` por el predicado de fecha en los 3 RPCs
  (CREATE OR REPLACE, misma firma → R16 sin DROP, GRANTs preservados).
- front: helper único `esComprobanteVencido()` en `services/api/comprobantes.ts` (compara strings
  `YYYY-MM-DD`, sin corrimiento TZ), usado en los KPI/badge/filtro de ambas listas; y en
  `listComprobantes` el pseudo-filtro `estadoCobranza='vencido'` se traduce al predicado de fecha
  (`.gt(saldo_pendiente,0).lt(vencimiento,hoy)...`) en vez de `.eq('estado_cobranza','vencido')`.

e2e (JWT staff): `cuenta_corriente_resumen(QA)` → comprobantes_vencidos 0→**1**; `_morosos` → el cliente
aparece con vencidos=1, mayor_dias_vencido=**14**; deuda neta $20k, saldo a favor $10k. R16=0. Build limpio.
GAP registrado (no en scope 136): la lista de comprobantes de GERENCIA calcula sus KPIs sobre el subset
paginado/filtrado del backend (mismo anti-patrón R19/E-GG-43 que ya se corrigió en el portal) — latente
mientras haya ≤ límite comprobantes; a corregir aparte.

### E-GG-137 · (loop de corrección de docs) el cliente reenviaba observaciones sin corregir + rechazo sin guard
**Descubierto en el mapeo doble §6 del subsistema Pedido de Documentación (tanda DOCUMENTACIÓN).** Dos huecos
en el circuito de revisión de documentos (gerencia observa → cliente corrige → reenvía → gerencia aprueba):
1. **Reenvío con observación viva.** `tramite_pedido_doc_enviar_revision` bloqueaba SÓLO ítems `pendiente`.
   Tras un rechazo (E-GG-107 resetea `enviado_para_revision_at=NULL`), un ítem quedaba `rechazado` pero
   `pendientes=0` → el front (`PedidosDocPanel.todosRespondidos = pendientes===0`) contaba `rechazado` como
   "respondido", habilitaba **"Enviar a gerencia"**, y el RPC lo dejaba pasar. Gerencia recibía "cliente envió
   documentación" con la observación sin resolver → ping-pong / estado confuso. El loop de corrección no se forzaba.
2. **`tramite_pedido_doc_rechazar_item` sin guard de estado** (a diferencia de `aprobar_item`, que sí valida).
   Se podía "observar" un ítem `pendiente` (que el cliente nunca subió → notificación de observación fantasma)
   o un `aprobado` (des-aprobándolo en silencio y dejando el pedido `completo` con un ítem `rechazado` →
   estado inconsistente, porque `rechazar` no reabre un pedido ya cerrado).

**Fix (mig 0354 + front):**
- `enviar_revision`: además de `pendiente`, bloquea si hay ítems `rechazado` ("Tenés N ítem(s) observado(s) sin
  corregir. Volvé a subir lo observado antes de reenviar."). CREATE OR REPLACE, misma firma → R16 sin DROP.
- `rechazar_item`: guard `IF v_item.estado NOT IN ('subido','rechazado')` → bloquea `pendiente`/`aprobado`.
- `PedidosDocPanel.tsx`: `todosRespondidos` exige también `rechazados===0`; footer suma rama roja "Tenés N
  observado(s), corregí para reenviar".
- `PortalHome.tsx` (DocsPendientesBanner): usa `enviado_para_revision_at` (ya venía en el resumen,
  tramitePedidosDoc.ts:296) para distinguir 3 estados — antes decía "Ya enviaste — el equipo está revisando"
  apenas `pendientes+rechazados===0`, aunque el cliente NO hubiera apretado "Enviar" → trámite estancado.
  Ahora: "Tenés N para completar" / "Ya subiste todo — falta enviar" / "Ya enviaste — en revisión"
  (+ kicker "En revisión" y sin wiggle cuando no hay acción del cliente).

e2e (BEGIN/DO + RAISE rollback, sobre el pedido real sin persistir): A) enviar con rechazado → BLOQUEA; B)
rechazar un aprobado → BLOQUEA ("estado actual: aprobado"); C) rechazar un subido → funciona. Build limpio, R16=0.
Contradicción de agentes resuelta e2e: el estado de pedido `cancelado` NO está muerto (trigger
`trg_tramite_cerrar_pedidos`→`cerrar_pedidos_doc_al_cerrar_tramite`, mig 0315, lo setea al cerrar el trámite).
Notas/GAPs registrados aparte (no en scope 137, latentes/diseño): rol `operador` gateado a `gerente` en RLS
(0 operadores hoy); banner "avisá a gestoría" no dispara con respuestas sólo-texto (archivo_path NULL);
alarma gerencia no cubre "cliente no responde" (sólo "esperando revisión"); pedido `cancelado` sin acción de
cancelar manual desde UI.

### E-GG-139 · (CRÍTICA · contable) el gate de cierre-con-comprobante era bypasseable por el kanban
**Descubierto en el mapeo doble §6 de GESTORÍA/KANBAN + e2e.** El trigger `tramite_cerrar_exige_cobrado`
rama (b) (E-GG-132) exigía comprobante sólo si `COALESCE(NEW.cierre_satisfactorio,false)=true`. Pero el
**cierre rápido del kanban** (`updateTramite` en useAvanzarTramite) y `tracking_moderar_gestor_avance`
(publicar + estado_asociado='cerrado') hacen un `UPDATE tramites SET estado='cerrado'` **pelado** que
NUNCA setea `cierre_satisfactorio` → queda NULL → `COALESCE=false` → la rama NO dispara → un servicio
**ARANCELADO se cerraba SIN comprobante** (ingreso sin registrar). e2e (rollback, servicio matrícula
$>0, sin comprobante): bare-close NULL **PASA (BUG)**, abandono false PASA (ok), satisfactorio true
BLOQUEA (ok). Fix (mig 0355): rama (b) `NEW.cierre_satisfactorio IS DISTINCT FROM false` → sólo un
abandono/rechazo **explícito** (=false, vía `tracking_cerrar`) cierra un arancelado sin comprobante;
NULL (cierre pelado ambiguo) y true exigen comprobante; un arancelado CON comprobante cierra igual.
e2e post-fix: bare-close NULL BLOQUEA, abandono PASA, satisfactorio BLOQUEA. Cierra el hueco tanto del
kanban como de la moderación de aportes de gestoría (ambos pegan al mismo trigger).

### E-GG-138 · (CRÍTICA · seguridad/consistencia) el reaviso a la gestoría revivía un token sobre trámite terminal
`derivacion_reavisar_gestoria` no validaba `tramites.estado` y, además de encolar el mail, **REGENERA
un token de acceso externo vivo (14 días)** si el anterior venció/estaba revocado → una llamada sobre un
trámite CERRADO o CANCELADO revivía la capacidad de subida del gestor externo. Y la UI
(`TrackingDetailPage`) escondía el botón/banner "Avisar a la gestoría" sólo con `estado !== 'cerrado'`,
sin excluir 'cancelado' (los terminales son cerrado **y** cancelado). Fix (mig 0355 + front): la RPC
bloquea si `estado IN ('cerrado','cancelado')`; los 2 gates de UI del reaviso excluyen 'cancelado'.
También `computeSla().vencido` (front) excluye 'cancelado' (antes un cancelado con vence_at pasado
contaba como vencido, inconsistente con `gerencia_alarmas_hoy`).

### E-GG-140 · (menor · alarma pegada) docs del cliente de trámites cerrados seguían en el Inicio de gerencia
`docs_cliente_pendientes` (widget "Documentación del cliente · en vivo") no filtraba el estado del
trámite: como el cierre del trámite NO cierra los pedidos (E-GG-46, por diseño), un pedido 'abierto' con
ítems 'subido' sobre un trámite ya cerrado/cancelado seguía apareciendo en el Inicio del gerente = alarma
que no se limpia. Espejo del fix E-GG-46 que sólo se había aplicado del lado portal. Fix (mig 0355):
`AND t.estado NOT IN ('cerrado','cancelado')`.

**GAPs/dudas de diseño registrados (no fixeados en scope 138-140, para decidir con Pablo):** el kanban no
valida transiciones (drag arbitrario abierto→cerrado o regresiones) y la reapertura por drag-out saltea
`tracking_reabrir` (borra metadata de cierre y no audita `reabierto_count`); "devolución de gestoría SIN
info" no está modelada (el gestor sólo puede cargar un avance con descripción); KPI 'derivadas' cuenta un
estado 'pegajoso' (nunca se limpia); `gerencia_proximos_seguimientos` no excluye 'resuelto' (inconsistente
con `gerencia_alarmas_hoy`); `requiere_docs_cliente` es un flag que el trigger mantiene pero ningún UI lee
(R14); rama 'solicitud' de la edge fn acceso-externo devuelve recurso null (enmascarado por diseño N4);
crons jobid 7/16/17 dependen de GUCs (app.service_role_key/app.supabase_url/app.cron_secret) no seteados
a nivel rol → verificar si Supabase los inyecta por otra vía antes de accionar (health-alert no es JL-facing).

### E-GG-139 · refinamiento (decisión Pablo, 2026-07-15): "advertir, no limitar"
El gate de BD (mig 0355) sigue siendo el backstop, pero el kanban NO debe LIMITAR al gerente
(puede equivocarse, o un documento puede no alcanzar → necesita mover libre adelante/atrás). Regla
de Pablo: "continuamos advirtiendo cuando un trámite está pendiente de pago y quiere resolverlo/
finalizarlo — no para limitarlo, sino para que no se le escape la tortuga de quedar algo sin cobrar".
Fix (front, `useAvanzarTramite.mover`): al cerrar por kanban/lista, si el gate frena el cierre de un
arancelado sin comprobante, en vez de un error duro mostramos una **advertencia con confirmación**
("queda un ingreso sin registrar · ¿cerrar sin cobrar?"); si el gerente confirma, cerramos con
`cierre_satisfactorio=false` (el trigger lo permite). Así: se advierte (anti-tortuga) sin trabar la
operación. El cierre formal satisfactorio (tracking_cerrar) mantiene el bloqueo+guía a abandono.

### E-GG-141 · (chunk CONST · doble auditoría §6) grants residuales a anon + fidelidad preview↔PDF de la constancia
Al cerrar el feature nuevo **Constancias de inscripción** (botón por alumno en Campus → PDF A4 vertical
gemelo del diploma, a demanda) la doble auditoría §6 (3 agentes + e2e BD) encontró huecos que el build+smoke
no ven. Fixeados todos en el mismo chunk:

- **(seguridad · GAP) `REVOKE ALL … FROM anon` NO quita el grant default EXECUTE→PUBLIC de Postgres.** Las RPCs
  `emitir_constancia`/`constancia_registrar_pdf` quedaban con `has_function_privilege('anon',…,'EXECUTE')=true`
  (PUBLIC lo hereda), a diferencia de las gemelas del diploma. Además los *default privileges* del proyecto
  le habían dado a anon DML completo sobre la tabla `constancias` y USAGE sobre `constancias_codigo_seq`. **No
  explotable** (el guard `private.is_staff()` corta con 42501 y RLS es default-deny para anon — verificado e2e),
  pero rompía la paridad de defensa en profundidad con el diploma (R6: "anon sólo si el flujo público lo
  necesita"). Fix (mig **0358**): `REVOKE ALL ON FUNCTION … FROM PUBLIC` + `REVOKE ALL ON TABLE/SEQUENCE … FROM
  anon`, re-`GRANT EXECUTE … TO authenticated, service_role`. Verificado: anon=denegado, authenticated=ok.
  **Lección**: al crear RPCs privadas, `REVOKE FROM PUBLIC` (no sólo `FROM anon`) + chequear
  `has_function_privilege`/`role_table_grants` en el smoke de cierre.
- **(fidelidad · GAP) el preview ocultaba logo/firmas que el PDF sí embebía.** `ConstanciaPremium` hacía
  `{...ESQUEMA_CONST_DEFAULT, ...esquema}`: un asset `NULL` del esquema le "ganaba" al default por el spread,
  mientras el PDF los resolvía con `?? '/cert/…'`. Resultado: lo que se veía ≠ lo que se emitía. Fix: coalesce
  por-asset (`e.marca_logo_url ?? DEFAULT.marca_logo_url`, ídem firmas 1/2) igual que el diploma.
- **(robustez · GAP) emisión fantasma + upload silencioso.** El modal emitía la fila en BD ANTES de renderizar;
  si el `toPng` fallaba, quedaba una constancia huérfana sin PDF y un reintento emitía OTRA con código nuevo;
  y un upload fallido no avisaba nada. Fix: se separa la **emisión** (fila, capturada una sola vez en `emision`)
  del **blob** (render idempotente sobre la misma emisión); el fallo de upload emite un `toast.warning`
  explícito; retocar texto/destinatario/plantilla invalida ambos (`invalidarEmision`).
- **(UX · DUDA) mobile 360px:** el cluster de acciones de la card de alumno no tenía `flex-wrap` → posible
  overflow horizontal. Fix: `flex-wrap justify-end`.
- **(hardening · DUDA) `setEsquemaDefault(id, tipo)` no validaba coherencia id↔tipo** (función compartida con el
  diploma). Un caller futuro con `tipo` equivocado destronaría el default del grupo errado y luego fallaría el
  índice único parcial. Fix: el `tipoReal` se **deriva del row**, no del caller — imposibilita el mismatch sin
  cambiar el comportamiento de los callers actuales (verificado e2e: default del diploma intacto al setear una
  constancia). NO se tocó ni una línea de la emisión de certificados (mandato Pablo).

**Aceptado por diseño (no fix):** una plantilla de constancia con emisiones puede borrarse — `constancias`
persiste `esquema_snapshot` + `pdf_storage_path` y el historial re-descarga por signed URL, nunca re-renderiza
desde la plantilla (a diferencia del diploma, que sí referencia por FK).

### E-GG-142 · (wave 8 · doble auditoría §6) CREATE OR REPLACE VIEW borra security_invoker + contador fantasma de pendientes
Al cerrar la wave 8 (notas de JL: advertencia pre-wizard, origen del saldo a favor, movimientos bancarios
no identificados — migs 0359-0361), la doble auditoría §6 (3 agentes adversariales + e2e BD) cazó **2
CRÍTICAS** que build+e2e propio no vieron. Fixeadas en mig **0362** + frontend, todo re-verificado e2e:

- **(CRÍTICA · seguridad · regresión de 0005a) `CREATE OR REPLACE VIEW` REEMPLAZA TODAS las reloptions.**
  La mig 0360 re-creó `cajas_con_saldo` (para alinear el saldo a `estado <> 'anulado'`) sin re-emitir
  `WITH (security_invoker = true)` → la vista volvió a modo DEFINER (owner postgres, bypassa RLS) y
  **cualquier authenticated NO-staff (cliente/partner/alumno) leía nombre+saldo de todas las cajas de la
  gerencia** (probado e2e por el auditor; anon seguía revocado por 0308). Fix: re-CREATE con la reloption
  explícita; verificado post-fix que un cliente real ve 0 filas. **Lección/regla de bolsillo:** todo
  `CREATE OR REPLACE VIEW` debe re-emitir `WITH (security_invoker = true)`; smoke de cierre cuando un
  chunk toca vistas:
  ```sql
  -- (versión normalizada 2026-07-17, auditoría post-purga DGG-111: Postgres
  -- acepta 'on'/'true'/'1' como truthy — el match textual contra
  -- 'security_invoker=true' daba falsa alarma con vistas '=on')
  SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind='v'
    AND NOT EXISTS (
      SELECT 1 FROM pg_options_to_table(c.reloptions) o
      WHERE o.option_name='security_invoker' AND o.option_value IN ('true','on','1')
    );
  ```
  Toda vista que devuelva debe tener su modo DEFINER justificado por comentario.
- **(CRÍTICA · contable) contador fantasma al revertir un pendiente.** `fz_revertir_movimiento` aceptaba
  un `pendiente_id` y lo dejaba `pendiente_id + revertido_at` — ni `cajas_con_saldo.movs_pendientes` ni
  `fz_dashboard_kpis` filtraban `revertido_at`, y el fantasma no tenía salida (identificar/anular rechazan
  revertidos; el botón Identificar exige no-revertido): banner amarillo encendido para siempre por un solo
  click de gerente. Fix triple: contadores filtran `revertido_at IS NULL`; la RPC bloquea revertir un
  pendiente ("usá Anular — no tiene imputaciones"); el botón Revertir se oculta en pendientes.
- **Menores (mismo chunk):** guard `revertido_at` en `fz_desidentificar_movimiento` (evitaba par de
  reversión asimétrico vía RPC directa); la guarda `sin_identificar` bloquea también `p_consorcio_id`;
  `fz_conciliar_manual`/`fz_sugerir_matches` aceptan `pendiente_id` (la línea del extracto bancario ES el
  mismo dinero — antes el caso núcleo de JL no podía conciliarse y se duplicaba); `listComprobantesConSaldo`
  excluye rechazado/error (patrón E-GG-136); modal Identificar normaliza coma decimal y **rechaza**
  NaN/0/negativo (antes caían en silencio a "aplicar el máximo") + resetea el monto al cambiar
  cliente/comprobante; el toggle "sin identificar" se resetea al cambiar a egreso; exports PDF/XLS con
  estado humanizado; espejo del atajo con `.is('comprobante_id', null)` (no pisa el vínculo del wizard en
  carrera).

**Anotados sin fix (decisión/consciencia):** el KPI global de pendientes cuenta cajas inactivas (la fila
aparece en la lista global → hay salida; se decide si restringir cuando haya cajas inactivas reales);
`listar_creditos` resta TODAS las imputaciones vs extracto/resumen que restan sólo las aplicadas a
comprobante — hoy cuadran (0 imputaciones a-cuenta en prod), divergiría si un flujo insertara imputaciones
sin comprobante: pendiente de unificación si aparece ese flujo; un movimiento identificado con partner
pero sin aplicar no figura en la sábana hasta aplicarse (semántica pre-existente de la sábana).
