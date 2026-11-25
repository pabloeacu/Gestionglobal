// dispatch-emails · drena email_queue (kind=workflow), aplica throttle en dos
// pisos (DGG-113 + DGG-264: 30s global entre destinatarios distintos + 5 min
// POR destinatario, la lección real de E42/D05) y envía vía Gmail API REST con
// OAuth2 refresh_token.
//
// Reuso del patrón de send-comprobante-email/index.ts: misma técnica para
// refresh access token + RFC 2047 + multipart MIME.
//
// IMPORTANTE (decisión del usuario 2026-05-26 v2): el Workspace tiene 4
// alias REALES, NO 1:
//   cursos@gestionglobal.ar                  (cursos y certificados)
//   consultoriajuridica@gestionglobal.ar     (consultas jurídicas)
//   contacto@gestionglobal.ar                (todo lo demás — default; incl. EVENTOS
//                                             desde 2026-07-09, Pablo · DGG-100)
// NO existen: info@, facturacion@, tramites@, recupero@ (eran fake).
// Cualquier email enviado FROM un alias inexistente se descarta silenciosamente
// (Gmail acepta en API pero no entrega). Por eso se mapea casilla → alias
// real vía `aliasFor()` más abajo.
//
// Layout MANAXER (2026-05-26 v3): cuando `layout_version = 'manaxer-v1'`,
// el HTML final se construye desde los campos visuales (kicker, titulo_visual,
// color_acento, mostrar_logo, cuerpo_html_visual, firma, cta_text, cta_url,
// incluir_tabla_envio). En caso contrario se usa el legacy `body_html`.
//
// Secrets requeridos:
//   GOOGLE_OAUTH_CLIENT_ID
//   GOOGLE_OAUTH_CLIENT_SECRET
//   GOOGLE_OAUTH_REFRESH_TOKEN  (refresh_token para contacto@)
//   (También sirve GMAIL_OAUTH_REFRESH_TOKEN_DEFAULT con la misma idea.)
//
// Trigger: pg_cron */1 min via net.http_post con Bearer service_role.
// Idempotente: si no hay nada que enviar, devuelve {drained:0}.
// verify_jwt = false: la auth es CRON_SECRET/service_role validado ADENTRO
// (AUDIT-011) — con verify_jwt=true la plataforma rechaza el bearer del cron
// con 401 ANTES de llegar al código (lección del redeploy DGG-113).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.46.1';

const DOMAIN = 'gestionglobal.ar';
const CONTACTO = `contacto@${DOMAIN}`;
const LOGO_URL = `https://www.${DOMAIN}/logo-color.png`;

// DGG-268 · Carril de envío masivo por Amazon SES (Opción B). El marketing (allow-list de
// marketingUtmFor) sale por SES desde el subdominio dedicado SES_FROM_DOMAIN cuando el
// kill-switch config_global.bulk_via_ses está ON y hay credenciales IAM; todo lo demás
// (transaccional) sigue por Gmail API. Objetivo: aislar la reputación del envío masivo.
const SES_FROM_DOMAIN = Deno.env.get('SES_FROM_DOMAIN') ?? 'envios.gestionglobal.ar';
const SES_REGION = Deno.env.get('AWS_SES_REGION') ?? 'us-east-1';

// Mapeo casilla (metadata semántica del template) → alias REAL.
// Casillas no listadas caen al default (contacto@).
// 2026-07-09 (Pablo · DGG-100): 'webinar'/'evento' YA NO mapean a webinar@ —
// caen al default (contacto@, la principal). webinar@ daba problemas de entrega
// como "send-as"; los eventos se envían desde contacto@ (templates repuntados a
// 'general' en mig 0301; casos acá por defensa si quedara metadata vieja).
function aliasFor(casilla: string | null | undefined): string {
  switch (casilla) {
    case 'cursos':
      return `cursos@${DOMAIN}`;
    case 'juridico':
    case 'consultoria':
    case 'consultoria_juridica':
      return `consultoriajuridica@${DOMAIN}`;
    default:
      return CONTACTO;
  }
}

const THROTTLE_KEY = 'global';
// DGG-113 (2026-07-21): el throttle tiene dos pisos. La lección real de E42 fue
// una RÁFAGA AL MISMO CLIENTE (4 mails en 30s): ese piso de 5 min POR
// DESTINATARIO (RECIPIENT_FLOOR_MS) es SAGRADO y se conserva intacto — garantiza
// que jamás salgan 2 mails al mismo email, sea cual sea el ritmo global.
// 2026-11-23 (Pablo, "acelerá el goteo"): el ritmo GLOBAL entre destinatarios
// DISTINTOS baja de 60s → 30s. Con el cron */1 min y last_sent_at sellado al
// COMPLETAR el envío, 60s hacía que el tick del minuto siguiente cayera siempre
// dentro de la ventana → throttled → salía 1 cada 2 min (~30/h, ~720/día real,
// aunque el comentario viejo decía "1.440 teóricos"). A 30s el tick del minuto
// siguiente ya superó la ventana → 1 por minuto = ~60/h = 1.440/día (el techo
// real con BATCH_MAX=1), que es el goteo planeado y sigue holgado bajo el cupo
// Workspace (2.000/día por casilla). Para ir MÁS rápido haría falta enviar varios
// por corrida (batch) — no se hace acá para no arriesgar la ruta money-crítica.
const THROTTLE_MS = 30 * 1000;
const RECIPIENT_FLOOR_MS = 5 * 60 * 1000;
const BATCH_MAX = 1;
// Candidatos a examinar por corrida: si el primero está bloqueado por el piso
// por-destinatario, se intenta con los siguientes (sin saltear prioridades
// entre destinatarios distintos: el orden prioridad/programado_para se respeta).
const CANDIDATE_MAX = 10;
// E-GG-261 [1] · Watchdog del claim atómico (ver paso 0 y 6-bis más abajo): una
// fila 'sending' cuyo invocador murió entre el claim y el desenlace queda
// huérfana con enviado_at NULL. Pasado este umbral la devolvemos a 'pending'
// para que un tick futuro la re-reclame. 10 min >> cualquier envío legítimo (el
// runtime de la edge corta mucho antes), así que sólo reclama invocaciones
// realmente muertas. Depende SÓLO de sending_started_at (que escribe el claim y
// limpian las ramas de éxito/fallo) — nunca de un marcador que otra ruta
// reescriba (lección E-GG-265: nada de resucitadores frágiles con loop).
const CLAIM_WATCHDOG_MS = 10 * 60 * 1000;

type Casilla = string;

interface TemplateRow {
  slug: string;
  asunto: string;
  body_html: string;
  body_text: string | null;
  from_casilla: Casilla;
  reply_to: string | null;
  // MANAXER layout fields
  kicker: string;
  titulo_visual: string;
  color_acento: string;
  mostrar_logo: boolean;
  cuerpo_html_visual: string;
  firma: string | null;
  incluir_tabla_envio: boolean;
  cta_text: string | null;
  cta_url: string | null;
  layout_version: string;
}

