# Propuestas Punto 5 · Pulido premium aspectos nuevos

> Fecha: 2026-05-21
> Alcance: módulos que entraron en rondas 5/5.5/6 (Solicitudes, Trackings, Agenda
> unificada, Formularios admin + público, Acceso externo, Vencimientos).
> Modo: documento de propuesta. El usuario elige qué ejecutar.
>
> Notación: cada propuesta lleva ID `<sección>.<letra>` para referenciar en el
> chat. Esfuerzo S=<30 min, M=30–90 min, L=>90 min. Cita IDs (E##, DGG-##,
> regla N) cuando aplica.

---

## 0. Resumen ejecutivo

- **Solicitudes** (8 propuestas) — el centro de captación funciona pero el
  Wizard pierde estado al cerrar, los adjuntos no se ven sin descargar, el
  payload del formulario se imprime "key cruda" y falta acción rápida sin
  abrir detalle. Hay además **una ruta rota real** (ver 7.A).
- **Trackings** (7 propuestas) — `ProgramarVencimientoModal` ya es premium;
  el detalle pide línea de tiempo visual, exportar timeline a PDF, indicador
  de SLA y botón "compartir externo" inline.
- **Agenda unificada** (8 propuestas) — sólida pero le falta toggle de
  "modo enfoque" (pateado en STATUS), undo al hacer/saltear, tooltip al
  hover de proyectada (ver datos sin navegar), tono visual diferenciado por
  fuente proyectada, leyenda de chips y feedback de carga de proyectadas.
- **Formularios** (7 propuestas) — el builder está completo; falta
  autosave, atajo de teclado para insertar campo, indicador de validez
  del schema, preview en móvil, undo/redo y diff entre versiones.
- **Acceso externo** (6 propuestas) — público y limpio pero pobre en
  affordances: falta "agregar al calendario", indicador de "última
  actualización", contactos del gerente responsable, tracking de aperturas
  y un fallback de marca cuando vence.
- **Vencimientos** (6 propuestas) — funcionalidad lista; falta agrupador
  por administración, bulk-renovar, vista calendario inline (al menos un
  mini-mapa) y export CSV para reportería externa.
- **Cross-cutting** (7 propuestas) — chequeos de consistencia tonal,
  notificaciones in-app, atajos globales, performance, accesibilidad,
  search global.

**Total: 49 propuestas** distribuidas. **Hallazgos críticos** flagueados en 7.A
y 7.B (ruta rota + tono inconsistente).

---

## 1. Solicitudes

### 1.A · Reabrir wizard en el paso donde quedó
- **Problema**: el `WizardActivacion` resetea el estado a `step=0` cada vez
  que se abre. Si el gerente derivó (paso 1) y cerró el modal por
  distracción, vuelve a empezar.
- **Propuesta**: persistir `step`, `destinatarioEmail`, `modoCliente` y los
  campos completados en `sessionStorage` clavados por `solicitud.id`. Al
  reabrir, levantar ese borrador y mostrar un chip "Continuando borrador"
  con botón "Empezar de cero".
- **Valor**: la activación de una solicitud es el momento de mayor fricción;
  perder estado mata UX premium.
- **Esfuerzo**: M
- **Riesgo**: bajo

### 1.B · Vista previa de adjuntos sin descargar
- **Problema**: en `SolicitudDetailPage` los adjuntos sólo se abren en otra
  pestaña. Para PDFs / imágenes obliga a descargar antes de saber si son lo
  esperado.
- **Propuesta**: lightbox modal con `<iframe>` para PDFs y `<img>` para
  imágenes, botón "Abrir en pestaña" como fallback. Detectar extensión por
  `a.url.split('.').pop()`.
- **Valor**: el adjunto es lo primero que mira el gerente; el clic doble
  (abrir + cerrar tab) rompe el flujo.
- **Esfuerzo**: M
- **Riesgo**: bajo

### 1.C · Payload del formulario con labels legibles
- **Problema**: `Object.entries(data.submission_payload).map(...)` imprime
  `dni_solicitante` o `consorcio_calle` como keys crudas. El gerente lee
  campos técnicos en lugar de labels de negocio.
- **Propuesta**: si la solicitud tiene `formulario_schema_version_snapshot`
  (existe en mig formularios), resolver `field.name → field.label` y
  ordenar las entradas en el orden del schema. Fallback: humanizar el key
  (`humanize('dni_solicitante') → "Dni solicitante"`).
- **Valor**: el formulario es la cara pública y debe leerse como tal del
  lado interno. UX premium grado Apple (instrucción del usuario).
- **Esfuerzo**: M
- **Riesgo**: bajo

### 1.D · Acción rápida "Derivar" desde la card del listado
- **Problema**: para derivar a una gestoría hay que entrar al detalle y
  abrir el wizard. 3 clicks para una acción muy frecuente.
- **Propuesta**: en `SolicitudCard`, hover muestra botón "Derivar" que
  abre directamente el wizard en paso 1 (en una ruta `?wizard=derivar`).
