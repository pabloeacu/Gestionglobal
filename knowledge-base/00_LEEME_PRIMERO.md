# Para Gestión Global · Paquete de arranque

> **Qué es esto.** Capitaliza ~18 meses de trabajo, prueba y error de MANAXER (plataforma gemela ya en producción) para que Gestión Global arranque funcionando bien **de una**, sin repetir los errores que ya pagamos.
>
> **Quién lo usa.** Sos Claude en una sesión nueva, arrancando la plataforma de Gestión Global. El usuario te va a pasar estos archivos. Leelos en orden antes de proponer schema o tirar la primera línea de código. Cuando justifiques una decisión, citá los IDs (E##, D##, P-XX-NN, regla N) — el usuario los reconoce.

---

## 0. El negocio en 5 frases

1. **Gestión Global administra consorcios**: su cliente es la **Administración**, y cada administración tiene N **Edificios** (consorcios). Se factura un servicio mensual (abono) a cada edificio.
2. **Multi-tenant**: la raíz es `empresas` (Gestión Global es una empresa). Todo dato lleva `empresa_id` y está aislado por RLS. Si mañana se suma otra firma, es otra fila en `empresas`.
3. **Edificios con CUIT propio vs sin CUIT**: algunos consorcios tienen CUIT (factura A/responsable inscripto); otros no → se les asigna un **DNI ficticio secuencial** (rango 99000001+) para que ARCA acepte el receptor.
4. **Factura al consorcio o a la administración**: un flag por edificio (`facturar_con_cuit_administracion`) decide si el comprobante sale con los datos del edificio o con CUIT+razón social de la administración. El comprobante guarda un **snapshot** de la administración al momento de emitir (cambiar de admin después no reescribe lo histórico).
5. **Núcleo operativo**: facturación electrónica (ARCA/AFIP), conciliación bancaria con motor de aprendizaje, control de cajas, recupero de mora, emails automatizados, versión móvil/PWA con push.

---

## 1. Orden de lectura de este paquete

| # | Archivo | Qué cubre | Cuándo leerlo |
|---|---------|-----------|---------------|
| 00 | **LEEME_PRIMERO** (este) | Mapa + checklist de arranque + filosofía | Primero, completo |
| 01 | **MODELO_DE_DATOS** | Schema completo: todas las tablas, FKs, CHECK, RLS, triggers, roles. El modelo admin/edificio/CUIT/consorcio | Antes de la 1ra migración |
| 02 | **FACTURACION_ARCA_EMAILS** | Playbook ARCA (WSAA+WSFEv1 nativo), lotes, NC/ND, cola de emails con throttle, splitter, Resend, plantillas | Al encarar facturación |
| 03 | **CONCILIACION_CAJAS_MOTOR** | Conciliación bancaria chunked, cascada de matching, motor de patrones aprendidos, PACs, tipos de movimiento, blindaje | Al encarar finanzas |
| 04 | **MOVIL_PUSH_REPORTES** | PWA, push (VAPID), avisos inteligentes, reportes, dashboard, realtime | Al encarar UX avanzada |
| 05 | **REGLAS_ERRORES_DECISIONES** | Las 13 reglas no negociables + los 52 errores históricos + decisiones + patrones + antipatrones | Permanente — es el contrato |

**La 05 es el contrato.** Las 13 reglas no se rompen nunca. Los 52 errores ya están resueltos en MANAXER: si vas a tropezar con uno, está documentado con su fix.

---

## 2. Filosofía (3 principios que ordenan todo)

1. **La BD es la fuente de verdad. Siempre.** Toda mutación de negocio pasa por Supabase (RPC para multi-tabla). `setState` sin persistir = bug. RLS activa en toda tabla. Test de solidez: "F5 después de guardar" — si el dato no sobrevive el refresh, está mal.
2. **Defensa en 3 capas para todo dato que cruza un boundary externo** (AFIP, banco, Resend): UI valida + DB CHECK constraint bloquea + edge function re-valida con regex. Nunca confiar en una sola capa (ver E41).
3. **Cola persistida + cron + Realtime, no client-side loops.** Cualquier operación larga (autorizar lote ARCA, mandar 100 emails, procesar extracto) vive en una tabla `*_queue`, un cron la procesa, el browser solo escucha Realtime. Si el usuario cierra la pestaña, el flujo sigue.

---

## 3. Stack (idéntico a MANAXER — probado)

```
Frontend:  React 18 + TypeScript strict + Vite 6 + Tailwind + lucide-react + sonner
Editor:    TipTap 3.x (plantillas email) + DOMPurify (sanitizar)
Excel:     xlsx (SheetJS)        PDF: jsPDF + autoTable | html2canvas+jsPDF (factura oficial)
Backend:   Supabase = Postgres 15 + Auth + Storage + Edge Functions (Deno)
Cron:      pg_cron + pg_net (HTTP saliente desde Postgres)
Email:     Resend (dominio verificado con DKIM/SPF/DMARC)
SOAP ARCA: nativo, sin SDKs. Firma PKCS#7 con node-forge
Push:      Web Push API + VAPID
Hosting:   Vercel auto-deploy desde main
```

Versiones críticas: `@supabase/supabase-js@^2`, `react@^18`, `vite@^6`, `typescript@^5.6`, `xlsx@^0.18`, `jspdf@^2`, `html2canvas@^1.4`, `node-forge@^1` (sólo edge), `@tiptap/react@^3`.

---

## 4. Checklist de arranque desde cero

### Fase 0 — Setup del contrato
- [ ] Copiar los 7 archivos del framework MDC a `knowledge-base/` + crear `ERRORES.md` y `DECISIONES.md` vacíos con template.
- [ ] `CLAUDE.md` en la raíz con las **13 reglas no negociables** (ver doc 05, sección 1 — transcritas textualmente, cópialas tal cual cambiando "MANAXER" por "Gestión Global").
- [ ] Proyecto Supabase creado + `.env.local` con `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
- [ ] Vercel: importar repo + envs (preview + production).
- [ ] Estructura de carpetas (ver doc 05, sección 6).

### Fase 1 — Schema base (doc 01)
- [ ] Mig `0001_initial_schema`: `empresas`, `profiles` (espejo auth.users), helpers RLS (`get_user_role`, `current_empresa_id`, `is_apex/partner/pulse`, `assert_empresa_access`), trigger `handle_new_user`, `touch_updated_at`.
- [ ] Mig `0002_clientes`: `administraciones`, `edificios` (con `tipo_documento`, trigger `asignar_dni_ficticio`, `facturar_con_cuit_administracion`, `nombre_normalizado` + trigger), `administracion_emails`.
- [ ] Mig `0003_facturacion`: `comprobantes` (snapshot receptor + CHECK regex doc), `items_comprobantes`, `numeradores`, `lotes_facturacion`, `empresa_arca_config`.
- [ ] Mig `0004_finanzas`: `cajas` (+ seed trigger), `categorias_finanzas`, `movimientos`, `movimiento_imputaciones` (CHECK XOR comprobante/admin).
- [ ] Mig `0005_conciliacion`: `extractos_bancarios`, `extractos_lineas`, `patrones_conciliacion_aprendidos`, `patrones_egreso_categoria`.
- [ ] Mig `0006_emails_push`: `sent_emails`, `email_queue`, `push_subscriptions`, `push_outbox`, `auditoria_cambios`, `pulse_permissions`.
- [ ] **RLS en TODA tabla** desde el día 1 (regla 2). Policies con `DROP POLICY IF EXISTS; CREATE POLICY` (E04, nunca `IF NOT EXISTS`).
- [ ] **Toda FK con su índice** en la misma migración (regla 11, E48).
- [ ] `bash scripts/generate-types.sh` → `src/types/database.ts`.
- [ ] Smoke: `npm run build` OK, login/logout, `profiles` se crea por trigger, RLS probada con 2 usuarios de empresas distintas.

### Fase 2 — Facturación + ARCA (doc 02)
Seguir el checklist 10-fases del doc 02. Resumen: schema ARCA → RPCs core → edge functions (WSAA/WSFE nativo) → crons → frontend → config Resend → config ARCA por empresa → smoke tests de regresión (E41, E42, cross-tenant).

### Fase 3 — Finanzas + Conciliación (doc 03)
Cajas → categorías → movimientos → conciliación chunked → motor de patrones → PACs → blindaje (lock pesimista + revertir + watchdog) → tests SQL de regresión.

### Fase 4 — Recupero + Móvil + Reportes (doc 04)
Recupero/cobranza → PWA + push → avisos inteligentes → reportes con branding → dashboard → realtime.

### Fase 5 — Cierre
ARCH-REVIEW limpio antes de cada deploy. `ERRORES.md` y `DECISIONES.md` actualizados **desde el día 1** (no al final — esa fue una lección cara de MDC, D10).

---

## 5. Lo que NO hay que volver a descubrir (top 12)

Estos son los que más tiempo costaron. Detalle completo en doc 05.

| ID | Lección en una línea |
|----|----------------------|
| E04 | Policies RLS: `DROP POLICY IF EXISTS; CREATE POLICY` — NUNCA `CREATE POLICY IF NOT EXISTS` (deja policies zombie buggy) |
| E41 | Receptor sin CUIT: defensa en 3 capas (UI + CHECK regex `^\d{11}$` + edge re-valida). DNI ficticio para CF |
| E42 | Email: throttle global hardcoded 5 min vía `next_email_slot()`. Todo path encola, nada fire-and-forget |
| E43/E46 | Antes de RPC sobre tabla existente: `SELECT column_name FROM information_schema.columns`. Naming híbrido es/en existe (`enviado_at`, no `sent_at`). Al fixear naming, `grep -rn` TODAS las referencias |
| E44/E48 | Toda FK con índice (Postgres no los crea). CTE pre-agregada > subquery correlacionado. EXPLAIN ANALYZE antes de exponer RPC (>200ms = optimizar) |
| E45/E49 | Tenancy guard `assert_empresa_access(p_empresa_id)` al inicio de TODA RPC SECURITY DEFINER. Sin eso = cross-tenant trivial cambiando UUID en DevTools |
| E50 | Identificación de movimientos filtra por naturaleza (ingreso ≠ egreso). Defensa 3 capas |
| E51 | PDF unificado grande: JPEG 0.85 + scale 1.5 (no PNG), liberar canvas. >300 facturas = edge function |
| E52 | Al agregar una opción de identificación, cablear su contraparte en el trigger de aprendizaje (sino el motor no aprende) |
| 0127/0134/0135 | RPC con OUT param que choca con nombre de columna → `column X is ambiguous`. Alias obligatorio en RPCs. Tests SQL de regresión BEGIN/ROLLBACK |
| Regla 13 | `window.confirm/alert/prompt` PROHIBIDOS. `useConfirm()`/`usePrompt()`/`useAlert()` con look propio |
| D07 | DNI ficticio secuencial por empresa (`empresas.proximo_dni_ficticio`, rango 99000001+), trigger lo consume al insertar edificio sin CUIT |

---

## 6. Cómo trabajar (ciclo de cierre)

Cuando un grupo de cambios funcionales está terminado:
1. **Verificar solidez**: `npm run build` limpio, migraciones aplicadas en remoto, edge functions deployadas, sin warnings nuevos. Si toca datos reales, query de auditoría.
2. **Commit** explicando el *por qué*, no el *qué*.
3. **Push a `origin/main` sin esperar a que lo pidan** — Vercel auto-deploya. (La regla "no pushear sin pedir" del template estándar NO aplica acá.)
4. Cambios grandes → commits atómicos, pero pusheados juntos al final del turno.

Operaciones destructivas (DROP, DELETE masivo, reset): flujo obligatorio de 8 pasos (ver doc 05, sección 5).

ARCH-REVIEW antes de cada deploy: sin 🔴 bloqueantes no se mergea.

---

## 7. Diferencias esperables MANAXER → Gestión Global

El modelo es ~95% transferible. Ajustá:
- **Nombre de empresa**: "Administración Global" → "Gestión Global" en seeds y copy.
- **Dominio email**: configurar el dominio propio de Gestión Global en Resend (DKIM/SPF/DMARC). Ver doc 02 sección 5.4.
- **Certificados ARCA**: cada empresa carga los suyos vía el wizard (doc 02). No se comparten.
- **Punto de venta ARCA**: el que AFIP habilite para Gestión Global.
- **Plantillas de email**: el copy inicial se siembra por empresa; ajustar a la voz de Gestión Global.
- Todo lo demás (estructura, RPCs, triggers, motor, blindaje) se replica tal cual.

---

## 8. Si tenés que elegir por dónde empezar

El orden de valor probado en MANAXER:
1. **Clientes** (administraciones + edificios) — sin esto no hay a quién facturar.
2. **Facturación manual** (sin ARCA todavía — tipo X, autorización manual correlativa). Valida el modelo de comprobantes.
3. **ARCA** (cuando haya certificados). Es plugin, no core (P-ARCA-04): el core factura sin ARCA.
4. **Conciliación + cajas** — el motor de patrones se nutre con el uso.
5. **Recupero + emails** — sobre la base de comprobantes con saldo.
6. **Móvil/push/reportes** — capa de visibilidad sobre todo lo anterior.

No intentes ARCA el día 1. Necesitás certificados de AFIP que tardan. Arrancá con facturación manual y el modelo de datos sólido.

---

Listo. Empezá por el doc 01 (modelo de datos). Cuando dudes entre dos caminos, citá el patrón/error aplicable y preguntá. El bagaje está acá completo — no repitas lo que ya pagamos.
