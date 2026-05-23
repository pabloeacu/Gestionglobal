# PROJECT STATUS · Plataforma Gestión Global

> **Archivo vivo de continuidad de sesión.** Si abrís una sesión nueva, leé este archivo PRIMERO. Te dice exactamente dónde quedó el proyecto, qué se hizo, qué falta y qué decisiones tomamos en el camino.
>
> **Mantenimiento**: actualizar después de cada chunk de trabajo verificado y cerrado. No esperar al final. Si un paso se postergó, registrarlo abajo en "Pateado para el final".

**Última actualización**: 2026-05-22 (Campus Fase 3 · **UI + sala Zoom REAL creada y verificada online**. Encuentro "QA Fase 3 · Test de Zoom embebido" creado en curso RPAC, botón "Crear sala Zoom" funcionó tras arreglar 3 bugs reales en browser test (E-GG-09 preflight CORS · E-GG-10 columna `role` · E-GG-11 host=me). Sala Zoom real `meeting_id=88331964630` persistida con join_url/start_url/password. UI gerencia muestra badges (PROGRAMADO/En vivo/Finalizado), "Iniciar como host", link público, ID, pwd, grabación cuando llegue. Alumno panel "Encuentros en vivo" + embed lazy del Meeting SDK con customerKey=matricula_id. Credenciales para test alumno: `admin@solyluna.test` / `SolYLuna2026` ya matriculado en el curso.)
**Sesión actual**: Campus Fase 3 frontend + e2e — UI gerencia (EncuentrosTab extendido) + UI alumno (EncuentrosEnVivoAlumno) + ZoomLiveEmbed (Component View del Meeting SDK, lazy import). @zoom/meetingsdk 6.0.2 instalado. .npmrc legacy-peer-deps para Vercel. 3 bugs reales encontrados en browser test (CORS preflight + columna profiles + host email gerente vs Zoom) + arreglados + redeployados. Sala Zoom #88331964630 viva en producción para testear el join del alumno.

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
5. ✅ **CERRADO + VERIFICADO ONLINE** — 28 items (pase rápido 15 + L/M 13) + QA browser test punta a punta que destapó y arregló 7 bugs reales (E-GG-02..07 + flash login). Ver §2bis/§2ter y `ERRORES.md`.
6. ✅ **Campus rebuild COMPLETO + VERIFICADO ONLINE** — Fase 1 (acceso manual, condiciones configurables, encuentros, pago→asiento financiero) + Fase 2 (certificado verificable PDF+QR, motor de emisión automática por trigger, `/verificar/:codigo` público). Migraciones 0045+0046. Cert de prueba emitido `GG-CURS-2026-554DC0` validado en vivo (gerencia + /verificar). PDF descargable (revisión visual del diseño → usuario). Pendiente: link-by-link review del resto de módulos; verificación de impacto en caja (espera Finanzas).
7. ⏳ **Mockup web mejorada con documentación** — pendiente.
8. ⏳ **Revisión end-to-end del proyecto** — pendiente.
9. ⏳ **Planning del trabajo remanente** — pendiente.

**Rondas auxiliares ejecutadas fuera del roadmap principal**:
- **Ronda 5.5 · Refinamiento Agenda con patrón MDC** ✅ — migraciones `0038_agenda_mdc_pattern.sql` + `0039_agenda_motor_recordatorios.sql`. 4 tablas MDC, parser NL `agendaParse.ts`, motor recurrencia virtual `agendaRecurrencia.ts`, UI completa con 9 componentes nuevos, gestos premium (paint/move/resize/drag&drop), cadencia humana de recordatorios.
- **Ronda 6 · Unificación temporal** ✅ COMPLETA — migración `0040_agenda_unificada.sql` (VIEW `vw_agenda_unificada` con 5 fuentes proyectadas, RPC `tracking_cerrar_ciclo` con alarmas configurables, `ProgramarVencimientoModal` en TrackingDetail, Vencimientos como tab dentro de Agenda) + migración `0041_dispatch_log_canal.sql` (idempotencia per-(vencimiento, offset, canal) + plantilla `vencimiento_alerta_cliente`) + proyecciones in-line en Vista Mes/Semana/Día/Lista (icono Lock, click → módulo origen) + edge function `dispatch-vencimientos` reescrita para consumir RPC `gg_vencimientos_planificar_alertas` con push interno (gerentes) + email al cliente cuando `notificar_cliente=true`.

