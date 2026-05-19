# 04 · Móvil/PWA + Push + Avisos + Reportes + Dashboard + Realtime

> Capa de visibilidad sobre todo lo demás. Transferible tal cual a Gestión Global.

---

## 1. PWA / versión móvil

### Manifest (`public/manifest.json`)
```json
{
  "name": "Gestión Global",
  "short_name": "GG",
  "description": "Plataforma de gestión contable y administrativa multi-empresa",
  "start_url": "/",
  "display": "standalone",
  "theme_color": "#1d4ed8",
  "background_color": "#ffffff",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable" }
  ]
}
```
App online-only en sprint inicial (sin offline caching — eso es PWA-2). Vite sin plugin PWA explícito.

### Install prompt (`useInstallPrompt.ts`)
Captura `beforeinstallprompt` (Chrome/Edge/Opera), expone `promptInstall()`. **Safari iOS NO emite el evento** (Apple lo rechaza) → instructivo visual paso a paso (Compartir → Agregar a pantalla de inicio). Firefox Android tampoco.

### Service Worker (`public/sw.js`, scope `/`)
Se registra lazy en el primer `enable()` de push. Maneja:
- `push` → `showNotification(title, {body, icon, badge, tag, data})`.
- `notificationclick` → enfoca cliente existente del mismo origin y navega a `data.url`, o abre ventana nueva.
- `pushsubscriptionchange` → notifica al front para re-suscribir.

### Responsive
`useMediaQuery('(max-width: 767px)')` → en `<768px` renderiza `MobileHomeView`: 3 KPIs grandes (adeudado, facturado mes, movs pendientes), InsightsCarousel vertical full-width, 4 botones de acción rápida, banner "Para tareas avanzadas abrí en computadora". NO charts densos.

`MobileWelcomeWizard` (una vez/sesión): detecta plataforma, ofrece instalar + activar push, soft dismiss "Después", marca `localStorage` sólo si hubo éxito real. `MobileSettingsDialog`: siempre accesible desde menú user, muestra estado push, explica desbloqueo si `permission='denied'`.

---

## 2. Push notifications (VAPID)

### Arquitectura
Web Push API (RFC 8291) + VAPID (RFC 8292). `VITE_VAPID_PUBLIC_KEY` (front) + `VAPID_PRIVATE_KEY`/`VAPID_PUBLIC_KEY`/`VAPID_SUBJECT` (backend, edge secrets).

### Tablas
```sql
CREATE TABLE public.push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  empresa_id uuid REFERENCES public.empresas(id) ON DELETE SET NULL,
  endpoint text NOT NULL UNIQUE,
  p256dh text NOT NULL, auth text NOT NULL,
  user_agent text,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(),
  last_used_at timestamptz, failed_count int DEFAULT 0
);
-- idx_push_subs_profile. RLS: cada user ve sólo sus dispositivos.

CREATE TABLE public.push_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  empresa_id uuid REFERENCES public.empresas(id) ON DELETE CASCADE,
  title text NOT NULL, body text NOT NULL,
  url text, icon text, tag text, data jsonb,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','sending','sent','failed','no_subs')),
  attempts int DEFAULT 0, last_error text,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), sent_at timestamptz
);
-- idx_push_outbox_pending (created_at WHERE status='pending'). Cleanup cron >30d.
```

**Routing del outbox**: `profile_id` NOT NULL → ese user. `profile_id` NULL + `empresa_id` NOT NULL → broadcast a apex + usuarios de esa empresa. Ambos NULL → broadcast apex (debug).

### Suscripción (hook `usePushSubscription`)
`enable()`: `Notification.requestPermission()` → registra SW → `pushManager.subscribe({userVisibleOnly:true, applicationServerKey})` → RPC `upsert_push_subscription` idempotente por endpoint. `disable()`: unsubscribe + RPC `delete_push_subscription`.

### Edge function `send-push` (cron cada 1 min)
`claim_pending_pushes(max)` → por cada job busca suscripciones destino → `webpush.sendNotification(sub, JSON)`. Maneja **410 Gone / 404** borrando la suscripción muerta. Otros errores → `failed_count++`; tras 5+ fallos el cron de cleanup la borra. Marca outbox `sent`/`failed`.

### Qué dispara push (triggers)
- Lote ARCA cerrado → "✓ Lote MM/YYYY terminado · X autorizadas · Y fallaron".
- Envío masivo terminado → stats de mails enviados.
- Email bounced/complained → broadcast a la empresa.
- Anomalías ARCA (ver sección 3).

---

## 3. Avisos inteligentes / alertas

### Anomalías ARCA (`lote_arca_anomalias_notificadas` + cron 10 min)
Tabla de idempotencia: `UNIQUE(lote_id, tipo, hora_bucket)` (bucket = truncado a 30 min) evita spam. `detectar_anomalias_lote_arca()` detecta 5 tipos en lotes activos (<24h):
1. **estancado** — sin avance >30 min.
2. **tasa_fallos_alta** — >30% de últimos 20 jobs fallaron (mín 5).
3. **watchdog_actuo** — ≥3 jobs con `[WATCHDOG]` en error en últimos 15 min.
4. **afip_no_responde** — ≥4 de últimos 5 errores son HTTP 5xx/timeout.
5. **cert_vencido** — `WSAA_EXPIRED`/`vencido` en últimos 30 min.
`process_anomalias_lote_arca()` (cron `*/10 * * * *`) verifica idempotencia y encola push broadcast a la empresa.

