# Campus Fase 3 · Zoom + Webinars (DGG-14/15) — Diseño

> Fecha 2026-05-22. Documento de diseño para aprobar **antes** de implementar.
> No hay código de producto acá: sólo arquitectura, esquema SQL conceptual y
> snippets ilustrativos. Cita IDs: DGG-14 (Zoom en campus), DGG-15 (webinars
> públicos para prospectos), DGG-10/10bis (Campus), DGG-11 (subsistema de
> captación). Reglas CLAUDE.md citadas inline.

---

## 0. Resumen ejecutivo

Las clases sincrónicas y los webinars se dictan **dentro del campus** con el
meeting de Zoom **embebido** (no se abre la app de Zoom afuera). Se usan tres
productos Zoom, todos en el plan **que el usuario ya tiene** (no se gasta más si
ya hay un plan Pro o superior; ver §8):

| Producto Zoom | Para qué | ¿Pago extra? |
|---|---|---|
| **Meeting SDK (Web)** — Component View | embeber el meeting en el campus, join autenticado | **Gratis** (sólo requiere crear la app SDK) |
| **API + Server-to-Server OAuth** | crear meetings, registrants, traer reporte de asistencia y grabaciones | **Gratis** (incluido con cualquier cuenta) |
| **Webhooks** | asistencia automática (`participant_joined/left`) + grabación lista (`recording.completed`) | **Gratis** |
| **Cloud Recording** | grabación automática servida luego en el campus | **Requiere plan Pro+** (Basic sólo graba local). Alternativa: local + subida manual |
| **Zoom Webinars** (add-on) | NO se usa en MVP | **Pago (~USD 79+/mes)** → usamos **Meetings** para los "webinars" públicos |

