# PLAYBOOK · Facturación + ARCA + Emails masivos

> **Para qué sirve este documento.** Sos Claude en otra sesión, encarando la ventana "Facturador" de un nuevo software (Administración Virtual). El usuario te pasó este archivo porque ya pasamos meses construyendo lo mismo en MANAXER y no quiere que vuelvas a tropezar con los 50+ ciclos de prueba-error que ya están resueltos.
>
> Leelo de cabo a rabo antes de proponer schema o tirar la primera línea de código. Cita IDs (E##, D##, P-XX-NN) cuando justifiques una decisión — el usuario los va a reconocer.
>
> **Pre-condición**: stack equivalente a MANAXER (React + TS strict + Vite + Supabase + Vercel + Resend). Si el stack difiere, adaptá pero conservá el patrón.

---

## Sección 0 — Filosofía

Tres principios que ordenan TODO el resto:

1. **AFIP es boundary externo. Defensa en 3 capas siempre**: UI valida + DB CHECK constraint bloquea + edge function re-valida con regex. Nunca confíes en una sola capa (ver E41).
2. **Cola persistida + cron + Realtime, no client-side loops**: cualquier operación larga (autorizar lote, mandar 100 emails) vive en una tabla `*_queue`, un cron la procesa, el browser solo escucha Realtime. Si el usuario cierra la pestaña, el flujo sigue (ver D01).
3. **Naming consistente: inglés en BD/APIs, español sólo en UI**. Excepción documentada: tablas pre-existentes con naming híbrido (`sent_emails.enviado_at`). Antes de tocar tabla vieja: `SELECT column_name FROM information_schema.columns WHERE table_name = ...` (ver E43, E46).

---

## Sección 1 — Stack

```
Frontend:  React 18 + TS strict + Vite 6 + Tailwind + lucide-react + sonner (toasts)
Editor:    TipTap 3.x para plantillas de email (con DOMPurify para sanitizar)
Excel:     xlsx (SheetJS) — lectura del Excel del usuario
PDF:       jsPDF + autoTable (reportes simples) | html2canvas + jsPDF (factura oficial)
Backend:   Supabase = Postgres 15 + Auth + Storage + Edge Functions (Deno)
Cron:      pg_cron + pg_net (HTTP outbound desde Postgres)
Email:     Resend (dominio verificado con DKIM/SPF/DMARC)
SOAP ARCA: nativo — sin SDKs. Firma PKCS#7 con node-forge.
Push:      VAPID (web push), edge function send-push
Hosting:   Vercel auto-deploy desde main
```

Versiones críticas: `@supabase/supabase-js@^2`, `react@^18`, `vite@^6`, `typescript@^5.6`, `xlsx@^0.18`, `jspdf@^2`, `html2canvas@^1.4`, `node-forge@^1` (sólo edge), `@tiptap/react@^3`.

---

## Sección 2 — Arquitectura general

```
┌────────────────── FRONTEND (React) ────────────────────┐
│  src/modules/facturacion/                              │
│    pages/FacturacionPage.tsx       ← orquesta 4 tabs   │
│    components/                                          │
│      LoteWizardDialog              ← lote rápido       │
│      LoteMasivoDialog              ← Excel + preview   │
│      EnviarLoteEmailDialog         ← 4-step wizard     │
│      ArcaJobsPanel                 ← Realtime queue    │
│      ArcaStatusCard / ArcaConfigDialog                  │
│      EmisionExitosaModal           ← celebración + PDF │
│      LotesPendientesBanner        ← reanudar / dismiss │
│      ComprobanteFormDialog / NotaCreditoDialog          │
│      EmailComprobanteDialog / PlantillaEmailEditor      │
│  src/services/api/                                      │
│    comprobantes.ts · arcaEmisionQueue.ts · emails.ts    │
│    plantillasEmail.ts · lotes.ts · administraciones.ts  │
└────────────────────────────────────────────────────────┘
           │  RPC SECURITY DEFINER
           │  + assert_empresa_access
           ▼
┌────────── DATABASE (Postgres + pg_cron) ───────────────┐
│  Tablas:                                                │
│    comprobantes · items_comprobante · lotes_facturacion │
│    numeradores · empresa_arca_config                    │
│    arca_tokens · arca_emision_queue                     │
│    arca_soap_debug · lote_arca_anomalias_notificadas    │
│    email_queue · sent_emails · email_plantillas         │
│    administracion_emails · email_assets (storage)       │
│  Crons (pg_cron):                                       │
│    dispatch-email-queue-every-min       (* * * * *)     │
│    dispatch-arca-emission-every-min     (* * * * *)     │
│    arca-watchdog-jobs-colgados          (*/5 * * * *)   │
│    lote-arca-anomalias-detect           (*/10 * * * *)  │
│    arca-soap-debug-cleanup              (15 4 * * *)    │
│    email-queue-health-alert             (0 13 * * *)    │
│    email-queue-cleanup                  (15 4 * * *)    │
└────────────────────────────────────────────────────────┘
           │  net.http_post()
           ▼
┌────────── EDGE FUNCTIONS (Deno) ───────────────────────┐
│  arca-autorizar-comprobante      ← 1 comp → CAE        │
│  arca-autorizar-lote             ← chunk legacy        │
│  dispatch-arca-emission          ← cron processor      │
│  arca-test-conexion              ← smoke test          │
│  arca-generar-csr                ← keypair RSA + CSR   │
│  arca-inspeccionar-cert          ← parse cert + key    │
│  dispatch-email-queue            ← cron + ZIP + Resend │
│  send-email-resend               ← legacy individual   │
│  resend-webhook                  ← Svix events         │
│  send-push                       ← VAPID notifs        │
│  _shared/arca-wsaa-wsfe.ts       ← cliente SOAP        │
└────────────────────────────────────────────────────────┘
           │
           ▼
┌────────── SERVICIOS EXTERNOS ──────────────────────────┐
│  AFIP/ARCA WSAA + WSFEv1 (SOAP, prod + homologación)    │
│  Resend (HTTP /emails + webhooks Svix)                  │
└────────────────────────────────────────────────────────┘
```

**Regla de oro**: el frontend nunca habla con AFIP ni con Resend directamente. Siempre pasa por `email_queue` o `arca_emision_queue` (cola persistida) → cron → edge function → boundary externo.

---

## Sección 3 — Schema de base de datos

### 3.1 Comprobantes

```sql
CREATE TABLE public.comprobantes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  edificio_id uuid REFERENCES edificios(id) ON DELETE RESTRICT,
  administracion_id uuid REFERENCES administraciones(id) ON DELETE RESTRICT,  -- snapshot D04
  lote_id uuid REFERENCES lotes_facturacion(id) ON DELETE SET NULL,

  tipo text NOT NULL CHECK (tipo IN ('A','B','C','X','NC_A','NC_B','NC_C','NC_X','ND_A','ND_B','ND_C','ND_X')),
  punto_venta int NOT NULL,
  numero int,                              -- llenado al autorizar (NULL en borrador)
  fecha date NOT NULL,
  periodo date NOT NULL,                   -- siempre primer del mes (YYYY-MM-01)

  -- Receptor — CHECK estricto, ver E41
  receptor_tipo_documento text NOT NULL CHECK (receptor_tipo_documento IN ('cuit','dni','dni_ficticio','cf')),
  receptor_numero_documento text NOT NULL,
  receptor_razon_social text NOT NULL,
  receptor_doc_tipo_enviado smallint CHECK (receptor_doc_tipo_enviado IN (80,96,99)),  -- post-fix E41
  CHECK (
    (receptor_tipo_documento = 'cuit' AND receptor_numero_documento ~ '^\d{11}$')
    OR (receptor_tipo_documento IN ('dni','dni_ficticio') AND receptor_numero_documento ~ '^\d{7,8}$')
    OR (receptor_tipo_documento = 'cf' AND receptor_numero_documento = '0')
  ),

  -- Importes
  total_neto numeric(14,2) NOT NULL DEFAULT 0,
  total_iva numeric(14,2) NOT NULL DEFAULT 0,
  total numeric(14,2) NOT NULL DEFAULT 0,

  -- Estados
  estado text NOT NULL DEFAULT 'borrador'
    CHECK (estado IN ('borrador','autorizado','rechazado','anulado','procesando','observado','error')),
  motivo_rechazo text,
  observaciones text,

  -- ARCA
  cae varchar(14),
  cae_vencimiento date,
  arca_observaciones jsonb,
  arca_request_xml text,                   -- D08: solo se llena si rechazo (TTL 30d)
  arca_response_xml text,

  -- Email tracking
  email_enviado_at timestamptz,
  email_envios_count int NOT NULL DEFAULT 0,

  -- NC/ND linkage
  comprobante_referencia_id uuid REFERENCES comprobantes(id) ON DELETE SET NULL,
  motivo_nc text,

  -- Origen
  origen text NOT NULL DEFAULT 'lote' CHECK (origen IN ('lote','manual','migrado')),

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL
);

CREATE TRIGGER comprobantes_touch_updated_at BEFORE UPDATE ON comprobantes
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE INDEX idx_comprobantes_empresa_estado ON comprobantes(empresa_id, estado);
CREATE INDEX idx_comprobantes_lote ON comprobantes(lote_id) WHERE lote_id IS NOT NULL;
CREATE INDEX idx_comprobantes_edificio_periodo ON comprobantes(edificio_id, periodo);
CREATE INDEX idx_comprobantes_admin_fecha ON comprobantes(administracion_id, fecha DESC);

-- Solo manaxer/admin emiten — los migrados son históricos
CREATE UNIQUE INDEX uq_comprobantes_solo_manaxer
  ON comprobantes(empresa_id, punto_venta, tipo, numero)
  WHERE numero IS NOT NULL AND origen <> 'migrado';

-- RLS: select por empresa, write solo via RPCs SECURITY DEFINER
ALTER TABLE comprobantes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS comprobantes_select ON comprobantes;
CREATE POLICY comprobantes_select ON comprobantes FOR SELECT TO authenticated
  USING (empresa_id = current_empresa_id() OR get_user_role() = 'apex');
```

### 3.2 Items del comprobante

```sql
CREATE TABLE public.items_comprobante (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  comprobante_id uuid NOT NULL REFERENCES comprobantes(id) ON DELETE CASCADE,
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  orden smallint NOT NULL DEFAULT 1,
  descripcion text NOT NULL,
  cantidad numeric(14,4) NOT NULL DEFAULT 1,
  precio_unitario numeric(14,4) NOT NULL,
  bonificacion_pct numeric(5,2) NOT NULL DEFAULT 0,
  alicuota_iva text NOT NULL CHECK (alicuota_iva IN ('0','10.5','21','27','exento','no_gravado')),
  subtotal numeric(14,2) NOT NULL,         -- (cantidad * precio_unitario) * (1 - bonif/100)
  iva numeric(14,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_items_subtotal_no_negativo CHECK (subtotal >= 0)
);
CREATE INDEX idx_items_comprobante ON items_comprobante(comprobante_id, orden);
```

### 3.3 Lotes

```sql
CREATE TABLE public.lotes_facturacion (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  periodo date NOT NULL,                   -- primer del mes
  descripcion text,
  origen text NOT NULL DEFAULT 'planilla' CHECK (origen IN ('planilla','activos','manual')),

  estado text NOT NULL DEFAULT 'abierto'
    CHECK (estado IN ('abierto','autorizando','autorizado','emitiendo','emitido','cerrado','anulado')),

  total_comprobantes int NOT NULL DEFAULT 0,
  total_autorizados int NOT NULL DEFAULT 0,
  total_fallidos int NOT NULL DEFAULT 0,
  total_anulados int NOT NULL DEFAULT 0,

  envio_estado text CHECK (envio_estado IN ('idle','en_proceso','completado','con_errores')),
  log jsonb NOT NULL DEFAULT '[]'::jsonb,  -- auditoría: [{ts, evento, ...}]

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  cerrado_at timestamptz,
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL
);
CREATE INDEX idx_lotes_empresa_estado ON lotes_facturacion(empresa_id, estado);
CREATE INDEX idx_lotes_periodo ON lotes_facturacion(periodo DESC);
```

### 3.4 Numeradores (correlativo por PV/tipo)

```sql
CREATE TABLE public.numeradores (
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  punto_venta int NOT NULL,
  tipo text NOT NULL,
  ultimo_numero int NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (empresa_id, punto_venta, tipo)
);
```

### 3.5 ARCA: config + tokens + queue + debug

```sql
-- Configuración por empresa
CREATE TABLE public.empresa_arca_config (
  empresa_id uuid PRIMARY KEY REFERENCES empresas(id) ON DELETE CASCADE,
  ambiente text NOT NULL DEFAULT 'homologacion' CHECK (ambiente IN ('homologacion','produccion')),
  punto_venta int NOT NULL DEFAULT 1,
  cert_path text,                          -- Storage: arca-certs/{empresa_id}/cert.crt
  key_path text,                           -- Storage: arca-certs/{empresa_id}/key.key
  ta_token text,                           -- TA cacheado de WSAA
  ta_sign text,
  ta_expires_at timestamptz,               -- típicamente 12h
  ultimo_test_at timestamptz,
  ultimo_test_ok boolean,
  ultimo_test_msg text,
  arca_intervalo_emision_seg int NOT NULL DEFAULT 15
    CHECK (arca_intervalo_emision_seg BETWEEN 5 AND 120),  -- D02
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Cache global de tokens (compartido entre empresas con mismo CUIT — raro pero posible)
CREATE TABLE public.arca_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cuit text NOT NULL,
  servicio text NOT NULL DEFAULT 'wsfe',
  ambiente text NOT NULL CHECK (ambiente IN ('homologacion','produccion')),
  token text NOT NULL,
  sign text NOT NULL,
  generacion timestamptz NOT NULL,
  expiracion timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cuit, servicio, ambiente)
);

-- Cola de emisión (D01)
CREATE TABLE public.arca_emision_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  lote_id uuid REFERENCES lotes_facturacion(id) ON DELETE CASCADE,
  comprobante_id uuid NOT NULL REFERENCES comprobantes(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','sending','done','failed','skipped')),
  scheduled_at timestamptz NOT NULL DEFAULT now(),
  attempts int NOT NULL DEFAULT 0,
  max_attempts int NOT NULL DEFAULT 3,
  sending_started_at timestamptz,
  done_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 1 comprobante no puede tener 2 jobs activos (idempotencia natural)
CREATE UNIQUE INDEX uq_arca_queue_comprobante_activo
  ON arca_emision_queue(comprobante_id)
  WHERE status IN ('pending','sending');

CREATE INDEX idx_arca_queue_dispatch
  ON arca_emision_queue(scheduled_at) WHERE status = 'pending';
CREATE INDEX idx_arca_queue_lote ON arca_emision_queue(lote_id);
CREATE INDEX idx_arca_queue_sending
  ON arca_emision_queue(sending_started_at) WHERE status = 'sending';

-- Debug SOAP (D08, mig 0085)
ALTER TABLE comprobantes ADD COLUMN IF NOT EXISTS arca_request_xml text;
ALTER TABLE comprobantes ADD COLUMN IF NOT EXISTS arca_response_xml text;

-- Anomalías push (mig 0106)
CREATE TABLE public.lote_arca_anomalias_notificadas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lote_id uuid NOT NULL REFERENCES lotes_facturacion(id) ON DELETE CASCADE,
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  tipo text NOT NULL,                      -- estancado/tasa_fallos_alta/watchdog_actuo/afip_no_responde/cert_vencido
  hora_bucket timestamptz NOT NULL,        -- truncado a 30 min para dedup
  detalles jsonb,
  notificado_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (lote_id, tipo, hora_bucket)
);
```

### 3.6 Email queue + sent + plantillas

```sql
CREATE TABLE public.email_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,

  -- Lote (envío masivo)
  lote_id uuid REFERENCES lotes_facturacion(id) ON DELETE CASCADE,
  administracion_id uuid REFERENCES administraciones(id) ON DELETE CASCADE,
  comprobante_ids uuid[] NOT NULL DEFAULT '{}',
  parte int NOT NULL DEFAULT 1,
  partes_total int NOT NULL DEFAULT 1,

  -- Individual (recordatorio, reclamo, reenvío)
  kind text NOT NULL DEFAULT 'lote' CHECK (kind IN ('lote','individual')),
  html_body text,
  attachments_jsonb jsonb,                 -- [{filename, content_b64, content_type}]
  plantilla_tipo text,
  reply_to text,
  comprobante_id uuid REFERENCES comprobantes(id) ON DELETE SET NULL,
  edificio_id uuid REFERENCES edificios(id) ON DELETE SET NULL,

  -- Destinatarios
  to_email text NOT NULL,
  cc_emails text[] NOT NULL DEFAULT '{}',
  subject text NOT NULL,

  -- Programación + estado
  scheduled_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','scheduled','sending','sent','failed','too_large')),
  attempts int NOT NULL DEFAULT 0,
  max_attempts int NOT NULL DEFAULT 3,

  -- Resultado
  resend_id text,
  sent_at timestamptz,
  zip_size_bytes bigint,
  error_msg text,
  sending_started_at timestamptz,          -- watchdog 5 min

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,

  CONSTRAINT chk_email_queue_kind_consistency CHECK (
    (kind = 'lote' AND lote_id IS NOT NULL AND administracion_id IS NOT NULL)
    OR (kind = 'individual' AND html_body IS NOT NULL)
  )
);
CREATE INDEX idx_email_queue_dispatch
  ON email_queue(scheduled_at) WHERE status = 'pending';
CREATE INDEX idx_email_queue_lote ON email_queue(lote_id, status);
CREATE INDEX idx_email_queue_sending
  ON email_queue(sending_started_at) WHERE status = 'sending';

CREATE TABLE public.sent_emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  to_email text NOT NULL,
  cc text,
  from_email text NOT NULL DEFAULT 'facturacion@manaxer.com.ar',
  reply_to text,
  asunto text NOT NULL,                    -- ⚠ ES, no "subject" (E43)
  plantilla text,
  html text,
  attachments_meta jsonb,                  -- [{filename, size, content_type}]
  resend_id text UNIQUE,
  estado text NOT NULL DEFAULT 'sent'
    CHECK (estado IN ('sent','delivered','bounced','complained','delivery_delayed','failed')),
  enviado_at timestamptz NOT NULL DEFAULT now(),  -- ⚠ ES, no "sent_at" (E43)
  events jsonb NOT NULL DEFAULT '[]'::jsonb,      -- timeline webhook
  last_event_at timestamptz,
  delivered_at timestamptz,
  bounced_at timestamptz,
  complained_at timestamptz,
  opened_at timestamptz,
  clicked_at timestamptz,
  comprobante_id uuid REFERENCES comprobantes(id) ON DELETE SET NULL,
  edificio_id uuid REFERENCES edificios(id) ON DELETE SET NULL,
  administracion_id uuid REFERENCES administraciones(id) ON DELETE SET NULL,
  zip_attached boolean,
  importe_total numeric(14,2),
  attachments_filenames text[],
  error_code text,
  error_msg text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL
);
CREATE INDEX idx_sent_emails_empresa_enviado ON sent_emails(empresa_id, enviado_at DESC);
CREATE INDEX idx_sent_emails_resend_id ON sent_emails(resend_id) WHERE resend_id IS NOT NULL;

CREATE TABLE public.email_plantillas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN ('comprobante','recordatorio','notificacion',
                                     'recordatorio_1','recordatorio_2','recordatorio_3',
                                     'intimacion','escalado_legal')),
  kicker text NOT NULL DEFAULT '',
  titulo text NOT NULL DEFAULT '',
  cuerpo text NOT NULL DEFAULT '',         -- markdown o HTML con {{placeholders}}
  firma text,
  color_acento text NOT NULL DEFAULT '#1d4ed8' CHECK (color_acento ~ '^#[0-9A-Fa-f]{6}$'),
  mostrar_logo boolean NOT NULL DEFAULT true,
  mostrar_datos boolean NOT NULL DEFAULT true,
  cta_label text,
  cta_url text,
  activo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, tipo)
);

CREATE TABLE public.administracion_emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  administracion_id uuid NOT NULL REFERENCES administraciones(id) ON DELETE CASCADE,
  email text NOT NULL,
  es_principal boolean NOT NULL DEFAULT false,
  recibe_facturacion boolean NOT NULL DEFAULT false,  -- ⚠ filtro clave en enqueue_envios_lote
  activo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

### 3.7 Storage buckets

```sql
-- Certificados ARCA: privado, scoped por empresa
INSERT INTO storage.buckets (id, name, public, file_size_limit) VALUES
  ('arca-certs', 'arca-certs', false, 1 * 1024 * 1024)
ON CONFLICT DO NOTHING;
-- Path: {empresa_id}/cert.crt y {empresa_id}/key.key
-- Policies: solo apex/partner de la empresa con SELECT/INSERT/UPDATE

-- PDFs de comprobantes: privado, pre-generados antes de envío masivo
INSERT INTO storage.buckets (id, name, public, file_size_limit) VALUES
  ('comprobantes-pdf', 'comprobantes-pdf', false, 5 * 1024 * 1024)
ON CONFLICT DO NOTHING;
-- Path: {empresa_id}/{comprobante_id}.pdf

-- Assets de plantillas (imágenes embebidas): público con CORS
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES
  ('email-assets', 'email-assets', true, 5 * 1024 * 1024,
   ARRAY['image/jpeg','image/png','image/webp','image/gif','image/svg+xml'])
ON CONFLICT DO NOTHING;
-- Path: {empresa_id}/{uuid}.{ext}
```

---

## Sección 4 — Integración ARCA (WSAA + WSFEv1)

### 4.1 Flujo conceptual

```
[click "Autorizar lote"]
        ↓
RPC enqueue_emision_lote(lote_id, intervalo_seg=15)
        ↓
INSERT N rows en arca_emision_queue (scheduled_at = now() + i*15s)
        ↓
[pg_cron cada 1 min]
        ↓
edge dispatch-arca-emission (max_jobs=3 por corrida)
   ├─ RPC dispatch_next_arca_job (FOR UPDATE SKIP LOCKED → status=sending)
   ├─ POST a edge arca-autorizar-comprobante (con job_id en body)
   │     ├─ WSAA login → TA (cacheado en arca_tokens, margen 60s)
   │     ├─ FECompUltimoAutorizado → nextNum
   │     ├─ Agrupar alícuotas IVA
   │     ├─ calcDoc(receptor_tipo, numero) ← defensa E41
   │     ├─ FECAESolicitar → CAE o Err
   │     ├─ UPDATE comprobante (numero, cae, estado='autorizado')
   │     └─ UPSERT numerador
   ├─ Si OK   → marcar_arca_job_done
   ├─ Si transient → SET status='pending', scheduled_at = now()+60s
   └─ Si permanente → marcar_arca_job_failed
        ↓
[Realtime sobre arca_emision_queue] → ArcaJobsPanel actualiza UI viva
        ↓
[pg_cron cada 5 min] reset_arca_jobs_colgados(10)  ← watchdog
[pg_cron cada 10 min] process_anomalias_lote_arca() ← push si estancado
```

### 4.2 WSAA (autenticación)

`_shared/arca-wsaa-wsfe.ts` — implementación SOAP nativa (sin SDKs):

```ts
// Pseudo-código del flujo WSAA login
export async function wsaaLogin(opts: {
  cuit: string;
  ambiente: 'homologacion'|'produccion';
  certPem: string;
  keyPem: string;
}): Promise<{ token: string; sign: string; expires: string }> {
  // 1) Construir LoginTicketRequest XML
  const generationTime = new Date(Date.now() - 5*60*1000).toISOString();    // -5 min margen
  const expirationTime = new Date(Date.now() + 12*3600*1000).toISOString(); // +12h
  const uniqueId = Math.floor(Date.now() / 1000);
  const ltr = `<?xml version="1.0" encoding="UTF-8"?>
    <loginTicketRequest version="1.0">
      <header>
        <uniqueId>${uniqueId}</uniqueId>
        <generationTime>${generationTime}</generationTime>
        <expirationTime>${expirationTime}</expirationTime>
      </header>
      <service>wsfe</service>
    </loginTicketRequest>`;

  // 2) Firmar con CMS (PKCS#7) usando node-forge
  const cms = forge.pkcs7.createSignedData();
  cms.content = forge.util.createBuffer(ltr, 'utf8');
  cms.addCertificate(forge.pki.certificateFromPem(certPem));
  cms.addSigner({
    key: forge.pki.privateKeyFromPem(keyPem),
    certificate: forge.pki.certificateFromPem(certPem),
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      { type: forge.pki.oids.signingTime, value: new Date() },
    ],
  });
  cms.sign({ detached: false });
  const cmsB64 = forge.util.encode64(forge.asn1.toDer(cms.toAsn1()).getBytes());

  // 3) POST SOAP a WSAA
  const url = ambiente === 'produccion'
    ? 'https://wsaa.afip.gov.ar/ws/services/LoginCms'
    : 'https://wsaahomo.afip.gov.ar/ws/services/LoginCms';
  const soap = `<?xml version="1.0"?>
    <soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
                      xmlns:wsaa="http://wsaa.view.sua.dvadac.desein.afip.gov">
      <soapenv:Header/>
      <soapenv:Body><wsaa:loginCms><wsaa:in0>${cmsB64}</wsaa:in0></wsaa:loginCms></soapenv:Body>
    </soapenv:Envelope>`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: '' },
    body: soap,
  });

  // 4) Parsear loginCmsReturn → extraer <token>, <sign>, <expirationTime>
  // 5) UPSERT en arca_tokens con cache de 12h (chequear expires - 60s antes de reusar)
}
```

**Errores WSAA frecuentes** (hardcoded handling):
- `WSAA_NOT_AUTHORIZED`: cert no fue dado de alta en "Administrador de Relaciones" para WSFE → no retry, abrir panel de config.
- `WSAA_EXPIRED`: cert vencido → no retry, banner rojo.
- `WSAA_CMS`: firma rechazada → cert/key no matchean o son de ambiente distinto.
- `"El CEE ya posee TA"`: race transitorio cuando dos requests piden token a la vez → retry con leer cache de nuevo.

### 4.3 WSFE FECAESolicitar (autorización)

```ts
export async function feCAESolicitar(opts: {
  token: string; sign: string; cuit: string; ambiente: string;
  comprobante: {
    cbteTipo: number;        // 1=FA A, 6=FA B, 11=FA C, 51=FX, 3=NC A, 8=NC B, ...
    ptoVta: number;
    cbteNro: number;         // = ultimoAutorizado + 1
    docTipo: number;         // 80=CUIT, 96=DNI, 99=CF
    docNro: number | bigint; // 0 si CF
    impTotal: number;
    impNeto: number;
    impIVA: number;
    impTotConc: number;      // no gravado
    impOpEx: number;         // exento
    iva: { id: number; baseImp: number; importe: number }[]; // alícuotas: 5=21, 4=10.5, 6=27, 3=0
    cbteFch: string;         // YYYYMMDD
    moneda: 'PES';
    cotizacion: 1;
    concepto: 1 | 2 | 3;     // 1=Productos, 2=Servicios, 3=Productos y servicios
    receptor_razon: string;
  };
}): Promise<{ resultado: 'A'|'R'; cae?: string; vencimiento?: string; obs?: any[]; err?: any[] }>;
```

**Códigos AFIP a manejar específicamente**:
| Código | Significado | Retry? |
|--------|-------------|--------|
| 10015  | DocNro inválido | No — error de validación |
| 10218  | No autorizado para ese tipo | No |
| 10243  | DocTipo inválido | No |
| 10016  | RangoCbteNro inválido | No (recalcular nextNum) |
| 1000+  | Validación de datos en general | No |
| HTTP 5xx | AFIP overloaded | Sí (3× con backoff) |
| Timeout | AFIP responde lento | Sí |
| `"ya posee TA"` | Race WSAA | Sí, re-leer cache |
| `"comprobante ya registrado"` | Duplicado AFIP-side | Sí transient (P-ARCA-03 reconciliación) |

### 4.4 calcDoc — defensa en profundidad (E41)

```ts
function calcDoc(tipoDoc: string, numeroDoc: string): { docTipo: number; docNro: number } {
  if (tipoDoc === 'cuit' && /^\d{11}$/.test(numeroDoc)) return { docTipo: 80, docNro: Number(numeroDoc) };
  if (tipoDoc === 'dni' && /^\d{7,8}$/.test(numeroDoc)) return { docTipo: 96, docNro: Number(numeroDoc) };
  // dni_ficticio (consorcios sin CUIT real) viaja como CF
  return { docTipo: 99, docNro: 0 };
}
```

**Por qué importa**: si por algún path lateral un valor basura llega a `comprobantes` (p.ej. `"1111111111111"` con 13 dígitos), el CHECK lo bloquea. Si igual alguien hizo bypass, `calcDoc` lo manda como CF en lugar de aceptar. Tres capas: UI + DB + edge.

### 4.5 Retry transient

```ts
const TRANSIENT_PATTERNS = [
  /HTTP[\s_]?5\d\d/i, /timeout/i, /network/i, /connection/i,
  /WSAA[_\s]FAULT/i, /WSFE[_\s]FAULT/i,
  /ya posee TA/i, /comprobante ya registrado/i, /cbtenro/i,
  /ALREADY_QUEUED/i,                         // race momentáneo (MDC-26)
];

