// src/services/api/tramix.ts
// DGG-46 · Cliente del subsistema TRAMIX (consulta de expedientes DPPJ-PBA).
// Llama a la Edge Function `tramix-consulta` (regla 4: nada de supabase.from acá;
// todo va por la edge fn aislada). El legajo se deriva server-side de la
// administración del usuario — el front NUNCA lo manda.

import { supabase } from '@/lib/supabase';
import { extractEdgeFnError } from '@/lib/errors';

export type TramixDetalleRef = { o: string; t: string; n: string; a: string };

export type TramixExpediente = {
  legajo: string;
  numero: string;
  alcance: string;
  denominacion: string;
  tramite: string;
  estado: string;
  fecha: string;
  detalle_ref: TramixDetalleRef | null;
};

export type TramixResultado =
  | 'OK' | 'NOT_FOUND'
  | 'SIN_LEGAJO' | 'SIN_ADMIN'
  | 'RATE_LIMITED' | 'CIRCUIT_OPEN'
  | 'TRAMIX_DOWN' | 'TIMEOUT' | 'PARSE_ERROR' | 'TC_BLOCKED'
  | 'NO_AUTH' | 'FORBIDDEN' | 'INVALID' | 'ERROR';

export type TramixConsultaResp = {
  resultado: TramixResultado;
  legajo?: string;
  titular?: string;
  expedientes?: TramixExpediente[];
  desde_cache?: boolean;
  consultado_at?: string;
  throttle_note?: string;
  wait_ms?: number;
  retry_at?: string;
};

export type TramixActuacion = { fecha: string; extracto: string; estado: string; actIdx: string | null };
export type TramixDetalle = { header: Record<string, string>; actuaciones: TramixActuacion[] };

export type TramixDetalleResp = {
  resultado: TramixResultado;
  detalle?: TramixDetalle;
  desde_cache?: boolean;
  consultado_at?: string;
  throttle_note?: string;
  wait_ms?: number;
  retry_at?: string;
};

type Ok<T> = { ok: true; data: T };
type Fail = { ok: false; error: string };

/** Consulta la lista de expedientes del legajo del usuario autenticado. */
export async function consultarTramix(force = false): Promise<Ok<TramixConsultaResp> | Fail> {
  const { data, error } = await supabase.functions.invoke<TramixConsultaResp>('tramix-consulta', {
    body: { action: 'consultar', force },
  });
  if (error) return { ok: false, error: await extractEdgeFnError(error) };
  return { ok: true, data: data as TramixConsultaResp };
}

/** Trae el detalle (header + actuaciones) de un expediente del propio legajo. */
export async function consultarTramixDetalle(ref: TramixDetalleRef, force = false): Promise<Ok<TramixDetalleResp> | Fail> {
  const { data, error } = await supabase.functions.invoke<TramixDetalleResp>('tramix-consulta', {
    body: { action: 'detalle', detalle_ref: ref, force },
  });
  if (error) return { ok: false, error: await extractEdgeFnError(error) };
  return { ok: true, data: data as TramixDetalleResp };
}

// ── Detalle de actuación + descarga de documento (tramix-doc-proxy) ──────────

export type TramixActuacionDetalle = {
  extracto_actuacion: string;
  fecha_firma: string;
  texto: string;
  tiene_documento: boolean;
};
export type TramixActuacionResp = {
  resultado: TramixResultado;
  actuacion?: TramixActuacionDetalle;
  desde_cache?: boolean;
  consultado_at?: string;
};
export type TramixDocumentoResp = {
  resultado: TramixResultado | 'SIN_DOCUMENTO';
  url?: string;
  nombre?: string;
};

/** Trae el detalle de una actuación (texto completo + extracto + fecha de firma). */
export async function consultarTramixActuacion(
  ref: TramixDetalleRef,
  actIdx: string,
  force = false,
): Promise<Ok<TramixActuacionResp> | Fail> {
  const { data, error } = await supabase.functions.invoke<TramixActuacionResp>('tramix-doc-proxy', {
    body: { action: 'actuacion', detalle_ref: ref, actIdx, force },
  });
  if (error) return { ok: false, error: await extractEdgeFnError(error) };
  return { ok: true, data: data as TramixActuacionResp };
}

/** Pide el documento (.doc) de una actuación → URL firmada de Storage (5 min). */
export async function descargarTramixDocumento(
  ref: TramixDetalleRef,
  actIdx: string,
  force = false,
): Promise<Ok<TramixDocumentoResp> | Fail> {
  const { data, error } = await supabase.functions.invoke<TramixDocumentoResp>('tramix-doc-proxy', {
    body: { action: 'documento', detalle_ref: ref, actIdx, force },
  });
  if (error) return { ok: false, error: await extractEdgeFnError(error) };
  return { ok: true, data: data as TramixDocumentoResp };
}

/** Dispara la descarga de una URL (signed URL con content-disposition attachment). */
export function triggerDownload(url: string, nombre?: string) {
  const a = document.createElement('a');
  a.href = url;
  if (nombre) a.download = nombre;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// ── helpers de presentación ──────────────────────────────────────────────────

/** URL oficial de la Mesa de Entradas Virtual (salvavidas / deep-link). */
export const TRAMIX_URL_OFICIAL = 'http://tramix.persjuri.gba.gov.ar:8080/TRAMIX/';

/** Color de badge por estado conocido (lista no cerrada → default neutro). */
export function estadoTone(estado: string): { bg: string; text: string; dot: string } {
  const e = (estado || '').toUpperCase();
  if (e.includes('INSCRIPTO') || e.includes('RESUEL') || e.includes('APROB')) return { bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-500' };
  if (e.includes('OBSERVAD')) return { bg: 'bg-amber-50', text: 'text-amber-700', dot: 'bg-amber-500' };
  if (e.includes('NOTIFIC')) return { bg: 'bg-sky-50', text: 'text-sky-700', dot: 'bg-sky-500' };
  if (e.includes('INICIAD') || e.includes('EN TRAMITE') || e.includes('EN TRÁMITE')) return { bg: 'bg-blue-50', text: 'text-blue-700', dot: 'bg-blue-500' };
  if (e.includes('ARCHIV') || e.includes('RECHAZ') || e.includes('BAJA')) return { bg: 'bg-rose-50', text: 'text-rose-700', dot: 'bg-rose-500' };
  return { bg: 'bg-slate-100', text: 'text-slate-700', dot: 'bg-slate-400' };
}
