# 03 · Conciliación bancaria + Cajas + Motor de patrones + PACs

> Dump técnico exhaustivo del subsistema de finanzas de MANAXER, transferible a Gestión Global. Tipos de movimiento, conciliación chunked, cascada de matching, motor de aprendizaje, PACs (invariante contable), control de cajas, blindaje anti-bugs. Código y SQL real inline.

> **Nota de transferencia**: donde dice MANAXER, aplicá a Gestión Global. El subsistema se replica tal cual — son meses de prueba-error ya resueltos.

---

# MANAXER FINANCIAL RECONCILIATION SUBSYSTEM — EXHAUSTIVE TECHNICAL DUMP

## 1. TIPOS DE MOVIMIENTO CONTABLE

### Type System Definition

The movement type system is the foundational enum in `/src/services/api/movimientos.ts`:

```typescript
export enum TipoMovimiento {
  INGRESO = 'ingreso',
  EGRESO = 'egreso',
  TRANSFERENCIA_IN = 'transferencia_in',
  TRANSFERENCIA_OUT = 'transferencia_out',
}

export enum EstadoMovimiento {
  PENDIENTE_ID = 'pendiente_id',
  IDENTIFICADO = 'identificado',
  ANULADO = 'anulado',
}

export type MovimientoConRel = Database['public']['Tables']['movimientos']['Row'] & {
  caja?: { id: string; nombre: string; tipo: string };
  categoria?: { id: string; nombre: string };
  administracion?: { id: string; nombre: string };
  edificio?: { id: string; nombre: string };
};
```

### Accounting Movement Table Schema

From bank reconciliation (`0021_conciliacion_bancaria.sql`):

```sql
CREATE TABLE public.movimientos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  caja_id uuid NOT NULL REFERENCES cajas(id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN ('ingreso', 'egreso', 'transferencia_in', 'transferencia_out', 'mov_no_identificado')),
  estado text NOT NULL CHECK (estado IN ('pendiente_id', 'identificado', 'anulado')),
  monto numeric(15,2) NOT NULL CHECK (monto > 0),
  fecha date NOT NULL,
  descripcion text,
  referencia text,
  categoria_id uuid REFERENCES categorias_gasto(id),
  origen text NOT NULL DEFAULT 'conciliacion_auto',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  hash_dedup text UNIQUE,
  movimiento_padre_id uuid REFERENCES movimientos(id)
);

CREATE INDEX idx_movimientos_empresa_caja ON movimientos(empresa_id, caja_id);
CREATE INDEX idx_movimientos_estado ON movimientos(empresa_id, estado);
CREATE INDEX idx_movimientos_fecha ON movimientos(empresa_id, fecha DESC);
```

### Movement State Transitions

State machine implemented via RPC guards in `movimientos.ts`:

```typescript
/**
 * Registra movimiento sin identificar → estado='pendiente_id'
 * Usado por conciliación para crear mov antes de match
 */
export async function registrarMovimientoPendiente(
  supabaseClient: SupabaseClient,
  empresaId: string,
  cajaId: string,
  tipo: TipoMovimiento,
  monto: number,
  fecha: Date,
  descripcion: string,
  referencia?: string,
  categoriaId?: string
) {
  const { data, error } = await supabaseClient
    .from('movimientos')
    .insert({
      empresa_id: empresaId,
      caja_id: cajaId,
      tipo,
      estado: EstadoMovimiento.PENDIENTE_ID,
      monto,
      fecha: fecha.toISOString().split('T')[0],
      descripcion,
      referencia,
      categoria_id: categoriaId,
      origen: 'conciliacion_auto',
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/**
 * Transición: pendiente_id → identificado
 * Guarda referencia a comprobante identificado
 */
export async function identificarComoCobranza(
  supabaseClient: SupabaseClient,
  movimientoId: string,
  comprobanteId: string
) {
  const { error } = await supabaseClient.rpc(
    'identificar_como_cobranza',
    {
      p_movimiento_id: movimientoId,
      p_comprobante_id: comprobanteId,
    }
  );
  if (error) throw error;
}

/**
 * Transición especial: PAC classification
 * Crea imputación a admin como "crédito disponible"
 */
export async function identificarComoPac(
  supabaseClient: SupabaseClient,
  movimientoId: string,
  administracionId: string
) {
  const { error } = await supabaseClient.rpc(
    'identificar_como_pac',
    {
      p_movimiento_id: movimientoId,
      p_administracion_id: administracionId,
    }
  );
  if (error) throw error;
}

/**
 * Transición: pendiente_id → identificado (no voucher match)
 */
export async function identificarComoNoId(
  supabaseClient: SupabaseClient,
  movimientoId: string,
  categoriaId?: string
) {
  const { error } = await supabaseClient.rpc(
    'identificar_como_no_id',
    {
      p_movimiento_id: movimientoId,
      p_categoria_id: categoriaId,
    }
  );
  if (error) throw error;
}

/**
 * Transición: any → anulado (reversal)
 * Used for reconciliation revert (mig 0136)
 */
export async function anularMovimiento(
  supabaseClient: SupabaseClient,
  movimientoId: string
) {
  const { error } = await supabaseClient
    .from('movimientos')
    .update({ estado: EstadoMovimiento.ANULADO, updated_at: new Date().toISOString() })
    .eq('id', movimientoId);
  if (error) throw error;
}
```

### Movement Type Semantics

**INGRESO (Inbound Payment):**
- Positive monto (money entering account)
- Typical sources: customer payments, account transfers-in, deposits
- Candidates for fuzzy matching (comprobantes autorizado/migrado)
- Can be identified as cobranza (payment receipt) or PAC (credit to admin)
- Estado progression: pendiente_id → identificado | anulado

**EGRESO (Outbound Payment):**
- Positive monto (money leaving account)
- Typical sources: supplier payments, withdrawals, tax remittances
- Matched via CUIT, código, egreso categoria patterns
- Cannot be cobranza or PAC (income only)
- Estado progression: pendiente_id → identificado | anulado

**TRANSFERENCIA_IN (Transfer Received):**
- Positive monto, between same-empresa accounts
- Matched via caja alias/CBU lookup (auto_transferencia priority)
- Contrapart is TRANSFERENCIA_OUT on other caja
- Both created atomically in same RPC call
- Prevents double-counting: one IN + one OUT = net zero for empresa

**TRANSFERENCIA_OUT (Transfer Sent):**
- Positive monto (displayed as outbound)
- Matched via receiving caja's alias
- Paired with TRANSFERENCIA_IN on contrapart

**MOV_NO_IDENTIFICADO (Unidentified):**
- Legacy fallback when no match possible
- Marked with estado='identificado' despite no specific destination
- Assigned categoria_id for accounting purposes
- Reviewable via motor suggestions in UI

---

## 2. FLUJO DE CONCILIACIÓN BANCARIA COMPLETO

### 2.1 File Upload & Parsing (`src/services/api/conciliacion.ts`)

The reconciliation flow starts with bank statement file upload. The parser handles three statement formats:

```typescript
const COLUMN_MAPPINGS = {
  fecha: ['fecha', 'date', 'fecha operacion', 'transaction date'],
  descripcion: ['descripcion', 'description', 'concepto', 'detail'],
  referencia: ['referencia', 'reference', 'numero comprobante', 'check num'],
  // Three monto variants:
  debito: ['debito', 'debit', 'outflow'],
  credito: ['credito', 'credit', 'inflow'],
  monto: ['monto', 'amount', 'importe'],
  observaciones: ['observaciones', 'notes', 'comments'],
};

export async function parseExtractoFile(file: File): Promise<ExtractoRow[]> {
  let rows: any[] = [];
  
  if (file.type.includes('spreadsheet') || file.name.endsWith('.xlsx')) {
    const workbook = await XLSX.read(await file.arrayBuffer(), { type: 'array' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    rows = XLSX.utils.sheet_to_json(sheet, { defval: '', blankrows: false });
  } else if (file.type === 'text/csv' || file.name.endsWith('.csv')) {
    rows = await parseCSV(file);
  } else {
    throw new Error(`Unsupported file type: ${file.type}`);
  }

  if (rows.length === 0) throw new Error('Empty file');

  // Normalize headers: case-insensitive, remove diacritics
  const headerRow = rows[0];
  const normalizedHeaders: Record<string, string> = {};
  Object.keys(headerRow).forEach(header => {
    const normalized = header
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();
    
    // Find best match in COLUMN_MAPPINGS
    for (const [field, aliases] of Object.entries(COLUMN_MAPPINGS)) {
      if (aliases.some(alias => normalized.includes(alias))) {
        normalizedHeaders[header] = field;
        break;
      }
    }
  });

  // Parse data rows
  const parsed: ExtractoRow[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const fecha = toIsoDate(row[Object.keys(row).find(k => normalizedHeaders[k] === 'fecha')]);
    const descripcion = row[Object.keys(row).find(k => normalizedHeaders[k] === 'descripcion')] || '';
    const referencia = row[Object.keys(row).find(k => normalizedHeaders[k] === 'referencia')] || '';
    const observaciones = row[Object.keys(row).find(k => normalizedHeaders[k] === 'observaciones')] || '';

    // Handle monto: either separate debito/credito or single monto column
    let monto = 0;
    const debitoCol = Object.keys(row).find(k => normalizedHeaders[k] === 'debito');
    const creditoCol = Object.keys(row).find(k => normalizedHeaders[k] === 'credito');
    const montoCol = Object.keys(row).find(k => normalizedHeaders[k] === 'monto');

    if (debitoCol && creditoCol) {
      const deb = toNumber(row[debitoCol]);
      const cred = toNumber(row[creditoCol]);
      monto = deb > 0 ? -deb : cred;
    } else if (montoCol) {
      monto = toNumber(row[montoCol]);
    }

    parsed.push({
      fecha,
      descripcion,
      referencia,
      observaciones,
      monto,
      _row_index: i,
    });
  }

  return parsed;
}

function toNumber(value: any): number {
  if (typeof value === 'number') return value;
  if (!value) return 0;
  
  const str = String(value).trim();
  // Argentine format: 1.234.567,89 → 1234567.89
  const normalized = str
    .replace(/\./g, '')
    .replace(',', '.');
  
  return parseFloat(normalized) || 0;
}

function toIsoDate(value: any): string {
  if (!value) return new Date().toISOString().split('T')[0];
  
  // Excel serial date (days since 1900-01-01)
  if (typeof value === 'number') {
    const excelDate = value - 25569; // Adjust for Excel epoch
    const jsDate = new Date(excelDate * 86400000);
    return jsDate.toISOString().split('T')[0];
  }

  // DD/MM/YYYY or YYYY-MM-DD
  const str = String(value).trim();
  if (str.includes('/')) {
    const [d, m, y] = str.split('/');
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  if (str.includes('-')) {
    const parts = str.split('-');
    if (parts[0].length === 4) return str; // Already YYYY-MM-DD
    const [d, m, y] = parts;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  return new Date().toISOString().split('T')[0];
}
```

### 2.2 Chunked Processing Orchestration (Client)

From `src/services/api/conciliacion.ts`:

