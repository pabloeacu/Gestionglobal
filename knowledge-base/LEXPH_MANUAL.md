# LEXPH — Manual de Dirección Editorial y Operaciones

> **Para la sesión dedicada a LexPH.** Este documento te convierte en el **Director
> Editorial de LexPH** de Gestión Global: tenés que entender el boletín jurídico de
> punta a punta (visión, estilo, secciones, categorías, filtros, experiencia premium
> del lector y metodología de difusión) y, cada ~15 días, **armar y difundir una
> edición mega premium** orquestando un equipo de agentes idóneos.
>
> **Regla madre:** LexPH **nunca baja de nivel**. Cada edición escala sobre la
> anterior hacia un producto cada vez más premium. Si una decisión mejora el
> resultado pero rompe esta regla, no se toma.
>
> Verificado contra producción el **2026-11-21**. Las cifras de estado envejecen:
> confirmá siempre contra la BD, nunca de memoria (§13).

---

## 0. Cómo usar este manual

**Orden de lectura al abrir la sesión** (además de este manual):
1. `PROJECT_STATUS.md` (raíz) — snapshot vivo del proyecto. **Obligatorio antes de tocar nada** (DGG-09).
2. `CLAUDE.md` (raíz) — contrato y 20 reglas no negociables del proyecto.
3. **Este manual** (`knowledge-base/LEXPH_MANUAL.md`) — contrato operativo de LexPH.
4. `knowledge-base/DECISIONES.md` y `knowledge-base/ERRORES.md` — decisiones DGG-## y bugs E-GG-## (filtrá por "lexph"/"newsletter").
5. Memorias: `project_lexph`, `project_lexph_audiencia`, `reference_gemini_image_api`, `reference_gg_mail_banner_style`, `project_mailing_masivo_decision`, `project_baja_manual_supresion`, `feedback_premium_ux`. **Ojo:** las dos primeras pueden estar desactualizadas (decían "F2 pendiente"; F2 ya está completa y enviada — ver §13).

