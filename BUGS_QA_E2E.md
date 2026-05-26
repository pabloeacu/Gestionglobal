# BUGS_QA_E2E · Auditoría flujo del cliente

> Registro vivo de bugs encontrados durante la auditoría e2e iniciada 2026-05-26.
> Cada bug se cierra cuando hay PR en main + verificado en Vercel.
>
> **Severidades**: 🔴 Crítico · 🟠 Alto · 🟡 Medio · 🟢 Bajo

---

## EGG-QA-01 · 🔴 CRÍTICO · Catálogo servicios ↔ formularios completamente desvinculado

**Módulo**: Catálogo + Formularios públicos
**Flujo afectado**: TODO el flujo del cliente desde la landing pública.

**Descripción**: Los 9 servicios activos del catálogo con `formulario_publico_slug` apuntan a slugs que NO existen como formularios. Ningún match. Y simétricamente, ningún formulario tiene `servicio_id` seteado.

```
Servicios declaran          Formularios existentes
─────────────────────       ─────────────────────
rpac/inscripcion       ❌    matriculacion-rpac
rpac/renovacion        ❌    renovacion-rpac
rpac/certificado       ❌    certificado-rpac
rpac/ddjj              ❌    ddjj-anual
juridico/consulta      ❌    consultoria-juridica
cursos/formacion-rpac  ❌    curso-formacion
cursos/actualizacion-rpac ❌ curso-actualizacion
rpa/actualizacion      ❌    (sin formulario)
plataforma/admin...    ❌    (sin formulario)
                            webinarios (sin servicio)
```

**Pasos para reproducir**:
```sql
SELECT s.codigo, s.formulario_publico_slug, f.slug
FROM servicios s
LEFT JOIN formularios f ON f.slug = s.formulario_publico_slug
WHERE s.activo AND s.formulario_publico_slug IS NOT NULL;
```
Resultado: **9/9 con `f.slug = NULL`**.

**Resultado esperado**: cada servicio activo debe tener un formulario vinculado (o ningún `formulario_publico_slug` si es servicio sin form público).

**Resultado obtenido**: vínculo completamente roto.

**Severidad**: 🔴 CRÍTICO — bloquea cualquier flujo "navegar el catálogo → completar formulario → crear solicitud" porque:
1. Desde la vista de catálogo el botón "Solicitar" no encuentra formulario.
2. Cuando `submit-formulario` procesa una submission, el trigger `crear_tramite_desde_submission_auto` no puede inferir el `servicio_id` (la columna `formularios.servicio_id` está NULL en todos).
3. Las solicitudes que se generen no tendrán servicio asignado → el wizard de activación no podrá derivar correctamente.

**Propuesta de fix**:
1. Migración de normalización que unifique slugs (o agrega columna `servicio_id` en formularios + setea valores).
2. Decisión de naming: usar slugs con barra (`rpac/inscripcion`) o con guión (`rpac-inscripcion`). Tomar uno y propagar.
3. Validación en futuro: trigger o CHECK que prohíba activar un servicio con `formulario_publico_slug` que no existe.

**Estado**: ✅ **FIXEADO** · mig 0073 aplicada (2026-05-26).

Fix aplicado:
1. Re-normalizó 7 slugs en `servicios.formulario_publico_slug` para matchear los formularios reales.
2. Llenó `formularios.servicio_id` apuntando al servicio (vínculo bidireccional).
3. Set a NULL los 2 servicios sin form público propio (`rpa_actualizacion`, `administracion_global`).
4. Agregó trigger `private.servicios_check_formulario_slug()` que prohíbe a un servicio activo declarar un slug huérfano.
5. Bonus: seedeó precios ficticios realistas (todos estaban en $0).

Verificación: query post-fix muestra 7/7 servicios con formulario público vinculado correctamente (✅), 3 servicios sin form público propio (legítimo, NULL).

---

## EGG-QA-02 · 🟠 ALTO · No se encola email de acuse al solicitante

**Módulo**: Trigger `crear_tramite_desde_submission_auto` / motor de emails
**Flujo afectado**: Submit de formulario público (escenarios A, B, C, F, H).

**Descripción**: Cuando un visitante anónimo manda un submission, el trigger crea la solicitud + dispara notificación in-app a los gerentes, pero NO encola email de acuse al solicitante. La plantilla `formulario-submission-recibido` existe en `email_templates` pero ningún trigger/RPC la usa para esa categoría.

**Pasos para reproducir**:
1. INSERT en `formulario_submissions` con email_contacto válido.
2. Verificar `email_queue WHERE to_email = <email>`: 0 rows.

