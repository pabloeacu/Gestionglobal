import { supabase } from '@/lib/supabase';
import { ok, fail, type ApiResponse } from '@/lib/errors';
import type { Database } from '@/types/database';

export type AdministracionEmailRow = Database['public']['Tables']['administracion_emails']['Row'];

export interface SendEmailInput {
  comprobante_id: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject?: string;
  html?: string;
  pdf_base64?: string;
  pdf_filename?: string;
}

export async function sendComprobanteEmail(
  input: SendEmailInput,
): Promise<ApiResponse<{ sent_email_id: string | null; to: string[]; subject: string }>> {
  const { data, error } = await supabase.functions.invoke<{
    ok: boolean;
    error?: string;
    sent_email_id: string | null;
    to: string[];
    subject: string;
  }>('send-comprobante-email', { body: input });

  if (error) return fail('EMAIL_INVOKE', error.message, error);
  if (!data?.ok) return fail('EMAIL_SEND', data?.error ?? 'Error al enviar', data);
  return ok({
    sent_email_id: data.sent_email_id,
    to: data.to,
    subject: data.subject,
  });
}

// Lista los emails configurados de una administración (para sugerirlos como
// destinatarios en el modal de envío). Se filtra por bandeja de facturación
// — si no hay ninguno marcado como `recibe_facturacion`, se devuelven todos.
export async function listAdminEmailsParaFacturacion(
  administracion_id: string,
): Promise<ApiResponse<AdministracionEmailRow[]>> {
  const { data, error } = await supabase
    .from('administracion_emails')
    .select('*')
    .eq('administracion_id', administracion_id)
    .eq('activo', true)
    .order('es_principal', { ascending: false });
  if (error) return fail('ADMIN_EMAILS', error.message, error);
  const rows = data ?? [];
  // Si hay alguno marcado para facturación, devolvemos solo esos; sino todos.
  const conFacturacion = rows.filter((r) => r.recibe_facturacion);
  return ok(conFacturacion.length > 0 ? conFacturacion : rows);
}
