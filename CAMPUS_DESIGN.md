# Campus · Diseño del rebuild (Punto 6)
> Fecha 2026-05-22 · Basado en DGG-10. Documento de diseño para aprobar antes de implementar.
> Auditoría sobre código real: migración `0029_campus.sql`, `src/services/api/campus.ts`,
> `src/modules/campus/` (4 pages + 5 components), rutas en `src/App.tsx`.

## 0. Resumen ejecutivo

- **La base es sólida y reutilizable.** Existen 10 tablas (`cursos`, `curso_modulos`, `curso_clases`, `curso_bibliografia`, `curso_examenes`, `curso_preguntas`, `curso_opciones`, `curso_matriculas`, `curso_progreso`, `examen_intentos`) con RLS completa (regla 2), índices en FKs (regla 11) y 4 RPCs `SECURITY DEFINER` (`curso_matricular`, `curso_marcar_clase_completada`, `curso_progreso_resumen`, `curso_responder_examen`). El quiz autocorregido (MC + V/F) **ya funciona server-side** y es exactamente lo que pide DGG-10.
- **El video por embed externo ya está resuelto.** `curso_clases.youtube_url` + helper `youtubeIdFromUrl()`. NO usa Supabase Storage. Cumple DGG-10 al pie.
- **Faltan 4 piezas centrales de DGG-10, todas nuevas:** (1) certificado PDF con QR verificable; (2) condiciones configurables por curso (3+1); (3) checklist de condiciones cumplidas por matrícula con tilde manual; (4) registro de asistencia sincrónica y de pago. **No existe ninguna tabla ni RPC para esto hoy.**
- **Hay un conflicto de modelo de acceso que hay que corregir:** hoy el alumno **puede auto-inscribirse** (`matricularse()` en API + RPC `curso_matricular` permite `auth.uid() = p_profile_id`; política `cursos_select_public` expone el catálogo a `anon`). DGG-10 exige **asignación manual de gerencia, sin autoservicio**. Esto es un cambio de política + UI, no solo código nuevo.
- **Esfuerzo total estimado: M-L.** El backend de contenido/quiz/progreso queda casi intacto; el trabajo es 1 migración nueva (condiciones + certificados + asistencia + pago), 1 edge function de render PDF, 1 motor de "certificado listo", una ruta pública de verificación, y refactor del flujo de acceso. Entregable incremental por fases (§8).

---

## 1. Auditoría de lo existente

### 1.1 Schema actual (tablas + columnas clave + RPCs)

**Tablas** (todas con `ENABLE ROW LEVEL SECURITY`, triggers `touch_updated_at` y varias con `audit_row`):

| Tabla | Columnas clave | Notas |
|---|---|---|
| `cursos` | `id`, `slug` (unique, regex kebab), `titulo`, `descripcion_html`, `modalidad` ('asincronica'/'sincronica'/'mixta'), `precio_lista numeric(14,2)`, `activo`, `cupo_max`, `vigencia_meses` (default 12), `instructor_nombre`, `banner_url`, `created_by` | Catálogo. |
| `curso_modulos` | `curso_id` FK, `orden`, `titulo` | Agrupador. |
| `curso_clases` | `modulo_id` FK, `orden`, `tipo` ('asincronica_video'/'sincronica_zoom'/'lectura_pdf'/'examen'), `youtube_url`, `zoom_url`, `zoom_fecha_hora`, `material_url`, `duracion_min` | El embed externo de video ya vive acá. |
| `curso_bibliografia` | `curso_id` FK, `titulo`, `url`, `archivo_url` | Material complementario. |
| `curso_examenes` | `curso_id` FK, `modulo_id` FK nullable, `intentos_max`, `nota_aprobacion` (default 60), `fecha_habilitacion`, `fecha_cierre`, `mostrar_resultados`, `mezclar_preguntas` | Ventana validada por trigger. |
| `curso_preguntas` | `examen_id` FK, `orden`, `tipo` ('multiple_choice'/'verdadero_falso'/'texto_corto'), `enunciado`, `puntaje` | |
| `curso_opciones` | `pregunta_id` FK, `texto`, `correcta bool`, `retroalimentacion` | `correcta` nunca se expone al front (P-CAMPUS-01). |
| `curso_matriculas` | `curso_id` FK, `profile_id` FK, `administracion_id` FK nullable, `vigencia_hasta`, `estado` ('activa'/'completada'/'vencida'/'anulada'), `submission_origen`, **UNIQUE(curso_id, profile_id)** | Inscripción. Una por (curso, alumno). |
| `curso_progreso` | `matricula_id` FK, `clase_id` FK, `completada`, `completada_at`, **UNIQUE(matricula_id, clase_id)** | Avance clase por clase. |
| `examen_intentos` | `matricula_id` FK, `examen_id` FK, `intento`, `nota`, `aprobado bool`, `respuestas jsonb`, **UNIQUE(matricula_id, examen_id, intento)** | Intentos. |

