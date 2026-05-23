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
