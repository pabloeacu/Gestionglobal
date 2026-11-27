# DDJJ — Plan maestro (servicio de Declaraciones Juradas RPAC vía ARCA)

> Estado: **relevamiento (5 lectores) + verificación de diseño (4 lectores) CERRADOS**.
> Todo citado a `archivo:línea`. Este doc es la guía de construcción; se actualiza por fase.
> Origen: pedido de Pablo (2026-11-26). Premisas de cierre §5/§6 de `CLAUDE.md` aplican.

## 0. Principio rector

**Explotación de recursos que ya tenemos.** ~70% del servicio YA existe y está vivo en prod
(DGG-243: store cifrado de credenciales, Portal DDJJ, derivación tokenizada, moderación;
motor contable con disociación destinatario≠deudor nativa; recupero; banners). Lo nuevo real
es acotado: **wizard de cierre/emisión**, **materializar consorcios**, **wizard autónomo de
gerencia (§5)**, y **cerrar huecos de aviso**. No reinventar lo existente.

---

## 1. Decisiones lockeadas (Pablo, 2026-11-26)

| # | Decisión | Detalle |
|---|---|---|
| 1 | **No emitir comprobante en cero** | El trámite DDJJ abre SIN comprobante (ya lo hace el wizard, `useWizardActivacion.ts:113` `omitir:esDDJJ`); el importe real se emite en el **wizard de cierre**. |
| 2 | **Consorcios como subentidades** | Wizard ofrece: (a) alta manual, (b) alta por Excel, (c) **dedup inteligente** de los ya existentes (por código/CUIT, nunca duplica). |
| 2-bis | **Movilidad del consorcio + snapshot del deudor** | Un consorcio puede cambiar de administración (cambio de administrador del edificio). El comprobante DDJJ **congela el administrador-deudor del momento de creación** y nunca se re-deriva. Si el Excel trae un consorcio que ya existe bajo otra administración = cambio de administrador → **re-apuntar el consorcio al admin actual** para el trámite nuevo, **sin tocar comprobantes históricos**. Ver [[project_ddjj_consorcios_snapshot]]. |
| 3 | **Circuito, no plazo** | El plazo del trámite depende del administrador, no de gerencia. Token de 20d renovable + **re-aviva de 1 clic** (`derivacion_reavisar_gestoria`, ya existe) + vía "recibir por mail". Extender vida útil del enlace se charla más adelante si hace falta. |
| 4 | **Avisos** | **A (a gerencia, hacia adentro):** campanita + push + **MAIL** (los tres, siempre), vía `notify_all_gerentes`. Cerrar el GAP de credenciales DDJJ. **B (al cliente, hacia afuera):** circuito ya armado, queda **en OFF** (flag `ddjj_avisos_habilitados`), lo prende Pablo. |
| 5 | **Clave fiscal ARCA NO en el portal** | El Portal DDJJ es sólo el acceso del cliente a la plataforma externa. La clave de ARCA la usan **nosotros + la gestoría** para presentar, no el cliente. Sigue staff/gestoría-only. |
| 6 | **Email "presentación realizada" DDJJ** | Plantilla propia premium, con el detalle de **comprobantes generados (cantidad + importe total)** incrustado automáticamente (el costo que no se sabía al arrancar). |
| 4-bis | **Banner de gerencia** | Si lo de moderación no tiene banner propio en el dashboard de gerencia, crear uno. Filosofía: gerencia siempre atenta a lo que requiere atención. |

---

## 2. Hallazgos de verificación que condicionan el diseño (con file:line)

### 2.1 Notificación a gerencia — `notify_all_gerentes` es el canon
- Definición única `supabase/migrations/0170_notify_all_gerentes_y_fanout.sql:71-142`. Firma de 11 params, `SECURITY DEFINER`. **Una llamada = campanita + push + mail**: campanita vía `private.notif_emitir` → `notificaciones_internas`; push vía escalado a `push_notifications_queue` (`0163:42-63`); mail vía `email_queue kind='workflow'` con `template_slug` default `gerencia-notif-generica` (`0170:117-136`).
- Destinatarios: `role IN ('gerente','operador') AND activo` (`0170:100-106`).
- El slug `gerencia-notif-generica` NO está en la allow-list de marketing → mail por carril **transaccional** (Gmail/Workspace), no SES. `dispatch-emails/index.ts:843-851`.
- Acepta `p_email_vars jsonb` que se mergea con las vars base (`0170:93-98`) → sirve para pasar `cantidad`/`importe_total`.