**RPCs `SECURITY DEFINER SET search_path = public, pg_temp`:**

- `curso_matricular(p_curso_id, p_profile_id, p_administracion_id) → uuid`: valida cupo, evita duplicados (UPSERT por unique), calcula `vigencia_hasta = now() + vigencia_meses`, encola email `curso-inscripcion-confirmada`. **Guard actual:** `IF auth.uid() <> p_profile_id AND NOT is_staff() THEN raise` → **permite autoservicio** (a corregir, §1.4).
- `curso_marcar_clase_completada(p_matricula_id, p_clase_id)`: idempotente (UPSERT progreso). Guard dueño-o-staff.
- `curso_progreso_resumen(p_matricula_id) → jsonb`: devuelve `{total_clases, completadas, porcentaje, examenes_aprobados}`.
- `curso_responder_examen(p_intento_id, p_respuestas) → jsonb`: **autocorrección server-side** de MC y V/F (compara opciones marcadas vs `correcta` exacto), texto_corto queda pendiente revisión humana; setea `nota`, `aprobado`. Devuelve `{nota, aprobado, pendientes_revision, detalle}`.
- Trigger `curso_examenes_ventana_check` (BEFORE INSERT en `examen_intentos`): valida ventana de fechas y cap `intentos_max`.
- `private.curso_matriculado(p_curso_id) → bool`: helper de RLS.
- Realtime publication sobre `curso_matriculas`, `curso_progreso`, `examen_intentos`.
- **Seed**: 2 cursos demo (RPAC Formación mixto + Actualización asincrónico) con módulos, clases, exámenes y preguntas reales.

### 1.2 UI actual (pantallas + qué hace cada una)

`src/modules/campus/pages/`:
- **CampusListPage** (gerencia, `/gerencia/campus`): cataloga cursos + KPIs, crea curso desde Drawer, usa `listMatriculas`.
- **CursoEditorPage** (gerencia, `/gerencia/campus/:id`): editor del curso (módulos/clases/exámenes).
- **MisCursosPage** (portal alumno, `/portal/campus`): muestra matrículas con progreso **y debajo un catálogo de cursos disponibles para inscribirse** ← contradice DGG-10 (autoservicio).
- **CursoDetalleAlumnoPage** (portal, `/portal/campus/:slug`): cursa el curso; si no está matriculado y el curso es público, **muestra CTA de inscripción** ← contradice DGG-10.

`src/modules/campus/components/`: `CursoCard`, `ClasePlayer` (embed YouTube), `ExamenRunner` (rinde quiz), `ExamenEditor`, `ProgresoBar`.

### 1.3 Rutas y accesos

En `src/App.tsx`:
- Gerencia (rol staff/gerente): `campus` → CampusListPage · `campus/:id` → CursoEditorPage.
- Portal (`Protected allow={['administrador']}`): `campus` → MisCursosPage · `campus/:slug` → CursoDetalleAlumnoPage.
- **No existe ruta pública** (la verificación de certificado por QR no tiene dónde montarse aún).
- RLS: `cursos_select_public` permite `SELECT` a `anon` de cursos `activo=true` (catálogo abierto). El resto de tablas requiere matrícula activa o staff vía `private.curso_matriculado()`.

### 1.4 Qué YA cumple de DGG-10 y qué NO