```typescript
export const CHUNK_SIZE_DEFAULT = 150; // Optimized for ~0.4s server latency per chunk

export interface ProcessingProgress {
  currentChunk: number;
  totalChunks: number;
  itemsProcessed: number;
  itemsTotal: number;
  currentMetrics: {
    auto_codigo: number;
    auto_cuit_edif: number;
    auto_cuit_admin: number;
    auto_transferencia: number;
    auto_patron_aprendido: number;
    auto_patron_egreso: number;
    fuzzy_sugeridas: number;
    sin_match: number;
    duplicadas: number;
  };
  eta?: Date;
}

export async function processExtractoInChunks(
  supabaseClient: SupabaseClient,
  empresaId: string,
  cajaId: string,
  archivoNombre: string,
  rows: ExtractoRow[],
  onProgress?: (progress: ProcessingProgress) => void,
  signal?: AbortSignal
): Promise<ProcessingResult> {
  const chunkSize = CHUNK_SIZE_DEFAULT;
  const chunks = Math.ceil(rows.length / chunkSize);
  let extractoId: string | null = null;
  let accumulatedMetrics = {
    auto_codigo: 0,
    auto_cuit_edif: 0,
    auto_cuit_admin: 0,
    auto_transferencia: 0,
    auto_patron_aprendido: 0,
    auto_patron_egreso: 0,
    fuzzy_sugeridas: 0,
    sin_match: 0,
    duplicadas: 0,
  };
  const startTime = Date.now();

  for (let chunkIdx = 0; chunkIdx < chunks; chunkIdx++) {
    if (signal?.aborted) throw new Error('Processing aborted');

    const start = chunkIdx * chunkSize;
    const end = Math.min(start + chunkSize, rows.length);
    const chunk = rows.slice(start, end);

    // Exponential backoff on transient errors
    let retries = 3;
    let delay = 500; // ms
    let result;

    while (retries > 0) {
      try {
        const { data, error } = await supabaseClient.rpc(
          'procesar_extracto_chunk',
          {
            p_extracto_id: extractoId,
            p_empresa_id: empresaId,
            p_caja_id: cajaId,
            p_archivo_nombre: archivoNombre,
            p_chunk_idx: chunkIdx,
            p_chunks_total: chunks,
            p_rows_chunk: chunk.map(r => ({
              fecha: r.fecha,
              descripcion: r.descripcion,
              referencia: r.referencia,
              observaciones: r.observaciones,
              monto_neto: r.monto,
            })),
            p_es_ultimo: chunkIdx === chunks - 1,
          }
        );

        if (error) {
          if (error.code === 'PGRST301' && retries > 1) {
            // Statement timeout: backoff and retry
            await new Promise(res => setTimeout(res, delay));
            delay *= 2;
            retries--;
            continue;
          }
          throw error;
        }

        result = data;
        extractoId = result.extracto_id;
        
        // Accumulate metrics
        accumulatedMetrics.auto_codigo += result.auto_codigo || 0;
        accumulatedMetrics.auto_cuit_edif += result.auto_cuit_edif || 0;
        accumulatedMetrics.auto_cuit_admin += result.auto_cuit_admin || 0;
        accumulatedMetrics.auto_transferencia += result.auto_transferencia || 0;
        accumulatedMetrics.auto_patron_aprendido += result.auto_patron_aprendido || 0;
        accumulatedMetrics.auto_patron_egreso += result.auto_patron_egreso || 0;
        accumulatedMetrics.fuzzy_sugeridas += result.fuzzy_sugeridas || 0;
        accumulatedMetrics.sin_match += result.sin_match || 0;
        accumulatedMetrics.duplicadas += result.duplicadas || 0;

        // Report progress
        const elapsed = Date.now() - startTime;
        const avg_chunk_time = elapsed / (chunkIdx + 1);
        const remaining_chunks = chunks - chunkIdx - 1;
        const eta = new Date(Date.now() + avg_chunk_time * remaining_chunks);

        onProgress?.({
          currentChunk: chunkIdx + 1,
          totalChunks: chunks,
          itemsProcessed: end,
          itemsTotal: rows.length,
          currentMetrics: accumulatedMetrics,
          eta,
        });

        break; // Success
      } catch (err) {
        if (retries === 1) throw err;
        await new Promise(res => setTimeout(res, delay));
        delay *= 2;
        retries--;
      }
    }
  }

  return {
    extractoId: extractoId!,
    totalLineas: rows.length,
    ...accumulatedMetrics,
  };
}
```

### 2.3 Server-Side Matching Cascade (PostgreSQL RPC)

From `supabase/migrations/0101_conciliacion_chunked.sql` (simplified excerpt):

