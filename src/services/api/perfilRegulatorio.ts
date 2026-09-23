import { supabase } from '@/lib/supabase';
import { ok, fail, type ApiResponse } from '@/lib/errors';
import type { Database } from '@/types/database';

export type PerfilRegulatorioRow = Database['public']['Tables']['perfil_regulatorio']['Row'];

// Agenda Fase 1 (DGG-195) — perfil regulatorio con NIVELES DE CERTEZA.
// La plataforma es la fuente CONFIRMADA; `perfil_regulatorio` guarda lo DECLARADO
// por el cliente/gerencia; el resto se INFIERE o queda DESCONOCIDO. Nunca afirmar
// una presunción. Todo query vive acá (R4); write siempre por la RPC definer.

export type CertezaDato = 'confirmado' | 'declarado' | 'inferido' | 'desconocido';

export interface HechoConCerteza {
  fecha: string | null;
  certeza: CertezaDato;
}

export interface PerfilRegulatorio {
  administracion_id: string;
  jurisdiccion: 'rpac' | 'rpa' | null;
  matriculado: { valor: boolean; certeza: CertezaDato };
  matricula: {
    nro: string | null;
    nro_certeza: CertezaDato;
    fecha: string | null;
    fecha_certeza: CertezaDato;
  };
  ultima_renovacion: HechoConCerteza;
  proxima_renovacion: HechoConCerteza;
  ultimo_curso_actualizacion: HechoConCerteza;
  proximo_curso_actualizacion: HechoConCerteza;
  ultima_ddjj: HechoConCerteza;
  proxima_ddjj: HechoConCerteza;
  ultimo_certificado: HechoConCerteza;
  proximo_certificado: HechoConCerteza;
  ultima_consultoria: HechoConCerteza;
  no_requiere: Record<string, { motivo?: string; fecha?: string }>;
  completitud_pct: number;
  generated_at: string;
}

export async function getPerfilRegulatorio(
  administracionId: string,
): Promise<ApiResponse<PerfilRegulatorio>> {
  const { data, error } = await supabase.rpc('perfil_regulatorio_get', {
    p_administracion_id: administracionId,
  });
  if (error) return fail('PERFIL_REG_GET', error.message, error);
  return ok(data as unknown as PerfilRegulatorio);
}

// Fila CRUDA de datos declarados (para prellenar el editor: lo declarado, no lo
// mergeado con la fuente confirmada). Staff lee cualquiera; el cliente su propia
// fila (RLS). Devuelve null si nunca se declaró nada.
export async function getPerfilRegulatorioDeclarado(
  administracionId: string,
): Promise<ApiResponse<PerfilRegulatorioRow | null>> {
  const { data, error } = await supabase
    .from('perfil_regulatorio')
    .select('*')
    .eq('administracion_id', administracionId)
    .maybeSingle();
  if (error) return fail('PERFIL_REG_DECLARADO_GET', error.message, error);
  return ok(data);
}

// Datos que el cliente/gerencia ANCLA como declarados. Los NULL no borran (COALESCE
// en la RPC); `no_requiere` mergea shallow por servicio (mandar el objeto completo).
export interface DeclararPerfilInput {
  administracionId: string;
  jurisdiccion?: 'rpac' | 'rpa' | null;
  matriculaFecha?: string | null;
  matriculaNro?: string | null;
  ultimaRenovacion?: string | null;
  ultimoCursoActualizacion?: string | null;
  ultimaDdjj?: string | null;
  ultimaConsultoria?: string | null;
  ultimoCertificado?: string | null;
  noRequiere?: Record<string, { motivo?: string; fecha?: string }> | null;
  notas?: string | null;
}

// Preview de ofrecimientos por-admin (panorama al cierre). Usa el MISMO helper de
// elegibilidad que el motor (sin drift). SOLO LECTURA; R12 en la RPC.
export interface OfrecimientoPreviewItem {
  elegible: boolean;
  no_requiere: boolean;
}
export interface OfrecimientosPreview {
  generated_at: string;
  certificado: OfrecimientoPreviewItem;
  consultoria: OfrecimientoPreviewItem;
  curso_actualizacion: OfrecimientoPreviewItem;
  ddjj: OfrecimientoPreviewItem;
}

export async function getOfrecimientosPreview(
  administracionId: string,
): Promise<ApiResponse<OfrecimientosPreview>> {
  const { data, error } = await supabase.rpc('gg_ofrecimientos_preview', {
    p_administracion_id: administracionId,
  });
  if (error) return fail('OFREC_PREVIEW', error.message, error);
  return ok(data as unknown as OfrecimientosPreview);
}

// REEMPLAZA el objeto `no_requiere` completo (permite QUITAR una opción — el merge
// de `declarar` sólo agrega/pisa). El caller manda el set COMPLETO de opt-outs vigentes.
export type NoRequiereMap = Record<string, { motivo?: string; fecha?: string }>;

export async function setPerfilNoRequiere(
  administracionId: string,
  noRequiere: NoRequiereMap,
): Promise<ApiResponse<null>> {
  const { error } = await supabase.rpc('perfil_regulatorio_set_no_requiere', {
    p_administracion_id: administracionId,
    p_no_requiere: noRequiere as never,
  });
  if (error) return fail('PERFIL_REG_SET_NOREQ', error.message, error);
  return ok(null);
}

export async function declararPerfilRegulatorio(
  input: DeclararPerfilInput,
): Promise<ApiResponse<null>> {
  const { error } = await supabase.rpc('perfil_regulatorio_declarar', {
    p_administracion_id: input.administracionId,
    p_jurisdiccion: input.jurisdiccion ?? undefined,
    p_matricula_fecha: input.matriculaFecha ?? undefined,
    p_matricula_nro: input.matriculaNro ?? undefined,
    p_ultima_renovacion: input.ultimaRenovacion ?? undefined,
    p_ultimo_curso_actualizacion: input.ultimoCursoActualizacion ?? undefined,
    p_ultima_ddjj: input.ultimaDdjj ?? undefined,
    p_ultima_consultoria: input.ultimaConsultoria ?? undefined,
    p_ultimo_certificado: input.ultimoCertificado ?? undefined,
    p_no_requiere: (input.noRequiere ?? undefined) as never,
    p_notas: input.notas ?? undefined,
  });
  if (error) return fail('PERFIL_REG_DECLARAR', error.message, error);
  return ok(null);
}