**Cumple:**
- ✅ Cursos → módulos → lecciones (`cursos`/`curso_modulos`/`curso_clases`).
- ✅ Videos por embed externo (YouTube), NO Storage.
- ✅ Quiz de opción múltiple **autocorregido server-side** (única condición automática).
- ✅ Alumnos = administradores clientes (portal `allow=['administrador']`, `matriculas.profile_id`/`administracion_id`).
- ✅ Tracking de progreso por clase + resumen %.

**NO cumple / falta:**
- ❌ **Acceso por asignación manual.** Hoy hay autoservicio: `matricularse()`, catálogo en MisCursos, CTA en detalle, RPC permite auto-matrícula, `cursos_select_public` a `anon`.
- ❌ **Condiciones configurables por curso** (examen + asistencia sincrónica + pago + otras). No existe tabla.
- ❌ **Checklist de condiciones por matrícula con tilde manual de gerencia/instructor.** No existe.
- ❌ **Registro de asistencia a encuentros sincrónicos** (las clases `sincronica_zoom` existen pero no hay tabla de asistencia).
- ❌ **Registro de pago del curso** (existe `precio_lista` pero no hay vínculo a pago/comprobante ni estado pagado).
- ❌ **Certificado PDF.** No hay tabla `certificados`, ni generación, ni `codigo_verificacion`, ni hash.
- ❌ **QR verificable + página pública `/verificar/:codigo`.** No existe ruta ni endpoint.
- ❌ **Motor de "certificado listo"** (disparo automático cuando TODAS las condiciones activas están verificadas) + email.

---

## 2. Gap analysis vs DGG-10

| Requisito DGG-10 | Estado actual | Qué falta |
|---|---|---|
| Cursos → módulos → lecciones | ✅ completo | — |
| Video por embed externo (no Storage) | ✅ `youtube_url` + helper | — |
| Quiz MC autocorregido | ✅ `curso_responder_examen` | — |
| Alumnos = administradores clientes | ✅ portal + matrículas | — |
| Acceso por asignación manual de gerencia (sin autoservicio) | ❌ hay autoservicio | Quitar catálogo/CTA del portal; bloquear self-matrícula en RPC; cerrar `cursos_select_public`; pantalla de asignación en gerencia |
| Condiciones del certificado configurables por curso (3+1) | ❌ no existe | Tabla `curso_condiciones_config` + UI |
| Tilde manual por condición (examen = automático) | ❌ no existe | Tabla `matricula_condiciones` + RPC tildar + auto-tilde de examen |
| Asistencia a encuentros sincrónicos | ❌ no existe | Tabla `clase_asistencias` o reuso de `curso_progreso` para `sincronica_zoom` |
| Pago completo del curso | ❌ no existe | Campo/tabla de pago (manual o vínculo a comprobante) |
| Certificado PDF con QR | ❌ no existe | Tabla `certificados` + edge function render PDF + lib QR |
| QR verificable (emitido desde el campus) | ❌ no existe | `codigo_verificacion` + `hash` + ruta pública `/verificar/:codigo` |
| Envío del certificado por mail al cumplir TODAS las condiciones activas | ❌ no existe | Motor (trigger/cron) + template email `curso-certificado-emitido` |
| Diseño del certificado | ⏳ **ASSET PENDIENTE** (lo provee el usuario) | Plantilla de render (placeholder hasta recibir modelo) |

---

## 3. Modelo de datos propuesto (deltas)

> Solo lo que se AGREGA. Migración nueva sugerida: `0045_campus_condiciones_certificados.sql`.
> Toda tabla nueva: `ENABLE ROW LEVEL SECURITY` (regla 2), índice en cada FK (regla 11),
> mutaciones multi-tabla vía RPC `SECURITY DEFINER` (regla 5). Naming técnico inglés / dominio
> español (regla 8); antes del RPC final verificar columnas reales de `cursos`/`curso_matriculas`
> con `information_schema.columns` (regla 8 / E43).

### 3.1 `curso_condiciones_config` — qué exige cada curso (el "3+1")

