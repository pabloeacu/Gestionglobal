# 05 · Reglas, errores, decisiones, patrones — EL CONTRATO

> Este documento es el contrato. Las 13 reglas no se rompen nunca. Los 52 errores ya están resueltos en MANAXER: si vas a tropezar con uno, su fix está acá. Citá los IDs cuando justifiques decisiones.

---

## 1. Las 13 reglas no negociables (transcribir textual a CLAUDE.md)

Copialas tal cual a `CLAUDE.md` Sección 2 de Gestión Global (cambiando "MANAXER" → "Gestión Global" sólo en la regla 13):

1. **Persistencia en BD siempre.** Toda mutación de negocio pasa por Supabase (INSERT/UPDATE/DELETE o RPC). `setState` sin persistir = bug.
2. **RLS activa en toda tabla.** `ENABLE ROW LEVEL SECURITY` no es opcional. `USING (true)` requiere comentario que lo justifique.
3. **Sin secretos en el front.** Service role keys, tokens, credenciales → edge functions. El front sólo conoce la anon key.
4. **Nada de `supabase.from()` en componentes.** Todo query vive en `src/services/api/`. Si lo ves en un componente, refactor antes de seguir.
5. **Operaciones multi-tabla → RPC.** 2+ tablas → `plpgsql` con `SECURITY DEFINER` y `SET search_path = public, pg_temp`. No N calls sueltas desde el cliente.
6. **Migraciones versionadas.** Todo cambio de schema en `supabase/migrations/`. DDL a mano sin migración = deuda que se paga inmediatamente.
7. **Edge functions versionadas.** Toda edge function en prod existe como archivo en el repo. Drift → bajar y commitear.
8. **Nombres en español para dominio, inglés para tecnología.** Inglés en schema/BD/APIs, español en copy UI. **Excepción E43**: tablas pre-existentes con naming híbrido (`sent_emails.enviado_at` no `sent_at`, `.asunto` no `subject`). Antes de RPC sobre tabla existente: `SELECT column_name FROM information_schema.columns WHERE table_name='...'`. NUNCA asumir naming inglés.
9. **Un error, un aprendizaje.** Todo bug >30 min se documenta en `ERRORES.md` con ID `E##`.
10. **ARCH-REVIEW antes de cada deploy.** No se mergea a main sin informe limpio.
11. **EXPLAIN ANALYZE antes de exponer RPC al frontend** (post-E44). Si >200ms con datos reales, optimizar (CTE pre-agregada > subquery correlacionado, índice en FK). Toda FK debe tener su índice — Postgres NO los crea automáticamente.
12. **Tenancy guard en RPCs SECURITY DEFINER** (post-E45). Toda RPC que reciba `p_empresa_id uuid` llama `public.assert_empresa_access(p_empresa_id)` al inicio. Sin esa línea, cualquier `authenticated` lee data de otra empresa cambiando UUID en DevTools.
13. **Ninguna ventana nativa del browser** (2026-05-17). `window.confirm/alert/prompt` prohibidos — rompen el look-and-feel y muestran "www.<dominio> dice" como otra app. Toda confirmación por `useConfirm()` (`Promise<boolean>`), prompt por `usePrompt()` (`Promise<string|null>`), "OK only" por `useAlert()`. Componentes en `src/components/common/ConfirmDialog.tsx` y `PromptDialog.tsx`, providers montados en `App.tsx`. Toasts (`sonner`) válidos para feedback fugaz, no para decisiones.

---

## 2. Los 52 errores históricos (ya resueltos — no repetir)

### Schema / DB
- **E01** · CHECK constraint mismatch (`'salida'` vs `'entrega'`). Fix: literal correcto. Prevención: valores del CHECK en constante TS compartida; enum nativo si estable.
- **E02** · UPDATE a columna `updated_at` inexistente (42703). Prevención: toda tabla con `created_at`/`updated_at` + trigger. Verificar `information_schema` antes.
- **E03** · `VARCHAR(50)` insuficiente (22001) con texto concatenado. Prevención: VARCHAR fijo sólo para formato determinista (CUIT, CP); texto libre → `TEXT`.
- **E48** · `movimientos.comprobante_id` sin FK ni índice → timeout O(N×M) + huérfanos. Prevención: toda FK con índice en la misma migración.