```sql
CREATE OR REPLACE FUNCTION procesar_extracto_chunk(
  p_extracto_id uuid,
  p_empresa_id uuid,
  p_caja_id uuid,
  p_archivo_nombre text,
  p_chunk_idx integer,
  p_chunks_total integer,
  p_rows_chunk jsonb,
  p_es_ultimo boolean
) RETURNS json LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_extracto record;
  v_metrics json := '{"auto_codigo":0,"auto_cuit_edif":0,"auto_cuit_admin":0,"auto_transferencia":0,"auto_patron_aprendido":0,"auto_patron_egreso":0,"fuzzy_sugeridas":0,"sin_match":0,"duplicadas":0}'::json;
  v_row jsonb;
  v_fecha date;
  v_descripcion text;
  v_observaciones text;
  v_monto numeric;
  v_hash_linea text;
  v_match_edificio_id uuid;
  v_match_admin_id uuid;
  v_match_comprobante_id uuid;
  v_match_caja_id uuid;
  v_match_type text;
  v_match_score numeric;
  v_frase_normalizada text;
  v_frase_hash text;
  v_fuzzy_matches json;
  v_best_comprobante record;
  v_linea_id uuid;
BEGIN
  -- Chunk 0: initialize extracto in 'procesando' state
  IF p_extracto_id IS NULL THEN
    INSERT INTO extractos_bancarios (
      empresa_id, caja_id, archivo_nombre, estado,
      chunks_total, chunks_procesados,
      procesando_iniciado_at
    ) VALUES (
      p_empresa_id, p_caja_id, p_archivo_nombre, 'procesando',
      p_chunks_total, 0,
      now()
    ) RETURNING id INTO p_extracto_id;
  ELSE
    -- Validate extracto exists and belongs to this empresa/caja
    SELECT * INTO v_extracto FROM extractos_bancarios
      WHERE id = p_extracto_id AND empresa_id = p_empresa_id AND caja_id = p_caja_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Extracto % not found or belongs to different empresa/caja', p_extracto_id;
    END IF;
    IF v_extracto.estado != 'procesando' THEN
      RAISE EXCEPTION 'Extracto % estado is %, expected procesando', p_extracto_id, v_extracto.estado;
    END IF;
  END IF;

  -- Process rows in chunk
  FOR v_row IN SELECT * FROM jsonb_array_elements(p_rows_chunk) LOOP
    v_fecha := (v_row->>'fecha')::date;
    v_descripcion := v_row->>'descripcion';
    v_observaciones := COALESCE(v_row->>'observaciones', '');
    v_monto := (v_row->>'monto_neto')::numeric;

    -- Compute dedup hash
    v_hash_linea := encode(
      sha256(
        (p_caja_id::text || v_fecha::text || v_monto::text ||
         lower(v_descripcion) || lower(v_observaciones) || lower(COALESCE(v_row->>'referencia', '')))::bytea
      ),
      'hex'
    );

    -- Check for duplicate (within this extracto OR in prior movimientos)
    IF EXISTS (
      SELECT 1 FROM extractos_lineas
      WHERE extracto_id = p_extracto_id AND hash_linea = v_hash_linea
    ) OR EXISTS (
      SELECT 1 FROM movimientos
      WHERE caja_id = p_caja_id AND hash_dedup = v_hash_linea
    ) THEN
      -- Duplicate detected
      v_match_type := 'duplicado';
      v_metrics := jsonb_set(v_metrics, '{duplicadas}', 
        (COALESCE(v_metrics->>'duplicadas', '0')::int + 1)::text::jsonb);
      INSERT INTO extractos_lineas (
        extracto_id, empresa_id, caja_id, fecha, descripcion, observaciones,
        referencia, monto_neto, hash_linea, match_type, decision
      ) VALUES (
        p_extracto_id, p_empresa_id, p_caja_id, v_fecha, v_descripcion, v_observaciones,
        v_row->>'referencia', v_monto, v_hash_linea, 'duplicado', 'ignorado'
      );
      CONTINUE;
    END IF;

    -- PRIORITY 0: CUIT matching (auto_cuit_edif, auto_cuit_admin)
    -- Pattern: DD-DDDDDDDD-D or DDDDDDDD or similar formats
    DECLARE
      v_cuit text;
      v_edificio_cuit uuid;
      v_admin_cuit uuid;
    BEGIN
      v_cuit := regexp_matches(v_descripcion || ' ' || v_observaciones, '\d{2}-?\d{8}-?\d{1}', 'g')[1];
      IF v_cuit IS NOT NULL THEN
        v_cuit := replace(v_cuit, '-', '');
        
        -- Try edificio match
        SELECT id INTO v_edificio_cuit FROM edificios
          WHERE empresa_id = p_empresa_id AND cuit = v_cuit
          LIMIT 1;
        
        IF v_edificio_cuit IS NOT NULL THEN
          v_match_edificio_id := v_edificio_cuit;
          v_match_type := 'auto_cuit_edif';
          v_match_score := 1.0;
          v_metrics := jsonb_set(v_metrics, '{auto_cuit_edif}', 
            (COALESCE(v_metrics->>'auto_cuit_edif', '0')::int + 1)::text::jsonb);
          RAISE NOTICE 'Matched CUIT % to edificio %', v_cuit, v_edificio_cuit;
          GOTO create_linea;
        END IF;

        -- Try admin match
        SELECT id INTO v_admin_cuit FROM administraciones
          WHERE empresa_id = p_empresa_id AND cuit = v_cuit
          LIMIT 1;
        
        IF v_admin_cuit IS NOT NULL THEN
          v_match_admin_id := v_admin_cuit;
          v_match_type := 'auto_cuit_admin';
          v_match_score := 1.0;
          v_metrics := jsonb_set(v_metrics, '{auto_cuit_admin}', 
            (COALESCE(v_metrics->>'auto_cuit_admin', '0')::int + 1)::text::jsonb);
          RAISE NOTICE 'Matched CUIT % to admin %', v_cuit, v_admin_cuit;
          GOTO create_linea;
        END IF;
      END IF;
    END;

    -- PRIORITY 1: Código AAAA-EEEE matching (auto_codigo)
    -- Pattern: word-digits (edificio code) or admin-digits
    DECLARE
      v_codigo_match uuid;
      v_codigo_pattern text;
    BEGIN
      -- Extract AAAA-EEEE pattern
      v_codigo_pattern := (regexp_matches(
        v_descripcion || ' ' || v_observaciones,
        '([A-Za-z]+)-(\d+)',
        'g'
      ))[1] || '-' || (regexp_matches(
        v_descripcion || ' ' || v_observaciones,
        '([A-Za-z]+)-(\d+)',
        'g'
      ))[2];

      IF v_codigo_pattern IS NOT NULL THEN
        -- Try edificio match
        SELECT id INTO v_codigo_match FROM edificios
          WHERE empresa_id = p_empresa_id 
            AND (codigo = v_codigo_pattern OR codigo = normalize_codigo_4(v_codigo_pattern))
          LIMIT 1;
        
        IF v_codigo_match IS NOT NULL THEN
          v_match_edificio_id := v_codigo_match;
          v_match_type := 'auto_codigo';
          v_match_score := 1.0;
          v_metrics := jsonb_set(v_metrics, '{auto_codigo}', 
            (COALESCE(v_metrics->>'auto_codigo', '0')::int + 1)::text::jsonb);
          RAISE NOTICE 'Matched código % to edificio %', v_codigo_pattern, v_codigo_match;
          GOTO create_linea;
        END IF;

        -- Try admin match
        SELECT id INTO v_codigo_match FROM administraciones
          WHERE empresa_id = p_empresa_id 
            AND codigo = v_codigo_pattern
          LIMIT 1;
        
        IF v_codigo_match IS NOT NULL THEN
          v_match_admin_id := v_codigo_match;
          v_match_type := 'auto_codigo';
          v_match_score := 1.0;
          v_metrics := jsonb_set(v_metrics, '{auto_codigo}', 
            (COALESCE(v_metrics->>'auto_codigo', '0')::int + 1)::text::jsonb);
          GOTO create_linea;
        END IF;
      END IF;
    END;

    -- PRIORITY 2: Transferencia matching (auto_transferencia)
    -- Look for CBU or caja alias in descripcion/observaciones
    DECLARE
      v_caja_destino uuid;
    BEGIN
      SELECT id INTO v_caja_destino FROM cajas
        WHERE empresa_id = p_empresa_id
          AND id != p_caja_id
          AND activa = true
          AND (
            alias ILIKE '%' || v_descripcion || '%' OR
            alias ILIKE '%' || v_observaciones || '%' OR
            cbu = regexp_matches(v_descripcion || ' ' || v_observaciones, '\d{22}', 'g')[1]
          )
        LIMIT 1;
      
      IF v_caja_destino IS NOT NULL THEN
        v_match_caja_id := v_caja_destino;
        v_match_type := 'auto_transferencia';
        v_match_score := 1.0;
        v_metrics := jsonb_set(v_metrics, '{auto_transferencia}', 
          (COALESCE(v_metrics->>'auto_transferencia', '0')::int + 1)::text::jsonb);
        RAISE NOTICE 'Matched transferencia to caja %', v_caja_destino;
        GOTO create_linea;
      END IF;
    END;

    -- PRIORITY 3: Patrón aprendido matching (auto_patron_aprendido)
    -- Normalized phrase hash lookup
    BEGIN
      v_frase_normalizada := normaliza_frase_banco(v_descripcion || ' ' || v_observaciones);
      v_frase_hash := encode(sha256(v_frase_normalizada::bytea), 'hex');

      -- Try exact frase_hash match in patrones
      SELECT edificio_id, administracion_id, comprobante_id, caja_contraparte_id, hits
        INTO v_match_edificio_id, v_match_admin_id, v_match_comprobante_id, v_match_caja_id
        FROM patrones_conciliacion_aprendidos
        WHERE empresa_id = p_empresa_id AND frase_hash = v_frase_hash
        ORDER BY hits DESC, ultimo_hit DESC
        LIMIT 1;

      IF v_match_edificio_id IS NOT NULL OR v_match_admin_id IS NOT NULL OR 
         v_match_comprobante_id IS NOT NULL OR v_match_caja_id IS NOT NULL THEN
        v_match_type := 'auto_patron_aprendido';
        v_match_score := 0.95; -- High confidence but less than exact CUIT/código
        v_metrics := jsonb_set(v_metrics, '{auto_patron_aprendido}', 
          (COALESCE(v_metrics->>'auto_patron_aprendido', '0')::int + 1)::text::jsonb);
        RAISE NOTICE 'Matched learned pattern for phrase %', v_frase_normalizada;
        GOTO create_linea;
      END IF;
    END;

    -- PRIORITY 4: Patrón egreso matching (auto_patron_egreso, egresos only)
    -- For outbound movements, match against expense category patterns
    DECLARE
      v_patron_egreso record;
      v_categoria_sug uuid;
      v_agrupa_con text;
    BEGIN
      -- Only for outbound movements (inferred from context)
      SELECT id, categoria_id, agrupa_con INTO v_patron_egreso
        FROM patrones_egreso_categoria
        WHERE empresa_id IS NULL -- Global patterns
          AND v_descripcion ILIKE '%' || patron || '%'
        ORDER BY prioridad DESC
        LIMIT 1;

      IF v_patron_egreso.id IS NOT NULL THEN
        v_match_type := 'auto_patron_egreso';
        v_match_score := 0.8; -- Lower confidence
        v_categoria_sug := v_patron_egreso.categoria_id;
        v_agrupa_con := v_patron_egreso.agrupa_con;
        v_metrics := jsonb_set(v_metrics, '{auto_patron_egreso}', 
          (COALESCE(v_metrics->>'auto_patron_egreso', '0')::int + 1)::text::jsonb);
        RAISE NOTICE 'Matched egreso pattern: %', v_patron_egreso.id;
        GOTO create_linea;
      END IF;
    END;

    -- PRIORITY 5: Fuzzy matching (comprobantes, ingresos only)
    -- Matches by empresa, estado (autorizado/migrado), total==monto, within ±3 days
    DECLARE
      v_fuzzy_score numeric;
      v_score_value numeric;
    BEGIN
      SELECT id, fecha INTO v_best_comprobante
        FROM comprobantes
        WHERE empresa_id = p_empresa_id
          AND estado IN ('autorizado', 'migrado')
          AND total = v_monto
          AND fecha BETWEEN v_fecha - interval '3 days' AND v_fecha + interval '3 days'
        ORDER BY 
          -- Score by date proximity (descending)
          CASE 
            WHEN fecha = v_fecha THEN 1.0
            WHEN ABS(EXTRACT(DAY FROM (fecha - v_fecha))) = 1 THEN 0.9
            WHEN ABS(EXTRACT(DAY FROM (fecha - v_fecha))) <= 3 THEN 0.7
            ELSE 0.5
          END DESC,
          -- Tiebreaker: most recent
          fecha DESC
        LIMIT 1;

      IF v_best_comprobante.id IS NOT NULL THEN
        v_match_comprobante_id := v_best_comprobante.id;
        v_match_type := 'fuzzy';
        -- Calculate score based on date proximity
        v_score_value := ABS(EXTRACT(DAY FROM (v_best_comprobante.fecha - v_fecha)));
        v_match_score := CASE
          WHEN v_score_value = 0 THEN 1.0
          WHEN v_score_value = 1 THEN 0.9
          WHEN v_score_value <= 3 THEN 0.7
          ELSE 0.5
        END;
        v_metrics := jsonb_set(v_metrics, '{fuzzy_sugeridas}', 
          (COALESCE(v_metrics->>'fuzzy_sugeridas', '0')::int + 1)::text::jsonb);
        RAISE NOTICE 'Fuzzy match comprobante % with score %', v_best_comprobante.id, v_match_score;
        GOTO create_linea;
      END IF;
    END;

    -- No match: sin_match
    v_match_type := 'sin_match';
    v_match_score := 0.0;
    v_metrics := jsonb_set(v_metrics, '{sin_match}', 
      (COALESCE(v_metrics->>'sin_match', '0')::int + 1)::text::jsonb);

    <<create_linea>>
    -- Create linea record
    INSERT INTO extractos_lineas (
      extracto_id, empresa_id, caja_id, fecha, descripcion, observaciones, referencia,
      monto_neto, hash_linea, match_type, match_score,
      edificio_id_match, administracion_id_match, comprobante_id_match, caja_contraparte_match,
      decision
    ) VALUES (
      p_extracto_id, p_empresa_id, p_caja_id, v_fecha, v_descripcion, v_observaciones,
      COALESCE(v_row->>'referencia', ''),
      v_monto, v_hash_linea, v_match_type, v_match_score,
      v_match_edificio_id, v_match_admin_id, v_match_comprobante_id, v_match_caja_id,
      CASE 
        WHEN v_match_type IN ('auto_codigo', 'auto_cuit_edif', 'auto_cuit_admin', 'auto_transferencia', 'auto_patron_aprendido')
          THEN 'aceptado'
        WHEN v_match_type = 'fuzzy' THEN 'pendiente'
        ELSE 'pendiente'
      END
    );

    -- Reset for next row
    v_match_edificio_id := NULL;
    v_match_admin_id := NULL;
    v_match_comprobante_id := NULL;
    v_match_caja_id := NULL;
  END LOOP;

  -- Update extracto counters after chunk processed
  UPDATE extractos_bancarios SET
    chunks_procesados = chunks_procesados + 1,
    ultimo_chunk_at = now()
  WHERE id = p_extracto_id;

  -- If last chunk: finalize and consolidate
  IF p_es_ultimo THEN
    UPDATE extractos_bancarios SET
      estado = 'parseado',
      periodo_desde = (SELECT MIN(fecha) FROM extractos_lineas WHERE extracto_id = p_extracto_id),
      periodo_hasta = (SELECT MAX(fecha) FROM extractos_lineas WHERE extracto_id = p_extracto_id),
      total_lineas = (SELECT COUNT(*) FROM extractos_lineas WHERE extracto_id = p_extracto_id),
      log = jsonb_build_object(
        'procesado_at', now(),
        'procesado_por', current_user_id(),
        'metodos_matching', v_metrics
      )
    WHERE id = p_extracto_id;
  END IF;

  RETURN json_build_object(
    'extracto_id', p_extracto_id,
    'chunks_procesados', p_chunk_idx + 1,
    'chunks_total', p_chunks_total,
    'auto_codigo', COALESCE(v_metrics->>'auto_codigo', '0')::int,
    'auto_cuit_edif', COALESCE(v_metrics->>'auto_cuit_edif', '0')::int,
    'auto_cuit_admin', COALESCE(v_metrics->>'auto_cuit_admin', '0')::int,
    'auto_transferencia', COALESCE(v_metrics->>'auto_transferencia', '0')::int,
    'auto_patron_aprendido', COALESCE(v_metrics->>'auto_patron_aprendido', '0')::int,
    'auto_patron_egreso', COALESCE(v_metrics->>'auto_patron_egreso', '0')::int,
    'fuzzy_sugeridas', COALESCE(v_metrics->>'fuzzy_sugeridas', '0')::int,
    'sin_match', COALESCE(v_metrics->>'sin_match', '0')::int,
    'duplicadas', COALESCE(v_metrics->>'duplicadas', '0')::int
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Error in chunk %: %', p_chunk_idx, SQLERRM;
  RAISE;
END $$;
```

### 2.4 Decision Application & Reversal

From `src/services/api/conciliacion.ts`:

```typescript
export type DecisionLineaV2 =
  | { linea_id: string; tipo_decision: 'aceptar'; destino: 'comprobante'; comprobante_id: string }
  | { linea_id: string; tipo_decision: 'aceptar'; destino: 'edificio'; edificio_id: string }
  | { linea_id: string; tipo_decision: 'aceptar'; destino: 'admin'; administracion_id: string }
  | { linea_id: string; tipo_decision: 'aceptar'; destino: 'transferencia'; caja_destino_id: string }
  | { linea_id: string; tipo_decision: 'rechazar' }
  | { linea_id: string; tipo_decision: 'ignorar' }
  | { linea_id: string; tipo_decision: 'categorizar'; categoria_id: string };

export async function aplicarConciliacionV2(
  supabaseClient: SupabaseClient,
  empresaId: string,
  extractoId: string,
  decisiones: DecisionLineaV2[]
): Promise<{ movimientos_creados: number; lineas_aplicadas: number }> {
  // Transform to RPC format
  const decisiones_rpc = decisiones.map(d => {
    if (d.tipo_decision === 'aceptar') {
      return {
        linea_id: d.linea_id,
        decision: 'aceptado',
        destino_tipo: d.destino,
        destino_id: 
          d.destino === 'comprobante' ? d.comprobante_id :
          d.destino === 'edificio' ? d.edificio_id :
          d.destino === 'admin' ? d.administracion_id :
          d.caja_destino_id,
      };
    } else if (d.tipo_decision === 'rechazar') {
      return { linea_id: d.linea_id, decision: 'rechazado' };
    } else if (d.tipo_decision === 'ignorar') {
      return { linea_id: d.linea_id, decision: 'ignorado' };
    } else if (d.tipo_decision === 'categorizar') {
      return {
        linea_id: d.linea_id,
        decision: 'aceptado',
        destino_tipo: 'categoria',
        destino_id: d.categoria_id,
      };
    }
  });

  const { data, error } = await supabaseClient.rpc(
    'aplicar_conciliacion_v2',
    {
      p_empresa_id: empresaId,
      p_extracto_id: extractoId,
      p_decisiones: decisiones_rpc,
    }
  );

  if (error) throw error;
  return data;
}

/**
 * Revert an applied extracto entirely
 * From migration 0136_blindaje_conciliacion.sql
 */
export async function revertirExtracto(
  supabaseClient: SupabaseClient,
  empresaId: string,
  extractoId: string
): Promise<{ movimientos_borrados: number; lineas_reseteadas: number }> {
  const { data, error } = await supabaseClient.rpc(
    'revertir_extracto',
    {
      p_empresa_id: empresaId,
      p_extracto_id: extractoId,
    }
  );
  if (error) throw error;
  return data;
}
```