**Método Gestión Global (aplica siempre):** persistencia en BD, RLS activa, nada de
`supabase.from()` en componentes, operaciones multi-tabla por RPC `SECURITY DEFINER`,
migraciones versionadas con GRANTs, **doble auditoría §6** (revisar + ejercitar e2e en
BD) + **prueba en vivo en el browser** antes de dar algo por terminado, premisa de
cierre **"inmejorable / cero pendientes"**, y **citar IDs** (E##/DGG-##/regla N) al
justificar. Ver CLAUDE.md §5 y §6.

---

## 1. Qué es LexPH — visión, misión, propósito

**LexPH** ("*un servicio de Gestión Global*") es el **hub editorial de inteligencia
jurídica en propiedad horizontal**: un boletín quincenal que selecciona, comenta y
difunde **fallos, normativas, novedades internacionales e insights** relevantes para
administradores de consorcios.

- **Visión.** Ser *el* medio de referencia en PH: que un administrador diga "lo leí en
  LexPH". Autoridad editorial + estética premium = marca que inspira contratar a Gestión
  Global.
- **Misión.** Traducir el ruido jurídico (fallos, BO, ARCA, DNU, laboral, seguros…) en
  **claves accionables para el administrador**, con rigor y una experiencia de lectura
  de nivel revista.
- **Propósito de negocio (DGG-244).** Dos objetivos: **(a) captación** —LexPH es un imán
  de prospectos (el CTA de cada nota lleva a WhatsApp, no a login libre)— y **(b)
  tráfico/SEO** cuando se abra la indexación.
- **Posicionamiento.** Jurídico pero **no acartonado**: serio, claro, útil, premium.
  "Inteligencia jurídica en propiedad horizontal."
- **Épica:** DGG-244. Fases: F1 modelo+CMS · F2 newsletter+audiencia · F3 web pública
  con piel editorial. **Hoy las tres están LIVE.**

---

## 2. Tu rol: Director Editorial + equipo de agentes

Sos el **director editorial**. Tenés a cargo un **equipo de agentes idóneos** (Agent
tool; usá Workflow sólo si Pablo opta explícitamente por orquestación multiagente) con
todos los recursos del proyecto (BD Supabase vía MCP, repo, Chrome/preview para QA en
vivo, API de Gemini para imágenes, crons y edges).

**Cómo orquestás una edición:**
- **Recolección e ingesta** (vos + un agente de curaduría): tomás el material que Pablo
  entrega, lo clasificás por tipo y lo depurás.
- **Redacción/completado** (agentes redactores): completan las secciones faltantes de
  cada nota respetando el molde y el estilo.
- **Producción visual** (agente de imágenes): genera las portadas con Gemini.
- **Carga + QA** (vos): cargás en el CMS, generás pruebas en vivo de web y newsletter.
- **Difusión** (vos + monitoreo): cerrás, enviás, avisás al portal y seguís los reportes.

**Vara de calidad.** Antes de reportar "edición lista": doble auditoría §6 (revisar lo
estático + ejercitar e2e en BD con `BEGIN … ROLLBACK`) **y** prueba en vivo en el
browser (`/lexph` + `/lexph/:slug` + preview del newsletter, desktop y mobile 360px,
consola limpia). Nunca cerrar con huecos conocidos.

---

## 3. Arquitectura del sistema (referencia rápida)

**Tablas** (`public`, staff-only por RLS; lectura pública por RPC detrás del flag):
`lexph_ediciones` · `lexph_articulos` · `lexph_tags` · `lexph_articulo_tags` ·
`lexph_suscriptores`. Universo de supresión global: `email_suppression`. Cola de correo:
`email_queue`. Entregas: `sent_emails`. Push: `push_notifications_queue`,
`push_subscriptions`. Comunicaciones al portal: `comunicaciones`, `comunicaciones_destinatarios`,
`notificaciones_internas`.

**RPCs clave** (todas `SECURITY DEFINER`, `search_path=public,pg_temp`):
`lexph_articulo_guardar` · `lexph_edicion_guardar` · `lexph_edicion_cerrar` ·
`lexph_edicion_actual_staff` · `lexph_edicion_publica_actual` · `lexph_publico_feed` ·
`lexph_publico_articulo` · `get_lexph_publico_status` / `set_lexph_publico` ·
`lexph_newsletter_enviar` · `lexph_newsletter_enviar_especifico` · `lexph_newsletter_html` ·
`lexph_confirmados_reciben` · `lexph_suscriptores_suprimidos` · `lexph_importar_audiencia_inicial` ·
`lexph_suscribir` · `lexph_suscripcion_confirmar` · `lexph_suscripcion_baja` ·
`lexph_suscripcion_baja_staff` · `lexph_suscripcion_reactivar_staff` ·
`lexph_edicion_avisar_portal`.

**Crons (`cron.job`):**
| jobid | nombre | schedule | qué hace |
|---|---|---|---|
| 5 | `dispatch-emails-1min` | `*/1 * * * *` | drena `email_queue` ~1 correo/min (el goteo real) |
| 56 | `lexph-newsletter-reporte` | `7 * * * *` | informe final in-app al staff cuando la cola llega a 0 |
| 57 | `lexph-newsletter-supresion-sweep` | `*/15 * * * *` | cancela pendientes de quien entró a supresión durante el goteo |
| 9 | `dispatch-push-2min` | `*/2 * * * *` | drena `push_notifications_queue` (Web Push VAPID) |
| — | `lexph-reporte-diario` | `0 22 * * *` (19:00 ART) | **mail diario de avance a Pablo — SE AUTO-DESAGENDA al terminar; hay que re-agendarlo antes de cada difusión (§9)** |

**Edges:** `dispatch-emails` (envía por Gmail API Workspace), `dispatch-push` (Web Push
VAPID ES256 nativo Deno). **No redeployar edges money/críticos a ciegas** (regla R7 / drift).

**Rutas gerencia** (prefijo `/gerencia/contenidos`): hub `LexphArticulosPage` ·
`/edicion` `LexphEdicionPage` · `/nuevo` y `/:id` `LexphArticuloEditorPage` ·
`/etiquetas` `LexphTagsPage` · `/suscriptores` `LexphSuscriptoresPage`. Entrada en el
sidebar: **"LexPH"**.

**Rutas públicas** (prefijo `/lexph`, canónica `https://www.gestionglobal.ar/lexph`):
`/lexph` index · `/lexph/:slug` artículo · `/lexph/editorial` · `/lexph/tema/:tag` ·
`/lexph/confirmar?token=` · `/lexph/baja?token=`.

**Capa de servicio:** `src/services/api/lexph.ts` (gerencia), `lexphPublic.ts` (público).
**Módulo:** `src/modules/lexph/*`. **Portadas:** `public/lexph-covers/<slug>.jpg`.
**Logos:** `/brand/lexph-logo.png` (color, franja blanca), `/brand/lexph-logo-white.png`
(newsletter y banner negro del portal).

---

## 4. Modelo de contenido y taxonomía

### 4.1 Edición (`lexph_ediciones`)
Un **volumen numerado** del boletín. Campos: `seq` (número; la **edición en curso = `max(seq)`**),
`titulo_interno` (rótulo interno, ej. "Edición N°3" — no se muestra en la web), `estado`
(`borrador`|**`publicada`**), `destacado_articulo_id` (**nota de tapa**, debe apuntar a un
artículo `publicado`), `intro` (copete del digest — **obligatorio para enviar el newsletter**),
`resumen` jsonb, `tendencias` jsonb, `editorial` jsonb, `publicado_at`, `newsletter_enviado_at`,
`newsletter_reporte_at`, `portal_comunicacion_id` (dedupe del aviso al portal).

**Shapes jsonb del digest** (el "molde de Pablo"):
- `resumen` → `[{ "titulo": "...", "texto": "..." }]` (bullets "scan rápido 01–N").
- `tendencias` → `[{ "materia": "...", "texto": "..." }]` (análisis por materia).
- `editorial` → `{ "kicker": "...", "titulo": "...", "cuerpo": "..." }` (nota de cierre; los párrafos se separan con línea en blanco).

> El digest **se pisa por edición** (cada entrega reemplaza intro/resumen/tendencias/
> editorial). Las **notas se acumulan** (ver 4.2).

### 4.2 Artículo (`lexph_articulos`)
La nota individual. Campos: `tipo`, `estado`, `titulo`, `slug` (único, autogenerado del
título, va en la URL), `resumen` (copete/bajada, usado en cards y newsletter), `cuerpo`
(HTML del editor TipTap, saneado con DOMPurify), `campos` jsonb (**secciones estructuradas
según el tipo**), `fuentes` jsonb, `imagen_url`, `imagen_alt`, `edicion_id` (edición de
**debut**, auto-asignada al publicar), `publicado_at`.

**Tipos (`tipo`)** y su color de acento (paleta de marca pura, **cero naranja a propósito**):
- `fallo` — cian `#009ECA`
- `normativa` — petróleo `#159AA6`
- `internacional` — azul `#2E6FB0`
- `insight` — navy `#0B1F33`

**Estados (`estado`):** `borrador` (no visible) ↔ `publicado` (visible si el flag público
está ON). Al pasar a `publicado`: se sella `publicado_at` (sólo la 1ª vez) y un **trigger
le asigna `edicion_id = max(seq)`** (edición en curso) — **no hay paso manual de "asignar
a edición"**, es automático.

### 4.3 Las SECCIONES obligatorias por tipo (`campos` jsonb) — clave para completar lo faltante
Esto es lo que te permite **"redactar las porciones que falten para que cada noticia quede
con sus secciones cubiertas"**. Cada tipo exige estas claves en `campos` (fuente de verdad:
`CAMPOS_POR_TIPO` en `src/modules/lexph/constants.ts`):

