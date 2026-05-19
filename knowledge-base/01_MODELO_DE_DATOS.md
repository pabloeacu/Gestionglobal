# 01 · Modelo de datos completo

> Schema íntegro de MANAXER, transferible a Gestión Global. Toda tabla, FK, CHECK, índice, trigger, RLS y RPC documentado. La meta: armar las migraciones sin adivinar.

---

## 1. El modelo de negocio

### Jerarquía multi-tenant

```
empresas (raíz tenant — "Gestión Global" es 1 fila)
   └── administraciones (el cliente)
          └── edificios (el consorcio facturado)
                 └── comprobantes (factura mensual del abono)
```

- Todo dato sensible lleva `empresa_id` (FK indexada) y está aislado por RLS.
- `administraciones` = el cliente de Gestión Global. Puede tener `user_id` (si el administrador entra a ver lo suyo).
- `edificios` = consorcio. Pertenece a 1 administración. Tiene un `monto_abono` mensual.

### Edificio CON CUIT vs SIN CUIT (decisión D07)

`edificios.tipo_documento` IN (`'cuit'`, `'dni_ficticio'`):
- **Con CUIT**: el consorcio es responsable inscripto o tiene CUIT propio. `numero_documento` = CUIT 11 dígitos.
- **Sin CUIT**: la mayoría. Se le asigna un **DNI ficticio secuencial** del rango `99000001+`. Lo consume el contador `empresas.proximo_dni_ficticio` vía el trigger `asignar_dni_ficticio()` al insertar el edificio sin documento. ARCA NO acepta receptor vacío — el DNI ficticio resuelve esto sin inventar datos reales.

CHECK que lo blinda (capa DB, ver E41):
```sql
CONSTRAINT chk_edificios_documento_formato CHECK (
  (tipo_documento = 'cuit' AND numero_documento ~ '^\d{11}$')
  OR (tipo_documento = 'dni_ficticio' AND numero_documento ~ '^\d{7,8}$')
)
```

### Facturar AL EDIFICIO vs A LA ADMINISTRACIÓN

Flag `edificios.facturar_con_cuit_administracion boolean DEFAULT false`:
- **FALSE** (default): el comprobante sale con CUIT/DNI ficticio + nombre del **edificio**.
- **TRUE**: el comprobante sale con CUIT + razón social de la **administración**. Sirve para edificios sin CUIT propio que se facturan "bajo" la administración.

El comprobante guarda **snapshot del receptor** al momento de emitir (`receptor_razon_social`, `receptor_tipo_documento`, `receptor_numero_documento`, `receptor_condicion_iva`) + `administracion_id` snapshot. **Cambiar de administración después NO reescribe comprobantes históricos** (D06).

### Multi-tenancy: cómo aísla

- Toda tabla con dato sensible: `empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE`, indexada.
- RLS usa helpers `SECURITY DEFINER STABLE`: `current_empresa_id()`, `is_apex()`, `assert_empresa_access(uuid)`.
- **Regla 12**: toda RPC SECURITY DEFINER que reciba `p_empresa_id` llama `assert_empresa_access(p_empresa_id)` al inicio. Sin eso = cross-tenant trivial (E45, E49).

---

## 2. Tabla base obligatoria (P-DB-01)

TODA tabla de negocio tiene:
```sql
id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
-- ... columnas de negocio ...
created_at  timestamptz NOT NULL DEFAULT now(),
updated_at  timestamptz NOT NULL DEFAULT now(),
created_by  uuid REFERENCES public.profiles(id) ON DELETE SET NULL
-- + trigger BEFORE UPDATE → touch_updated_at()
```
Esto previene E02 (columna `updated_at` que no existe). Nunca asumir, siempre verificar con `information_schema.columns` antes de tocar tabla existente (E43).

---

## 3. Schema tabla por tabla