---

## 2bis. Resultado del QA walkthrough en vivo (2026-05-22) — CERRADO

Recorrido punta a punta logueado sobre la URL de Vercel. **Cobertura amplia** del Punto 5 + Ronda 6.

**✅ Validado en vivo (funciona):** landing · login · form público (envío+confirmación) · trigger submission→solicitud (consulta/tramite/servicio; `evento` excluido por diseño) · Solicitudes 1.C/1.D/1.E/1.F/1.G/1.H · wizard activación 3 pasos · detalle solicitud · detalle tracking · 2.B compartir externo · Formularios 4.A/4.C/4.F/4.G · acceso externo 5.C/5.E + detalle (post-fix) · Agenda: default Semana, parser NL (preview+crear+render con CírculoHecha+color categoría), tabs Mi agenda/Vencimientos, filtros de fuente, modo enfoque, leyenda · Vencimientos tab 6.A/6.D/6.E.

**🐛 Bugs encontrados y RESUELTOS (6):**
- E-GG-02 🔴 detalle solicitud roto (columnas inexistentes payload/campo + bucket privado) → fix verificado.
- Flash landing post-login 🟠 → fix (RoleHomeOrLanding usa session).
- E-GG-03 🟠 ProgramarVencimientoModal desaparecido (iCloud) → recuperado.
- E-GG-04 🔴 detalle tracking roto (embed self-join PostgREST + cache stale) → fix verificado.
- E-GG-05 🔴 acceso externo no generaba token (pgcrypto search_path) → fix verificado (mig 0043).
- E-GG-06 🟠 acceso externo "Sin datos" (columnas inexistentes en edge) → fix verificado (edge v3).

**✅ Bugs menores RESUELTOS (commit 613fad2, 2026-05-22):**
- E-GG-07 sesión caía cada ~1h → refresh manual en AuthContext + readStoredSession no descarta si hay refresh_token.
- `solicitud_activar` no guardaba periodo/fecha_inicio/servicio_id/parent_tracking_id → mig 0044.
- Undo descartar 5s → 8s.
- TrackingDetailPage: error in-place (Reintentar/Volver) en vez de redirigir al listado.
- KPI "VIGENTES 0": era cosmético (AnimatedNumber a mitad de animación) — no requería fix.
- Duplicados iCloud → `.gitignore` (`*[ ][0-9].*`); falta acción del usuario: desactivar sync iCloud en la carpeta.

**🟡 Bugs menores HISTÓRICOS (ya resueltos arriba):**
- `solicitud_activar` NO guarda `periodo`/`fecha_inicio` en el tracking (quedan NULL pese a cargarse en el wizard). → revisar RPC.
- KPI "VIGENTES" de Vencimientos no cuenta el que vence hoy (latencia o filtro horizonte). Idem KPIs Solicitudes (refresco realtime con delay).
- Ventana undo de descartar solicitud: 5s → subir a 8s (latencia real).
- `TrackingDetailPage.load()` ante error hace `navigate('/gerencia/tramites')` (enmascara fallos) → mostrar error in-place.
- **Sesión se cae al volver de `/externo` (público)** → sospecha: el cliente anónimo de Supabase en la página pública pisa la sesión autenticada en localStorage. **Revisar — potencialmente importante.**
- iCloud/Finder resucita archivos borrados y crea duplicados "* N.tsx" → mitigado con `.gitignore` (`*[ ][0-9].*`). **Recomendar al usuario desactivar sync de iCloud en la carpeta del proyecto.**

**No verificado visualmente (código presente):** proyecciones in-line con borde-color (falta data con fecha), gestos drag/resize/paint en Semana (latencia de screenshots impide test fluido), undo de marcar-hecha en Agenda, 2.D SLA / 2.G alarmas (necesitan tracking con servicio+sla y vencimiento programado).

**Datos de prueba creados en el entorno** (preview): solicitud + cliente "Méndez Roberto" + tracking TRM-2026-00010 + acceso externo + evento agenda "Reunión con el contador" (sáb 23) + vencimiento QA "vence hoy". Limpiar si se desea entorno prolijo.

---