// DGG-118: forma de cada elemento de email_queue.attachments_jsonb. Soporta
// las TRES variantes que conviven en el sistema:
//   · storage  → { filename, storage_bucket, storage_path, content_type }
//     (referencia liviana; el dispatcher baja el archivo al enviar; solo
//      buckets whitelisteados en ATTACH_BUCKETS — guía de bienvenida)
//   · gestoría → { path, filename, mime, size } (mig 0208 / solicitud_derivar:
//     `path` es una key del bucket gestoria-adjuntos subida por staff)
//   · inline   → { filename, content_b64, content_type } (doc 02 §emails;
//     hoy sin productor activo — se acepta por la forma documentada)
interface QueueAttachment {
  filename?: string;
  content_type?: string;
  content_b64?: string;
  storage_bucket?: string;
  storage_path?: string;
  path?: string;
  mime?: string;
}

interface QueueRow {
  id: string;
  template_slug: string;
  to_email: string;
  to_nombre: string | null;
  variables: Record<string, unknown>;
  prioridad: number;
  intento: number;
  max_intentos: number;
  administracion_id: string | null;
  consorcio_id: string | null;
  attachments_jsonb: QueueAttachment[] | null;
  related_table: string | null;
  related_id: string | null;
}

// DGG-118: únicos buckets desde los que el dispatcher acepta bajar adjuntos.
// Cierra el vector "encolo un mail con path arbitrario y exfiltro un bucket
// privado por email". Ampliar SOLO con revisión de seguridad.
// gestoria-adjuntos: ahí sube únicamente staff desde el wizard de derivación.
// gestor-uploads (JL-R2, mig 0430): archivos que la gestoría sube a una línea
// de avance. Seguro de whitelistear: email_queue tiene RLS INSERT/UPDATE gated
// por private.is_staff() → un cliente NO puede encolar mails ni setear
// attachments_jsonb. Los únicos productores de adjuntos gestor-uploads son las
// RPCs SECURITY DEFINER tracking_notificar/reenviar_avance_cliente (derivan el
// path de la propia línea, mandan al cliente del mismo tenant) o staff, que ya
// tiene acceso total al bucket. No hay vector de exfil nuevo.
const ATTACH_BUCKETS = ['email-assets', 'gestoria-adjuntos', 'gestor-uploads'];

// Tope de base64 total de adjuntos por mail: el payload JSON del endpoint de
// Gmail admite ~10MB; con más de ~7MB de adjuntos el raw se pasa y el envío
// fallaría los 3 reintentos. El excedente se omite (nunca bloquear el mail).
const MAX_ATTACH_B64_TOTAL = 7_000_000;

