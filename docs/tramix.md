# TRAMIX · Consulta de expedientes DPPJ en el portal de clientes

> Estado vivo del proyecto "Consultar mi trámite en Mesa de Entradas Virtual PBA".
> Capitaliza el brief `brief-tramix-claude-code.md`, **adaptado al stack real**.

## 0. Decisiones tomadas (Pablo, 2026-06-04)

- **Adaptación de stack — NO negociable**: la plataforma (React 18 + Vite SPA +
  Supabase Edge Functions/Deno + Vercel estático + Cloudflare) **no se toca**.
  La ventana TRAMIX se **adapta** a esta tecnología o **no se implementa**. Es
  un **premium opcional, no vital**. Cero impacto sobre lo existente
  (blindado/auditado). → El "Route Handler de Next.js" del brief se implementa
  como **Supabase Edge Function (Deno)**, 100% aislada.
- **Alcance**: completo (estado + detalle + documentos + cache/cola/breaker +
  modal nativo + salvavidas). "Todo de una", "a fondo".
- **Legal**: avanzar. Los T&C (Disp. 148/06) NO prohíben acceso automatizado;
  sí restringen *reproducir* datos sin autorización (cláusula 4), pero mostramos
  a cada cliente SU propio expediente, con cita de fuente y salvavidas oficial.

## 1. Factibilidad — confirmada EN VIVO (recon real)

- TRAMIX responde **server-to-server** (HTTP 200, Apache-Coyote/Tomcat).
- **Sesión por COOKIE** (`JSESSIONID`, Path=/TRAMIX/, HttpOnly) — **NO por IP**.
  → El proxy desde una Edge Function (una sola IP) funciona; cada consulta usa
  la cookie de la sesión aceptada.
- **Sin captcha** en ningún paso del recorrido.
- **Charset ISO-8859-1** (latin1) → el parser DEBE decodificar latin1 (acentos).
- Sitio **frágil de 2006**: frame-based, JSP + jQuery 1.5, páginas de ayuda
  exportadas de MS Word. El parser necesitará mantenimiento si la DPPJ cambia
  el HTML → de ahí la importancia del salvavidas (`PARSE_ERROR`).

## 2. Flujo de sesión real (mapeado con cookie jar + browser)

| # | Paso | Request | Notas |
|---|---|---|---|
| 1 | Entrada / T&C | `GET /TRAMIX/` | Devuelve form de T&C + setea `JSESSIONID`. |
| 2 | Aceptar T&C | `POST /TRAMIX/jsp/Instrucciones.jsp` body `anonymous=true&chbAccept=on&button=Aceptar` | Marca la sesión como aceptada. Devuelve página de Instrucciones (iframe `Tramix.html` = ayuda Word) con botón **Siguiente**. |
| 3 | Siguiente | `POST /TRAMIX/LoginServlet` (lo dispara "Siguiente") | Lleva a la **página de consulta** ("Consulta de Expedientes"). |
| 4 | Consultar | `GET /TRAMIX/QueryExped?txtLegajo=<legajo>&txtNumero=&txtAnio=&txtDenom=&chbPersonalQuery=&orderBy=LEGAJO` | **¡La consulta funciona por GET!** (los links de orden lo confirman). También hay `POST /TRAMIX/QueryExped` con `txtLegajo`+16 hidden de paginación. **Usamos el GET** (mucho más simple). |
| 5 | Detalle exp. | `GET /TRAMIX/ExpedDetails?o=<oid>&t=EXP&n=<numero>&a=<anio>` | `oid` = id interno del legajo (igual para todas sus filas). |
| 6 | Detalle actuación | `GET /TRAMIX/ActuacionDetails?actIdx=<n>&fromPage=EXPED_DETAILS` | Nivel más profundo; acá viven los documentos descargables. |
| — | Salir | `GET /TRAMIX/LogOut` | Cierra la sesión. |

