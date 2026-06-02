import { supabase } from '@/lib/supabase';
import { ok, fail, extractEdgeFnError, type ApiResponse } from '@/lib/errors';
import type { Database } from '@/types/database';

export type FormularioRow = Database['public']['Tables']['formularios']['Row'];
export type FormularioSubmissionRow = Database['public']['Tables']['formulario_submissions']['Row'];

// Schema del formulario (estructura del jsonb).
export interface FormularioFieldDef {
  name: string;
  type:
    | 'text'
    | 'textarea'
    | 'email'
    | 'tel'
    | 'number'
    | 'date'
    | 'select'
    | 'multiselect'
    | 'radio'
    | 'checkbox'
    | 'file'
    | 'file_download'
    | 'heading'
    | 'separator'
    | 'html';
  label: string;
  placeholder?: string;
  required?: boolean;
  hint?: string;
  options?: string[];
  max_files?: number;
  accept?: string[];
  validation?: { min?: number; max?: number; pattern?: string };
  /**
   * Si está presente, el campo solo se muestra (y solo se valida) cuando el
   * valor del campo `field` coincide con `equals`. `equals` acepta un solo
   * valor o una lista — el campo se muestra si el valor actual está en esa
   * lista. Cuando el campo no es visible, queda excluido del payload y de
   * la validación required (en runner y edge function).
   */
  condition?: { field: string; equals: string | string[] };
  // file_download: el archivo que la gerencia provee para que el usuario
  // del formulario lo descargue. URL pública del bucket.
  download_url?: string;
  download_filename?: string;
  download_size_bytes?: number;
}

export interface FormularioSectionDef {
  title?: string;
  subtitle?: string;
  fields: FormularioFieldDef[];
}

export interface FormularioSchemaDef {
  sections: FormularioSectionDef[];
  submit_label?: string;
  post_submit?: {
    message?: string;
    redirect_url?: string | null;
    derivar_a_formulario_slug?: string;
  };
}

// Lectura pública del formulario (anon puede SELECT si publico=true).
export async function getFormularioPorSlug(
  slug: string,
): Promise<ApiResponse<FormularioRow>> {
  const { data, error } = await supabase
    .from('formularios')
    .select('*')
    .eq('slug', slug)
    .eq('activo', true)
    .single();
  if (error) return fail('FORM_GET', error.message, error);
  return ok(data);
}

export interface SubmitFormularioInput {
  slug: string;
  datos: Record<string, unknown>;
  files?: Array<{ field: string; file: File }>;
  /** Origen de la solicitud: 'publico' (landing) o 'cliente' (portal). Determina qué precio se aplica y qué vouchers son válidos. */
  origen_canal?: 'publico' | 'cliente';
  /** Código de voucher opcional. El servidor lo valida y aplica el descuento. */
  voucher_codigo?: string;
}

export interface SubmitFormularioResult {
  submission_id: string;
  mensaje: string;
  redirect_url: string | null;
  adjuntos: number;
}

export async function submitFormulario(
  input: SubmitFormularioInput,
): Promise<ApiResponse<SubmitFormularioResult>> {
  // Convertir archivos a base64 para enviarlos al edge function
  const filesB64: Array<{ field: string; base64: string; filename: string; mime: string }> = [];
  if (input.files && input.files.length > 0) {
    for (const { field, file } of input.files) {
      const buf = await file.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let bin = '';
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
      filesB64.push({
        field,
        base64: btoa(bin),
        filename: file.name,
        mime: file.type,
      });
    }
  }

  const { data, error } = await supabase.functions.invoke<{
    ok: boolean;
    error?: string;
    submission_id: string;
    mensaje: string;
    redirect_url: string | null;
    adjuntos: number;
  }>('submit-formulario', {
    body: {
      slug: input.slug,
      datos: input.datos,
      files: filesB64,
      origen_canal: input.origen_canal,
      voucher_codigo: input.voucher_codigo,
    },
  });

  if (error) {
    // FunctionsHttpError trae .context.response con el body real (4xx/5xx).
    // Sin esto, el toast muestra "Edge Function returned a non-2xx status
    // code" y el usuario nunca sabe qué campo le faltó. Mismo patrón que
    // extractInvokeError de services/api/arca.ts (commit 86cac19).
    const msg = await extractEdgeFnError(error);
    return fail('FORM_SUBMIT', msg, error);
  }
  if (!data?.ok) return fail('FORM_SUBMIT', data?.error ?? 'Error al enviar', data);
  return ok({
    submission_id: data.submission_id,
    mensaje: data.mensaje,
    redirect_url: data.redirect_url,
    adjuntos: data.adjuntos,
  });
}

// --- Para gerencia (staff) ---

export interface FormularioListItem extends FormularioRow {
  envios_recientes: number;
}

export async function listFormulariosGerencia(): Promise<
  ApiResponse<FormularioListItem[]>
> {
  const { data, error } = await supabase
    .from('formularios')
    .select('*')
    .order('orden', { ascending: true })
    .order('titulo', { ascending: true });
  if (error) return fail('FORM_LIST', error.message, error);
  return ok(
    (data ?? []).map((f) => ({
      ...(f as FormularioRow),
      envios_recientes: f.total_envios ?? 0,
    })),
  );
}

export async function listSubmissions(
  formulario_id?: string,
  limit = 50,
): Promise<ApiResponse<FormularioSubmissionRow[]>> {
  let q = supabase
    .from('formulario_submissions')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (formulario_id) q = q.eq('formulario_id', formulario_id);
  const { data, error } = await q;
  if (error) return fail('SUBM_LIST', error.message, error);
  return ok(data ?? []);
}

// ----------------------------------------------------------------------------
// AUTO-FILL: perfil del cliente logueado para pre-poblar formularios
// ----------------------------------------------------------------------------
/**
 * Devuelve dict con todos los datos del usuario logueado en aliases conocidos
 * (nombre, email, cuit, dni, matricula, telefono, dirección, etc.) para que el
 * FormularioRunner pueda hacer matching por nombre de campo y auto-poblar.
 * Si no hay usuario o falla → devuelve {} (no rompe el flujo).
 */
export async function fetchClientePerfilDatosFormulario(): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.rpc('cliente_perfil_datos_formulario' as never);
  if (error) return {};
  return (data ?? {}) as Record<string, unknown>;
}