**Decisión de arquitectura central:** Gestión Global **es el host** de todos
sus meetings (cuenta propia, S2S OAuth). Esto evita por completo el nuevo
requisito **OBF token (vigente 2-mar-2026)**, que **sólo aplica a apps que se
unen a meetings de cuentas externas** ([changelog Zoom](https://developers.zoom.us/changelog/platform/meeting-sdk-policy-announcement/),
[FAQ OBF](https://developers.zoom.us/docs/meeting-sdk/obf-faq/)). Como el host
siempre es nuestra cuenta, alcanza con la firma SDK clásica.

**Productos "webinar" (DGG-15):** Zoom Webinars es un add-on pago con prerequisito
de plan Pro. Para los webinars públicos a prospectos usamos **Meetings normales**
(hasta 100/300 asistentes según plan) con registrants. Se reserva Zoom Webinars
real para una fase futura si se necesitan >300 asistentes o el modo broadcast.

**Esfuerzo total:** **L** (3 edge functions nuevas, 1 migración, 2 vistas de
campus, panel de gerencia, integración asistencia/grabación). MVP entregable en
2 sub-fases (§10).

---

## 1. Capacidades de Zoom verificadas (con fuentes)

### 1.1 Meeting SDK para Web (embed)
- Ofrece **Client View** (página completa estilo Zoom) y **Component View**
  (componentes embebibles y estilizables dentro de tu UI). Para "dentro del
  campus, premium" usamos **Component View**.
  ([Meeting SDK web](https://developers.zoom.us/docs/meeting-sdk/web/),
  [Component View ref](https://developers.zoom.us/docs/meeting-sdk/web/component-view/reference/))
- Requiere **SDK Key/Secret** (o Client ID/Secret) de una **app Meeting SDK**
  en el Marketplace. Cada join necesita una **SDK JWT signature** firmada
  server-side. ([auth-endpoint-sample](https://github.com/zoom/meetingsdk-auth-endpoint-sample))
- `client.join()` acepta `userName` y `userEmail` → permite **join autenticado**
  pasando el email del alumno logueado.
  ([Component View meetings](https://developers.zoom.us/docs/meeting-sdk/web/component-view/meetings/))
- **Limitación nueva (2-mar-2026):** apps que se unen a meetings de cuentas
  **externas** deben usar token OBF/ZAK/RTMS y SDK ≥ 5.17.5. **No nos afecta**
  porque hosteamos en cuenta propia. ([changelog](https://developers.zoom.us/changelog/platform/meeting-sdk-policy-announcement/),
  [FAQ OBF](https://developers.zoom.us/docs/meeting-sdk/obf-faq/))
- npm: `@zoom/meetingsdk` ([meetingsdk-web](https://github.com/zoom/meetingsdk-web)).

### 1.2 API + Server-to-Server OAuth (S2S)
- App **Server-to-Server OAuth** ("internal app") en el Marketplace. Credenciales:
  **Account ID + Client ID + Client Secret**. Token: `POST https://zoom.us/oauth/token`
  con `grant_type=account_credentials`, expira en 1 h, sin refresh token.
  ([S2S OAuth docs](https://developers.zoom.us/docs/internal-apps/s2s-oauth/),
  [starter](https://github.com/zoom/server-to-server-oauth-starter-api))
- Endpoints que usamos ([API meetings](https://developers.zoom.us/docs/api/meetings/)):
  - `POST /users/{userId}/meetings` — crear meeting (devuelve `id`, `join_url`,
    `start_url`, `password`).
  - `POST /meetings/{meetingId}/registrants` — registrar a un participante por
    email → devuelve **join_url único con token de registro** (clave para el
    prospecto sin contraseña).
  - `GET /report/meetings/{meetingId}/participants` — **reporte de asistencia**
    (entradas/salidas, duración, email, `customer_key`).
  - `GET /meetings/{meetingId}/recordings` — listado de grabaciones cloud.
- Scopes (modelo granular 2026):
  `meeting:write:admin`, `meeting:read:admin`, `report:read:admin`,
  `cloud_recording:read:recording:admin`, `user:read:admin`.
  ([scopes forum](https://devforum.zoom.us/t/server-to-server-oauth-app-permissions-and-scopes/92331))

### 1.3 Webhooks
- Eventos: `meeting.participant_joined`, `meeting.participant_left`,
  `recording.completed`. ([webhooks docs](https://developers.zoom.us/docs/api/webhooks/),
  [webhook-sample](https://github.com/zoom/webhook-sample))
- Scopes de evento: `meeting:read:participant:admin` (joined/left),
  `cloud_recording:read:recording:admin` (recording.completed).
- **Verificación de firma (obligatoria):** construir `v0:{x-zm-request-timestamp}:{body}`,
  HMAC-SHA256 con el **Secret Token** del webhook, comparar `v0={hash}` contra
  el header `x-zm-signature`. Responder 200/204 en <3 s. Hay un challenge-response
  de validación de URL (`endpoint.url_validation`) al registrar el endpoint.
  ([webhooks docs](https://developers.zoom.us/docs/api/webhooks/))

### 1.4 Grabación (recording)
- **Cloud recording requiere plan Pro+**; el plan **Basic (gratis) sólo graba
  local** y no expone la grabación por API.
  ([Zoom pricing](https://zoom.us/pricing))
- Con cloud recording, `recording.completed` entrega URLs de descarga/streaming;
  servimos la grabación luego como clase asincrónica del campus.

### 1.5 Webinars vs Meetings
- **Zoom Webinars es add-on pago** (desde ~USD 79/mes, 300 asistentes) y
  **requiere plan Pro previo**. ([Webinars pricing](https://zoom.us/pricing/events))
- **Para DGG-15 usamos Meetings** con registrants (gratis, hasta el cupo del
  plan). Misma API, mismo embed. Zoom Webinars real queda para futuro.

---

## 2. Arquitectura propuesta

```
┌──────────────────────── FRONT (React, campus) ────────────────────────┐
│  Alumno logueado            Prospecto (sin login)                      │
│  /campus/encuentro/:id      /webinar/:token   (página pública premium) │
│        │                          │                                    │
│   <ZoomMtgEmbedded               <ZoomMtgEmbedded                      │
│    Component View>                Component View>                      │
│        │ join({signature,         │ join({signature, userEmail,        │
│        │   userEmail, mtg#})       │   tk=registrant_token})           │
└────────┼──────────────────────────┼───────────────────────────────────┘
         │ (1) pide signature        │ (1) verifica token + signature
         ▼                           ▼
┌──────────────────────── EDGE FUNCTIONS (Deno) ────────────────────────┐
│  zoom-sdk-signature   (verify_jwt=true · alumno autenticado)           │
│      └─ firma SDK JWT con ZOOM_SDK_SECRET                              │
│  zoom-meeting-admin   (verify_jwt=true · solo staff)                   │
│      └─ S2S OAuth token → crea meeting / registrant / trae reporte    │
│  zoom-webhook         (verify_jwt=FALSE · público, valida HMAC)        │
│      └─ participant_joined/left → marca asistencia                    │
│      └─ recording.completed → guarda recording_url                    │
│  webinar-acceso       (verify_jwt=FALSE · molde acceso-externo)        │
│      └─ valida token prospecto → devuelve datos + signature SDK       │
└────────┬───────────────────────────────────────────────────────────────┘
         │ service_role (bypassa RLS, justificado regla 2)
         ▼
┌──────────────────────── SUPABASE (Postgres) ──────────────────────────┐
│  curso_encuentros (EXTENDIDA: zoom_meeting_id, join_url, recording...) │
│  curso_encuentro_asistencias (asistencia, ahora también automática)    │
│  webinars + webinar_inscriptos (tokens prospecto, molde acceso-externo)│
│  zoom_meeting_roles (docente/moderadora por link de host/co-host)      │
└────────────────────────────────────────────────────────────────────────┘
```

**Dónde viven los secretos (regla 3 — NUNCA en el front):** todos en Supabase
secrets, leídos sólo por edge functions:
- `ZOOM_ACCOUNT_ID`, `ZOOM_S2S_CLIENT_ID`, `ZOOM_S2S_CLIENT_SECRET` (API).
- `ZOOM_SDK_KEY`, `ZOOM_SDK_SECRET` (firma del embed).
- `ZOOM_WEBHOOK_SECRET_TOKEN` (verificación HMAC del webhook).

El front sólo recibe la **signature ya firmada** y el `meetingNumber`/`join_url`
(y para prospectos, sólo tras validar su token). La SDK Key viaja al front
dentro del payload de `join()` pero **el Secret nunca** — es el patrón estándar
del Meeting SDK.

---

## 3. Modelo de datos (deltas sobre Fase 1)

Fase 1 ya creó `curso_encuentros` y `curso_encuentro_asistencias` (mig. 0045).
Fase 3 las **extiende** y agrega webinars + tokens de prospecto. Todo en una
migración nueva `00XX_campus_fase3_zoom.sql` (regla 6).

### 3.1 Extender `curso_encuentros`
```sql
ALTER TABLE public.curso_encuentros
  ADD COLUMN zoom_meeting_id   bigint,            -- id numérico del meeting Zoom
  ADD COLUMN zoom_join_url     text,              -- join_url (alumno)
  ADD COLUMN zoom_start_url    text,              -- start_url del host (sensible)
  ADD COLUMN zoom_password     text,              -- passcode del meeting
  ADD COLUMN docente_profile_id uuid REFERENCES public.profiles(id),
  ADD COLUMN moderadora_email  text,              -- co-host por link (sin rol)
  ADD COLUMN docente_email     text,              -- host/alt-host por link
  ADD COLUMN recording_url     text,              -- grabación cloud (post-clase)
  ADD COLUMN recording_play_url text,             -- play_url para embeber
  ADD COLUMN estado            text NOT NULL DEFAULT 'programado'
             CHECK (estado IN ('programado','en_curso','finalizado','grabacion_lista'));
-- el link_zoom existente queda como legacy / fallback manual.
CREATE INDEX idx_curso_encuentros_zoom_meeting
  ON public.curso_encuentros(zoom_meeting_id) WHERE zoom_meeting_id IS NOT NULL;
```
> `zoom_start_url` y `zoom_password` son **sensibles** → no exponerlos en el
> SELECT de alumno (RLS / vista). Sólo staff y el flujo de host los ven.

### 3.2 Asistencia automática (correlación login ↔ participante)
No hace falta tabla nueva: reusamos `curso_encuentro_asistencias` (Fase 1) y
agregamos columnas de auditoría automática:
```sql
ALTER TABLE public.curso_encuentro_asistencias
  ADD COLUMN origen        text NOT NULL DEFAULT 'manual'
             CHECK (origen IN ('manual','auto_zoom')),
  ADD COLUMN zoom_join_at  timestamptz,
  ADD COLUMN zoom_leave_at timestamptz,
  ADD COLUMN minutos       int;   -- duración acumulada para umbral de "presente"
```
**Correlación:** al embeber, el front pasa `userEmail = email del alumno` y
`customer_key = matricula_id` en `join()`. El webhook `participant_joined`
trae ese `customer_key`/email → el edge resuelve la `matricula_id` y hace
`INSERT ... ON CONFLICT (encuentro_id, matricula_id) DO UPDATE` marcando
`presente=true, origen='auto_zoom'`. Umbral de presencia configurable
(p.ej. ≥ X minutos) calculado al `participant_left`/fin.

### 3.3 Webinars + inscriptos (prospectos) — molde `acceso-externo`
```sql
CREATE TABLE public.webinars (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo          text NOT NULL,
  descripcion_html text,
  fecha_hora      timestamptz NOT NULL,
  zoom_meeting_id bigint,
  zoom_join_url   text,
  banner_url      text,
  publico         boolean NOT NULL DEFAULT true,  -- visible a prospectos
  recording_url   text,
  estado          text NOT NULL DEFAULT 'programado'
                  CHECK (estado IN ('programado','en_curso','finalizado','grabacion_lista')),
  formulario_id   uuid REFERENCES public.formularios(id),  -- el form 'evento' (DGG-11)
  created_by      uuid REFERENCES auth.users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- inscriptos: el prospecto del form 'evento'. token = magic-link sin contraseña.
CREATE TABLE public.webinar_inscriptos (
  token           text PRIMARY KEY,                -- hex 64 (gen_random_bytes)
  webinar_id      uuid NOT NULL REFERENCES public.webinars(id) ON DELETE CASCADE,
  email           text NOT NULL,
  nombre          text,
  es_cliente      boolean NOT NULL DEFAULT false,  -- segmentación DGG-11
  prospecto_id    uuid,                            -- vínculo futuro a entidad prospecto
  zoom_registrant_id text,                         -- id del registrant en Zoom
  zoom_join_url   text,                            -- join_url único del registrant
  vence_at        timestamptz NOT NULL,            -- acceso temporal (DGG-15)
  usado_at        timestamptz,
  ultima_visita_at timestamptz,
  total_visitas   int NOT NULL DEFAULT 0,
  revocado_at     timestamptz,
  asistio         boolean NOT NULL DEFAULT false,  -- marcado por webhook
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_webinar_email UNIQUE (webinar_id, email)
);
CREATE INDEX idx_webinar_inscriptos_webinar ON public.webinar_inscriptos(webinar_id);
```

### 3.4 RLS (regla 2)
```sql
ALTER TABLE public.webinars            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webinar_inscriptos  ENABLE ROW LEVEL SECURITY;

-- webinars públicos: cualquiera autenticado lee los publicados; CUD solo staff.
CREATE POLICY webinars_select ON public.webinars
  FOR SELECT TO authenticated USING (publico OR private.is_staff());
CREATE POLICY webinars_cud ON public.webinars
  FOR ALL TO authenticated USING (private.is_staff()) WITH CHECK (private.is_staff());

-- inscriptos: SOLO staff por RLS. El prospecto NO usa RLS: entra por el edge
-- public `webinar-acceso` con service_role (el token es la capability),
-- igual que acceso-externo. (regla 2: USING(false) para anon, justificado.)
CREATE POLICY webinar_inscriptos_staff ON public.webinar_inscriptos
  FOR ALL TO authenticated USING (private.is_staff()) WITH CHECK (private.is_staff());
```
- Las columnas sensibles de `curso_encuentros` (`zoom_start_url`, `zoom_password`)
  se ocultan del alumno con una **vista** o restringiendo el SELECT en
  `src/services/api/` (el SELECT del alumno no las pide). El `start_url` sólo se
  entrega al docente vía el flujo de host (§4).

### 3.5 Índices (regla 11)
Toda FK nueva con índice: `webinar_inscriptos.webinar_id`,
`curso_encuentros.docente_profile_id`, `curso_encuentros.zoom_meeting_id`
(parcial). El reporte de asistencia consulta por `zoom_meeting_id` → indexado.

---

## 4. Roles docente / moderadora

Hoy la plataforma tiene **solo** `gerente, operador, administrador`
(`0001_base.sql:71`). No hay docente ni moderadora.

### 4.1 Cómo conectarlos HOY (recomendado para MVP): **link de host / co-host por Zoom, sin crear roles nuevos**
- Al crear el meeting, gerencia ingresa el **email del docente** y el **email
  de la moderadora**.
- **Docente = alternative host**: se setea con `settings.alternative_hosts` en
  el `POST /meetings` (requiere que el email pertenezca a la cuenta Zoom; si es
  externo, se usa el `start_url` y se le manda por email/Workspace). El docente
  recibe un **link de un clic** (el `start_url` o un magic-link interno
  `/campus/dictar/:token`) que abre el meeting **como host** embebido.
- **Moderadora = co-host**: Zoom no permite designar co-host por API antes de
  iniciar; se promueve dentro del meeting, **o** se le da también
  `alternative_hosts` (puede haber varios). Para MVP: se le manda el mismo tipo
  de magic-link de host/alt-host.
- **Ventaja:** cero cambios al modelo de roles, conexión "de un clic" (DGG-14
  premium), y no requiere cuenta del campus para docente/moderadora.
- **Costo:** `alternative_hosts` con email **dentro de la cuenta** es ideal;
  si el docente es externo, funciona el `start_url` pero conviene confirmar el
  plan (algunas features de alt-host requieren licencia). → **decisión abierta §11**.

### 4.2 Plan a futuro: **rol `docente` real**
- Agregar `'docente'` al CHECK de `profiles.role` (migración) + helper
  `private.is_docente()`.
- Permisos: editar material/ejercicios **de los cursos que dicta** (tabla
  puente `curso_docentes(curso_id, profile_id)`), ver asistencia, iniciar el
  encuentro como host desde el propio campus (sin magic-link).
- Moderadora: rol `moderadora` o reuso de `operador` acotado por curso.
- Se difiere a una fase posterior (DGG-14 lo plantea como "a futuro").

---

## 5. Flujos

### 5.1 Gerencia — crear clase sincrónica
1. En el editor del curso → tab "Encuentros" → "Nuevo encuentro Zoom".
2. Completa título, fecha/hora, email del docente, email de la moderadora.
3. Al guardar, el front llama RPC/edge `zoom-meeting-admin` (solo staff) →
   `POST /users/me/meetings` con `settings.auto_recording='cloud'`,
   `alternative_hosts=docente,moderadora`, `approval_type` registrants si aplica.
4. Se guardan `zoom_meeting_id, zoom_join_url, zoom_start_url, zoom_password` en
   `curso_encuentros`. (regla 5: si toca 2+ tablas → RPC `plpgsql SECURITY DEFINER`).
5. Opcional: se manda por Workspace al docente/moderadora su magic-link de host.

### 5.2 Alumno — clase embebida + asistencia automática + grabación
1. Entra al campus autenticado → `/campus/encuentro/:id` (RLS: matriculado).
2. El front pide `zoom-sdk-signature` (verify_jwt=true) → recibe la **signature**.
3. `ZoomMtgEmbedded.join({ signature, sdkKey, meetingNumber, userName,
   userEmail: <email alumno>, customerKey: <matricula_id>, passWord })`.
   El meeting aparece **embebido** dentro del layout premium del campus.
4. Zoom dispara `meeting.participant_joined` → `zoom-webhook` resuelve por
   `customer_key`/email → marca `curso_encuentro_asistencias` (`origen='auto_zoom'`).
   `participant_left` cierra la duración; si ≥ umbral → `presente=true`.
5. Al terminar, `recording.completed` → guarda `recording_url`/`recording_play_url`
   y pone `estado='grabacion_lista'`. La grabación queda visible en el mismo
   encuentro como **clase asincrónica generada** (embed del `play_url`).

### 5.3 Webinar público — prospecto sin login (DGG-15)
1. Prospecto completa el **form `evento`** (DGG-11) en la landing.
2. `submit-formulario` (o un nuevo paso) llama `zoom-meeting-admin` →
   `POST /meetings/{id}/registrants` con su email → Zoom devuelve `join_url`
   único con token de registro (entra **sin contraseña**).
3. Se inserta en `webinar_inscriptos` con un **token interno** (hex 64,
   `gen_random_bytes`, molde `accesos_externos`), `vence_at`, `zoom_join_url`.
4. Se le manda por **Workspace** el **magic-link**: `/webinar/:token`.
5. El prospecto abre `/webinar/:token` (página **pública premium** del campus,
   sin login). El front llama el edge público `webinar-acceso` (verify_jwt=false)
   → valida token (no vencido/no revocado) → devuelve datos del webinar +
   **signature SDK** + `zoom_join_url`.
6. El webinar aparece **embebido sin contraseña**; el prospecto **no ve** el
   resto de cursos (no es alumno; no hay sesión Supabase).
7. `participant_joined` marca `webinar_inscriptos.asistio=true` (conversión
   DGG-11). Al finalizar, si `publico`, la grabación puede quedar disponible en
   `/webinar/:token` hasta `vence_at`.

---

## 6. Asistencia automática (detalle técnico)

Tres mecanismos posibles; **se combinan** webhooks (tiempo real) + report API
(reconciliación):

| Mecanismo | Pro | Contra | Uso |
|---|---|---|---|
| **Webhooks** `participant_joined/left` | tiempo real, sin polling | hay que tener endpoint público fiable y verificar HMAC | **Primario** (marca al instante) |
| **Report API** `/report/meetings/{id}/participants` | dato consolidado y oficial post-meeting | requiere `report:read:admin`; emails a veces faltan | **Reconciliación** (cron al cerrar el meeting) |
| **SDK join events** (en el front) | sin backend | manipulable, no confiable para asistencia formal | sólo UX (no marca BD) |

**Correlación login ↔ participante (clave del requisito "asistencia por login"):**
- El alumno **siempre** entra autenticado → el front conoce su `email` y
  `matricula_id`.
- En `join()` se pasa `userEmail` (su email) y `customerKey = matricula_id`.
  El `customer_key` aparece en el reporte de participantes y en el payload del
  webhook, lo que permite mapear sin ambigüedad aun si el email no llega.
  ([customer_key forum](https://devforum.zoom.us/t/how-to-use-customer-key-in-meeting-participants-report/51344),
  [emails missing forum](https://devforum.zoom.us/t/meeting-participants-report-not-returning-emails-for-participants/84376))
- Fallback: match por email normalizado contra la matrícula del curso.
- Como el join es **siempre desde el campus logueado**, no hay forma de "marcar
  asistencia sin haber entrado" → cumple "computada por login, no manual".

**Verificación del webhook (obligatoria, regla 3):** el edge `zoom-webhook`
(verify_jwt=false) recomputa `v0:{timestamp}:{body}` con HMAC-SHA256 y
`ZOOM_WEBHOOK_SECRET_TOKEN`, compara con `x-zm-signature`. Maneja también el
`endpoint.url_validation` (challenge) al dar de alta el endpoint.

---

## 7. Grabación automática

- **Recomendado:** `auto_recording: 'cloud'` al crear el meeting → la grabación
  arranca sola, sin acción del docente (DGG-14: "grabación automática").
- `recording.completed` → guardamos `recording_url` (descarga, requiere token) y
  `recording_play_url` (reproducción) → **embebemos el play_url** en el campus
  como clase asincrónica generada del encuentro sincrónico.
- **Restricción de costo:** cloud recording **requiere plan Pro+** (Basic sólo
  graba local, sin API). ([pricing](https://zoom.us/pricing))
- **Alternativa "sin gastar más" si la cuenta es Basic:** grabación **local**
  por parte del docente → se sube el archivo a un embed externo
  (YouTube no-listado / Vimeo, como ya hace el Campus para videos — DGG-10) →
  se pega la URL en el encuentro a mano. Más fricción, costo cero.
- **Egress:** NO usar Supabase Storage para videos (DGG-10: costo de egress).
  Servir siempre por `play_url` de Zoom o embed externo.

---

## 8. Costo y plan de Zoom (recomendación "sin gastar más")

| Capacidad | Plan necesario | Nota |
|---|---|---|
| Meeting SDK embed + join autenticado | **Cualquiera** (gratis) | crear app SDK |
| API S2S + webhooks + registrants + reporte asistencia | **Cualquiera** (gratis) | crear app S2S |
| Meetings de 40 min / 100 part. | Basic (gratis) | límite de 40 min en grupo |
| Meetings sin límite de tiempo / 300 part. | **Pro+** | clases largas |
| **Cloud recording** (grabación automática servible) | **Pro+** | en Basic, sólo local |
| Zoom Webinars (broadcast, >300, registrants avanzados) | **add-on pago** | NO en MVP |

**Recomendación:**
- Si la cuenta del usuario es **Pro o superior** (a confirmar §11): se cubre
  TODO el MVP (clases largas + cloud recording automática) **sin gastar 1 peso
  más**. Es el escenario ideal y lo que DGG-14 pide.
- Si es **Basic**: clases ≤40 min y grabación local + embed externo. Funciona
  pero con fricción → conviene subir a Pro sólo si hace falta (decisión del
  usuario). El SDK, la API y los webhooks **siguen siendo gratis**.
- **Webinars (DGG-15) = Meetings normales**, no el add-on. Cero costo extra.

---

## 9. Config del app Zoom — PASO A PASO (marketplace.zoom.us)

> El usuario está logueado en Zoom y quiere que la config la haga "el sistema".
> Se necesitan **DOS apps** en el Marketplace (no una): una **Server-to-Server
> OAuth** y una **Meeting SDK**. Más un **Webhook** (puede ir dentro de la app
> S2S como event subscription).

### 9.1 App A — Server-to-Server OAuth (API + webhooks)
1. `marketplace.zoom.us` → **Develop → Build App → Server-to-Server OAuth**.
2. Nombre: "Gestión Global Campus". Anotar **Account ID, Client ID, Client Secret**.
3. **Scopes** (Add Scopes):
   - `meeting:write:admin`, `meeting:read:admin`
   - `report:read:admin`
   - `cloud_recording:read:recording:admin`
   - `user:read:admin`
   - `meeting:read:participant:admin` (para webhook joined/left)
4. **Feature → Event Subscriptions** (webhooks): activar, poner el endpoint
   `https://<proyecto>.supabase.co/functions/v1/zoom-webhook`, suscribir:
   `meeting.participant_joined`, `meeting.participant_left`,
   `recording.completed`. Copiar el **Secret Token** del webhook.
5. **Activate** la app.

### 9.2 App B — Meeting SDK (embed)
1. `Develop → Build App → Meeting SDK`.
2. Anotar **SDK Key (Client ID)** y **SDK Secret (Client Secret)**.
3. No requiere scopes para join en cuenta propia. (OBF no aplica — host propio.)

### 9.3 Dónde van las credenciales (regla 3 — Supabase secrets, NUNCA front)
```bash
supabase secrets set \
  ZOOM_ACCOUNT_ID=...        ZOOM_S2S_CLIENT_ID=...   ZOOM_S2S_CLIENT_SECRET=... \
  ZOOM_SDK_KEY=...           ZOOM_SDK_SECRET=...      ZOOM_WEBHOOK_SECRET_TOKEN=...
```
Las edge functions las leen con `Deno.env.get(...)`. El front sólo recibe la
`signature` ya firmada + `meetingNumber`/`join_url`.

### 9.4 ¿Se puede hacer vía browser automation logueado?
- **Parcialmente.** Crear la app, agregar scopes y leer/copiar las credenciales
  se puede hacer **navegando marketplace.zoom.us con el usuario logueado**
  (Claude in Chrome). Es viable pero frágil (la UI del Marketplace cambia y los
  secretos requieren clicks de "show/copy").
- **Recomendación:** flujo **asistido** — el agente guía paso a paso y/o
  conduce el browser, pero el usuario confirma cada secreto (igual que el setup
  ARCA self-service del proyecto). Los secretos se cargan con
  `supabase secrets set` desde el repo (no quedan en el front). Definir en §11
  si el usuario prefiere automation completa o guía + pegado manual.

---

## 10. Plan de implementación por fases

### Fase 3-A · MVP clases sincrónicas (esfuerzo **M**)
- Migración: extender `curso_encuentros` + `curso_encuentro_asistencias` (§3.1/3.2).
- Edge `zoom-meeting-admin` (crear meeting, alt-hosts, auto_recording cloud).
- Edge `zoom-sdk-signature` (firma SDK, alumno autenticado).
- Edge `zoom-webhook` (HMAC + participant_joined/left → asistencia auto +
  recording.completed → recording_url).
- Front: embed Component View en `/campus/encuentro/:id`; panel gerencia "crear
  encuentro Zoom" con docente/moderadora por email (magic-link de host).
- `src/services/api/zoom.ts` (regla 4: nada de supabase.from en componentes).

### Fase 3-B · Webinars públicos para prospectos (esfuerzo **M**)
- Migración: `webinars` + `webinar_inscriptos` (§3.3) + RLS.
- Edge `webinar-acceso` (público, molde acceso-externo) + registrant en
  `zoom-meeting-admin`.
- Conectar form `evento` (DGG-11) → crea inscripto + registrant + magic-link.
- Front: `/webinar/:token` página pública premium con embed sin contraseña.
- Vínculo a prospecto/ctacte servicio $0 (DGG-11) → puede diferirse.

### Fase 3-C · Avanzado (esfuerzo **L**, futuro)
- Rol `docente` real + `curso_docentes` + edición de material/ejercicios (§4.2).
- Reconciliación de asistencia por report API (cron).
- Zoom Webinars real (add-on) si se necesitan >300 asistentes.

---

## 11. Decisiones abiertas para el usuario

1. **¿Qué plan de Zoom tiene la cuenta hoy (Basic / Pro / Business)?** Define si
   hay **cloud recording automática** y meetings >40 min sin gastar más. Es la
   decisión que más condiciona el MVP (§7/§8).
2. **¿Grabación cloud (Pro+) o local + embed externo (Basic, cero costo)?** Si la
   cuenta es Basic y no se quiere pagar, la grabación pasa a ser semi-manual.
3. **Docente/moderadora: ¿link de host/co-host ahora (sin roles) o crear rol
   `docente` ya?** Recomendación: link ahora (MVP), rol después (§4).
   Sub-pregunta: ¿los emails del docente/moderadora pertenecen a la cuenta Zoom
   (para `alternative_hosts`) o son externos?
4. **Webinars (DGG-15): ¿confirmás usar Meetings normales** (gratis, ≤300 según
   plan) y reservar el add-on Zoom Webinars para futuro?
5. **Config del Marketplace: ¿browser automation logueado completa, o flujo
   asistido** (agente guía + usuario confirma y pega los secretos)? (§9.4)
6. **Cupo esperado por webinar** (¿<100, <300, >300?) — define si Meetings
   alcanza o eventualmente hace falta el add-on.
7. **Vínculo prospecto → ctacte servicio $0 (DGG-11):** ¿se implementa en
   Fase 3-B o se difiere a cuando se construya el subsistema de captación?
```
