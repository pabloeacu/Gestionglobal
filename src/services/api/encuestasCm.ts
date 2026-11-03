// API del export de encuestas + digest al Community Manager (DGG-240).
// Regla 4: ningún componente toca supabase.from() / functions.invoke() directo.

import { supabase } from '@/lib/supabase';
import { ok, fail, type ApiResponse } from '@/lib/errors';
import type { Database } from '@/types/database';

export type EncuestaCmRun = Database['public']['Tables']['encuesta_cm_runs']['Row'];

// supabase.functions.invoke, ante un 4xx/5xx, setea un FunctionsHttpError con
// mensaje genérico; el error real del edge ({error:'...'}) vive en error.context.
async function edgeErrMsg(error: unknown, fallback: string): Promise<string> {
  try {
    const ctx = (error as { context?: Response })?.context;
    if (ctx && typeof ctx.json === 'function') {
      const body = await ctx.json();
      if (body?.error) return String(body.error);
    }
  } catch { /* cuerpo no-JSON */ }
  return (error as { message?: string })?.message || fallback;
}

export interface EncuestaCmEstado {
  activo: boolean;
  emails: string;
  cada_dias: number;
  cubierto_hasta: string | null;
  ultimo_envio_at: string | null;
  proximo_envio_at: string | null;
  due: boolean;
  corte: string;
  preview: { cursos: number; respuestas: number; publicables: number };
}

/** Estado del digest periódico + preview de la ventana pendiente. */
export async function getEncuestaCmEstado(): Promise<ApiResponse<EncuestaCmEstado>> {
  const { data, error } = await supabase.rpc('encuesta_cm_estado');
  if (error) return fail('ENC_CM_ESTADO', error.message, error);
  return ok(data as unknown as EncuestaCmEstado);
}

/** Config del digest (sólo gerente por RLS de config_global). */
export async function setEncuestaCmConfig(
  patch: { emails?: string; activo?: boolean; cada_dias?: number },
): Promise<ApiResponse<true>> {
  const upd: Database['public']['Tables']['config_global']['Update'] = {};
  if (patch.emails !== undefined) upd.encuesta_cm_emails = patch.emails;
  if (patch.activo !== undefined) upd.encuesta_cm_activo = patch.activo;
  if (patch.cada_dias !== undefined) upd.encuesta_cm_cada_dias = patch.cada_dias;
  // .select() para confirmar que el UPDATE tocó la fila (si RLS lo bloquea,
  // supabase-js NO devuelve error con 0 filas → reportaría "guardado" en falso).
  const { data, error } = await supabase.from('config_global').update(upd).eq('id', 1).select('id');
  if (error) return fail('ENC_CM_CFG', error.message, error);
  if (!data || data.length === 0) return fail('ENC_CM_CFG', 'No se aplicó el cambio (sin permisos de gerencia).');
  return ok(true);
}

export interface ExportFiles {
  pdf_b64?: string; pdf_filename?: string;
  xlsx_b64?: string; xlsx_filename?: string;
}

/** Descarga manual (gerencia): genera el PDF/Excel de UNA encuesta en el rango. */
export async function exportarEncuestaManual(p: {
  encuestaId: string;
  desde: string | null;
  hasta: string | null;
  formato: 'pdf' | 'xlsx' | 'both';
}): Promise<ApiResponse<ExportFiles>> {
  const { data, error } = await supabase.functions.invoke('encuesta-export', {
    body: { mode: 'single', encuesta_id: p.encuestaId, desde: p.desde, hasta: p.hasta, formato: p.formato },
  });
  if (error) return fail('ENC_EXPORT', await edgeErrMsg(error, 'No pudimos generar el export'), error);
  const d = data as (ExportFiles & { ok?: boolean; error?: string }) | null;
  if (!d?.ok) return fail('ENC_EXPORT', d?.error ?? 'No pudimos generar el export');
  return ok(d);
}

export interface DigestResult {
  cursos?: number; respuestas?: number; publicables?: number;
  sin_novedad?: boolean; skipped?: string; overall?: string;
}

/** Dispara el digest al CM ahora (gerente, forzado). */
export async function enviarDigestCmAhora(): Promise<ApiResponse<DigestResult>> {
  const { data, error } = await supabase.functions.invoke('encuesta-export', {
    body: { mode: 'digest', force: true },
  });
  if (error) return fail('ENC_CM_ENVIO', await edgeErrMsg(error, 'No pudimos enviar el resumen'), error);
  const d = data as (DigestResult & { ok?: boolean; error?: string }) | null;
  if (!d?.ok) return fail('ENC_CM_ENVIO', d?.error ?? 'No pudimos enviar el resumen');
  return ok(d);
}

export async function listEncuestaCmRuns(limit = 10): Promise<ApiResponse<EncuestaCmRun[]>> {
  const { data, error } = await supabase
    .from('encuesta_cm_runs')
    .select('*')
    .order('run_at', { ascending: false })
    .limit(limit);
  if (error) return fail('ENC_CM_RUNS', error.message, error);
  return ok((data ?? []) as EncuestaCmRun[]);
}

const MIME = {
  pdf: 'application/pdf',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
} as const;

/** Convierte un base64 (binario) en Blob y dispara la descarga en el browser. */
export function descargarB64(b64: string, filename: string, tipo: 'pdf' | 'xlsx'): void {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const blob = new Blob([bytes], { type: MIME[tipo] });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Diferido: revocar sincrónicamente puede cancelar la descarga en algunos browsers (Safari).
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

/**
 * Convierte el par (desde, hasta) de inputs date (YYYY-MM-DD, hora Argentina)
 * en el rango [desdeISO, hastaISO) que espera el backend. hasta es EXCLUSIVO,
 * por eso se toma el inicio del día siguiente al "hasta" elegido.
 */
export function rangoAIso(desde: string, hasta: string): { desde: string | null; hasta: string | null } {
  const d = desde ? new Date(`${desde}T00:00:00-03:00`).toISOString() : null;
  // hasta es EXCLUSIVO → +24h exactas al inicio del día "hasta" en ART (ART no
  // tiene DST, así que +86400000ms = la próxima medianoche ART, independiente de
  // la timezone del browser; evitamos setDate() que opera en wall-clock local).
  const h = hasta ? new Date(new Date(`${hasta}T00:00:00-03:00`).getTime() + 86400000).toISOString() : null;
  return { desde: d, hasta: h };
}