### 2.2 El GAP real de avisos (lo único que hay que construir para el pto 4-A)
- ✅ Ya avisan a gerencia: **aporte de gestoría** (`tracking_linea_on_insert` rama `gestor_avance`, `0337:76-84`) y **movimiento del cliente** (`0337:64-75`). 3 canales, mail ON.
- ❌ **NO avisa: la propuesta de credencial DDJJ de la gestoría.** `credencial_reg_proponer_gestor` (`0647:15-92`) hace sólo el upsert `prop_*`; **no llama** `notify_all_gerentes`/`notif_emitir`/push/`email_queue`. Gerencia sólo lo ve si abre la cola. **→ este es el fix central del pto 4-A.**
- ⚠️ Consistencia: `tramite_pedido_doc_enviar_revision` (`0354:70-78`) mailea a una casilla **fija** `contacto@` y su loop campanita/push filtra sólo `role='gerente'` (sin operador). Deuda menor: migrar al helper canónico.

### 2.3 Banners del dashboard de gerencia
- Home = `src/modules/gerencia/pages/GerenciaHome.tsx:44`. Tira de ~13 widgets bespoke (pastel Tailwind crudo); **no hay sistema reutilizable tipo `premiumBanner`** del lado gerencia (ése vive sólo en portal, `src/modules/portal/components/premiumBanner.tsx:89`).
- **`AportesGestoriaWidget`** (`GerenciaHome.tsx:108`) YA muestra moderación pendiente **incluyendo propuestas de credenciales DDJJ/ARCA** (`fetchCredencialModeracionPendientes`, `ddjj.ts:139`), con contador y link a `/gerencia/moderacion`.
- ⚠️ PERO ese widget es **dismissable + filtrado a "nuevos"** (`AportesGestoriaWidget.tsx:57-61`): no es un recordatorio persistente. La campanita (`NotificationBell`) tiene badge, pero es contador **genérico** de no-leídas, no específico de moderación.
- Contador real "N pendientes" sólo aparece ya dentro de `ModeracionPage.tsx:123,143`.

### 2.4 Snapshot del deudor — NATIVO (nada que corregir)
- `comprobantes.administracion_id uuid NOT NULL` = snapshot del deudor (`0004_facturacion.sql:63-64`, rotulado "snapshot D06"). `consorcio_id` nullable (`:65`). Receptor también snapshoteado (`0004:78-86`).
- `emitir_comprobante_manual(p_administracion_id, p_consorcio_id, ...)` graba el `administracion_id` literal del param (`0008:131`), **no lo deriva**. Valida en emisión `consorcio.administracion_id == p_administracion_id` o EXCEPTION (`0008:77`) → sólo deja congelar la administración vigente del consorcio en ese momento (exactamente la regla 2-bis). Soporta `consorcio_id` en header y **por ítem** (`items_comprobantes.consorcio_id`, `0008:146,156`).
- Lectores de "quién debe" → **todos leen el snapshot** `comprobantes.administracion_id`, ninguno hace JOIN consorcio→admin: `comprobantes_morosos` (`0348:90,99`), `disparar_recupero_manual` (`0348:123,144-145,178`), `cuenta_corriente_morosos` (`0498:89`), `cuenta_corriente_extracto` (`0702:403,424,445`), emisor NC (`0702:294-297`). `recompute_comprobante_saldo` es agnóstico (`0703:39-41`). Barrido negativo: 0 coincidencias de re-derivación.
- NOTA: `facturar_con_cuit_administracion` es un **booleano** de `consorcios` (`0002:164`), NO una RPC.
- **Implicancia:** para honrar 2-bis alcanza con (i) pasar el `administracion_id` correcto al emitir, y (ii) en el importador, **UPDATE `consorcios.administracion_id`** al admin actual ANTES de emitir (para que pase el check `0008:77`). Los comprobantes viejos quedan con su deudor congelado.