### RLS / Seguridad
- **E04** · `CREATE POLICY IF NOT EXISTS` dejó policy zombie buggy → usuario veía todo vacío. **Fix/Prevención: SIEMPRE `DROP POLICY IF EXISTS; CREATE POLICY`. Nunca `IF NOT EXISTS`.** Verificar `pg_policies` post-deploy.
- **E05** · Rol inconsistente (`'admin'` vs `'administracion'`). Prevención: un único archivo `ROLES.md` con lista exacta, importado en policies y TS.
- **E41** · Receptor sin CUIT mandaba basura a AFIP (`[10015]`). Fix: defensa 3 capas — CHECK regex en comprobantes + columna `receptor_doc_tipo_enviado smallint` + edge re-valida + PDF formatea "Consumidor Final". **Patrón maestro: defensa en 3 capas para todo dato que cruza boundary externo.**
- **E45** · Cross-tenant trivial: cualquier `authenticated` cambiaba `p_empresa_id` en DevTools. Fix: `assert_empresa_access()` al inicio de RPC sensible (regla 12).
- **E49** · `aplicar_conciliacion_v2` y `enqueue_email_individual` heredaron el gap pre-E45. Fix: patch con `assert_empresa_access`. Prevención: auditoría `SELECT proname FROM pg_proc WHERE prosecdef AND prosrc NOT LIKE '%assert_empresa_access%'`.

### ARCA / Facturación
- **E37** · ComboBox edificios cortaba a 200 (clamp silencioso de paginación). Prevención: no caps silenciosos; si el caller pide más, devolver `total` ≠ `rows.length` para detectar el corte.
- **E38** · Validación descartaba precios con coma decimal (`Number("172424,37")=NaN`). Prevención: helper `parseDecimalAR` con `.replace(',','.')` antes de `Number()`, usado en validación + payload.
- **E39** · Grilla freezeaba con 1806 comprobantes. Prevención: grillas >500 rows → virtualizar o limit 300-500 cliente; totales por RPC server-side.
- **E40** · Anular dejaba borradores fantasma tachados. Fix: RPC `borrar_comprobante` decide delete físico (simple) vs anular (con CAE).
- **E43** · `sent_emails.sent_at` no existía (era `enviado_at`). Prevención: `information_schema.columns` antes de RPC sobre tabla existente; probar RPC inmediatamente post-migración.
- **E44** · Timeout por subquery correlacionado sin índice (~11M comparaciones). Fix: índice parcial + CTE pre-agregada (O(N×M)→O(N+M)). EXPLAIN ANALYZE antes de exponer (regla 11).
- **E46** · `recupero_timeline_admin` se rompía por mismo bug E43 (reincidente). Prevención: al detectar bug de naming, `grep -rn` TODAS las referencias antes de cerrar.
- **E47** · Recupero y Dashboard usaban 2 fórmulas distintas de "pendiente". Prevención: copiar fórmula de la RPC canónica más reciente; test Dashboard.total === SUM(Recupero.por_admin).
- **E50** · Selector de identificación ofrecía cobranza/PAC para egresos. Fix: defensa 3 capas naturaleza ingreso/egreso (UI filter + DB CHECK categoría + RPC guard).
- **E51** · `pdf.output('blob')` chocaba límite V8 (`Array.join Invalid string length`) con 176+ facturas. Fix: PNG→JPEG 0.85, scale 1.5, compress, addImage FAST, liberar canvas. >300 facturas → edge function.
- **E52** · Motor no aprendía gastos (solo cobranzas/PACs). Fix: extender trigger WHEN + rama 2 de la función. Prevención: al agregar opción de identificación, cablear su contraparte en el trigger de aprendizaje.

### Conciliación (bugs catastróficos)
- **0127** · `column reference 'estado' is ambiguous` en `procesar_extracto_chunk` (OUT param choca con columna). Fix: alias `eb` + columnas calificadas.
- **0134** · `column reference 'rechazadas' is ambiguous` en `aplicar_conciliacion_v2`. Mismo patrón. Fix: alias + calificación.
- **0135** · Imputación múltiple intra-extracto: 2 líneas mismo hash imputaban al mismo mov histórico, perdiendo el monto de la 2da. Fix: si el destino ya fue tomado por otra línea del mismo extracto, forzar INSERT con `hash_dedup=NULL`.
- **Prevención general**: tests SQL de regresión BEGIN/ROLLBACK en `tests/sql/`. Alias obligatorio en RPCs con OUT params. Lock pesimista `FOR UPDATE` + chequeo de doble aplicación.

### Frontend / UX
- **E06** · `razon_social` editada por gerencia no se refrescaba en admin. Prevención: campos editables por super-admin se refrescan al montar perfil.
- **E09/E13/AP-15** · `tsc -b` removido del build → deuda de tipos. Prevención: `tsc --noEmit` con `strict:true` desde día 1, bloqueante en CI.
- **E10** · `actualizarUsuarioLocal` no invocado tras editar perfil (2 contexts paralelos). Prevención: un único `useCurrentUser()` fuente de verdad; si hay 2 contexts, uno deriva del otro.
- **E11** · iOS Safari reporta `File.type` vacío con HEIC. Prevención: helper `deduceContentType()` con fallback por extensión. Nunca confiar 100% en `File.type`.

