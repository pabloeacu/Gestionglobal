# Backlog · Plataforma Gestión Global

> Estado vivo del proyecto. Se actualiza con cada ronda.

---

## 9-Step Roadmap del usuario

1. **Bugfixes ronda 1** → ✅ Completado (commit `054ffd2`)
2. **38 mejoras premium / UX / robustez** → 🟡 En progreso (13 / 38 hechos)
3. **Agentes E, F, G, H** (form builder, push, búsqueda, finanzas) → 🟡 Replanificado: ahora arranca como **Ronda 5** con Flujo Maestro
4. **Revisión completa browser** → ⏳ Pendiente tras Ronda 5
5. **Mejoras premium nueva ronda** → ⏳ Pendiente
6. **Revisión link-por-link** (Campus rebuild incluido) → ⏳ Pendiente
7. **Mockup web mejorada con presentación** → ⏳ Pendiente
8. **Revisión punta a punta del proyecto** → ⏳ Pendiente
9. **Planificación de lo que reste** → ⏳ Pendiente

---

## Backlog de los 38 puntos del Punto 2

### Hechos (13)

- [x] #2 AnimatedNumber sin "0→N" inicial
- [x] #5 Footer institucional mini con versión
- [x] #7 Grilla de atajos completa (11 items)
- [x] #8 Dashboard analítico con KPI strip + sparkline en home
- [x] #11 Búsqueda global ⌘K end-to-end con RPC
- [x] #14 Tabs sticky en ConfiguracionLayout
- [x] #20 Editor templates con autocomplete `{{vars}}`
- [x] #21 Botón "Enviar prueba a mí"
- [x] #22 Preview email desktop/mobile sandboxed
- [x] #27 Code splitting React.lazy (35 páginas)
- [x] #28 Avatar WebP con fallback JPEG
- [x] #29 PWA service worker + manifest installable

### Pendientes (25)

**Estética & branding**
- [ ] #1 Tipografía de cards homogénea (32px vs 36px)
- [ ] #3 IllustratedEmpty consistente en todas las páginas vacías
- [ ] #4 Skeleton loaders con timeout/fallback
- [ ] #6 Iconografía stroke-width audit

**Inicio / Operación**
- [ ] #9 FAB con quick actions
- [ ] #10 Tour de bienvenida (Shepherd.js o similar)
- [ ] #12 Docs de atajos de teclado en el palette (`?`)
- [ ] #13 Selector de período global en header
- [ ] #15 Indicador de estado Realtime (dot)
- [ ] #16 Botón "Copiar como CSV" en tablas

**Form builder (Ronda 5 — Agente E)**
- [ ] #17 Editor visual de schema JSONB drag&drop
- [ ] #18 Plantillas de formularios
- [ ] #19 Embed (iframe + JS snippet)

**Comunicación & email**
- [ ] #23 Tracking de aperturas y clicks

**Reportes & datos**
- [ ] #24 Dashboard analítico con gráficos avanzados (no sparkline)
- [ ] #25 Exportes programados (cron mensual + email)
- [ ] #26 Filtros guardados ("Mis vistas")

**Performance & DevOps**
- [ ] #30 Push notifications VAPID (Ronda 5 — Agente F)
- [ ] #31 Sentry / error tracking
- [ ] #32 Health check page `/health`

**Seguridad**
- [ ] #33 2FA TOTP opcional
- [ ] #34 Audit log unificado
- [ ] #35 Sesiones activas en Perfil

**Negocio**
- [ ] #36 DNS gestionglobal.ar → Vercel
- [ ] #37 Multi-idioma EN/PT (i18n)
- [ ] #38 API pública con OpenAPI

---

## Flujo Maestro (subsistema agregado en Punto 3)

26 puntos del documento "Flujo Maestro de Solicitudes, Tracking, Activación de Clientes y Agenda Operativa".

**Cubierto por agentes de Ronda 5:**

| Bloque | Cubre puntos | Agente |
|---|---|---|
| Centro de solicitudes recibidas | 1-5 (filosofía + alertas + revisión) | G1 |
| Wizard operativo de activación (3 pasos) | 6-8 (derivación, alta cliente, tracking) | G1 |
| Acceso externo seguro (sin login) | 7 (links a terceros gestores) | F |
| Sistema de tracking como entidad | 9-15 (estructura, estados, líneas, categorías) | G2 |
| Integración tracking con cuenta cte + automatizaciones | 16-17 | G2 |
| Activación de cliente nuevo / existente + email | 18-22 (credenciales + recurrencia + cierre) | G1 |
| Módulo de agenda / calendario operativo | 23-25 (eventos, alertas, vistas) | F |

---

## Pendientes específicos del Campus virtual (Punto 6)

Detectado durante test browser: **el editor de cursos crashea** con React #310, y la estructura de aula virtual no está completa.

**Fases anotadas para Punto 6:**
- **A** · Fix React #310 en `CursoEditorPage`
- **B** · Constructor completo: editor de clases (YouTube embed + docente + descripción), bibliografía (archivo o link), exámenes (MC + V/F + retroalimentación)
- **C** · Vista alumno end-to-end: navegación módulo > clase > examen con autocorrección
- **D** · Conexión: inscripción al curso (formulario) → matrícula automática

---

## Otros pendientes del Documento Maestro original

- **Finanzas** · caja, bancos, conciliación (único módulo "PRONTO" del sidebar) → **Ronda 6**
- **Recupero R1/R2/R3** · ✅ Hecho
- **Partners + rendiciones** · ✅ Hecho
- **Vencimientos + alertas estratégicas** · ✅ Hecho
- **DNS apuntando a Vercel** · ⏳ Pendiente (acción del usuario en Cloudflare/NIC.ar)
- **Importador histórico Excel** · ✅ Hecho