```sql
CREATE TABLE public.curso_condiciones_config (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  curso_id      uuid NOT NULL REFERENCES public.cursos(id) ON DELETE CASCADE,
  tipo          text NOT NULL
                  CHECK (tipo IN ('examen_aprobado','asistencia_sincronica','pago_completo','otra')),
  etiqueta      text NOT NULL,          -- copy mostrado ("Aprobar examen final", "Asistir a 2 encuentros")
  -- 'examen_aprobado' = auto (se tilda solo al aprobar). El resto: tilde manual de gerencia/instructor.
  automatica    boolean NOT NULL DEFAULT false,
  examen_id     uuid REFERENCES public.curso_examenes(id) ON DELETE SET NULL, -- solo si tipo='examen_aprobado'
  orden         smallint NOT NULL DEFAULT 0,
  activa        boolean NOT NULL DEFAULT true,  -- una condición desactivada NO bloquea el certificado
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_curso_condicion_tipo UNIQUE (curso_id, tipo, examen_id)
);
CREATE INDEX idx_curso_condiciones_curso ON public.curso_condiciones_config(curso_id);  -- regla 11
```
RLS: `SELECT` matriculados-o-staff (el alumno ve qué le falta); CUD solo staff (`private.is_staff()`).

### 3.2 `matricula_condiciones` — checklist por alumno (qué se tildó, quién, cuándo)

```sql
CREATE TABLE public.matricula_condiciones (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  matricula_id  uuid NOT NULL REFERENCES public.curso_matriculas(id) ON DELETE CASCADE,
  condicion_id  uuid NOT NULL REFERENCES public.curso_condiciones_config(id) ON DELETE CASCADE,
  cumplida      boolean NOT NULL DEFAULT false,
  cumplida_at   timestamptz,
  verificada_por uuid REFERENCES public.profiles(id) ON DELETE SET NULL, -- NULL si la tildó el sistema (examen)
  nota          text,                  -- observación opcional de quien tilda
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_matricula_condicion UNIQUE (matricula_id, condicion_id)
);
CREATE INDEX idx_matricula_condiciones_matricula ON public.matricula_condiciones(matricula_id);
CREATE INDEX idx_matricula_condiciones_condicion ON public.matricula_condiciones(condicion_id);
```
RLS: `SELECT` dueño-de-matrícula-o-staff. CUD solo staff (gerencia/instructor tilda).
La condición `examen_aprobado` se tilda automáticamente desde un AFTER UPDATE en `examen_intentos` (cuando `aprobado=true`) — extiende la lógica ya existente.

### 3.3 `certificados` — emisión verificable

```sql
CREATE TABLE public.certificados (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  matricula_id        uuid NOT NULL REFERENCES public.curso_matriculas(id) ON DELETE RESTRICT,
  curso_id            uuid NOT NULL REFERENCES public.cursos(id) ON DELETE RESTRICT,
  profile_id          uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  codigo_verificacion text NOT NULL UNIQUE,    -- corto, legible: p.ej. 'GG-2026-AB12CD' (gen_random_bytes)
  hash                text NOT NULL,           -- HMAC(secret, codigo|curso|profile|emitido_at) → integridad
  payload_snapshot    jsonb NOT NULL,          -- datos congelados al emitir (nombre, curso, instructor, fecha)
  pdf_url             text,                    -- Storage privado; signed URL al descargar
  emitido_at          timestamptz NOT NULL DEFAULT now(),
  email_enviado_at    timestamptz,             -- idempotencia del envío
  revocado            boolean NOT NULL DEFAULT false,
  revocado_motivo     text,
  CONSTRAINT uq_certificado_matricula UNIQUE (matricula_id)  -- un certificado por matrícula
);
CREATE INDEX idx_certificados_curso ON public.certificados(curso_id);
CREATE INDEX idx_certificados_profile ON public.certificados(profile_id);
-- codigo_verificacion ya tiene índice por UNIQUE.
```
RLS: `SELECT` dueño-o-staff. **La verificación pública NO usa RLS directa**: pasa por una RPC `certificado_verificar(p_codigo)` (`SECURITY DEFINER`) ejecutable por `anon`, que devuelve solo campos públicos (válido sí/no, curso, nombre, fecha, revocado) — nunca el `hash` ni el PDF. CUD solo staff/sistema.

### 3.4 `clase_asistencias` — asistencia a encuentros sincrónicos