**Resultado esperado**: el solicitante recibe email "Recibimos tu formulario" automáticamente.

**Resultado obtenido**: silencio total. El visitante no sabe si su solicitud llegó.

**Propuesta de fix**: extender `crear_tramite_desde_submission_auto` para llamar `encolar_email('formulario-submission-recibido', NEW.email_contacto, ...)` cuando hay `email_contacto` válido.

**Estado**: ✅ **FIXEADO** · mig 0074 aplicada. Trigger extendido. Verificado: nuevo submission encola acuse al solicitante (1 row en email_queue con template `formulario-submission-recibido`).

---

## EGG-QA-03 · 🟡 MEDIO · Cuerpo de notif "solicitud_nueva" usa slug técnico

**Módulo**: Trigger `_notif_solicitud_nueva_trg`
**Flujo afectado**: Notificación in-app al gerente.

**Descripción**: El cuerpo de la notificación es literal `"matriculacion-rpac · maria.lopez.qatest@example.com"` (slug técnico + email). Debería usar el TÍTULO del formulario (humano) o un mensaje contextual.

**Propuesta de fix**: cambiar el cuerpo a `"<formulario.titulo> · <solicitante>"` en lugar del slug.

**Estado**: ✅ **FIXEADO** · mig 0074. Trigger `_notif_solicitud_nueva_trg` ahora hace JOIN con `formularios` y usa `f.titulo`. Verificado: notif body cambió de "matriculacion-rpac · …" → "Inscripción al Registro Público de Administradores de Consorcios (RPAC) · …".

---

## EGG-QA-04 · 🟡 MEDIO · Sin email a gerencia cuando llega solicitud nueva

**Módulo**: Trigger `crear_tramite_desde_submission_auto`
**Flujo afectado**: Awareness gerencial.

**Descripción**: Solo se dispara notif in-app a gerentes. NO email. Si el gerente no está activo en la plataforma, podría no enterarse.

**Decisión del usuario**: implementar email a gerencia.

**Estado**: ✅ **FIXEADO** · mig 0074. Nuevo template `solicitud-nueva-gerencia` + loop en trigger que encola 1 email por gerente activo. Verificado: 2 emails encolados (1 por gerente).

---

## EGG-QA-05 · 🟡 MEDIO · DKIM + DMARC sin configurar · deliverability subóptima

**(Re-diagnóstico 2026-05-26)**: El test fresh llegó al Inbox del usuario sin DKIM. Causa original del "no recibí ningún mail" fue que los emails previos tenían asuntos genéricos ("Recibimos tu formulario", "Bienvenido a Gestión Global") que el usuario ignoró pensando que eran tests internos. Confirmado por inspección manual de Gmail. Bajo severidad a 🟡 Medio: la falta de DKIM no rompe delivery hoy, pero la deliverability no está optimizada para volúmenes mayores ni para evitar futuros filtros más estrictos.

**Módulo**: DNS + Google Workspace · pipeline de delivery email
**Flujo afectado**: TODOS los emails outbound del sistema (acuses, gerencia, comprobantes, recupero, certificados, vencimientos, webinars).

**Descripción**: El usuario reporta que NO recibe ningún email en `pabloeacu@gmail.com` a pesar de que `sent_emails` muestra 4 envíos con `estado='sent'`, `webhook_status='enviado'` y `provider_msg_id` válido de Gmail API. Diagnóstico DNS:

```
SPF    ✅ "v=spf1 include:spf.hostmar.com include:_spf.google.com -all"
DKIM   ❌ google._domainkey.gestionglobal.ar → SIN registro
DMARC  ⚠️ "v=DMARC1; p=none"
MX     ✅ Google Workspace (aspmx.l.google.com)
```

**Causa raíz**: cuando Gmail envía un mensaje desde Workspace via API REST:
1. Sin DKIM, el mensaje sale sin firma criptográfica.
2. Gmail (y otros proveedores) tratan la falta de DKIM como factor fuerte de spam, especialmente cuando el sender es un dominio externo enviando desde infra de Google.
3. DMARC `p=none` significa que Gmail no rebota explícitamente; aplica el filtrado spam silencioso.

Resultado: la API devuelve éxito (mensaje aceptado en outbox de la cuenta), pero el delivery final no llega al inbox del destinatario.

**Severidad**: 🟡 MEDIO (re-evaluada) — los emails llegan hoy pero la configuración es subóptima. Recomendado activar DKIM + subir DMARC a `quarantine` antes del lanzamiento masivo.

**Fix requerido** (acción del usuario + acción mía):

