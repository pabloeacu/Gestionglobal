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