```sql
CREATE TABLE public.clase_asistencias (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  matricula_id  uuid NOT NULL REFERENCES public.curso_matriculas(id) ON DELETE CASCADE,
  clase_id      uuid NOT NULL REFERENCES public.curso_clases(id) ON DELETE CASCADE,  -- tipo='sincronica_zoom'
  presente      boolean NOT NULL DEFAULT true,
  registrada_por uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  registrada_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_clase_asistencia UNIQUE (matricula_id, clase_id)
);
CREATE INDEX idx_clase_asistencias_matricula ON public.clase_asistencias(matricula_id);
CREATE INDEX idx_clase_asistencias_clase ON public.clase_asistencias(clase_id);
```
RLS: `SELECT` dueño-o-staff; CUD solo staff. Alternativa más liviana para MVP: no crear tabla y modelar asistencia como `matricula_condiciones` tildada a mano (ver §9, decisión abierta).

### 3.5 Pago del curso

Dos opciones (decisión abierta §9). Propuesta por defecto **(A) manual**, mínima fricción:
```sql
ALTER TABLE public.curso_matriculas
  ADD COLUMN pago_estado text NOT NULL DEFAULT 'no_aplica'
    CHECK (pago_estado IN ('no_aplica','pendiente','pagado')),
  ADD COLUMN pago_at timestamptz,
  ADD COLUMN pago_registrado_por uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN comprobante_id uuid REFERENCES public.comprobantes(id) ON DELETE SET NULL; -- opcional (B)
```
(B) vincular a `comprobantes` reutiliza el núcleo de facturación ya existente; el "pago_completo" se deriva del estado del comprobante. Verificar nombre real de la tabla/columna de comprobantes antes de la FK (regla 8 / E43).

### 3.6 RPCs nuevas (regla 5 · multi-tabla / lógica sensible)

- `curso_asignar_alumno(p_curso_id, p_profile_id, p_administracion_id) → uuid` — **reemplaza el autoservicio**: solo staff; crea matrícula + materializa filas en `matricula_condiciones` por cada condición activa del curso; encola email de asignación.
- `matricula_tildar_condicion(p_matricula_condicion_id, p_cumplida, p_nota) → jsonb` — staff; tilda/destilda, registra `verificada_por`; al final llama a `matricula_evaluar_certificado`.
- `matricula_evaluar_certificado(p_matricula_id) → jsonb` — chequea si TODAS las condiciones `activa=true` están `cumplida=true`; si sí y no hay certificado → inserta `certificados` (con `codigo_verificacion` + `hash`) y encola job de render + email. **Idempotente** (UNIQUE matricula + `email_enviado_at`).
- `certificado_verificar(p_codigo) → jsonb` — `anon`; valida hash, devuelve campos públicos.

---

## 4. Flujos

### 4.1 Instructor/gerencia
1. Crea/edita curso (CampusListPage → CursoEditorPage, ya existe).
2. **Define módulos, clases (videos embed, encuentros zoom), exámenes** (ya existe).
3. **Define condiciones del certificado** (nuevo tab en el editor): tilda cuáles exige — Examen aprobado (auto, elige cuál examen), Asistencia sincrónica, Pago completo, + condiciones "otra" libres. Marca cada una `activa`.
4. **Asigna alumnos** (nueva pantalla / drawer): selecciona administrador cliente → `curso_asignar_alumno`. Sin autoservicio.
5. A medida que el curso avanza, en la **ficha del alumno (gestión de matrícula)** ve el checklist de condiciones y **tilda manualmente** las no automáticas (asistencia, pago, otras). El examen se tilda solo.
6. Cuando todas las condiciones activas quedan tildadas, el motor (§7) **emite el certificado y lo manda por mail** automáticamente. Gerencia ve el badge "Certificado emitido".

### 4.2 Alumno (portal)
1. Ve **solo los cursos que le asignaron** (no hay catálogo abierto). Estado vacío premium si no tiene ninguno: "Todavía no tenés cursos asignados. Tu administrador habilita el acceso."
2. Entra al curso (CursoDetalleAlumnoPage), cursa lecciones (ClasePlayer embed), **marca clases completadas** (`curso_marcar_clase_completada`).
3. **Rinde el quiz** (ExamenRunner → `curso_responder_examen`): ve nota y aprobado al instante.
4. Ve su **progreso (%) y el checklist de condiciones**: cuáles ya cumplió (examen ✓ auto) y cuáles dependen de gerencia (asistencia/pago "pendiente de verificación").
5. Al emitirse el certificado: lo **recibe por mail** + lo puede **descargar desde el portal** (PDF con QR).