export function isTransientArcaError(err: unknown): boolean {
  const msg = (err as Error)?.message ?? String(err);
  return TRANSIENT_PATTERNS.some(re => re.test(msg));
}

export async function withArcaRetry<T>(fn: () => Promise<T>,
  opts = { retries: 3, delays: [3_000, 6_000, 12_000] }): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i <= opts.retries; i++) {
    try { return await fn(); }
    catch (e) {
      lastErr = e;
      if (i === opts.retries || !isTransientArcaError(e)) throw e;
      await new Promise(r => setTimeout(r, opts.delays[i] ?? 12_000));
    }
  }
  throw lastErr;
}
```

### 4.6 Constantes mágicas ARCA

| Constante | Valor | Justificación |
|-----------|-------|---------------|
| `INTERVALO_EMISION_DEFAULT` | 15 s | D02 — AFIP necesita tiempo entre emisiones |
| `INTERVALO_EMISION_MIN` | 5 s | Floor — más rápido genera 429 |
| `INTERVALO_EMISION_MAX` | 120 s | Ceil — más lento es desperdicio |
| `TA_CACHE_MARGIN` | 60 s | Reusar cache si `expires_at > now() + 60s` |
| `DISPATCH_MAX_JOBS` | 3 | Por corrida del cron de 1 min — limita concurrencia AFIP |
| `WATCHDOG_THRESHOLD` | 10 min | Job en `sending` > 10min → reset a `pending` |
| `WATCHDOG_CRON` | `*/5 * * * *` | Cada 5 min |
| `RETRY_DELAYS` | [3s, 6s, 12s] | Backoff exponencial transitorios |
| `RETRY_MAX_ATTEMPTS` | 3 | Más es spam |
| `SOAP_DEBUG_TTL` | 30 días | Cleanup de `arca_request/response_xml` |
| `ANOMALIA_BUCKET` | 30 min | Dedup notifs push |
| `ANOMALIA_CRON` | `*/10 * * * *` | Detección proactiva |

### 4.7 Anomalías detectadas y push (mig 0106)

5 tipos auto-detectables con cron `*/10 * * * *`:
- **`estancado`**: pending > 0 y último done_at hace > 30 min.
- **`tasa_fallos_alta`**: últimos 20 jobs con > 30% failed.
- **`watchdog_actuo`**: 3+ jobs con `[WATCHDOG]` en `last_error` en últimos 15 min.
- **`afip_no_responde`**: últimos 5 errores son HTTP 5xx/timeout/network.
- **`cert_vencido`**: `WSAA_EXPIRED` en últimos 30 min.

Cada uno dispara INSERT en `push_outbox` (broadcast a apex/partner) y un `lote_arca_anomalias_notificadas` por `(lote_id, tipo, hora_bucket)` para no spamear si la anomalía persiste.

### 4.8 Edge functions ARCA — checklist

1. **`arca-generar-csr`**: keypair RSA 2048 + CSR PKCS#10 con node-forge. Guarda key en `arca-certs/{empresa_id}/key.key`. Devuelve CSR PEM al cliente.
2. **`arca-inspeccionar-cert`**: parsea cert + key, devuelve `{ subject, issuer, valid_from, valid_to, cert_key_match, is_self_signed, issuer_looks_afip, is_csr }`. UI muestra warnings si algo no cuaja.
3. **`arca-test-conexion`**: smoke test. WSAA login + FECompUltimoAutorizado tipo A. Persiste en `empresa_arca_config.ultimo_test_*`.
4. **`arca-autorizar-comprobante`**: el caballito de batalla. Recibe `{empresa_id, comprobante_id, job_id?}`. JWT validation (apex/partner only). Idempotencia: si hay otro job 'sending' con mismo `comprobante_id` y distinto `job_id` → `ALREADY_QUEUED`.
5. **`dispatch-arca-emission`**: invocada por pg_cron. `max_jobs=3` por default. FOR UPDATE SKIP LOCKED. Si transitorio: reschedule en +60s. Si permanente: `marcar_arca_job_failed`.

### 4.9 RPCs Postgres ARCA

```sql
-- Encolar lote completo (D01)
CREATE FUNCTION enqueue_emision_lote(p_lote_id uuid, p_intervalo_seg int DEFAULT NULL)
  RETURNS TABLE(encolados int, saltados int, primer_emision timestamptz,
                ultimo_emision timestamptz, job_ids uuid[])
  LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp';