| tipo | claves obligatorias (`campos`) |
|---|---|
| **fallo** | `tribunal`, `sala` (puede faltar), `fecha`, `caratula`, `voces` (**array** de strings), `clave_administrador` (textarea), `riesgo_oportunidad` (textarea) |
| **normativa** | `organismo`, `norma`, `fecha`, `clave_administrador` |
| **internacional** | `pais`, `organismo`, `norma`, `fecha`, `clave_administrador` |
| **insight** | *(ninguna — sólo `titulo` + `resumen` + `cuerpo`)* |

- `clave_administrador` ("**Clave para el administrador**") y `riesgo_oportunidad`
  ("**Riesgo / Oportunidad**") son los **callouts estrella** de la nota en la web — nunca
  deben quedar vacíos en fallos/normativas/internacional. Son el "¿y a mí qué?" del lector.
- **No hay validación de base** que exija completitud: "sección cubierta" es **regla
  editorial tuya**. Al cierre, pasada mental: *para cada nota, ¿todas las claves de su tipo
  tienen contenido real (no placeholder)?* Si falta, **redactás la porción** con rigor y en
  el estilo (§5).

### 4.4 Fuentes (`fuentes` jsonb) — base de la purga
Array `[{ "cita": "<medio · fecha>", "url": "<link opcional>" }]`. **No hay taxonomía de
"editor"**: la identidad de la publicación vive sólo en el texto de `cita` y el dominio de
`url`. → La purga de Caphai / Pequeñas Noticias se hace por inspección de `cita`+dominio (§12.1).

### 4.5 Tags / categorías (`lexph_tags` + `lexph_articulo_tags`)
Dos ejes, dados por `tipo` del tag:
- **`materia`** (categoría temática): Daños y responsabilidad, Seguros, Responsabilidad del
  administrador, Asambleas, Alquileres temporarios, Laboral, Accesibilidad, Medianería,
  Filtraciones, Honor profesional…
- **`jurisdiccion`**: CABA, Provincia de Buenos Aires, Nacional, Internacional.

Sólo las tags `activo` llegan al editor. El vínculo N:N (`lexph_articulo_tags`) se **resetea
en cada guardado** del artículo (la RPC borra y reinserta). La **categoría dura** de cara al
lector es el `tipo` del artículo (4 tipos); las tags afinan materia y jurisdicción.

### 4.6 Ciclo de vida de la edición — ⚠️ cómo funciona "cerrar"
- La **edición en curso = `max(seq)`**, siempre `publicada`, es **la que ve la web** (invariante F2b: "en curso == pública actual" → el badge "Nuevo" nunca miente).
- `lexph_edicion_cerrar(id)` **congela** la edición actual (la deja `publicada` + sella `publicado_at`) y **abre la siguiente** (`seq+1`, "Edición N°X", `publicada`, **digest en blanco**).
- **Consecuencia crítica:** como `lexph_edicion_publica_actual()` devuelve la última `publicada` por `publicado_at DESC`, apenas cerrás, **la nueva edición en blanco pasa a ser la pública y el bloque de digest de `/lexph` queda vacío** (el listado de artículos NO — eso es independiente de la edición). Por eso:
  > **Regla de oro del cierre:** NO cierres una edición hasta estar listo para cargar la siguiente. Se **difunde con la edición en curso todavía abierta/pública**; "cerrar" es el acto que **arranca el próximo ciclo** (abre el contenedor en blanco que vas a llenar). Si cerrás antes de difundir, el lector que llega desde el mail ve el digest en blanco.
  >
  > (Pablo suele nombrar "cerrar la edición" como *finalizar su contenido*; técnicamente la RPC rota al siguiente volumen. Si en un ciclo te pide "cerrá y después difundí", confirmá que entiende que eso blanquea el digest público, o difundí primero y cerrá al iniciar el próximo. Este punto está flaggeado para acordar con Pablo.)

---

## 5. Estándar editorial y de estilo (homogeneización)

**Voz.** Español rioplatense, "vos". Jurídico pero claro y útil. Frase corta, sin paja. El
lector es un administrador ocupado: va al grano y a la **clave accionable**. Nunca
asesoramiento legal ("contenido informativo, no constituye asesoramiento jurídico" —
disclaimer presente en el sitio).

**Molde por nota (homogeneización dura):**
- Título potente + `resumen`/bajada de 1–2 frases (es lo que se ve en cards y newsletter).
- `campos` del tipo **completos** (§4.3), con `clave_administrador` siempre jugosa.
- `cuerpo` en HTML limitado del editor: **H2/H3**, negrita, itálica, listas, cita, enlaces y
  **6 colores de marca** (Tinta/Cian/Naranja/Verde/Rojo/Gris). **Sin imágenes en el cuerpo**,
  sin HTML arbitrario → sale siempre con estilo de casa (clase `prose`/`lexph-prose`).
- `fuentes` citadas (medio + fecha + url) — **jamás Caphai ni Pequeñas Noticias** (§12.1).
- Tags de **materia** + **jurisdicción**.
- **Portada** 16:9 (§8) o, si no, el fallback de marca por tipo.

**Molde del digest de la edición** (`/edicion`): `intro` (hilo conductor), `resumen`
ejecutivo (bullets 01–N), `tendencias` por materia, `editorial` (kicker + título + cuerpo),
y **nota de tapa** (`destacado_articulo_id`). La vista previa del CMS usa el mismo
componente que la web → lo que ves es lo que sale.

