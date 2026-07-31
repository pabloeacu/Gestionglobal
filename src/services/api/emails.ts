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

// Decisión 2026-05-26 v2 (EGG-QA-06): Workspace tiene alias REALES; info@/
// facturacion@/tramites@/recupero@ NO existen → removidas.
// 2026-07-09 (Pablo · DGG-100): se removió la casilla `webinar` (webinar@).
// Los emails de eventos ahora salen desde la GENERAL (contacto@, la principal)
// para evitar confusión y problemas de entrega del alias webinar@. Los 5
// templates de evento se repuntaron a `general` (mig 0301) y la edge fn ya no
// mapea 'webinar'/'evento' a webinar@ (caen al default = contacto@).
export type FromCasilla = 'cursos' | 'juridico' | 'general';

export const CASILLA_GENERAL_EMAIL = 'contacto@gestionglobal.ar';

export const CASILLAS: { value: FromCasilla; label: string; email: string }[] = [
  { value: 'general',   label: 'General',     email: 'contacto@gestionglobal.ar' },
  { value: 'cursos',    label: 'Cursos',      email: 'cursos@gestionglobal.ar' },
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

// D2-bis · Status post-envío que viene de sent_emails (poblado por el
// harvester de bounces). null = todavía no sabemos (recién enviado).
export type DeliveryEstado =
  | 'sent'
  | 'delivered'
  | 'delivery_delayed'
  | 'bounced'
  | 'complained'
  | 'failed';

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
  /** D2-bis: estado post-envío leído del DSN harvester. */
  delivery_estado: DeliveryEstado | null;
  delivery_error: string | null;
}

export interface ListEnviosFilters {
  estado?: EstadoEmail | 'todos';
  casilla?: FromCasilla | 'todas';
  search?: string;
  /** DGG-124 · filtro multi por plantilla (slugs) desde el encabezado. */
  plantillas?: string[];
  /** DGG-124 · rango de fechas 'YYYY-MM-DD' (local) sobre programado_para. */
  desde?: string;
  hasta?: string;
  /** DGG-124 · orden server-side por columna. */
  orden?: 'programado_para' | 'to_email' | 'template_slug' | 'intento';
  dir?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

// DGG-124 · El "estado" es DERIVADO (enviado_at / ultimo_error / intento vs
// max_intentos), no una columna — para paginar server-side lo traducimos a
// filtros PostgREST exactos. PostgREST no compara columna contra columna, así
// que "intento >= max_intentos" se expande por los valores reales del dominio
// de max_intentos (hoy 3 y 5). Si algún flujo suma otro max_intentos, agregar
// el tramo acá y en contarEnviosKpis.
const FALLIDO_SIN_ENVIAR =
  'and(enviado_at.is.null,max_intentos.eq.3,intento.gte.3),and(enviado_at.is.null,max_intentos.eq.5,intento.gte.5)';
const PENDIENTE_OR =
  'and(max_intentos.eq.3,intento.lt.3),and(max_intentos.eq.5,intento.lt.5)';

// Sanitiza el texto de búsqueda para el .or(ilike) de PostgREST: comas y
// paréntesis rompen la sintaxis del or; % y _ son wildcards de ilike.
function sanearBusqueda(s: string): string {
  return s.replace(/[%_,()]/g, ' ').trim();
}

/**
 * DGG-124 · KPIs sobre el universo COMPLETO (espíritu R19) sin traer filas:
 * counts head-only por estado. `pendientes` sale por resta para que la suma
 * siempre cierre contra el total.
 */
export async function contarEnviosKpis(): Promise<
  ApiResponse<{ total: number; pendientes: number; enviados: number; fallidos: number }>
> {
  const base = () =>
    supabase.from('email_queue').select('id', { count: 'exact', head: true }).eq('kind', 'workflow');

  const [tot, env, fall] = await Promise.all([
    base(),
    base().not('enviado_at', 'is', null).is('ultimo_error', null),
    base().or(`and(enviado_at.not.is.null,ultimo_error.not.is.null),${FALLIDO_SIN_ENVIAR}`),
  ]);
  const err = tot.error ?? env.error ?? fall.error;
  if (err) return fail('ENVIOS_KPIS', err.message, err);

  const total = tot.count ?? 0;
  const enviados = env.count ?? 0;
  const fallidos = fall.count ?? 0;
  return ok({ total, enviados, fallidos, pendientes: Math.max(0, total - enviados - fallidos) });
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
  // E-GG-150: pasamos por el wrapper staff-gated `gerencia_encolar_email`. La
  // RPC base `encolar_email` ya NO es ejecutable por `authenticated` (era un
  // vector: cualquier logueado podía encolar templates arbitrarios). El
  // wrapper exige is_staff_or_service y delega en la canónica. Los args
  // permiten NULL en PG pero las types los marcan NOT NULL (pg-meta): casteo.
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
  } as unknown as Parameters<typeof supabase.rpc<'gerencia_encolar_email'>>[1];
  const { data, error } = await supabase.rpc('gerencia_encolar_email', args);
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
    .order(filters.orden ?? 'programado_para', { ascending: (filters.dir ?? 'desc') === 'asc' })
    .range(offset, offset + limit - 1);