-- Lógica:
--   PERFORM assert_empresa_access(...)
--   intervalo = COALESCE(p_intervalo_seg, empresa_arca_config.arca_intervalo_emision_seg, 15)
--   FOR comprobante IN borradores DEL lote:
--     INSERT arca_emision_queue (scheduled_at = now() + i*intervalo)
--     ON CONFLICT (comprobante_id) WHERE status IN ('pending','sending') DO NOTHING
--   UPDATE lotes_facturacion SET log = log || jsonb_build_array({ts, evento, ...})

-- Tomar próximo job (FOR UPDATE SKIP LOCKED)
CREATE FUNCTION dispatch_next_arca_job() RETURNS TABLE(
  job_id uuid, empresa_id uuid, comprobante_id uuid, attempts int, max_attempts int
) LANGUAGE plpgsql SECURITY DEFINER ...;

CREATE FUNCTION marcar_arca_job_done(p_job_id uuid) ...;
CREATE FUNCTION marcar_arca_job_failed(p_job_id uuid, p_motivo text) ...;
CREATE FUNCTION reintentar_arca_jobs_fallidos(p_lote_id uuid) RETURNS int ...;

-- Watchdog (D14, mig 0105)
CREATE FUNCTION reset_arca_jobs_colgados(p_max_age_min int DEFAULT 10) RETURNS int ...;

