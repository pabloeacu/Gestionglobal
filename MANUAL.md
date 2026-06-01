# Manual oficial · Gestión Global

> Versión 1.1 · 2026-06-01.
> Una guía pensada para entrar y salir, leer un capítulo y cerrar; nada
> de jerga innecesaria, mucho de "esto es lo que ves, así se usa, esto
> es por qué existe."

---

## Índice

1. [La promesa](#1-la-promesa)
2. [Los protagonistas](#2-los-protagonistas)
3. [Un día en la gerencia](#3-un-día-en-la-gerencia)
4. [El portal del administrador · la mirada de María](#4-el-portal-del-administrador--la-mirada-de-maría)
5. [El aliado partner](#5-el-aliado-partner)
6. [El gestor externo · el aliado sin cuenta](#6-el-gestor-externo--el-aliado-sin-cuenta)
7. [Campus, webinars y comunicaciones](#7-campus-webinars-y-comunicaciones)
8. [Cómo conversa el sistema](#8-cómo-conversa-el-sistema)
9. [Configuración](#9-configuración)
10. [Bajo el capó](#10-bajo-el-capó)
11. [Cuando algo no anda](#11-cuando-algo-no-anda)
12. [Glosario](#12-glosario)
13. [Atajos de teclado](#13-atajos-de-teclado)

---

## 1. La promesa

### 1.1 De qué va este manual

Gestión Global es la plataforma que sostiene a la empresa del mismo nombre,
dedicada a la administración de consorcios y a todos los servicios que la
rodean: matriculación, asesoría jurídica, capacitación y formación.

Lo que vas a encontrar en estas páginas es la **guía operativa** de la
plataforma. No es la documentación técnica (esa vive en `knowledge-base/`),
sino el manual que necesitás para mirar una pantalla y saber qué hacer en
ella. Está escrito pensando en tres tipos de lectores: la persona que opera
desde la gerencia, la administradora cliente que entra a su portal, y el
partner o gestor externo que aterriza por un email.

> *"El mejor manual es el que dejás de necesitar después de leerlo una vez."*

### 1.2 Para quién es Gestión Global

Hay un equipo interno que la usa todos los días. Y hay tres tipos de
"afuera" que también la usan: los **clientes administradores** (cada uno
con su propio portal), los **partners comerciales** (con su portal de
rendiciones) y los **gestores externos**, que ni siquiera tienen cuenta y
entran por un link mágico cuando hace falta.

Es **single-tenant**: una sola Gestión Global como dueña, sin tabla
`empresas` ni `empresa_id`. Cada cliente es una *administración*, y los
edificios que administra son *consorcios* que cuelgan de ella.

### 1.3 Los principios que ordenan todo

Antes de entrar a las pantallas, conviene tener presentes seis decisiones
que se sienten en cada rincón:

**Primero, todo se persiste.** Cualquier acción que importe queda en la
base de datos. Nada de estado volátil que se pierda al recargar.

**Segundo, mobile-first.** Cada pantalla pasa por un audit a 360 px de
ancho. Si algo se rompe en el celular, se rompió antes de ir a
producción.

**Tercero, tres canales coherentes.** Cuando algo es importante (un avance
de un trámite, un vencimiento, una alarma), el sistema se comunica por
los tres medios al mismo tiempo: dashboard, email y push. Nunca por uno
solo.

**Cuarto, recordatorios humanos.** La agenda no te bombardea: te avisa
una vez a la hora del evento, te re-marca cada cinco horas si no lo
cerraste, y a las ocho de la noche cierra el día. Los pendientes de
ayer aparecen una sola vez a la mañana, entre las nueve y nueve y
veinte.

**Quinto, lenguaje rioplatense en lo interno.** El equipo lee "no te
cuelgues", "te marco de nuevo", "última por hoy". Es como una buena
mano derecha. El portal del cliente, en cambio, usa un tono más formal:
ahí estamos representando a la empresa.

**Sexto, premium en cada detalle.** Microinteracciones, animaciones que
respiran, ilustraciones cuando hay vacíos. La idea es que abrir Gestión
Global se sienta como un buen producto, no como una hoja de cálculo
disfrazada.

---

## 2. Los protagonistas

Toda historia tiene personajes. En Gestión Global son cuatro:

**La gerencia.** El equipo interno. Una persona o varias, todas con rol
`gerente`. Ven todo, hacen todo, son las dueñas operativas del sistema.
Aterrizan en `/gerencia`.

**El administrador.** El cliente. La persona o estudio que administra los
consorcios. María, por ejemplo. Entra a `/portal` y ahí ve su propia
vida: sus trámites en curso, su cuenta corriente, sus cursos, sus
vencimientos.

**El partner.** Un aliado comercial o proveedor que comparte un convenio
con Gestión Global. Tiene su panel propio en `/partner` con sus
rendiciones, su saldo evolutivo y los comprobantes donde participa.

**El gestor externo.** El más interesante: no tiene cuenta. Es alguien
tercerizado que recibe un trámite específico para resolver. Le llega un
email con un link mágico y entra a `/acceso/:token` a hacer su trabajo,
sin más login que ese token.

---

## 3. Un día en la gerencia

Imaginate la mañana. Abrís el navegador, vas a *gestionglobal.ar*, te
logueás con tu mail y tu contraseña, y aterrizás en **Inicio**.

Lo primero que ves es un saludo: *"Buenas noches, Paul."* (o buenos días,
según la hora). Abajo aparece la card de **Primeros 5 minutos**, que solo
existe si todavía no la cerraste: una checklist de cinco pasos que te
guían en el primer ingreso (crear tu primer cliente, registrar un trámite,
mirar la agenda, configurar la casilla, instalar la PWA).

Más abajo está el panorama del último mes: cuánto facturaste, cuánto
cobraste, qué deuda hay en pie, cuántos trámites están abiertos. Un
mini-gráfico de la facturación diaria te muestra los picos, y una grilla
de atajos te ofrece saltar directo a Clientes, Servicios, Facturación,
Trámites, Agenda o Finanzas.

### 3.1 El recorrido natural

El sidebar de la izquierda tiene nueve secciones. No tres, no quince:
nueve. Cada una corresponde a una zona del negocio:

- **Inicio** es el dashboard.
- **Captación** agrupa solicitudes y formularios públicos.
- **Clientes** lista a tus administraciones.
- **Trámites** muestra todos los expedientes en curso.
- **Agenda** es tu organizador ejecutivo personal.
- **Facturación** despliega Comprobantes, Cuenta corriente y Recupero.
- **Finanzas** abre Cajas, Conciliación y Partners.
- **Campus** muestra los cursos y los webinars.
- **Comunicaciones** es el panel para mandar novedades a tus clientes.
- **Analítica** te da inteligencia de negocio.
- Y abajo del todo, **Configuración**, con todo lo que necesitás dejar
  ajustado una vez (servicios, ARCA, plantillas de email, plantilla de
  consultoría jurídica, usuarios, bitácora, errores en runtime).

> El sidebar arrancó en 15 ítems. Lo reordenamos en nueve agrupando por
> flujo: Captación, Facturación y Finanzas se transformaron en grupos
> con sub-rutas en lugar de items sueltos. La diferencia se siente.

### 3.2 La pantalla de inicio

{{shot:gerencia-inicio|El panel de inicio recibe con un saludo personalizado, la card de "Primeros 5 minutos" si todavía no la cerraste, y el resumen de los últimos 30 días.}}

La card *Primeros 5 minutos* es deliberadamente persistente: hasta que no
marcás los cinco pasos (o la dismiss-eás con la X), te acompaña en cada
visita. Si la cerrás y querés volver a verla, está esperándote en
**Perfil → Ver el tour otra vez**.

Debajo del saludo aparece la **tarjeta de seguimientos del día**: te dice
en una frase si tenés trámites que cierran hoy o que ya están vencidos.
Y más abajo, los cuatro KPIs del último mes (Facturado, Cobrado, Deuda
total, Trámites abiertos) con un sparkline de la facturación diaria.

{{callout:tip|Pequeño truco del oficio: la card de seguimientos cambia el color del icono según el urgencia. Si la ves naranja, andá derecho a la agenda.}}

### 3.3 Captación — donde empieza todo

Cualquier persona en internet puede entrar a `gestionglobal.ar`, llenar
un formulario público, y eso crea una **solicitud** en tu panel. La
sección Captación es donde las atendés.

{{flowdiagram:captacion}}

Cada solicitud nueva trae un chip de estado: *Nueva*, *En análisis*,
*Derivada*, *Activada*, *Descartada*. Las nuevas te avisan también con
un push y aparecen como tarjeta destacada en el dashboard de inicio.

Sobre cada una podés:

**Analizar.** Agregar notas internas, ver los datos cargados, decidir
qué hacer.

**Derivar a sector de gestoría.** El sistema agrega automáticamente una
línea "Envío a sector de gestoría" al trámite cuando lo hacés. Te
ahorrás escribirla.

**Activar como cliente.** Un wizard de tres pasos que valida los datos,
crea la administración (con sus consorcios) y genera el email de
bienvenida con las credenciales reales para que el cliente pueda
loguearse. Si el CUIT ya existe, te ofrece asociar la solicitud a la
administración existente en lugar de duplicarla — ese cruce viene de la
regla del "Bloque J", y es uno de esos detalles que se sienten cuando
los usás.

**Descartar.** Con motivo. Queda para auditoría.

### 3.4 Clientes — las administraciones

{{shot:gerencia-clientes|Listado de administraciones con KPIs, búsqueda, filtro de estado y exports a PDF/XLS. Click en una fila te lleva al detalle del cliente.}}

Cada cliente es una **administración**. La pantalla los lista con tres
KPIs arriba (En la vista, Activos, Total de consorcios) y una tabla con
nombre, código, CUIT, cantidad de consorcios y estado.

Clickeando una fila entrás al **detalle de la administración**, con
tabs internas:

- *Datos*: razón social, CUIT, domicilio, contacto, consorcios
  asociados.
- *Trámites*: el historial completo de los expedientes del cliente.
- *Cuenta corriente*: comprobantes y cobranzas con saldo evolutivo.
- *Webinars*: en qué eventos se inscribió, asistencia, conversiones.
- *Convenio*: el porcentaje de bonificación que aplica a sus
  comprobantes.

{{callout:why|¿Por qué la administración tiene tantos lados? Porque en la práctica un cliente no es solo "alguien que paga". Es alguien que tiene trámites abiertos, deuda pendiente, capacitaciones a las que asistió, condiciones comerciales propias. Verlo todo en un solo lugar evita ir saltando entre módulos.}}

### 3.5 Trámites — el corazón de la operación

{{shot:gerencia-tramites|Listado de trámites con KPIs por estado, búsqueda y filtros. Toggle Lista ↔ Kanban en el header.}}

Cada trámite es un expediente con su categoría (Matriculación,
Renovación RPAC, DDJJ, Consulta jurídica, Reclamo), un asignado, un SLA
y un código tipo `TRM-2026-#####`.

La lista te da cuatro KPIs arriba (Abiertos, Resueltos, Sin asignar,
Vencidos) y un toggle **Lista ↔ Kanban**: cuando preferís ver el flujo
visual por columnas de estado, la vista Kanban te lo da.

**El detalle de un trámite** es una página completa, no un modal. Eso fue
una decisión consciente (la observación 12 de los relevamientos): los
avances necesitan espacio. Arriba tenés el header con código + título +
chips. Después un **timeline visual** de cada movimiento, ordenado
cronológicamente. Podés alternar entre vista lineal y vista timeline.

{{flowdiagram:tramite}}

Para agregar un avance, hay un formulario en la parte de abajo. Cargás
título, descripción y archivos opcionales. Acá viene el detalle clave:
un toggle **"Visible para el cliente"**.

Cuando lo activás, el sistema:

1. Encola el email `tracking-avance-cliente` con la plantilla MANAXER.
2. Inserta una notificación en la campanita del portal del cliente.
3. Manda un push (si el cliente lo tiene activado).

Es decir: tres canales, sincronizados, sin que tengas que pensar.

**Drag & drop de archivos.** Si soltás un PDF, una imagen o un Excel
sobre la pantalla del trámite, queda adjuntado directo, sin pasar por
botones de upload. Es el detalle ese que te ahorra clicks.

**Pedidos de documentación.** Si te faltan papeles, hay una sección
específica para pedirlos: el cliente recibe un email con el listado y un
botón directo a la subida.

**Cerrar el trámite.** Cuando está listo, el botón abajo dice **"Cerrar
trámite"** — y si el servicio asociado tiene `vigencia_meses` definida,
dice **"Cerrar trámite y programar próximo vencimiento"**. En ese caso
se abre un modal que pre-rellena la fecha sugerida del próximo
vencimiento (hoy + vigencia × 30.4375 días), y al confirmar deja el
vencimiento agendado para que aparezca en la Agenda y dispare alertas
cuando se acerque.

### 3.6 Agenda — tu organizador personal

{{shot:gerencia-agenda|La Agenda es tu organizador ejecutivo personal: tirá lo que tengas en la cabeza, el sistema lo ordena.}}

Si hay una pantalla que vale la pena que conozcas bien, es esta. La
Agenda fue diseñada como un *organizador ejecutivo personal*, no como
un CRM ni una herramienta colaborativa. Es tuya, sólo tuya. Es donde
"tirás lo que tenés en la cabeza" y el sistema se encarga de ordenarlo.

El subtítulo permanente lo dice así: *"Tirá lo que tengas en la cabeza —
yo lo ordeno."* No es una frase decorativa: es un contrato.

**Cuatro vistas, dos tabs.** Arriba podés elegir Lista, Día, Semana
(default) o Mes. Y al costado tenés dos tabs: *Mi agenda* (eventos
propios) y *Vencimientos* (todos los vencimientos proyectados de
servicios renovables del negocio).

**Filtros con chips.** Activás o desactivás categorías clickeando: Todo,
Personal, Vencimientos, Trámites, Cobranzas, Solicitudes, Alarmas
tracking. Hay un chip *"Qué es cada uno"* que te explica con un popover
qué incluye cada categoría. Y un *"Solo lo mío"* que filtra solo los
eventos donde sos el responsable.

#### La barra mágica

Es probablemente la feature más característica. Un input con un sparkle
arriba de todo, que entiende lenguaje natural rioplatense. Tipeás:

```
Llamar a la administración mañana 9am #cobranzas
Pagar AFIP 15/06 !alta
Revisar expediente lunes próximo 14h !urgente #tramites
```

…y al apretar Enter te crea el evento. El parser entiende:

- **Fechas relativas**: hoy, mañana, próximo lunes, en 3 días, 15/06,
  etc.
- **Horas**: 9am, 9:00, 14h, 14:30.
- **Categoría** con `#nombre`.
- **Prioridad** con `!alta`, `!media`, `!baja`, `!urgente`.

Hasta que no apretás Enter, nada se persiste. Si te equivocás y
escribís de más, simplemente borrás el input.

#### Gestos premium

Sobre las vistas de Día y Semana podés interactuar con los bloques
como si fueran físicos:

- **Pintar** una franja en una columna vacía abre el modal con un
  borrador del evento (no persiste hasta que confirmás).
- **Drag** sobre un bloque lo mueve, con snap de 15 minutos. El sistema
  distingue tap de drag para que un click rápido no termine moviendo el
  evento por accidente.
- **Resize** desde la manija inferior cambia la hora de fin.
- **Click derecho** (o long-press en mobile) abre el **menú de
  acciones** flotante con: marcar como hecha, editar, posponer
  (1 día / 1 semana / 1 mes / personalizado), eliminar (o saltear la
  ocurrencia si es recurrente). Posponer es siempre relativo a la
  **fecha del evento**, no a hoy.

#### Recurrencia virtual

Cuando creás un evento recurrente, la regla queda guardada en una sola
fila. Las ocurrencias no se materializan: se calculan en runtime para
el rango que estás mirando. Si movés una ocurrencia específica, se
guarda solo esa excepción. El sistema es eficiente y mantenible.

#### Modal con panel lateral

Cuando creás o editás un evento, el modal tiene dos capas. Lo básico
(título, fecha, hora, categoría, prioridad, notas) está siempre visible.
Si querés vincular el evento a una entidad del negocio (un consorcio,
una administración, un comprobante, un trámite), tocás "Agregar
vínculos" y se despliega un panel lateral animado hacia la derecha.
**El modal nunca crece hacia abajo** — esa era una regla de oro para
mobile.

#### Modo enfoque

Hay un toggle que dice *Modo enfoque*. Cuando lo activás, la Agenda
oculta todas las proyecciones (vencimientos, trámites, cobranzas) y te
deja solo con tus eventos propios. Para los momentos en que necesitás
concentrarte.

#### Recordatorios con cadencia humana

Esto es importante. El sistema **no te bombardea**. La cadencia es:

- **A la hora del evento**, primer aviso (09:00 si el evento es de
  día completo).
- **Cada 5 horas**, re-alerta mientras el evento siga pendiente y
  siga siendo hoy.
- **A las 20:00**, aviso de cierre — una sola vez por evento por día.
- **Pendientes de días anteriores**: un solo push suave a la mañana,
  entre 09:00 y 09:20.

Los textos del backend están escritos en el tono que el sistema usa con
vos: *"👀 No te cuelgues: «…»"*, *"⏰ Te marco de nuevo: «…»"*,
*"🌙 Última por hoy. Si ya no llegás…"*.

Las alarmas configurables tipo Google (2 días antes, 1 día antes, 1
hora antes) están **descartadas a propósito**. Se evaluó y se concluyó
que generan ruido sin valor real.

#### Exportar a iCal

Dos botones en el header te dejan bajar el `.ics`: *Exportar mis
eventos* (solo personales) o *Exportar todo* (con vencimientos,
trámites y cobranzas proyectados incluidos). Lo importás a Google
Calendar, Outlook o Apple Calendar y queda sincronizado.

#### Atajos de teclado

| Tecla       | Acción                          |
|-------------|---------------------------------|
| `J` o `←`   | Período anterior                |
| `K` o `→`   | Período siguiente               |
| `T`         | Saltar a hoy                    |
| `1..4`      | Lista / Día / Semana / Mes      |
| `N`         | Nuevo evento                    |
| `⌘K`        | Command palette scope-aware     |

Cuando abrís `⌘K` dentro de la agenda, las acciones disponibles son
específicas: *Ir a hoy*, *Ir a mañana*, *Ir al próximo lunes*,
*Activar/desactivar Modo enfoque*, *Exportar a iCal*.

### 3.7 Facturación

{{shot:gerencia-facturacion|Comprobantes simples (X) y fiscales (A/B/C con autorización ARCA). KPIs por mes, filtros, exports, y botón + Nuevo comprobante.}}

Tres sub-secciones cuelgan de Facturación: Comprobantes, Cuenta corriente
y Recupero.

#### Comprobantes

La premisa que ordena todo este módulo es *"simple primero, fiscal
opcional"*. Podés emitir un **comprobante X** (no fiscal) en segundos:
sirve para registrar cobros, mandar al cliente y trackear el saldo. Y si
después necesitás que sea factura A, B o C, hay un botón **"Realizar
factura"** que dispara la autorización ARCA con CAE — sin tener que
recrear el comprobante.

Para crear uno nuevo, un wizard te guía en tres pasos:

1. **Receptor**: elegís cliente y consorcio. El sistema autocompleta
   razón social, CUIT, condición IVA.
2. **Líneas**: agregás servicios del catálogo. Cada uno trae su
   precio de referencia. Si lo cambiás, el sistema te ofrece tres
   opciones: solo para este comprobante, para todo este cliente, o
   como regla general del servicio. Y queda registrado en bitácora,
   por si después querés revisar la decisión.
3. **Cobranza opcional**: si el comprobante ya está cobrado, registrás
   el movimiento de caja directo, sin pasos extra.

Al guardar, el sistema persiste el comprobante, genera el PDF, encola
el email al cliente, y si es A/B/C dispara el job ARCA que devuelve el
CAE en segundos. Si la cobranza venía incluida, el movimiento queda
imputado contra ese comprobante.

**Para cobrar un comprobante después**, entrás al detalle y tocás
"+ Cobranza". Modal con caja, fecha y monto. Permite cobranza parcial.
El saldo del comprobante se recalcula derivado (no se guarda, se
infiere) — eso evita inconsistencias.

#### Cuenta corriente global

{{shot:gerencia-cuenta-corriente|Cuenta corriente consolidada por administración. Cuando no hay match con los filtros, una ilustración te lo dice con calma.}}

Es el resumen consolidado por administración. Cuatro KPIs arriba
(Facturado, Cobrado, Pendiente, Vencidos) y una tabla con cada cliente,
su saldo y la cantidad de comprobantes pendientes o vencidos.

Si no hay datos, te aparece una ilustración con triángulos cyan/teal y
un símbolo que cambia según el caso: un edificio si no hay clientes
todavía (con CTA "Importar histórico"), una lupa si hay clientes pero
los filtros no devolvieron nada.

**Importar histórico.** Si arrancás Gestión Global con un Excel viejo
de movimientos, hay un wizard que te guía: descargás la plantilla,
completás los movimientos, la subís, el sistema te muestra preview y
matches sugeridos, confirmás. El parser es tolerante: acepta separadores
`,` o `;`, fechas en cualquier formato y montos AR (`1.234,56`) o US
(`1,234.56`).

#### Recupero

Tres niveles de recupero, R1, R2 y R3, con plantillas de email y SLA
distintos. La pantalla agrupa las administraciones con deuda y te deja
disparar la campaña por nivel.

### 3.8 Finanzas

{{shot:gerencia-finanzas|Finanzas con saldos de cajas activas, movimientos recientes y action bar con todas las operaciones disponibles.}}

Tres sub-secciones: Cajas y movimientos, Conciliación, Partners.

#### Cajas y movimientos

Cuatro cajas por defecto: Banco principal, Billetera virtual, Plazo
fijo, Efectivo. Y podés crear cajas custom desde el panel de admin.

En el header tenés un botón para cada operación: PDF/XLS/Reportes (con
flujo de caja, balance mensual, P&G por categoría, comparativo año vs
año), Conciliar, Importar histórico, Admin (CRUD de cajas y categorías),
Transferir y + Nuevo movimiento.

**Transferir** abre un modal con caja origen, caja destino, monto y
fecha. Genera **dos movimientos linkeados** atómicamente (egreso en
origen, ingreso en destino).

**Anular o revertir un movimiento.** Anular lo marca como inválido
(queda visible pero excluido de balances). Revertir crea un movimiento
espejo. Las correcciones quedan auditables.

#### Conciliación bancaria

Cuando importás un extracto bancario en CSV, el motor sugiere matches
con tus movimientos del sistema (mismo monto, misma caja, mismo tipo,
ventana de ±5 días). Por cada línea del extracto decidís: vincular con
un movimiento existente (eligiendo entre los sugeridos), crear uno
nuevo, o ignorar (saldo inicial, error del banco, línea informativa).

Hay una funcionalidad de "aprender patrón": si la descripción de la
línea matchea con algo que ya conciliaste antes, el sistema te
sugiere la misma categoría y administración. Va aprendiendo.

#### Partners

Lista los partners con convenio. Para cada uno ves su porcentaje, su
saldo evolutivo y los comprobantes asignados. Acá es donde marcás los
comprobantes con flag "participa partner" — los que cuando llegue el
fin de mes van a aparecer en la rendición del partner.

### 3.9 Campus

{{shot:gerencia-campus|Campus virtual con cursos asincrónicos y encuentros sincrónicos. Vinculá inscripciones a tus formularios.}}

El Campus es el subsistema #7 del documento maestro y tiene su propia
mecánica. Cada curso tiene tabs: Datos generales, Módulos y clases
(editor L1 con drag-and-drop, cropper de imágenes, publicación con
fecha), Inscripciones, Encuentros sincrónicos (Zoom), Exámenes
(múltiple choice y verdadero/falso con autocorrección), Certificado
(con esquema visual editable, snapshot al emitir), Encuesta de
satisfacción.

Los encuentros en vivo usan **Zoom simplificado**: un link grande,
asistencia automática vía webhooks. Webex quedó como scaffold latente
por si en algún momento se reactiva.

### 3.10 Comunicaciones

{{shot:gerencia-comunicaciones|Panel de comunicaciones multi-canal: dashboard + email + push, a una audiencia segmentada por servicio o convenio.}}

Es el subsistema más reciente. Un panel que te deja mandar una misma
comunicación por **dashboard banner + email + push** (o cualquier
combinación) a un subconjunto de administraciones.

Para crear una, abrís el drawer lateral, ponés título y cuerpo
(markdown). Elegís audiencia:

- *Todos los clientes*.
- *Manual*: seleccionás administraciones a mano.
- *Por servicios*: todas las que tienen tal servicio activo.
- *Por convenio*: todas las que tienen tal convenio.

Marcás los canales (mínimo uno). El sistema te muestra preview de
destinatarios con la cantidad y la lista. Apretás *Enviar ahora* o
*Guardar borrador*.

Al enviar: si marcaste email, encola en la cola con la plantilla
`comunicacion-novedad`. Si marcaste push, encola en la cola de Web
Push. Si marcaste dashboard, el portal del cliente lo muestra como
banner hasta que el cliente lo marca como visto.

### 3.11 Analítica

{{shot:gerencia-analitica|Analítica avanzada: facturación mensual, cobranzas, top clientes, mix de servicios, funnel de conversión.}}

Inteligencia de negocio con selector de período. KPIs (Facturación 12M,
Cobranzas 12M, Top clientes, Conversión solicitudes → activadas),
gráficos de facturación y cobranzas mensuales, top clientes por
facturación, mix de servicios y funnel de conversión.

---

## 4. El portal del administrador · la mirada de María

Cambiemos de protagonista. Soy María, administradora de consorcios. Hace
un mes activé mi cuenta en Gestión Global y desde entonces uso el portal
varias veces por semana.

Esta es mi experiencia.

### 4.1 La puerta de entrada

Recibo un email de bienvenida cuando me dan de alta. Tiene mis
credenciales reales, no un magic link de un solo uso, y un botón que me
manda directo al portal. Entro a `gestionglobal.ar`, me logueo con mi
mail y mi clave, y como soy `administrador`, el sistema me lleva
automáticamente a `/portal`.

{{shot:portal-home|El portal del administrador me recibe con un saludo personalizado, mis KPIs (cursos activos, gestiones abiertas), las acciones requeridas y las oportunidades del mes.}}

Lo primero que veo es mi nombre en el saludo: *"Buenas noches, María,
bienvenido."* Abajo, mi razón social y un chip verde con mi número de
matrícula. A la derecha, dos KPIs: cuántos cursos tengo activos, cuántas
gestiones abiertas.

### 4.2 El banner que me cuida

Si todavía no activé las notificaciones push, me aparece un banner cyan
que se llama *"Activá las notificaciones · No te pierdas ninguna
novedad."* Es el `ActivarPushAssistant` y es universal: detecta mi
navegador y mi sistema operativo, y me guía con instrucciones específicas
para iOS Safari (instalar la PWA primero), Chrome iOS PWA, Android,
Chrome o Safari de escritorio.

### 4.3 Las cards que importan ahora

Después aparecen cards contextuales. Algunas son **alertas**:

- *"Acción requerida — Necesitamos documentación para tu trámite."*
  Con el código del trámite, el servicio asociado y un botón "Subir
  docs →" que me lleva al detalle. La gerencia me pidió papeles, yo
  los subo y avanzamos.

- *"Oportunidad — Renová tu matrícula RPAC."* Si mi matrícula vence en
  los próximos 30 días, me aparece esta tarjeta con un CTA "Iniciar
  renovación" que arranca el trámite.

Otras son **sugerencias** ("Sugerido para vos"):

- *"Tu DDJJ vence pronto."* Con los días que faltan y el botón
  "Iniciar DDJJ →".
- *"Cumplí con tu actualización del año."* Recordatorio de la
  capacitación anual obligatoria.
- *"Webinar gratuito — Liquidación de expensas avanzada."* El próximo
  webinar abierto al que puedo inscribirme.

{{callout:why|¿Por qué las cards son contextuales y no un listado fijo? Porque cada cliente vive un momento distinto. Si tu matrícula está al día, no tiene sentido que veas la card de renovación. Las cards aparecen y desaparecen según lo que está pasando con vos.}}

### 4.4 Mis cursos activos

Más abajo veo los cursos en los que estoy matriculada con badge de
modalidad (Mixta, Asincrónica, Sincrónica) y vigencia. Click en uno y
entro al detalle: módulos, clases, exámenes, encuentros sincrónicos
si los hay, certificado cuando lo termine.

### 4.5 Próximos vencimientos

Y al pie, una lista de mis próximos vencimientos ordenados por fecha.
Cada item dice el título, una descripción corta y "en N días". Si me
pierdo, sé adónde mirar.

### 4.6 Mi cuenta corriente

{{shot:portal-cuenta-corriente|La cuenta corriente del cliente con saldo evolutivo: cargos, cobranzas y saldo acumulado al final de cada línea.}}

Cuando voy a `/portal/cuenta-corriente` veo mi saldo. Una tarjeta hero
me dice si tengo deuda o estoy al día. Tres mini-KPIs (Cargos,
Cobranzas, Total de movimientos) y una tabla con orden cronológico
FIFO: cada línea muestra fecha, descripción, cargo o cobranza, y el
saldo acumulado al final.

Si un comprobante tiene factura PDF disponible, hay un link "Descargar
factura" para bajármela.

### 4.7 Mis gestiones

En `/portal/gestiones` veo el listado de mis trámites en curso. Cada
uno con su estado, su asignado y un timeline visual de los avances que
la gerencia me hizo visibles. Si hay docs pendientes que tengo que
subir, hay un botón directo.

### 4.8 Mis webinars

En `/portal/webinars`, los webinars donde me inscribí. Cada uno con
badge (Próximo, En curso, Pasado). Si está activo, hay botón
"Acceder" que me lleva al embed o al link externo de Zoom.

### 4.9 Pedir un servicio nuevo

Desde `/portal/nuevo-servicio` puedo generar yo misma una nueva
solicitud, sin tener que escribir un email. Elijo el servicio del
catálogo público, completo los datos del consorcio, y la solicitud
queda en el panel de la gerencia para que la analicen.

### 4.10 Mi perfil

En `/portal/mi-cuenta` veo mis datos personales y los de la
administración (algunos editables, otros no). Desde ahí también activo
o desactivo el push, y cierro sesión.

---

## 5. El aliado partner

Funplata es uno de los partners de Gestión Global. Es un emisor fiscal
alternativo y participa de algunos comprobantes con un porcentaje de
convenio.

{{shot:partner-rendiciones|El portal del partner muestra movimientos detallados con saldo evolutivo, resumen por período y comprobantes asignados con su estado de facturación.}}

Cuando el partner entra a `gestionglobal.ar/partner`, ve una sola
pantalla: *"Mis rendiciones y comprobantes."*

### 5.1 Mi caja, mis movimientos

Una tarjeta arriba lista los movimientos atribuidos al partner con su
porcentaje aplicado. Tres KPIs (Ingresos atribuidos, Egresos
atribuidos, Saldo evolutivo) y la tabla detalle por movimiento. Si no
hay movimientos en el período, lo dice con calma.

### 5.2 Resumen por período

Una tabla resumen donde cada fila es un período (mes típicamente):
fechas, estado (Borrador o Cerrado), ingresos base y atribuidos,
costos base y atribuidos. Es lo que el partner ve mes a mes para
verificar lo que le corresponde.

### 5.3 Comprobantes asignados

Y al final, los comprobantes donde el partner participa: tipo, punto
de venta, número, receptor, fecha, total, estado y estado de
facturación. Si un comprobante necesita que el partner emita la
factura, hay un botón **"Realizar factura"** que dispara el wizard de
emisión con el emisor fiscal del partner pre-seleccionado.

Cuando hace la factura, el sistema:

1. Genera el CAE vía ARCA con el certificado del partner.
2. Adjunta el PDF al comprobante original.
3. Cambia el estado a "Facturado" con el número fiscal.

El comprobante original sigue siendo el mismo, pero ahora tiene su
contraparte fiscal hecha por el partner correspondiente.

---

## 6. El gestor externo · el aliado sin cuenta

Esta es la historia más particular. El gestor externo no tiene cuenta.
Nunca se loguea. Aparece y desaparece según el trámite.

### 6.1 Cómo llega

Cuando la gerencia decide tercerizar un trámite, lo deriva a un gestor
externo. El sistema genera un **token mágico** con vencimiento
configurable (default 30 días, ajustable desde Configuración) y se lo
manda al gestor por email con un enlace tipo
`gestionglobal.ar/acceso/A1B2C3D4E5...`.

### 6.2 Qué ve

Al clickear el enlace, el gestor aterriza en un panel limpio, sin
sidebar. Solo ve **el trámite que le corresponde**. No puede navegar
a ningún otro: el token está vinculado a un único trámite.

Lo que tiene disponible:

- Los datos del trámite: tipo de servicio, cliente, consorcio, breve
  descripción.
- La documentación adjunta (descargable).
- Un campo para **subir nuevos avances** con texto, archivos
  ilimitados (no hay límite arbitrario), y un selector de estado
  actual.
- Un botón **"Descargar info del trámite"** que genera un PDF con
  todo lo del expediente, para tener en papel.

### 6.3 El print stylesheet

Si el gestor aprieta `⌘P` o `Ctrl+P`, el CSS de impresión oculta
el header, los botones y el scroll, y deja solo el contenido del
trámite. Sale impreso como un expediente limpio, listo para archivar.

### 6.4 Cuando el token vence

Si el token expira, el gestor ve una pantalla que dice "Link expirado"
con un CTA **"Pedir link nuevo"** que envía un email a la gerencia.
Desde el panel, la gerencia regenera el token y el gestor recibe un
nuevo email.

### 6.5 La traza interna

Cada vez que el gestor sube algo, queda registrado: cuándo entró, qué
archivos subió, qué texto escribió, desde qué IP. La gerencia ve toda
esa actividad en el detalle interno del trámite, marcada con badge
"gestor externo".

---

## 7. Campus, webinars y comunicaciones

### 7.1 El Campus visto desde la alumna

María se inscribió al *Curso Integral de Formación de Administrador de
Consorcios 2026*. Desde su portal, en *Mis cursos activos*, ve la card
y le hace click.

Entra al curso, ve los módulos publicados, las clases (cada una con su
video embed, descripción y bibliografía descargable), los encuentros
sincrónicos agendados (con link de Zoom o YouTube Live según el
caso), los exámenes que tiene que rendir y el certificado pendiente.

Cuando termine las condiciones (cursar todo + aprobar exámenes), el
motor le emite el certificado automáticamente. El PDF tiene QR de
verificación: cualquier persona puede ir a
`gestionglobal.ar/verificar/<código>` y confirmar que es auténtico.

### 7.2 Webinars

Los webinars son eventos abiertos: cualquiera puede inscribirse
llenando el formulario público. Al hacerlo, queda como **prospecto** si
no es cliente, o se asocia a la administración si lo es.

Cada inscripto recibe un magic-link único hacia
`gestionglobal.ar/campus/webinar/:token`. Esa página le muestra los
datos del evento, el link de acceso (Zoom o YouTube Live, depende del
canal elegido para ese webinar), y se diferencia según el caso:

- Si es **cliente**, ve solo el contenido del webinar.
- Si es **prospecto**, ve además una CTA al pie ("Conocé el campus de
  Gestión Global") que lo invita a convertirse.

La gerencia ve los inscriptos en
`gestionglobal.ar/gerencia/webinars`, con métricas de asistencia,
conversión prospecto → cliente, y panel de prospectos donde convierte
con un click.

### 7.3 Comunicaciones

Ya las contamos en el capítulo 3. Acá nos enfocamos en para qué sirven.

Las comunicaciones son la forma de hablar con todos los clientes (o un
subconjunto) sin tener que mandar correos a mano. Casos típicos:

- *Aviso de nueva resolución de CUCICBA*: a todas las administraciones
  con servicios RPAC activos.
- *Recordatorio de feriado largo*: a todos los clientes.
- *Lanzamiento de capacitación nueva*: a los que tienen convenio
  con descuento en capacitaciones.

Cada comunicación queda registrada con su audiencia y los destinatarios
que la marcaron como vista. Es trazable.

---

## 8. Cómo conversa el sistema

Gestión Global se comunica con vos y con los clientes por tres canales
sincronizados. Conviene entender la lógica de cada uno.

### 8.1 La campanita (in-app)

Es el botón con icono de campana arriba a la derecha. Tiene un badge
rojo con el número de no leídas. Click → dropdown con las últimas
notificaciones: icono + título + cuerpo + tiempo relativo.

Si el cuerpo de una notificación es largo (más de lo que cabe en la
fila), click sobre el ítem **abre un modal con el contenido completo**
y cierra el dropdown automáticamente. Ese detalle vino de un pedido
real: las notas internas a veces son párrafos enteros y no se podían
leer.

Hay tres acciones en el footer: *Marcar todas como leídas*, *Limpiar*
(borra el historial), *Ir al recurso* (que es el click sobre la
notificación misma).

### 8.2 El push

Notificación que llega al teléfono o al desktop. Web Push estándar con
VAPID + Service Worker. La PWA debe estar instalada para que funcione
en iOS Safari (en iOS, las web push sólo funcionan sobre PWAs
instaladas en el home).

El asistente `ActivarPushAssistant` te guía paso por paso según tu
combinación de navegador y sistema operativo. No te asume nada.

### 8.3 El email

Templates en *Configuración → Plantillas email*. Hay 32 plantillas
activas, agrupadas por casilla: General (contacto@), Cursos
(cursos@), Jurídico (juridico@), Webinar (webinar@). Cada casilla
manda con su OAuth token específico.

El sistema soporta multi-casilla con refresh tokens almacenados
encriptados. DKIM está activo en el dominio para máxima entregabilidad.

### 8.4 La regla de los tres canales

Cuando algo es importante (un avance visible para el cliente, una
alarma, un vencimiento), el sistema dispara **los tres canales al
mismo tiempo**. Eso garantiza que el cliente reciba la información por
el canal que más use:

- Si entra al portal, lo ve en la campanita.
- Si abre el mail, lo lee ahí.
- Si tiene la app en el teléfono, le suena.

Y si tiene los tres activos, los tres se sincronizan: marcar leída en
uno marca leída en el otro.

### 8.5 La frase del día

Una vez al día, a las 08:00 ART, el sistema te manda una frase
motivacional al portal y al push. Con icono de libro. Pequeña pero
linda.

### 8.6 Bounce y reply harvester

Cada 30 minutos, un cron consulta las casillas Gmail vía OAuth. Si
hay un bounce (dirección inválida), marca al destinatario para que la
gerencia lo vea. Si hay una respuesta de un cliente a un email
automático, queda en el panel de comunicaciones de gerencia para que
alguien la atienda.

Evaluamos pasar a Gmail Pub/Sub para tiempo real, pero el cron de 30
minutos cubre el caso de uso: el volumen de respuestas es bajo y la
latencia no es crítica.

---

## 9. Configuración

Es la sección que más se toca al principio y menos después de los
primeros días. Pero conviene saber qué hay.

### 9.1 Servicios (catálogo)

El catálogo de servicios. Cada uno con: slug, nombre, descripción,
categoría, precio público, precio cliente, `vigencia_meses` (para
servicios renovables), precio de referencia (para pre-fill al crear
comprobante), voucher PDF si aplica.

Las categorías son: RPAC · Buenos Aires, RPA · CABA, Capacitación,
Plataforma SaaS, Asesoría jurídica, Comunidad. Cada cambio queda en
bitácora con el motivo.

### 9.2 ARCA · facturación

Configuración de ARCA: subida del certificado, CSR, alias, test con
el padrón. La cola de emisión en tiempo real (cada job tiene su
estado). Y la configuración del intervalo entre emisiones
(`arca_intervalo_emision_seg` en `config_global`).

Soporta segundo emisor fiscal (Fundplata), que se activa con un toggle.

### 9.3 Plantillas email

{{shot:gerencia-plantillas|Editor de plantillas de email con preview en vivo. 32 plantillas activas con datos de ejemplo poblando el render.}}

Las 32 plantillas con editor en vivo. Por cada una: slug, casilla,
header (kicker, título, asunto, color de acento), cuerpo HTML visual con
variables Mustache, botón "Enviar prueba a mi mail", "Guardar
plantilla", y panel derecho con **preview en vivo** que se actualiza a
medida que tipeás, usando datos de ejemplo.

Layout MANAXER v1 con tipografía premium.

### 9.4 Generación CJ

Generador de Consultoría Jurídica PDF. Cargás los datos del cliente,
el texto custom, la firma del abogado. El PDF queda en el historial.
Útil para los servicios de asesoría jurídica.

### 9.5 Usuarios

Alta de gerentes, partners, gestores fijos. Roles disponibles:
`gerente`, `administrador`, `partner`. Email + password inicial.

### 9.6 Bitácora de cambios

Auditoría de cambios sensibles: ediciones de precio en comprobantes,
anulaciones, reversiones, cambios en convenios, cambios en config
global.

### 9.7 Errores en runtime

Agregado de errores con stack trace, cantidad de ocurrencias, última
vez visto. Integrado con Sentry.

---

## 10. Bajo el capó

Una visión técnica breve, para quien necesite mantener el sistema.

### 10.1 Stack

- **Frontend**: React 18 + TypeScript + Vite 6 + Tailwind + lucide.
- **Backend**: Supabase (Postgres 17 + Auth + Storage + Edge Functions
  Deno).
- **Scheduler**: pg_cron + pg_net.
- **Push**: Web Push VAPID + Service Worker.
- **ARCA**: SOAP nativo con node-forge.
- **Email**: Workspace SMTP + OAuth tokens por casilla.
- **CI/CD**: GitHub → Vercel (auto-deploy).

### 10.2 Variables de entorno

Ver `.env.example`. Cliente Vite tiene `VITE_*`. Edge functions tienen
secrets de Supabase: `CRON_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`,
`WORKSPACE_SMTP_*`, `GOOGLE_OAUTH_*`, `VAPID_*`, `ZOOM_*`.

### 10.3 Migraciones

Toda mutación de schema vive en `supabase/migrations/`. Numeradas
correlativamente. Todo `CREATE TABLE public.*` post-mig 0130 incluye
GRANTs explícitos. Aplicación:

```bash
supabase db push
bash scripts/generate-types.sh   # regenerar TS types
```

### 10.4 Edge functions

Todas las edge functions de producción tienen archivo en
`supabase/functions/`. Drift entre prod y repo es un bug. Deploy:

```bash
supabase functions deploy <name>
```

### 10.5 Cortina de mantenimiento

Toggle `config_global.landing_cover_enabled`. Si está `true`, todas
las rutas públicas muestran "Proyectando mejoras extraordinarias". Se
puede cambiar con UPDATE o con el toggle en la footer del sidebar de
gerencia.

### 10.6 Reset de password

Sin flujo de UI todavía. Por DB:

```sql
UPDATE auth.users
SET encrypted_password = crypt('NuevaPass2026!', gen_salt('bf'))
WHERE email = 'user@ejemplo.com';
```

---

## 11. Cuando algo no anda

### 11.1 No llega el email

Mirá *Configuración → Plantillas email → Cola de envíos*. Si el job
está en `enviado`, ya salió: revisá Promociones o Spam del
destinatario. Si está en `error`, ahí tenés el motivo (token vencido,
bounce, dirección inválida). DKIM está activo pero la primera vez puede
caer en Promociones; pedile al destinatario que lo marque como "No es
spam".

### 11.2 No llega el push

Primero verificá que el navegador lo soporte (en iOS, solo PWA
instalada). Luego revisá `push_subscriptions` (tiene que haber fila
para ese usuario) y `push_notifications_queue` (no debería haber jobs
en `error`). Si rotaste las VAPID keys, todas las suscripciones
quedaron inválidas — hay que re-subscribirse.

### 11.3 ARCA no autoriza

El comprobante tiene estado `error_arca` con un mensaje específico.
Errores comunes: certificado vencido (renovar en Configuración → ARCA),
CUIT del receptor inválido (corregir y reintentar), rate limit ARCA
(esperar el intervalo configurado). Hay botón "Reintentar" en el
detalle del comprobante.

### 11.4 La Agenda no muestra mis eventos

Verificá los chips (¿está activado *Todo* o solo algunos?), el toggle
*Solo lo mío*, y el modo enfoque (que oculta proyecciones, no
eventos propios). Si nada se muestra: chequear que
`agenda_events.owner_id = auth.uid()`.

### 11.5 Pantalla rota en mobile

Reproducir a 360 px. Si algo usa `window.confirm/alert/prompt`, eso
rompe (regla 13). Debe ser `useConfirm/useAlert/usePrompt` del
`DialogProvider`. Verificar también `safe-area-inset-bottom` en barras
inferiores cuando es PWA en iOS.

### 11.6 Login va pero redirige a otra área

El sistema usa `profiles.role` para enrutar. Verificar:

```sql
SELECT id, full_name, role FROM profiles WHERE id = 'USER_ID';
```

Si está mal, UPDATE manual.

### 11.7 Trámite no permite agregar avance visible

El cliente tiene que tener `administracion.user_id` poblado. Sin eso,
no se le puede mandar email o push.

### 11.8 Build TS roto tras migración

Regenerar tipos:

```bash
bash scripts/generate-types.sh
# o manual:
npx supabase gen types typescript --project-id <ID> > src/types/database.types.ts
```

---

## 12. Glosario

| Término | Significado |
|---|---|
| **Administración** | Cliente. Persona o estudio que administra consorcios. |
| **Consorcio** | Edificio bajo gestión de una administración. |
| **Trámite / Tracking** | Expediente que se le abre a un cliente para un servicio. *Trámite* para el cliente, *Tracking* para la gerencia. |
| **Servicio** | Item del catálogo (RPAC, DDJJ, consultoría). |
| **Comprobante** | Factura (X / A / B / C) emitida al cliente. |
| **Movimiento** | Línea de caja (ingreso, egreso, transferencia). |
| **Imputación** | Vínculo entre un movimiento (cobranza) y un comprobante (deuda). |
| **Vencimiento** | Fecha próxima donde hay que renovar / pagar / actuar. |
| **Solicitud** | Lead de captación: alguien llenó un formulario público. |
| **Prospecto** | Inscripto a webinar que no es cliente todavía. |
| **Partner** | Aliado comercial con rendición de cuentas. |
| **Gestor externo** | Tercero que gestiona un trámite específico (acceso por token). |
| **Campus** | Subsistema de cursos y webinars. |
| **MDC / MANAXER** | Plataformas hermanas que sirvieron como referencia de patrones. |
| **VAPID** | Voluntary Application Server Identification. Claves para Web Push. |
| **ARCA** | Administración Recaudadora. Autoridad fiscal local. Factura electrónica. |
| **CAE** | Código de Autorización Electrónico de ARCA. |
| **CSR** | Certificate Signing Request para ARCA. |
| **RLS** | Row-Level Security de Postgres. |
| **DGG-##** | Decisión documentada en `knowledge-base/DECISIONES.md`. |
| **E##** | Error / lección documentada en `knowledge-base/ERRORES.md`. |

---

## 13. Atajos de teclado

### Globales

| Tecla | Acción |
|---|---|
| `⌘K` | Command palette |
| `Esc` | Cerrar modal o palette |

### En la Agenda

| Tecla | Acción |
|---|---|
| `J` o `←` | Período anterior |
| `K` o `→` | Período siguiente |
| `T` | Saltar a hoy |
| `1..4` | Lista / Día / Semana / Mes |
| `N` | Nuevo evento |
| `⌘K` | Acciones scope-aware |

### En el FormularioBuilder

| Tecla | Acción |
|---|---|
| `⌘Z` | Deshacer |
| `⇧⌘Z` | Rehacer |
| `⌘1..9` | Insertar bloque |
| `Delete` | Eliminar bloque |

---

## Apéndice · Referencias cruzadas

Las decisiones tomadas durante el desarrollo están documentadas en
`knowledge-base/DECISIONES.md` con código `DGG-##`. Los errores que
descubrimos y resolvimos están en `knowledge-base/ERRORES.md` con
código `E##`. El estado vivo del proyecto vive en `PROJECT_STATUS.md`.

Para detalle técnico del modelo de datos, ver
`knowledge-base/01_MODELO_DE_DATOS.md`. Para todo lo de facturación,
ARCA y emails: `knowledge-base/02_FACTURACION_ARCA_EMAILS.md`. Para
finanzas y conciliación: `knowledge-base/03_CONCILIACION_CAJAS_MOTOR.md`.
Para móvil, push y reportes: `knowledge-base/04_MOVIL_PUSH_REPORTES.md`.

---

## Versionado

| Versión | Fecha | Cambios |
|---|---|---|
| 1.0 | 2026-05-31 | Versión inicial. Cobertura completa post-E2. |
| 1.1 | 2026-06-01 | Reescritura narrativa. Tres miradas (gerencia, cliente, partner, gestor) como capítulos. Diagramas de flujo, callouts, screenshots sin overlay de tour, isologo y triángulos de marca. |

---

> **Gestión Global · Aliados de tu tiempo**
> *gestionglobal.ar*