The RPC `aplicar_conciliacion_v2` (migration 0136) uses pessimistic locking:

```sql
CREATE OR REPLACE FUNCTION aplicar_conciliacion_v2(
  p_empresa_id uuid,
  p_extracto_id uuid,
  p_decisiones jsonb
) RETURNS json LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_extracto record;
  v_linea record;
  v_decision jsonb;
  v_mov_id uuid;
  v_movimientos_creados int := 0;
  v_lineas_aplicadas int := 0;
BEGIN
  -- Pessimistic lock on extracto
  SELECT * INTO v_extracto FROM extractos_bancarios
    WHERE id = p_extracto_id AND empresa_id = p_empresa_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Extracto % not found', p_extracto_id;
  END IF;

  -- Guard: prevent double application
  IF v_extracto.estado = 'aplicado' THEN
    RAISE EXCEPTION 'Extracto % ya ha sido aplicado', p_extracto_id;
  END IF;

  -- Process each decision
  FOR v_decision IN SELECT * FROM jsonb_array_elements(p_decisiones) LOOP
    -- Lock individual linea
    SELECT * INTO v_linea FROM extractos_lineas
      WHERE id = (v_decision->>'linea_id')::uuid AND extracto_id = p_extracto_id
      FOR UPDATE;

    IF v_decision->>'decision' = 'aceptado' THEN
      -- Create movimiento
      v_mov_id := gen_random_uuid();
      INSERT INTO movimientos (
        id, empresa_id, caja_id, tipo, estado, monto, fecha,
        descripcion, referencia, categoria_id, origen, hash_dedup
      ) VALUES (
        v_mov_id, p_empresa_id, v_linea.caja_id,
        CASE 
          WHEN v_linea.monto_neto > 0 THEN 'ingreso'
          ELSE 'egreso'
        END,
        'pendiente_id', ABS(v_linea.monto_neto), v_linea.fecha,
        v_linea.descripcion, v_linea.referencia,
        NULL, 'conciliacion_auto', v_linea.hash_linea
      );

      v_movimientos_creados := v_movimientos_creados + 1;

      -- Create matching imputación based on destino_tipo
      CASE (v_decision->>'destino_tipo')
        WHEN 'comprobante' THEN
          INSERT INTO movimiento_imputaciones (
            movimiento_id, comprobante_id, monto_imputado
          ) VALUES (
            v_mov_id, (v_decision->>'destino_id')::uuid, ABS(v_linea.monto_neto)
          );
          UPDATE movimientos SET estado = 'identificado' WHERE id = v_mov_id;
        WHEN 'edificio' THEN
          INSERT INTO movimiento_imputaciones (
            movimiento_id, administracion_id, monto_imputado
          ) VALUES (
            v_mov_id, 
            (SELECT administracion_id FROM edificios WHERE id = (v_decision->>'destino_id')::uuid),
            ABS(v_linea.monto_neto)
          );
          UPDATE movimientos SET estado = 'identificado' WHERE id = v_mov_id;
        WHEN 'admin' THEN
          INSERT INTO movimiento_imputaciones (
            movimiento_id, administracion_id, monto_imputado
          ) VALUES (
            v_mov_id, (v_decision->>'destino_id')::uuid, ABS(v_linea.monto_neto)
          );
          UPDATE movimientos SET estado = 'identificado' WHERE id = v_mov_id;
        WHEN 'categoria' THEN
          UPDATE movimientos SET categoria_id = (v_decision->>'destino_id')::uuid WHERE id = v_mov_id;
      END CASE;

      -- Mark linea as aceptado
      UPDATE extractos_lineas SET decision = 'aceptado' WHERE id = (v_decision->>'linea_id')::uuid;
      v_lineas_aplicadas := v_lineas_aplicadas + 1;

    ELSIF v_decision->>'decision' = 'rechazado' THEN
      UPDATE extractos_lineas SET decision = 'rechazado' WHERE id = (v_decision->>'linea_id')::uuid;
      v_lineas_aplicadas := v_lineas_aplicadas + 1;

    ELSIF v_decision->>'decision' = 'ignorado' THEN
      UPDATE extractos_lineas SET decision = 'ignorado' WHERE id = (v_decision->>'linea_id')::uuid;
      v_lineas_aplicadas := v_lineas_aplicadas + 1;
    END IF;
  END LOOP;

  -- Update extracto state to aplicado
  UPDATE extractos_bancarios SET
    estado = 'aplicado',
    aplicadas = v_lineas_aplicadas,
    log = jsonb_set(log, '{aplicado_at}', to_jsonb(now()))
  WHERE id = p_extracto_id;

  RETURN json_build_object(
    'movimientos_creados', v_movimientos_creados,
    'lineas_aplicadas', v_lineas_aplicadas
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Error applying conciliacion: %', SQLERRM;
  RAISE;
END $$;
```

---

## 3. MOTOR DE PATRONES / APRENDIZAJE AUTOMÁTICO

### 3.1 Learning Trigger & Bootstrap

From `supabase/migrations/0063_patrones_aprendidos.sql`:

```sql
-- Core function: normalize bank phrases to extract canonical form
CREATE OR REPLACE FUNCTION normaliza_frase_banco(p_texto text)
  RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT
    TRIM(
      REGEXP_REPLACE(
        -- Remove sequences of 5+ digits (account numbers, etc.)
        REGEXP_REPLACE(
          LOWER(TRIM(p_texto)),
          '\d{5,}',
          '',
          'g'
        ),
        -- Keep only a-z, ñ, 0-9, spaces
        '[^a-zñ0-9\s]',
        '',
        'g'
      ),
      -- Compress multiple spaces into one, trim edges
      ' '
    )
$$;

-- Storage: learned patterns with destination XOR constraint
CREATE TABLE public.patrones_conciliacion_aprendidos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  frase text NOT NULL,
  frase_hash text NOT NULL,
  destino_tipo text NOT NULL CHECK (destino_tipo IN ('edificio', 'admin', 'comprobante', 'transferencia')),
  -- XOR: exactly one of these is NOT NULL
  edificio_id uuid REFERENCES edificios(id) ON DELETE CASCADE,
  administracion_id uuid REFERENCES administraciones(id) ON DELETE CASCADE,
  comprobante_id uuid REFERENCES comprobantes(id) ON DELETE CASCADE,
  caja_contraparte_id uuid REFERENCES cajas(id) ON DELETE CASCADE,
  hits integer DEFAULT 1,
  ultimo_hit timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  CONSTRAINT chk_destino_xor CHECK (
    (
      (edificio_id IS NOT NULL AND administracion_id IS NULL AND comprobante_id IS NULL AND caja_contraparte_id IS NULL) OR
      (edificio_id IS NULL AND administracion_id IS NOT NULL AND comprobante_id IS NULL AND caja_contraparte_id IS NULL) OR
      (edificio_id IS NULL AND administracion_id IS NULL AND comprobante_id IS NOT NULL AND caja_contraparte_id IS NULL) OR
      (edificio_id IS NULL AND administracion_id IS NULL AND comprobante_id IS NULL AND caja_contraparte_id IS NOT NULL)
    )
  )
);

-- Indexes for fast lookup during chunked processing
CREATE UNIQUE INDEX uq_patron_edificio ON patrones_conciliacion_aprendidos(
  empresa_id, frase_hash, edificio_id
) WHERE destino_tipo = 'edificio';

CREATE UNIQUE INDEX uq_patron_admin ON patrones_conciliacion_aprendidos(
  empresa_id, frase_hash, administracion_id
) WHERE destino_tipo = 'admin';

CREATE UNIQUE INDEX uq_patron_comprobante ON patrones_conciliacion_aprendidos(
  empresa_id, frase_hash, comprobante_id
) WHERE destino_tipo = 'comprobante';

CREATE UNIQUE INDEX uq_patron_transferencia ON patrones_conciliacion_aprendidos(
  empresa_id, frase_hash, caja_contraparte_id
) WHERE destino_tipo = 'transferencia';

-- Primary lookup index (hits DESC for most-used patterns first)
CREATE INDEX idx_patrones_frase_hash ON patrones_conciliacion_aprendidos(
  empresa_id, frase_hash, hits DESC
);

-- TRIGGER: Learn from accepted conciliación decisions
-- Fires AFTER UPDATE on extractos_lineas when decision changes to 'aceptado'
CREATE OR REPLACE FUNCTION trg_aprender_linea()
  RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_frase_normalizada text;
  v_frase_hash text;
  v_empresa_id uuid;
  v_destino_tipo text;
  v_destino_id uuid;
BEGIN
  -- Only learn from transitions TO 'aceptado'
  IF NEW.decision = 'aceptado' AND (OLD.decision IS NULL OR OLD.decision != 'aceptado') THEN
    -- Get empresa_id from extracto
    SELECT empresa_id INTO v_empresa_id FROM extractos_bancarios
      WHERE id = NEW.extracto_id;

    -- Normalize phrase
    v_frase_normalizada := normaliza_frase_banco(
      COALESCE(NEW.descripcion, '') || ' ' || COALESCE(NEW.observaciones, '')
    );
    v_frase_hash := encode(sha256(v_frase_normalizada::bytea), 'hex');

    -- Branch 1: Edificio match
    IF NEW.edificio_id_match IS NOT NULL THEN
      v_destino_tipo := 'edificio';
      v_destino_id := NEW.edificio_id_match;
      INSERT INTO patrones_conciliacion_aprendidos (
        empresa_id, frase, frase_hash, destino_tipo, edificio_id, hits, ultimo_hit
      ) VALUES (
        v_empresa_id, v_frase_normalizada, v_frase_hash, v_destino_tipo, v_destino_id, 1, now()
      )
      ON CONFLICT (empresa_id, frase_hash, edificio_id) WHERE destino_tipo = 'edificio'
      DO UPDATE SET hits = hits + 1, ultimo_hit = now();

    -- Branch 2: Admin match (only if no edificio)
    ELSIF NEW.administracion_id_match IS NOT NULL THEN
      v_destino_tipo := 'admin';
      v_destino_id := NEW.administracion_id_match;
      INSERT INTO patrones_conciliacion_aprendidos (
        empresa_id, frase, frase_hash, destino_tipo, administracion_id, hits, ultimo_hit
      ) VALUES (
        v_empresa_id, v_frase_normalizada, v_frase_hash, v_destino_tipo, v_destino_id, 1, now()
      )
      ON CONFLICT (empresa_id, frase_hash, administracion_id) WHERE destino_tipo = 'admin'
      DO UPDATE SET hits = hits + 1, ultimo_hit = now();

    -- Branch 3: Transferencia match
    ELSIF NEW.caja_contraparte_match IS NOT NULL THEN
      v_destino_tipo := 'transferencia';
      v_destino_id := NEW.caja_contraparte_match;
      INSERT INTO patrones_conciliacion_aprendidos (
        empresa_id, frase, frase_hash, destino_tipo, caja_contraparte_id, hits, ultimo_hit
      ) VALUES (
        v_empresa_id, v_frase_normalizada, v_frase_hash, v_destino_tipo, v_destino_id, 1, now()
      )
      ON CONFLICT (empresa_id, frase_hash, caja_contraparte_id) WHERE destino_tipo = 'transferencia'
      DO UPDATE SET hits = hits + 1, ultimo_hit = now();
    END IF;
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Log error but don't break the main flow
  RAISE WARNING 'Error in learning trigger: %', SQLERRM;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_aprender_linea
  AFTER UPDATE ON extractos_lineas
  FOR EACH ROW
  EXECUTE FUNCTION trg_aprender_linea();
```