### Email / Integraciones
- **E42** · Email individual sin throttle → spam. Fix: helper `next_email_slot(empresa_id)` fuente única, piso 5 min hardcodeado, todo path encola. **Fuente única de verdad para throttle.**

### Históricos MDC (E01-E15, importados como prevención)
E07 (Storage DELETE bloqueado → edge fn service role), E14 (401 con `verify_jwt=true` + `functions.invoke()` → `verify_jwt=false` + validación interna), E15 (PDF adjunto con template equivocado → extraer `buildXHtml(params)` y reusar, no copiar+modificar).

---

## 3. Decisiones de arquitectura

### D01-D15 (fundacionales)
- **D02** Multi-tenancy: SaaS único, dominio único, APEX ve selector de empresa. (Para Gestión Global: empresa nueva = fila en `empresas`.)
- **D03** Rol ADMINISTRADOR en la misma SPA (no portal separado), layout condicional + guards estrictos.
- **D04** `administraciones.codigo` UNIQUE por empresa. `edificios.codigo` mutable. Dedup por CUIT (unique parcial) → nombre normalizado.
- **D05** Código conciliación `AAAA-EEEE` (9 chars, zero-padded) — coincide con lo que trae el banco.
- **D06** Snapshot al emitir: `edificios.administracion_id` es estado actual; `comprobantes.administracion_id` es snapshot histórico.
- **D07** DNI ficticio secuencial `99000001+` por empresa, persiste en edificio, trigger lo consume.
- **D08** Condiciones receptor acotadas: `consumidor_final` (FC B, CondIVAReceptor=5) + `responsable_inscripto` (FC A, =1).
- **D09** Eliminación: comprobante simple → delete físico; con CAE → anular con NC.
- **D10** **Auditoría desde día 1** (tabla insert-only + trigger). En MDC se hizo tarde, se perdieron 6 meses de trazabilidad.
- **D12** Email: dominio verificado en Resend, FROM `facturacion@`, reply_to por empresa.
- **D13** TS `strict:true` desde primer commit, `tsc --noEmit` bloqueante en CI.
- **D15** Reconciliación post-timeout ARCA es read-only (devuelve divergencias, no auto-actualiza).

### TODO-MDC capitalizados (43 implementados en MANAXER)
Resumen de los más importantes para replicar:
- **MDC-01** ARCA retry 3× backoff sólo transitorios (500/timeout), no permanentes (10xxx).
- **MDC-02** Persistir SOAP req/resp en rechazo, TTL 30d.
- **MDC-03** `Idempotency-Key=job_id` en POST a Resend.
- **MDC-04/05** Health check + cleanup cron de `email_queue`.
- **MDC-09/26** ARCA cola persistida + cron + Realtime + watchdog + retry transient + UX honesta.
- **MDC-14** Plantillas TipTap WYSIWYG, backwards compat markdown.
- **MDC-16** Throttle global piso 5 min hard (`next_email_slot`).
- **MDC-17** Módulo Recupero/Cobranza (4 fases: RPCs analíticas, plantillas escalado, timeline, PDF).
- **MDC-22** Conciliación chunked (Web Worker parser, RPC por chunk, overlay progreso, retry).
- **MDC-24/25** Wizard facturación masiva: matcher robusto + alta inline + coherencia receptor.
- **MDC-27** Push de anomalías ARCA con dedup 30min.
- **MDC-28** Resend webhooks → timeline acumulativo idempotente.
- **MDC-29** SPF root + DMARC `p=none` → escalar a `quarantine`→`reject` en 30/90/180 días.
- **MDC-42** PAC como crédito aplicable (invariante SUM imputaciones == monto).
- **MDC-43** Ninguna ventana nativa (regla 13).

---

## 4. Patrones (aplicar desde día 1) y antipatrones (nunca)

### Patrones
- **P-DB-01** Tabla base obligatoria (id/created_at/updated_at/created_by + trigger).
- **P-DB-05** RLS helper `SECURITY DEFINER STABLE` evita recursión.
- **P-DB-06** Migración segura: BEGIN/COMMIT, DROP POLICY IF EXISTS, RPC SECURITY DEFINER + search_path + GRANT.
- **P-DB-07** Transferencia doble asiento: 2 patas con `transferencia_pair_id`, constraint origen≠destino.
- **P-AUTH-01** 3 capas: route guard + RLS + RPC SECURITY DEFINER.
- **P-API-01** Respuesta estandarizada `{ok, data, error:{code,message,details}}`.
- **P-API-04** Retry backoff exponencial sólo transitorios, nunca 4xx.
- **P-API-05** Edge fn: `verify_jwt=false` + `admin.auth.getUser(jwt)` + check rol.
- **P-ARCA-01** Cache token WSAA (tabla, reusar si válido >5min de margen).
- **P-ARCA-04** ARCA es plugin; el core factura sin ARCA (tipo X correlativo).
- **P-FE-01** Tres estados: loading + error + empty para toda query.
- **P-FE-02** Modal resetea form local on-open (`useEffect` deps [open, editing?.id]).