Deno.serve(async (req) => {
  if (req.method === 'GET') return new Response('dispatch-emails alive', { status: 200 });

  // AUDIT-011: Auth — exigimos CRON_SECRET o service_role en Bearer.
  // Sin esto, cualquier IP podía triggear el dispatch (DoS/bypass throttle).
  const cronSecret = Deno.env.get('CRON_SECRET');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const authHeader = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '').trim() ?? '';
  if (authHeader !== serviceKey && (!cronSecret || authHeader !== cronSecret)) {
    return jsonError(401, 'unauthorized');
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    serviceKey,
  );

  // 0) Watchdog del claim atómico (E-GG-261 [1] · §6 C-B/A#9). Corre en CADA tick,
  // aun si luego throttleamos. Reclama las filas 'sending' huérfanas (el invocador
  // murió entre el claim y el desenlace) vía RPC que CONSUME un intento y, al agotar
  // max_intentos, las manda a 'failed' terminal. Consumir el intento es clave: un
  // watchdog que sólo hiciera sending→pending dejaría loopear a un invocador que
  // muere SIEMPRE (p.ej. envío que cuelga hasta el tope ~150s de la edge) → nunca
  // converge y el informe final nunca se emite (clase E-GG-265). Depende sólo de
  // sending_started_at, columna que únicamente escribe esta edge.
  await admin.rpc('email_queue_watchdog_reclaim', {
    p_max_age_sec: Math.floor(CLAIM_WATCHDOG_MS / 1000),
  });

  // 1) Gobernanza del carril SES (DGG-268 F5) — leída UNA vez por corrida. El throttle GLOBAL
  // de Gmail (DGG-113, ritmo entre destinatarios distintos) se evalúa MÁS ABAJO, sólo si el
  // job elegido sale por Gmail (lo transaccional); el carril SES no lo usa (reputación aislada
  // + rampa/freno propios). Lo leemos ya acá para decidir ruta antes del trabajo pesado.
  const sesAccessKey = Deno.env.get('AWS_SES_ACCESS_KEY_ID');
  const sesSecretKey = Deno.env.get('AWS_SES_SECRET_ACCESS_KEY');
  let bulkViaSes = false;
  try {
    const { data: cfgRow } = await admin.from('config_global').select('bulk_via_ses').maybeSingle();
    bulkViaSes = !!(cfgRow as { bulk_via_ses?: boolean } | null)?.bulk_via_ses;
  } catch { bulkViaSes = false; }
  let sesPausado = false;
  let sesRestante = 0;
  if (bulkViaSes) {
    try {
      const { data: est } = await admin.rpc('ses_lane_estado');
      const e = (est ?? {}) as { pausado?: boolean; restante_hoy?: number };
      sesPausado = !!e.pausado;
      const rr = Number(e.restante_hoy);                 // fail-closed ante no-numérico (NaN<=0 es false)
      sesRestante = Number.isFinite(rr) ? rr : 0;
    } catch { sesPausado = true; sesRestante = 0; }  // fail-closed: sin estado legible, no se manda SES
  }

  // 2) Próximos jobs (candidatos en orden de prioridad).
  const { data: rows, error: errQueue } = await admin
    .from('email_queue')
    .select('id, template_slug, to_email, to_nombre, variables, prioridad, intento, max_intentos, administracion_id, consorcio_id, attachments_jsonb, related_table, related_id')
    .eq('kind', 'workflow')
    .is('enviado_at', null)
    // E-GG-261 [1] · excluir filas ya reclamadas por otro tick en vuelo (el
    // watchdog del paso 0 reclama las 'sending' huérfanas, así que esto nunca
    // esconde una fila para siempre).
    .neq('status', 'sending')
    .lte('programado_para', new Date().toISOString())
    .order('prioridad', { ascending: true })
    .order('programado_para', { ascending: true })
    .limit(CANDIDATE_MAX);
  if (errQueue) return jsonError(500, `queue read: ${errQueue.message}`);
  if (!rows || rows.length === 0) return json({ ok: true, drained: 0 });

  // 2b) Piso POR DESTINATARIO (la lección original de E42: jamás 2 mails al
  // mismo email en <5 min). Se toma el primer candidato cuyo destinatario no
  // recibió nada en la ventana; los bloqueados quedan en cola y se reintentan
  // en la próxima corrida (el cron pasa cada 1 min). Si todos están bloqueados,
  // esta corrida no envía — igual que un tick throttled de siempre.
  const recipientCutoff = new Date(Date.now() - RECIPIENT_FLOOR_MS).toISOString();
  let job: QueueRow | null = null;
  for (const candidate of rows as QueueRow[]) {
    // (i) ¿recibió un 'sent' en la ventana de 5 min?
    const { count: cSent, error: errRecent } = await admin
      .from('email_queue')
      .select('id', { count: 'exact', head: true })
      .eq('to_email', candidate.to_email)
      .eq('status', 'sent')
      .gte('sent_at', recipientCutoff);
    // Ante un error de lectura, preferimos NO enviar (fail-closed del piso).
    if (errRecent) return jsonError(500, `recipient check: ${errRecent.message}`);
    // (ii) E-GG-261 §6-A#8: el piso E42 también debe ver lo EN VUELO ('sending',
    // reclamada por otro tick pero aún sin marcar 'sent') — si no, una llamada a
    // Gmail lenta deja la ventana abierta para un 2º mail al mismo destinatario.
    const { count: cSending, error: errSending } = await admin
      .from('email_queue')
      .select('id', { count: 'exact', head: true })
      .eq('to_email', candidate.to_email)
      .eq('status', 'sending');
    if (errSending) return jsonError(500, `recipient check: ${errSending.message}`);
    if (!cSent && !cSending) {
      job = candidate;
      break;
    }
  }
  if (!job) {
    return json({ ok: true, drained: 0, recipient_throttled: true });
  }

  // 2a) DGG-268 F5 · RUTA decidida ANTES del throttle y del trabajo pesado. El marketing
  // (allow-list marketingUtmFor) sale por SES cuando el flag bulk_via_ses está ON; todo lo
  // demás (transaccional) por Gmail. Según la ruta aplican gobernanzas distintas:
  const mktEarly = marketingUtmFor(job.template_slug);
  const jobUsesSes = bulkViaSes && !!mktEarly;
  if (jobUsesSes) {
    // Carril SES. Fail-closed (mandato Pablo): si falta algo, se DIFIERE — NUNCA cruza a Gmail.
    if (!sesAccessKey || !sesSecretKey) {
      await admin.from('email_queue').update({
        status: 'pending', sending_started_at: null,
        programado_para: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        ultimo_error: 'SES es la ruta elegida pero faltan credenciales IAM — diferido (no se cruza a Gmail)',
      }).eq('id', job.id);
      return json({ ok: true, drained: 0, deferred: 'ses_sin_credenciales' });
    }
    // Auto-pausa reputacional (freno F5): difiere TODO el carril SES hasta reanudar a mano.
    if (sesPausado) return json({ ok: true, drained: 0, ses_pausado: true });
    // Cupo diario de la rampa de warm-up agotado: difiere hasta que el cupo del día lo permita.
    if (sesRestante <= 0) return json({ ok: true, drained: 0, ses_cap_diario: true });
  } else {
    // DGG-268 F5 (auditoría §6 #1) · Candado del kill-switch para slugs SES-ONLY. `federal-*` es
    // captación fría atada POR DISEÑO al carril SES (mig 0726 no encola sin bulk_via_ses). Si una
    // fila federal quedó en cola y el flag se apagó a mitad del drenado, NO debe cruzar a Gmail (el
    // canal de los comprobantes): se DIFIERE hasta reactivar SES. (La política de canal del
    // newsletter/captación con flag OFF es decisión de producto pre-existente, flaggeada aparte.)
    if (/^federal-/.test(job.template_slug ?? '')) {
      await admin.from('email_queue').update({
        status: 'pending', sending_started_at: null,
        programado_para: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        ultimo_error: 'federal-* es SES-only: carril SES apagado → diferido (no se cruza a Gmail)',
      }).eq('id', job.id);
      return json({ ok: true, drained: 0, deferred: 'federal_requiere_ses' });
    }
    // Carril Gmail (transaccional): throttle GLOBAL de 30s entre destinatarios distintos (DGG-113).
    // El carril SES NO pasa por acá (ritmo propio: rampa + freno + encadenado).
    const { data: throttleRow } = await admin
      .from('email_throttle').select('last_sent_at').eq('key', THROTTLE_KEY).maybeSingle();
    if (throttleRow?.last_sent_at) {
      const delta = Date.now() - new Date(throttleRow.last_sent_at).getTime();
      if (delta < THROTTLE_MS) {
        return json({ ok: true, throttled: true, wait_ms: THROTTLE_MS - delta });
      }
    }
  }

  // 2b-bis) DGG-224 · Destinatario HARD-suprimido (casilla MUERTA: rebote/queja/
  // descarte de gerencia) → no gastar envíos en él, NI transaccional ni marketing.
  // Fail-OPEN a propósito: si el check falla (error transitorio), se envía igual —
  // no bloquear un transaccional legítimo por un error del chequeo; sólo cancela
  // cuando da true explícito. (La baja soft de marketing se maneja en 2c.)
  {
    const { data: bloqueado } = await admin.rpc('email_bloqueado_total', { p_email: job.to_email });
    if (bloqueado === true) {
      await admin.from('email_queue')
        .update({ enviado_at: new Date().toISOString(), status: 'cancelled', ultimo_error: 'destinatario descartado/rebotado (casilla muerta)' })
        .eq('id', job.id).is('enviado_at', null);
      return json({ ok: true, drained: 0, blocked_dead: true });
    }
  }

  // 2c) Compliance de marketing (opt-out + baja). Aplica SÓLO a:
  //   · prospectos (DGG-220 F2): captación en frío (related_table='prospectos').
  //   · clientes (DGG-224 F2 + DGG-232): marketing del motor de ofrecimientos
  //     Y del onboarding de engagement (related_table='administraciones' Y slug
  //     'ofrecimiento-*' | 'engagement-*').
  // El transaccional a clientes (comprobantes/tracking/reset: otros slugs) y todo
  // lo demás queda byte-idéntico (bajaUrl=null → ni header List-Unsubscribe ni
  // footer de baja). bajaTexto adapta la línea del footer al tipo de destinatario.
  // BAJA ACOTADA (decisión Pablo DGG-232): una baja desde un mail de marketing
  // escribe motivo='baja_usuario' (net SOFT email_esta_suprimido, acá) + apaga
  // ofrecimientos_habilitados. NO toca el net HARD (email_bloqueado_total, que sólo
  // lee bounce/queja/descartado). dispatch-vencimientos NO filtra por supresión ni
  // por ofrecimientos_habilitados → los avisos de vencimiento/servicio siguen
  // llegando. O sea: baja de engagement frena engagement+ofrecimientos, nunca lo
  // transaccional. (Verificado §6.)
  let bajaUrl: string | null = null;      // edge (procesa el POST / one-click header)
  let bajaUrlApp: string | null = null;   // página gestionglobal.ar/baja (link visible, renderiza HTML)
  let bajaTexto: string | null = null;
  const esMktProspecto = job.related_table === 'prospectos';
  const esMktCliente = job.related_table === 'administraciones'
    && /^(ofrecimiento-|engagement-)/.test(job.template_slug ?? '');
  if (esMktProspecto || esMktCliente) {
    // Backoff para no bloquear la cola ante un fallo transitorio (el row vuelve en 5').
    const deferir = async (motivo: string) => {
      await admin.from('email_queue')
        .update({ programado_para: new Date(Date.now() + 5 * 60 * 1000).toISOString() })
        .eq('id', job!.id);
      return json({ ok: true, drained: 0, deferred: motivo });
    };
    // Marketing sin id de destinatario → no se puede dar baja → no enviar.
    if (!job.related_id) return await deferir('sin_related_id');
    // (a) GATE fail-CLOSED: si no podemos verificar supresión, NO enviar (reintenta).
    const { data: suprimido, error: supErr } = await admin.rpc('email_esta_suprimido', { p_email: job.to_email });
    if (supErr) return await deferir('suppression_check_error');
    if (suprimido === true) {
      await admin.from('email_queue')
        .update({ enviado_at: new Date().toISOString(), status: 'cancelled', ultimo_error: 'suprimido (opt-out / baja)' })
        .eq('id', job.id).is('enviado_at', null);
      return json({ ok: true, drained: 0, suppressed: true });
    }
    // (b) Link de baja OBLIGATORIO. Fail-CLOSED: ningún mail de marketing sin baja.
    if (esMktCliente) {
      const { data: arow, error: aErr } = await admin.from('administraciones').select('baja_token').eq('id', job.related_id).maybeSingle();
      if (aErr || !arow?.baja_token) return await deferir('sin_baja_token');
      bajaUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/email-baja?a=${job.related_id}&t=${arow.baja_token}`;
      bajaUrlApp = `https://www.${DOMAIN}/baja?a=${job.related_id}&t=${arow.baja_token}`;
      bajaTexto = 'Recibís este correo como cliente de Gestión Global. ¿No querés recibir novedades y ofertas por correo?';
    } else {
      const { data: prow, error: pErr } = await admin.from('prospectos').select('baja_token, origen').eq('id', job.related_id).maybeSingle();
      if (pErr || !prow?.baja_token) return await deferir('sin_baja_token');
      bajaUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/email-baja?p=${job.related_id}&t=${prow.baja_token}`;
      bajaUrlApp = `https://www.${DOMAIN}/baja?p=${job.related_id}&t=${prow.baja_token}`;
      // DGG-269: la línea de fuente depende del origen del prospecto. 'padron_pba' = registro
      // público DPPJ (Pcia. Bs As). 'import_nacional' (CABA/nacional, de congresos/jornadas/
      // Excel de GG) NO viene del padrón → ese texto sería falso (§6, "nunca mentir").
      bajaTexto = prow.origen === 'import_nacional'
        ? 'Recibís este correo porque nos dejaste tus datos en una jornada, congreso o actividad de Gestión Global. ¿No querés recibir estos correos?'
        : 'Recibís este correo porque figurás en el registro público de administradores de consorcios (DPPJ · Pcia. de Buenos Aires). ¿No querés recibir estos correos?';
    }
  }

  // 3) Cargar template (con campos MANAXER).
  const { data: tplRow, error: errTpl } = await admin
    .from('email_templates')
    .select(`
      slug, asunto, body_html, body_text, from_casilla, reply_to,
      kicker, titulo_visual, color_acento, mostrar_logo, cuerpo_html_visual,
      firma, incluir_tabla_envio, cta_text, cta_url, layout_version
    `)
    .eq('slug', job.template_slug)
    .eq('activo', true)
    .maybeSingle();
  if (errTpl || !tplRow) {
    await failJob(admin, job, `Template ${job.template_slug} no encontrado o inactivo`);
    return json({ ok: false, drained: 0, error: 'template-missing' });
  }
  const tpl = tplRow as TemplateRow;

  // 4) Resolver alias real para From / Reply-To.
  const casilla = tpl.from_casilla;
  const senderEmail = aliasFor(casilla);
  const replyToEmail = senderEmail;
  const refreshToken =
    Deno.env.get('GMAIL_OAUTH_REFRESH_TOKEN_DEFAULT') ??
    Deno.env.get('GOOGLE_OAUTH_REFRESH_TOKEN');
  const clientId = Deno.env.get('GOOGLE_OAUTH_CLIENT_ID');
  const clientSecret = Deno.env.get('GOOGLE_OAUTH_CLIENT_SECRET');

  // OAuth sólo es obligatorio para el carril Gmail; los jobs SES no lo necesitan (OAuth lazy, F5).
  if (!jobUsesSes && (!clientId || !clientSecret || !refreshToken)) {
    await failJob(admin, job, `OAuth no configurado`);
    return jsonError(500, 'oauth missing');
  }

  // 5) Render del subject + html usando layout MANAXER o legacy.
  const vars = (job.variables ?? {}) as Record<string, unknown>;
  const subject = renderVars(tpl.asunto, vars);
  let html: string;
  if (tpl.layout_version === 'manaxer-v1') {
    html = buildManaxerHtml(tpl, vars, senderEmail, replyToEmail, bajaUrlApp, bajaTexto);
    // Hardening (E-GG-74): una plantilla manaxer-v1 con `cuerpo_html_visual` vacío
    // produce un mail "sólo logo" (el dispatcher no mira `body_html` en este layout).
    // Defensa: si el cuerpo visual renderiza vacío y existe `body_html` legacy,
    // caemos al render legacy completo (body_html es un documento HTML entero, por
    // eso NO se inyecta dentro del layout manaxer → se reemplaza todo el html).
    // Las plantillas manaxer con cuerpo poblado (las ~35 vigentes) no se tocan.
    const cuerpoVacio = !renderVars(tpl.cuerpo_html_visual ?? '', vars).trim();
    if (cuerpoVacio && (tpl.body_html ?? '').trim()) {
      html = renderVars(tpl.body_html, vars);
    }
  } else {
    html = renderVars(tpl.body_html, vars);
  }
  // E-GG-79: body_text es texto PLANO → no debe HTML-escaparse (rompería URLs).
  const text = tpl.body_text ? renderVarsRaw(tpl.body_text, vars) : undefined;

  // 5-bis) Atribución de MARKETING por UTM (2026-11-23 newsletter → 2026-11-24
  // DGG-265 "aplicá el UTM a TODOS los correos de captación"). A cada email de
  // marketing (allow-list en marketingUtmFor: newsletter, captación, ofrecimiento,
  // engagement) le agregamos utm_source/medium/campaign a sus links al sitio, para
  // medir en Vercel Web Analytics el tráfico que trae cada campaña Y atribuir
  // conversiones de formularios (utmTracking.ts / DGG-242). TODO lo transaccional
  // (comprobantes, tracking, reset, bienvenida, notifs de gerencia) NO entra a la
  // allow-list → queda byte-idéntico, sin UTM. addMarketingUtm nunca toca el link de
  // baja ni los <img src> (sólo href), y es idempotente. Corte por UTM requiere el
  // add-on "Web Analytics Plus" (activo desde 2026-11-23).
  const mkt = mktEarly; // (auditoría §6 #4) reuso la decisión del paso 2a — función pura, mismo valor
  if (mkt) {
    html = addMarketingUtm(html, mkt.source, mkt.campaign);
  }

  // 6) OAuth2 access token — LAZY (DGG-268 F5): sólo para el carril Gmail. Los jobs SES no tocan
  // OAuth (corrige el acople cross-circuito que marcó el Ángulo 1 de la auditoría del gate: hoy
  // el refresh corría aun para marketing que sale por SES). Creds garantizadas por el guard de arriba.
  let accessToken = '';
  if (!jobUsesSes) {
    try {
      accessToken = await refreshAccessToken(clientId!, clientSecret!, refreshToken!);
    } catch (e) {
      await failJob(admin, job, `OAuth refresh: ${(e as Error).message}`);
      return jsonError(502, 'oauth refresh failed');
    }
  }

  // 6-bis) CLAIM ATÓMICO (E-GG-261 [1]) · reservamos la fila ANTES del fetch a
  // Gmail. Dos ticks del cron (*/1) pueden seleccionar el mismo candidato si una
  // llamada a Gmail tarda más que el intervalo; este UPDATE condicional es el
  // árbitro atómico: sólo UNO gana (Postgres serializa el lock de fila y el
  // perdedor re-evalúa el WHERE contra la versión ya 'sending' → 0 filas).
  // RETURNING id (vía .select) nos dice si ganamos. Si 0 filas, otro tick la
  // tomó/terminó entre la selección y acá → no enviamos. Cierra la ventana de
  // doble-entrega por LENTITUD (TOCTOU, el caso del hallazgo [1]); queda un
  // residual at-least-once si el proceso MUERE entre el 200 de Gmail y la marca de
  // enviado_at (sin idempotency key de proveedor no es evitable; documentado en
  // E-GG-266). Va DESPUÉS del OAuth (último gate que puede failJob) para no dejar
  // un 'sending' en una rama que no envía.
  {
    const { data: claimed, error: claimErr } = await admin
      .from('email_queue')
      .update({ status: 'sending', sending_started_at: new Date().toISOString() })
      .eq('id', job.id)
      .is('enviado_at', null)
      .neq('status', 'sending')
      .select('id');
    if (claimErr) return jsonError(500, `claim: ${claimErr.message}`);
    if (!claimed || claimed.length === 0) {
      return json({ ok: true, drained: 0, claim_lost: true });
    }
  }

  // 7) MIME + Gmail send.
  // DGG-118: adjuntos opcionales del job. Se resuelven acá y NUNCA bloquean el
  // envío — un adjunto irrecuperable se omite con log de error (un mail de
  // bienvenida con credenciales no puede quedar rehén de un PDF de marketing).
  const attachments: MimeAttachment[] = [];
  const adjOmitidos: string[] = [];
  let attachB64Total = 0;
  for (const att of (Array.isArray(job.attachments_jsonb) ? job.attachments_jsonb : [])) {
    const filename = sanitizeFilename(att.filename || 'adjunto.pdf');
    try {
      // content_type saneado (§6 A#2): evita header injection vía MIME type.
      const rawMime = att.content_type || att.mime || 'application/octet-stream';
      const mimeType = /^[\w.+-]+\/[\w.+-]+$/.test(rawMime) ? rawMime : 'application/octet-stream';

      let b64: string | null = null;
      if (att.content_b64) {
        // §6 A#3: strip de prefijo dataURL + validación base64 estándar.
        const limpio = att.content_b64.replace(/^data:[^,]*,/, '').replace(/\s+/g, '');
        if (!/^[A-Za-z0-9+/]+=*$/.test(limpio)) {
          console.error('dispatch-emails · content_b64 inválido — omitido', { job: job.id, filename });
          adjOmitidos.push(filename);
          continue;
        }
        b64 = limpio;
      } else {
        // storage ref explícita, o forma gestoría ({path} → gestoria-adjuntos).
        const bucket = att.storage_bucket ?? (att.path ? 'gestoria-adjuntos' : null);
        const path = att.storage_path ?? att.path ?? null;
        if (!bucket || !path) {
          console.error('dispatch-emails · adjunto sin content_b64 ni storage ref — omitido', { job: job.id, filename });
          adjOmitidos.push(filename);
          continue;
        }
        if (!ATTACH_BUCKETS.includes(bucket)) {
          console.error(`dispatch-emails · adjunto rechazado (bucket fuera de whitelist): ${bucket}`, { job: job.id, filename });
          adjOmitidos.push(filename);
          continue;
        }
        const { data: blob, error: errAtt } = await admin.storage.from(bucket).download(path);
        if (errAtt || !blob) {
          console.error(`dispatch-emails · adjunto no descargable: ${bucket}/${path}`, { job: job.id, filename, error: errAtt?.message });
          adjOmitidos.push(filename);
          continue;
        }
        b64 = uint8ToBase64(new Uint8Array(await blob.arrayBuffer()));
      }

      // §6 A#4: tope de tamaño total — el excedente se omite, el mail sale.
      if (attachB64Total + b64.length > MAX_ATTACH_B64_TOTAL) {
        console.error('dispatch-emails · adjunto omitido por tamaño total', { job: job.id, filename, b64_len: b64.length });
        adjOmitidos.push(filename);
        continue;
      }
      attachB64Total += b64.length;
      attachments.push({ filename, mimeType, b64 });
    } catch (e) {
      console.error('dispatch-emails · adjunto falló — omitido', { job: job.id, filename, error: (e as Error).message });
      adjOmitidos.push(filename);
    }
  }

  // DGG-268 · Transporte ya decidido arriba (jobUsesSes, paso 2a): marketing + flag ON ⇒ SES.
  // Allí se chequearon credenciales (fail-closed: difiere, NUNCA cruza a Gmail), auto-pausa del
  // freno y cupo de la rampa de warm-up (F5). El From usa el subdominio verificado (reputación
  // aislada) y el Reply-To queda en la casilla real para que las respuestas lleguen.
  const useSes = jobUsesSes; // credenciales SES garantizadas por el guard del paso 2a
  const fromEmail = useSes ? `${senderEmail.split('@')[0]}@${SES_FROM_DOMAIN}` : senderEmail;
  const effectiveReplyTo = useSes ? senderEmail : replyToEmail;
  const fromHeader = `${encodeRfc2047('Gestión Global')} <${fromEmail}>`;

  // E-GG-261 §6-A#9: envolver el armado del MIME. Un valor "veneno" (p.ej. un
  // lone-surrogate en una variable → encodeURIComponent lanza) NO debe escapar el
  // handler dejando la fila colgada en 'sending': la fallamos por el camino normal
  // (failJob consume el intento + backoff) en vez de esperar 10 min al watchdog.
  let mime: string;
  try {
    mime = buildMimeMessage({
      from: fromHeader,
      to: [job.to_email],
      replyTo: effectiveReplyTo,
      subject,
      html,
      text,
      attachments,
      bajaUrl: bajaUrl ?? undefined,
    });
  } catch (e) {
    await failJob(admin, job, `MIME build: ${(e as Error).message}`);
    return jsonError(500, 'mime build failed');
  }

  let providerMsgId: string | null = null;
  if (useSes) {
    // Carril SES (marketing masivo): SendEmail v2 con el MIME crudo ya armado — SES le pone
    // DKIM/SPF del subdominio. Mismo failJob/backoff que Gmail ante error (la fila reintenta).
    try {
      const res = await sendViaSes({
        region: SES_REGION, accessKeyId: sesAccessKey!, secretAccessKey: sesSecretKey!,
        rawBase64: base64Std(mime),
      });
      if (!res.ok) {
        await failJob(admin, job, `SES ${res.status}: ${res.error ?? ''}`.slice(0, 500));
        return jsonError(502, `ses ${res.status}`);
      }
      providerMsgId = res.messageId ?? null;
    } catch (e) {
      await failJob(admin, job, `SES error: ${(e as Error).message}`);
      return jsonError(502, 'ses error');
    }
  } else {
    const raw = base64UrlEncode(mime);
    try {
      const r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ raw }),
      });
      if (!r.ok) {
        const txt = await r.text();
        await failJob(admin, job, `Gmail ${r.status}: ${txt.slice(0, 500)}`);
        return jsonError(502, `gmail ${r.status}`);
      }
      const j = await r.json() as { id?: string };
      providerMsgId = j.id ?? null;
    } catch (e) {
      await failJob(admin, job, `Gmail error: ${(e as Error).message}`);
      return jsonError(502, 'gmail error');
    }
  }

  // 8) Marcar enviado + sent_emails + throttle.
  // E-GG-108: además de enviado_at (marca real que usa el dispatcher para no
  // reprocesar), avanzar status a 'sent' + sent_at. Es higiene de reporting: sin
  // esto el email ENTREGADO quedaba 'pending' para siempre (101 filas). NO era
  // la causa del banner que vio JL — el health check keyea enviado_at, no status;
  // el banner era un falso positivo del throttle (se arregló reescribiendo el
  // check). Esto mantiene status coherente para EmailQueuePage / cancelaciones.
  const nowIso = new Date().toISOString();
  await admin.from('email_queue').update({
    enviado_at: nowIso,
    sent_at: nowIso,
    status: 'sent',
    sending_started_at: null,
    // DGG-118 (§6 A#5): si algún adjunto se omitió, dejar rastro PERSISTENTE
    // (el mail salió, pero incompleto — visible en EmailQueuePage, no solo en
    // logs efímeros de la edge). status sigue 'sent': el mail SÍ se entregó.
    ultimo_error: adjOmitidos.length
      ? `enviado SIN adjunto(s): ${adjOmitidos.join(', ')}`
      : null,
  }).eq('id', job.id);

  await admin.from('sent_emails').insert({
    to_email: job.to_email,
    from_email: fromEmail,          // DGG-268: el From REAL (subdominio SES si useSes, si no el alias)
    from_casilla: casilla,
    reply_to: effectiveReplyTo,
    asunto: subject,
    plantilla: tpl.slug,
    template_slug: tpl.slug,
    html,
    estado: 'sent',
    webhook_status: 'enviado',
    provider_msg_id: providerMsgId,
    administracion_id: job.administracion_id,
    consorcio_id: job.consorcio_id,
    zip_attached: false,
  });

  // DGG-268 F5: el throttle global (ritmo de Gmail) lo actualiza SÓLO el carril Gmail. El carril
  // SES no lo toca (reputación separada; su ritmo lo gobiernan la rampa + el freno + el encadenado).
  if (!useSes) {
    await admin.from('email_throttle').upsert({
      key: THROTTLE_KEY,
      last_sent_at: nowIso,
      updated_at: nowIso,
    });
  }

  // DGG-268 F5 · ENCADENADO del carril SES: tras un envío SES exitoso, si el carril sigue activo
  // y con cupo, disparamos OTRA corrida en background (fetch a nosotros mismos, sin await) para
  // drenar el lote sin esperar el próximo tick del cron (*/1). Cada eslabón RE-LEE la gobernanza
  // (pausa + cupo), así que la cadena se auto-limita y honra freno/rampa; el claim atómico evita
  // doble-envío si se solapa con el cron, que además reanuda la cadena si se corta. El carril
  // Gmail NO encadena (1 por tick, sagrado).
  if (useSes && !sesPausado && (sesRestante - 1) > 0) {
    try {
      const selfUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/dispatch-emails`;
      // @ts-ignore EdgeRuntime es global en Supabase Edge
      EdgeRuntime.waitUntil(
        fetch(selfUrl, { method: 'POST', headers: { Authorization: `Bearer ${serviceKey}` } }).catch(() => {}),
      );
    } catch { /* si falla el encadenado, el cron lo reanuda */ }
  }

  return json({ ok: true, drained: 1, sent_id: job.id, provider_msg_id: providerMsgId, via: useSes ? 'ses' : 'gmail' });
});

// =========================================================================
// MANAXER layout — armado del HTML completo desde los campos visuales
// =========================================================================
function buildManaxerHtml(
  tpl: TemplateRow,
  vars: Record<string, unknown>,
  fromEmail: string,
  replyToEmail: string,
  bajaUrl?: string | null,
  bajaTexto?: string | null,
): string {
  const accent = sanitizeHex(tpl.color_acento) ?? '#0891b2';
  const kicker = renderVars(tpl.kicker, vars);
  const titulo = renderVars(tpl.titulo_visual, vars);
  const cuerpo = renderVars(tpl.cuerpo_html_visual, vars);
  const firma = tpl.firma ? renderVars(tpl.firma, vars) : null;
  const ctaText = tpl.cta_text ? renderVars(tpl.cta_text, vars) : null;
  // E-GG-79: la URL va a un href → escapar UNA sola vez (escapeAttr abajo).
  // renderVars la escaparía primero → doble-escape que rompe query params.
  const ctaUrl = tpl.cta_url ? renderVarsRaw(tpl.cta_url, vars) : null;
  const hasCta = !!(ctaText && ctaUrl);

  const logoBlock = tpl.mostrar_logo
    ? `<tr><td align="center" style="padding:32px 24px 12px 24px;">
        <img src="${LOGO_URL}" alt="Gestión Global"
             style="display:block;max-width:220px;height:auto;margin:0 auto;" />
      </td></tr>`
    : '';

  const kickerBlock = kicker
    ? `<tr><td style="padding:24px 32px 4px 32px;">
        <p style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:12px;font-weight:700;letter-spacing:1.6px;text-transform:uppercase;color:${accent};">${escapeAttr(kicker)}</p>
      </td></tr>`
    : '';

  const tituloBlock = titulo
    ? `<tr><td style="padding:0 32px 8px 32px;">
        <h1 style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:28px;line-height:1.18;font-weight:800;color:#0f172a;">${escapeAttr(titulo)}</h1>
      </td></tr>`
    : '';

  const separator = `<tr><td style="padding:16px 32px 0 32px;">
      <hr style="border:0;border-top:1px solid #e2e8f0;margin:0;" />
    </td></tr>`;

  const cuerpoBlock = `<tr><td style="padding:20px 32px 8px 32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:15px;line-height:1.65;color:#1e293b;">${cuerpo}</td></tr>`;

  const ctaBlock = hasCta
    ? `<tr><td style="padding:8px 32px 24px 32px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0">
          <tr><td style="border-radius:10px;background-color:${accent};">
            <a href="${escapeAttr(ctaUrl!)}" target="_blank" rel="noopener"
               style="display:inline-block;padding:12px 22px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px;">
              ${escapeAttr(ctaText!)}
            </a>
          </td></tr>
        </table>
      </td></tr>`
    : '';

  const firmaBlock = firma
    ? `<tr><td style="padding:12px 32px 28px 32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:13px;color:#64748b;">${escapeAttr(firma)}</td></tr>`
    : '';

  const tablaEnvio = tpl.incluir_tabla_envio
    ? `<tr><td style="padding:0 32px 16px 32px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
               style="border-collapse:collapse;background:#f8fafc;border-radius:10px;">
          <tr>
            <td style="padding:10px 14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:12px;color:#475569;">
              <strong style="color:#0f172a;">FROM</strong> ${escapeAttr(fromEmail)} ·
              <strong style="color:#0f172a;">REPLY-TO</strong> ${escapeAttr(replyToEmail)}
            </td>
          </tr>
        </table>
      </td></tr>`
    : '';

  // DGG-220 Fase 2/4: baja + fuente (sólo marketing a prospectos, cuando hay bajaUrl).
  // La línea de fuente da legitimidad al mailing en frío (§6 B#6): decís por qué lo recibe.
  const bajaLine = bajaUrl
    ? `<br /><span style="color:#b6c0cc;">${bajaTexto ?? 'Recibís este correo porque figurás en el registro público de administradores de consorcios (DPPJ · Pcia. de Buenos Aires). ¿No querés recibir estos correos?'} <a href="${escapeAttr(bajaUrl)}" style="color:#94a3b8;text-decoration:underline;">Darme de baja</a>.</span>`
    : '';
  const footerBlock = `<tr><td style="padding:18px 32px 28px 32px;border-top:1px solid #e2e8f0;background:#f8fafc;border-radius:0 0 16px 16px;">
      <p style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:11px;color:#94a3b8;text-align:center;">
        Enviado por <strong style="color:#475569;">Gestión Global</strong> · <a href="https://www.${DOMAIN}" style="color:${accent};text-decoration:none;">${DOMAIN}</a>${bajaLine}
      </p>
    </td></tr>`;

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${escapeAttr(titulo || 'Gestión Global')}</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f1f5f9;padding:24px 12px;">
  <tr><td align="center">
    <table role="presentation" width="640" cellpadding="0" cellspacing="0" border="0" style="max-width:640px;width:100%;background:#ffffff;border-radius:16px;box-shadow:0 4px 24px rgba(15,23,42,0.06);overflow:hidden;">
      ${logoBlock}
      ${kickerBlock}
      ${tituloBlock}
      ${separator}
      ${cuerpoBlock}
      ${ctaBlock}
      ${firmaBlock}
      ${tablaEnvio}
      ${footerBlock}
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

function escapeAttr(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function sanitizeHex(s: string | null | undefined): string | null {
  if (!s) return null;
  return /^#[0-9a-fA-F]{6}$/.test(s) ? s : null;
}

// Clasifica el slug de un job en su (utm_source, utm_campaign) de marketing, o null
// si NO es marketing (→ no se etiqueta, queda byte-idéntico). ALLOW-LIST explícita:
// todo lo que no matchee acá (comprobantes, constancias, certificados, tracking,
// reset, alta-portal, bienvenida, notifs de gerencia…) NUNCA recibe UTM. DGG-265.
function marketingUtmFor(slug: string | null | undefined): { source: string; campaign: string } | null {
  const s = slug ?? '';
  if (s.startsWith('lexph-newsletter')) return { source: 'newsletter', campaign: s };
  if (s.startsWith('captacion-')) return { source: 'captacion', campaign: s };
  if (s.startsWith('federal-')) return { source: 'federal', campaign: s };
  if (s.startsWith('ofrecimiento-')) return { source: 'ofrecimiento', campaign: s };
  if (s.startsWith('engagement-')) return { source: 'engagement', campaign: s };
  return null;
}

// Agrega utm_source/medium/campaign a los links del SITIO (gestionglobal.ar) de un
// email de marketing. Reglas: (a) sólo href a https://[www.]gestionglobal.ar/... —
// los <img src> y otros dominios (wa.me, imágenes) quedan intactos; (b) NUNCA el link
// de baja (/baja o /lexph/baja) — no se trackea el opt-out; (c) respeta un query
// existente (une con &amp;) y un #hash; (d) usa &amp; (HTML-correcto: el cliente de
// mail lo decodifica a & al navegar). Idempotente: si el link ya trae utm_source no lo
// duplica. utm_medium='email' siempre (eje para la métrica desde_email).
function addMarketingUtm(html: string, source: string, campaign: string): string {
  const utm = `utm_source=${source}&amp;utm_medium=email&amp;utm_campaign=${encodeURIComponent(campaign)}`;
  return html.replace(
    /href="(https:\/\/(?:www\.)?gestionglobal\.ar(?:\/[^"?#]*)?)(\?[^"#]*)?(#[^"]*)?"/gi,
    (m: string, base: string, query: string | undefined, hash: string | undefined) => {
      if (/\/(?:lexph\/)?baja(?:[/?]|$)/i.test(base)) return m;         // no trackear la baja
      if (query && /(?:\?|&|&amp;)utm_source=/i.test(query)) return m;  // ya tiene utm
      const sep = query ? '&amp;' : '?';
      return `href="${base}${query ?? ''}${sep}${utm}${hash ?? ''}"`;
    },
  );
}

// =========================================================================
// Helpers existentes (sin cambios)
// =========================================================================

async function failJob(admin: ReturnType<typeof createClient>, job: QueueRow, msg: string) {
  const nextIntento = (job.intento ?? 0) + 1;
  const exhausted = nextIntento >= job.max_intentos;
  const backoffMin = Math.min(Math.pow(2, nextIntento), 60);
  const nextSchedule = new Date(Date.now() + backoffMin * 60 * 1000).toISOString();

  // E-GG-264: NUNCA pisar una fila ya entregada/cerrada (enviado_at set). Con el
  // claim atómico (E-GG-261 [1]) la carrera que motivó esto ya no ocurre, pero el
  // guard `.is('enviado_at', null)` es barato y elimina de raíz el riesgo de
  // pisar un 'sent' con 'failed'. Ambas ramas limpian el claim (sending_started_at
  // = null) para que el watchdog no tenga nada que reclamar.
  if (exhausted) {
    // E-GG-108: además de enviado_at (stop marker), avanzar status a 'failed'
    // para que no quede 'pending' contando como "atascado" tras agotar reintentos.
    await admin.from('email_queue').update({
      intento: nextIntento,
      ultimo_error: msg,
      enviado_at: new Date().toISOString(),
      status: 'failed',
      sending_started_at: null,
    }).eq('id', job.id).is('enviado_at', null);
  } else {
    // Reintento: liberamos el claim (status→'pending') para que un tick futuro
    // re-reclame la fila en su horario de backoff. (Antes del claim esto era un
    // no-op: la fila seguía 'pending'.)
    await admin.from('email_queue').update({
      intento: nextIntento,
      ultimo_error: msg,
      programado_para: nextSchedule,
      status: 'pending',
      sending_started_at: null,
    }).eq('id', job.id).is('enviado_at', null);
  }
}

function renderVars(tpl: string, vars: Record<string, unknown>): string {
  return tpl.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, k) => {
    const v = vars[k];
    if (v === null || v === undefined) return '';
    return escapeHtmlIfNeeded(String(v));
  });
}

// E-GG-79 (DGG-93 §6) · Sustitución SIN escapar HTML. Para valores que después
// pasan por otro escape (href → escapeAttr) o que son texto plano (body_text):
// escapar acá + escapeAttr = doble-escape (`&` → `&amp;amp;`) que ROMPE las URLs
// con query params (p. ej. el link de recovery ?token=..&type=recovery&redirect_to=..
// perdía sus separadores). El caller es responsable del escape del contexto final.
function renderVarsRaw(tpl: string, vars: Record<string, unknown>): string {
  return tpl.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, k) => {
    const v = vars[k];
    return v === null || v === undefined ? '' : String(v);
  });
}

function escapeHtmlIfNeeded(s: string): string {
  return s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

async function refreshAccessToken(clientId: string, clientSecret: string, refreshToken: string): Promise<string> {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }).toString(),
  });
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`token endpoint ${r.status}: ${txt}`);
  }
  const j = await r.json() as { access_token?: string; error?: string };
  if (!j.access_token) throw new Error(`sin access_token (${j.error ?? 'desconocido'})`);
  return j.access_token;
}

interface MimeAttachment {
  filename: string;
  mimeType: string;
  b64: string;
}

interface MimeArgs {
  from: string;
  to: string[];
  replyTo?: string;
  subject: string;
  html: string;
  text?: string;
  attachments?: MimeAttachment[];
  bajaUrl?: string;
}

function buildMimeMessage(a: MimeArgs): string {
  const boundary = `bound_${Math.random().toString(36).slice(2)}_${Date.now()}`;
  const hasText = !!a.text;
  const hasAttachments = !!a.attachments && a.attachments.length > 0;
  const headers: string[] = [
    `From: ${a.from}`,
    `To: ${a.to.join(', ')}`,
  ];
  if (a.replyTo) headers.push(`Reply-To: ${a.replyTo}`);
  headers.push(`Subject: ${encodeRfc2047(a.subject)}`);
  headers.push('MIME-Version: 1.0');
  headers.push('X-Auto-Response-Suppress: All');
  headers.push('X-Mailer: Gestion Global Platform');
  // DGG-220 Fase 2: baja one-click (RFC 8058) para marketing a prospectos.
  if (a.bajaUrl) {
    headers.push(`List-Unsubscribe: <${a.bajaUrl}>, <mailto:contacto@gestionglobal.ar?subject=baja>`);
    headers.push('List-Unsubscribe-Post: List-Unsubscribe=One-Click');
  }

  // DGG-118: con adjuntos el sobre externo es multipart/mixed — la parte 1 es
  // el cuerpo (multipart/alternative anidado si hay texto plano, html directo
  // si no) y luego un part por adjunto. SIN adjuntos, el output es byte a byte
  // el mismo que siempre (cero riesgo para los ~35 templates existentes).
  if (hasAttachments) {
    const mixedBoundary = `mixed_${Math.random().toString(36).slice(2)}_${Date.now()}`;
    headers.push(`Content-Type: multipart/mixed; boundary="${mixedBoundary}"`);
    const parts: string[] = ['', `--${mixedBoundary}`];

    if (hasText) {
      parts.push(
        `Content-Type: multipart/alternative; boundary="${boundary}"`,
        '',
        `--${boundary}`,
        'Content-Type: text/plain; charset=UTF-8',
        'Content-Transfer-Encoding: base64',
        '',
        chunkBase64(btoa(unescape(encodeURIComponent(a.text!)))),
        `--${boundary}`,
        'Content-Type: text/html; charset=UTF-8',
        'Content-Transfer-Encoding: base64',
        '',
        chunkBase64(btoa(unescape(encodeURIComponent(a.html)))),
        `--${boundary}--`,
      );
    } else {
      parts.push(
        'Content-Type: text/html; charset=UTF-8',
        'Content-Transfer-Encoding: base64',
        '',
        chunkBase64(btoa(unescape(encodeURIComponent(a.html)))),
      );
    }

    for (const att of a.attachments!) {
      parts.push(
        `--${mixedBoundary}`,
        `Content-Type: ${att.mimeType}; name="${att.filename}"`,
        `Content-Disposition: attachment; filename="${att.filename}"`,
        'Content-Transfer-Encoding: base64',
        '',
        chunkBase64(att.b64),
      );
    }
    parts.push(`--${mixedBoundary}--`);
    return headers.join('\r\n') + '\r\n' + parts.join('\r\n');
  }

  if (hasText) {
    headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
    const parts: string[] = [
      '',
      `--${boundary}`,
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      chunkBase64(btoa(unescape(encodeURIComponent(a.text!)))),
      `--${boundary}`,
      'Content-Type: text/html; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      chunkBase64(btoa(unescape(encodeURIComponent(a.html)))),
      `--${boundary}--`,
    ];
    return headers.join('\r\n') + '\r\n' + parts.join('\r\n');
  }

  headers.push('Content-Type: text/html; charset=UTF-8');
  headers.push('Content-Transfer-Encoding: base64');
  return headers.join('\r\n') + '\r\n\r\n' + chunkBase64(btoa(unescape(encodeURIComponent(a.html))));
}

// DGG-118: helpers de adjuntos (mismo patrón que send-constancia-email).
function uint8ToBase64(bytes: Uint8Array): string {
  let bin = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunkSize)));
  }
  return btoa(bin);
}

function sanitizeFilename(s: string): string {
  return s.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-').slice(0, 100);
}

function encodeRfc2047(s: string): string {
  if (/^[\x20-\x7E]*$/.test(s)) return s;
  return `=?UTF-8?B?${btoa(unescape(encodeURIComponent(s)))}?=`;
}

function chunkBase64(b64: string): string {
  return b64.replace(/(.{76})/g, '$1\r\n');
}

function base64UrlEncode(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ─────────────── DGG-268 · Amazon SES (SendEmail v2 Raw + SigV4) ───────────────
// Sin SDK: firma SigV4 a mano con crypto.subtle. Envía el MIME crudo ya armado (DKIM/SPF
// del subdominio los pone SES). Devuelve {ok,status,messageId|error}; el caller falla la
// fila (failJob) ante error, igual que con Gmail.
function base64Std(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin); // estándar (con +/=): lo que espera SES Raw.Data
}

function hexFromBuf(buf: ArrayBuffer): string {
  const b = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < b.length; i++) s += b[i]!.toString(16).padStart(2, '0');
  return s;
}

async function sha256Hex(msg: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(msg));
  return hexFromBuf(d);
}

async function hmacRaw(key: ArrayBuffer | Uint8Array, msg: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(msg));
}

async function sigV4SigningKey(secret: string, dateStamp: string, region: string, service: string): Promise<ArrayBuffer> {
  const kDate = await hmacRaw(new TextEncoder().encode('AWS4' + secret), dateStamp);
  const kRegion = await hmacRaw(kDate, region);
  const kService = await hmacRaw(kRegion, service);
  return await hmacRaw(kService, 'aws4_request');
}

async function sendViaSes(o: {
  region: string; accessKeyId: string; secretAccessKey: string; rawBase64: string;
}): Promise<{ ok: boolean; status: number; messageId?: string; error?: string }> {
  const service = 'ses';
  const host = `email.${o.region}.amazonaws.com`;
  const path = '/v2/email/outbound-emails';
  // Raw: SES toma From/To/Reply-To/List-Unsubscribe de los headers del MIME.
  const body = JSON.stringify({ Content: { Raw: { Data: o.rawBase64 } } });
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, ''); // YYYYMMDDTHHMMSSZ
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = await sha256Hex(body);
  const canonicalHeaders =
    `content-type:application/json\nhost:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = 'content-type;host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = ['POST', path, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${dateStamp}/${o.region}/${service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, await sha256Hex(canonicalRequest)].join('\n');
  const signingKey = await sigV4SigningKey(o.secretAccessKey, dateStamp, o.region, service);
  const signature = hexFromBuf(await hmacRaw(signingKey, stringToSign));
  const authorization =
    `AWS4-HMAC-SHA256 Credential=${o.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const r = await fetch(`https://${host}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Amz-Date': amzDate,
      'X-Amz-Content-Sha256': payloadHash,
      'Authorization': authorization,
    },
    body,
  });
  if (!r.ok) {
    const txt = await r.text();
    return { ok: false, status: r.status, error: txt.slice(0, 500) };
  }
  const j = await r.json().catch(() => ({})) as { MessageId?: string };
  return { ok: true, status: r.status, messageId: j.MessageId };
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function jsonError(status: number, message: string) {
  return new Response(JSON.stringify({ ok: false, error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
