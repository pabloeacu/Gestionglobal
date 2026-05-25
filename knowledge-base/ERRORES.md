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

