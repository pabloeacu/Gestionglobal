// emails · API del motor de email workflow (templates + cola + envíos).
// Patrón ApiResponse (P-API-01). Citas: regla 4 (todo `supabase.from()` vive
// acá), regla 5 (encolar pasa por RPC SD), D05/E42 (throttle global 5 min).

import { supabase } from '@/lib/supabase';
import { ok, fail, type ApiResponse } from '@/lib/errors';
import type { Database, Json } from '@/types/database';

// --- types ---------------------------------------------------------------

export type EmailTemplateRow = Database['public']['Tables']['email_templates']['Row'];
export type EmailQueueRow    = Database['public']['Tables']['email_queue']['Row'];
export type SentEmailRow     = Database['public']['Tables']['sent_emails']['Row'];

// Decisión 2026-05-26 v2 (EGG-QA-06): Workspace tiene 4 alias REALES.
// Las casillas info@/facturacion@/tramites@/recupero@ NO existen → fueron
// removidas. Las 4 aliases reales mapean 1:1 con las 4 categorías:
export type FromCasilla = 'cursos' | 'webinar' | 'juridico' | 'general';

export const CASILLA_GENERAL_EMAIL = 'contacto@gestionglobal.ar';

export const CASILLAS: { value: FromCasilla; label: string; email: string }[] = [
  { value: 'general',   label: 'General',     email: 'contacto@gestionglobal.ar' },
  { value: 'cursos',    label: 'Cursos',      email: 'cursos@gestionglobal.ar' },
  { value: 'webinar',   label: 'Webinars',    email: 'webinar@gestionglobal.ar' },
  { value: 'juridico',  label: 'Jurídico',    email: 'consultoriajuridica@gestionglobal.ar' },
];

export interface EncolarEmailInput {
  template: string;
  to: string;
  to_nombre?: string | null;
  variables?: Record<string, unknown>;
  administracion_id?: string | null;
  consorcio_id?: string | null;
  related_table?: string | null;
  related_id?: string | null;
  prioridad?: number;
}

export type EstadoEmail = 'pendiente' | 'enviado' | 'fallido';

export interface EnvioListItem {
  id: string;
  template_slug: string | null;
  to_email: string;
  to_nombre: string | null;
  subject: string | null;
  enviado_at: string | null;
  intento: number;
  max_intentos: number;
  ultimo_error: string | null;
  programado_para: string | null;
  prioridad: number;
  administracion_id: string | null;
  estado: EstadoEmail;
  casilla: FromCasilla | null;
  template_nombre: string | null;
  administracion_nombre: string | null;
}

export interface ListEnviosFilters {
  estado?: EstadoEmail | 'todos';
  casilla?: FromCasilla | 'todas';
  search?: string;
  limit?: number;
  offset?: number;
}

// --- templates -----------------------------------------------------------

export async function listTemplates(): Promise<ApiResponse<EmailTemplateRow[]>> {
  const { data, error } = await supabase
    .from('email_templates')
    .select('*')
    .order('nombre', { ascending: true });
  if (error) return fail('TPL_LIST', error.message, error);
  return ok(data ?? []);
}

export async function getTemplate(slug: string): Promise<ApiResponse<EmailTemplateRow>> {
  const { data, error } = await supabase
    .from('email_templates')
    .select('*')
    .eq('slug', slug)
    .maybeSingle();
  if (error) return fail('TPL_GET', error.message, error);
  if (!data) return fail('TPL_NOT_FOUND', `Template ${slug} no encontrado`);
  return ok(data);
}

export interface TemplatePatch {
  nombre?: string;
  asunto?: string;
  body_html?: string;
  body_text?: string | null;
  from_casilla?: string;
  reply_to?: string | null;
  descripcion?: string | null;
  activo?: boolean;
  variables?: Json;
}

export async function updateTemplate(
  id: string,
  patch: TemplatePatch,
): Promise<ApiResponse<EmailTemplateRow>> {
  const { data, error } = await supabase
    .from('email_templates')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single();
  if (error) return fail('TPL_UPDATE', error.message, error);
  return ok(data);
}