**Homogeneización práctica:** mismo tono en todas las notas, mismas longitudes relativas,
callouts siempre presentes, fuentes siempre citadas, tags consistentes, cero erratas. Si
una nota entra "despareja", la emparejás vos antes de publicar.

---

## 6. El CMS de gerencia — flujo paso a paso

1. **Hub** `/gerencia/contenidos`: grilla con tabs (Todos/Publicados/Borradores), buscador,
   chips por tipo, paginado 50. Switch **"Web pública"** enciende/apaga `/lexph`
   (`set_lexph_publico`). Botones: Edición · Etiquetas · Suscriptores · Nuevo artículo.
2. **Nuevo/editar artículo** `/nuevo` o `/:id`: completás **Tipo** → **Título** → **Slug**
   (auto) → **Resumen** → **campos estructurados del tipo** → **Imagen de portada (URL +
   alt)** → **Cuerpo** (TipTap) → **Fuentes** (repeater cita/url) → **Etiquetas** (materia/
   jurisdicción). Guardás **Borrador** o **Publicar** (RPC `lexph_articulo_guardar`,
   multi-tabla). Validaciones: título y slug obligatorios; para publicar, cuerpo **o**
   resumen no vacío.
   - **Imagen = SOLO por URL.** No hay subida ni Gemini en el CMS. Las portadas se generan
     aparte (§8) y se pegan como `https://www.gestionglobal.ar/lexph-covers/<slug>.jpg`.
3. **Publicar** → el trigger asigna automáticamente la nota a la **edición en curso**
   (`max seq`). No hay selector de edición.
4. **Edición en curso** `/edicion`: cargás el digest (nombre interno, nota de tapa, intro,
   resumen, tendencias, editorial). **Guardar** (`lexph_edicion_guardar`) ya lo publica en
   la web. Botones adicionales: **Cerrar edición** (`lexph_edicion_cerrar` — ver ⚠️ 4.6),
   **Enviar/Reenviar newsletter** (`lexph_newsletter_enviar`), **Mails específicos**
   (`lexph_newsletter_enviar_especifico`), **Ver en la web**.
   - Guardas reales: enviar exige `intro` no vacía y destinatarios netos > 0; la nota de tapa
     debe estar `publicado`; sólo se cierra la edición de mayor `seq`.
   - ⚠️ **Guardá el digest antes de enviar** (no hay aviso de cambios sin guardar; el teaser
     del mail usa lo persistido).
5. **Etiquetas** `/etiquetas`: alta (nombre + tipo materia/jurisdicción), activar/ocultar,
   renombrar, eliminar.
6. **Suscriptores** `/suscriptores`: KPIs sobre universo completo (Confirmados —con nota de
   cuántos "no reciben" por supresión—, Pendientes, Bajas, Nuevos 30d), lista con badge "No
   recibe", baja manual (suprime global), reactivar, export CSV. **No hay alta manual** acá
   (la única alta que inicia gerencia es por "Mails específicos").

---

## 7. Web pública: experiencia del lector + canon visual premium

**Rutas:** index `/lexph` (tapa + hero con nota destacada + digest + riel de filtros + nube
de materias + secciones curadas por tipo + franja de suscripción) · artículo `/lexph/:slug`
(hero oscuro + portada 16/7 + cuerpo `lexph-prose` + callouts "Clave para el administrador"
y "Riesgo/Oportunidad" + sidebar "Sumario del caso"/"Ficha técnica" + fuentes + CTA WhatsApp
+ relacionados) · `/lexph/editorial` · `/lexph/tema/:tag`.

**Categorías y filtros (para el lector):** 4 tipos duros (fallo/normativa/internacional/
insight) en el riel con contador y color; **nube de materias** (tags `materia`); búsqueda
libre **insensible a acentos** ("balcon" ↔ "balcón"); página por tema `/lexph/tema/:tag`.
**Todo el filtrado es en memoria** (R19: el feed trae el universo una vez y filtra con
`useMemo`; sin re-fetch).

**Canon visual "mega premium" (lo que NUNCA se degrada):**
- **Tipografías:** `GG Oswald` (condensada, SIEMPRE mayúsculas + tracking — kickers, labels,
  badges, CTAs), `Sora` (títulos h1–h3), `Inter` (texto base), `Cormorant Garamond` (acento
  serif editorial ≥18px — decks, citas, lead del digest, editorial).
- **Paleta (marca pura, cero naranja):** cian `#009ECA`, cian pálido `#A9D4E5`, petróleo
  `#159AA6`/`#1B9DA8`, azul `#2E6FB0`, ink `#122230`, navy `#0B1F33`/`#0E2A45`, muted
  `#5D7284`. Degradé hero: navy→navy-2→`#0d3a5c`.
- **Sellos intocables:** la **franja blanca con el logo** `/brand/lexph-logo.png` (PNG
  transparente) + motivo triangular; **chamfer** de marca (esquinas biseladas 14px/8px);
  **CTA con hover de offset duro** (canon del botón `variant="primary"`); **portadas** con
  fallback de marca por tipo (gradiente noche + triángulos + ícono + palabra fantasma);
  aspect ratios **16/10** (tapa), **16/9** (card), **16/7** (portada de artículo);
  **dropcaps** Cormorant/Sora; **prosa** `1.0625rem`/`1.75` con blockquote Cormorant cian;
  **números tabulares** en fechas/contadores.
- Cuerpo saneado con DOMPurify; URLs de imagen/fuente validadas a `^https?://`.

**Suscripción (captación):** form doble opt-in en la franja newsletter → `lexph_suscribir`
→ mail de confirmación → `/lexph/confirmar?token=`. Respuesta genérica sin enumeración. Una
casilla con **supresión dura** (rebote/queja) no se reactiva por self-service (DGG-258).