### profiles (espejo de auth.users)
```sql
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'administrador'
    CHECK (role IN ('apex','partner','pulse','administrador')),
  empresa_id uuid REFERENCES public.empresas(id) ON DELETE SET NULL,
  administracion_id uuid REFERENCES public.administraciones(id) ON DELETE SET NULL,
  full_name text, phone text, avatar_url text,
  activo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- Índices: idx_profiles_role, idx_profiles_empresa_id, idx_profiles_administracion_id
-- Trigger handle_new_user (AFTER INSERT auth.users) → inserta profile con email como full_name
-- RLS: ve su propio profile; APEX ve todo; PARTNER ve pulse/admin de su empresa
```

**Roles**:
- `apex` — acceso total a todas las empresas (soporte/owner).
- `partner` — gerente de UNA empresa. Crea/edita usuarios `pulse` bajo su empresa.
- `pulse` — operativo, permisos granulares por menú (tabla `pulse_permissions`).
- `administrador` — gestor de UNA administración, ve sólo lo de su `administracion_id`.

### empresas (raíz tenant)
```sql
CREATE TABLE public.empresas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre text NOT NULL UNIQUE,
  razon_social text NOT NULL,
  cuit text NOT NULL UNIQUE CHECK (cuit ~ '^\d{11}$'),
  condicion_iva text NOT NULL DEFAULT 'responsable_inscripto'
    CHECK (condicion_iva IN ('responsable_inscripto','monotributo','exento')),
  domicilio_fiscal text, localidad text, provincia text, codigo_postal text,
  email_contacto text, telefono text, logo_url text,
  email_remitente_nombre text, email_reply_to text,
  proximo_dni_ficticio bigint NOT NULL DEFAULT 99000001
    CHECK (proximo_dni_ficticio BETWEEN 99000001 AND 99999999),
  arca_intervalo_emision_seg integer DEFAULT 3600,
  activo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);
-- Trigger seed_cajas_default (AFTER INSERT) → seedea 4 cajas (banco, billetera, plazo fijo, efectivo)
-- RLS: APEX | id = current_empresa_id()
```

### administraciones (el cliente)
```sql
CREATE TABLE public.administraciones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  codigo text NOT NULL,
  nombre text NOT NULL,
  responsable_nombre text, responsable_apellido text,
  cuit text CHECK (cuit IS NULL OR cuit ~ '^\d{11}$'),
  condicion_iva text CHECK (condicion_iva IS NULL OR condicion_iva IN
    ('consumidor_final','responsable_inscripto','monotributo','exento')),
  direccion text, localidad text, provincia text, codigo_postal text,
  telefono text, email text, horarios text, foto_url text, observaciones text,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  activo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  CONSTRAINT uq_administraciones_empresa_codigo UNIQUE (empresa_id, codigo),
  CONSTRAINT uq_administraciones_empresa_nombre UNIQUE (empresa_id, nombre)
);
-- uq_administraciones_user_id UNIQUE WHERE user_id NOT NULL
-- idx_administraciones_empresa_activo
-- Triggers: touch_updated_at, audit_row
-- RLS: APEX | PARTNER(empresa) | PULSE(empresa+clientes) | ADMINISTRADOR(self)
```