- **Valor**: reduce clicks 3→1 en una operación diaria.
- **Esfuerzo**: M
- **Riesgo**: bajo

### 1.E · Filtro adicional por categoría de formulario
- **Problema**: el listado filtra por estado y busca por nombre/email pero
  no permite filtrar por `formulario_categoria` (matrícula, DDJJ, consulta…)
  que es la dimensión más natural del trabajo.
- **Propuesta**: agregar Select "Categoría" al toolbar usando los valores
  distintos presentes en el set actual. Persistir en URL query (`?cat=…`)
  para que sea compartible.
- **Valor**: en alta carga (>30 solicitudes) ordenar por tipo es lo primero
  que pide cualquier operador.
- **Esfuerzo**: S
- **Riesgo**: bajo

### 1.F · Toast con "Deshacer" al descartar
- **Problema**: el descarte navega fuera y no es reversible desde la UI
  (queda en BD para auditoría pero no hay "Restaurar"). Si el gerente se
  equivoca, ruido total.
- **Propuesta**: tras `descartar()`, mostrar `toast.success(..., { action:
  { label: 'Deshacer', onClick: () => restaurarSolicitud(id) } })` con 5
  segundos de gracia. RPC nueva `restaurar_solicitud(id)` que vuelve al
  estado anterior y limpia `motivo_descarte`.
- **Valor**: la red de seguridad emocional baja la fricción de descartar.
  Inspirado en Gmail "Undo send".
- **Esfuerzo**: M (incluye RPC)
- **Riesgo**: bajo

### 1.G · Tiempo desde la recepción visible en la card
- **Problema**: hoy la card muestra fecha en formato corto ("15 may") pero
  no "hace 2 días" o "hace 3 horas". El SLA implícito se pierde.
- **Propuesta**: usar utilidad `formatDistanceToNow` (o helper propio) y
  mostrar texto relativo + color creciente: <24h verde, <72h ambar,
  >72h rojo. Tooltip con la fecha exacta.
- **Valor**: vista de un golpe del backlog crítico.
- **Esfuerzo**: S
- **Riesgo**: bajo

### 1.H · Email del solicitante con CTA "Responder"
- **Problema**: el email es link `mailto:` pero abre el cliente local sin
  contexto. Falta una acción "Responder desde Gestión Global" que use el
  motor de email transaccional (Workspace, DGG-05.5/configuración).
- **Propuesta**: botón "Responder" que abre modal con textarea, asunto
  pre-cargado ("Re: tu solicitud · Gestión Global") y FROM elegible
  (config_global aliases). Persistir en `sent_emails` con
  `solicitud_id` ligado para historial.
- **Valor**: cierra el loop sin sacar al gerente de la plataforma. Brand
  consistency total.
- **Esfuerzo**: L
- **Riesgo**: medio (toca motor de email)

---

## 2. Trackings

### 2.A · Timeline visual de líneas con eje temporal
- **Problema**: las líneas se listan en lista plana ordenada cronológica
  pero sin eje visual. Difícil escanear "qué pasó en qué momento" de un
  vistazo.
- **Propuesta**: vista alternativa "Timeline" (toggle Tabs · "Lista" /
  "Timeline") que usa el `created_at` de cada línea + categoría iconada
  sobre una línea vertical con días marcados. Cita patrón MDC handoff §C1.
- **Valor**: trackings largos (10+ líneas) se vuelven ilegibles en lista.
- **Esfuerzo**: L
- **Riesgo**: bajo

### 2.B · Botón "Compartir con cliente" inline (acceso externo de un click)
- **Problema**: para mandarle el tracking al administrador hay que ir
  manualmente a `generarAcceso()` desde alguna pantalla — no hay flujo
  visible en `TrackingDetailPage`.
- **Propuesta**: botón en el header "Compartir externo" → modal con email,
  días de validez (default 14), copia el link al portapapeles + lo envía
  por email. Aprovecha `generar_acceso_externo` y `accesos.ts` existente
  (regla 4 — todo query en api).
- **Valor**: el cliente externo es la cara pública (instrucción del usuario);
  hoy compartir requiere que el gerente sepa que existe el módulo accesos.
- **Esfuerzo**: M
- **Riesgo**: bajo

### 2.C · Exportar tracking como PDF resumen
- **Problema**: cuando se cierra un tracking, no hay forma de generar un
  reporte/cierre profesional para el cliente más allá del documento final.
  Imprimir la pantalla queda feo.
- **Propuesta**: botón "Exportar PDF" → genera con `jspdf` o edge function
  un PDF con header de marca, datos del cliente, timeline de líneas
  resumido, adjuntos referenciados. Guarda en `documento_final_url` si no
  hay uno.
- **Valor**: cierra el ciclo "premium" del tracking — al final entregás
  algo tangible. Diferencial de mercado.
- **Esfuerzo**: L
- **Riesgo**: medio (formato PDF prolijo lleva iteración)