> ⚠️ El endpoint de consulta es el servlet **`/TRAMIX/QueryExped`**, NO el
> `/TRAMIX/jsp/QueryExped.jsp` (ese, sin la navegación previa, devuelve el muro
> de T&C). Esto invalida el supuesto del brief de pegarle directo al `.jsp`.

## 3. Tabla de resultados — estructura real (legajo 284265, EZEQUIEL CARLOS GOMEZ)

"Se han encontrado **6** expedientes que coinciden con su criterio de búsqueda."

Columnas: `Legajo · Número · Alcance · Denominación · Trámite · Estado · Fecha Ingreso`.
Cada fila tiene un checkbox + el **link de detalle en la columna Número**.

| Legajo | Número (→ detalle_ref) | Denominación | Trámite | Estado | Fecha |
|---|---|---|---|---|---|
| 284265 | EXP 236002/24 → `ExpedDetails?o=21209&t=EXP&n=236002&a=24` | EZEQUIEL CARLOS GOMEZ | ADMINISTRADOR DE CONSORCIOS | INSCRIPTO | 07/03/2024 |
| 284265 | EXP 251553/24 → `…n=251553&a=24` | EZEQUIEL CARLOS GOMEZ | CERTIFICADO DE ACREDITACION | INICIADO | 05/06/2024 |
| 284265 | EXP 276500/24 → `…n=276500&a=24` | EZEQUIEL CARLOS GOMEZ | CERTIFICADO DE ACREDITACION | INICIADO | 04/10/2024 |
| 284265 | EXP 22178/25 → `…n=22178&a=25` | EZEQUIEL CARLOS GOMEZ | CERTIFICADO DE ACREDITACION | OBSERVADO | 29/05/2025 |
| 284265 | EXP 57842/25 → `…n=57842&a=25` | EZEQUIEL CARLOS GOMEZ | RENOVACION DE MATRICULA | INSCRIPTO | 04/12/2025 |
| 284265 | EXP 60733/25 → `…n=60733&a=25` | EZEQUIEL CARLOS GOMEZ | CERTIFICADO DE ACREDITACION | NOTIFICADO OFICIOS | 18/12/2025 |

- **`detalle_ref`** (lo que el parser extrae por fila) = `{ o, t:'EXP', n, a }`.
  Reconstrucción: `/TRAMIX/ExpedDetails?o={o}&t={t}&n={n}&a={a}`.
- Vocabulario de **Estado** observado: `INSCRIPTO`, `INICIADO`, `OBSERVADO`,
  `NOTIFICADO OFICIOS` (lista no cerrada — tratar como texto + mapear a colores
  conocidos, default neutro).
- "No encontrado": mensaje tipo "Se han encontrado **0** expedientes…" (→ `NOT_FOUND`).
- "Descargar resultados a PC": `javascript:buildDownloadList("QueryExped","/TRAMIX")`
  — export de la **tabla** (no es la descarga de un documento). Lo ignoramos
  (re-renderizamos nativo).

## 4. Detalle de expediente — `ExpedDetails` (ej. EXP 22178/25, OBSERVADO)

**Header** (pares etiqueta/valor):
- Legajo: `284265 - EZEQUIEL CARLOS GOMEZ`
- Domicilio: `65 1227` · Partido: `LA PLATA`
- Expediente Nº: `EXP-22178/25 - 4`
- Ingresado el: `29/05/2025`
- Tipo de trámite: `ESPECIAL`
- Trámites: `CERTIFICADO DE ACREDITACION`
- Ubicación actual: `MESA DE ENTRADAS, desde el 13/08/2025`
- Estado: `OBSERVADO`
- Nro. de Resolución / Fecha de Resolución (vacíos en este caso)

**Actuaciones** (las novedades/movimientos). Columnas: `Fecha · Extracto · Estado`.
- `13/08/2025 · OBSERVACION GENERICA (→ ActuacionDetails?actIdx=0&fromPage=EXPED_DETAILS) · FIRMADA`

→ Cada actuación con su `actIdx` puede tener documento(s) en `ActuacionDetails`.

## 5. Documentos descargables — `ActuacionDetails`