### 4.3 Verificación pública del certificado
1. Cualquiera escanea el QR del PDF → abre `https://gestionglobal.ar/verificar/:codigo`.
2. La página pública (sin login) llama `certificado_verificar(codigo)`.
3. Muestra: **válido / no encontrado / revocado**, nombre del egresado, curso, fecha de emisión, instructor. Branding Gestión Global. No expone datos sensibles ni el PDF.

---

## 5. Pantallas (nuevas y a modificar)

**Modificar:**
- **MisCursosPage** (portal): **quitar el catálogo y CTA de inscripción**. Solo "Mis cursos asignados" + estado vacío. Agregar tarjeta de certificado descargable cuando exista.
- **CursoDetalleAlumnoPage** (portal): **quitar CTA de inscripción**; agregar panel lateral "Tu progreso y condiciones" (checklist con estados); botón "Descargar certificado" si emitido.
- **CursoEditorPage** (gerencia): nuevo tab **"Condiciones del certificado"** (configurar el 3+1).
- **CampusListPage** (gerencia): agregar acción **"Asignar alumno"** y acceso a la gestión de matrículas.

**Nuevas:**
- **GestionMatriculasPage / Drawer (gerencia)**: lista de alumnos de un curso, su progreso, **checklist de condiciones con tildes manuales**, badge de certificado, botón "registrar pago" / "registrar asistencia".
- **AsignarAlumnoDrawer (gerencia)**: buscar administrador cliente → asignar curso.
- **VerificarCertificadoPage (PÚBLICA, `/verificar/:codigo`)**: confirma autenticidad del certificado. Ruta nueva fuera de `/portal` y `/gerencia`.

Microinteracciones premium: tilde de condición con transición + toast `sonner`; barra de progreso animada (ya existe ProgresoBar); confeti/celebración sutil al emitirse el certificado; skeletons en carga; estados empty con copy institucional-cercano.

---

## 6. Certificado PDF con QR

- **Generación — recomendado: edge function (Deno) server-side.** Razón regla 3 (sin secretos en front) + el `hash`/HMAC debe firmarse con un secret que NO puede vivir en el cliente, y el PDF debe quedar en Storage privado. `jspdf ^4.2.1` ya está en el proyecto y **corre en Deno** — la edge function arma el PDF con jspdf, lo sube a un bucket privado `certificados/` y guarda `pdf_url`. (Alternativa de front con jspdf+html2canvas queda descartada porque `html2canvas` NO está instalado y porque el front no debe tener el secret del hash.)
- **QR**: no hay librería de QR instalada → **agregar `qrcode`** (genera dataURL/PNG, funciona en Deno y en front). El QR codifica la **URL pública** `https://gestionglobal.ar/verificar/:codigo_verificacion`. La autenticidad real la da `certificado_verificar` validando el `hash` server-side; el QR es solo el atajo.
- **Payload del PDF** (de `payload_snapshot`): nombre del egresado, título del curso, instructor, fecha de emisión, código de verificación legible, horas/duración, logo Gestión Global.
- **Diseño: ASSET PENDIENTE.** El usuario proveerá el modelo. Placeholder: layout A4 horizontal con branding cian/naranja/tinta; el QR va en una esquina inferior con la leyenda "Verificá este certificado en gestionglobal.ar/verificar". **Dependencia explícita — no se finaliza el render hasta recibir el modelo.**

---

## 7. Motor de "certificado listo"