### 2.D · Indicador de SLA en el header
- **Problema**: hay KPI "Días abiertos" pero no se compara contra un SLA
  esperado del servicio. Un tracking de 90 días puede ser normal o un
  desastre — el gerente no lo ve.
- **Propuesta**: si `servicio.sla_dias` está cargado (agregar al schema si
  no existe), mostrar barra de progreso "Día 42 / SLA 60" con color
  semáforo. Si supera SLA mostrar "Atrasado (+5 d)" en rojo.
- **Valor**: SLA visible obliga foco. Hoy se pierde.
- **Esfuerzo**: M
- **Riesgo**: bajo (requiere agregar `sla_dias` opcional al schema servicios)

### 2.E · Filtro de líneas por rango de fechas
- **Problema**: hay filtro por categoría pero no por fecha. En trackings
  largos, ver "qué pasó en marzo" requiere scroll.
- **Propuesta**: chips "Últimos 7d · 30d · 90d · Todo" arriba del listado
  de líneas. Sincronizar con URL query.
- **Valor**: navegación rápida en trackings históricos.
- **Esfuerzo**: S
- **Riesgo**: bajo

### 2.F · Drag&drop de archivos sobre el detalle = nueva línea con adjunto
- **Problema**: para agregar un adjunto hay que abrir el drawer "Agregar
  línea", elegir categoría, escribir nota, subir. Cuando el gerente recibe
  un PDF por mail y quiere meterlo rápido, son 6 clicks.
- **Propuesta**: zona drop overlay sobre toda la página que detecta
  `dragover`, al soltar archivos pre-abre el drawer con los archivos ya
  cargados y categoría sugerida ("Documentación"). UX tipo Notion / Slack.
- **Valor**: aceleración de un flujo diario muy frecuente.
- **Esfuerzo**: M
- **Riesgo**: bajo

### 2.G · Preview de cronograma de alarmas en la card del tracking (resumen)
- **Problema**: el `ProgramarVencimientoModal` muestra preview pero una vez
  programado no hay forma de ver desde el tracking las próximas alarmas
  configuradas sin ir a Agenda.
- **Propuesta**: en el tab "Resumen", si hay vencimiento ligado, mostrar
  panel "Próximas alarmas" con las fechas calculadas (consulta
  `vencimiento.alarmas_offsets[]`) + botón "Editar cronograma" que reabre
  el modal en modo edit.
- **Valor**: cierra el loop. Hoy el tracking dispara una alarma pero no
  sabe cuál.
- **Esfuerzo**: M
- **Riesgo**: bajo

---

## 3. Agenda unificada

### 3.A · Toggle "Modo enfoque" — oculta proyecciones
- **Problema**: ya está en "Pateado para el final" del STATUS pero su valor
  diario es alto. Cuando un gerente quiere ver sólo lo suyo, hoy tiene que
  deseleccionar cada chip de fuente.
- **Propuesta**: toggle switch "Solo mis tareas" arriba a la derecha que
  congela las fuentes a `['personal']` y muestra todas las personales sin
  proyecciones. Persistir en localStorage.
- **Valor**: Cita DGG-06 — la agenda es hub pero a veces se necesita
  modo aislamiento.
- **Esfuerzo**: S
- **Riesgo**: bajo

### 3.B · Hover sobre proyectada muestra tooltip con datos esenciales
- **Problema**: en VistaMes/Semana/Día las proyecciones aparecen como
  bloquecitos con `Lock`. Para ver de qué se trata hay que click → navegar.
- **Propuesta**: tooltip popover en `mouseover` (con delay 400ms) que
  muestra título, fuente, monto/cliente cuando aplica, botón "Abrir
  módulo origen". Tipo Google Calendar quick-view.
- **Valor**: la promesa de "proyección, no duplicación" (DGG-06) se rompe
  cuando para ver un dato hay que salir de la agenda.
- **Esfuerzo**: M
- **Riesgo**: bajo

### 3.C · Undo al marcar hecha / saltear ocurrencia
- **Problema**: `marcarHecha` y `saltearOcurrencia` toastan éxito pero si el
  gerente clavó mal el círculo, no hay deshacer rápido.
- **Propuesta**: `toast.success("¡Listo!", { action: { label: 'Deshacer',
  onClick: () => marcarHecha(id, false, ...) } })` con 5 segundos.
- **Valor**: las microinteracciones del check son veloces; la red de
  seguridad debe igualarlas.
- **Esfuerzo**: S
- **Riesgo**: bajo

### 3.D · Tono visual diferenciado por fuente proyectada (no sólo `Lock`)
- **Problema**: hoy todas las proyectadas usan el mismo color de borde +
  ícono `Lock`. Difícil distinguir "vencimiento ARCA" de "comprobante por
  cobrar" a la velocidad de scan.