### edificios (el consorcio)
```sql
CREATE TABLE public.edificios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  administracion_id uuid NOT NULL REFERENCES public.administraciones(id) ON DELETE RESTRICT,
  codigo text NOT NULL,
  nombre text NOT NULL,
  nombre_normalizado text NOT NULL,            -- lower(unaccent(nombre)) para fuzzy
  unidades int NOT NULL DEFAULT 0 CHECK (unidades >= 0),
  cocheras int NOT NULL DEFAULT 0 CHECK (cocheras >= 0),
  bauleras int NOT NULL DEFAULT 0 CHECK (bauleras >= 0),
  empleados int NOT NULL DEFAULT 0 CHECK (empleados >= 0),
  tipo_documento text NOT NULL CHECK (tipo_documento IN ('cuit','dni_ficticio')),
  numero_documento text NOT NULL,
  condicion_iva text NOT NULL DEFAULT 'consumidor_final'
    CHECK (condicion_iva IN ('consumidor_final','responsable_inscripto')),
  domicilio text, provincia text, localidad text, codigo_postal text,
  monto_abono numeric(12,2) NOT NULL DEFAULT 0 CHECK (monto_abono >= 0),
  activo boolean NOT NULL DEFAULT true,
  facturar_con_cuit_administracion boolean NOT NULL DEFAULT false,
  observaciones text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  CONSTRAINT uq_edificios_administracion_codigo UNIQUE (administracion_id, codigo),
  CONSTRAINT chk_edificios_documento_formato CHECK (
    (tipo_documento='cuit' AND numero_documento ~ '^\d{11}$')
    OR (tipo_documento='dni_ficticio' AND numero_documento ~ '^\d{7,8}$')
  )
);
-- uq_edificios_empresa_cuit UNIQUE WHERE tipo_documento='cuit'
-- idx_edificios_administracion_activo, idx_edificios_empresa
-- idx_edificios_nombre_normalizado_trgm GIN pg_trgm   (fuzzy match conciliación)
-- Triggers:
--   touch_updated_at
--   normalize_edificio_nombre (BEFORE INS/UPD nombre) → nombre_normalizado = lower(immutable_unaccent(nombre))
--   asignar_dni_ficticio (BEFORE INSERT) → si sin documento, consume empresas.proximo_dni_ficticio
--   audit_row
-- RLS: APEX | PARTNER(empresa) | PULSE(empresa+clientes) | ADMINISTRADOR(su administracion)
```

### comprobantes
```sql
CREATE TABLE public.comprobantes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  edificio_id uuid NOT NULL REFERENCES public.edificios(id) ON DELETE RESTRICT,
  administracion_id uuid REFERENCES public.administraciones(id) ON DELETE SET NULL, -- SNAPSHOT
  tipo text NOT NULL CHECK (tipo IN ('A','B','C','X','NC_A','NC_B','NC_C','ND_A','ND_B','ND_C')),
  punto_venta int NOT NULL,
  numero int,                                  -- NULL hasta autorizar
  fecha date NOT NULL,
  periodo date NOT NULL,                        -- primer día del mes
  concepto text NOT NULL DEFAULT 'servicios'
    CHECK (concepto IN ('productos','servicios','productos_servicios')),
  -- Receptor: SNAPSHOT al emitir
  receptor_razon_social text NOT NULL,
  receptor_tipo_documento text NOT NULL,
  receptor_numero_documento text NOT NULL,
  receptor_condicion_iva text NOT NULL,
  receptor_domicilio text,
  -- Montos
  neto numeric(14,2) NOT NULL DEFAULT 0 CHECK (neto >= 0),
  no_gravado numeric(14,2) NOT NULL DEFAULT 0 CHECK (no_gravado >= 0),
  exento numeric(14,2) NOT NULL DEFAULT 0 CHECK (exento >= 0),
  iva_21 numeric(14,2) NOT NULL DEFAULT 0 CHECK (iva_21 >= 0),
  iva_105 numeric(14,2) NOT NULL DEFAULT 0 CHECK (iva_105 >= 0),
  iva_27 numeric(14,2) NOT NULL DEFAULT 0 CHECK (iva_27 >= 0),
  impuestos_internos numeric(14,2) NOT NULL DEFAULT 0 CHECK (impuestos_internos >= 0),
  total numeric(14,2) NOT NULL DEFAULT 0 CHECK (total >= 0),
  moneda text NOT NULL DEFAULT 'ARS' CHECK (moneda IN ('ARS','USD')),
  cotizacion numeric(12,4) NOT NULL DEFAULT 1,
  estado text NOT NULL DEFAULT 'borrador'
    CHECK (estado IN ('borrador','autorizado','rechazado','anulado')),
  cae text, cae_vencimiento date, arca_observaciones jsonb,
  arca_request_xml text, arca_response_xml text,    -- debug SOAP, TTL 30d (E37/D08)
  comprobante_asociado_id uuid REFERENCES public.comprobantes(id) ON DELETE SET NULL, -- NC/ND
  lote_facturacion_id uuid,
  pdf_url text, email_enviado_at timestamptz, email_envios_count int NOT NULL DEFAULT 0,
  origen text CHECK (origen IN ('manaxer','previo_a_manaxer')),  -- adaptar: 'gestion_global'/'previo'
  gestion_cobranza text,
  receptor_doc_tipo_enviado smallint CHECK (receptor_doc_tipo_enviado IN (80,96,99)), -- E41 auditoría
  observaciones text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  CONSTRAINT uq_comprobantes_pv_numero UNIQUE (empresa_id, punto_venta, tipo, numero)
);
-- Índices: idx_comprobantes_empresa_estado, idx_comprobantes_lote,
--          idx_comprobantes_edificio_periodo, idx_comprobantes_admin_fecha
-- uq_comprobantes_solo_manaxer: UNIQUE(empresa_id,punto_venta,tipo,numero)
--   WHERE numero IS NOT NULL AND origen <> 'previo_a_manaxer'
-- Triggers: touch_updated_at, recalcular_totales (desde items)
-- RLS: APEX | PARTNER(empresa) | PULSE(empresa+facturacion) | ADMINISTRADOR(empresa+su admin)
-- Storage bucket 'comprobantes-pdf' (privado), path {empresa_id}/{comprobante_id}.pdf
```