## 2ter. QA cerrado + entorno limpio (2026-05-22)

- **Punto 5 + Ronda 6: 100% cerrados y VERIFICADOS ONLINE** (no solo build). 7 bugs reales encontrados y resueltos en el recorrido (E-GG-02..07 + flash login), 3 de ellos críticos. Detalle en §2bis + `knowledge-base/ERRORES.md`.
- **Datos de prueba del QA eliminados** — entorno prolijo (0 solicitudes/trámites/submissions/eventos/vencimientos QA).
- **Migraciones aplicadas hasta 0044.** Edge functions: `dispatch-vencimientos`, `acceso-externo` v3.
- **Pendiente del usuario**: desactivar sync de iCloud en la carpeta del proyecto (resucita archivos / crea duplicados `* N.tsx`; mitigado con `.gitignore`).
- **Próximo macro-hito: Punto 6 · Campus rebuild** (DGG-10).

---

## 2. Trabajo en curso AHORA

**Campus Fase 3 · Zoom + Webinars · BACKBONE COMPLETO (2026-05-22).** Browser automation + DB + edge functions:
- ✅ **App 1 (S2S OAuth) "Gestion Global Campus"** creada, ACTIVADA, 4 scopes granulares (meeting:write/read:meeting:admin, report:read:list_meeting_participants:admin, cloud_recording:read:list_recording_files:admin).
- ✅ **App 2 (General App) "Gestion Global Campus SDK"** creada con feature **Embed → Meeting SDK** habilitada. Client ID/Secret = SDK Key/Secret.
- ✅ **6 secrets** en Supabase: ZOOM_ACCOUNT_ID, ZOOM_S2S_CLIENT_ID, ZOOM_S2S_CLIENT_SECRET, ZOOM_SDK_KEY, ZOOM_SDK_SECRET, ZOOM_WEBHOOK_SECRET_TOKEN.
- ✅ **Migración 0047_campus_zoom.sql APLICADA**: `curso_encuentros.zoom_meeting_id/join_url/start_url/password/duracion_min/zoom_status/iniciado_at/finalizado_at/grabacion_url/grabacion_play_url`; `cursos.presencia_minima_pct` (default 50, configurable por curso); `curso_encuentro_asistencias.unido_at/salido_at/tiempo_conectado_seg/fuente(manual|zoom_auto|mixto)/umbral_cumplido/auto_presente`; tabla `curso_encuentro_zoom_eventos` (log inmutable join/leave); RPCs SD `curso_encuentro_set_zoom` (staff), `curso_encuentro_zoom_evento` (service-role, recomputa tiempo conectado + umbral), `curso_encuentro_zoom_estado` (service-role), `curso_encuentro_zoom_grabacion` (service-role).
- ✅ **3 edge functions deployadas**:
  - `zoom-webhook` (verify_jwt=false): challenge HMAC `endpoint.url_validation` + verify v0 signature + despacha meeting.started/ended/participant_joined/participant_left/recording.completed a las RPCs SD.
  - `zoom-sdk-signature` (verify_jwt=true): valida user (staff o matriculado), arma JWT HS256 con sdkKey+mn+role+exp y devuelve `{signature, sdkKey, meetingNumber, role, customerKey=matricula_id}` para `ZoomMtg.join`.
  - `zoom-meeting-create` (verify_jwt=true): solo staff, S2S OAuth account_credentials → POST /v2/users/me/meetings con auto_recording='cloud', waiting_room, type=2 (scheduled) → guarda metadata vía RPC.
- ✅ **Event Subscriptions en Zoom**: URL `https://kaoyhkebnidzqjixvchh.supabase.co/functions/v1/zoom-webhook` **VALIDADA por challenge HMAC** (la edge fn respondió bien) + 5 eventos suscriptos (Start Meeting, End Meeting, Participant/Host joined meeting, Participant/Host left meeting, All Recordings have completed).
- ⏳ **Próximo (frontend Fase 3)**: en `EncuentrosTab` botón "Crear sala Zoom" → edge `zoom-meeting-create`; en `CursoDetalleAlumnoPage` panel "Encuentro en vivo" con `<ZoomMtgEmbedded>` que pide `zoom-sdk-signature` y joinea con `customerKey=matricula_id`; gerencia ve "Iniciar como host" (start_url); panel grabaciones (`grabacion_play_url`); umbral configurable en `cursos`; webinars públicos `/webinar/:token` (parte 2).