- Se llega con `GET /TRAMIX/ActuacionDetails?actIdx=<n>&fromPage=EXPED_DETAILS`
  (en la sesión aceptada).
- **PENDIENTE de Fase 0** (capturar al construir): el patrón exacto del enlace
  del **binario** del documento (URL + `Content-Type` + `Content-Disposition` +
  si hay token por documento). El expediente 284265/EXP-22178 sólo tenía una
  actuación "OBSERVACION GENERICA"; al implementar, capturar un `ActuacionDetails`
  que sí tenga PDF adjunto. El proxy de descarga lo baja server-side y lo
  streamea por HTTPS.

## 6. T&C (Disposición DPPJ 148/06)

- Texto completo capturado (en el `<textarea>` de la entrada) + PDF oficial en
  **`/TRAMIX/reglamento.pdf`**.
- **NO prohíbe acceso automatizado/robots/scraping.** Gratuito y de acceso libre
  (cláusula 3). Cláusula 4: datos "para uso particular… finalidades lícitas…
  no podrán ser reproducidos sin autorización (salvo fines académicos, con cita
  de fuente)". Cláusula 1: meramente informativo, no vinculante, no garantiza
  exactitud/actualización. Cláusula 5: no es en tiempo real (actualización
  periódica). Cláusula 6: pueden suspender el servicio sin aviso.
- Resumen para el ícono "i" del modal: ver brief §4.1 (ya redactado).

## 7. Arquitectura objetivo (adaptada a nuestro stack)

- **Backend** = Edge Function Deno `tramix-consulta` (aislada): maneja sesión/T&C
  (§2), hace los GET a TRAMIX, decodifica latin1, parsea con `deno-dom`, aplica
  cache/cola/throttle/breaker (tablas Supabase) y devuelve el contrato JSON
  (`resultado` enum del brief §6). Acción `detalle` (ExpedDetails) + Edge Function
  `tramix-doc-proxy` para streamear binarios.
- **Tablas Supabase** (con RLS por `user_id`/administración): `tramix_legajo_usuario`,
  `tramix_cache`, `tramix_session` (singleton cookie+T&C), `tramix_throttle`
  (distribuido), `tramix_query_log`, `tramix_documentos_cache` (+ Storage privado).
- **Frontend** = modal en "Mis gestiones" (estados del brief §7), ícono "i",
  salvavidas (deep-link `/TRAMIX/` + legajo copiable). Aislado, additivo.

## 8. Plan de fases (con checkpoint al cierre de cada una)

- **Fase 0 — Reconocimiento** ✅ (este doc). Pendiente menor: patrón binario de
  documento (se cierra al implementar Fase 1, capturando un ActuacionDetails con PDF).
- **Fase 1 — Backend núcleo**: Edge Function `tramix-consulta` (sesión/T&C + GET
  QueryExped + parser tabla con `detalle_ref` + acción ExpedDetails) +
  `tramix-doc-proxy` + taxonomía de errores. Tests del parser con el HTML real
  capturado (284265: encontrado / no-encontrado / T&C-expirada / detalle).
- **Fase 2 — Anti-martilleo**: cache-first + cola serial + throttle distribuido
  (tabla) + cooldown + tope/hora + circuit breaker. Tests de carrera.
- **Fase 3 — Frontend modal**: estados, ícono "i", salvavidas, a11y.
- **Fase 4 — Integración**: tablas + RLS + env vars + base `estado_hash` para
  notificaciones futuras (Resend).

## 9. Riesgos / límites honestos

- **Fragilidad de scraping** sobre sitio gov 2006 → `PARSE_ERROR` → salvavidas.
- Egress del runtime de **Supabase Edge** a `gba.gov.ar:8080` (HTTP, puerto no
  estándar): verificado desde sandbox/curl; **verificar desde el runtime de Edge
  en Fase 1** (si Supabase Edge bloqueara el egress HTTP:8080, el feature NO se
  implementa — premisa de Pablo).
- Datos personales de terceros: sólo se expone a cada cliente SU legajo.