### items_comprobantes
```sql
CREATE TABLE public.items_comprobantes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  comprobante_id uuid NOT NULL REFERENCES public.comprobantes(id) ON DELETE CASCADE,
  orden int NOT NULL DEFAULT 0,
  descripcion text NOT NULL,
  cantidad numeric(14,2) NOT NULL DEFAULT 1 CHECK (cantidad > 0),
  precio_unitario numeric(14,2) NOT NULL CHECK (precio_unitario >= 0),
  bonificacion_porc numeric(5,2) NOT NULL DEFAULT 0 CHECK (bonificacion_porc BETWEEN 0 AND 100),
  alicuota_iva text NOT NULL DEFAULT '21'
    CHECK (alicuota_iva IN ('0','10.5','21','27','exento','no_gravado')),
  subtotal numeric(14,2) NOT NULL DEFAULT 0,
  iva numeric(14,2) NOT NULL DEFAULT 0,
  total numeric(14,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- Trigger calcular_item (BEFORE INS/UPD) calcula subtotal/iva/total
-- Trigger recalcular_totales_comprobante (AFTER INS/UPD/DEL) actualiza el comprobante
-- IMPORTANTE E38: precios con coma decimal — parsear con replace(',','.') antes de Number()
```

### numeradores
```sql
CREATE TABLE public.numeradores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  punto_venta int NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('A','B','C','X','NC_A','NC_B','NC_C','ND_A','ND_B','ND_C')),
  ultimo_numero int NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_numeradores UNIQUE (empresa_id, punto_venta, tipo)
);
```

### lotes_facturacion
```sql
CREATE TABLE public.lotes_facturacion (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  periodo date NOT NULL,
  descripcion text,
  estado text NOT NULL DEFAULT 'abierto'
    CHECK (estado IN ('abierto','autorizando','cerrado','cancelado')),
  tipo_default text NOT NULL DEFAULT 'X' CHECK (tipo_default IN ('A','B','C','X')),
  punto_venta int NOT NULL DEFAULT 1,
  total_comprobantes int NOT NULL DEFAULT 0,
  total_autorizados int NOT NULL DEFAULT 0,
  total_monto numeric(14,2) NOT NULL DEFAULT 0,
  envio_estado text,
  log jsonb NOT NULL DEFAULT '[]'::jsonb,         -- timeline de eventos
  cerrado_at timestamptz, cerrado_por uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  observaciones text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);
-- comprobantes.lote_facturacion_id → este (ON DELETE SET NULL)
```