**Campus Fase 3 · Zoom + Webinars · DISEÑO ENTREGADO (2026-05-22).** (DGG-14/15 · `CAMPUS_FASE3_DESIGN.md`.) Documento de diseño completo: arquitectura (Meeting SDK embed + API S2S OAuth + webhooks, todos gratis; cloud recording requiere Pro+), deltas de modelo (extender `curso_encuentros`/`_asistencias` + nuevas `webinars`/`webinar_inscriptos` molde acceso-externo), asistencia automática por login (`customer_key=matricula_id`), webinars públicos a prospectos vía Meetings (no el add-on pago) en `/webinar/:token`, roles docente/moderadora por link de host (sin crear roles aún), config paso a paso del Marketplace (2 apps: S2S + Meeting SDK), y **7 decisiones abiertas** (plan Zoom actual, grabación cloud vs local, rol docente ahora o link, Meetings vs Webinars add-on, browser automation vs guía, cupo, vínculo prospecto-ctacte). **Hallazgo clave:** el requisito OBF token (2-mar-2026) NO aplica porque hosteamos en cuenta propia. NO se escribió código (solo diseño).

**Punto 6 · Campus Fase 1 implementada + VERIFICADA ONLINE (2026-05-22).** (DGG-10 / DGG-10bis · `CAMPUS_DESIGN.md` §8 Fase 1.)

**Browser test:** ✅ editor de curso carga (tras fix del bug abajo) · ✅ tab Condiciones (agregar examen-auto + pago-manual + guardar persiste) · ✅ tab Alumnos (empty state + drawer "Asignar alumno" abre) · ✅ RPC `curso_asignar_alumno` verificado en vivo (crea matrícula + checklist con las 2 condiciones, examen:false/pago:false — en transacción con rollback). 🐛 **E-GG-08 (arreglado, commit 51c6e0b): React #310** — `CursoEditorPage` tenía `useState(activeKey)` tras el early return de loading → pantalla blanca total. Movido arriba. Verificado online.
**✅ Pixel-test COMPLETO (2026-05-22, extensión de contraseñas pausada):** asignar alumno (drawer→matrícula+checklist), registrar pago (→condición tildada + asiento de ingreso `$180k` en `movimientos` cat "Cursos/Campus", verificado en BD), encuentros (crear + asistencia AUSENTE→PRESENTE), y **portal del alumno** (`/portal/campus`: "Mis cursos" sin autoservicio + detalle con panel "Tu certificado" 0/2 + checklist motivacional "Te falta: Aprobar examen · Pago"). **Campus Fase 1 = 100% validado online, gerencia + alumno.**

**🔑 Credenciales de testeo (alumno):** `admin@solyluna.test` / `SolYLuna2026` (rol administrador, Administración Sol y Luna SRL). Generadas por mí (bcrypt) para testear el portal. Sirven para QA futuro. Gerente: `pabloeacu@gmail.com` / `EagleView2026`.

**🟡 Pendientes/observaciones Campus:**
- **Verificación de caja**: el circuito de pago COMPLETO (que el ingreso impacte el saldo de la caja) NO se puede validar hasta tener el **módulo Finanzas** (PRONTO). Hoy sólo se inserta el `movimientos`. Tener presente al construir Finanzas (DGG-10bis).
- Video de cursos seed = placeholder Rick Astley → reemplazar por contenido real.
- Setup actual dejado como base de Fase 2: curso "Formación RPAC" con condiciones (examen+pago) + 1 matrícula (Sol y Luna, 0/2 cumplidas).

Se construyó sobre la base existente (mig `0029_campus.sql`):