  // DGG-124 · Estado server-side (antes se filtraba en memoria post-fetch, lo
  // que rompía el paginado). Condiciones exactas del estado derivado.
  if (filters.estado === 'enviado') {
    q = q.not('enviado_at', 'is', null).is('ultimo_error', null);
  } else if (filters.estado === 'fallido') {
    q = q.or(`and(enviado_at.not.is.null,ultimo_error.not.is.null),${FALLIDO_SIN_ENVIAR}`);
  } else if (filters.estado === 'pendiente') {
    q = q.is('enviado_at', null).or(PENDIENTE_OR);
  }

  // DGG-124 · Rango de fechas (un solo calendario en la UI). Los límites son
  // días locales del usuario → Date local → ISO UTC para el timestamptz.
  if (filters.desde) {
    q = q.gte('programado_para', new Date(`${filters.desde}T00:00:00`).toISOString());
  }
  if (filters.hasta) {
    q = q.lte('programado_para', new Date(`${filters.hasta}T23:59:59.999`).toISOString());
  }

  // DGG-124 · Filtro multi de plantillas desde el encabezado.
  if (filters.plantillas && filters.plantillas.length > 0) {
    q = q.in('template_slug', filters.plantillas);
  }

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
    const s = sanearBusqueda(filters.search);
    if (s) q = q.or(`to_email.ilike.%${s}%,subject.ilike.%${s}%`);
  }

  const { data, error, count } = await q;
  if (error) return fail('ENVIOS_LIST', error.message, error);

  // D2-bis · join client-side con sent_emails para conocer el delivery
  // estado real (sent/bounced/complained/...). No hay FK formal, hacemos
  // un segundo query por email_queue_id IN (lista).
  const queueIds = (data ?? []).map((r) => (r as { id: string }).id);
  const deliveryByQueueId = new Map<string, { estado: DeliveryEstado; error_msg: string | null }>();
  if (queueIds.length > 0) {
    const { data: sentRows } = await supabase
      .from('sent_emails')
      .select('email_queue_id, estado, error_msg')
      // email_queue_id no está en los types regenerados pero sí en BD (mig 0154 lo confirma)
      .in('email_queue_id' as never, queueIds);
    for (const sr of (sentRows ?? []) as unknown as Array<unknown>) {
      const row = sr as { email_queue_id: string | null; estado: string; error_msg: string | null };
      if (!row.email_queue_id) continue;
      if (['sent','delivered','delivery_delayed','bounced','complained','failed'].includes(row.estado)) {
        deliveryByQueueId.set(row.email_queue_id, {
          estado: row.estado as DeliveryEstado,
          error_msg: row.error_msg,
        });
      }
    }
  }

  const rows: EnvioListItem[] = ((data ?? []) as unknown as RawJoined[]).map((r) => {
    const delivery = deliveryByQueueId.get(r.id);
    return {
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
      delivery_estado: delivery?.estado ?? null,
      delivery_error: delivery?.error_msg ?? null,
    };
  });

  // DGG-124 · El estado ya se filtró server-side (paginado consistente); el
  // count exacto ES el total del universo filtrado.
  const safeTotal = count ?? rows.length;
  return ok({ rows, total: safeTotal });
}