### empresa_arca_config
```sql
CREATE TABLE public.empresa_arca_config (
  empresa_id uuid PRIMARY KEY REFERENCES public.empresas(id) ON DELETE CASCADE,
  ambiente text NOT NULL DEFAULT 'homologacion' CHECK (ambiente IN ('homologacion','produccion')),
  punto_venta int NOT NULL DEFAULT 1 CHECK (punto_venta > 0),
  cert_path text, key_path text, cert_uploaded_at timestamptz, cert_vencimiento timestamptz,
  ta_token text, ta_sign text, ta_expires_at timestamptz,    -- cache WSAA (P-ARCA-01)
  ultimo_test_at timestamptz, ultimo_test_ok boolean, ultimo_test_msg text,
  arca_intervalo_emision_seg int NOT NULL DEFAULT 15 CHECK (BETWEEN 5 AND 120),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- RLS: APEX | PARTNER(empresa). PULSE NO (datos fiscales sensibles).
-- Storage bucket 'arca-certs' (privado), {empresa_id}/cert.pem y key.pem
```

### cajas
```sql
CREATE TABLE public.cajas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  nombre text NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('banco','billetera_virtual','plazo_fijo','efectivo')),
  moneda text NOT NULL DEFAULT 'ARS' CHECK (moneda IN ('ARS','USD')),
  cbu text, alias text, numero_cuenta text, banco_entidad text,
  color text, icono text, orden int NOT NULL DEFAULT 0,
  activo boolean NOT NULL DEFAULT true, observaciones text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  CONSTRAINT uq_cajas_empresa_nombre UNIQUE (empresa_id, nombre)
);
-- Seeded por trigger seed_cajas_default on empresas
-- VIEW cajas_con_saldo: c.* + SUM(movimientos identificados) AS saldo + COUNT(pendientes)
```

### categorias_finanzas
```sql
CREATE TABLE public.categorias_finanzas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  nombre text NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('ingreso','egreso','ambos')),
  color text, icono text, activo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  CONSTRAINT uq_categorias_empresa_nombre UNIQUE (empresa_id, nombre)
);
-- Sembrar una categoría "Gastos bancarios" por empresa (la usa identificar_como_gasto_bancario)
```

### movimientos
```sql
CREATE TABLE public.movimientos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  caja_id uuid NOT NULL REFERENCES public.cajas(id) ON DELETE RESTRICT,
  fecha date NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('ingreso','egreso','transferencia_in','transferencia_out')),
  monto numeric(14,2) NOT NULL CHECK (monto > 0),
  categoria_id uuid REFERENCES public.categorias_finanzas(id) ON DELETE SET NULL,
  descripcion text, referencia text, adjunto_url text,
  administracion_id uuid REFERENCES public.administraciones(id) ON DELETE SET NULL,
  edificio_id uuid REFERENCES public.edificios(id) ON DELETE SET NULL,
  comprobante_id uuid REFERENCES public.comprobantes(id) ON DELETE RESTRICT,
  transferencia_pair_id uuid,                  -- liga las 2 patas de una transferencia
  hash_dedup text,                             -- dedup conciliación (UNIQUE parcial WHERE NOT NULL)
  estado text NOT NULL DEFAULT 'identificado'
    CHECK (estado IN ('pendiente_id','identificado','anulado')),
  motivo_pendiente text,
  origen text NOT NULL DEFAULT 'manual'
    CHECK (origen IN ('manual','conciliacion_auto','facturacion','ajuste','historico_banco')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);
-- idx_mov_caja_fecha, idx_mov_empresa_fecha, idx_mov_estado_pendiente (WHERE pendiente_id),
-- idx_mov_transferencia (WHERE pair NOT NULL), idx_mov_admin (WHERE admin NOT NULL),
-- idx_mov_comprobante (comprobante_id WHERE NOT NULL)  ← E48: FK necesita índice
-- uq_movimientos_hash_dedup UNIQUE(hash_dedup) WHERE hash_dedup IS NOT NULL
-- Trigger trg_aprender_movimiento_manual (ver sección 5)
```