- **Propuesta**: borde izquierdo de 3px con el color del chip de fuente
  (vencimiento=ambar, comprobante=rojo, solicitud=cyan, trámite=violeta —
  ya definidos en `FUENTES_FILTROS`). Mantener `Lock` como semáforo de
  "no editable".
- **Valor**: lectura instantánea por categoría sin descomponer.
- **Esfuerzo**: S
- **Riesgo**: bajo

### 3.E · Leyenda colapsable de los chips de fuente
- **Problema**: si el usuario es nuevo, los chips "Personal · Vencimientos
  · Trámites · Cobranzas · Solicitudes" tienen sentido tras un tour. Sin
  él, "Cobranzas" puede sonar a "facturas pendientes" cuando son
  comprobantes proyectados.
- **Propuesta**: ícono `?` al lado de los chips con popover que explica
  qué representa cada fuente y qué color le corresponde.
- **Valor**: onboarding implícito sin sumar copy estorboso.
- **Esfuerzo**: S
- **Riesgo**: bajo

### 3.F · Skeleton específico para la carga de proyectadas
- **Problema**: cuando cambia el filtro de fuentes, `cargarProyectadas`
  refetcha pero las vistas siguen mostrando el set anterior unos
  milisegundos y luego salta. No hay feedback de "actualizando".
- **Propuesta**: `setProyectadasLoading=true` durante el fetch; en
  VistaMes/Semana mostrar 2-3 placeholders translúcidos en los días con
  proyectadas. O al menos un spinner discreto arriba a la derecha del
  título.
- **Valor**: percepción de responsividad. Hoy se siente "saltado".
- **Esfuerzo**: M
- **Riesgo**: bajo

### 3.G · Quick-edit inline del título (doble-click)
- **Problema**: para corregir un typo en un título hay que abrir
  EventoModal completo. 4 clicks para cambiar una letra.
- **Propuesta**: doble-click sobre el título de la ocurrencia → inline
  edit con `<input>` autofocus + Enter para guardar (`actualizarEvento`).
  Sólo eventos personales (las proyectadas ya están bloqueadas).
- **Valor**: ergonomía mental nivel Things 3 / Notion.
- **Esfuerzo**: M
- **Riesgo**: bajo

### 3.H · Mes: indicador "+N más" clickeable abre día (ya hay onPickDay)
- **Problema**: en `VistaMes`, los días con >3 ocurrencias muestran "+N
  más" pero el click sólo navega al día. No hay popover "ver lista
  completa sin salir del mes".
- **Propuesta**: click en "+N más" abre popover anclado en la celda con
  la lista de todas las ocurrencias del día. Cerrar con ESC. Doble-click
  navega al día como hoy.
- **Valor**: preserva contexto del mes mientras explora un día puntual.
- **Esfuerzo**: M
- **Riesgo**: bajo

---

## 4. Formularios

### 4.A · Autosave del schema en el builder
- **Problema**: `FormularioBuilderPage` requiere botón "Guardar"
  explícito. Si el navegador se cierra o cambia tab perdés cambios — y
  el versionado SQL no se dispara hasta el guardado.
- **Propuesta**: debounce 1500ms de cualquier `setSchema` → llamar
  `actualizarFormulario` silenciosamente. Indicador discreto "Guardado
  hace 5 s" (estilo Google Docs). Botón "Guardar" se vuelve opcional.
- **Valor**: el builder es la herramienta diaria de gerencia; perder
  trabajo es inaceptable a este nivel.
- **Esfuerzo**: M
- **Riesgo**: medio (cada autosave dispara una versión; verificar trigger
  `formulario_versionado` o ajustar para que cree versión sólo al
  publicar)

### 4.B · Atajo de teclado para insertar campo (⌘ + número)
- **Problema**: insertar un campo requiere drag desde la palette o click
  + click. Para formularios largos cansa.
- **Propuesta**: con un campo seleccionado, `⌘+1..9` inserta tras él el
  N-ésimo tipo de la palette (1=texto, 2=textarea, 3=email...). Mostrar
  hint en la palette ("1", "2", ...).
- **Valor**: power user mode. Reducción de 60% en construcción de
  formularios largos.
- **Esfuerzo**: M
- **Riesgo**: bajo

### 4.C · Vista previa móvil junto a la desktop
- **Problema**: `PreviewModal` muestra el formulario en desktop. La
  mayoría de los solicitantes lo van a abrir en celular (landings públicas).
- **Propuesta**: toggle "Desktop / Móvil / Ambos" en el preview. "Ambos"
  muestra dos iframes lado a lado (375px y full). Caso borde detectable
  desde el builder.
- **Valor**: caza problemas de layout antes de publicar. UX premium
  exige responsive de verdad.
- **Esfuerzo**: M
- **Riesgo**: bajo

### 4.D · Undo / Redo del editor visual
- **Problema**: el builder muta `schema` directo. No hay forma de
  arrepentirse de eliminar una sección excepto recargar (perdiendo todo
  lo demás).
