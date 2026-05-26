// cj-documentos · service para Generación CJ (Consultoría Jurídica).
// Citas: regla 4 (queries en services/), regla 5 (RPC SD+search_path),
// regla 12 (tenancy: staff-only).

import { supabase } from '@/lib/supabase';
import { ok, fail, type ApiResponse } from '@/lib/errors';

const BUCKET = 'cj-documentos';

// =========================================================================
// Tipos
// =========================================================================

export interface CjDocumento {
  id: string;
  tema: string;
  destinatario_nombre: string;
  destinatario_email: string | null;
  kicker: string;
  titulo: string;
  color_acento: string;
  mostrar_logo: boolean;
  cuerpo_html: string;
  firma: string | null;
  pdf_storage_path: string | null;
  pdf_generated_at: string | null;
  last_emailed_at: string | null;
  last_emailed_to: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CjDocumentoListItem {
  id: string;
  tema: string;
  destinatario_nombre: string;
  destinatario_email: string | null;
  titulo: string;
  pdf_storage_path: string | null;
  pdf_generated_at: string | null;
  last_emailed_at: string | null;
  last_emailed_to: string | null;
  created_at: string;
}

export interface CjDocumentoInput {
  tema: string;
  destinatario_nombre: string;
  destinatario_email: string | null;
  kicker: string;
  titulo: string;
  color_acento: string;
  mostrar_logo: boolean;
  cuerpo_html: string;
  firma: string | null;
}

// =========================================================================
// Listado
// =========================================================================

export async function listarCjDocumentos(): Promise<ApiResponse<CjDocumentoListItem[]>> {
  const { data, error } = await supabase.rpc('cj_documentos_listar');
  if (error) return fail('CJ_LIST', error.message, error);
  return ok((data ?? []) as CjDocumentoListItem[]);
}

export async function getCjDocumento(id: string): Promise<ApiResponse<CjDocumento>> {
  const { data, error } = await supabase.rpc('cj_documento_get', { p_id: id });
  if (error) return fail('CJ_GET', error.message, error);
  if (!data) return fail('CJ_NOT_FOUND', 'Documento no encontrado');
  return ok(data as unknown as CjDocumento);
}

// =========================================================================
// CRUD
// =========================================================================

export async function crearCjDocumento(input: CjDocumentoInput): Promise<ApiResponse<CjDocumento>> {
  const { data, error } = await supabase.rpc('cj_documento_crear', {
    p_tema: input.tema,
    p_destinatario_nombre: input.destinatario_nombre,
    p_destinatario_email: input.destinatario_email ?? '',
    p_kicker: input.kicker,
    p_titulo: input.titulo,
    p_color_acento: input.color_acento,
    p_mostrar_logo: input.mostrar_logo,
    p_cuerpo_html: input.cuerpo_html,
    p_firma: input.firma ?? '',
  });
  if (error) return fail('CJ_CREATE', error.message, error);
  return ok(data as unknown as CjDocumento);
}

export async function actualizarCjDocumento(id: string, input: CjDocumentoInput): Promise<ApiResponse<CjDocumento>> {
  const { data, error } = await supabase.rpc('cj_documento_actualizar', {
    p_id: id,
    p_tema: input.tema,
    p_destinatario_nombre: input.destinatario_nombre,
    p_destinatario_email: input.destinatario_email ?? '',
    p_kicker: input.kicker,
    p_titulo: input.titulo,
    p_color_acento: input.color_acento,
    p_mostrar_logo: input.mostrar_logo,
    p_cuerpo_html: input.cuerpo_html,
    p_firma: input.firma ?? '',
  });
  if (error) return fail('CJ_UPDATE', error.message, error);
  return ok(data as unknown as CjDocumento);
}

export async function eliminarCjDocumento(id: string): Promise<ApiResponse<true>> {
  const { error } = await supabase.rpc('cj_documento_eliminar', { p_id: id });
  if (error) return fail('CJ_DELETE', error.message, error);
  return ok(true);
}

// =========================================================================
// PDF · upload a Storage + marcar en BD
// =========================================================================

export async function subirPdfYMarcar(docId: string, pdfBlob: Blob): Promise<ApiResponse<{ storage_path: string }>> {
  const path = `${docId}/${Date.now()}.pdf`;
  const { error: errUp } = await supabase.storage
    .from(BUCKET)
    .upload(path, pdfBlob, { contentType: 'application/pdf', upsert: false });
  if (errUp) return fail('CJ_PDF_UPLOAD', errUp.message, errUp);

  const { error: errMark } = await supabase.rpc('cj_documento_marcar_pdf', {
    p_id: docId,
    p_storage_path: path,
  });
  if (errMark) return fail('CJ_PDF_MARK', errMark.message, errMark);
  return ok({ storage_path: path });
}

export async function descargarPdf(storagePath: string): Promise<ApiResponse<Blob>> {
  const { data, error } = await supabase.storage.from(BUCKET).download(storagePath);
  if (error) return fail('CJ_PDF_DOWNLOAD', error.message, error);
  if (!data) return fail('CJ_PDF_DOWNLOAD', 'sin contenido');
  return ok(data);
}

export async function urlFirmadaPdf(storagePath: string, expiresSec = 60): Promise<ApiResponse<string>> {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, expiresSec);
  if (error) return fail('CJ_PDF_SIGN', error.message, error);
  return ok(data.signedUrl);
}

// =========================================================================
// Envío email con PDF adjunto (via edge function cj-enviar-pdf)
// =========================================================================

export async function enviarPdfPorEmail(docId: string): Promise<ApiResponse<{ message_id: string | null }>> {
  const { data, error } = await supabase.functions.invoke('cj-enviar-pdf', {
    body: { doc_id: docId },
  });
  if (error) return fail('CJ_SEND', error.message, error);
  if (!data?.ok) return fail('CJ_SEND', data?.error ?? 'Error desconocido', data);
  return ok({ message_id: data.message_id ?? null });
}