### movimiento_imputaciones (corazón contable)
```sql
CREATE TABLE public.movimiento_imputaciones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  movimiento_id uuid NOT NULL REFERENCES public.movimientos(id) ON DELETE CASCADE,
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  comprobante_id uuid REFERENCES public.comprobantes(id) ON DELETE RESTRICT,
  administracion_id uuid REFERENCES public.administraciones(id) ON DELETE RESTRICT,
  monto_imputado numeric(14,2) NOT NULL CHECK (monto_imputado > 0),
  nota text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  CONSTRAINT chk_imp_destino_xor CHECK (
    (comprobante_id IS NOT NULL AND administracion_id IS NULL)
    OR (comprobante_id IS NULL AND administracion_id IS NOT NULL)
  )
);
-- idx_imputaciones_movimiento, idx_imputaciones_comprobante (WHERE NOT NULL),
-- idx_imputaciones_admin (admin, created_at DESC WHERE NOT NULL), idx_imputaciones_empresa
-- Realtime publication
-- INVARIANTE: para todo movimiento, SUM(imputaciones del mov) == mov.monto. Siempre.
--   El "saldo PAC disponible" se DERIVA de esto, no se almacena → cero sync drift.
--   (ver doc 03 sección PACs)
```

### Conciliación: extractos_bancarios + extractos_lineas + patrones
Schema completo en **doc 03** (es el subsistema de conciliación). Resumen de las 4 tablas:
- `extractos_bancarios` — cabecera del Excel subido + contadores por match_type + estado + borrador.
- `extractos_lineas` — 1 fila por línea del banco, con `match_type`, `decision`, `decision_payload`.
- `patrones_conciliacion_aprendidos` — motor para ingresos (cobranzas/PACs). Frase normalizada → destino.
- `patrones_egreso_categoria` — motor para egresos (gastos). Patrón ILIKE → categoría.

### sent_emails / email_queue / push_*
Schema completo en **doc 02** (emails) y **doc 04** (push). Nota de naming híbrido (E43): es `sent_emails.enviado_at` y `.asunto`, NO `sent_at`/`subject`.

### auditoria_cambios (desde día 1 — D10)
```sql
CREATE TABLE public.auditoria_cambios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  empresa_id uuid REFERENCES public.empresas(id) ON DELETE SET NULL,
  entidad text NOT NULL, entidad_id uuid,
  operacion text NOT NULL CHECK (operacion IN ('INSERT','UPDATE','DELETE')),
  diff jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- Trigger audit_row() en empresas, profiles, pulse_permissions, administraciones,
--   edificios, comprobantes. Insert-only. RLS: SELECT APEX|PARTNER(empresa)
```

### pulse_permissions (permisos granulares)
```sql
CREATE TABLE public.pulse_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  menu text NOT NULL CHECK (menu IN
    ('clientes','control_abonos','finanzas','facturacion','conciliacion','reportes','analytics','configuracion')),
  can_view boolean NOT NULL DEFAULT false,
  can_operate boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  CONSTRAINT uq_pulse_permissions_profile_menu UNIQUE (profile_id, menu),
  CONSTRAINT chk_operate_requires_view CHECK (can_operate = false OR can_view = true)
);
-- Helpers SECURITY DEFINER STABLE: pulse_can_view(menu), pulse_can_operate(menu)
```