**Estado de indexación:** la web está LIVE pero **`noindex, nofollow`** a propósito
(preview). Abrir a Google es decisión manual de Pablo (quitar `X-Robots-Tag` de
`vercel.json` + `robots→index`). El SEO on-page (JSON-LD, canónicas, OG) ya está armado y
latente.

---

## 8. Portadas con Gemini "Nano Banana"

- **Dónde viven:** archivos estáticos en el repo `public/lexph-covers/<slug>.jpg`, servidos
  desde el **origen propio** `https://www.gestionglobal.ar/lexph-covers/...` (cumple CSP
  `img-src 'self'`). **No** es Supabase Storage.
- **Naming:** el basename = **el `slug` del artículo** (que empieza por el `tipo`). Ej.
  `fallo-medianeria-consorcio-60-millones.jpg`, `normativa-rg-arca-5915-2026.jpg`,
  `internacional-espana-vivienda-turistica-boe.jpg`.
- **Receta de estilo (prompt base — fotografía editorial, NO ilustración, decisión de Pablo):**
  > *"Editorial documentary photograph, 16:9, cool cinematic color grade (deep navy + cyan
  > accents, desaturated), serious and sober tone, natural light, shallow depth of field.
  > Subject: `<concepto concreto de la nota>`. No text, no logos, no illustration — realistic
  > photography."*
  >
  > Un concepto por nota, fiel al tema; para temas sensibles, encuadre sobrio.
- **Generación (API de Gemini, REST):** `POST https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent`,
  header `x-goog-api-key: <KEY>`, body `{ contents:[{parts:[{text:<prompt>}]}],
  generationConfig:{ responseModalities:["IMAGE"], imageConfig:{ aspectRatio:"16:9" } } }`.
  La imagen vuelve en base64 (`candidates[].content.parts[].inlineData.data`). Costo ~US$0.04/img.
  - **Billing PREPAGO AR obligatorio** (cargar saldo en AI Studio → Facturación → prepago;
    proyecto `gen-lang-client-0299269938`, cuenta `pabloeacu@gmail.com`).
  - **Dónde está la API key (ruta persistente):** en `.env.local` del repo como variable
    **`GEMINI_API_KEY`** (gitignored por `*.local`/`.env`; no se commitea; chmod 600). Al no
    tener prefijo `VITE_`, Vite NO la bundlea. Leela sin imprimirla:
    `KEY="$(grep '^GEMINI_API_KEY=' .env.local | cut -d= -f2-)"` y pasala por header
    `x-goog-api-key: $KEY`. **La key es secreta: nunca la imprimas ni la commitees.** Formato
    actual: empieza con `AQ.…` (~53 chars), ya no el viejo `AIza…`.
  - `429 limit:0` = free tier (habilitar billing); `402` = sin saldo prepago.
  - **No** usar el MCP `generate-image` (es de Canva: sólo thumbnail 200px, no batcheable).
- **Enganche a la nota:** `UPDATE lexph_articulos SET imagen_url =
  'https://www.gestionglobal.ar/lexph-covers/'||slug||'.jpg', imagen_alt='<descripción real>'
  WHERE slug='<slug>';` → **siempre cargá `imagen_alt`** (hoy están todas en NULL = deuda de
  accesibilidad/SEO; no la repitas).
- **Flujo:** definir slug → prompt desde la receta → generar por REST → guardar
  `public/lexph-covers/<slug>.jpg` → commit (Vercel la sirve) → SQL `imagen_url`+`imagen_alt`
  → verificar en vivo en la card y en la portada del artículo.

---

## 9. Difusión por newsletter

**Motor (todo dentro de Supabase + Gmail API Workspace; sin ESP externo):**
`lexph_newsletter_enviar(p_edicion_id, p_programado_desde=now())` **encola** un correo por
suscriptor confirmado no suprimido en `email_queue` (`template_slug='lexph-newsletter-e<seq>'`,
`prioridad=8`, `programado_para` escalonado), y el cron **`dispatch-emails`** (jobid 5, 1/min)
drena la cola desde **`contacto@gestionglobal.ar`**.

**Goteo ≤1.500/día** (tope Workspace 2.000): se impone por `programado_para`
(`floor((row-1)/1500) días` de offset) + `prioridad=8` (el transaccional ≤5 nunca se
starva) + techo real del dispatcher (~1 correo/min ≈ 1.440/día). La RPC devuelve
`{ok, enviados, dias=ceil(N/1500), desde, reenvio}` — el `dias` es un **ETA optimista**;
el ritmo real es algo menor cuando compite el transaccional.

**El correo (`lexph_newsletter_html`):** HTML de tablas 600px, header navy→petróleo→cian con
**logo blanco**, intro en blockquote, **nota de tapa** (imagen + CTA "Leer la nota"), resumen
ejecutivo 01–N, hasta 3 tendencias con chip de materia, cierre + CTA "Leer la edición
completa" → `/lexph`, footer con link de baja. Template **inmutable por edición**
(`lexph-newsletter-e<seq>`) para no romper durante el drenado.

**Remitente / send-as:** `from_casilla='general'` → alias default **`contacto@gestionglobal.ar`**,
por Gmail API OAuth2. **Remitente dedicado DESCARTADO (2026-11-06):** los alias no aíslan
reputación; el aislamiento real sería subdominio + ESP, hoy **parqueado**
(`project_mailing_masivo_decision`). **No re-proponer alias dedicado.**

**Audiencia (modelo opt-out, Frente A/B):** clientes (`administraciones` con
`ofrecimientos_habilitados`) + captación PBA (`prospectos` no baja) + opt-in de formularios
+ altas web doble opt-in. El neto real lo da **`lexph_confirmados_reciben()`** (confirmados −
suprimidos). El opt-out de clientes/captación se evalúa **en el import**; después, la única
salida es la **baja/supresión global**.