### Antipatrones (lecciones costosas de MDC)
AP-01 campos UI que no persisten · AP-03 validación sólo cliente · AP-04 naming inconsistente entre capas · AP-07 config hardcodeada (URLs, CUIT, tokens) · AP-09 estados intermedios sin manejo (→ doble emisión) · AP-11 `CREATE POLICY IF NOT EXISTS` · AP-13 `VITE_*` para secretos · AP-14 edge fn en prod sin estar en repo · AP-15 `tsc` removido del build.

---

## 5. Flujo de trabajo obligatorio

### Ciclo de cierre de cambios
1. Verificar solidez: `npm run build` limpio, migraciones aplicadas en remoto, edge fns deployadas, sin warnings. Si toca datos reales → query de auditoría.
2. Commit con el *por qué*.
3. **Push a `origin/main` sin esperar pedido** (Vercel auto-deploya; "no pushear sin pedir" del template estándar NO aplica acá).
4. Cambios grandes → commits atómicos, pusheados juntos al final.

### Operaciones destructivas (DROP, DELETE masivo, reset) — 8 pasos
1. Preguntas de clarificación → 2. Backup a schema `backup_<n>_<fecha>` → 3. Inspeccionar FKs/dependencias → 4. Presentar plan → 5. **Esperar aprobación explícita** → 6. Ejecutar en transacción → 7. Verificar → 8. Cleanup del backup.

### ARCH-REVIEW
Antes de mergear: sin 🔴 bloqueantes no se mergea. Cada 🟡 → TODO explícito. Cada 📝 → confirmar con usuario. Si un patrón aparece en 3+ módulos → subir a regla del contrato. Formato: 🔴 BLOQUEANTE / 🟡 IMPORTANTE / 🟢 SUGERENCIA / 📝 HIPÓTESIS.

### Regenerar types
`bash scripts/generate-types.sh` → `src/types/database.ts`. Después de TODA migración nueva, antes de pushear (sino Vercel rompe el build).

---

## 6. Estructura de carpetas + variables de entorno

```
proyecto/
├── CLAUDE.md                  ← contrato (13 reglas)
├── .env.example
├── knowledge-base/            ← 7 archivos framework + ERRORES.md + DECISIONES.md
├── src/
│   ├── lib/                   ← supabase.ts, errors.ts, cn.ts
│   ├── types/database.ts      ← generado
│   ├── services/api/          ← un archivo por dominio (regla 4)
│   ├── services/integrations/ ← wrappers terceros
│   ├── contexts/ hooks/
│   ├── modules/<dominio>/     ← components/ pages/ lib/
│   └── components/common/     ← Drawer, Modal, ConfirmDialog, PromptDialog, ...
├── supabase/
│   ├── config.toml
│   ├── migrations/
│   └── functions/<name>/index.ts
├── tests/sql/                 ← tests de regresión BEGIN/ROLLBACK
├── public/ (manifest.json, sw.js, icons/)
└── scripts/generate-types.sh
```

**Cliente** (`VITE_*`, plantilla commiteable): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_VAPID_PUBLIC_KEY`, `VITE_ENV`.
**Server/Edge** (Supabase secrets, nunca en repo): `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `RESEND_FROM_NAME`, `RESEND_WEBHOOK_SECRET`, `VAPID_PRIVATE_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_SUBJECT`.
Reglas: toda env nueva → `.env.example` + Vercel (preview+prod) + Supabase si aplica. Ningún secreto con prefijo `VITE_*` (AP-13). Si se commitea key sensible → rotar inmediatamente + documentar.

---

## 7. Métricas de éxito (las 5 que importan)

1. ≤1 error de la lista histórica repetido en 6 meses.
2. 0 incidentes por falta de RLS.
3. 0 secretos filtrados a git.
4. 100% módulos con ARCH-REVIEW previo al deploy.
5. `ERRORES.md` + `DECISIONES.md` actualizados en cada cierre de módulo (desde el día 1, no al final — D10).

Si se cumplen las 5, el framework funciona. Ese es el objetivo de este paquete.
