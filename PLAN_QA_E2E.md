# PLAN_QA_E2E · Auditoría flujo del cliente

> Plan de testeo punta a punta iniciado 2026-05-26.
> Documento vivo. Se actualiza con resultados de cada flujo.

---

## 0. Estado inicial (reconocimiento Fase 1)

### Inventario operativo
| Recurso | Cantidad | Notas |
|---|---:|---|
| Administraciones (clientes) | 2 | Sol y Luna SRL + 1 más |
| Consorcios | 2 | |
| Servicios activos en catálogo | 10 | Ver §1.1 |
| Formularios activos | 8 | Ver §1.2 |
| `formulario_submissions` | 0 | Entorno limpio |
| `solicitudes` | 0 | Entorno limpio |
| `trackings` (tramites) | 0 | Entorno limpio |
| `comprobantes` | 2 | Residuos de QA finanzas |
| `movimientos` cuenta corriente | 1 | Idem |
| `email_templates` activos | 20 | OK |
| `sent_emails` | 11 | Incluye los 3 tests de pabloeacu |
| `cursos` | 2 | Formación + Actualización RPAC |
| `curso_matriculas` | 1 | Sol y Luna en Formación |
| `profiles` | 3 | 2 gerentes + 1 administrador |

### Credenciales para QA
| Rol | Email | Password | Vinculación |
|---|---|---|---|
| Gerente | `pabloeacu@gmail.com` | `EagleView2026` | — |
| Administrador (cliente) | `admin@solyluna.test` | `SolYLuna2026` | Administración Sol y Luna SRL |

---

## 1. Catálogo + formularios (snapshot al inicio)

### 1.1 Servicios activos (10)

| Código | Nombre | Precio modo | Campus | Form slug declarado |
|---|---|---|:---:|---|
| `administracion_global` | Administración Global | por_unidad_funcional | — | `plataforma/administracion-global` ❌ |
| `capacitacion_gratuita` | Capacitaciones gratuitas | fijo $0 | — | (vacío) |
| `curso_actualizacion_rpac` | Curso de Actualización RPAC | fijo $0 | ✅ | `cursos/actualizacion-rpac` ❌ |
| `curso_formacion_rpac` | Curso de Formación RPAC | fijo $0 | ✅ | `cursos/formacion-rpac` ❌ |
| `juridico_consulta` | Consulta jurídica | por_tramite | — | `juridico/consulta` ❌ |
| `rpa_actualizacion` | Actualización RPA · CABA | fijo $0 | ✅ | `rpa/actualizacion` ❌ |
| `rpac_certificado` | Certificado de acreditación RPAC | fijo $0 | — | `rpac/certificado` ❌ |
| `rpac_ddjj` | Declaraciones juradas anuales | por_consorcio | — | `rpac/ddjj` ❌ |
| `rpac_inscripcion` | Inscripción al RPAC | fijo $0 | — | `rpac/inscripcion` ❌ |
| `rpac_renovacion` | Renovación de matrícula RPAC | fijo $0 | — | `rpac/renovacion` ❌ |

⚠️ **TODOS los `precio_base` están en $0**. Ningún servicio cobra. Esto requiere decisión del usuario antes de continuar.

⚠️ **El vínculo formulario_publico_slug está roto en 9/9** (EGG-QA-01).

### 1.2 Formularios activos (8)

| Slug | Título | Categoría | Público | tiene servicio_id |
|---|---|---|:---:|:---:|
| `consultoria-juridica` | Solicitud de consultoría jurídica | consulta | ✅ | ❌ |
| `curso-actualizacion` | Curso de actualización para administradores | curso | ✅ | ❌ |
| `curso-formacion` | Curso inicial de formación de administradores | curso | ✅ | ❌ |
| `webinarios` | Inscripción a webinarios gratuitos | evento | ✅ | ❌ |
| `certificado-rpac` | Certificado de matrícula RPAC activa | tramite | ✅ | ❌ |
| `ddjj-anual` | Declaración Jurada anual de administrador | tramite | ✅ | ❌ |
| `matriculacion-rpac` | Inscripción al RPAC | tramite | ✅ | ❌ |
| `renovacion-rpac` | Renovación bianual de matrícula RPAC | tramite | ✅ | ❌ |

---

## 2. Mapa de los 10 escenarios ficticios