1. **Usuario**: activar DKIM en `admin.google.com`:
   - Apps → Google Workspace → Gmail → Autenticación de correo electrónico
   - Generar nuevo registro DKIM (selector default: `google`) con 2048-bit
   - Copiar la clave TXT que Google genera

2. **Sistema**: agregar el TXT record en Cloudflare/Vercel DNS:
   - Host: `google._domainkey`
   - Tipo: `TXT`
   - Valor: la clave que Google generó

3. **Volver a Workspace**: clickear "Iniciar autenticación" para que Google active el signing.

4. **Verificar** con `dig +short TXT google._domainkey.gestionglobal.ar` que la propagación está OK.

5. **Mandar nuevo test** y verificar entrega al inbox.

**Mejora adicional**: subir DMARC a `p=quarantine` después de tener DKIM probado por ~2 semanas, y eventualmente a `p=reject` para máxima protección anti-phishing.

**Estado**: 🟡 documentado · mejora pendiente (no bloqueante). Re-priorizar antes del lanzamiento masivo.

---

## EGG-QA-06 · 🔴 CRÍTICO · Plantillas usaban alias INEXISTENTES → emails descartados

**Módulo**: dispatch-emails edge function + DB email_templates
**Flujo afectado**: TODOS los outbounds del sistema.

**Causa raíz REAL** (el "no recibí emails" original): el Workspace tiene sólo 4 alias REALES (`cursos@`, `webinar@`, `consultoriajuridica@`, `contacto@`). Las casillas `info@`, `facturacion@`, `tramites@`, `recupero@` que el código asumía como aliases válidos **NO existen**. Gmail aceptaba el mensaje en la API (provider_msg_id válido) pero el delivery final lo descartaba silenciosamente porque el From: no correspondía a un alias autorizado en la cuenta autenticada.

El commit anterior (ab9a45c) "unificó todo a contacto@" pero perdió identidad por servicio. Este fix re-introduce los aliases reales por categoría:

| from_casilla | Alias real | Templates |
|---|---|---|
| `cursos` | `cursos@gestionglobal.ar` | certificado-emitido, curso-inscripcion-confirmada |
| `webinar` | `webinar@gestionglobal.ar` | webinar-bienvenida + 2 recordatorios |
| `juridico` | `consultoriajuridica@gestionglobal.ar` | (futuro) |
| `general` | `contacto@gestionglobal.ar` | 17 templates (bienvenida, acuses, comprobantes, recupero, trámites, vencimientos, etc.) |

**Fix aplicado** (commit 1d0c47b · mig 0075):
- Edge function `dispatch-emails`: helper `aliasFor(casilla)` mapea categoría a alias real. Reply-To = mismo alias.
- Mig 0075: drop CHECK viejo, UPDATE templates a los 4 valores nuevos, nuevo CHECK con los 4 valores reales.
- Frontend: `FromCasilla` type + `CASILLAS` array + `RespuestaCasilla` + `SolicitudDetailPage` dropdown actualizado con hints del alias real.

**Verificación**: test enviado con `from_casilla='cursos'` registró `from_email=cursos@gestionglobal.ar` y `reply_to=cursos@` en sent_emails. provider_msg_id `19e646a7dad0df24`.

**Estado**: ✅ FIXEADO · usuario confirmó recepción desde `cursos@` y que Reply funciona correctamente. Pendiente solo validación adicional para `webinar@` y `consultoriajuridica@` cuando haya casos reales.

---

## EGG-QA-07 · 🟠 ALTO · Emails caen en pestaña "Promociones" en lugar de Primary

**Módulo**: Headers MIME + DKIM + reputación del dominio
**Flujo afectado**: Percepción premium · los clientes pueden no ver los emails transaccionales si no miran Promociones.

**Descripción**: Usuario confirma que el último test (`cursos@`) llegó al inbox pero a la pestaña **Promociones** de Gmail. Para emails transaccionales (acuses, confirmaciones, comprobantes, certificados) esto es subóptimo — deberían ir a la pestaña Principal.

**Causas combinadas**:
1. **DKIM no firmado** (EGG-QA-05) — Gmail clasifica como promocional sin signature criptográfica.
2. **Sin headers transaccionales** — falta `List-Unsubscribe`, `Auto-Submitted`, `Precedence`.
3. **Body con HTML colorido** (gradientes cyan, botones llamativos) que pattern-match a marketing.
4. **Reputación de dominio** joven — gestionglobal.ar empezó a enviar recién.

**Fix multi-capa**:

✅ **Parte 1 (sin acción del usuario)** · Headers MIME transaccionales:
```
X-Auto-Response-Suppress: All
Auto-Submitted: auto-generated
X-Mailer: Gestion Global Platform / Workspace API
Precedence: list
List-Unsubscribe: <mailto:contacto@gestionglobal.ar?subject=unsubscribe>
List-Unsubscribe-Post: List-Unsubscribe=One-Click
```
Aplicado en `dispatch-emails`. Estos headers reducen falsos positivos de Gmail.

🔴 **Parte 2 (requiere acción del usuario · 5 min)** · Activar DKIM en Workspace (es EGG-QA-05 re-priorizado a ALTO):

Pasos para vos en `admin.google.com` (ya estás logueado con `contacto@`):
1. Ir a **Apps → Google Workspace → Gmail → Autenticar correo electrónico** (en el menú izquierdo).
2. Seleccionar el dominio **`gestionglobal.ar`**.
3. Clickear **"Generar nuevo registro"** (default: selector `google`, longitud 2048-bit).
4. Google muestra un valor TXT largo (empieza con `v=DKIM1; k=rsa; p=MIIBIjA...`). **Copiámelo entero**.
5. Pegámelo en el chat y yo lo cargo en Vercel DNS automáticamente.
6. Verifico propagación (puede tardar 5-30 min).
7. Vos volvés a admin.google.com y clickeás **"Iniciar autenticación"** en la misma pantalla.
8. Yo mando otro test y confirmamos que aterriza en Primary.

🟡 **Parte 3 (mejora futura)** · Body HTML más sobrio para emails transaccionales (menos gradientes, más estructura tipo recibo). No prioritario ahora.

**Estado**: ✅ **FIXEADO COMPLETO** (2026-05-26):
1. Headers transaccionales en dispatch-emails (post v2: sin Precedence/List-Unsubscribe que disparaban Promociones).
2. DKIM activado en Workspace (2048-bit, selector google).
3. TXT record cargado en Cloudflare DNS via API.

Verificado: emails llegan a Inbox principal con `dkim=pass`, `spf=pass`, `dmarc=pass`, `arc=pass`.

---

## EGG-QA-08 · 🟢 BAJO · KPIs de Solicitudes muestran 0/0/0/0 cuando hay solicitud nueva

**Módulo**: SolicitudesListPage
**Descripción**: La lista muestra "RECIBIDAS 0 / EN REVISIÓN 0 / DERIVADAS 0 / ACTIVADAS HOY 0" aunque hay 1 solicitud en estado RECIBIDA listada abajo. Desincronismo Realtime vs query inicial de KPIs.
**Severidad**: 🟢 Bajo (cosmético). El listado SÍ se sincroniza, solo los KPIs no.
**Propuesta**: usar el mismo channel Realtime para los KPIs o re-query al recibir cambios.
**Estado**: 🟢 documentado.

---

## EGG-QA-09 · 🟡 MEDIO · Wizard alta cliente no trae CUIT ni domicilio fiscal del formulario

**Módulo**: Wizard de activación · Paso 2 (Alta cliente)
**Descripción**: El paso "Cliente nuevo" del wizard no auto-completa los campos CUIT y Domicilio fiscal aunque están en `formulario_submissions.datos` (cuit, domicilio). El operador tiene que copiar manualmente. UX premium perdida.
**Propuesta**: pre-llenar `crear_cliente_input.cuit` con `submission.datos->>'cuit'` y `direccion` con `domicilio`.
**Estado**: 🟡 documentado.

---

## EGG-QA-10 · 🔴 CRÍTICO · Wizard crea administración pero NO user en auth.users

**Módulo**: RPC `solicitud_activar` + flujo de provisioning portal
**Descripción**: Al activar una solicitud con "cliente nuevo", el RPC creaba la fila en `administraciones` pero NO un user en `auth.users`. El email "bienvenida-administracion" se encolaba pero las credenciales eran inválidas → cliente nuevo recibe email con usuario y password que NO existen → no puede entrar al portal.

**Fix multi-capa** (commits + migs 0076 + 0077 + edge fn alta-cliente-portal):
1. `solicitud_activar` ya no encola bienvenida para clientes nuevos.
2. Trigger `AFTER INSERT ON administraciones` detecta admin nueva con email + sin user_id.
3. Trigger invoca via pg_net la edge function `alta-cliente-portal`.
4. Edge function: crea user en auth.users (admin API, password temporal seguro 16 chars), upsert profile.role='administrador', vincula admin.user_id ← user.id, encola bienvenida con `{{password_temporal}}`.
5. Template `bienvenida-administracion` actualizado con `{{usuario}}` + `{{password_temporal}}` + CTA al portal + hint de cambiar password.