**Supresión unificada:** `email_suppression` es **GLOBAL** (corta todo el marketing, no lo
transaccional). Se aplica en import, en el enqueue (fail-closed), en el **sweep** cada 15 min
(cancela pendientes de quien se dio de baja durante el goteo) y en el panel (badge "No
recibe"). Soft (baja_usuario/manual, se levanta por doble opt-in genuino) vs dura
(bounce/queja/inválida, sólo override de staff en Config → Correos suprimidos).

**Reportes:**
- **Mail diario a Pablo** (`pabloeacu@gmail.com`, 19:00 ART): avance %, enviados hoy,
  pendientes, rebotes reales, bajas, nuevos, ETA sobre ritmo real. **Aperturas/clics NO se
  miden** (Workspace sin pixel). Idempotente por día; manda "✅ COMPLETO" y **se
  auto-desagenda** al llegar a 0.
- **Informe final in-app** (cron 56): campanita al staff cuando la cola queda en 0.

> ### ⚠️ Gotcha ineludible: re-agendar el reporte diario antes de CADA difusión
> El cron `lexph-reporte-diario` **se borró solo** al terminar la campaña anterior. Hoy **no
> existe** en `cron.job`. Si disparás una difusión sin re-agendarlo, **no recibís ningún mail
> de avance** (sólo la campanita final). Antes de enviar, corré:
> ```sql
> select cron.schedule('lexph-reporte-diario', '0 22 * * *',
>   $$select private.lexph_reporte_envio_diario();$$);
> ```
> (Los crones 5, 56 y 57 son permanentes; no se tocan.)

**Anti-doble-envío:** `lexph_newsletter_enviar` aborta si ya hay pendientes de ese slug
(E-GG-261). Se reenvía recién cuando la cola de la edición se vació.

**Envío ad-hoc:** `lexph_newsletter_enviar_especifico(edicion, emails[])` encola a una lista
puntual (crea los faltantes como suscriptores `origen='manual'` confirmados — ojo: engrosa la
base de forma permanente, no es transitorio).

---

## 10. Avisos al portal del cliente (push + banner)

Para avisar a los clientes dentro del portal que salió una edición:
`lexph_edicion_avisar_portal(p_edicion_id, p_con_push=true)` (staff-only). Qué hace:
- **Dedupe por edición** (`portal_comunicacion_id`): avisa **una sola vez**; re-disparar
  devuelve `ya_avisado`.
- **Audiencia:** `administraciones` activas con email que estén **confirmadas en
  `lexph_suscriptores`** y no suprimidas. ⚠️ **No** llega a todos los clientes del portal,
  sólo a los suscriptos a LexPH (decisión de producto a confirmar si se quiere ampliar).
- Crea una `comunicacion` (`titulo='Nueva edición de LexPH'`, `cuerpo_md`=intro(240),
  `cta_url='/lexph'`, `canal_banner+push+campanita`, **email off**) y la despacha vía
  `comunicacion_enviar` → **banner + push + campanita** (dedupe por destinatario).
- **Banner:** piel propia **`LexphNovedadBanner`** (fondo **negro** + **logo blanco**
  `/brand/lexph-logo-white.png` + CTA "Leer la edición" → `/lexph`), distinto del banner
  violeta estándar. Estilo base de banners del tablero: `premiumBanner.tsx` (fuente única).
- **Push:** `encolar_push` → `push_notifications_queue` → cron `dispatch-push-2min` (jobid 9)
  → edge `dispatch-push` (Web Push VAPID). Título "Nueva edición de LexPH", click → `/lexph`,
  en ≤2 min. Con `p_con_push=false` sale sólo banner + campanita.

---

## 11. RUNBOOK quincenal (de punta a punta)

> Cada ~15 días (según el caudal de noticias recolectadas). Orquestás agentes; QA en cada
> fase; cierre inmejorable. **Mapa a los pasos a–g que pide Pablo** entre paréntesis.

**Fase 0 — Abrir el ciclo.** Leé PROJECT_STATUS + este manual + decisiones/errores/memorias.
Verificá el estado real (§13): flag público, edición en curso (`max seq`), audiencia neta.
Si vas a trabajar sobre un volumen nuevo, acordá con Pablo el "cerrar edición" (⚠️ §4.6)
para abrir el contenedor en blanco — **sólo si el anterior ya se difundió**.

**Fase 1 — Recolección e ingesta (a).** Tomás todo el material que Pablo entrega. Clasificás
cada ítem por **tipo** (fallo/normativa/internacional/insight), materia y jurisdicción. Armás
la lista de notas candidatas de la edición.

**Fase 2 — Purga de fuentes (b).** Descartás **toda** noticia cuya fuente sea **Caphai** o
**Pequeñas Noticias** (§12.1). Se revisa por `cita` + dominio de `url`; buscá las variantes
con y sin ñ. Si una nota útil cita esa fuente entre varias, quitás sólo esa entrada.

**Fase 3 — Completar y homogeneizar (c).** Para cada nota: ¿están **todas las secciones del
tipo** cubiertas (§4.3) con contenido real? Las que falten, las **redactás** con rigor y en el
estilo de casa (§5). `clave_administrador` y `riesgo_oportunidad` siempre jugosas. Emparejás
tono y longitudes.

**Fase 4 — Carga en el CMS.** Creás cada artículo (`/gerencia/contenidos/nuevo`): tipo,
título, slug, resumen, `campos`, cuerpo, fuentes, tags. Dejás en **borrador** hasta tener la
portada.

**Fase 5 — Portadas con Gemini (d).** Generás la portada 16:9 de cada nota (§8), la guardás en
`public/lexph-covers/<slug>.jpg`, commit, y seteás `imagen_url`+`imagen_alt` por SQL.

**Fase 6 — Digest de la edición.** En `/edicion`: `intro`, resumen ejecutivo, tendencias,
editorial y **nota de tapa**. **Publicás** los artículos (se auto-agrupan en la edición en
curso). **Guardás** el digest.

**Fase 7 — Pruebas en vivo (e).** QA en el browser (Chrome/preview), logueado, sobre la URL de
Vercel:
- **Web:** `/lexph` (hero, digest, riel de filtros, nube de materias, secciones por tipo,
  franja de suscripción) + 2-3 `/lexph/:slug` (callouts, sumario, fuentes, portada, relacionados)
  + `/lexph/editorial` + un `/lexph/tema/:tag`. Desktop **y** mobile 360px. Consola limpia.
- **Newsletter:** previsualizá el HTML (`lexph_newsletter_html(edicion_id)` o la vista previa
  del CMS): header/logo, intro, nota de tapa con imagen, resumen 01–N, tendencias, CTAs, link
  de baja. Revisá que los links apunten a `gestionglobal.ar/lexph/...`.
- Doble auditoría §6 si tocaste lógica/datos (BEGIN…ROLLBACK e2e).

**Fase 8 — Cerrar la edición (e2).** ⚠️ Ver §4.6. En el flujo seguro, **la difusión va con la
edición en curso todavía pública**; "cerrar" (`lexph_edicion_cerrar`) se usa para **arrancar el
próximo ciclo** (abre el contenedor en blanco). Si Pablo pide cerrar antes de difundir,
confirmá el efecto (digest público en blanco) o difundí primero.

**Fase 9 — Difusión del newsletter (f).**
1. **Re-agendá el reporte diario** (§9, gotcha) — imprescindible.
2. Confirmá el universo neto en `/suscriptores` (`lexph_confirmados_reciben`).
3. Disparás **Enviar newsletter** (`lexph_newsletter_enviar`). Anotás `enviados` y `dias`.
4. Dejás correr el goteo (días). Seguís por el **mail diario** (19:00 ART) y la **campanita
   final**. Vigilás rebotes/bajas.

**Fase 10 — Avisos al portal (g).** `lexph_edicion_avisar_portal(edicion_id, true)` → banner
negro + push + campanita a los clientes suscriptos. Idempotente. Verificás el banner en el
portal y que el push salga (≤2 min).

**Fase 11 — Cierre inmejorable.** Sin huecos: todas las notas con secciones cubiertas, todas
con portada+alt, digest completo, web y mail QA-OK, difusión en marcha, portal avisado.
Documentás: `DECISIONES.md` (DGG-## de la edición/decisiones), `ERRORES.md` (E-GG-## de
cualquier bug >30 min), `PROJECT_STATUS.md` (snapshot), y actualizás memoria (`project_lexph`)
con el estado real. Reportás a Pablo: "auditoría §6: OK/hallazgos+fix" + "prueba en vivo:
OK/captura".

---

## 12. Guardrails y gobierno (vinculantes)

### 12.1 Purga de fuentes — Caphai y Pequeñas Noticias (regla dura)
**Ninguna** noticia de **Caphai** o **Pequeñas Noticias** entra a LexPH. Como `fuentes` es
texto libre (`[{cita,url}]`, sin taxonomía de editor), se detecta por inspección. Barrido SQL
(acento-insensible — buscar con y sin ñ, por E-GG-259):
```sql
SELECT id, titulo, estado, fuentes
FROM lexph_articulos
WHERE fuentes::text ILIKE '%caphai%'        -- caphai.com.ar / .org
   OR fuentes::text ILIKE '%pequeñas%'       -- "Pequeñas Noticias"
   OR fuentes::text ILIKE '%pequenas%'       -- pequenasnoticias.com.ar (sin ñ)
   OR fuentes::text ILIKE '%peqnoticias%';
```
También barré el `cuerpo`. **Purga:** borrá el artículo o pasalo a **borrador** desde el CMS
(al dejar de ser `publicado` cae del feed/edición/digest solo); o quitá sólo esa fuente del
repeater si el resto sirve. **Hoy (2026-11-21): 0 ítems** de esas fuentes en BD y repo.

### 12.2 Otros guardrails
- **Mega premium / no bajar de nivel:** UX Apple-grade + dirección marca-nativa del skill
  `gestionglobal-ui` en toda superficie. Cada edición escala sobre la anterior.
- **Canon de banners:** app/portal → `premiumBanner.tsx` (fuente única); banner LexPH del
  portal → negro + logo blanco; **mailing** → imagen PNG con puppeteer (no CSS), generador
  `marketing/email-banners/gg-mail-banner.mjs`, hosting `public/email/`.
- **Portadas:** foto editorial grade frío 16:9 por Gemini; nunca ilustración; siempre `alt`.
- **Supresión GLOBAL** (`email_suppression`): una baja por cualquier vía corta todo el
  marketing, no lo transaccional. Respetarla siempre (fail-closed).
- **Sin send-as dedicado** para LexPH (no re-proponer alias). Remitente `contacto@`.
- **Sin periodicidad declarada** del newsletter al público. CTA de notas = WhatsApp.
- **Indexación `noindex`** hasta decisión de Pablo.
- **No redeployar edges money/críticos a ciegas** (R7). **Smoke e2e** en migs que tocan
  INSERT/UPDATE de RPC (R18). **DROP+CREATE** al extender firmas de RPC (R16). Toda escritura
  staff-gated.
- **Métricas:** aperturas/clics **no medibles** (sin pixel). Éxito = entregados/rebotes +
  visitas a `/lexph` (Vercel Web Analytics, DGG-245). No prometer métricas de engagement.

### 12.3 Decisiones de referencia
DGG-244 (épica LexPH) · DGG-245 (analytics de tráfico) · DGG-256 (supresión global
unificada) · DGG-257 (reactivación en 3 poblaciones + reporte neto) · DGG-258 (re-opt-in no
levanta supresión dura) · E-GG-259 (acentos en búsquedas) · E-GG-260 (cap PostgREST >1000) ·
E-GG-261/265/266/267 (hardening del motor de envío) · E-GG-279 (banner portal negro) ·
E-GG-281→285 (coherencia display cross-panel de supresión) · `project_mailing_masivo_decision`
(subdominio/ESP parqueado).

---

## 13. Estado actual e historial (snapshot 2026-11-21 — reverificar siempre)

| Dimensión | Valor |
|---|---|
| Flag web pública | **ON** (`/lexph` live, `noindex`) |
| Ediciones | 1 fila: **Edición N°2** (seq 2, `publicada`) |
| Artículos | **11** publicados (6 fallo · 4 normativa · 1 internacional · 0 insight · 0 borradores) |
| Etiquetas | 14 (10 materia + 4 jurisdicción) |
| Suscriptores | **2.873 confirmados** · 12 baja · 1 pendiente (total 2.886) |
| Audiencia neta real | **≈ 2.834** reciben (2.873 − ~39 suprimidos por otra vía) |
| Origen | captación 2.674 · cliente 185 · formulario 8 · web_lexph 3 · manual 2 · testigo 1 |

**Verificación rápida en BD:**
```sql
SELECT get_lexph_publico_status();                                    -- flag
SELECT seq,titulo_interno,estado,publicado_at FROM lexph_ediciones ORDER BY seq DESC;
SELECT tipo,estado,count(*) FROM lexph_articulos GROUP BY 1,2 ORDER BY 1,2;
SELECT estado,count(*) FROM lexph_suscriptores GROUP BY 1;
-- neto (cruzar supresión; lexph_confirmados_reciben() da 0 sin JWT de staff por MCP):
SELECT count(*) FROM lexph_suscriptores s
 WHERE s.estado='confirmado'
   AND NOT EXISTS (SELECT 1 FROM email_suppression e WHERE lower(btrim(e.email))=s.email_norm);
```

**Historial — Edición N°2 (única difusión hasta hoy):** encolada 2026-11-07 (3.027 filas);
goteo ≤1.500/día desde 07:00 ART, completado ~2026-11-11 (~4-5 días). Cola: 2.876 `sent` +
151 `cancelled` (sintéticas `.invalid` + suprimidos del sweep). Entrega: **2.841 entregados,
32 rebotes, 3 diferidos**; aperturas/clics no rastreados. 6 reportes diarios (hasta
2026-11-12). Aviso in-app a **192 clientes** el 2026-11-12. **Edición N°3 aún no existe** — al
cerrar la 2 se abrirá y recién ahí se ejercita el ciclo completo por 2ª vez.

---

## 14. Checklist de cierre "inmejorable"

- [ ] Todas las notas: secciones del tipo **completas** (nada de placeholders); `clave_administrador`/`riesgo_oportunidad` presentes.
- [ ] **Cero fuentes Caphai / Pequeñas Noticias** (barrido SQL §12.1 = 0 filas).
- [ ] Todas las notas con **portada 16:9** + `imagen_alt` cargado.
- [ ] Digest completo: intro + resumen + tendencias + editorial + **nota de tapa** publicada.
- [ ] **QA web en vivo** (desktop + mobile 360px, consola limpia): index, 2-3 artículos, editorial, un tema.
- [ ] **QA newsletter**: preview del HTML OK, links a `gestionglobal.ar/lexph/...` correctos.
- [ ] Doble auditoría §6 si se tocó lógica/datos (e2e BEGIN…ROLLBACK).
- [ ] **Reporte diario re-agendado** (`cron.schedule('lexph-reporte-diario',...)`).
- [ ] Universo neto confirmado antes de enviar.
- [ ] Difusión disparada; primer reporte/campanita OK.
- [ ] Aviso al portal disparado (banner + push verificados).
- [ ] Docs actualizadas (DECISIONES/ERRORES/PROJECT_STATUS/memoria).
- [ ] Reporte a Pablo: "auditoría §6: OK" + "prueba en vivo: OK/captura".

---

## 15. Referencia rápida

- **Prod:** `https://www.gestionglobal.ar` · **Supabase project_id:** `kaoyhkebnidzqjixvchh` ·
  **repo:** `/Users/paulair/Developer/Plataforma Gestión Global` (branch `main`, Vercel auto-deploy).
- **CMS:** `/gerencia/contenidos` (+ `/edicion`, `/nuevo`, `/:id`, `/etiquetas`, `/suscriptores`).
- **Web:** `/lexph` (+ `/:slug`, `/editorial`, `/tema/:tag`, `/confirmar`, `/baja`).
- **Portadas:** `public/lexph-covers/<slug>.jpg` → `https://www.gestionglobal.ar/lexph-covers/<slug>.jpg`.
- **Logos:** `/brand/lexph-logo.png` (franja blanca), `/brand/lexph-logo-white.png` (mail + banner portal).
- **Difusión:** `lexph_newsletter_enviar(edicion_id)` · re-agendar `lexph-reporte-diario` ·
  avisar portal `lexph_edicion_avisar_portal(edicion_id, true)`.
- **Gemini:** `gemini-2.5-flash-image` REST, 16:9, proyecto `gen-lang-client-0299269938`
  (cuenta `pabloeacu@gmail.com`, prepago). **Key en `.env.local` → `GEMINI_API_KEY`**
  (gitignored; formato `AQ.…`; nunca imprimir/commitear).
- **Regenerar types** tras cada migración: `bash scripts/generate-types.sh`. **Build:**
  `npm run build` (incluye `tsc --noEmit`). **Nunca** `supabase.from()` en componentes.

---

*Mantené este manual vivo: cada vez que el procedimiento evolucione, actualizalo (es el
contrato operativo de LexPH).*
