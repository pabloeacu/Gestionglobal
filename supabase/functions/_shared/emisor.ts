// _shared/emisor.ts · Helper para resolver el emisor ARCA correcto desde
// edge functions. Cita DGG-31 (mig 0159 unificación arca_emisores).
//
// Patrón:
//   - Si la edge fn recibe `emisor_id` (UUID), lo busca por id.
//   - Si no, devuelve el `es_default = true && activo = true` más viejo.
//   - Tira Error si no encuentra ninguno o si está archivado.
//
// Todas las edge fns ARCA deben llamar este helper en vez de leer
// `arca_config` (singleton legacy) o `config_global.cuit`.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.46.1';

export type Ambiente = 'homologacion' | 'produccion';

export interface EmisorRow {
  id: string;
  nombre: string;
  cuit: string | null;
  razon_social: string;
  condicion_iva: string;
  domicilio_fiscal: string | null;
  ambiente: Ambiente;
  csr_b64: string | null;
  key_b64: string | null;
  cert_b64: string | null;
  cert_alias: string | null;
  cert_subido_at: string | null;
  cert_valido_desde: string | null;
  cert_valido_hasta: string | null;
  punto_venta_default: number;
  es_default: boolean;
  activo: boolean;
}

/**
 * Normaliza ambiente almacenado a vocabulario UX. La columna `arca_emisores.ambiente`
 * acepta ('test','prod','homologacion','produccion') por compat con seed viejo.
 * Las APIs WSAA/WSFE siempre usan 'homologacion'/'produccion'.
 */
export function normalizarAmbiente(a: string | null | undefined): Ambiente {
  if (a === 'produccion' || a === 'prod') return 'produccion';
  return 'homologacion'; // default conservador
}

/**
 * Resuelve un emisor ARCA. Lanza Error si no se encuentra.
 *
 * @param admin client supabase con SERVICE_ROLE
 * @param emisorId opcional · si viene, busca por id. Si no, usa es_default
 * @returns la fila del emisor con ambiente normalizado
 */
export async function resolverEmisor(
  admin: SupabaseClient,
  emisorId?: string | null,
): Promise<EmisorRow> {
  const baseSelect = 'id, nombre, cuit, razon_social, condicion_iva, domicilio_fiscal, ambiente, csr_b64, key_b64, cert_b64, cert_alias, cert_subido_at, cert_valido_desde, cert_valido_hasta, punto_venta_default, es_default, activo';

  if (emisorId) {
    const { data, error } = await admin
      .from('arca_emisores')
      .select(baseSelect)
      .eq('id', emisorId)
      .maybeSingle();
    if (error) throw new Error(`Error resolviendo emisor ${emisorId}: ${error.message}`);
    if (!data) throw new Error(`Emisor ${emisorId} no encontrado`);
    if (!(data as EmisorRow).activo) throw new Error(`Emisor "${(data as EmisorRow).nombre}" está archivado`);
    return { ...(data as EmisorRow), ambiente: normalizarAmbiente((data as EmisorRow).ambiente) };
  }

  // Sin id → es_default
  const { data, error } = await admin
    .from('arca_emisores')
    .select(baseSelect)
    .eq('es_default', true)
    .eq('activo', true)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Error resolviendo emisor default: ${error.message}`);
  if (!data) throw new Error('No hay emisor ARCA default cargado. Creá uno en /gerencia/configuracion/emisores.');
  return { ...(data as EmisorRow), ambiente: normalizarAmbiente((data as EmisorRow).ambiente) };
}