### administracion_periodo_snapshots (cierre de lote)
```sql
CREATE TABLE public.administracion_periodo_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  administracion_id uuid NOT NULL REFERENCES public.administraciones(id) ON DELETE CASCADE,
  periodo date NOT NULL,
  edificios_facturados int NOT NULL,
  lote_facturacion_id uuid REFERENCES public.lotes_facturacion(id) ON DELETE SET NULL,
  nota text, cerrado_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_admin_periodo UNIQUE (administracion_id, periodo)
);
-- Lo crea cerrar_lote() al cerrar un lote de facturación
```

---

## 4. Helpers RLS (crear una vez, en 0002)

```sql
get_user_role()              -- STABLE: role del profile actual
is_apex() / is_partner() / is_pulse() / is_administrador()  -- boolean
current_empresa_id()         -- uuid | NULL (empresa del profile)
current_administracion_id()  -- uuid | NULL
can_access_empresa(uuid)     -- APEX true, sino == current_empresa_id()
assert_empresa_access(uuid)  -- RAISE 42501 si no es apex y uuid != current_empresa_id()
pulse_can_view(menu) / pulse_can_operate(menu)  -- consulta pulse_permissions
```

Todos `SECURITY DEFINER STABLE SET search_path = public, pg_temp` (evita recursión RLS — P-DB-05).

### Patrón RLS estándar (toda tabla con empresa_id)
```sql
-- SELECT
USING (
  is_apex()
  OR (is_partner() AND empresa_id = current_empresa_id())
  OR (is_pulse() AND empresa_id = current_empresa_id() AND pulse_can_view('<menu>'))
  OR (is_administrador() AND empresa_id = current_empresa_id()
      AND administracion_id = current_administracion_id())
)
-- INSERT/UPDATE/DELETE: igual pero pulse_can_operate('<menu>') y sin la rama administrador
```
Policies SIEMPRE con `DROP POLICY IF EXISTS "x" ON t; CREATE POLICY "x" ...` (E04, AP-11). Nunca `IF NOT EXISTS`.

---

## 5. Triggers de negocio

| Trigger | Tabla / cuándo | Qué hace |
|---------|----------------|----------|
| `handle_new_user` | AFTER INSERT auth.users | Crea fila en `profiles` (role='administrador', email→full_name) |
| `touch_updated_at` | BEFORE UPDATE (todas) | `updated_at = now()` |
| `seed_cajas_default` | AFTER INSERT empresas | Seedea 4 cajas default |
| `normalize_edificio_nombre` | BEFORE INS/UPD edificios.nombre | `nombre_normalizado = lower(immutable_unaccent(nombre))` |
| `asignar_dni_ficticio` | BEFORE INSERT edificios | Si sin documento → consume `empresas.proximo_dni_ficticio` |
| `calcular_item` | BEFORE INS/UPD items | subtotal/iva/total del ítem |
| `recalcular_totales_comprobante` | AFTER INS/UPD/DEL items | neto/iva_*/total del comprobante |
| `trg_aprender_movimiento_manual` | AFTER INS/UPD movimientos WHEN (descripcion NOT NULL AND (edificio_id OR administracion_id OR (tipo='egreso' AND categoria_id))) | **Motor de aprendizaje** — 2 ramas: cobranzas/PACs → `patrones_conciliacion_aprendidos`; gastos → `patrones_egreso_categoria` (ver doc 03, E52) |
| `trg_limpiar_borrador_al_aplicar` | BEFORE UPDATE extractos_bancarios.estado | Al pasar a 'aplicado', limpia flag de borrador |
| `audit_row` | AFTER INS/UPD/DEL (tablas sensibles) | Inserta diff en `auditoria_cambios` |

---

## 6. RPCs clave (firmas)

Multi-tabla → siempre RPC `SECURITY DEFINER SET search_path = public, pg_temp` + `assert_empresa_access` al inicio (regla 5, 12). Detalle de cuerpos en docs 02/03.