- **Migración `0045_campus_fase1.sql`** (aplicada + types regenerados):
  - Cierre del autoservicio: `cursos_select_public` (anon) → `cursos_select_auth` (solo authenticated); `curso_matricular` ahora exige `is_staff()` (ya no auto-matrícula).
  - Tablas nuevas (RLS + índices FK): `curso_condiciones_config` (el "3+1": examen/asistencia/pago/otra), `matricula_condiciones` (checklist por matrícula), `curso_encuentros` + `curso_encuentro_asistencias` (sincrónicos por encuentro).
  - RPCs SD: `curso_asignar_alumno` (resuelve el profile del administrador de la administración, materializa el checklist), `matricula_tildar_condicion` (staff; examen es read-only), `curso_registrar_pago` (marca condición pago + asiento de ingreso en `movimientos` tipo `ingreso`, categoría "Cursos / Campus").
  - Auto-tilde del examen: `matricula_sync_examen` + trigger `AFTER INSERT OR UPDATE OF aprobado` en `examen_intentos`. **Probado en DB** (INSERT y UPDATE).
- **API `campus.ts`**: `asignarAlumno`, `listCondicionesConfig`/`guardarCondicionesConfig`, `listCondicionesMatricula`, `tildarCondicion`, `listEncuentros`/`crearEncuentro`/`marcarAsistencia`, `registrarPagoCurso`, `listAdministracionesParaAsignar`, `listCajasParaPago`. Se quitó `matricularse` (autoservicio).
- **UI**: tabs nuevos en `CursoEditorPage` (Condiciones, Encuentros, Alumnos con checklist tildable); `AsignarAlumnoDrawer`, `RegistrarPagoModal`, `CondicionesTab`, `GestionMatriculasTab`, `EncuentrosTab`. Portal alumno: `MisCursosPage` sin catálogo/auto-inscripción; `CursoDetalleAlumnoPage` sin CTA de inscripción + panel "Tu certificado" (checklist de condiciones).
- **Build limpio** (`tsc --noEmit` + vite). **NO commiteado** — pendiente review + browser test del usuario.

**Fase 2 · Certificado verificable (IMPLEMENTADA 2026-05-22, pendiente browser test):**
- **Migración `0046_campus_certificados.sql`** (aplicada + types regenerados):
  - Tabla `certificados` (un cert por matrícula `UNIQUE(matricula_id)`, `codigo` legible `GG-CURS-2026-XXXXXX`, `verificacion_hash` HMAC-sha256 con secret en `private.campus_secrets`, `payload_snapshot` congelado, `tema` 1..4, `nota_examen`, `pdf_storage_path` null, `enviado_email_at`, `revocado_at`). RLS: staff ve/maneja, alumno ve los suyos. Índices FK + UNIQUE.
  - Bucket privado `certificados` (políticas staff + alumno-read por path `<cert_id>/%`). En el MVP el PDF se genera al vuelo (no se sube); el bucket queda listo para persistir luego.
  - RPCs SD: `emitir_certificado(p_matricula_id)` (valida TODAS las condiciones activas cumplidas, idempotente), `emitir_certificado_si_corresponde` (silenciosa, para triggers/cron), `verificar_certificado(p_codigo)` (**pública/anon**, solo datos no sensibles), `revocar_certificado` (staff).
  - **Motor "certificado listo"**: disparo por evento (trigger `AFTER UPDATE OF cumplida` en `matricula_condiciones` + `matricula_sync_examen` al aprobar examen) → emite en el acto al cumplir la última condición. **Cron `gg-campus-certificados` cada 5 min** como backstop (`gg_campus_emitir_certificados_pendientes`). Al emitir encola email `certificado-emitido`.
  - **Fix tenancy**: `encolar_email` se llama con `administracion_id = NULL` (el cron/trigger no tiene `auth.uid()`; el guard per-admin lo denegaría). El vínculo queda por `related_table/related_id`.