- **Propuesta**: stack `historia: schema[]` con `⌘Z` / `⌘⇧Z`. Capar a 30
  pasos para no inflar memoria. Incluir las mutaciones de campos y
  secciones.
- **Valor**: el editor visual sin undo se siente frágil. Estándar de la
  industria.
- **Esfuerzo**: L
- **Riesgo**: medio (testing de edge cases)

### 4.E · Diff visual entre versiones
- **Problema**: `FormularioVersionesPage` lista versiones pero (a
  confirmar) no muestra qué cambió entre dos versiones — sólo el snapshot
  crudo.
- **Propuesta**: seleccionar 2 versiones → renderizar diff visual
  (campo agregado en verde, eliminado en rojo, modificado en amarillo).
  Cita patrón Notion "page history".
- **Valor**: auditoría real, no sólo lista de timestamps.
- **Esfuerzo**: L
- **Riesgo**: medio

### 4.F · Indicador de validez del schema en tiempo real
- **Problema**: un formulario puede tener `condition: { field: 'x' }`
  apuntando a un campo que ya no existe — silencioso hasta runtime
  público.
- **Propuesta**: validador del schema en el builder que detecta:
  conditions huérfanas, names duplicados, max_files inconsistente con
  required, secciones vacías. Mostrar badge "3 advertencias" en el
  header con popover.
- **Valor**: previene errores en producción que el usuario público sufre
  silenciosamente.
- **Esfuerzo**: M
- **Riesgo**: bajo

### 4.G · Botón "Copiar URL pública" desde la card del listado
- **Problema**: para mandar el link al equipo de marketing o pegarlo en la
  landing, hoy hay que abrir el formulario → tab "Ver" → copiar de la URL
  del navegador. 4 clicks.
- **Propuesta**: ícono `Copy` al lado del slug en la card que copia
  `<origin>/formulario/<slug>` y toastea "Link copiado".
- **Valor**: 4 clicks → 1.
- **Esfuerzo**: S
- **Riesgo**: bajo

---

## 5. Acceso externo

### 5.A · Botón "Agregar al calendario" si el recurso tiene fecha
- **Problema**: si el acceso externo expone un trámite/tracking con fecha
  estimada, el destinatario tiene que copiar manualmente la fecha al
  Google Calendar.
- **Propuesta**: si `recurso.fecha_estimada` o `vencimiento.fecha` están
  presentes, mostrar botón que genera un `.ics` descargable con título,
  fecha, descripción.
- **Valor**: el cliente externo es la cara pública (instrucción del
  usuario). Que llegue con el menor esfuerzo posible.
- **Esfuerzo**: S
- **Riesgo**: bajo

### 5.B · Mostrar gerente responsable + contacto directo
- **Problema**: el acceso externo carga el recurso pero no muestra quién
  del lado Gestión Global es responsable. El destinatario no sabe a quién
  escribirle si tiene dudas.
- **Propuesta**: incluir en el payload `acceso.responsable_nombre +
  responsable_email + responsable_telefono` (si están en el tracking /
  trámite). Renderizar en una tarjeta "Tu contacto" con avatar y mailto:/
  tel: directos.
- **Valor**: humaniza el acceso. Hoy se siente "robot".
- **Esfuerzo**: M
- **Riesgo**: bajo

### 5.C · Tracking de aperturas
- **Problema**: el gerente no sabe si el destinatario abrió el link. Sin
  esa señal no puede inferir si tiene que llamarlo o esperar.
- **Propuesta**: cada GET a `acceso-externo/:token` registra fila en
  `accesos_externos_log (token, abierto_at, ip, user_agent)`. En la
  gerencia, mostrar badge "Visto 3 veces · última hace 2 h" en la lista
  de accesos generados.
- **Valor**: visibilidad del estado del cliente externo. Diferencial fuerte.
- **Esfuerzo**: M
- **Riesgo**: bajo (cuidado con PII en el log; sólo IP truncada)

### 5.D · Página de marca cuando el token expira o se revoca
- **Problema**: hoy un token vencido muestra "No pudimos abrir este
  enlace" en card rosa, lo cual está bien — pero no propone acción.