### 2.5 Plantillas de email — motor y límite
- `email_templates` (slug + `body_html`/`cuerpo_html_visual` con `{{var}}` + `variables jsonb`), layout `manaxer-v1` (`0024:27-42`, `0082:14-24`). Encola `kind='workflow'` en `email_queue` con jsonb `variables` por fila; el cuerpo se arma **en la edge al enviar** (`dispatch-emails` `renderVars`, `index.ts:912-918`).
- **Límite duro:** `renderVars` es sustitución **plana de escalares** (`{{k}}` → `vars[k]`), **sin loops/iteración**, y **HTML-escapa** → no se puede inyectar un `<table>` pre-renderizado como variable.
- Patrón canónico para "tabla de números" = **estructura HTML fija en la plantilla + celdas escalares** (ej. reporte mensual `0711_dgg266_reporte_email.sql:24-39,111-141`). Dinero formateado en SQL: `'$'||trim(to_char(monto,'FM999G999G990D00'))` (`0328:110`).
- Encolado: `gerencia_encolar_email` (wrapper staff-gated) desde front; `encolar_email` directo desde SQL/triggers (`0024:178-227`, `0378`).
- **Implicancia pto 6:** "Se generaron **{{cantidad}}** comprobantes por un total de **{{importe_total}}**" sale directo con 2 escalares. Un detalle itemizado por consorcio (N filas variables) NO lo soporta el motor sin un slot fijo o un path raw nuevo → se ofrece como upgrade opcional.

---

## 3. Mapa ya existe / a terminar / nuevo

| Pieza | Estado | Montaje |
|---|---|---|
| Form DDJJ + wizard de alta (abre sin comprobante) | ✅ | `WizardActivacionV2` + `useWizardActivacion.ts:113` |
| Alta cliente (ficha+usuario+pass+bienvenida) | ✅ | `solicitud_activar` + edge `alta-cliente-portal` |
| Derivación tokenizada + moderación credenciales | ✅ | `accesos_externos`, `credencial_reg_proponer_gestor`/`_moderar` (DGG-243) |
| Portal DDJJ (link + usuario/pass) | ✅ | `PortalDdjjPage` |
| Comprobante destinatario=consorcio / deudor=administración + snapshot | ✅ | `emitir_comprobante_manual` (nativo) |
| Cierre ligado a cobranza | ✅ | trigger `tramite_cerrar_exige_cobrado` |
| Recupero sobre cta cte del administrador | ✅ | `comprobantes_morosos` + `disparar_recupero_manual` (manual) |
| Re-aviva del enlace (gap 2 meses) | ✅ | `derivacion_reavisar_gestoria` |
| Aviso al cliente "credenciales cargadas" | 🟡 OFF | flag `ddjj_avisos_habilitados` |
| **Aviso a gerencia al proponer credencial DDJJ** | 🔴 GAP | construir (pto 4-A) |
| **2ª carga: constancia RPAC + Excel rendición** | 🔴 | vía avance (`tracking_lineas`) |
| **Materializar consorcios (manual + Excel + dedup + re-point)** | 🔴 | nuevo importador |
| **Wizard de cierre/emisión (único vs por-consorcio, simple/fiscal)** | 🔴 | nuevo asistente masivo |
| **Wizard autónomo "Presentación DDJJ externa" (§5)** | 🔴 | reusa alta + buscador |
| **Email "presentación realizada" DDJJ (+ resumen comprobantes)** | 🔴 | nueva plantilla manaxer-v1 |
| **Banner/recordatorio persistente DDJJ en gerencia** | 🟡 | decidir reuse vs nuevo widget |

---

## 4. Arquitectura por fases

> Cada fase cierra "inmejorable": migración(es) + frontend + doble auditoría §6 (REVISAR 3 agentes + EJERCITAR e2e BEGIN/ROLLBACK) + QA en vivo (desktop + mobile 360px, consola limpia) + `ERRORES.md`/`DECISIONES.md`/`PROJECT_STATUS.md` + commit del *por qué* + push. Regenerar types tras cada mig.

### F0 · Fundaciones de datos (consorcios materializables + helper de alta)
- **Importador de consorcios** reutilizando el molde `importador.ts` (`parsearArchivoXlsx`/`validarFilas`): interpreta el Excel por código → materializa filas en `consorcios`; **dedup por código/CUIT**; si existe bajo otra administración → **re-apunta** `administracion_id` al admin actual (cambio de administrador) sin tocar históricos. RPC multi-tabla `SECURITY DEFINER` (R5), GRANTs (R6), `safeStorageKey` para el Excel (R20).
- **Alta manual** de consorcio en el mismo wizard (form drawer).
- **Helper compartido** extraído de `solicitud_activar` (dup-check DGG-123 + alta administración + apertura de trámite) para que F4 (wizard autónomo) no duplique lógica (R14/R15).

