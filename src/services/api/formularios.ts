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
    | 'html'
    | 'costos_info';
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
  // sensitive (E-GG-32 / AJL): si true, el runner renderiza el input
  // como password (con dots) + un botón ojito para mostrar/ocultar. Pensado
  // para claves fiscales y similares. Solo aplica a tipos `text` / `textarea`.
  sensitive?: boolean;
  // costos_info (E-GG-32, pedido Jose Luis 2026-06-02): bloque informativo
  // con tarifas + datos de cuenta MP para transferencia. NO se envía en el
  // payload, NO se valida.
  costos?: {
    items: Array<{
      label: string;
      precio: string;
      nota?: string;
    }>;
    nota_total?: string;
    cuenta?: {
      titular: string;
      cvu: string;
      alias: string;
      cuit_cuil: string;
    };
    nota_extra?: string;
  };
  // preview (DGG-37, pedido José Luis 2026-06-02): "ojito" al lado del
  // label con un popover que muestra una imagen de ejemplo del documento
  // que el usuario tiene que adjuntar. Sirve para campos tipo `file`
  // donde el copy + hint no alcanza (ej. constancia ARCA, ARBA IIBB).
  // - url: ruta del asset (puede ser `/form-previews/...` para assets del
  //   repo o URL pública de bucket `formulario-previews`).
  // - filename: cómo se llama el documento real (visible debajo de la
  //   imagen para que el usuario lo identifique).
  // - alt: texto alternativo para a11y.
  preview?: {
    url: string;
    filename: string;
    alt?: string;
  };
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