| # | Persona | Origen | Servicio | Flujos a validar |
|---|---|---|---|---|
| A | Cliente nuevo | landing pública | matriculacion-rpac | 4, 5, 6, 7, 8, 9, 10, 11, 12, 13 |
| B | Cliente existente | portal interno | certificado-rpac | 18 |
| C | Cliente existente confundido | landing pública | renovacion-rpac | 19 (detección dup) |
| D | Prospecto | landing pública | webinar gratuito | 23 |
| E | Cliente activo en webinar | portal | webinar gratuito | 23, 24 |
| F | Alumno nuevo | landing | curso-formacion-rpac | 20, 21, 22 |
| G | Alumno existente | portal | curso-actualizacion | 20, 22 |
| H | Consulta jurídica | landing | consultoria-juridica | 4..17 con tracking jurídico |
| I | Documentación incompleta | gerencia observa | matriculacion-rpac | 6 observación |
| J | Servicio finalizado | gerencia cierra | cualquiera | 17 cierre |

---

## 3. Orden de ejecución (Fase 3)

### Bloque 1 · Captación pública
- [ ] **Test 1**: Visitante anónimo abre `/inicio` (landing). Validar que hay acceso a servicios.
- [ ] **Test 2**: Visitante abre cada formulario público y verifica que carga (8 URLs).
- [ ] **Test 3 (escenario A)**: Submit de `matriculacion-rpac` con adjuntos + comprobante de pago.
- [ ] **Test 4**: Verifica creación de `formulario_submission` + `solicitud` (trigger).
- [ ] **Test 5**: Verifica email de acuse al solicitante.

### Bloque 2 · Gerencia recibe
- [ ] **Test 6**: Gerente logueado ve la solicitud nueva en dashboard + listado.
- [ ] **Test 7**: Abre detalle de solicitud, ve datos+adjuntos+comprobante.
- [ ] **Test 8**: Wizard de activación: alta cliente nuevo + crear tracking + email bienvenida.
- [ ] **Test 9**: Cliente nuevo recibe email con credenciales temporales.

### Bloque 3 · Cuenta corriente + pago
- [ ] **Test 10**: Gerencia emite comprobante para el servicio.
- [ ] **Test 11**: Gerencia registra pago contra el comprobante (imputación).
- [ ] **Test 12**: Cliente ve cargo + pago + saldo cero en portal.

### Bloque 4 · Tracking + derivación
- [ ] **Test 13**: Línea de tracking "Recibido y enviado a gestoría".
- [ ] **Test 14**: Derivación a gestoría externa (token capaz + email).
- [ ] **Test 15**: Acceso externo desde token: ver datos + adjuntos.
- [ ] **Test 16**: Avance de tracking visible en portal cliente.
- [ ] **Test 17**: Cierre con documento final.

### Bloque 5 · Portal cliente (nuevo)
- [ ] **Test 18**: Primer ingreso cliente nuevo. Cambio de password. Tour.
- [ ] **Test 19**: Ve solo lo suyo (RLS test).
- [ ] **Test 20**: Solicita nuevo servicio desde portal (escenario B).
- [ ] **Test 21**: Sistema detecta cliente existente, no duplica.

### Bloque 6 · Cliente confundido (escenario C)
- [ ] **Test 22**: Cliente existente completa form en landing pública.
- [ ] **Test 23**: Sistema detecta duplicado por CUIT/email + avisa a gerencia.

### Bloque 7 · Webinars (escenarios D, E)
- [ ] **Test 24**: Prospecto inscribe a webinar gratuito.
- [ ] **Test 25**: Cliente existente inscribe a webinar (NO duplicar como cliente).

### Bloque 8 · Cursos + campus (escenarios F, G)
- [ ] **Test 26**: Inscripción a curso. Pago. Permiso de campus activado.
- [ ] **Test 27**: Acceso al campus, ver clases, rendir examen, certificado.

### Bloque 9 · Notificaciones
- [ ] **Test 28**: Push notification al cliente cuando avanza tracking.
- [ ] **Test 29**: In-app notification al gerente cuando llega solicitud.
- [ ] **Test 30**: Recordatorios de agenda.

### Bloque 10 · Seguridad y permisos
- [ ] **Test 31**: Cliente NO ve datos de otro cliente.
- [ ] **Test 32**: Gestoría externa NO accede al panel interno.
- [ ] **Test 33**: Token de acceso externo se puede revocar.

### Bloque 11 · Cierres con documentación final
- [ ] **Test 34** (escenario I): Documentación incompleta → observación → corrección.
- [ ] **Test 35** (escenario J): Cierre con certificado final adjunto.

---

## 4. Bugs hallados durante ejecución

Ver `BUGS_QA_E2E.md` para detalle. Resumen al cierre:

| Severidad | Count | IDs |
|---|---:|---|
| 🔴 Crítico | 1 | EGG-QA-01 |
| 🟠 Alto | 0 | — |
| 🟡 Medio | 0 | — |
| 🟢 Bajo | 0 | — |