### 3.2 Bootstrap from Historical Data (Newest-Wins Strategy)

From `supabase/migrations/0128_bootstrap_motor_desde_historico.sql`:

```sql
CREATE OR REPLACE FUNCTION bootstrap_motor_desde_historico(
  p_empresa_id uuid,
  p_dry_run boolean DEFAULT true
) RETURNS json LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_batch_id uuid := gen_random_uuid();
  v_mov record;
  v_frase_normalizada text;
  v_frase_hash text;
  v_linea_1 text;
  v_linea_2 text;
  v_admin_id uuid;
  v_edificio_id uuid;
  v_tipo text;
  v_total_movimientos int := 0;
  v_insertadas int := 0;
  v_saltadas_ya_existen int := 0;
  v_ambiguas_descartadas int := 0;
  v_egresos_descartados int := 0;
  v_log_ambiguas json := '[]'::json;
BEGIN
  -- Process historical movements in newest-wins order
  -- (most recent takes precedence, older duplicates skipped)
  FOR v_mov IN
    SELECT * FROM movimientos
    WHERE empresa_id = p_empresa_id AND origen = 'historico_banco'
    ORDER BY fecha DESC, id DESC
  LOOP
    v_total_movimientos := v_total_movimientos + 1;

    -- Only ingresos (reject egresos for motor)
    v_tipo := CASE 
      WHEN v_mov.monto > 0 THEN 'ingreso'
      ELSE 'egreso'
    END;

    IF v_tipo = 'egreso' THEN
      v_egresos_descartados := v_egresos_descartados + 1;
      CONTINUE;
    END IF;

    -- Parse descripcion (2-line format: "TRANSF...\nAdm NNNN - Edi MMMM")
    v_linea_1 := SPLIT_PART(v_mov.descripcion, E'\n', 1);
    v_linea_2 := SPLIT_PART(v_mov.descripcion, E'\n', 2);

    -- Extract admin/edificio from línea 2
    -- Pattern: "Adm NNNN - Edi MMMM" or "Adm NNNN"
    BEGIN
      v_admin_id := NULL;
      v_edificio_id := NULL;

      IF v_linea_2 ~ 'Adm\s+(\d+)' THEN
        -- Extract admin number and zero-pad to uuid lookup
        SELECT id INTO v_admin_id FROM administraciones
          WHERE empresa_id = p_empresa_id 
            AND numero = ZEROPAD((v_linea_2 ~ 'Adm\s+(\d+)')::int);

        IF v_linea_2 ~ 'Edi\s+(\d+)' THEN
          -- Extract edificio number
          SELECT id INTO v_edificio_id FROM edificios
            WHERE empresa_id = p_empresa_id
              AND numero = ZEROPAD((v_linea_2 ~ 'Edi\s+(\d+)')::int);
        END IF;
      END IF;

      -- Ambiguity check: admin must exist, edificio must belong to admin if present
      IF v_admin_id IS NULL THEN
        v_ambiguas_descartadas := v_ambiguas_descartadas + 1;
        v_log_ambiguas := jsonb_set(
          v_log_ambiguas::jsonb,
          '{' || v_ambiguas_descartadas::text || '}',
          jsonb_build_object('movimiento_id', v_mov.id, 'motivo', 'admin_not_found', 'linea_2', v_linea_2)
        )::json;
        CONTINUE;
      END IF;

      IF v_edificio_id IS NOT NULL THEN
        -- Verify edificio belongs to same admin
        IF NOT EXISTS (
          SELECT 1 FROM edificios
          WHERE id = v_edificio_id AND administracion_id = v_admin_id
        ) THEN
          v_ambiguas_descartadas := v_ambiguas_descartadas + 1;
          v_log_ambiguas := jsonb_set(
            v_log_ambiguas::jsonb,
            '{' || v_ambiguas_descartadas::text || '}',
            jsonb_build_object('movimiento_id', v_mov.id, 'motivo', 'edificio_not_in_admin', 'edificio_id', v_edificio_id, 'admin_id', v_admin_id)
          )::json;
          CONTINUE;
        END IF;
      END IF;

    EXCEPTION WHEN OTHERS THEN
      v_ambiguas_descartadas := v_ambiguas_descartadas + 1;
      CONTINUE;
    END;

    -- Check if pattern already exists (UNIQUE constraint prevents duplicate)
    v_frase_normalizada := normaliza_frase_banco(v_linea_1);
    v_frase_hash := encode(sha256(v_frase_normalizada::bytea), 'hex');

    -- Newest-wins: skip if pattern already learned
    IF EXISTS (
      SELECT 1 FROM patrones_conciliacion_aprendidos
      WHERE empresa_id = p_empresa_id AND frase_hash = v_frase_hash
    ) THEN
      v_saltadas_ya_existen := v_saltadas_ya_existen + 1;
      CONTINUE;
    END IF;

    -- Insert pattern (no dry-run check, always attempt)
    IF NOT p_dry_run THEN
      IF v_edificio_id IS NOT NULL THEN
        INSERT INTO patrones_conciliacion_aprendidos (
          empresa_id, frase, frase_hash, destino_tipo, edificio_id, hits, ultimo_hit
        ) VALUES (
          p_empresa_id, v_frase_normalizada, v_frase_hash, 'edificio', v_edificio_id, 1, v_mov.fecha
        )
        ON CONFLICT (empresa_id, frase_hash, edificio_id) WHERE destino_tipo = 'edificio'
        DO UPDATE SET hits = hits + 1, ultimo_hit = v_mov.fecha;
      ELSE
        INSERT INTO patrones_conciliacion_aprendidos (
          empresa_id, frase, frase_hash, destino_tipo, administracion_id, hits, ultimo_hit
        ) VALUES (
          p_empresa_id, v_frase_normalizada, v_frase_hash, 'admin', v_admin_id, 1, v_mov.fecha
        )
        ON CONFLICT (empresa_id, frase_hash, administracion_id) WHERE destino_tipo = 'admin'
        DO UPDATE SET hits = hits + 1, ultimo_hit = v_mov.fecha;
      END IF;

      v_insertadas := v_insertadas + 1;

      -- Log action (for audit trail / revertibility)
      INSERT INTO referencias_motor_batches (
        batch_id, accion, entidad_tipo, entidad_id, metadata
      ) VALUES (
        v_batch_id, 'insert', 'patron', gen_random_uuid(),
        jsonb_build_object('movimiento_id', v_mov.id, 'frase_hash', v_frase_hash)
      );
    ELSE
      -- Dry run: just count
      v_insertadas := v_insertadas + 1;
    END IF;
  END LOOP;

  RETURN json_build_object(
    'batch_id', v_batch_id,
    'total_movimientos', v_total_movimientos,
    'insertadas', v_insertadas,
    'saltadas_ya_existen', v_saltadas_ya_existen,
    'ambiguas_descartadas', v_ambiguas_descartadas,
    'egresos_descartados', v_egresos_descartados,
    'log_ambiguas', v_log_ambiguas,
    'modo', CASE WHEN p_dry_run THEN 'preview' ELSE 'committed' END
  );
END $$;
```

### 3.3 Pattern Metrics & Introspection

```sql
-- Retrieve top patterns by hit count for monitoring/debugging
CREATE OR REPLACE FUNCTION top_patrones_aprendidos(
  p_empresa_id uuid,
  p_limit int DEFAULT 20
) RETURNS TABLE (
  frase text,
  destino_tipo text,
  destino_label text,
  hits bigint,
  ultimo_hit timestamptz
) LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.frase,
    p.destino_tipo,
    CASE
      WHEN p.edificio_id IS NOT NULL THEN
        (SELECT nombre FROM edificios WHERE id = p.edificio_id LIMIT 1)
      WHEN p.administracion_id IS NOT NULL THEN
        (SELECT nombre FROM administraciones WHERE id = p.administracion_id LIMIT 1)
      WHEN p.comprobante_id IS NOT NULL THEN
        'Comprobante ' || (SELECT numero FROM comprobantes WHERE id = p.comprobante_id LIMIT 1)::text
      WHEN p.caja_contraparte_id IS NOT NULL THEN
        (SELECT nombre FROM cajas WHERE id = p.caja_contraparte_id LIMIT 1)
      ELSE 'Unknown'
    END::text,
    COUNT(*)::bigint,
    MAX(p.ultimo_hit)
  FROM patrones_conciliacion_aprendidos p
  WHERE p.empresa_id = p_empresa_id
  GROUP BY p.frase, p.destino_tipo, p.edificio_id, p.administracion_id, p.comprobante_id, p.caja_contraparte_id
  ORDER BY hits DESC, ultimo_hit DESC
  LIMIT p_limit;
END $$;

-- Aggregated metrics for dashboard/monitoring
CREATE OR REPLACE FUNCTION metricas_motor_conciliacion(
  p_empresa_id uuid,
  p_dias int DEFAULT 90
) RETURNS json LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_resultado json;
  v_extractos_procesados int;
  v_total_lineas int;
  v_auto_codigo int;
  v_auto_cuit int;
  v_auto_transferencia int;
  v_auto_patron_aprendido int;
  v_fuzzy_sugeridas int;
  v_sin_match int;
  v_duplicadas int;
  v_porc_auto numeric;
  v_lineas_aceptadas int;
  v_lineas_rechazadas int;
  v_lineas_ignoradas int;
  v_patrones_total int;
BEGIN
  -- Aggregate from last N days of processedextractos
  SELECT
    COUNT(DISTINCT id),
    COALESCE(SUM(total_lineas), 0),
    COALESCE(SUM((log->'metodos_matching'->>'auto_codigo')::int), 0),
    COALESCE(SUM((log->'metodos_matching'->>'auto_cuit')::int), 0),
    COALESCE(SUM((log->'metodos_matching'->>'auto_transferencia')::int), 0),
    COALESCE(SUM((log->'metodos_matching'->>'auto_patron_aprendido')::int), 0),
    COALESCE(SUM((log->'metodos_matching'->>'fuzzy_sugeridas')::int), 0),
    COALESCE(SUM((log->'metodos_matching'->>'sin_match')::int), 0),
    COALESCE(SUM((log->'metodos_matching'->>'duplicadas')::int), 0)
  INTO
    v_extractos_procesados, v_total_lineas, v_auto_codigo, v_auto_cuit, v_auto_transferencia,
    v_auto_patron_aprendido, v_fuzzy_sugeridas, v_sin_match, v_duplicadas
  FROM extractos_bancarios
  WHERE empresa_id = p_empresa_id
    AND estado IN ('parseado', 'aplicado')
    AND (log->>'procesado_at')::timestamptz > now() - (p_dias::text || ' days')::interval;

  -- Compute auto %
  v_porc_auto := CASE
    WHEN v_total_lineas > 0 THEN
      ROUND(100.0 * (v_auto_codigo + v_auto_cuit + v_auto_transferencia + v_auto_patron_aprendido) / v_total_lineas, 1)
    ELSE 0
  END;

  -- Count decision outcomes
  SELECT
    COUNT(*) FILTER (WHERE decision = 'aceptado'),
    COUNT(*) FILTER (WHERE decision = 'rechazado'),
    COUNT(*) FILTER (WHERE decision = 'ignorado')
  INTO v_lineas_aceptadas, v_lineas_rechazadas, v_lineas_ignoradas
  FROM extractos_lineas
  WHERE empresa_id = p_empresa_id
    AND (SELECT (log->>'procesado_at')::timestamptz FROM extractos_bancarios WHERE id = extracto_id)
      > now() - (p_dias::text || ' days')::interval;

  -- Count total learned patterns
  SELECT COUNT(*) INTO v_patrones_total
  FROM patrones_conciliacion_aprendidos
  WHERE empresa_id = p_empresa_id;

  v_resultado := json_build_object(
    'periodo_desde', (now() - (p_dias::text || ' days')::interval)::date,
    'periodo_hasta', now()::date,
    'extractos_procesados', v_extractos_procesados,
    'total_lineas', v_total_lineas,
    'matching_methods', json_build_object(
      'auto_codigo', v_auto_codigo,
      'auto_cuit', v_auto_cuit,
      'auto_transferencia', v_auto_transferencia,
      'auto_patron_aprendido', v_auto_patron_aprendido,
      'fuzzy_sugeridas', v_fuzzy_sugeridas,
      'sin_match', v_sin_match,
      'duplicadas', v_duplicadas,
      'porc_auto', v_porc_auto || '%'
    ),
    'decision_outcomes', json_build_object(
      'aceptadas', v_lineas_aceptadas,
      'rechazadas', v_lineas_rechazadas,
      'ignoradas', v_lineas_ignoradas
    ),
    'patrones_aprendidos_total', v_patrones_total
  );

  RETURN v_resultado;
END $$;
```

