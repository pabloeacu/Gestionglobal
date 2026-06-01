# Manual oficial · Gestión Global

> Plataforma integral para administradores de consorcios y su equipo.
> Última actualización: **2026-05-31** · ciclo K post-E2.
>
> Este manual es el documento operativo para quien usa la plataforma día a día.
> Para detalles técnicos (esquema de BD, edge functions, migraciones), ver
> `knowledge-base/` en este repo.

---

## Índice

1. [Filosofía y alcance](#1-filosofía-y-alcance)
2. [Cómo entrar a la plataforma](#2-cómo-entrar-a-la-plataforma)
3. [Panel de gerencia](#3-panel-de-gerencia)
   - 3.1 [Inicio · Hola, …](#31-inicio--hola-)
   - 3.2 [Captación · Solicitudes](#32-captación--solicitudes)
   - 3.3 [Clientes · Administraciones](#33-clientes--administraciones)
   - 3.4 [Trámites · Operación](#34-trámites--operación)
   - 3.5 [Agenda · organizador ejecutivo](#35-agenda--organizador-ejecutivo)
   - 3.6 [Facturación · Comprobantes, CC, Recupero](#36-facturación--comprobantes-cc-recupero)
   - 3.7 [Finanzas · Cajas, Conciliación, Partners](#37-finanzas--cajas-conciliación-partners)
   - 3.8 [Campus virtual](#38-campus-virtual)
   - 3.9 [Comunicaciones · Noticias y novedades](#39-comunicaciones--noticias-y-novedades)
   - 3.10 [Analítica avanzada](#310-analítica-avanzada)
   - 3.11 [Configuración](#311-configuración)
4. [Portal del administrador (cliente)](#4-portal-del-administrador-cliente)
5. [Portal del partner](#5-portal-del-partner)
6. [Portal del gestor externo](#6-portal-del-gestor-externo)
7. [Campus público · cursos abiertos y webinars](#7-campus-público--cursos-abiertos-y-webinars)
8. [Flujos cotidianos paso a paso](#8-flujos-cotidianos-paso-a-paso)
9. [Notificaciones · push, email, in-app](#9-notificaciones--push-email-in-app)
10. [Administración técnica](#10-administración-técnica)
11. [Troubleshooting](#11-troubleshooting)
12. [Glosario](#12-glosario)
13. [Anexo · atajos de teclado](#13-anexo--atajos-de-teclado)

---

## 1. Filosofía y alcance

### 1.1 Qué es Gestión Global

Gestión Global es el **ecosistema digital único** que sostiene a la empresa
*Gestión Global* (servicios profesionales a administradores de consorcios). El
dominio es **gestionglobal.ar** y la plataforma centraliza:

- La operación interna del equipo (gerencia).
- El portal de cada cliente administrador.
- El campus virtual con cursos y webinars.
- La captación pública (formularios + landing).
- La rendición a partners externos.
- El acceso de gestores tercerizados a cada trámite.

El sistema es **single-tenant**: hay una sola "Gestión Global" como dueña.
Cada cliente es una *administración* (una persona o estudio que administra
consorcios). Los consorcios cuelgan de las administraciones.

### 1.2 Principios de diseño

- **Premium-grade UX**. Microinteracciones, animaciones suaves, copy
  rioplatense en el portal interno; tono formal en el portal cliente.
- **Mobile-first**. Toda pantalla pasa por audit de 360 px (ver §11.5).
- **Persistencia ante todo**. Cualquier acción de negocio queda en la base
  de datos. Nada de estado volátil que se pierda al recargar.
- **Sin secretos en el front**. Tokens, claves de ARCA, refresh tokens de
  Gmail, VAPID privadas: todo va a edge functions o Supabase secrets.
- **Tres canales de comunicación con el cliente**: dashboard (banner /
  cards), email transaccional (Workspace), push (Web Push VAPID). Cuando
  una alarma importa, se dispara en los tres.
- **Recordatorios humanos, no spam**. La agenda usa cadencia 1ª alerta a la
  hora + re-alerta cada 5 h + cierre a las 20:00. No hay alarmas
  configurables tipo Google.

### 1.3 Roles

| Rol | Acceso | Dónde aterriza |
|---|---|---|
| `gerente` | Equipo interno de Gestión Global. Ve todo. | `/gerencia` |
| `administrador` | El cliente — la administración. | `/portal` |
| `partner` | Aliado comercial / proveedor con rendición de cuentas. | `/partner` |
| Gestor externo | Sin cuenta. Accede a un trámite por **token mágico**. | `/acceso/:token` |

---

## 2. Cómo entrar a la plataforma

### 2.1 Página de login

URL: **<https://www.gestionglobal.ar/ingresar>**

El login es único para los 3 perfiles con cuenta. El sistema detecta el rol
de cada usuario y redirige al panel correspondiente:

- `gerente` → `/gerencia`
- `administrador` → `/portal`
- `partner` → `/partner`

> **Importante:** la columna de la izquierda muestra la promesa de marca
> ("Todo fluye cuando todo está conectado") + isologo. En mobile la columna
> se colapsa y queda sólo el formulario.

### 2.2 Recuperación de contraseña

(Documentar acá el flujo cuando se implemente el reset por email. Hoy se
hace por DB.)

### 2.3 Primer ingreso — "Primeros 5 minutos"

La primera vez que un gerente entra al panel ve la card de onboarding
**"Bienvenida, dejame ayudarte a arrancar"** con 5 pasos clickables:

1. **Crear tu primer cliente** → Clientes › Nueva administración.
2. **Registrar un trámite** → Trámites › Nuevo trámite.
3. **Mirar tu agenda de hoy** → Agenda.
4. **Configurar la casilla de email** → Configuración › Plantillas email.
5. **Instalar la plataforma en tu dispositivo** → Wizard PWA.

La card recuerda el progreso (`0/5`, `1/5` …) por gerente vía la columna
`profiles.onboarding_checklist`. Al cerrar cada paso se marca. Quien quiera
puede dismiss-ear con la X y volverlo a ver desde **Perfil › "Ver el tour
otra vez"**.

### 2.4 Tour guiado de gerencia

Al primer ingreso se dispara también un tour de 6 pasos con tooltips que
recorren el sidebar y resaltan funcionalidades clave (Comunicaciones,
campanita, ⌘K, agenda…). Persistido en `localStorage.gerenciaTourCompleted`.

Existen tours independientes para:
- **Agenda** (3 pasos): barra mágica + selector de vistas + filtros.
- **Trámite individual** (1 paso): botón "Cerrar trámite" cuando hay
  renovación automática.

Se resetean desde **Perfil › Ver el tour otra vez** (borra los 3 flags).

---

## 3. Panel de gerencia

URL: **<https://www.gestionglobal.ar/gerencia>**

El sidebar tiene **9 secciones** (post DGG-25, originalmente eran 15):

| # | Sección | Sub-rutas |
|---|---|---|
| 1 | Inicio | — |
| 2 | Captación | Solicitudes, Formularios |
| 3 | Clientes | — |
| 4 | Trámites | — |
| 5 | Agenda | — |
| 6 | Facturación | Comprobantes, Cuenta corriente, Recupero |
| 7 | Finanzas | Cajas y movimientos, Conciliación, Partners |
| 8 | Campus | — |
| 9 | Comunicaciones | — |
| 10 | Analítica | — |
| 11 | Configuración | Servicios, ARCA, Plantillas email, Generación CJ, Usuarios, Bitácora, Errores |

En el header superior: buscador global (⌘K), botón de notificaciones
campana 🔔 (badge cuando hay no leídas), avatar.

### 3.1 Inicio · Hola, …

Pantalla de bienvenida con:
- Saludo personalizado ("Buenas noches, Paul").
- Card **Primeros 5 minutos** (descrita en §2.3).
- **Tarjeta de seguimientos hoy / vencidos** ("Tenés N seguimientos para hoy").
- **Resumen últimos 30 días** (Facturado, Cobrado, Deuda total, Trámites
  abiertos).
- Mini-chart **Facturación diaria** (último mes).
- **Atajos** a Clientes, Servicios, Facturación, Trámites, Agenda, Finanzas.

### 3.2 Captación · Solicitudes

URL: `/gerencia/solicitudes`

Cada formulario público crea una **solicitud**. La lista muestra:
- Búsqueda + filtros por estado (Nueva, En análisis, Derivada, Activada,
  Descartada).
- Tarjeta de cada solicitud con tipo de servicio + datos del solicitante +
  fecha de creación + estado.
- Acciones por solicitud:
  - **Análisis** rápido (notas internas).
  - **Derivar a sector de gestoría** → al hacerlo agrega
    automáticamente una línea "Envío a sector de gestoría" al trámite
    (regla N3).
  - **Activar como cliente** (wizard de 3 pasos: validar datos, crear
    administración, generar credenciales + email de bienvenida).
  - **Descartar** con motivo.

En el dashboard de gerencia, las solicitudes nuevas también aparecen como
card "Nuevas solicitudes" (obs 1, Bloque B) y disparan push al gerente.

#### 3.2.1 Formularios públicos

URL pública: `/formularios/:slug`

Cada formulario público se construye desde **Captación › Formularios**.
Features clave:
- **Builder visual** con paleta de bloques (texto, número, fecha, archivo,
  select, identidad, etc.).
- **Cross-match cliente existente**: si el solicitante tiene CUIT igual a
  una administración activa, se sugiere asociar la solicitud en lugar de
  duplicar.
- **Visible-if condicional declarativo**: cada campo puede esconderse
  según el valor de otro.
- **Undo/Redo** con ⌘Z / ⇧⌘Z y atajos ⌘+1..9 para insertar bloques.
- **Diff visual** entre versiones del mismo formulario.
- **File download**: subir un PDF (ej. checklist) que el usuario público
  descargue antes del envío.

### 3.3 Clientes · Administraciones

URL: `/gerencia/clientes`

Cada cliente es una **administración**. Ver:
- KPIs: En la vista / Activos / Total de consorcios.
- Búsqueda + filtro Estado (Activos / Todos).
- Tabla: Administración, Código, CUIT, Consorcios, Estado.
- Botones: **PDF**, **XLS**, **+ Nueva administración**.

#### 3.3.1 Detalle de administración

Click en una fila → `/gerencia/clientes/:id`. Tabs internas:
- **Datos**: razón social, CUIT, domicilio, email, teléfono, consorcios.
- **Trámites**: listado de trámites del cliente.
- **Cuenta corriente**: comprobantes + cobranzas + saldo evolutivo.
- **Webinars**: KPIs + listado de webinars donde se inscribió.
- **Convenio**: % de bonificación que aplica a sus comprobantes.

### 3.4 Trámites · Operación

URL: `/gerencia/tramites`

Cada *trámite* es la versión interna de un **tracking**: un expediente
con avances, documentación, vencimiento y eventualmente alarmas
recurrentes. Categorías típicas: Matriculación, Renovación RPAC, DDJJ,
Consulta jurídica, Reclamos.

Lista:
- KPIs: Abiertos, Resueltos, Sin asignar, Vencidos.
- Búsqueda + filtros (Estado, Categoría, Prioridad).
- Tabla con: TRM-#### + título + cliente + asignado + SLA + prioridad +
  estado + última actualización.
- Toggle **Lista ↔ Kanban**.

#### 3.4.1 Detalle de trámite

URL: `/gerencia/trackings/:id`

Estructura del detalle:

- **Header**: TRM-#### + título + chips (estado, categoría, prioridad,
  cliente, asignado).
- **Timeline visual** de la línea de avances (creado, derivado, docs
  enviados, factura emitida, cobrado, cerrado).
- **Toggle Lista ↔ Timeline** para los avances.
- **Drag&drop de archivos** sobre el detalle → adjunta documentación.
- **Pedidos de documentación** (cuando faltan papeles): genera email al
  cliente con botón "Subir docs" + flag en el portal.
- **Botón "Cerrar trámite"** (o **"Cerrar trámite y programar próximo
  vencimiento"** si el servicio tiene `vigencia_meses` configurada).

#### 3.4.2 Sistema de avances y documentación

Al agregar un avance:
1. Tipear título + descripción.
2. Adjuntar archivos opcionales.
3. Toggle **"Visible para el cliente"** (si está ON, se manda email +
   push al cliente con la línea).

Cuando una línea es marcada visible:
- Se encola el email `tracking-avance-cliente` (plantilla MANAXER).
- Se inserta en la campanita del portal del cliente.
- Se manda push si tiene push activado.

### 3.5 Agenda · organizador ejecutivo

URL: `/gerencia/agenda`

La agenda es **el organizador ejecutivo personal** de cada gerente. No es
CRM, no es colaborativa. Inspirada en el handoff MDC adaptado a Gestión
Global.

#### Subtítulo permanente

> *"Tirá lo que tengas en la cabeza — yo lo ordeno."*

#### Vistas

Cuatro vistas, toggle arriba: **Lista**, **Día**, **Semana** (default),
**Mes**.

#### Tabs

- **Mi agenda**: eventos propios del gerente.
- **Vencimientos**: todos los vencimientos proyectados de servicios con
  `tipo_vencimiento` GG (solo tipos del catálogo de servicios — FIX-V3).

#### Filtros (chips multi-select)

`Todo` · `Personal` · `Vencimientos` · `Trámites` · `Cobranzas` ·
`Solicitudes` · `Alarmas tracking` · "Qué es cada uno" (ayuda) ·
"Solo lo mío".

#### Barra mágica (BarraMagica)

Input con sparkle ✨ que **acepta lenguaje natural rioplatense**:

```
Llamar a la administración mañana 9am #cobranzas
Pagar AFIP 15/06 !alta
Revisar expediente lunes próximo 14h !urgente #tramites
```

El parser reconoce:
- **Fechas relativas**: hoy, mañana, próximo lunes, en 3 días, 15/06, etc.
- **Horas**: 9am, 9:00, 14h, 14:30.
- **Categoría** con `#nombre`.
- **Prioridad** con `!alta`, `!media`, `!baja`, `!urgente`.

Enter crea el evento directo. Nada se persiste hasta el Enter (regla E1).

#### Gestos premium (vista Semana / Día)

- **Pintar** una franja en columna vacía → abre modal con draft (no
  persiste hasta Guardar).
- **Drag** de un bloque → mueve el evento (snap 15 min, distingue tap de
  drag con E5).
- **Resize** desde la manija inferior → cambia hora de fin.
- **Tap rápido** sobre el bloque → abre detalle.
- **Click derecho** (o long-press en mobile) → **AccionesMenu** flotante
  con clamp robusto (E7).

#### AccionesMenu

Menú contextual sobre cada ocurrencia con:
- ✓ Marcar como hecha / pendiente.
- ✏ Editar.
- 📅 Posponer (1 día / 1 semana / 1 mes / personalizado).
- 🗑 Eliminar (o "Saltear esta ocurrencia" si es recurrente).

Posponer es **relativo a la fecha del evento**, no a hoy (E11).

#### Recurrencia virtual

Los eventos recurrentes guardan la regla en la fila madre; las ocurrencias
se calculan en runtime para el rango visible. Las excepciones
(`moved`, `skipped`, `done`) viven en `agenda_event_overrides`.

#### Modal con panel lateral

El modal de crear/editar evento tiene **dos capas**:
- **Capa 1** (siempre visible): título, fecha, hora, categoría, prioridad,
  notas, recurrencia.
- **Capa 2** (colapsable, panel lateral animado): vínculos a entidades
  del negocio (consorcio, administración, comprobante, trámite). El panel
  abre hacia la derecha, **el modal NO crece hacia abajo** (E8).

#### Modo enfoque

Toggle que **oculta proyecciones** (vencimientos, trámites, cobranzas) y
deja **sólo los eventos propios** del gerente. Útil para concentrarse.

#### Recordatorios humanos

El cron `gg_agenda_procesar_recordatorios` corre cada 15 min y aplica
cadencia:
- **1° aviso** a la hora exacta del evento (09:00 si `all_day`).
- **Re-alerta** cada **5 h** mientras siga pendiente y siga siendo hoy.
- A las **20:00**: aviso de **cierre** (una sola vez por evento por día).
- Pendientes de **días anteriores**: un solo push suave a la mañana
  (09:00–09:20).

Copys en tono rioplatense:
- "👀 No te cuelgues: «…»"
- "⏰ Te marco de nuevo: «…»"
- "🌙 Última por hoy. Si ya no llegás…"

Idempotente vía `agenda_reminders_log` (event_id + occurrence_date + kind).

#### Exportar a iCal

Dos botones en el header de la agenda:
- **Exportar mis eventos** (sólo personales del gerente).
- **Exportar todo** (con vencimientos + trámites + cobranzas
  proyectados).

El `.ics` se descarga y puede importarse a Google Calendar / Outlook /
Apple Calendar.

#### Atajos de teclado (Agenda)

| Tecla | Acción |
|---|---|
| `J` / flecha izq | Período anterior |
| `K` / flecha der | Período siguiente |
| `T` | Saltar a hoy |
| `1..4` | Cambiar vista (Lista / Día / Semana / Mes) |
| `N` | Nuevo evento |
| `⌘K` | Command palette (acciones scope-aware) |

#### Command palette scope-aware

Al abrir ⌘K dentro de la Agenda aparecen acciones específicas:
- **Ir a hoy / mañana / próximo lunes** (parser NL).
- **Activar / desactivar Modo enfoque**.
- **Exportar a iCal (mis / todo)**.
- **Nueva administración**, **Nuevo trámite**, etc. (atajos cross-módulo).

### 3.6 Facturación · Comprobantes, CC, Recupero

#### 3.6.1 Comprobantes

URL: `/gerencia/facturacion`

Tipos disponibles:
- **X** (no fiscal, "simple primero").
- **A / B / C** (fiscales, vía ARCA).

KPIs en el header: Emitidos / Total emitido / Pendiente cobro / Vencido.

Filtros: período (mes), estado, cobranza.

Tabla por comprobante: nº punto-de-venta + número, cliente, fecha y
vencimiento, total, cobranza (Pagado / Parcial / Pendiente), estado
(Borrador / Autorizado / Anulado).

Botones: PDF / XLS / **Copiar** / **+ Nuevo comprobante**.

##### Crear un comprobante

Wizard de 3 pasos:
1. **Receptor**: elegir cliente / consorcio (auto-completa razón social,
   CUIT, condición IVA).
2. **Líneas**: agregar servicios desde el catálogo (auto-completa precio
   referencia). Cada línea editable inline: cantidad, precio unitario,
   bonificación. El tabulador "al editar precio en factura" recalcula
   bonificación y deja trazada la decisión en bitácora (DGG-24).
3. **Cobranza opcional**: si el comprobante ya está cobrado, se
   registra el movimiento de caja al guardar.

Al guardar se ejecuta el flujo:
- INSERT en `comprobantes`.
- INSERT en `comprobante_lineas`.
- (si A/B/C) → encola job ARCA → autoriza CAE → actualiza estado.
- (si cobranza) → INSERT en `movimientos` + imputación.
- Encola email `comprobante-emitido` al cliente.

##### Realizar factura desde "simple"

Premisa: un comprobante X puede pasar a A/B/C cuando se necesite. Botón
"Realizar factura" abre selector de emisor fiscal (Gestión Global o
**Fundplata**, segundo emisor habilitado DGG-? · #149) y autoriza CAE.

##### Cobrar un comprobante

Desde el detalle de un comprobante:
- Botón **+ Cobranza**: abre modal con caja, fecha, monto. Permite cobro
  parcial.
- El movimiento queda asociado vía `movimiento_imputaciones`.
- El saldo del comprobante se recalcula en runtime (D09: saldo derivado).

#### 3.6.2 Cuenta corriente global

URL: `/gerencia/cuenta-corriente`

Resumen consolidado por administración con KPIs Facturado / Cobrado /
Pendiente / Vencidos.

Filtros: Desde, Hasta, Estado (Con deuda / Con vencidos / Al día / Todos),
Búsqueda.

Tabla por administración con sort por columna (nombre, facturado,
cobrado, deuda, vencidos). Click en fila → detalle del cliente.

Cuando no hay datos:
- Sin filas pero hay clientes → **IllustratedEmpty 'busqueda'**: "Sin
  resultados para los filtros actuales".
- Sin clientes en absoluto → **IllustratedEmpty 'edificio'** con CTA
  "Importar histórico".

##### Importar histórico

Botón **Importar histórico** en el header → wizard CSV.
- Plantilla descargable con columnas: fecha, administración (código),
  tipo (cargo / abono), descripción, monto, comprobante asociado opcional.
- Parser tolerante (separadores `,`/`;`, fechas DD/MM/YYYY o YYYY-MM-DD,
  montos AR `1.234,56` o US `1,234.56`).
- Preview de matches antes de confirmar.

#### 3.6.3 Recupero

URL: `/gerencia/recupero`

Tres niveles de recupero (R1 / R2 / R3) con templates de email y SLA
distintos. La pantalla lista las administraciones con deuda agrupadas
por nivel y permite disparar la campaña.

### 3.7 Finanzas · Cajas, Conciliación, Partners

#### 3.7.1 Cajas y movimientos

URL: `/gerencia/finanzas`

Header:
- KPIs: Saldo total, Ingresos del mes, Egresos del mes, Balance neto.
- Action bar: PDF / XLS / **Reportes** / **Conciliar** / **Importar
  histórico** / **Admin** / **Transferir** / **+ Nuevo movimiento**.

**Cajas activas** (cards):
- Banco principal (ARS).
- Billetera virtual (ARS).
- Plazo fijo (ARS).
- Efectivo (ARS).
- + cajas custom (DGG-23 Bloque 3.A) con CRUD propio + categorías.

**Movimientos recientes** (tabla): fecha, tipo (Ingreso / Egreso /
Transferencia), descripción, caja, monto, acciones.

##### Transferir

Modal con caja origen / destino + monto + fecha. Crea **dos movimientos
linkeados** (egreso en origen, ingreso en destino).

##### Anular y revertir

Cada movimiento tiene menú con:
- **Anular**: marca `anulado_at`. El movimiento queda visible pero
  excluido de balances.
- **Revertir**: crea un movimiento espejo en sentido contrario. Útil
  para correcciones que deben quedar auditables.

#### 3.7.2 Conciliación bancaria

URL: `/gerencia/finanzas/conciliacion`

Importar extracto bancario CSV → motor de sugerencias →
vincular / crear nuevo / ignorar línea por línea. Detalles en
`knowledge-base/03_CONCILIACION_CAJAS_MOTOR.md`.

#### 3.7.3 Partners

URL: `/gerencia/finanzas/partners`

Lista de partners con convenio. Por cada partner:
- % de convenio (atribución).
- Saldo evolutivo.
- Listado de comprobantes asignados (flag "participa partner").
- Rendición por período con detalle de cada movimiento atribuido
  (ingresos / egresos / saldo evolutivo).

Cada comprobante con flag muestra **botón "Realizar factura"** del partner
(él lo verá en su portal).

### 3.8 Campus virtual

URL: `/gerencia/campus`

Header: "Subsistema 7 · Campus virtual".

KPIs: Cursos activos, Matrículas activas, Cursadas completadas.

Listado de cursos con cover image, modalidad (Asincrónica / Sincrónica /
Mixta), categoría, estado.

#### Estructura de un curso

Tabs internas:
- **Datos generales**: título, descripción, banner, modalidad, modalidad
  geográfica, instructor (con foto), categoría.
- **Módulos y clases** (editor L1): drag-and-drop, cropper de imagen,
  publicación con fecha programada.
- **Inscripciones**: alumnos matriculados + estado.
- **Encuentros sincrónicos** (Zoom): crear meeting + adjuntar link.
- **Exámenes**: MC + V/F + retroalimentación.
- **Certificado**: link al esquema custom (editor de certificados DGG-13),
  toggle emisión auto, motor de emisión, certificados emitidos.
- **Encuesta de satisfacción** (al finalizar el curso).

#### Webinars

URL gerencia: `/gerencia/webinars`

Webinars son **eventos de captación + capacitación** abiertos a
inscriptos (clientes y prospectos). Lista con KPIs (inscriptos,
asistencia, próximo evento).

Detalle del webinar:
- Datos generales + Zoom link.
- Inscriptos (clientes + prospectos).
- Centro de prospectos (convertir prospecto en cliente con un click).
- Recordatorios automáticos (cron diario).
- Métricas de conversión.

### 3.9 Comunicaciones · Noticias y novedades

URL: `/gerencia/comunicaciones`

Sistema multi-canal para enviar **una misma comunicación** a un
subconjunto de administraciones por **dashboard banner + email + push**
(o cualquier combinación).

Pantalla:
- Header: "Noticias y novedades a tus clientes".
- Botón **+ Nueva comunicación**.
- Lista de comunicaciones con badge de estado (Borrador / Enviado).

#### Crear una comunicación

Drawer lateral con:
- **Título** + **cuerpo** (markdown).
- **Audiencia**:
  - `Todos los clientes`.
  - `Manual` (multi-select de administraciones).
  - `Por servicios` (todas las que tengan tal servicio activo).
  - `Por convenio` (todas las que tengan tal convenio).
- **Canales**: ✅ Dashboard banner / ✅ Email / ✅ Push (cualquier
  combinación, mínimo uno).
- Preview destinatarios (N administraciones, lista).
- Botón **Enviar ahora** (o Guardar borrador).

Al enviar:
- Inserta en `comunicaciones_destinatarios` una fila por administración.
- Si Email → encola en `email_queue` con template
  `comunicacion-novedad`.
- Si Push → encola en `push_notifications_queue`.
- Si Dashboard → el portal del cliente muestra el banner hasta que
  marca "Vista".

### 3.10 Analítica avanzada

URL: `/gerencia/analitica`

Inteligencia de negocio con período seleccionable (Últimos 7d / 30d /
90d / 1 año / custom).

Secciones:
- **KPIs**: Facturación 12M, Cobranzas 12M, Top clientes, Conversión
  (solicitudes → activadas %).
- **Charts**: Facturación mensual, Cobranzas mensuales (recharts).
- **Top clientes por facturación**.
- **Mix de servicios** (qué servicios facturan más).
- **Funnel de conversión** (solicitudes → análisis → activadas →
  facturadas).

### 3.11 Configuración

Sub-rutas:

#### Servicios (catálogo)

URL: `/gerencia/servicios`

Catálogo extensible con precios fijos, por consorcio, por unidad funcional,
convenios y preferenciales. Cada cambio queda en bitácora.

KPIs: Servicios visibles / Activos / Con precio vigente.

Categorías (filtro lateral):
- RPAC · Buenos Aires
- RPA · CABA
- Capacitación
- Plataforma SaaS
- Asesoría jurídica
- Comunidad

Cada servicio tiene:
- Slug, nombre, descripción, categoría.
- Precio público + precio cliente (diferencia = bonificación).
- `vigencia_meses` (para servicios renovables → al cerrar trámite,
  proyecta próximo vencimiento).
- `precio_referencia` (para pre-fill al crear comprobante).
- Voucher PDF (si aplica).

#### ARCA · facturación

URL: `/gerencia/configuracion/emails/arca` (tabs: ARCA / Cola de emisión)

- Subida del certificado + CSR + alias.
- Test del certificado con padron.
- Cola de emisión en tiempo real (estado de cada job).
- Configuración del intervalo entre emisiones
  (`config_global.arca_intervalo_emision_seg`).
- Segundo emisor fiscal (Fundplata) — toggle (#149).

#### Plantillas email

URL: `/gerencia/configuracion/emails/templates`

Lista de **32 plantillas** del sistema con editor en vivo.

Cada plantilla:
- Slug (`vencimiento_alerta_cliente`, `bienvenida-administracion`, etc.).
- Casilla (General / Cursos / Jurídico / Webinar).
- Header (kicker, título, asunto, color de acento).
- Cuerpo HTML visual + variables Mustache `{{nombre}}`, `{{link}}`.
- Botón "Enviar prueba a [tu email]".
- Botón "Guardar plantilla".
- **Preview en vivo con datos de ejemplo** (panel derecho).

Layout MANAXER v1 con tipografía premium.

#### Generación CJ

URL: `/gerencia/generacion-cj`

Generador de **Consultoría Jurídica** PDF con datos del cliente + texto
custom + firma del abogado. Historial de PDFs generados.

#### Usuarios

URL: `/gerencia/usuarios`

Gerencia interna: alta de gerentes, partners, gestores fijos. Roles
disponibles: `gerente`, `administrador`, `partner`. Email + password
inicial (genera reset).

#### Bitácora de cambios

URL: `/gerencia/bitacora`

Auditoría de cambios sensibles:
- Edición de precios en comprobantes (tabulador).
- Anulaciones / reversiones de movimientos.
- Cambios en convenios.
- Cambios en configuración global.

#### Errores en runtime

URL: `/gerencia/errores`

Si está integrado Sentry (D5 / #234), agregado de errores con stack
trace + cantidad de ocurrencias + última vez visto. Útil para detectar
regresiones.

---

## 4. Portal del administrador (cliente)

URL: **<https://www.gestionglobal.ar/portal>**

El cliente (rol `administrador`) entra a su propio panel. Diseño limpio,
tono más formal, sin sidebar extendido (sólo iconos).

### 4.1 Dashboard (home)

#### Hero card

Saludo dinámico ("Buenas noches, María"), nombre de la administración,
chip de matrícula (CUCICBA-12345 / RPA-PBA-…). KPIs: cursos activos +
gestiones abiertas.

#### Banner ActivarPushAssistant

Si no tiene push activado: banner "Activá las notificaciones · No te
pierdas ninguna novedad" con botón "Activar". Acciona el flujo VAPID
+ Service Worker (universal: detecta iOS Safari, Chrome iOS PWA,
Android, desktop).

#### Banner Novedades

Si hay una comunicación de gerencia con canal `dashboard` activo y
todavía no la marcó vista: banner con título + cuerpo + X dismiss.

#### Banner Acción requerida

Si hay un trámite con documentación pendiente: card amarilla "Acción
requerida · Necesitamos documentación para tu trámite". Chip con
TRM-#### y servicio. Botón "Subir docs →" lleva al detalle.

#### Cards Sugerido para vos

- **Obligación anual** (DDJJ): si la matrícula tiene DDJJ próxima.
- **Capacitación anual**: actualización RPAC (CABA o PBA).
- **Webinar gratuito**: próximo webinar abierto.
- **Oportunidad** (Renovación matrícula): si vence en ≤ 30 días.

#### Mis cursos activos

Listado compacto con modalidad + vigencia. Click → detalle del curso
(módulos, clases, examen, certificado).

#### Próximos vencimientos

Lista de vencimientos proyectados (renovación matrícula, DDJJ, etc.)
ordenados por fecha. Cada item: título, descripción corta, "en N días".

### 4.2 Mis gestiones (trámites del cliente)

URL: `/portal/gestiones`

Vista cliente de sus trámites con timeline visual (NO modal genérico).
Cada estado tiene icono + color. Avances marcados visibles aparecen como
nodos en la línea.

Botón "Adjuntar documento" en cada trámite con docs pendientes.

### 4.3 Cuenta corriente (cliente)

URL: `/portal/cuenta-corriente`

Header: "Tu saldo".

Hero card: **Saldo actual** + status ("cuenta saldada" si $0).

KPIs: Cargos / Cobranzas / N movimientos.

Filtros: Desde, Hasta.

Tabla con orden cronológico (FIFO, fix #157): Fecha, Movimiento, Cargo,
Cobranza, **Saldo acumulado** al final de cada línea.

Cada comprobante linkea a su detalle PDF (factura descargable, #195).

### 4.4 Mis webinars

URL: `/portal/webinars`

Lista de webinars donde se inscribió. Cada uno con badge (Próximo /
En curso / Pasado) + botón "Acceder" si aplica.

### 4.5 Nuevo servicio

URL: `/portal/nuevo-servicio`

Cliente puede pedir un nuevo servicio (genera una solicitud). Formulario
con catálogo público + voucher si aplica + datos del consorcio.

### 4.6 Mi cuenta (perfil)

URL: `/portal/mi-cuenta`

- Datos personales + contacto.
- Datos de la administración (read-only excepto teléfono y email).
- Activar / desactivar push.
- Cerrar sesión.

---

## 5. Portal del partner

URL: **<https://www.gestionglobal.ar/partner>**

### 5.1 Mis rendiciones y comprobantes

Hero: "Portal partner · Gestión Global · Mis rendiciones y comprobantes".

#### Mi caja · Movimientos detallados

Cada operación atribuida al partner con su % de convenio y saldo
evolutivo. Filtros Desde / Hasta. KPIs Ingresos atribuidos / Egresos
atribuidos / Saldo evolutivo.

#### Resumen por período

Tabla con: Período (Desde → Hasta), Estado (Borrador / Cerrado),
Ingresos base, Ingresos atribuidos, Costos base, Costos atribuidos.

#### Comprobantes asignados

Tabla con cada comprobante donde participa el partner: Tipo + PV +
número, Receptor, Fecha, Total, Estado, **Facturación**, Acción.

##### Realizar factura desde el partner

Si el comprobante está marcado para que el partner emita factura, el
botón **"Realizar factura"** abre el wizard de facturación con el emisor
fiscal del partner pre-seleccionado. Resultado: número fiscal asociado
al comprobante original, PDF adjunto.

---

## 6. Portal del gestor externo

URL: **<https://www.gestionglobal.ar/acceso/:token>**

Los **gestores externos** son terceros (gestoría tercerizada) que no
tienen cuenta. Acceden por **token mágico** generado al derivar un
trámite.

### 6.1 Acceso

El gestor recibe un email con:
- Datos del trámite.
- Botón **"Acceder al panel"**.
- Vencimiento del link (configurable en
  `acceso_externo.ttl_dias`, default 30, ajustable en Bloque K #169).

### 6.2 Panel del gestor

Sin sidebar. Card central con:
- Datos del trámite + cliente + consorcio.
- Documentación adjunta (descargable).
- **Subir avances** (texto + archivos ilimitados).
- **Marcar progreso** con campo "Estado actual".
- **Botón "Descargar info del trámite"** (PDF con todo, Bloque K).

### 6.3 Print stylesheet

El gestor puede imprimir el panel (⌘P). El CSS de print oculta header,
botones, scroll y deja sólo el contenido para tener el expediente en
papel.

### 6.4 Link expirado

Si el token vence: pantalla "Link expirado" con CTA **"Pedir link
nuevo"** (envía email a gerencia que regenera el token, C7).

---

## 7. Campus público · cursos abiertos y webinars

### 7.1 Campus público

URL: `/campus`

Catálogo público de cursos abiertos (cuando la cortina está apagada).
Cada curso muestra:
- Cover, título, instructor, modalidad.
- Precio (con voucher si aplica).
- Botón "Inscribirme" → formulario público.

### 7.2 Webinar público por token

URL: `/campus/webinar/:token`

Página de **landing del webinar** para un inscripto específico (cliente
o prospecto). Token único por inscripto.

Contenido:
- Sticky top bar con BrandMark.
- Hero gradient cyan→night con título + fecha + hora.
- Datos del orador.
- Link de Zoom (revelado cerca del horario).
- Si es prospecto: CTA "Conocé el campus de Gestión Global" (G2 #238).
- Si es cliente: contenido sin CTA de captación.

---

## 8. Flujos cotidianos paso a paso

### 8.1 Crear un cliente desde cero

1. **Sidebar › Clientes › + Nueva administración**.
2. Wizard de 2 pasos:
   - Datos: razón social, CUIT, condición IVA, domicilio.
   - Acceso: email del administrador + checkbox "Generar credenciales y
     mandar email de bienvenida".
3. Guardar.
4. El sistema:
   - INSERT en `administraciones`.
   - Llama edge function `alta-cliente-portal` que crea el user en
     `auth.users` + vincula `administracion.user_id` + encola email
     `bienvenida-administracion` con credenciales reales.

### 8.2 Registrar un trámite

1. **Sidebar › Trámites › + Nuevo trámite**.
2. Wizard:
   - Cliente (autocomplete de administraciones).
   - Servicio (autocomplete del catálogo).
   - Título + descripción.
   - Asignar a (gerente).
   - SLA / prioridad.
3. Guardar → genera TRM-####.

### 8.3 Emitir comprobante + cobrar

1. **Sidebar › Facturación › Comprobantes › + Nuevo comprobante**.
2. Receptor → líneas → cobranza (opcional).
3. Si A/B/C → ARCA autoriza CAE en segundos.
4. Email `comprobante-emitido` al cliente.

### 8.4 Cerrar un trámite con renovación

1. Entrar al detalle del trámite.
2. Botón **"Cerrar trámite y programar próximo vencimiento"** (visible
   sólo si el servicio tiene `vigencia_meses`).
3. Modal pre-rellena fecha próxima vencimiento (hoy + `vigencia_meses *
   30.4375` días).
4. Confirmar → INSERT en `vencimientos_proyectados` + cierra el trámite.

### 8.5 Enviar comunicación masiva

1. **Sidebar › Comunicaciones › + Nueva comunicación**.
2. Audiencia: elegir "Por servicios" → seleccionar "Renovación matrícula".
3. Canales: ✅ Dashboard + ✅ Email + ✅ Push.
4. Preview destinatarios (N administraciones).
5. Enviar ahora.

### 8.6 Conciliar extracto bancario

1. **Sidebar › Finanzas › Conciliación**.
2. Importar CSV del banco.
3. Por cada línea: vincular con movimiento existente / crear nuevo /
   ignorar.
4. Confirmar.

### 8.7 Tour onboarding completo gerente

Disparado automático en primer ingreso. 6 pasos + 3 tours secundarios
(Agenda, Trámite individual). Resetear desde Perfil.

---

## 9. Notificaciones · push, email, in-app

### 9.1 Tres canales coherentes

Cuando algo importante pasa (ej. alarma de tracking, vencimiento, avance
visible para cliente), el sistema dispara **los tres canales** (regla
3 canales, fix M4):
- **In-app**: aparece en la campanita 🔔 con badge.
- **Push**: notificación a teléfono / desktop (si activado).
- **Email**: transaccional vía Workspace.

### 9.2 Campanita

Botón 🔔 en header de gerencia y portal cliente. Dropdown con últimas
notificaciones. Cada item: icono + título + cuerpo + tiempo relativo.

Si el cuerpo es largo: click abre **modal con contenido completo**
(UX-CAMP-01) y cierra el dropdown automáticamente.

Acciones:
- Marcar todas como leídas.
- **Limpiar** (borra historial).
- Click en un item → marca como leída + navega al recurso (ej. trámite).

### 9.3 Activar push

**Gerente** (header): icono notificación → "Activar notificaciones push".

**Cliente** (portal home): banner "ActivarPushAssistant" universal:
detecta navegador + sistema operativo y guía:
- iOS Safari: "Agregar a inicio" → entrar a la PWA → activar.
- Chrome iOS PWA: similar.
- Android: prompt nativo.
- Desktop Chrome / Edge: prompt nativo.
- Desktop Safari: instrucciones manuales.

### 9.4 Email

Templates en Configuración › Plantillas email (32 plantillas).

Casillas Gmail Workspace por área:
- `contacto@gestionglobal.ar` (general).
- `cursos@gestionglobal.ar`.
- `juridico@gestionglobal.ar`.
- `webinar@gestionglobal.ar`.

Multi-casilla con OAuth refresh tokens (DGG-22). Send via SMTP TLS.

DKIM activado (EGG-QA-05). Filtro "Promociones" mitigado vía headers
correctos (EGG-QA-07).

#### Frase del día

Push + campanita diario a las 08:00 ART con una frase motivacional
+ icono libro (N1).

### 9.5 Bounce / Reply harvester

Cron cada 30 min consulta Gmail vía OAuth → detecta:
- **Bounces** (direcciones inválidas) → marca el destinatario.
- **Respuestas** de clientes → inserta en `email_replies` para que
  gerencia las vea en el panel.

(Pub/Sub real-time fue descartado en DGG-29: el cron de 30 min cubre
el caso de uso.)

---

## 10. Administración técnica

### 10.1 Stack

- **Frontend**: React 18 + TypeScript + Vite 6 + Tailwind + lucide.
- **Backend**: Supabase (Postgres 17 + Auth + Storage + Edge Functions
  Deno).
- **Scheduler**: pg_cron + pg_net.
- **Push**: Web Push VAPID + Service Worker.
- **ARCA**: SOAP nativo con node-forge (sin SDK).
- **Email**: Workspace SMTP + OAuth tokens por casilla.
- **CI/CD**: GitHub → Vercel (auto-deploy).

### 10.2 Variables de entorno

Ver `.env.example` para la lista completa con comentarios:
- Cliente Vite: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`,
  `VITE_VAPID_PUBLIC_KEY`, etc.
- Edge functions (Supabase secrets): `CRON_SECRET`,
  `SUPABASE_SERVICE_ROLE_KEY`, `WORKSPACE_SMTP_*`, `GOOGLE_OAUTH_*`,
  `VAPID_*`, `ZOOM_*`, `WEBEX_*` (latente).

### 10.3 Migraciones

Toda mutación de schema en `supabase/migrations/` numerado (0001, 0002,
…). Todo `CREATE TABLE public.*` post-mig 0130 incluye GRANTs
explícitos a `authenticated` (regla 6).

Aplicar migraciones nuevas:
```bash
supabase db push  # local
# o vía CI con service role
```

Regenerar types tras toda migración:
```bash
bash scripts/generate-types.sh
```

### 10.4 Edge functions versionadas

Todas las edge functions de producción tienen archivo en
`supabase/functions/`. Drift entre prod y repo = bug. Deploy:
```bash
supabase functions deploy <name>
```

### 10.5 Cortina de mantenimiento

Toggle en `config_global.landing_cover_enabled`:
- `true` → todas las rutas públicas muestran "Proyectando mejoras
  extraordinarias".
- `false` → landing institucional + formularios públicos activos.

Cambiar con un UPDATE en config_global o desde Settings de gerencia
(DGG-28).

### 10.6 Backup

Supabase hace daily backups automáticos. Para downloads manuales:
```bash
supabase db dump > backup-YYYYMMDD.sql
```

### 10.7 Reset de password (admin)

Sin flujo de UI todavía. Reset por DB:
```sql
UPDATE auth.users
SET encrypted_password = crypt('NuevaPass2026!', gen_salt('bf'))
WHERE email = 'user@ejemplo.com';
```

---

## 11. Troubleshooting

### 11.1 No me llega el email

1. Chequear **Configuración › Plantillas email › Cola de envíos**:
   ¿está el mail con estado `enviado` o `error`?
2. Si está en `error`: ver `error_message` (probable bounce, dirección
   inválida, OAuth token expirado).
3. Si está `enviado` pero no llega: ver bandeja de Promociones / Spam.
   DKIM está activo, pero la primera vez puede caer ahí.
4. Pedirle al destinatario que marque como "No es spam".

### 11.2 No me llega el push

1. Verificar que el navegador soporta Web Push (Safari iOS solo en PWA
   instalada).
2. **Portal cliente**: usar banner ActivarPushAssistant.
3. Verificar `push_subscriptions` table: ¿hay fila para ese usuario?
4. Verificar `push_notifications_queue`: ¿hay job con `status='error'`?
5. Si VAPID keys cambiaron, todas las subscripciones quedan inválidas
   → re-subscribirse.

### 11.3 Comprobante no autoriza en ARCA

1. Verificar `comprobante.estado`: si es `error_arca`, ver
   `arca_error_message`.
2. Errores comunes:
   - Certificado vencido → renovar en Configuración › ARCA.
   - CUIT del receptor inválido → corregir y reintentar.
   - Rate limit ARCA → esperar intervalo
     (`config_global.arca_intervalo_emision_seg`).
3. Botón **Reintentar** en el detalle del comprobante.

### 11.4 Agenda no muestra mis eventos

1. Verificar filtros chips en el header (¿está activado `Todo`?).
2. Verificar toggle "Solo lo mío".
3. Verificar Modo enfoque (si está ON oculta proyecciones, no eventos
   propios).
4. Si nada se muestra: chequear `agenda_events.owner_id = auth.uid()`.

### 11.5 Pantalla rota en mobile

1. Confirmar viewport 360 px.
2. Buscar regla 13: ¿se está usando `window.confirm/alert/prompt`? Eso
   rompe layout en mobile, debe ser `useConfirm/useAlert/usePrompt`.
3. Verificar safe-area-inset-bottom en barra inferior (PWA iOS).

### 11.6 Login funciona pero redirige a otra área

El sistema usa `profiles.role` para enrutar. Verificar:
```sql
SELECT id, full_name, role FROM profiles WHERE id = 'USER_ID';
```

Si está mal el rol → UPDATE manual.

### 11.7 Trámite no permite agregar avance visible

Verificar que el cliente tenga `administracion.user_id` poblado (creado
correctamente). Sin user_id no se le puede mandar email/push.

### 11.8 Generación de tipos rompe el build

Tras una migración:
```bash
bash scripts/generate-types.sh
```

Si tira error: regenerar manualmente con la CLI de Supabase:
```bash
npx supabase gen types typescript --project-id <ID> > src/types/database.types.ts
```

---

## 12. Glosario

| Término | Significado |
|---|---|
| **Administración** | Cliente de Gestión Global. Persona o estudio que administra consorcios. |
| **Consorcio** | Edificio bajo gestión de una administración. |
| **Trámite / Tracking** | Expediente que se le abre a un cliente para un servicio. Internamente "trámite" para cliente y "tracking" para gerencia. |
| **Servicio** | Item del catálogo (RPAC matriculación, DDJJ, consultoría). |
| **Comprobante** | Factura (X / A / B / C) emitida al cliente. |
| **Movimiento** | Línea de caja (ingreso, egreso, transferencia). |
| **Imputación** | Vínculo entre un movimiento (cobranza) y un comprobante (deuda). |
| **Vencimiento** | Fecha próxima donde hay que renovar / pagar / actuar (matrícula, DDJJ, etc.). |
| **Solicitud** | Lead de captación: alguien llenó un formulario público. |
| **Prospecto** | Inscripto a webinar que no es cliente todavía. Separado de la tabla `administraciones`. |
| **Partner** | Aliado comercial con rendición de cuentas. |
| **Gestor** | Tercero que gestiona un trámite específico (acceso por token). |
| **Campus** | Subsistema de cursos y webinars. |
| **MDC** | Plataforma gemela (Manaxer / Documento Centralizado / etc.) usada como referencia de patrones. |
| **MANAXER** | Plataforma original que inspira layout de emails (templates v1). |
| **VAPID** | Voluntary Application Server Identification. Claves para Web Push. |
| **ARCA** | Administración Recaudadora de la Ciudad de Buenos Aires (factura electrónica). |
| **CAE** | Código de Autorización Electrónico de ARCA. |
| **CSR** | Certificate Signing Request para ARCA. |
| **RLS** | Row-Level Security (Postgres). |
| **DGG-##** | Decisión documentada en `knowledge-base/DECISIONES.md`. |
| **E##** | Error/lección documentada en `knowledge-base/ERRORES.md`. |

---

## 13. Anexo · atajos de teclado

### Globales (gerencia)

| Tecla | Acción |
|---|---|
| `⌘K` | Abrir command palette (Buscar pantallas, clientes, comprobantes…). |
| `⌘P` (próximamente) | Imprimir vista actual. |
| `Esc` | Cerrar modal / palette. |

### En la Agenda

| Tecla | Acción |
|---|---|
| `J` / ← | Período anterior. |
| `K` / → | Período siguiente. |
| `T` | Saltar a hoy. |
| `1` / `2` / `3` / `4` | Lista / Día / Semana / Mes. |
| `N` | Nuevo evento. |
| `⌘K` | Acciones scope-aware (ir a fecha, Modo enfoque, exportar). |

### En el FormularioBuilder

| Tecla | Acción |
|---|---|
| `⌘Z` | Deshacer. |
| `⇧⌘Z` | Rehacer. |
| `⌘1..9` | Insertar bloque (texto, número, fecha, archivo, select…). |
| `Delete` | Eliminar bloque seleccionado. |

---

## Apéndice A · Referencias cruzadas

- **Reglas no negociables** (13): `CLAUDE.md` §2.
- **Decisiones DGG-##**: `knowledge-base/DECISIONES.md`.
- **Errores E##**: `knowledge-base/ERRORES.md`.
- **Modelo de datos**: `knowledge-base/01_MODELO_DE_DATOS.md`.
- **Facturación / ARCA / Emails**: `knowledge-base/02_FACTURACION_ARCA_EMAILS.md`.
- **Conciliación / Cajas / Motor**: `knowledge-base/03_CONCILIACION_CAJAS_MOTOR.md`.
- **Móvil / Push / Reportes**: `knowledge-base/04_MOVIL_PUSH_REPORTES.md`.
- **Status actual**: `PROJECT_STATUS.md`.

---

## Apéndice B · Versionado de este manual

| Versión | Fecha | Cambios |
|---|---|---|
| 1.0 | 2026-05-31 | Versión inicial. Cubre todo el alcance MVP post-E2. |

---

> **Gestión Global · Aliados de tu tiempo**
> *gestionglobal.ar*