### F1 · Avisos a gerencia (cerrar GAP 4-A) + recordatorio persistente
- `credencial_reg_proponer_gestor` → agregar `PERFORM public.notify_all_gerentes('credencial_ddjj_propuesta', ...)` tras el upsert (sin exponer usuario/contraseña en el cuerpo). R16: `CREATE OR REPLACE` misma firma. R17 cubierto (ambas `SECURITY DEFINER`).
- Consistencia (deuda menor): migrar `tramite_pedido_doc_enviar_revision` al helper canónico (mail por-gerente + incluir operador).
- **Recordatorio persistente DDJJ** en `GerenciaHome`: el `AportesGestoriaWidget` ya trae credenciales DDJJ pero es dismissable/"nuevos"; sumar que lo pendiente DDJJ **se mantenga visible mientras haya algo pendiente** (ver micro-decisión §5).

### F2 · 2ª carga (constancia RPAC + Excel de rendición) + re-aviva
- Panel del gestor (`PanelGestor` en `/externo/:token`): acción para subir **constancia de presentación RPAC** + **Excel de rendición** como **avance** (`tracking_lineas`, carril de moderación) — NO por el store (que es 1 fila por admin/plataforma y se sobrescribe).
- Re-aviva de 1 clic desde el trámite + vía "recibir por mail".

### F3 · Wizard de cierre/emisión (el corazón nuevo)
- Al cerrar el trámite DDJJ, asistente que decide: **(1) un comprobante a la administración** vs **uno por consorcio**; **(2) simple o fiscal** (hoy todo tipo X, ARCA dormido).
- Por-consorcio: 1 línea/comprobante por consorcio (destinatario=consorcio, deudor=administración snapshot), **emisión masiva**. Cta cte refleja todo; recupero sobre el administrador; cierre evoluciona con la cobranza (gate ya existe).
- Reusa `emitir_comprobante_manual` (soporta `consorcio_id` por ítem). R18: smoke e2e real de la emisión.

### F4 · Wizard autónomo "Presentación de declaración jurada externa" (§5)
- Acción en gerencia: paso 1 identificar cliente existente (buscador `quickSearchAdministraciones`) vs **cliente histórico sin usuario** (alta ficha+usuario+pass provisoria in-wizard, vía helper de F0 + `alta-cliente-portal`). Luego: crear trámite, cargar docs, emitir (entra al wizard de cierre F3), cta cte, tracking, comunicar.

### F5 · Email "presentación realizada" DDJJ
- Plantilla `ddjj-presentacion-realizada` manaxer-v1 premium: "Tu DDJJ fue presentada ante el RPAC" + **"se generaron {{cantidad}} comprobantes por un total de {{importe_total}}"** (escalares, calculados en SQL al disparar). Opcional: detalle por consorcio (requiere slot fijo o path raw — ver §5).
- Reemplaza el genérico `tramite-resuelto` para DDJJ.

### F6 · Avisos al cliente (dejar listo, NO prender)
- Verificar que el fan-out `credencial_ddjj_aviso_fanout` cubre el circuito; dejar todo enganchado con el flag `ddjj_avisos_habilitados` en OFF. Se prende cuando Pablo diga "disparemos los avisos de DDJJ".

---

## 5. Micro-decisiones (RESUELTAS por Pablo, 2026-11-26)

- **M1 · Banner de gerencia → RESUELTA: (a)+(b).** Cerrar el ping de 3 canales (campanita+push+mail al proponerse una credencial DDJJ) **Y** sumar un recordatorio **persistente** en el dashboard que no desaparezca mientras haya DDJJ pendiente. → F1.
- **M2 · Detalle del mail → RESUELTA: resumen escalar.** "Se generaron {{cantidad}} comprobantes por un total de {{importe_total}}" (escalares, motor actual, sin extender). El itemizado por consorcio queda como upgrade opcional NO comprometido. → F5.

> NOTA de secuencia: el **helper compartido de alta** (dup-check DGG-123 + alta administración + apertura de trámite) se extrae en **F4** (donde se consume), no en F0, para no dejar abstracción sin consumidor.

---

## 6. Checklist §6 transversal (aplicar en cada fase)
- (a) Fan-out de consumidores de cada dato nuevo (estado/origen/tipo).
- (b) Matriz estado × superficie (email/push/campanita/agenda/home/ficha/grilla).
- (c) Bordes temporales + backfill de lo pre-existente.
- (d) Caso reportado end-to-end en su propia silla.
- (e) Coherencia aviso ↔ display.