- **Render PDF rediseñado ULTRA PREMIUM (DGG-13, 2026-05-22): HTML/CSS → `html2canvas` → jsPDF** (lib `html2canvas` agregada). El generador monta `<CertificadoPremium>` offscreen (1123×794, ratio A4 apaisado), espera fuentes+logos, captura a scale 3 y arma el PDF 297×210 mm. **Mismo componente sirve para la "Vista previa" y para el PDF** (fidelidad pixel-perfect). Estética igual a la web: lámina crema con doble filete dorado, gradiente navy→cyan por tema, acentos triangulares de marca, **sello dorado central con el isotipo GG (`/logo-color.png`)**, **wordmark FUNDPLATA tipográfico**, título serif (Cormorant Garamond), **nombre del alumno en script (Great Vibes)**, curso en dorado, leyenda legal FU.DE.CO.IN/Ley 14.701/Dec 1734-22/Disp 27-23, doble firma Parente/Acuña, **"Organizado por" + logo GG horizontal (`/logo-h-color.png`)**, QR + código al pie. **4 temas** (1 marino+dorado · 2 dorado · 3 cyan/teal · 4 violeta). Fuentes Cormorant+Great Vibes agregadas a `index.html`. `src/modules/campus/components/CertificadoPremium.tsx` + `lib/generateCertificadoPdf.ts`.
- **Vista previa**: botón "Vista previa" (junto a "Descargar") en `GestionMatriculasTab` → `CertificadoPreviewModal` muestra el cert HTML escalado al ancho con descargar/verificar. Permite revisar el diseño en browser sin bajar el PDF.
- **QR**: `verificacionUrl()` robustecida → `VITE_PUBLIC_BASE_URL ?? window.location.origin ?? 'https://gestionglobal.ar'` (apunta SIEMPRE a `/verificar/:codigo` resoluble aun desde previews/local).
- **Página pública `/verificar/:codigo`** (`VerificarCertificadoPage`): **elevada a premium** (hero gradiente navy→cyan con logo GG blanco + triángulos, tarjeta de validez con banner verde, datos en grid, código de verificación). Estados válido/revocado/no-encontrado.
- **UI**: portal alumno (`CursoDetalleAlumnoPage`) panel "¡Listo! Descargá tu certificado" + botón PDF + link verificación cuando está emitido; gerencia (`GestionMatriculasTab`) badge "Certificado emitido" + ver/descargar, o botón "Emitir certificado" si las condiciones están todas cumplidas y el motor aún no lo emitió.
- **Email `certificado-emitido`** (casilla cursos) seedeado.
- **Verificado en BD (transacción con rollback)**: tildar las 2 condiciones de la matrícula Sol y Luna → trigger emite cert + encola email + `verificar_certificado(codigo)` devuelve válido. La BD quedó intacta (0/2, sin cert) para el browser test del usuario.
- **Build limpio** (`tsc --noEmit` + vite). **NO commiteado**.

<details><summary>Detalle histórico del QA (2026-05-21/22) — para referencia</summary>

Recorrido punta a punta sobre la URL de Vercel logueado como gerente. Hallazgos:

- ✅ Validados en vivo: form público (envío+confirmación), trigger submission→solicitud (categorías tramite/servicio/consulta), 4.A autosave (3 estados), 4.C preview dual Desktop/Móvil/Ambos, 4.F validador schema, 4.G copiar URL, 1.E filtro categoría dinámico + URL params, 1.G tiempo relativo, 1.D derivar en hover.
- 🔴 **E-GG-02 (arreglado, commit f900b78)**: detalle de solicitud 100% roto — `getSolicitud` usaba `payload` (col real `datos`), adjuntos `campo/nombre_original` (reales `field_name/filename_original`), `getPublicUrl` en bucket privado (→ `createSignedUrl`). Error runtime SQL invisible para tsc/build.
- 🟠 **Flash de landing post-login (arreglado, f900b78)**: `RoleHomeOrLanding` pintaba landing mientras resolvía el profile → ahora muestra loader si hay `session`.
- 🟠 **E-GG-03 (recuperado)**: `ProgramarVencimientoModal.tsx` desaparecido del working tree (Finder/iCloud).
- 🟡 **Decisión pendiente del usuario**: formularios tipo `evento` NO generan solicitud (trigger `crear_tramite_desde_submission_auto` sólo procesa tramite/servicio/consulta). ¿Intencional?
- 🟢 **Backlog menor**: contador `envios` del formulario desincronizado (incrementa pero no decrementa al borrar submission).

**Validado en vivo además (2026-05-22)**: detalle de solicitud (fix E-GG-02 OK), 1.H responder (modal completo), 1.F undo (toast+RPC, código correcto; window 5s recomendado subir a 8s), wizard de activación 3 pasos (derivar→cliente→tracking, crea cliente+tracking+emails OK).