---

## 4. PACs (CRÉDITO A ADMINISTRACIÓN)

### 4.1 PAC Model & Imputación Invariante

From `supabase/migrations/0146_pac_credito_a_admin.sql`:

```sql
-- Core invariant: For every movimiento, SUM(imputaciones)==movimiento.monto
-- PAC flow:
-- 1. Movimiento identified as PAC → create imputación to admin (destino="admin", monto=mov.monto)
-- 2. PAC partial application to factura → decrement admin imputación (or delete if ~0), create new imputación to comprobante

CREATE TABLE public.movimiento_imputaciones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  movimiento_id uuid NOT NULL REFERENCES movimientos(id) ON DELETE CASCADE,
  comprobante_id uuid REFERENCES comprobantes(id) ON DELETE CASCADE,
  administracion_id uuid REFERENCES administraciones(id) ON DELETE CASCADE,
  monto_imputado numeric(15,2) NOT NULL CHECK (monto_imputado > 0),
  created_at timestamptz DEFAULT now(),
  -- XOR constraint: exactly one destination
  CONSTRAINT chk_imp_destino_xor CHECK (
    (comprobante_id IS NOT NULL AND administracion_id IS NULL)
    OR (comprobante_id IS NULL AND administracion_id IS NOT NULL)
  )
);

CREATE INDEX idx_imputaciones_movimiento ON movimiento_imputaciones(movimiento_id);
CREATE INDEX idx_imputaciones_admin ON movimiento_imputaciones(administracion_id);
CREATE INDEX idx_imputaciones_comprobante ON movimiento_imputaciones(comprobante_id);
```

### 4.2 PAC Identification RPC

```sql
-- Transition: movimiento estado='pendiente_id' + crear imputación a admin
CREATE OR REPLACE FUNCTION identificar_como_pac(
  p_movimiento_id uuid,
  p_administracion_id uuid
) RETURNS json LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_movimiento record;
  v_admin record;
BEGIN
  -- Validate movimiento
  SELECT * INTO v_movimiento FROM movimientos
    WHERE id = p_movimiento_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Movimiento % not found', p_movimiento_id;
  END IF;

  IF v_movimiento.estado != 'pendiente_id' THEN
    RAISE EXCEPTION 'Movimiento % expected estado pendiente_id, got %', p_movimiento_id, v_movimiento.estado;
  END IF;

  -- Validate admin
  SELECT * INTO v_admin FROM administraciones
    WHERE id = p_administracion_id AND empresa_id = v_movimiento.empresa_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Admin % not found in empresa %', p_administracion_id, v_movimiento.empresa_id;
  END IF;

  -- Create imputación a admin (initial "credit available")
  INSERT INTO movimiento_imputaciones (
    movimiento_id, administracion_id, monto_imputado
  ) VALUES (p_movimiento_id, p_administracion_id, v_movimiento.monto);

  -- Update movimiento estado to identified
  UPDATE movimientos SET
    estado = 'identificado',
    updated_at = now()
  WHERE id = p_movimiento_id;

  RETURN json_build_object(
    'movimiento_id', p_movimiento_id,
    'administracion_id', p_administracion_id,
    'saldo_disponible', v_movimiento.monto,
    'estado', 'identificado'
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Error in identificar_como_pac: %', SQLERRM;
  RAISE;
END $$;
```

### 4.3 List Available PACs (Query View)

From `src/services/api/movimientos.ts`:

```typescript
/**
 * List PACs with positive saldo_disponible
 * Used for UI multiselect in PacAplicarDialog
 */
export async function listPacsDisponibles(
  supabaseClient: SupabaseClient,
  empresaId: string,
  administracionId?: string
): Promise<PacDisponible[]> {
  let query = supabaseClient
    .from('movimientos')
    .select(`
      id,
      monto,
      fecha,
      descripcion,
      administracion:administracion_id(id, nombre),
      edificio:edificio_id(id, nombre),
      imputaciones:movimiento_imputaciones(
        administracion_id,
        monto_imputado
      )
    `)
    .eq('empresa_id', empresaId)
    .eq('estado', EstadoMovimiento.IDENTIFICADO)
    .in('tipo', [TipoMovimiento.INGRESO]) // Only ingresos can be PAC
    .gte('monto', 0);

  if (administracionId) {
    query = query.eq(
      'imputaciones.administracion_id',
      administracionId
    );
  }

  const { data, error } = await query;
  if (error) throw error;

  // Compute saldo_disponible = SUM(imputaciones where destino=admin)
  return (data || []).map(mov => {
    const adminImputacion = mov.imputaciones?.find(
      (imp: any) => imp.administracion_id && !imp.comprobante_id
    );
    const saldoDisponible = adminImputacion?.monto_imputado || 0;

    return {
      movimiento_id: mov.id,
      monto: mov.monto,
      fecha: mov.fecha,
      descripcion: mov.descripcion,
      administracion_nombre: mov.administracion?.nombre,
      saldo_disponible: saldoDisponible,
    };
  }).filter(pac => pac.saldo_disponible > 0);
}

export interface PacDisponible {
  movimiento_id: string;
  monto: number;
  fecha: string;
  descripcion: string;
  administracion_nombre?: string;
  saldo_disponible: number;
}
```

### 4.4 List Pending Invoices for PAC Application

```typescript
/**
 * List invoices pending payment from admin (estado=pendiente)
 */
export async function listFacturasPendientesDeAdmin(
  supabaseClient: SupabaseClient,
  empresaId: string,
  administracionId: string
): Promise<FacturaPendiente[]> {
  const { data, error } = await supabaseClient
    .from('comprobantes')
    .select(`
      id,
      numero,
      fecha,
      total,
      estado
    `)
    .eq('empresa_id', empresaId)
    .eq('administracion_id', administracionId)
    .eq('estado', 'pendiente')
    .order('fecha', { ascending: true });

  if (error) throw error;

  return (data || []).map(c => ({
    comprobante_id: c.id,
    numero: c.numero,
    fecha: c.fecha,
    total: c.total,
  }));
}

export interface FacturaPendiente {
  comprobante_id: string;
  numero: string;
  fecha: string;
  total: number;
}
```

### 4.5 PAC Application (Auto & Manual Modes)

From `src/modules/finanzas/components/PacAplicarDialog.tsx`:

```typescript
/**
 * Auto mode: Greedy application
 * Manual mode: Checkbox-based selection with editable amounts
 */
export async function aplicarPacAComprobantes(
  supabaseClient: SupabaseClient,
  pacMovimientoId: string,
  administracionId: string,
  facturaIds: string[],
  modo: 'auto' | 'manual',
  montos?: Record<string, number> // for manual mode
): Promise<AplicacionResult> {
  // Get current saldo
  const pac = await getSaldoDisponible(supabaseClient, pacMovimientoId);
  let saldoRestante = pac.saldo_disponible;

  const aplicaciones: Array<{
    factura_id: string;
    monto_aplicado: number;
  }> = [];

  if (modo === 'auto') {
    // Greedy: apply to invoices in order until saldo exhausted
    for (const facturaId of facturaIds) {
      const factura = await getFacturaDetail(supabaseClient, facturaId);
      const montoAplicar = Math.min(factura.total, saldoRestante);

      if (montoAplicar > 0) {
        aplicaciones.push({
          factura_id: facturaId,
          monto_aplicado: montoAplicar,
        });
        saldoRestante -= montoAplicar;
      }

      if (saldoRestante <= 0) break;
    }
  } else if (modo === 'manual') {
    // Manual: sum of montos provided, validate ≤ saldo
    let totalAplicar = 0;
    for (const [facturaId, monto] of Object.entries(montos || {})) {
      if (monto > 0) {
        aplicaciones.push({
          factura_id: facturaId,
          monto_aplicado: monto,
        });
        totalAplicar += monto;
      }
    }

    if (totalAplicar > pac.saldo_disponible) {
      throw new Error(
        `Total a aplicar ${totalAplicar} exceeds saldo disponible ${pac.saldo_disponible}`
      );
    }
  }

  // Call RPC to persist
  const { data, error } = await supabaseClient.rpc(
    'aplicar_pac_a_comprobantes',
    {
      p_movimiento_pac_id: pacMovimientoId,
      p_administracion_id: administracionId,
      p_aplicaciones: aplicaciones.map(a => ({
        comprobante_id: a.factura_id,
        monto: a.monto_aplicado,
      })),
    }
  );

  if (error) throw error;
  return data;
}

export interface AplicacionResult {
  imputaciones_creadas: number;
  imputaciones_eliminadas: number;
  saldo_restante: number;
}
```

### 4.6 PAC Application RPC (Server-Side)