### Avisos de negocio (`evaluar_avisos_inteligentes`, cron diario 07:30 ART)
Idempotencia por `tag + fecha`:
- Abonos sin actualizar >6 meses → "⚙ Tiempo de actualizar abonos · N edificios".
- Lotes abiertos/autorizando >5 días sin emitir.
- Emails fallidos >1 día sin atender.

### En UI
`InsightsCarousel` (dashboard): slides accionables. `EmailQueueHealthBanner`: si `email_queue_health_summary` devuelve `stuck`/`atrasado`, banner amber/blue ("X mails vencidos, cron puede estar caído").

---

## 4. Reportes (`ReportesPage` + `services/api/reportes.ts`)

3 tabs (Facturación, Edificios, Finanzas). Patrón: filtros (fechas desde/hasta + atajos de período) → RPC → tabla → botones "Descargar PDF" + "Excel".

Reportes: `reporte_facturacion_por_admin`, `reporte_edificios_por_admin`, `reporte_movimientos_finanzas`, `recupero_pagos_recibidos(empresa, desde, hasta, admin?)`.

### Export PDF con branding (jsPDF + autoTable)
```ts
const BRAND = {
  BLUE: [0,158,202], ORANGE: [255,130,0], INK: [18,34,48],
  MUTED: [93,114,132], HEADER_BG: [0,158,202], ZEBRA: [247,250,252],
};
// Header con franja azul + logo + nombre empresa + fecha; franja naranja decorativa;
// título; autoTable por sección (headerStyles fillColor BLUE, alternateRowStyles ZEBRA).
// exportToPdf(params) → doc.save(filename)
```
Ajustar logo + colores a la identidad de Gestión Global. Export Excel: `xlsx` `aoa_to_sheet` con `!cols` width 22, una hoja por sección.

**Memoria**: todo botón "Exportar" ofrece **ambos** formatos (xlsx + PDF); los PDF llevan branding. Todo upload bulk xlsx/csv tiene botón "Descargar modelo" al lado.

---

## 5. Dashboard (`DashboardPage`)

`Promise.all` de ~9 RPCs en paralelo: `dashboard_kpis`, `dashboard_facturacion_mensual`, `dashboard_top_admins`, `dashboard_morosidad`, `dashboard_top_morosos`, `dashboard_deuda_por_periodo`, `getFacturacionPendienteMes`, `dashboard_cash_flow`, `dashboard_admins_en_riesgo`.

`isMobile` → `MobileHomeView`. Desktop: `EmailQueueHealthBanner` + grid de 4 `MetricCard` (Administraciones, Edificios, Facturado mes, Saldo cajas — tone warning si hay movs pendientes) + `InsightsCarousel` (slides: Cobranza/morosos, Antigüedad/aging, Facturación+CashFlow) con alto fijo 20rem para no exceder viewport.

---

## 6. Realtime

Publicación `supabase_realtime` incluye: empresas, profiles, pulse_permissions, administraciones, edificios, comprobantes, lotes_facturacion, movimientos, extractos_bancarios, extractos_lineas, sent_emails, email_queue, arca_emision_queue, administracion_emails, movimiento_imputaciones, contactos_cobranza.

Hook `useRealtimeTables(channelKey, subs[], onChange, enabled)`: un canal único con N subscripciones `postgres_changes` filtradas por `empresa_id=eq.<id>`. El callback recibe `(table, payload)` con `eventType` + `old/new record`. Patrón habitual: `void reload()` (lazy pero confiable). **P-FE-04: Realtime > polling**; polling es fallback, no mecanismo principal.

---

## 7. Lecciones de UX a respetar (memoria del usuario)

- **Sin ventanas nativas** (regla 13): `useConfirm/usePrompt/useAlert`.
- **Filtros booleanos = Switch** (pastilla naranja), nunca checkbox nativo.
- **Filtros con >~10 opciones = ComboBox** con buscador interno + multiselect; Select nativo sólo para listas chicas cerradas.
- **Exportaciones**: siempre xlsx + PDF; PDF con branding.
- **Bulk con loop secuencial + progreso**: acciones masivas uno por uno (no paralelo), card de progreso con barra + contador, toast final, errores aislados.
- **Una sola fuente de verdad**: cada dato vive en un lugar (AuthContext, OutletContext, fetch único). Nunca duplicar state.
- **Páginas caben en el viewport**: si no, reordenar/omitir cards > scroll interno en grilla > nunca scroll de página.
- **Crear usuarios con password** (alta directa), nunca "invitar".
- **Refresh automático por Realtime**, polling es fallback.

Volvé al doc 05 (contrato) cuando dudes. El paquete está completo.