- **Propuesta**: si el error es `EXPIRED` o `REVOKED`, mostrar un CTA
  "Solicitar un nuevo enlace" que envía mail al responsable con
  contexto preescrito ("hola, intenté abrir el enlace que me enviaste
  sobre [recurso] pero está vencido"). Si no hay responsable, fallback
  a `contacto@gestionglobal.ar`.
- **Valor**: recupera al destinatario en vez de perderlo.
- **Esfuerzo**: M
- **Riesgo**: bajo

### 5.E · Indicador "Última actualización" del recurso
- **Problema**: el destinatario abre el link y no sabe si está viendo el
  estado de hoy o de hace una semana.
- **Propuesta**: en el hero o cerca del título, mostrar "Actualizado hace
  X" (basado en `recurso.updated_at` o `tracking.ultima_actividad_at`).
  Si fue actualizado hace <1 día, badge "Reciente" en verde.
- **Valor**: confianza inmediata.
- **Esfuerzo**: S
- **Riesgo**: bajo

### 5.F · Print stylesheet para impresión / PDF guardado
- **Problema**: el destinatario que quiere imprimir el acceso (común en
  gestiones legales/ARCA) imprime con el hero gradient cyan + footer
  oscuro = páginas feas y gastadoras de tinta.
- **Propuesta**: `@media print` CSS que aplana fondos, oculta hero
  gradient, mantiene logo + datos. Test con Cmd+P.
- **Valor**: cuidado por el detalle. Premium grado Apple.
- **Esfuerzo**: S
- **Riesgo**: bajo

---

## 6. Vencimientos (como tab de Agenda)

### 6.A · Agrupador por administración
- **Problema**: la lista es plana — 40 vencimientos para 8 administraciones
  se mezclan. Cuando el gerente piensa "qué tiene Pérez Hnos" tiene que
  filtrar por nombre.
- **Propuesta**: toggle "Vista: Lista / Por cliente" arriba del grid.
  "Por cliente" agrupa por `administracion_nombre`, colapsable, con
  resumen "3 vencen <30d".
- **Valor**: mental model cambia "ver todo lo crítico" vs "ver mi cliente";
  ambas tienen sentido.
- **Esfuerzo**: M
- **Riesgo**: bajo

### 6.B · Bulk renovar (multi-select + acción masiva)
- **Problema**: cuando un cliente renueva 3 matrículas + 1 DDJJ, son 4
  modales separados. Repetitivo.
- **Propuesta**: checkbox en cada card → barra flotante "X seleccionados ·
  Renovar · Cancelar · Notificar". Renovar masivo abre un modal único
  con la misma fecha de próximo vencimiento aplicada a todos (override por
  fila opcional).
- **Valor**: aceleración para alto volumen.
- **Esfuerzo**: L
- **Riesgo**: medio (RPC bulk + UX cuidado)

### 6.C · Mini-mapa calendario al lado del listado
- **Problema**: ya hay `horizonte` en días pero no hay vista calendario
  visual. Saber "¿qué semana del próximo mes tengo más vencimientos?"
  requiere ir a la pestaña Agenda.
- **Propuesta**: heatmap calendario tipo GitHub contributions (4-6
  semanas) arriba del listado, intensidad por cantidad de vencimientos
  del día. Click en una celda filtra el listado.
- **Valor**: visión estratégica de un golpe.
- **Esfuerzo**: M
- **Riesgo**: bajo

### 6.D · Export CSV para reportería externa
- **Problema**: cuando el gerente quiere armar reporte para socios o
  exportar a planilla, no tiene cómo.
- **Propuesta**: botón "Exportar CSV" que toma `filtered` (con filtros
  aplicados) y descarga CSV con columnas tipo, administración, consorcio,
  fecha, dias_restantes, estado.
- **Valor**: integración con flujos externos.
- **Esfuerzo**: S
- **Riesgo**: bajo

### 6.E · Notificación visible cuando hay alarma "el día" para hoy
- **Problema**: la edge dispatch envía push pero la UI no banneriza "hoy
  vencen 2 cosas críticas" al abrir el dashboard / agenda.
- **Propuesta**: si hay vencimientos con `dias_restantes <= 0 && estado ==
  'vigente'`, mostrar banner alarm rojo arriba del KPI grid: "2
  vencimientos requieren acción HOY" con CTA "Ver". Persiste hasta que
  el usuario los procese o los descarte por sesión.
- **Valor**: sin esto el usuario depende del push del navegador, que puede
  no estar habilitado.
- **Esfuerzo**: S
- **Riesgo**: bajo

### 6.F · Vincular vencimiento a tracking de origen (mostrar trazabilidad)
- **Problema**: ahora un vencimiento puede estar ligado a un tracking
  (`vencimientos.tracking_id`, DGG-07) pero `VencimientoCard` no lo muestra
  visualmente. El gerente no ve "esto viene del cierre del tracking X".
- **Propuesta**: si `venc.tracking_id` está presente, chip pequeño
  "Generado desde tracking" + link al `TrackingDetail`. En `RenovarModal`,
  pre-poblar el tracking ligado.
- **Valor**: cierra el loop bidireccional de DGG-07.
- **Esfuerzo**: S
- **Riesgo**: bajo

---

## 7. Cross-cutting (afecta a varios módulos)

### 7.A · 🔴 BUG: rutas inconsistentes entre Solicitudes/Trackings (legacy `tramites/:id` vs `trackings/:id`)
- **Problema**: hallazgo real. `WizardActivacion.handleActivar` navega a
  `/gerencia/tramites/${trackingId}` (línea 178), y
  `SolicitudDetailPage` linkea a `/gerencia/tramites/${data.tramite_id}`
  (línea 363). **Pero `TrackingDetailPage` está bajo
  `/gerencia/trackings/:id`** (App.tsx). Las rutas `/tramites/:id` resuelven
  a la página legacy `TramiteDetailPage`, no a la nueva. Quien viene de
  activar una solicitud termina en una página vieja sin las features
  nuevas (cierre de ciclo, configuración, recurrencia).
- **Propuesta**: decidir si `tramites` y `trackings` son el mismo recurso
  o no. Si sí, redirigir `/gerencia/tramites/:id` a `/gerencia/trackings/:id`
  (o renombrar en App.tsx). Actualizar todos los `navigate` y `Link`. Si
  no, dejar claro semánticamente.
- **Valor**: bug funcional silencioso — el wizard premium "lleva al
  tracking" pero entrega la pantalla vieja.
- **Esfuerzo**: S (cambiar rutas) o M (consolidar)
- **Riesgo**: bajo

### 7.B · Tonos de marca consistentes en CTAs primarios
- **Problema**: revisando los 3 módulos hay variaciones sutiles: el botón
  "Programar próximo vencimiento" usa `!bg-cyan-100 !text-cyan-700`
  (hardcoded, no Button con variant). Otros módulos usan
  `<Button variant="primary">`. Lleva a inconsistencias de estados (hover,
  focus, disabled).
- **Propuesta**: barrer estos hardcodes y reemplazar por `Button` con
  `variant`. Si hace falta un nuevo variant (`soft`, `tonal`), agregarlo
  al sistema en `src/components/common/Button.tsx`.
- **Valor**: el ojo entrenado lo nota inmediatamente. Brand consistency.
- **Esfuerzo**: M
- **Riesgo**: bajo

### 7.C · Centro de notificaciones in-app (campana en header)
- **Problema**: ya está en "Pateado para el final" pero su valor cross
  module es enorme. Push se reciben pero se pierden si la PC estaba
  cerrada.
- **Propuesta**: tabla `notificaciones_internas (user_id, tipo, payload,
  leido_at)` poblada por el mismo motor que `dispatch-vencimientos` +
  alta de solicitud + cierre de tracking. Campana en header con dropdown
  paginado.
- **Valor**: completa la promesa "ningún dato/elemento puede pasar
  desapercibido" (instrucción del usuario).
- **Esfuerzo**: L
- **Riesgo**: medio

### 7.D · Search global en command palette ⌘K
- **Problema**: ⌘K existe (según STATUS) pero (a confirmar) no busca
  dentro de solicitudes/trackings/vencimientos por nombre de
  administración o solicitante.
- **Propuesta**: extender ⌘K con resultados de Solicitudes (por nombre,
  email), Trackings (por código, administración), Vencimientos (por
  administración, tipo), Formularios (por título). Usar `busqueda.ts` o
  agregar una RPC global con UNION de las tablas.
- **Valor**: navegación premium tipo Linear / Notion.
- **Esfuerzo**: L
- **Riesgo**: medio (cuidado con performance — usar RPC + ilike server-side)

### 7.E · Pull-to-refresh en mobile
- **Problema**: pateado en STATUS. Lo confirmo: las listas (Solicitudes,
  Vencimientos, Tramites) en mobile no soportan pull-to-refresh. Sólo
  reload manual del navegador.
- **Propuesta**: hook `usePullToRefresh(onRefresh)` con el patrón clásico
  Touch start + delta Y + threshold. Aplicar a listas top-level.
- **Valor**: PWA premium. Hoy se siente "web vieja" en mobile.
- **Esfuerzo**: M
- **Riesgo**: bajo

### 7.F · Accesibilidad: focus rings y aria-labels en chips/cards
- **Problema**: muchos chips de fuente / categoría / estado en Solicitudes,
  Agenda, Vencimientos son `<button>` o `<div onClick>` sin foco visible
  claro ni `aria-pressed` cuando son toggles.
- **Propuesta**: pasada de auditoría a11y con `eslint-plugin-jsx-a11y`
  habilitado en strict, agregar `aria-pressed`, `aria-label` y clases
  `focus-visible:ring-2 focus-visible:ring-brand-cyan` donde falten.
- **Valor**: accesibilidad real, navegación por teclado para power users.
  Regla blanda pero exigida por "premium grado Apple".
- **Esfuerzo**: M
- **Riesgo**: bajo

### 7.G · Persistencia de filtros en URL query (compartir links)
- **Problema**: filtros de Solicitudes (estado), Vencimientos
  (tipo/estado/horizonte) y Agenda (vista/fuentes) viven sólo en state +
  localStorage. No se pueden compartir links del estilo
  "/solicitudes?estado=derivada".
- **Propuesta**: sincronizar filtros relevantes con URL query usando
  `useSearchParams`. localStorage queda como fallback inicial sólo si la
  URL no trae nada.
- **Valor**: colaboración entre operadores ("mirá este filtro" enviado por
  WhatsApp).
- **Esfuerzo**: M
- **Riesgo**: bajo

---

## 8. Matriz de priorización sugerida

| ID | Módulo | Esfuerzo | Valor | Mi recomendación |
|---|---|---|---|---|
| 7.A | Cross (rutas) | S | **Crítico** | **Sí — fix urgente** |
| 1.A | Solicitudes | M | Alto | Sí |
| 1.B | Solicitudes | M | Alto | Sí |
| 1.C | Solicitudes | M | Alto | Sí |
| 1.D | Solicitudes | M | Alto | Sí |
| 1.E | Solicitudes | S | Medio | Sí (S) |
| 1.F | Solicitudes | M | Medio | Tal vez |
| 1.G | Solicitudes | S | Medio | Sí (S) |
| 1.H | Solicitudes | L | Alto | Más adelante |
| 2.A | Trackings | L | Alto | Más adelante |
| 2.B | Trackings | M | Alto | Sí |
| 2.C | Trackings | L | Medio-Alto | Más adelante |
| 2.D | Trackings | M | Alto | Sí (si servicios tienen SLA) |
| 2.E | Trackings | S | Medio | Sí (S) |
| 2.F | Trackings | M | Alto | Sí |
| 2.G | Trackings | M | Alto | Sí |
| 3.A | Agenda | S | Alto | Sí (S) |
| 3.B | Agenda | M | Alto | Sí |
| 3.C | Agenda | S | Alto | Sí (S) |
| 3.D | Agenda | S | Alto | Sí (S) |
| 3.E | Agenda | S | Medio | Sí (S) |
| 3.F | Agenda | M | Medio | Sí |
| 3.G | Agenda | M | Medio-Alto | Tal vez |
| 3.H | Agenda | M | Medio | Tal vez |
| 4.A | Formularios | M | Alto | Sí |
| 4.B | Formularios | M | Medio | Tal vez |
| 4.C | Formularios | M | Alto | Sí |
| 4.D | Formularios | L | Alto | Más adelante |
| 4.E | Formularios | L | Medio | Más adelante |
| 4.F | Formularios | M | Alto | Sí |
| 4.G | Formularios | S | Alto | Sí (S) |
| 5.A | Acceso ext. | S | Alto | Sí (S) |
| 5.B | Acceso ext. | M | Alto | Sí |
| 5.C | Acceso ext. | M | Alto | Sí |
| 5.D | Acceso ext. | M | Medio | Tal vez |
| 5.E | Acceso ext. | S | Medio | Sí (S) |
| 5.F | Acceso ext. | S | Bajo-Medio | Tal vez |
| 6.A | Vencimientos | M | Alto | Sí |
| 6.B | Vencimientos | L | Alto | Más adelante |
| 6.C | Vencimientos | M | Medio-Alto | Tal vez |
| 6.D | Vencimientos | S | Medio | Sí (S) |
| 6.E | Vencimientos | S | Alto | Sí (S) |
| 6.F | Vencimientos | S | Medio | Sí (S) |
| 7.B | Cross (tono) | M | Medio | Sí |
| 7.C | Cross (notif) | L | Alto | Más adelante |
| 7.D | Cross (⌘K) | L | Alto | Más adelante |
| 7.E | Cross (PTR) | M | Medio | Tal vez |
| 7.F | Cross (a11y) | M | Medio | Sí |
| 7.G | Cross (URL) | M | Medio | Tal vez |

---

## 9. Mi recomendación de orden de ejecución

### Pase rápido S/M (top 10, todos S/M, suman ~6-8 horas)
1. **7.A** — fix rutas `tramites/:id` vs `trackings/:id` (S). **Urgente**: hay
   un bug funcional en el wizard recién entregado.
2. **3.A** — toggle "Modo enfoque" en Agenda (S). Alto valor diario.
3. **3.C** — undo al marcar hecha / saltear (S).
4. **3.D** — borde de color por fuente proyectada (S). Diferencial visual.
5. **1.G** — tiempo relativo en `SolicitudCard` (S).
6. **4.G** — botón "Copiar URL pública" (S).
7. **5.A** — "Agregar al calendario" en acceso externo (S).
8. **6.E** — banner "vencen HOY" (S).
9. **1.E** — filtro por categoría en Solicitudes (S).
10. **6.D** — export CSV vencimientos (S).

### Los grandes (M-L, en orden de impacto)
11. **1.A** — persistir estado del Wizard (M). Alto impacto en flujo crítico.
12. **1.C** — payload con labels legibles (M).
13. **2.B** — botón "Compartir externo" inline en tracking (M).
14. **2.G** — preview de cronograma de alarmas en tracking (M).
15. **3.B** — tooltip hover en proyectadas (M).
16. **4.A** — autosave del builder de formularios (M).
17. **5.B** + **5.C** — gerente responsable + tracking de aperturas (M+M).
18. **6.A** — agrupador por administración en vencimientos (M).
19. **2.F** — drag&drop de archivos sobre tracking (M).
20. **7.B** — barrido de tonos / variantes Button (M).