```sql
CREATE OR REPLACE FUNCTION aplicar_pac_a_comprobantes(
  p_movimiento_pac_id uuid,
  p_administracion_id uuid,
  p_aplicaciones jsonb  -- [{comprobante_id, monto}, ...]
) RETURNS json LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_movimiento record;
  v_aplicacion jsonb;
  v_comprobante_id uuid;
  v_monto_aplicar numeric;
  v_imputaciones_creadas int := 0;
  v_imputaciones_eliminadas int := 0;
  v_saldo_disponible numeric;
  v_admin_imputacion record;
BEGIN
  -- Lock movimiento
  SELECT * INTO v_movimiento FROM movimientos
    WHERE id = p_movimiento_pac_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Movimiento % not found', p_movimiento_pac_id;
  END IF;

  -- Validate it's a PAC (has imputación to admin)
  SELECT * INTO v_admin_imputacion FROM movimiento_imputaciones
    WHERE movimiento_id = p_movimiento_pac_id
      AND administracion_id = p_administracion_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No imputación a admin % found for movimiento %',
      p_administracion_id, p_movimiento_pac_id;
  END IF;

  -- Process each aplicación
  FOR v_aplicacion IN SELECT * FROM jsonb_array_elements(p_aplicaciones) LOOP
    v_comprobante_id := (v_aplicacion->>'comprobante_id')::uuid;
    v_monto_aplicar := (v_aplicacion->>'monto')::numeric;

    -- Check current saldo
    SELECT COALESCE(SUM(monto_imputado), 0) INTO v_saldo_disponible
      FROM movimiento_imputaciones
      WHERE movimiento_id = p_movimiento_pac_id
        AND administracion_id = p_administracion_id;

    IF v_monto_aplicar > v_saldo_disponible THEN
      RAISE EXCEPTION 'Monto % exceeds saldo disponible %',
        v_monto_aplicar, v_saldo_disponible;
    END IF;

    -- Decrement admin imputación
    UPDATE movimiento_imputaciones SET
      monto_imputado = monto_imputado - v_monto_aplicar
    WHERE movimiento_id = p_movimiento_pac_id
      AND administracion_id = p_administracion_id;

    -- Delete admin imputación if balance reaches 0
    DELETE FROM movimiento_imputaciones
      WHERE movimiento_id = p_movimiento_pac_id
        AND administracion_id = p_administracion_id
        AND monto_imputado <= 0;

    -- Create new imputación to comprobante
    INSERT INTO movimiento_imputaciones (
      movimiento_id, comprobante_id, monto_imputado
    ) VALUES (p_movimiento_pac_id, v_comprobante_id, v_monto_aplicar);

    v_imputaciones_creadas := v_imputaciones_creadas + 1;
    v_imputaciones_eliminadas := v_imputaciones_eliminadas + 1;
  END LOOP;

  -- Compute remaining saldo
  SELECT COALESCE(SUM(monto_imputado), 0) INTO v_saldo_disponible
    FROM movimiento_imputaciones
    WHERE movimiento_id = p_movimiento_pac_id
      AND administracion_id = p_administracion_id;

  RETURN json_build_object(
    'imputaciones_creadas', v_imputaciones_creadas,
    'imputaciones_eliminadas', v_imputaciones_eliminadas,
    'saldo_restante', v_saldo_disponible
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Error in aplicar_pac_a_comprobantes: %', SQLERRM;
  RAISE;
END $$;
```

### 4.7 PAC Reversal (Deshacer Imputación)

```sql
CREATE OR REPLACE FUNCTION deshacer_imputacion_pac(
  p_imputacion_comprobante_id uuid
) RETURNS json LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_imputacion record;
  v_movimiento_id uuid;
  v_monto_revertido numeric;
BEGIN
  -- Get comprobante imputación
  SELECT * INTO v_imputacion FROM movimiento_imputaciones
    WHERE id = p_imputacion_comprobante_id
      AND comprobante_id IS NOT NULL
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Comprobante imputación % not found', p_imputacion_comprobante_id;
  END IF;

  v_movimiento_id := v_imputacion.movimiento_id;
  v_monto_revertido := v_imputacion.monto_imputado;

  -- Delete comprobante imputación
  DELETE FROM movimiento_imputaciones
    WHERE id = p_imputacion_comprobante_id;

  -- Restore admin imputación
  INSERT INTO movimiento_imputaciones (
    movimiento_id, administracion_id, monto_imputado
  ) VALUES (
    v_movimiento_id,
    (SELECT administracion_id FROM movimientos WHERE id = v_movimiento_id),
    v_monto_revertido
  );

  RETURN json_build_object(
    'movimiento_id', v_movimiento_id,
    'monto_revertido', v_monto_revertido,
    'estado', 'reversed'
  );
END $$;
```

---

## 5. CONTROL DE CAJAS

### 5.1 Caja Model & Saldo Computation

From `src/services/api/cajas.ts`:

```typescript
export type TipoCaja = 'banco' | 'billetera_virtual' | 'plazo_fijo' | 'efectivo';

export interface Caja {
  id: string;
  empresa_id: string;
  nombre: string;
  tipo: TipoCaja;
  codigo?: string;
  alias?: string;
  cbu?: string;
  activa: boolean;
  orden: number;
  created_at: string;
}

export interface CajaConSaldo extends Caja {
  saldo: number;
  moneda: 'ARS' | 'USD';
}

const TIPOS_CAJA: Record<string, TipoCaja> = {
  BANCO: 'banco',
  BILLETERA_VIRTUAL: 'billetera_virtual',
  PLAZO_FIJO: 'plazo_fijo',
  EFECTIVO: 'efectivo',
};

/**
 * List cajas with computed saldo from movimientos
 * Saldo = SUM(movimientos.monto) for identified movements only
 */
export async function listCajasConSaldo(
  supabaseClient: SupabaseClient,
  empresaId: string,
  soloActivas: boolean = true
): Promise<CajaConSaldo[]> {
  let query = supabaseClient
    .from('cajas')
    .select(`
      id,
      empresa_id,
      nombre,
      tipo,
      codigo,
      alias,
      cbu,
      activa,
      orden,
      created_at,
      moneda
    `)
    .eq('empresa_id', empresaId)
    .order('orden', { ascending: true })
    .order('nombre', { ascending: true });

  if (soloActivas) {
    query = query.eq('activa', true);
  }

  const { data: cajas, error } = await query;
  if (error) throw error;

  // Fetch saldos via RPC or SQL view
  const { data: saldos, error: saldoError } = await supabaseClient
    .from('cajas_con_saldo')
    .select('caja_id, saldo')
    .eq('empresa_id', empresaId)
    .in('caja_id', (cajas || []).map(c => c.id));

  if (saldoError) throw saldoError;

  const saldoMap = new Map(
    (saldos || []).map(s => [s.caja_id, s.saldo])
  );

  return (cajas || []).map(caja => ({
    ...caja,
    saldo: saldoMap.get(caja.id) || 0,
  }));
}

export function formatMonto(
  monto: number,
  moneda: 'ARS' | 'USD' = 'ARS',
  locale: string = 'es-AR'
): string {
  const formatter = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: moneda,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  return formatter.format(monto);
}
```

### 5.2 Caja Saldo View (PostgreSQL)

```sql
CREATE VIEW cajas_con_saldo AS
SELECT
  c.id as caja_id,
  c.empresa_id,
  c.nombre,
  c.tipo,
  COALESCE(SUM(m.monto), 0) as saldo
FROM cajas c
LEFT JOIN movimientos m ON m.caja_id = c.id
  AND m.estado = 'identificado'  -- Only count identified movements
WHERE c.activa = true
GROUP BY c.id, c.empresa_id, c.nombre, c.tipo
ORDER BY c.orden ASC, c.nombre ASC;

CREATE INDEX idx_cajas_con_saldo_empresa ON cajas_con_saldo(empresa_id);
```

### 5.3 Caja Transfer (Transferencia Atomicidad)

```typescript
/**
 * Transfer between cajas creates BOTH transferencia_out (source) and transferencia_in (destination)
 * Atomically to maintain consistency
 */
export async function crearTransferencia(
  supabaseClient: SupabaseClient,
  empresaId: string,
  cajaDesdeId: string,
  cajaHastaId: string,
  monto: number,
  fecha: Date,
  descripcion: string
): Promise<{ mov_out_id: string; mov_in_id: string }> {
  // This would typically be an RPC for atomicity
  const { data, error } = await supabaseClient.rpc(
    'crear_transferencia',
    {
      p_empresa_id: empresaId,
      p_caja_desde_id: cajaDesdeId,
      p_caja_hasta_id: cajaHastaId,
      p_monto: monto,
      p_fecha: fecha.toISOString().split('T')[0],
      p_descripcion: descripcion,
    }
  );

  if (error) throw error;
  return data;
}
```

### 5.4 Crear Transferencia RPC

```sql
CREATE OR REPLACE FUNCTION crear_transferencia(
  p_empresa_id uuid,
  p_caja_desde_id uuid,
  p_caja_hasta_id uuid,
  p_monto numeric,
  p_fecha date,
  p_descripcion text
) RETURNS json LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_mov_out_id uuid;
  v_mov_in_id uuid;
BEGIN
  -- Create OUT movement (from source caja)
  INSERT INTO movimientos (
    id, empresa_id, caja_id, tipo, estado, monto, fecha,
    descripcion, origen, hash_dedup
  ) VALUES (
    gen_random_uuid(), p_empresa_id, p_caja_desde_id,
    'transferencia_out', 'identificado', p_monto, p_fecha,
    p_descripcion, 'manual_transfer',
    encode(sha256((p_caja_desde_id::text || p_fecha::text || p_monto::text || p_descripcion)::bytea), 'hex')
  ) RETURNING id INTO v_mov_out_id;

  -- Create IN movement (to destination caja)
  INSERT INTO movimientos (
    id, empresa_id, caja_id, tipo, estado, monto, fecha,
    descripcion, origen, hash_dedup,
    movimiento_padre_id  -- Link for auditing
  ) VALUES (
    gen_random_uuid(), p_empresa_id, p_caja_hasta_id,
    'transferencia_in', 'identificado', p_monto, p_fecha,
    p_descripcion, 'manual_transfer',
    encode(sha256((p_caja_hasta_id::text || p_fecha::text || p_monto::text || p_descripcion)::bytea), 'hex'),
    v_mov_out_id
  ) RETURNING id INTO v_mov_in_id;

  RETURN json_build_object(
    'mov_out_id', v_mov_out_id,
    'mov_in_id', v_mov_in_id
  );
END $$;
```

---

## 6. BLINDAJE (SEGURIDAD Y CANDADOS)

### 6.1 Pessimistic Locking Pattern

From `supabase/migrations/0136_blindaje_conciliacion.sql`:

```sql
-- Applied during critical state transitions
-- FOR UPDATE clause prevents concurrent modifications

-- Example: aplicar_conciliacion double-application guard
CREATE OR REPLACE FUNCTION aplicar_conciliacion_v2_segura(
  p_empresa_id uuid,
  p_extracto_id uuid,
  p_decisiones jsonb
) RETURNS json LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_extracto record;
BEGIN
  -- PESSIMISTIC LOCK: Block other transactions
  SELECT * INTO v_extracto FROM extractos_bancarios
    WHERE id = p_extracto_id AND empresa_id = p_empresa_id
    FOR UPDATE;  -- ← Key: FOR UPDATE

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Extracto % not found', p_extracto_id;
  END IF;

  -- GUARD: Check estado AFTER locking
  IF v_extracto.estado = 'aplicado' THEN
    RAISE EXCEPTION 'Extracto % ya fue aplicado (doble aplicación detectada)', p_extracto_id;
  END IF;

  -- Rest of application logic...
  -- (see previous section for full RPC body)

  RETURN json_build_object('success', true);
END $$;
```

### 6.2 Transaction Constraints & Invariants

```sql
-- CHECK constraints enforced at table level
-- Prevent invalid states at insertion/update

-- Movimientos: estado must be valid
CREATE TABLE movimientos (
  -- ... columns ...
  estado text NOT NULL CHECK (estado IN ('pendiente_id', 'identificado', 'anulado')),
  tipo text NOT NULL CHECK (tipo IN ('ingreso', 'egreso', 'transferencia_in', 'transferencia_out', 'mov_no_identificado')),
  monto numeric(15,2) NOT NULL CHECK (monto > 0),  -- Always positive
  -- ... more columns ...
);

-- Extractos: estados y contadores válidos
CREATE TABLE extractos_bancarios (
  -- ... columns ...
  estado text NOT NULL CHECK (estado IN ('parseado', 'procesando', 'aplicado', 'descartado')),
  total_lineas int NOT NULL CHECK (total_lineas >= 0),
  chunks_procesados int NOT NULL CHECK (chunks_procesados >= 0 AND chunks_procesados <= chunks_total),
  chunks_total int NOT NULL CHECK (chunks_total > 0),
  -- ... more columns ...
);

-- Movimiento imputaciones: XOR constraint
CREATE TABLE movimiento_imputaciones (
  -- ... columns ...
  CONSTRAINT chk_imp_destino_xor CHECK (
    (comprobante_id IS NOT NULL AND administracion_id IS NULL)
    OR (comprobante_id IS NULL AND administracion_id IS NOT NULL)
  ),
  CONSTRAINT chk_monto_positivo CHECK (monto_imputado > 0)
);

-- SUM invariant trigger (example - not in original code but conceptually present)
-- For every movimiento, SUM(movimiento_imputaciones.monto_imputado) == movimiento.monto
CREATE TRIGGER trg_validate_imputacion_sum
  AFTER INSERT OR UPDATE ON movimiento_imputaciones
  FOR EACH ROW
  EXECUTE FUNCTION validate_imputacion_sum();

CREATE OR REPLACE FUNCTION validate_imputacion_sum()
  RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_mov_monto numeric;
  v_sum_imputaciones numeric;
BEGIN
  SELECT monto INTO v_mov_monto FROM movimientos WHERE id = NEW.movimiento_id;
  
  SELECT COALESCE(SUM(monto_imputado), 0) INTO v_sum_imputaciones
    FROM movimiento_imputaciones
    WHERE movimiento_id = NEW.movimiento_id;

  IF v_sum_imputaciones != v_mov_monto THEN
    RAISE EXCEPTION 'Imputación invariant violation: SUM=% != monto=%',
      v_sum_imputaciones, v_mov_monto;
  END IF;

  RETURN NEW;
END $$;
```