- **Disparo: por evento, no por cron** (más simple e inmediato). Cada vez que se tilda una condición (`matricula_tildar_condicion`) o se aprueba un examen (AFTER UPDATE en `examen_intentos`), se llama `matricula_evaluar_certificado(matricula_id)`.
- Lógica: si **todas** las condiciones `activa=true` del curso están `cumplida=true` para esa matrícula **y** no existe ya un certificado → inserta `certificados`, genera `codigo_verificacion` + `hash`, encola (a) job de render PDF (edge function) y (b) email `curso-certificado-emitido` vía `encolar_email` (SMTP Google Workspace, no Resend — instrucción 2026-05-19).
- **Idempotencia**: `UNIQUE(matricula_id)` en `certificados` + chequeo de `email_enviado_at` antes de reencolar. Si una condición se destilda después, el certificado NO se reemite (queda emitido; revocación es acción explícita de staff).
- **Backstop opcional (cron diario)**: barre matrículas activas que cumplen condiciones pero no tienen certificado (cubre estados inconsistentes). Reutiliza `pg_cron` ya presente en el stack.

---

## 8. Plan de implementación por fases

**Fase 1 · MVP (M)** — aula virtual real con acceso correcto, sin certificado todavía:
- Cerrar autoservicio: bloquear self-matrícula en RPC, cerrar `cursos_select_public` (catálogo solo staff), quitar catálogo/CTA del portal.
- RPC `curso_asignar_alumno` + AsignarAlumnoDrawer.
- Migración con `curso_condiciones_config` + `matricula_condiciones` + auto-tilde de examen.
- Tab "Condiciones" en CursoEditorPage + GestionMatriculasPage con checklist tildable.
- Entregable: gerencia asigna alumnos, define y tilda condiciones; alumno cursa y rinde quiz (ya funciona) y ve su checklist.

**Fase 2 · Certificado + verificación (M-L)**:
- Tabla `certificados` + RPC `matricula_evaluar_certificado` + `certificado_verificar` + motor de disparo.
- Edge function de render PDF (jspdf) + lib `qrcode` + bucket privado.
- Email `curso-certificado-emitido` (template).
- Ruta pública `/verificar/:codigo` (VerificarCertificadoPage).
- **Bloqueante parcial**: diseño final del PDF espera el ASSET del usuario (se entrega con placeholder y se ajusta luego).

**Fase 3 · Pago y asistencia formal (S-M)**:
- Campos/tabla de pago (`pago_estado` o vínculo a `comprobantes`) + `clase_asistencias` formal (si no se modeló como condición manual en Fase 1).
- Registro de pago/asistencia desde GestionMatriculasPage.

**Fase 4 · Pulido premium (S)**:
- Celebración al emitir certificado, integración con Agenda (encuentros sincrónicos como eventos — DGG-06), notificaciones in-app, reportes de cursos en ReportesHub.

---

## 9. Decisiones abiertas para el usuario

1. **Pago del curso: ¿manual o vinculado a comprobante?** Propuesta: campo `pago_estado` manual en Fase 1 (gerencia tilda "pagado"), y en Fase 3 vincular opcionalmente a un `comprobante_id` del núcleo de facturación. ¿Querés el vínculo a cuenta corriente desde el día 1?
2. **Asistencia sincrónica: ¿registro formal por encuentro o una sola condición manual?** Propuesta MVP: una condición manual "Asistencia a encuentros" que gerencia tilda; la tabla `clase_asistencias` por-encuentro queda para Fase 3 si necesitás detalle. ¿Alcanza con el tilde único?
3. **Verificación pública del QR: ¿sin login (recomendado) o con captcha?** Propuesta: pública sin login, RPC `SECURITY DEFINER` que solo expone campos no sensibles. ¿OK, o querés un captcha/rate-limit?
4. **¿Qué datos exactos van en el certificado?** Propuesta: nombre del egresado, curso, instructor, fecha de emisión, código de verificación, horas. ¿Agregás nota del examen? ¿firma del instructor? ¿logo/sello específico?
5. **Diseño del certificado (ASSET PENDIENTE).** Necesitamos el modelo/plantilla para finalizar el render. ¿Lo tenés o lo diseñamos nosotros con la paleta de marca?
6. **Cursos pagos vs gratuitos / precio_lista.** Hoy `cursos.precio_lista` existe pero sin flujo de cobro. ¿El campus cobra dentro de la plataforma o el pago es externo y solo se registra?
7. **Alumnos = solo el administrador titular, o también sus "designados"?** DGG-10 menciona "potencialmente sus designados". ¿Entra en alcance ahora?