// Patch para los campos visuales MANAXER (todos requeridos).
export interface TemplateVisualPatch {
  kicker: string;
  titulo_visual: string;
  color_acento: string;
  mostrar_logo: boolean;
  cuerpo_html_visual: string;
  firma: string | null;
  incluir_tabla_envio: boolean;
  cta_text: string | null;
  cta_url: string | null;
  asunto?: string | null;
}

export async function updateTemplateVisual(
  slug: string,
  patch: TemplateVisualPatch,
): Promise<ApiResponse<EmailTemplateRow>> {
  const args = {
    p_slug: slug,
    p_kicker: patch.kicker,
    p_titulo_visual: patch.titulo_visual,
    p_color_acento: patch.color_acento,
    p_mostrar_logo: patch.mostrar_logo,
    p_cuerpo_html_visual: patch.cuerpo_html_visual,
    p_firma: patch.firma ?? '',
    p_incluir_tabla_envio: patch.incluir_tabla_envio,
    p_cta_text: patch.cta_text ?? '',
    p_cta_url: patch.cta_url ?? '',
    p_asunto: patch.asunto ?? null,
  } as unknown as Parameters<typeof supabase.rpc<'email_template_actualizar_visual'>>[1];
  const { data, error } = await supabase.rpc('email_template_actualizar_visual', args);
  if (error) return fail('TPL_UPDATE_VISUAL', error.message, error);
  return ok(data as unknown as EmailTemplateRow);
}

// Substituye {{var}} en asunto + html + text usando las variables dadas.
// Aplica el mismo escape que el dispatcher (sólo escapa valores, no el HTML).
export function previewTemplate(
  tpl: EmailTemplateRow,
  variables: Record<string, unknown>,
): { asunto: string; html: string; text: string | null } {
  const render = (s: string) =>
    s.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, k) => {
      const v = variables[k];
      if (v === null || v === undefined) return '';
      return String(v)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;');
    });
  return {
    asunto: render(tpl.asunto),
    html: render(tpl.body_html),
    text: tpl.body_text ? render(tpl.body_text) : null,
  };
}

// --- encolar -------------------------------------------------------------

export async function encolarEmail(input: EncolarEmailInput): Promise<ApiResponse<string>> {
  // Los args de la RPC permiten NULL en PG pero las types generadas los marcan
  // como NOT NULL (limitación de pg-meta). Casteamos a `any` el bag de args.
  const args = {
    p_template: input.template,
    p_to_email: input.to,
    p_to_nombre: input.to_nombre ?? null,
    p_variables: (input.variables ?? {}) as unknown as Json,
    p_administracion_id: input.administracion_id ?? null,
    p_consorcio_id: input.consorcio_id ?? null,
    p_related_table: input.related_table ?? null,
    p_related_id: input.related_id ?? null,
    p_prioridad: input.prioridad ?? 5,
  } as unknown as Parameters<typeof supabase.rpc<'encolar_email'>>[1];
  const { data, error } = await supabase.rpc('encolar_email', args);
  if (error) return fail('EMAIL_ENCOLAR', error.message, error);
  return ok(data as string);
}

// --- envíos --------------------------------------------------------------

function estadoDe(row: Pick<EmailQueueRow, 'enviado_at' | 'intento' | 'max_intentos' | 'ultimo_error'>): EstadoEmail {
  if (row.enviado_at && !row.ultimo_error) return 'enviado';
  if (row.enviado_at && row.ultimo_error) return 'fallido';
  if (!row.enviado_at && row.intento >= row.max_intentos) return 'fallido';
  return 'pendiente';
}

interface RawJoined {
  id: string;
  template_slug: string | null;
  to_email: string;
  to_nombre: string | null;
  subject: string | null;
  enviado_at: string | null;
  intento: number;
  max_intentos: number;
  ultimo_error: string | null;
  programado_para: string | null;
  prioridad: number;
  administracion_id: string | null;
  kind: string;
  email_templates: { slug: string; nombre: string; from_casilla: FromCasilla } | null;
  administraciones: { nombre: string } | null;
}