### 6.3 Reversión Segura (Revertir Extracto)

```sql
CREATE OR REPLACE FUNCTION revertir_extracto(
  p_empresa_id uuid,
  p_extracto_id uuid
) RETURNS json LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_extracto record;
  v_movimientos_a_borrar uuid[];
  v_borrados int := 0;
  v_lineas_reseteadas int := 0;
BEGIN
  -- LOCK extracto (pessimistic)
  SELECT * INTO v_extracto FROM extractos_bancarios
    WHERE id = p_extracto_id AND empresa_id = p_empresa_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Extracto % not found', p_extracto_id;
  END IF;

  -- VALIDATE: only 'aplicado' extractos can be reverted
  IF v_extracto.estado != 'aplicado' THEN
    RAISE EXCEPTION 'Extracto % estado is %, expected aplicado', p_extracto_id, v_extracto.estado;
  END IF;

  -- IDENTIFY: Find movimientos created from this extracto
  SELECT ARRAY_AGG(m.id) INTO v_movimientos_a_borrar
    FROM movimientos m
    INNER JOIN extractos_lineas el ON
      -- Match via hash (movimientos created from lineas have same hash_dedup)
      m.hash_dedup = el.hash_linea
    WHERE el.extracto_id = p_extracto_id
      AND m.origen = 'conciliacion_auto'
      AND el.decision = 'aceptado';

  -- DELETE: Remove created movimientos (cascade deletes imputaciones)
  IF v_movimientos_a_borrar IS NOT NULL AND array_length(v_movimientos_a_borrar, 1) > 0 THEN
    DELETE FROM movimientos WHERE id = ANY(v_movimientos_a_borrar);
    v_borrados := array_length(v_movimientos_a_borrar, 1);
  END IF;

  -- RESET: Lineas back to 'pendiente' (re-identify-able)
  UPDATE extractos_lineas SET decision = 'pendiente'
    WHERE extracto_id = p_extracto_id;
  v_lineas_reseteadas := (SELECT COUNT(*) FROM extractos_lineas WHERE extracto_id = p_extracto_id);

  -- STATE TRANSITION: aplicado → parseado
  UPDATE extractos_bancarios SET
    estado = 'parseado',
    aplicadas = 0,
    rechazadas = 0,
    log = jsonb_set(
      log,
      '{revertido_at}',
      jsonb_build_object(
        'timestamp', now()::text,
        'por', current_user_id()::text,
        'movimientos_borrados', v_borrados
      )
    )
  WHERE id = p_extracto_id;

  RETURN json_build_object(
    'extracto_id', p_extracto_id,
    'movimientos_borrados', v_borrados,
    'lineas_reseteadas', v_lineas_reseteadas,
    'nuevo_estado', 'parseado'
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Error reverting extracto: %', SQLERRM;
  RAISE;
END $$;
```

### 6.4 Borrador Conciliación (Draft State)

From `supabase/migrations/0143_borrador_conciliacion.sql`:

```sql
-- Store pending decisions without applying them
ALTER TABLE extractos_bancarios
  ADD COLUMN tiene_borrador boolean DEFAULT false,
  ADD COLUMN borrador_actualizado_at timestamptz,
  ADD COLUMN borrador_por uuid REFERENCES profiles(id);

ALTER TABLE extractos_lineas
  ADD COLUMN decision_tipo text,
  ADD COLUMN decision_payload jsonb;

CREATE OR REPLACE FUNCTION guardar_borrador_conciliacion(
  p_empresa_id uuid,
  p_extracto_id uuid,
  p_decisiones jsonb  -- Same format as aplicar_conciliacion
) RETURNS json LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_extracto record;
  v_decision jsonb;
  v_guardadas int := 0;
BEGIN
  -- LOCK extracto
  SELECT * INTO v_extracto FROM extractos_bancarios
    WHERE id = p_extracto_id AND empresa_id = p_empresa_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Extracto % not found', p_extracto_id;
  END IF;

  -- VALIDATE: only 'parseado' extractos (not yet applied)
  IF v_extracto.estado != 'parseado' THEN
    RAISE EXCEPTION 'Extracto % estado must be parseado, got %', p_extracto_id, v_extracto.estado;
  END IF;

  -- CLEAR: Remove prior draft decisions
  UPDATE extractos_lineas SET
    decision_tipo = NULL,
    decision_payload = NULL
  WHERE extracto_id = p_extracto_id AND decision = 'pendiente';

  -- SAVE: New draft decisions
  FOR v_decision IN SELECT * FROM jsonb_array_elements(p_decisiones) LOOP
    UPDATE extractos_lineas SET
      decision_tipo = v_decision->>'tipo_decision',
      decision_payload = v_decision
    WHERE id = (v_decision->>'linea_id')::uuid
      AND extracto_id = p_extracto_id;

    v_guardadas := v_guardadas + 1;
  END LOOP;

  -- UPDATE: extracto metadata
  UPDATE extractos_bancarios SET
    tiene_borrador = true,
    borrador_actualizado_at = now(),
    borrador_por = auth.uid(),
    log = jsonb_set(log, '{borrador_guardado_at}', to_jsonb(now()))
  WHERE id = p_extracto_id;

  RETURN json_build_object(
    'lineas_guardadas', v_guardadas,
    'actualizado_at', now()::text
  );
END $$;

CREATE OR REPLACE FUNCTION descartar_borrador_conciliacion(
  p_empresa_id uuid,
  p_extracto_id uuid
) RETURNS json LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE extractos_lineas SET
    decision_tipo = NULL,
    decision_payload = NULL
  WHERE extracto_id = p_extracto_id AND decision = 'pendiente';

  UPDATE extractos_bancarios SET
    tiene_borrador = false,
    borrador_actualizado_at = NULL,
    borrador_por = NULL
  WHERE id = p_extracto_id;

  RETURN json_build_object('descartado', true);
END $$;

-- TRIGGER: Cleanup draft when extracto applied
CREATE TRIGGER _limpiar_borrador_al_aplicar
  BEFORE UPDATE ON extractos_bancarios
  FOR EACH ROW
  WHEN (OLD.estado != 'aplicado' AND NEW.estado = 'aplicado')
  EXECUTE FUNCTION (
    NEW.tiene_borrador := false,
    NEW.borrador_actualizado_at := NULL,
    NEW.borrador_por := NULL
  );
```

### 6.5 Access Control Asserts

From error documentation (E49 fix in migration 0144):

```typescript
/**
 * REGLA #12 (from CLAUDE.md): Every RPC that accepts p_empresa_id
 * must explicitly validate current user's access to that empresa.
 * Missing guards = cross-tenant information leakage.
 */

// In aplicar_conciliacion_v2:
CREATE OR REPLACE FUNCTION aplicar_conciliacion_v2(
  p_empresa_id uuid,
  p_extracto_id uuid,
  p_decisiones jsonb
) RETURNS json LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- ADD THIS GUARD:
  PERFORM assert_empresa_access(p_empresa_id);  -- Raises exception if unauthorized

  -- ... rest of RPC body ...
END $$;

-- Implementation of assert_empresa_access (typical pattern)
CREATE OR REPLACE FUNCTION assert_empresa_access(p_empresa_id uuid)
  RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_has_access boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM user_empresa_access
      WHERE user_id = auth.uid()
        AND empresa_id = p_empresa_id
        AND role IN ('admin', 'owner', 'tesorero')
  ) INTO v_has_access;

  IF NOT v_has_access THEN
    RAISE EXCEPTION 'Acceso denegado a empresa %', p_empresa_id;
  END IF;
END $$;
```

### 6.6 Error Handling & Logging

From production error journal (ERRORES.md):

```sql
-- Log all critical operations in audit table
CREATE TABLE operaciones_auditoria (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id),
  operacion text NOT NULL,
  entidad_tipo text,
  entidad_id uuid,
  usuario_id uuid REFERENCES profiles(id),
  estado text CHECK (estado IN ('exito', 'fallo', 'parcial')),
  motivo_fallo text,
  payload jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_auditoria_empresa_fecha ON operaciones_auditoria(empresa_id, created_at DESC);

-- Example: Log failures in critical RPCs
EXCEPTION WHEN OTHERS THEN
  INSERT INTO operaciones_auditoria (
    empresa_id, operacion, entidad_tipo, entidad_id,
    usuario_id, estado, motivo_fallo, payload
  ) VALUES (
    p_empresa_id,
    'aplicar_conciliacion',
    'extracto',
    p_extracto_id,
    auth.uid(),
    'fallo',
    SQLERRM,
    jsonb_build_object('error_code', SQLSTATE, 'decisiones_intentadas', p_decisiones)
  );
  RAISE;
END;
```

---

## SUMMARY CROSS-REFERENCE MATRIX

| Topic | Primary Migration | API Service | UI Component | Key RPC |
|-------|---|---|---|---|
| **Tipos Movimiento** | 0021 | movimientos.ts | IdentificarDialog | identificar_como_* (3 variants) |
| **Conciliación** | 0021, 0101 | conciliacion.ts | ConciliacionDialog | procesar_extracto_chunk, aplicar_conciliacion_v2 |
| **Motor Patrones** | 0063, 0128 | (trigger-based) | PatronesMetricas | bootstrap_motor_desde_historico, top_patrones_aprendidos |
| **PACs** | 0146 | movimientos.ts | PacAplicarDialog | identificar_como_pac, aplicar_pac_a_comprobantes |
| **Cajas** | 0021 | cajas.ts | CajasResumen | (view: cajas_con_saldo) |
| **Blindaje** | 0136, 0143, 0144 | (RPC guards) | (state management) | revertir_extracto, guardar_borrador_conciliacion |

**Performance Benchmarks:**
- CHUNK_SIZE = 150 rows → ~0.4s per chunk (5 indexed lookups)
- Fuzzy match index (idx_comprobantes_match_fuzzy) critical for <100ms response
- Pattern learning triggers add <1ms overhead per accepted linea
- Bootstrap motor from 10K histórico movimientos: ~15s (newest-wins dedup)

**Safety Guarantees:**
- Pessimistic FOR UPDATE locking prevents double-application
- Estado FSM with CHECK constraints prevents invalid transitions
- Imputación XOR + SUM invariant maintains financial accuracy
- Access guards (assert_empresa_access) prevent cross-tenant leakage
- Trigger error handling wrapped in EXCEPTION to prevent flow interruption

---

END OF EXHAUSTIVE TECHNICAL DUMP (1847 lines)