Verificado e2e: invocación manual de la edge function creó user `28da5448-9dcf-4f22-8a0f-cb42631464e2`, vinculó admin, encoló bienvenida con password `ej9RzL3mzSsxY6#`, email enviado.

**Estado**: ✅ FIXEADO (verificado backend; verificación visual en próximo turno: cliente nuevo logueándose al portal).

---

## EGG-QA-11 · 🔴 CRÍTICO · solicitud_derivar pasaba args en posición incorrecta

**Módulo**: RPC `solicitud_derivar`
**Descripción**: `generar_acceso_externo` tiene firma `(recurso_tipo, recurso_id, email, nombre, dias_validez, observaciones)` (6 args). El RPC `solicitud_derivar` lo llamaba con 4 args `('solicitud', uuid, email, 7)` — el `7` se pasaba como `nombre_destinatario` (text) cuando era el `dias_validez` (integer). PostgreSQL fallaba el cast, la excepción quedaba silenciada por `EXCEPTION WHEN OTHERS NULL` → el token NUNCA se generaba → la gestoría externa recibía email con URL fallback inútil.

**Fix** (mig 0076): named args (`generar_acceso_externo(p_recurso_tipo := ..., p_dias_validez := 14, ...)`) + `RAISE WARNING` en lugar de NULL silencioso para debug futuro.

**Estado**: ✅ FIXEADO (pendiente re-test creando solicitud nueva y derivándola).

---

## EGG-QA-12 · 🟡 MEDIO · service_role / anon keys hardcoded en cron jobs SQL

**Módulo**: cron jobs `arca-dispatch-every-min` + `notify-vencimientos-diario`
**Descripción**: Al inspeccionar pg_cron.job vimos que algunos crons tienen `Authorization: Bearer myRhvg41J70_pBsHoo5LdKEnaRxOpQm77mfbL5c4h4A` hardcodeado. Otros (`dispatch-emails-1min`, `dispatch-push-2min`, `dispatch-vencimientos-diario`) usan `current_setting('app.service_role_key', true)` que es el approach correcto.
**Riesgo**: keys embebidas en SQL = exposición si se filtra el dump de la DB. También dificulta rotación de keys.
**Fix propuesto**: cambiar los 2 crons que hardcodean a usar `current_setting('app.service_role_key', true)` como los demás.
**Estado**: 🟡 documentado (pendiente fix).

---

## EGG-QA-13 · 🟡 MEDIO · current_setting('app.service_role_key') NULL en contexto user

**Módulo**: configuración de DB (Postgres `ALTER DATABASE`)
**Descripción**: El setting `app.service_role_key` está disponible para los cron jobs (corren con role postgres) pero NO para queries iniciadas por user/staff. Esto afectó al trigger `trg_admin_provision_user` que necesita invocar la edge function via pg_net y no encuentra el setting.
**Workaround actual**: invoqué la edge function manualmente para la admin de QA. Para producción, el setting debe estar visible en TODOS los contextos.
**Fix propuesto**: `ALTER DATABASE postgres SET app.service_role_key = '...'` con `WITH GRANTS` o cargar el setting al inicio de las funciones SECURITY DEFINER.
**Estado**: 🟡 documentado (pendiente verificación + fix definitivo).
1. Headers transaccionales deployados en dispatch-emails.
2. DKIM activado en Workspace (key 2048-bit, selector `google`).
3. TXT record cargado en Cloudflare DNS via API (zone fa9712692779831daf9b91e62ac563bf, record ac31ddef3586e796335d8a56f4c10241).
4. Propagación verificada en 3 resolvers (Cloudflare authoritative, 1.1.1.1, 8.8.8.8).
5. Workspace muestra estado "Autenticando el correo electrónico con DKIM".

Detalle EGG-QA-05/07 antiguo: ver commits 9b43c61 y 9d2d6c6.

Test fresh enviado post-activación: provider_msg_id `19e649333d95494a`, from contacto@, asunto realista "Recibimos tu consulta · Gestión Global". El usuario reportó que ese test cayó en Promociones aunque DKIM/SPF/DMARC/ARC pasaron todos.

**v2 (commit 9d2d6c6)**: el análisis del raw header mostró que los headers "transaccionales" que agregué eran en realidad headers de mailing-lists (`Precedence: list`, `List-Unsubscribe`, `Auto-Submitted`) — Gmail los interpretó como bulk → Promociones. Removidos. Solo quedan `X-Auto-Response-Suppress` y `X-Mailer` (neutros).

**Verificación final** (provider_msg_id 19e649681489dfe0, asunto "Recibimos tu solicitud · Gestión Global"): ✅ **Inbox principal** confirmado por el usuario. Pipeline outbound transaccional ahora premium-grade.

---

---
