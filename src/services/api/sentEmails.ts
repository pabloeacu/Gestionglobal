import { supabase } from '@/lib/supabase';
import { ok, fail, type ApiResponse } from '@/lib/errors';
import type { Database } from '@/types/database';

export type SentEmailRow = Database['public']['Tables']['sent_emails']['Row'];

// Lista los envíos asociados a un comprobante (cualquier plantilla).
export async function listSentEmailsDeComprobante(
  comprobante_id: string,
): Promise<ApiResponse<SentEmailRow[]>> {
  const { data, error } = await supabase
    .from('sent_emails')
    .select('*')
    .eq('comprobante_id', comprobante_id)
    .order('enviado_at', { ascending: false });
  if (error) return fail('SENT_LIST', error.message, error);
  return ok(data ?? []);
}