export async function listEnvios(
  filters: ListEnviosFilters = {},
): Promise<ApiResponse<{ rows: EnvioListItem[]; total: number }>> {
  const limit = filters.limit ?? 100;
  const offset = filters.offset ?? 0;

  let q = supabase
    .from('email_queue')
    .select(
      'id, template_slug, to_email, to_nombre, subject, enviado_at, intento, max_intentos, ultimo_error, programado_para, prioridad, administracion_id, kind, email_templates:template_slug(slug,nombre,from_casilla), administraciones:administracion_id(nombre)',
      { count: 'exact' },
    )
    .eq('kind', 'workflow')
    .order('programado_para', { ascending: false })
    .range(offset, offset + limit - 1);

  if (filters.casilla && filters.casilla !== 'todas') {
    // filtramos por template.from_casilla via inner join no es trivial sin RPC;
    // hacemos un sub-select de slugs.
    const { data: slugs } = await supabase
      .from('email_templates').select('slug').eq('from_casilla', filters.casilla);
    const slugList = (slugs ?? []).map(s => s.slug);
    if (slugList.length === 0) return ok({ rows: [], total: 0 });
    q = q.in('template_slug', slugList);
  }

  if (filters.search) {
    q = q.or(`to_email.ilike.%${filters.search}%,subject.ilike.%${filters.search}%`);
  }

  const { data, error, count } = await q;
  if (error) return fail('ENVIOS_LIST', error.message, error);

  let rows: EnvioListItem[] = ((data ?? []) as unknown as RawJoined[]).map((r) => ({
    id: r.id,
    template_slug: r.template_slug,
    to_email: r.to_email,
    to_nombre: r.to_nombre,
    subject: r.subject,
    enviado_at: r.enviado_at,
    intento: r.intento,
    max_intentos: r.max_intentos,
    ultimo_error: r.ultimo_error,
    programado_para: r.programado_para,
    prioridad: r.prioridad,
    administracion_id: r.administracion_id,
    estado: estadoDe(r),
    casilla: r.email_templates?.from_casilla ?? null,
    template_nombre: r.email_templates?.nombre ?? null,
    administracion_nombre: r.administraciones?.nombre ?? null,
  }));

  if (filters.estado && filters.estado !== 'todos') {
    rows = rows.filter(r => r.estado === filters.estado);
  }

  const safeTotal = count && count > 0 ? count : rows.length;
  return ok({ rows, total: safeTotal });
}

// --- test send ----------------------------------------------------------
// Encola un email con el template indicado hacia un destinatario de prueba y
// dispara el dispatcher para que el envío sea inmediato (no espera al cron).
// Pasa por la RPC `encolar_email` (regla 5) y luego invoca la edge function
// `dispatch-emails` (regla 7) sin payload — el dispatcher recorre la cola.
export async function sendTestEmail(
  templateSlug: string,
  toEmail: string,
  variables: Record<string, unknown>,
): Promise<ApiResponse<{ queueId: string }>> {
  const encolado = await encolarEmail({
    template: templateSlug,
    to: toEmail,
    to_nombre: 'Prueba editor',
    variables,
    prioridad: 1,
  });
  if (!encolado.ok) return encolado;
  // Disparamos el dispatcher; si falla, el email igual está en cola y saldrá
  // en el próximo tick del cron, así que no propagamos error aquí.
  try {
    await supabase.functions.invoke('dispatch-emails', { body: {} });
  } catch {
    /* noop — la cola lo procesará en el próximo tick */
  }
  return ok({ queueId: encolado.data });
}

export async function reintentar(emailId: string): Promise<ApiResponse<true>> {
  const { error } = await supabase
    .from('email_queue')
    .update({
      intento: 0,
      ultimo_error: null,
      enviado_at: null,
      programado_para: new Date().toISOString(),
    })
    .eq('id', emailId);
  if (error) return fail('EMAIL_REINTENTAR', error.message, error);
  return ok(true);
}

export async function cancelar(emailId: string): Promise<ApiResponse<true>> {
  const { error } = await supabase
    .from('email_queue')
    .update({
      enviado_at: new Date().toISOString(),
      ultimo_error: 'cancelado manualmente',
    })
    .eq('id', emailId);
  if (error) return fail('EMAIL_CANCELAR', error.message, error);
  return ok(true);
}