-- UI: lista jobs con detalles (mig 0105 lo cambió a jsonb por límite PostgREST)
CREATE FUNCTION arca_jobs_de_lote(p_lote_id uuid) RETURNS jsonb ...;

-- Anomalías (mig 0106)
CREATE FUNCTION detectar_anomalias_lote_arca() RETURNS TABLE(...) ...;
CREATE FUNCTION process_anomalias_lote_arca() ...;
```

---

## Sección 5 — Pipeline de email

### 5.1 Flujo conceptual

```
[click "Enviar lote por email"]
        ↓
EnviarLoteEmailDialog (4 steps)
   1) preview      ← stats por admin, intervalo, advertencias
   2) pregenerando ← genera PDFs en chunks de 3, sube a comprobantes-pdf
   3) encolando    ← RPC enqueue_envios_lote(intervalo_min=5)
   4) done         ← muestra resumen
        ↓
INSERT N rows en email_queue (1 por admin con email)
   scheduled_at = next_email_slot(empresa_id) + offset
        ↓
[pg_cron cada 1 min]
        ↓
edge dispatch-email-queue (max_jobs=5)
   ├─ Watchdog: reset 'sending' > 5 min → 'pending'
   ├─ RPC dispatch_next_email_job (FOR UPDATE SKIP LOCKED)
   ├─ Pre-split: si comprobante_ids.length >= 20 → splitear_envio_too_large
   ├─ Descarga PDFs del bucket en paralelo (8 conexiones max)
   ├─ Arma ZIP con dedup de nombres ("Admin - Edif - FA 00001-00000001.pdf")
   ├─ Si zipBytes > 38 MB → splitear_envio_too_large recursivo
   ├─ POST a Resend con Idempotency-Key=job_id
   ├─ Si OK → marcar_envio_enviado (UPSERT sent_emails)
   ├─ Si fail → marcar_envio_fallido (reschedule +5 min, 3 intentos máx)
   └─ maybeMandarResumenLote (si todos terminaron, mail de cierre)
        ↓
[Resend webhooks → resend-webhook]
   apply_resend_event(resend_id, type, at)
   → events[] JSONB se va llenando: sent → delivered → opened → clicked
```

### 5.2 Throttle global (D05, E42)

```sql
-- Fuente única de verdad. Hardcoded 5 min por empresa, NO configurable (AP-07).
CREATE OR REPLACE FUNCTION public.next_email_slot(p_empresa_id uuid)
RETURNS timestamptz LANGUAGE sql STABLE AS $$
  SELECT GREATEST(
    now() + interval '1 minute',
    COALESCE((SELECT MAX(scheduled_at) FROM email_queue
              WHERE empresa_id = p_empresa_id
                AND status IN ('pending','scheduled','sending')) + interval '5 minutes',
             now()),
    COALESCE((SELECT MAX(enviado_at) FROM sent_emails  -- ⚠ enviado_at, NO sent_at (E43)
              WHERE empresa_id = p_empresa_id) + interval '5 minutes',
             now())
  );
$$;
```

**Razón**: Resend penaliza con 429 si dos mails de mismo dominio salen muy juntos. El usuario manda factura, ve typo, reenvía corregida — sin throttle, los dos llegan en 30s y Gmail los marca spam. Reputación del dominio se daña fácil.

### 5.3 Splitter inteligente

```sql
-- Si ZIP > 38 MB, particiona en N partes balanceadas.
-- Si comp único > 38 MB → marca too_large (sin solución automática).
CREATE FUNCTION splitear_envio_too_large(p_job_id uuid, p_zip_size_bytes bigint)
RETURNS TABLE(partes_creadas int, primer_envio timestamptz, job_ids uuid[]) ...;
-- Lógica:
--   N = LEAST(8, GREATEST(2, CEIL(zip_size / 30MB)))
--   Distribuye comprobante_ids en N chunks balanceados
--   INSERT N nuevos jobs con parte=1..N, partes_total=N
--   Spacing: +5 min entre partes (anti-spam Gmail)
--   DELETE job original

-- Pre-split (TODO-MDC-33): preventivo para >= 20 comprobantes (OOM prevention)
-- Hace lo mismo PERO antes de descargar PDFs, con estimación 1MB/comp.
```

**Constantes**:
- `ZIP_SIZE_LIMIT_BYTES = 38 * 1024 * 1024` (margen de 2 MB sobre 40 MB hard de Resend).
- `PRE_SPLIT_THRESHOLD = 20` comprobantes (evita OOM del worker Deno).
- `TARGET_PER_PART = 30 * 1024 * 1024` (target de tamaño por parte tras split).
- `MAX_PARTES = 8`.

### 5.4 Resend integration

```ts
// dispatch-email-queue/index.ts (extracto)
const formData = {
  from: `${RESEND_FROM_NAME} <${RESEND_FROM_EMAIL}>`,
  to: [job.to_email],
  cc: job.cc_emails,
  reply_to: empresa.email_reply_to ?? undefined,
  subject: job.subject,
  html: renderedHtml,                          // si individual
  attachments: [{ filename, content: zipB64 }],// content base64
};