🔴 **E-GG-04 (arreglado, commit 74f719f)**: detalle de tracking 100% roto — `getTracking` embebía el parent con self-join PostgREST `parent:tramites!tramites_parent_tracking_id_fkey`; el FK existe pero el schema cache quedó stale → "Could not find a relationship between 'tramites' and 'tramites'". El wizard activaba OK pero el detalle reventaba y rebotaba al listado. Fix: parent con query separada (independiente del cache). Evitar embeds self-referenciales.
🟡 **Mejora UX baja prioridad**: `TrackingDetailPage.load()` ante error hace `navigate('/gerencia/tramites')` (enmascara fallos) — debería mostrar error in-place.

**Pendiente del recorrido (tras deploy 74f719f)**: re-verificar detalle de tracking carga OK → 2.B compartir externo, 2.D indicador SLA, 2.G panel próximas alarmas + programar próximo vencimiento (DGG-07); Agenda (modo enfoque, undo, leyenda, gestos, proyecciones in-line con borde-color); Vencimientos (banner HOY, CSV, agrupador); Acceso externo (5.B contacto, 5.C aperturas — hay un acceso generado por el wizard). 1.B lightbox necesita un submission con adjunto (pendiente).

**Bugs QA totales: 4** (E-GG-02 y E-GG-04 críticos rompían pantallas enteras; flash login; E-GG-03 archivo perdido). Todos invisibles para tsc/build → validan el método de browser test obligatorio.

**Punto 5 implementación**: completa (28 items + migración `0042_p5_resto.sql`, edge `acceso-externo` v2). Próximo macro: Punto 6 (Campus rebuild) una vez cerrado el QA.

</details>

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

- **🎓 Revisitar diseño del certificado** (pedido del usuario 2026-05-22): el rediseño DGG-13 quedó premium y aprobado para avanzar, pero el usuario quiere volver sobre él como **último punto** para pulir/ajustar detalles finales. Componente: `src/modules/campus/components/CertificadoPremium.tsx`.
- **KPIs `AnimatedNumber` saltan desde 0 al cargar** → en un vistazo pueden mostrar un valor intermedio "equivocado" (visto en Vencimientos y Plantillas email; los datos reales están bien). Pulido opcional: que en la carga inicial salten directo al valor (sin animar desde 0). No es bug funcional.
- **Link-by-link review (2026-05-22): COMPLETO, 0 bugs reales nuevos.** Recorridos premium y estables: Clientes(+detalle), Servicios, Facturación(+detalle), Cuenta corriente, Recupero, Partners, Reportes(+importador), Configuración/ARCA/Plantillas-email(17 templates), Trámites legacy, Perfil. Los bugs estaban en los módulos nuevos (ya arreglados E-GG-02..08+flash). Sub-rutas no visitadas (cola emisión/envíos, recupero morosos/config/plantillas, vencimientos/config, servicios/:id, partners/:id, tramites/kanban) son hijas de módulos validados.


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
| 2026-05-22 | **QA browser test en vivo** punta a punta (logueado) + DGG-10/11 definidas. 7 bugs reales hallados y arreglados: E-GG-02 (detalle solicitud), flash login, E-GG-03 (archivo iCloud), E-GG-04 (detalle tracking embed self-join), E-GG-05 (acceso externo pgcrypto), E-GG-06 (acceso externo "Sin datos"), E-GG-07 (sesión cae ~1h). Migraciones 0043+0044, edge `acceso-externo` v3. | Punto 5 + Ronda 6 **cerrados y verificados online** | Punto 6 · Campus rebuild |
| 2026-05-22 | **6 bugs menores arreglados** (sesión refresh, periodo en activar, undo 8s, error in-place tracking, KPI=cosmético, iCloud .gitignore) + **datos de prueba QA eliminados** + docs consolidadas | Entorno limpio · todo verificado online | **Arrancar Campus (DGG-10)** |
| 2026-05-22 | **Punto 6 · Campus Fase 1** (DGG-10/10bis): mig `0045_campus_fase1.sql` (cierre autoservicio + `curso_condiciones_config` + `matricula_condiciones` + `curso_encuentros`/`_asistencias` + RPCs `curso_asignar_alumno`/`matricula_tildar_condicion`/`curso_registrar_pago` + auto-tilde examen probado en DB) · API + UI (tabs editor + AsignarAlumnoDrawer + RegistrarPagoModal + portal alumno sin autoservicio) · build limpio · types regenerados | Campus Fase 1 implementada, **sin commit** | Browser test del usuario → Fase 2 (certificado PDF+QR+verificación) |