```
-- Facturación
autorizar_comprobante_manual(comprobante_id) → (numero, punto_venta, tipo)
crear_lote_desde_activos(empresa_id, periodo, tipo_default?, descripcion?) → (lote_id, total)
crear_lote_desde_planilla(empresa_id, periodo, filas jsonb, ...) → (lote_id, total, ...)
simular_lote_desde_planilla(...) → categoriza filas OK/VERIFICAR/FALTA_EDIFICIO/...
cerrar_lote(lote_id) → (snapshots_creados, edificios_desactivados)
crear_nota_credito(comprobante_id, modo, monto?, motivo?) → (nc_id)
borrar_comprobante(comprobante_id) → modo 'borrado'|'anulado' (E40)

-- Conciliación / movimientos
procesar_extracto_chunk(extracto_id?, empresa_id, caja_id, archivo, chunk_idx, chunks_total, rows, es_ultimo)
aplicar_conciliacion_v2(extracto_id, decisiones jsonb) → (movimientos_creados, imputaciones, pendientes, rechazadas)
rematch_lineas_extracto(extracto_id, lineas_ids)
guardar_borrador_conciliacion / descartar_borrador_conciliacion
revertir_extracto(extracto_id) → (movimientos_borrados, lineas_reseteadas)
identificar_como_pac(mov_id, admin_id, categoria_id?)
identificar_como_gasto_bancario(mov_id, categoria_id?)
pacs_disponibles(empresa_id, admin_id?) / facturas_pendientes_de_admin(admin_id)
aplicar_pac_a_comprobantes(mov_id, 'auto'|'manual', aplicaciones?)
deshacer_imputacion_pac(imputacion_id)

-- Email / push
enqueue_email_individual(empresa_id, to, subject, html, ..., scheduled_at_override?)
enqueue_envios_lote(lote_id, intervalo_min) / next_email_slot(empresa_id)
upsert_push_subscription(...) / claim_pending_pushes(max)

-- Reportes / dashboard
dashboard_kpis / dashboard_morosidad / dashboard_top_morosos / dashboard_cash_flow / ...
recupero_pagos_recibidos(empresa_id, desde, hasta, admin_id?)
```

---

## 7. Storage buckets

| Bucket | Privacidad | Path | Contenido |
|--------|-----------|------|-----------|
| `comprobantes-pdf` | privado | `{empresa_id}/{comprobante_id}.pdf` | PDFs pre-generados para envío masivo |
| `arca-certs` | privado (APEX/PARTNER only) | `{empresa_id}/cert.pem`, `key.pem` | Certificados ARCA |
| `email-assets` | público + CORS | `{empresa_id}/{uuid}.{ext}` | Imágenes embebidas en plantillas |
| `avatars` | semiprivado | `{profile_id}.jpg` | Fotos de perfil. Ojo E11: deducir contentType por extensión (iOS HEIC) |

---

## 8. Convenciones (no romper)

- **Naming**: inglés en schema/BD/APIs, español en copy UI. Excepción: tablas con naming híbrido heredado (`enviado_at`, `asunto`, `nota`). Antes de RPC sobre tabla existente: `SELECT column_name FROM information_schema.columns WHERE table_name='...'` (E43/E46).
- **Tabla base**: `id`/`created_at`/`updated_at`/`created_by` + trigger touch (P-DB-01).
- **CHECK en lugar de ENUM nativo**, salvo dominios estables. Todo CHECK nuevo → documentar valores en constante TS compartida (E01).
- **FK siempre con índice** en la misma migración (E48, regla 11).
- **Migración segura** (P-DB-06): `BEGIN`/`COMMIT`, `IF NOT EXISTS` para tablas/cols, `IF EXISTS` para drops, policies DROP+CREATE, RPC `SECURITY DEFINER + SET search_path + GRANT`.
- **Regenerar types** tras toda migración: `bash scripts/generate-types.sh` antes de pushear (sino Vercel rompe).

Seguí con el doc 02 (facturación + ARCA + emails).