const r = await fetch('https://api.resend.com/emails', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${RESEND_API_KEY}`,
    'Content-Type': 'application/json',
    'Idempotency-Key': job.id,                 // D09: dedup si retry
  },
  body: JSON.stringify(formData),
});
```

**Setup del dominio en Resend**:
1. Agregar dominio (`tudominio.com.ar`).
2. Resend te da 3 records DNS:
   - `default._domainkey.tudominio` TXT → `p=...` (DKIM público).
   - SPF: `v=spf1 include:sendingdomain.resend.com ~all`.
   - (opcional) DMARC: `v=DMARC1; p=quarantine; rua=mailto:postmaster@tudominio`.
3. Esperar propagación (~10 min) y verificar.
4. Configurar `from`: `facturacion@tudominio.com.ar` (debe estar en dominio verificado).
5. Webhooks: configurar URL `https://<proyecto>.supabase.co/functions/v1/resend-webhook` con secret Svix.

### 5.5 Webhook idempotencia

```sql
-- apply_resend_event chequea (resend_id, type, at) antes de aplicar
CREATE FUNCTION apply_resend_event(
  p_resend_id text, p_event_type text, p_event_at timestamptz, p_data jsonb
) RETURNS TABLE(sent_email_id uuid, applied boolean)
LANGUAGE plpgsql AS $$
DECLARE v_id uuid; v_exists boolean;
BEGIN
  SELECT id INTO v_id FROM sent_emails WHERE resend_id = p_resend_id;
  IF v_id IS NULL THEN
    RETURN QUERY SELECT NULL::uuid, false;
    RETURN;
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM jsonb_array_elements(events) e
    WHERE e->>'type' = p_event_type AND (e->>'at')::timestamptz = p_event_at
  ) INTO v_exists FROM sent_emails WHERE id = v_id;

  IF v_exists THEN
    RETURN QUERY SELECT v_id, false;
    RETURN;
  END IF;

  UPDATE sent_emails SET
    events = events || jsonb_build_array(jsonb_build_object('type', p_event_type, 'at', p_event_at, 'data', p_data)),
    last_event_at = GREATEST(COALESCE(last_event_at, '-infinity'::timestamptz), p_event_at),
    delivered_at = CASE WHEN p_event_type='delivered' THEN p_event_at ELSE delivered_at END,
    bounced_at   = CASE WHEN p_event_type='bounced'   THEN p_event_at ELSE bounced_at END,
    -- ...
    estado = CASE
      WHEN p_event_type IN ('bounced','complained') THEN p_event_type
      WHEN p_event_type='delivered' AND estado='sent' THEN 'delivered'
      ELSE estado
    END
  WHERE id = v_id;

  RETURN QUERY SELECT v_id, true;
END;
$$;
```

### 5.6 Plantillas + placeholders

Plantillas almacenadas como markdown/HTML con `{{placeholders}}`. Render server-side antes de encolar.

Placeholders soportados típicos:
- `{{destinatario}}`, `{{empresa}}`, `{{administracion}}`, `{{edificio}}`
- `{{periodo}}` (formato "abril 2026"), `{{tipo}}`, `{{numero}}`, `{{total}}`, `{{cae}}`
- `{{mensaje}}` (sólo para tipo `notificacion`)

Sanitización: **DOMPurify** en cliente al guardar (whitelist conservadora: sin `<script>`, `<iframe>`, sin event handlers, sin `javascript:` URLs). Editor: TipTap 3.x.

### 5.7 Constantes mágicas email

| Constante | Valor | Justificación |
|-----------|-------|---------------|
| `THROTTLE_GLOBAL` | 5 min | Floor por empresa (E42) |
| `RETRY_DELAY` | 5 min | Reschedule si falla |
| `RETRY_MAX_ATTEMPTS` | 3 | Más es spam |
| `WATCHDOG_TIMEOUT` | 5 min | Reset 'sending' > 5min |
| `ZIP_SIZE_LIMIT_BYTES` | 38 MB | Margen 2 MB sobre 40 MB Resend |
| `PRE_SPLIT_THRESHOLD` | 20 comp | OOM prevention |
| `TARGET_PER_PART` | 30 MB | Target tras split |
| `MAX_PARTES` | 8 | Cap razonable |
| `MAX_JOBS_PER_CRON` | 5 | Concurrencia por corrida |
| `PDF_DOWNLOAD_BATCH` | 8 | Conexiones simultáneas al bucket |
| `OVERDUE_THRESHOLD` | 10 min | Health: pending > 10 min = atrasado |
| `EDGE_TIMEOUT` | 55 s | Margen 5s sobre 60s Supabase |

---

## Sección 6 — UX / componentes

### 6.1 Filosofía UX

1. **Drawer sobre Modal** para flujos largos (wizard de 4 steps, conciliación). Modal solo para confirmaciones rápidas.
2. **Preview-first**: nunca crear/emitir/enviar sin paso intermedio que muestre stats + advertencias.
3. **Cards-as-filters**: las stat cards son clickables y filtran la grilla. Más rápido que un combobox.
4. **Banner reanudable** para procesos largos: si el user cierra y vuelve, ofrecer "Reanudar análisis previo" o "Descartar".
5. **Realtime sobre la cola** para avance vivo. El user debe poder cerrar la pestaña y volver — el server sigue.
6. **Copy argentino, pedagógico** (ver "Copy destacable" abajo).
7. **Iconos consistentes** (ver mapeo abajo).
8. **Tabular nums** en columnas numéricas (`className="tabular"`).

### 6.2 Componentes principales

| Componente | Responsabilidad | Tipo |
|------------|-----------------|------|
| `FacturacionPage` | Orquestador 4 tabs + dialogs globales | Page |
| `LoteWizardDialog` | Lote rápido desde edificios activos (139 LOC) | Drawer |
| `LoteMasivoDialog` | Wizard Excel + clasificador + preview (1281 LOC) | Drawer (steps) |
| `EnviarLoteEmailDialog` | 4-step: preview → pregenerar → encolar → done | Drawer (steps) |
| `ArcaJobsPanel` | Lista de jobs ARCA con Realtime + reintentar | Panel |
| `ArcaConfigDialog` | 3-step: CSR → cert/key → test | Drawer |
| `ArcaStatusCard` | Card de estado (5 variantes) + alerta vencimiento cert | Card |
| `EmisionExitosaModal` | Celebración + descarga PDF auto-cerrar | Modal |
| `LotesPendientesBanner` | Lista de lotes con borradores/fallidos + dismiss | Banner |
| `ComprobanteFormDialog` | Crear comprobante manual (items dinámicos) | Drawer |
| `NotaCreditoDialog` | NC simple/avanzada (total/parcial) | Drawer |
| `EmailComprobanteDialog` | Reenviar 1 comprobante con plantilla | Drawer |
| `PlantillaEmailEditor` | Editar plantillas (TipTap) | Drawer |
| `ReclamoCtaCteDialog` | Reclamo de saldo pendiente | Drawer |

### 6.3 Patrón Drawer

```tsx
<Drawer
  open={open}
  onClose={close}
  width={720}
  kicker="Facturación masiva"
  title="Lote desde planilla"
  description="Subí un Excel con admin + edificio + periodo por fila..."
  icon={<FileUp size={20} />}
  compactOnScroll={step === 'preview'}
  footer={...}
>
  {step === 'upload' && <UploadStep ... />}
  {step === 'preview' && <PreviewStep ... />}
  {step === 'done' && <DoneStep ... />}
</Drawer>
```

### 6.4 Wizard step pattern

```tsx
type Step = 'upload' | 'preview' | 'applied';
const step: Step = aplicado ? 'applied' : procesado ? 'preview' : 'upload';
// Render condicional + footer cambia por step
```

### 6.5 Stat cards clickables

```tsx
<button onClick={() => setFiltroEstado('pendientes')}
  className={cn('card-premium p-3', filtroEstado === 'pendientes' && 'ring-2 ring-orange')}>
  <p className="kicker">Pendientes</p>
  <p className="tabular text-2xl font-bold">{contadores.pendientes}</p>
</button>
```

### 6.6 Iconos consistentes (lucide-react)

| Concepto | Icono |
|----------|-------|
| Subir archivo | `Upload`, `FileUp` |
| Analizar/buscar | `Search` |
| Crear/emitir | `Plus`, `FileCheck2` |
| Descargar | `Download` |
| Email | `Mail`, `Send` |
| Configurar | `ShieldCheck`, `PlugZap`, `Settings` |
| Éxito | `CheckCircle2` |
| Error | `AlertCircle`, `AlertTriangle` |
| Pending/skipped | `Clock`, `CircleDashed` |
| Loading | `Loader2` (con `animate-spin`) |
| Expand/collapse | `ChevronDown`, `ChevronUp` |
| Delete/dismiss | `Trash2`, `X` |
| Undo/NC | `Undo2` |
| Refresh/retry | `RefreshCcw`, `RotateCcw` |
| Capas/lote | `Layers` |
| Guardar | `Save` |

### 6.7 Copy argentino destacable (citas literales)

- Sobre planilla duplicada: `"Si subís el mismo archivo otra vez aparecerá como duplicado. Cada fila marca (edificio, período). Si viajan dos facturas del mismo edificio en el mismo período son una."`
- Sobre lote desde activos: `"Crea un comprobante en borrador por cada edificio activo. Usa el monto de abono como base del ítem 'Abono mensual'. Después podés revisarlos uno por uno o autorizarlos en bulk."`
- Sobre side-effects al cerrar lote: `"El sistema va a: Generar el snapshot del período (ícono de edificios por admin) · Desactivar los edificios que no entraron en el lote"`
- Sobre producción real: `"Vas a emitir CAE reales. Asegurate de que los certs son de producción."`
- Sobre regenerar CSR: `"¿Continuar? Si regenerás un CSR nuevo, la anterior se reemplaza y el cert que hayas subido quedará inservible."`
- Sobre cron + browser: `"El cron procesa los jobs cada minuto · podés cerrar la pestaña, el server sigue."`
- Sobre stat tamaño: `"La estimación es aproximada (150 KB por PDF) — el chequeo real se hace al armar el zip."`
- Modal éxito: `"¡Factura emitida! 🎉"` + `"Ya que está, ¿no la querés descargar?"` + nota: `"La bajamos lista para mandarla, con el nombre canónico Admin · Edificio · FA 00005-00000001.pdf"`
- Email programado: `"Email programado para admin@corp.com · sale a las 15:30 (en ~5 min)"`

### 6.8 Storybook informal (estados clave)

**Lote 0 borradores + 5 autorizados**: `LotesPendientesBanner` no aparece. En grilla estado="autorizado". Botón "Enviar por email" activo.

**Lote 10 borradores + 3 autorizados + 2 fallidos**: banner muestra alerta. Botón "Autorizar todo" activo. "Enviar por email" deshabilitado (no todos autorizados).

**Comprobante recién autorizado**: `EmisionExitosaModal` abre auto. CAE visible. Auto-cierra a los 1.5s tras descargar.

**ARCA sin configurar**: `ArcaStatusCard` gris. CTA "Configurar ARCA". En `ArcaConfigDialog` solo Paso 1 activo.

**ARCA homologación, listo, sin probar**: card azul. CTA "Probar conexión".

**ARCA cert vence < 7 días**: banner rojo encima del card: `"⚠ El certificado ARCA vence en 5 días (2026-05-14). Renová antes para no cortar facturación."`

**Email programado**: toast + en tab Envíos row con estado "scheduled" + hora.

---

## Sección 7 — Errores históricos (NO repetir)

> Cada uno tiene un patrón claro de prevención. Si lo vivís de nuevo, leelo y aplicalo, no debugueés desde cero.

### E01 · CHECK constraint mismatch
- Síntoma: transacción aborta sin razón aparente.
- Causa: literal en RPC no matchea CHECK (`'salida'` vs `'entrega'`).
- Fix: archivo `enums.ts` con TODO enum + import en RPCs. Si estable: `CREATE TYPE` nativo.

### E02 · Columna inexistente en UPDATE
- Síntoma: `42703 column "updated_at" does not exist`.
- Causa: copia de boilerplate asume `updated_at` que no existe en tabla pre-existente.
- Fix: SIEMPRE `SELECT column_name FROM information_schema.columns WHERE table_name = ...` antes de tocar tabla vieja. Tabla nueva: usar template P-DB-01 con `id/created_at/updated_at` + trigger.

### E03 · VARCHAR insuficiente
- Síntoma: `22001 string too long`.
- Causa: VARCHAR(50) insuficiente cuando UI concatena texto.
- Fix: VARCHAR fijo solo para formato determinista (CUIT, código postal). Texto libre = `text`.

### E04 · Policies RLS zombie con `IF NOT EXISTS`
- Síntoma: usuario ve todo en blanco, parece bug de datos.
- Causa: `CREATE POLICY IF NOT EXISTS` con typo dejó una policy buggy que nunca se reemplazó.
- Fix: **NUNCA** `IF NOT EXISTS` en policies. Siempre `DROP POLICY IF EXISTS ...; CREATE POLICY ...`.

### E13 · Edge functions sin versionar
- Síntoma: drift entre prod y repo.
- Fix: edge function nace en `supabase/functions/<name>/index.ts`, deploy con CLI (`supabase functions deploy <name>`), nunca desde Studio/MCP en prod.

### E14 · 401 con `verify_jwt=true` + `functions.invoke()`
- Síntoma: edge function devuelve 401 sin loggearse.
- Fix: para edges invocadas desde browser → `verify_jwt=false` en config + validar internamente con `admin.auth.getUser(jwt)` + check de rol. Patrón P-API-05.

### E15 · PDF adjunto con plantilla equivocada
- Síntoma: email manda factura pero el PDF muestra grilla genérica.
- Causa: `printFacturaOficial()` y `renderPdfBlob({attachments})` usaban builders distintos.
- Fix: extraer `buildFacturaOficialHtml(params) → html` único + primitive `renderHtmlToPdfBlob(html)` único. Print y email reusan.
- Gotchas html2canvas: `crossorigin="anonymous"` en `<img>` del QR (api.qrserver.com), esperar `load` de TODAS las imgs antes de captar (timeout 3s/img), delay 450ms post-readyState.

### E41 · Receptor sin CUIT mandaba basura a AFIP
- Síntoma: AFIP rechaza con `[10015] DocNro inválido`. Operadora inventaba `1111111111111` para pasar UI.
- Fix: defensa en 3 capas (UI + DB CHECK regex `^\d{11}$` + edge `calcDoc`). Auditar lo enviado en `receptor_doc_tipo_enviado smallint`.

### E42 · Email individual sin throttle global
- Síntoma: 4 mails en 30 segundos a mismo cliente, dañando reputación dominio.
- Fix: helper `next_email_slot(empresa_id)` único, hardcoded 5 min. Cola unificada (`kind` IN `lote`/`individual`). Defensa profunda: `send-email-resend` rechaza con 429 si <5min desde último.

### E43 / E46 · `sent_emails.sent_at` no existe (es `enviado_at`)
- Síntoma: `42703 column "sent_at" does not exist` al invocar RPC.
- Causa: asumimos naming inglés en tabla con naming híbrido pre-existente.
- Fix: ANTES de escribir RPC contra tabla vieja → `SELECT column_name FROM information_schema.columns WHERE table_name = 'sent_emails'`. Cuando arregles un naming bug, **`grep -rn` en TODO el repo** para no dejar hermanos sin fix.

### E44 · Timeout por subquery correlacionado sin índice
- Síntoma: `canceling statement due to statement timeout` en `/recupero` o dashboard.
- Causa: subquery correlacionado contra FK sin índice → seq scan O(N×M).
- Fix: CTE pre-agregada + LEFT JOIN. ÍNDICE EN TODA FK (Postgres NO los crea solo). EXPLAIN ANALYZE antes de exponer RPC al frontend (regla 11 CLAUDE.md).

### E45 · Cross-tenant trivial en RPCs `SECURITY DEFINER`
- Síntoma: user de empresa A pasa UUID de empresa B en DevTools, lee/modifica datos de B.
- Fix: helper `assert_empresa_access(p_empresa_id)` + llamar al inicio de TODA RPC SECURITY DEFINER que reciba `p_empresa_id` o cargue datos por ID. Apex bypassa.

### E48 · FK sin índice
- Síntoma: causa de E44.
- Fix: al agregar columna `*_id` con FK, **misma migración** crea el `INDEX`.

### MDC-26 · ALREADY_QUEUED en retry legítimo
- Síntoma: dispatcher reintenta job y la edge fn dice `ALREADY_QUEUED` porque ve el mismo job en `sending`.
- Fix: pasar `job_id` en body del POST. Edge fn excluye su propio job del check `ALREADY_QUEUED`. ALREADY_QUEUED se trata como **transitorio** (race momentáneo).

### MDC-22 · Wizard chunked perdía 51/1051 edificios
- Síntoma: paginación por defecto cortaba a 1000.
- Fix: `fetchAllEdificios()` con `range()` chunks de 1000 hasta exhaustar. Hard cap defensivo en 50k.

### MDC-33 · Email con 200 PDFs OOM en worker Deno
- Síntoma: edge function muere al armar ZIP.
- Fix: `PRE_SPLIT_THRESHOLD = 20` comprobantes → particiona ANTES de descargar PDFs.

### MDC-34 · Lotes "fantasma" en estado autorizando
- Síntoma: lote queda en `estado='autorizando'` 24h después sin avances.
- Fix: detección stale en `LotesPendientesBanner` (`updated_at < now() - 24h`). Auditoría + auto-recovery vía mig 0124.

---

## Sección 8 — Decisiones de arquitectura (D##)

| ID | Decisión | Razón principal |
|----|----------|-----------------|
| D01 | Cola persistida + cron + Realtime, **NO** client-side loop para emisión ARCA | "Sin importar si computadora se apaga, bloquea, suspende o se corta internet" |
| D02 | Intervalo entre emisiones ARCA: 15s default, configurable 5–120s, hardcoded en código | AFIP tarda en sincronizar tokens entre servers |
| D03 | Wizard masivo con simulación pre-confirmar | Catch 100% de errores ANTES de 1000 INSERTs |
| D04 | Snapshot de admin en `comprobantes` + DNI ficticio para CF | ARCA requiere receptor; cambiar admin no debe reescribir histórico |
| D05 | Email queue con throttle global 5 min + Resend dominio verificado | Reputación de dominio frágil |
| D06 | TipTap WYSIWYG + variables interpolables + test antes de guardar | Editor liviano, output HTML estándar |
| D07 | Retry 3× backoff [3s,6s,12s] **solo** transitorios | Spam evitado en validation errors |
| D08 | Persistir SOAP request/response solo en rechazos, TTL 30d | Debugging post-mortem sin inflar BD |
| D09 | `Idempotency-Key=job_id` en POST a Resend | Dedup nativo si retry |
| D10 | Health check + alerta diaria 10AM ART de cola colgada | Cron muerto silencioso = invisible |
| D11 | Cleanup auto de `email_queue` a 30 días | Tabla crece indefinidamente |
| D12 | Pre-flight test ARCA antes de "Autorizar lote completo" | Si AFIP caído, save user time |
| D13 | Banner persistido con dismiss para lotes pendientes | Realtime + recordatorio cuando vuelve |
| D14 | Resiliencia ARCA: retry transient + watchdog server-side | Crashes del dispatcher dejan jobs en limbo |
| D15 | Coherencia receptor en facturación masiva (CHECK estricto) | CHECK como última defensa, simulator replica reglas |

---

## Sección 9 — Patrones aplicables (P-XX-NN)

### P-ARCA-01 · Cache de token WSAA
SELECT del cache si `expires > now() + 60s`, sino regenerar via WSAA. Persistir en `arca_tokens` o `empresa_arca_config.ta_*`.

### P-ARCA-02 · Estados del comprobante
```
borrador → procesando → autorizado (CAE OK)
                       → observado (CAE OK + warnings)
                       → rechazado (AFIP negó)
                       → error (timeout, network, bug)
```
`rechazado`/`error` permiten reintento. `autorizado` es final salvo NC/anulación.

### P-ARCA-03 · Reconciliación post-timeout
Si cliente cierra mientras emisión en vuelo, al volver consultar `FECompConsultar(tipo, pv, nro)`. Si AFIP tiene CAE → `autorizado`. Si no → `error`, permitir reintento con nuevo número.

### P-ARCA-04 · ARCA es plugin, no core
Core puede imprimir facturas sin ARCA (tipo `X` simple). ARCA se activa por flag (`empresa_arca_config.cert_path IS NOT NULL`). Plugin puede ser deshabilitado para empresas que facturan a mano.

### P-API-01 · Respuesta estandarizada
```ts
type ApiResponse<T> =
  | { ok: true; data: T; meta?: Record<string, unknown> }
  | { ok: false; error: { code: string; message: string; details?: unknown } };
```

### P-API-04 · Retry con backoff exponencial
**Sólo para errores transitorios** (5xx, network, timeout). NO para 4xx (validación). Patron `withArcaRetry`/`withResendRetry`.

### P-API-05 · Auth en edge function
`config.toml` → `verify_jwt = false` + validación interna con `admin.auth.getUser(jwt)` + check de rol (`apex`/`partner`). Bypass de service-role para invocaciones server-to-server. Ver E14.

### P-DB-01 · Tabla base obligatoria
```sql
id uuid PK DEFAULT gen_random_uuid(),
created_at timestamptz NOT NULL DEFAULT now(),
updated_at timestamptz NOT NULL DEFAULT now(),
created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
-- + trigger touch_updated_at
```

### P-DB-02 · Naming
- Tablas: `snake_case` plural inglés (`comprobantes`, `email_queue`).
- Columnas: `snake_case` inglés (`empresa_id`, `created_at`).
- FKs: `<table_singular>_id`.
- Índices: `idx_<tabla>_<cols>`.
- Excepción: tablas pre-existentes con naming híbrido — adoptar la convención existente, no la "ideal".

### P-DB-05 · RLS helper + policies estándar
`get_user_role()` + `current_empresa_id()` SECURITY DEFINER. Policies con `DROP POLICY IF EXISTS; CREATE POLICY ...`. Apex bypassa.

### P-DB-06 · Migración segura
`BEGIN`-`COMMIT`. `IF NOT EXISTS` para tablas/columnas, `IF EXISTS` para drops. Policies: DROP+CREATE. RPCs: `SECURITY DEFINER + SET search_path + GRANT`.

### P-FE-01 · Tres estados obligatorios
`isLoading` / `error` / `empty` + happy path. Nunca renderizar lista sin EmptyState.

### P-FE-02 · Modal con state local reset on-open
```tsx
useEffect(() => { if (open) { setForm({...}); } }, [open, editing?.id]);
```
Previene "modal reusado muestra datos del ítem anterior".

---

## Sección 10 — Antipatrones (NO HACER)

| ID | Antipatrón | Reemplazo |
|----|------------|-----------|
| AP-01 | Validaciones solo en cliente | Defensa en 3 capas (UI + DB CHECK + edge) |
| AP-02 | Nombres mixto/inconsistente entre capas | Una sola convención + verificar columnas existentes |
| AP-04 | Módulos acoplados sin contrato | API Response type estandarizada |
| AP-07 | Configuraciones hardcodeadas en código | `arca_config` (BD) o `.env` (por ambiente) |
| AP-09 | Estados intermedios sin manejo explícito | Estados visibles + idempotencia |
| AP-11 | Policies RLS con `IF NOT EXISTS` | DROP + CREATE always |
| AP-13 | Secretos con prefijo `VITE_*` | `Deno.env.get()` en edge |
| AP-14 | Edge functions sin versionamiento | `supabase/functions/<name>/index.ts` + deploy CLI |
| AP-anidados | Modales anidados | Inline dialogs o tomar control del estado padre |
| AP-toasts | Toasts para errores recuperables | Banner en form, toast solo para feedback fugaz |
| AP-scroll-doble | Scroll de página dentro de modal | Scroll solo del contenido del modal |
| AP-double-submit | Click activo durante saving | `disabled={saving}` en botón |
| AP-periodo-bruto | Período sin normalizar | Siempre `parsePeriodo` → YYYY-MM-01 |
| AP-NC-sin-validar | NC parcial puede exceder original | `if (NC.total > original.total) error` |
| AP-email-sin-preview | Email sin renderizar antes de mandar | Preview HTML obligatorio |
| AP-progress-sin-fin | Job en estado intermedio sin watchdog | Watchdog cron resetea > N min |
| AP-fuzzy-sin-fallback | Fuzzy match sin desambiguación | Primer match + warning + recomendar código |
| AP-cert-sin-alerta | Cert vence sin previo aviso | Banner si vence ≤ 30d |

---

## Sección 11 — Checklist de implementación (step by step)

Para encarar de cero el módulo en un proyecto nuevo:

### Fase 0 — Pre-requisitos
- [ ] Empresa creada con `cuit`, `razon_social`, `email_contacto`, `email_reply_to`.
- [ ] Tabla `profiles` con `role IN ('apex','partner','pulse')` + `empresa_id`.
- [ ] Helper `assert_empresa_access(p_empresa_id)` y `current_empresa_id()`.
- [ ] Tablas `administraciones`, `edificios` (con `codigo`, `nombre`, `administracion_id`, `activo`).
- [ ] Storage buckets creados: `arca-certs` (privado), `comprobantes-pdf` (privado), `email-assets` (público con CORS).

### Fase 1 — Schema base
- [ ] Migración `0001_facturacion_schema.sql`: `comprobantes`, `items_comprobante`, `lotes_facturacion`, `numeradores`. Triggers + índices + RLS.
- [ ] Migración `0002_email_schema.sql`: `email_queue`, `sent_emails`, `email_plantillas`, `administracion_emails`. Triggers + índices + RLS.
- [ ] Migración `0003_arca_schema.sql`: `empresa_arca_config`, `arca_tokens`, `arca_emision_queue`, `lote_arca_anomalias_notificadas`.

### Fase 2 — RPCs core
- [ ] `crear_lote_desde_planilla(p_lote, p_filas)`, `crear_lote_desde_activos(p_empresa_id, p_periodo, p_tipo)`.
- [ ] `simular_lote_desde_planilla(p_filas)` — devuelve OK / VERIFICAR / FALTA_EDIFICIO / RECEPTOR_INCOMPLETO / MONTO_CERO por fila.
- [ ] `autorizar_comprobante_manual(p_comprobante_id)` — para cuando ARCA no está configurado.
- [ ] `crear_nota_credito(p_referencia_id, p_modo, p_monto?, p_motivo?)`.
- [ ] `cerrar_lote(p_lote_id)` — desactiva edificios fuera del lote, snapshot período.
- [ ] `descartar_comprobante(p_id)`, `anular_comprobante(p_id)`.
- [ ] Email: `next_email_slot(p_empresa_id)`, `enqueue_email_individual(p_empresa_id, p_to_email, p_subject, p_html_body, ...)`, `enqueue_envios_lote(p_lote_id, p_intervalo_min)`, `splitear_envio_too_large(p_job_id, p_zip_size_bytes)`, `marcar_envio_enviado`, `marcar_envio_fallido`, `dispatch_next_email_job`, `email_queue_health_summary`, `apply_resend_event`.
- [ ] ARCA: `enqueue_emision_lote`, `dispatch_next_arca_job`, `marcar_arca_job_done`, `marcar_arca_job_failed`, `reintentar_arca_jobs_fallidos`, `arca_jobs_de_lote` (RETURNS jsonb!), `reset_arca_jobs_colgados`, `detectar_anomalias_lote_arca`, `process_anomalias_lote_arca`.
- [ ] **Cada RPC SECURITY DEFINER**: `PERFORM assert_empresa_access(...)` al inicio.

### Fase 3 — Edge functions (Deno)
- [ ] `_shared/arca-wsaa-wsfe.ts` — cliente SOAP con `wsaaLogin`, `feCompUltimoAutorizado`, `feCAESolicitar`, `isTransientArcaError`, `withArcaRetry`, `ArcaError class`.
- [ ] `arca-generar-csr` — keypair RSA 2048 + CSR con node-forge. Guarda key en Storage.
- [ ] `arca-inspeccionar-cert` — parse + diagnósticos.
- [ ] `arca-test-conexion` — WSAA login + WSFE smoke test.
- [ ] `arca-autorizar-comprobante` — el caballito (614 LOC en MANAXER, similar acá).
- [ ] `dispatch-arca-emission` — cron processor.
- [ ] `dispatch-email-queue` — cron processor con ZIP + Resend + splitter.
- [ ] `send-email-resend` — legacy individual (puede omitirse si todo va por queue).
- [ ] `resend-webhook` — Svix + `apply_resend_event`.
- [ ] **Todas con `verify_jwt=false` y validación interna** (P-API-05).

### Fase 4 — Cron jobs (pg_cron + pg_net)
- [ ] `dispatch-email-queue-every-min` (`* * * * *`) → POST a edge `dispatch-email-queue`.
- [ ] `dispatch-arca-emission-every-min` (`* * * * *`) → POST a edge `dispatch-arca-emission`.
- [ ] `arca-watchdog-jobs-colgados` (`*/5 * * * *`) → `SELECT reset_arca_jobs_colgados(10)`.
- [ ] `lote-arca-anomalias-detect` (`*/10 * * * *`) → `SELECT process_anomalias_lote_arca()`.
- [ ] `arca-soap-debug-cleanup` (`15 4 * * *`) → trunca `arca_request/response_xml > 30d`.
- [ ] `email-queue-cleanup` (`15 4 * * *`) → `DELETE email_queue WHERE status IN ('sent','failed','too_large') AND updated_at < now() - 30d`.
- [ ] `email-queue-health-alert` (`0 13 * * *`) → POST a edge que mande mail si overdue.

### Fase 5 — Frontend services API
- [ ] `comprobantes.ts` — list/create/update/delete + bulk actions.
- [ ] `lotes.ts` — list/create/cerrar.
- [ ] `arcaConfig.ts` — getConfig/uploadCert/uploadKey/generarCsr/inspeccionarCert/testConexion.
- [ ] `arcaEmisionQueue.ts` — `enqueueEmisionLote`, `listArcaJobsDeLote`, `reintentarArcaJobsFallidos`, `dispararDispatcherArca`.
- [ ] `emails.ts` — `sendEmail` (individual via RPC), `pregenerarPdfsLote`, `enqueueEnviosLote`, `resumenLotePorAdmin`.
- [ ] `plantillasEmail.ts` — CRUD + render con placeholders.
- [ ] `administraciones.ts` + `administracionEmails.ts`.

### Fase 6 — UI components
- [ ] `Drawer` + `Modal` primitives.
- [ ] `LoteWizardDialog`.
- [ ] `LoteMasivoDialog` con clasificador + preview + reactivación inline.
- [ ] `ArcaConfigDialog` con 3 steps (CSR/cert+key/test).
- [ ] `ArcaStatusCard` con 5 variantes + alerta vencimiento.
- [ ] `ArcaJobsPanel` con Realtime sobre `arca_emision_queue`.
- [ ] `EnviarLoteEmailDialog` con 4 steps (preview → pregenerando → encolando → done).
- [ ] `EmisionExitosaModal`.
- [ ] `LotesPendientesBanner` con dismiss persistente.
- [ ] `ComprobanteFormDialog` con items dinámicos + totales en vivo.
- [ ] `NotaCreditoDialog` con simple/avanzado.
- [ ] `EmailComprobanteDialog` con preview HTML.
- [ ] `PlantillaEmailEditor` con TipTap + DOMPurify.
- [ ] `FacturacionPage` orquestador 4 tabs.

### Fase 7 — Configuración Resend
- [ ] Crear cuenta Resend, agregar dominio.
- [ ] DNS: DKIM TXT + SPF TXT (+ DMARC opcional).
- [ ] Verificar dominio (~10 min).
- [ ] Obtener `RESEND_API_KEY` y configurar webhook URL con secret Svix.
- [ ] Setear vars: `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `RESEND_FROM_NAME`, `RESEND_WEBHOOK_SECRET` en edge functions secrets.

### Fase 8 — Configuración ARCA por empresa
- [ ] UI: usuario abre `ArcaConfigDialog` → genera CSR → descarga `manaxer-{CUIT}.csr`.
- [ ] Usuario sube CSR a portal AFIP (Administrador de Certificados Digitales).
- [ ] AFIP responde con `.crt` firmado.
- [ ] Usuario sube `.crt` (paso 2 del wizard).
- [ ] Usuario asigna relación con WSFE (Administrador de Relaciones, en AFIP).
- [ ] Usuario hace "Probar conexión" → si OK, ya puede emitir.

### Fase 9 — Smoke tests obligatorios pre-deploy
- [ ] Crear lote con 5 edificios → autorizar → emitir email a 1 admin → verificar PDF en bucket + sent_email + webhook delivered.
- [ ] Probar regresión de E41: intentar emitir con receptor `dni_ficticio` que tenga CUIT 11-dig → debe fallar en CHECK.
- [ ] Probar regresión de E42: mandar 2 emails consecutivos → 2do queda scheduled +5 min.
- [ ] Smoke test cross-tenant: user de empresa A pasa UUID empresa B → cualquier RPC SECURITY DEFINER debe rechazar con 42501.
- [ ] Cerrar pestaña con jobs ARCA en vuelo → reabrir → ver progreso vivo + completado por cron.
- [ ] Forzar cert vencido (mock `valid_to < now()`) → banner rojo aparece.
- [ ] Mandar mail a un admin con 30+ comprobantes → splitter automático parte en N.
- [ ] EXPLAIN ANALYZE de cada RPC analítica → ninguna > 200ms con datos reales (regla 11).

### Fase 10 — Observabilidad
- [ ] Vista `v_email_queue_health` con `overdue/pending/sending/recent_sent_1h/failed/too_large/estado_health`.
- [ ] Indicador en UI tab Envíos: "Cola sana · último envío hace X min" o badge rojo si overdue.
- [ ] Push notifications (`push_outbox`) para anomalías ARCA.
- [ ] Tabla `lotes_facturacion.log` JSONB con timeline de eventos.
- [ ] Tabla `sent_emails.events` JSONB con timeline webhook.

---

## Sección 12 — Variables de entorno

### Frontend (Vite)
```
VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
VITE_VAPID_PUBLIC_KEY=B...           (web push)
VITE_ENV=production|staging|development
```

### Edge functions (Deno, secrets en Supabase)
```
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
RESEND_API_KEY=re_...
RESEND_FROM_EMAIL=facturacion@tudominio.com.ar
RESEND_FROM_NAME=Tu Empresa
RESEND_WEBHOOK_SECRET=whsec_...
VAPID_PRIVATE_KEY=...                 (web push)
VAPID_PUBLIC_KEY=...
VAPID_SUBJECT=mailto:soporte@tudominio.com.ar
```

**Reglas**:
- Nunca prefijo `VITE_*` para secretos (AP-13).
- Nunca commit de `.env*` (sólo `.env.example` con descripción + valor vacío).
- Si una key se commiteó por accidente: rotarla inmediatamente y documentar el incidente.

---

## Sección 13 — Troubleshooting común

### "ARCA me devuelve `[10015] DocNro inválido`"
1. Verificar que el receptor del comprobante tenga `tipo='cuit'` con número de 11 dígitos exactos (regex `^\d{11}$`).
2. Si tiene `dni_ficticio` o `cf` → `calcDoc` debe mapear a docTipo=99, docNro=0.
3. Verificar `arca_request_xml` del último intento — ver qué se mandó realmente.

### "El cron ARCA no procesa nada"
1. Verificar `SELECT cron.jobname, schedule, active FROM cron.job WHERE jobname LIKE '%arca%';`
2. Ver últimas ejecuciones: `SELECT * FROM cron.job_run_details WHERE jobname='dispatch-arca-emission-every-min' ORDER BY start_time DESC LIMIT 10;`
3. ¿Hay jobs pending con scheduled_at <= now()? `SELECT count(*) FROM arca_emision_queue WHERE status='pending' AND scheduled_at <= now();`
4. ¿Edge fn responde? `curl -X POST https://xxx.supabase.co/functions/v1/dispatch-arca-emission -H "Authorization: Bearer $ANON_KEY"`
5. Si watchdog está reseteando jobs: `SELECT * FROM lote_arca_anomalias_notificadas WHERE tipo='watchdog_actuo' ORDER BY notificado_at DESC LIMIT 5;`

### "Email queda en `pending` y nunca sale"
1. `SELECT scheduled_at, status, attempts, last_error FROM email_queue WHERE id = 'xxx';`
2. ¿`scheduled_at` ya pasó? Sino, throttle global lo está reteniendo (5 min).
3. ¿`attempts >= max_attempts`? Marcar fallido manual o reintentar.
4. Probar `dispatch-email-queue` manualmente.
5. Verificar `RESEND_API_KEY` con `curl https://api.resend.com/emails -H "Authorization: Bearer $RESEND_API_KEY"`.

### "Webhook Resend no llega"
1. Verificar URL configurada en Resend dashboard apunta a `/functions/v1/resend-webhook`.
2. Verificar secret Svix coincide con `RESEND_WEBHOOK_SECRET` en edge.
3. Logs de la edge en Supabase Studio.
4. Si la edge no encuentra el `resend_id` en `sent_emails` → es porque marcamos sent_email DESPUÉS del POST a Resend; race con webhook ultra-rápido. Solución: usar `apply_resend_event` que tolera el caso (devuelve `applied=false` si no encuentra).

### "ZIP de email > 40 MB y Resend rechaza"
1. Splitter debería haber actuado. Verificar: `SELECT id, parte, partes_total, status, zip_size_bytes FROM email_queue WHERE id='xxx';`
2. Si `partes_total=1` y `status='too_large'` → el splitter no pudo (ej: 1 comp único > 38 MB). Resolver manual.
3. Si querés re-splitear un job too_large: `UPDATE email_queue SET status='pending' WHERE id='xxx';` (mig 0122 lo permite).

### "Cert ARCA dice `cert_key_match=false`"
1. Cert y key no son del mismo par. Volver a generar CSR (esto regenera la key) y firmarlo de nuevo.
2. O: el cert es de homologación y la key de producción (o viceversa). Switch en config.

### "Comprobante quedó en `procesando` para siempre"
1. P-ARCA-03: si la red se cortó mid-vuelo, ARCA puede tener el CAE pero no nos contestó.
2. Llamar `FECompConsultar(cbteTipo, ptoVta, cbteNro)` y reconciliar.
3. Si AFIP tiene CAE → marcar como `autorizado` con ese CAE.
4. Si no tiene → marcar como `error` y permitir reintento con nuevo número.

---

## Sección 14 — Cierre

Si llegaste hasta acá: ya tenés todo el bagaje. Encara la fase 0 con foco en boundaries (RLS, helpers, naming) y vas a llegar a producción **sin repetir las 50+ migraciones de prueba-error de MANAXER**.

**Reglas no negociables que tenés que poder citar de memoria**:
1. RPCs `SECURITY DEFINER` con `assert_empresa_access` al inicio (regla 12 CLAUDE.md).
2. Toda FK con su índice en la misma migración (regla 11).
3. EXPLAIN ANALYZE antes de exponer RPC al frontend (regla 11).
4. Defensa en 3 capas para AFIP/Resend (regla 1, E41).
5. Cola persistida + cron + Realtime, NO client loops (regla 1, D01).
6. Throttle global hardcoded 5 min para email (D05, E42).
7. Naming consistente, verificar columnas existentes con `information_schema` antes de tocar tabla vieja (E43, E46).
8. Edge functions versionadas en `supabase/functions/<name>/index.ts` + deploy CLI (regla 7, E13, AP-14).
9. Policies RLS con `DROP POLICY IF EXISTS; CREATE POLICY ...` (E04, AP-11).
10. Idempotency-Key en POST a Resend, dedup por `(resend_id, type, at)` en webhook (D09).

Si dudás entre dos caminos, preguntá al usuario citando el patrón aplicable. Si el bug ya pasó, citá el `E##` correspondiente.

Hechas estas, ya estás en condiciones de implementar la ventana "Facturador" en Administración Virtual sin sorpresas. Buena suerte.