// --- preview ------------------------------------------------------------
// Devuelve el HTML real encolado/enviado para mostrar en modal preview.
export interface EnvioPreview {
  id: string;
  subject: string | null;
  to_email: string;
  to_nombre: string | null;
  html_body: string | null;
  enviado_at: string | null;
  template_slug: string | null;
  variables: Record<string, unknown> | null;
  attachments_filenames: string[] | null;
}
export async function getEnvioPreview(
  envioId: string,
): Promise<ApiResponse<EnvioPreview>> {
  const { data, error } = await supabase
    .from('email_queue')
    .select('id, subject, to_email, to_nombre, html_body, enviado_at, template_slug, variables, attachments_jsonb')
    .eq('id', envioId)
    .maybeSingle();
  if (error) return fail('ENVIO_PREVIEW', error.message, error);
  if (!data) return fail('ENVIO_NOT_FOUND', 'Email no encontrado');
  // Si el queue.html_body está vacío, intentamos traer el HTML real desde sent_emails
  // matcheando por template_slug + to_email + ventana de tiempo cercana al enviado_at.
  let htmlFinal: string | null = data.html_body ?? null;
  if (!htmlFinal && data.enviado_at) {
    const { data: sent } = await supabase
      .from('sent_emails')
      .select('html')
      .eq('to_email', data.to_email)
      .eq('template_slug', data.template_slug ?? '')
      .gte('enviado_at', new Date(new Date(data.enviado_at).getTime() - 60_000).toISOString())
      .lte('enviado_at', new Date(new Date(data.enviado_at).getTime() + 60_000).toISOString())
      .order('enviado_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    htmlFinal = (sent?.html as string | undefined) ?? null;
  }
  // Adjuntos: pueden venir como attachments_jsonb [{filename,...}, ...]
  let filenames: string[] | null = null;
  try {
    const arr = data.attachments_jsonb as Array<{ filename?: string }> | null | undefined;
    if (Array.isArray(arr)) filenames = arr.map(a => a.filename ?? '(sin nombre)');
  } catch { /* noop */ }
  return ok({
    id: data.id,
    subject: data.subject,
    to_email: data.to_email,
    to_nombre: data.to_nombre,
    html_body: htmlFinal,
    enviado_at: data.enviado_at,
    template_slug: data.template_slug,
    variables: (data.variables as Record<string, unknown> | null) ?? null,
    attachments_filenames: filenames,
  });
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

// ---------------------------------------------------------------------------
// DGG-117 · Rebotes recientes (banner del Inicio de gerencia)
// ---------------------------------------------------------------------------

export interface ReboteReciente {
  id: string;
  to_email: string;
  asunto: string | null;
  template_slug: string | null;
  estado: string;
  bounced_at: string | null;
  error_msg: string | null;
  administracion_id: string | null;
  administracion_nombre: string | null;
}

/** Envíos rebotados o con queja de spam en los últimos 7 días (staff via RLS).
 *  Alimenta el banner "Emails rebotados" del Inicio de gerencia con CTA a la
 *  ficha del cliente. */
export async function listarRebotesRecientes(): Promise<ApiResponse<ReboteReciente[]>> {
  const desde = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('sent_emails')
    .select('id, to_email, asunto, template_slug, estado, bounced_at, error_msg, administracion_id, administraciones:administracion_id(nombre)')
    .in('estado', ['bounced', 'complained'])
    .gte('last_event_at', desde)
    // §6 B#10: excluir casillas sintéticas de QA (dominio .test) — no son
    // clientes reales y sólo meten ruido en el Inicio.
    .not('to_email', 'ilike', '%.test')
    .order('bounced_at', { ascending: false, nullsFirst: false })
    .limit(20);
  if (error) return fail('REBOTES_LIST', error.message, error);
  type Raw = Omit<ReboteReciente, 'administracion_nombre'> & {
    administraciones: { nombre: string } | null;
  };
  const rows = ((data ?? []) as unknown as Raw[]).map((r) => ({
    id: r.id,
    to_email: r.to_email,
    asunto: r.asunto,
    template_slug: r.template_slug,
    estado: r.estado,
    bounced_at: r.bounced_at,
    error_msg: r.error_msg,
    administracion_id: r.administracion_id,
    administracion_nombre: r.administraciones?.nombre ?? null,
  }));
  return ok(rows);
}
