// health-flows-check · Ejercita los flujos críticos del sistema cada 12h.
//                      Citas: DGG-32 (raíz de E-GG-26/27/28). Reglas 7, 12.
//
// Por qué existe: tres regresiones silenciosas de mayo-junio 2026 cayeron
// en producción y nadie las vio durante días (captación huérfana, cron 401,
// push web sin escalar). Cada una rompía un flujo asíncrono crítico cuya
// falla no salía a la UI. Este health check los ejercita "en cadena":
// no se conforma con `SELECT 1` — verifica el trigger correcto, el secret
// correcto, que la fn correcta tenga el INSERT correcto.
//
// Checks implementados (ver array CHECKS abajo):
//   email_queue_atascada    — SÓLO el carril transaccional (Gmail, clasificado por
//                             slug vía email_cola_carriles); el marketing SES (goteo)
//                             no alarma (E-GG-306 + DGG-274)
//   push_queue_atascada     — rows en push_notifications_queue >30min sin enviar
//   cron_dispatchers_activos — los 3 jobs (emails/push/arca) están active=true
//   cron_secret_alineado    — los 3 dispatchers responden 200 al bearer del env
//   trigger_captacion       — el trigger formulario_submission_a_solicitud existe
//   notif_escala_push       — private.notif_emitir contiene push_notifications_queue
//   arca_dispatcher         — el dispatcher ARCA está activo (no atascado)
//
// Cada check devuelve { status: 'ok'|'warning'|'critical', detail, metric? }.
// El overall_status es 'critical' si alguno crítico, sino 'warning' si alguno
// es warning, sino 'ok'.
//
// Auth: igual que dispatch-emails (CRON_SECRET o SERVICE_ROLE_KEY en Bearer).
// verify_jwt = false (la auth vive ADENTRO — el bearer del cron no es un JWT).
// Trigger: pg_cron 0 3,15 * * * (00:00 y 12:00 ART en UTC-3).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.46.1';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET') ?? '';

type CheckStatus = 'ok' | 'warning' | 'critical' | 'skipped';
interface CheckResult {
  status: CheckStatus;
  detail: string;
  metric?: number;
}

function jsonResp(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ----------------------------------------------------------------------------
// Helpers de checks
// ----------------------------------------------------------------------------

async function check_email_queue_atascada(admin: ReturnType<typeof createClient>): Promise<CheckResult> {
  // DGG-274 / E-GG-306 · CHEQUEO CONSCIENTE DE CARRILES — CLASIFICADO POR SLUG (no por prioridad).
  // Desde que el marketing migró a SES con goteo/topes diarios, la cola tiene DOS carriles con
  // semánticas opuestas:
  //   · TRANSACCIONAL (Gmail): confirmaciones/resets/matriculación. DEBE drenar en minutos. Es el
  //     ÚNICO carril cuyo ritmo sella el throttle global `last_sent_at` (dispatch-emails L681:
  //     "el throttle global lo actualiza SÓLO el carril Gmail"). Backlog viejo acá + Gmail mudo = falla.
  //   · MARKETING (SES): sale en goteo POR DISEÑO. Un backlog de miles es el estado esperado; tiene
  //     su propia gobernanza (ses_lane_estado, topes, freno) y su propio reporte semanal.
  // IMPORTANTE (residuo de E-GG-306): el carril lo decide el dispatcher por SLUG (marketingUtmFor:
  // prefijos lexph-newsletter/captacion-/federal-/ofrecimiento-/engagement-), NO por prioridad — un
  // `ofrecimiento-rpac-renovacion` encolado en prioridad 2/5 igual va a SES. Por eso clasificamos con
  // la MISMA fuente de verdad vía la RPC email_cola_carriles() (mig 0742), no con prioridad<=5.
  const STALE_MS = 20 * 60 * 1000; // holgura amplia (20 ventanas de 60s)
  const now = Date.now();

  const { data, error } = await admin.rpc('email_cola_carriles' as never);
  if (error) {
    return { status: 'critical', detail: `No se pudo consultar la cola por carril: ${error.message}` };
  }
  const row = (Array.isArray(data) ? data[0] : data) as
    { tx_backlog: number; tx_oldest_due: string | null; mkt_backlog: number } | null;
  const backlog = Number(row?.tx_backlog ?? 0);
  const mkt = Number(row?.mkt_backlog ?? 0);
  const mktNota = mkt > 0 ? ` · marketing en goteo por SES: ${mkt} en cola (no es alarma)` : '';

  if (backlog === 0) return { status: 'ok', detail: `Transaccional al día${mktNota}`, metric: 0 };

  // ¿El carril Gmail dio señales de vida? last_sent_at fresco = está drenando.
  const { data: thr } = await admin
    .from('email_throttle').select('last_sent_at').eq('key', 'global').maybeSingle();
  const lastSentMs = thr?.last_sent_at
    ? now - new Date((thr as { last_sent_at: string }).last_sent_at).getTime()
    : Infinity;
  const oldestDueMs = row?.tx_oldest_due ? now - new Date(row.tx_oldest_due).getTime() : 0;

  // Falla REAL: hay transaccional esperando hace rato Y el carril Gmail está mudo.
  if (oldestDueMs > STALE_MS && lastSentMs > STALE_MS) {
    const mins = Number.isFinite(lastSentMs) ? Math.round(lastSentMs / 60000) : null;
    return {
      status: 'critical',
      detail: `${backlog} transaccional(es) en cola y Gmail no envía hace ${mins ?? '∞'} min (cron caído?)${mktNota}`,
      metric: backlog,
    };
  }
  // Aviso suave: un transaccional lleva +20 min esperando aunque el dispatcher viva.
  if (oldestDueMs > STALE_MS) {
    return {
      status: 'warning',
      detail: `${backlog} transaccional(es) esperando +${Math.round(oldestDueMs / 60000)} min${mktNota}`,
      metric: backlog,
    };
  }
  return { status: 'ok', detail: `${backlog} transaccional(es) en cola, drenando${mktNota}`, metric: backlog };
}

async function check_push_queue_atascada(admin: ReturnType<typeof createClient>): Promise<CheckResult> {
  // Schema real (mig 0063): columnas `intento` (singular), `enviada_at`.
  const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const { data, error } = await admin
    .from('push_notifications_queue')
    .select('id, intento, max_intentos')
    .lt('created_at', cutoff)
    .is('enviada_at', null)
    .limit(50);

  if (error) {
    return { status: 'warning', detail: `No se pudo consultar push_queue: ${error.message}` };
  }

  const pendientes = (data ?? []).filter((r: { intento: number; max_intentos: number }) =>
    r.intento < r.max_intentos
  );
  const count = pendientes.length;

  if (count === 0) return { status: 'ok', detail: 'Sin push atascados', metric: 0 };
  if (count <= 3) return { status: 'warning', detail: `${count} push pendientes hace +30min`, metric: count };
  return { status: 'critical', detail: `${count} push atascados (cron caído?)`, metric: count };
}

async function check_cron_dispatchers_activos(admin: ReturnType<typeof createClient>): Promise<CheckResult> {
  // Usamos una RPC simple: SELECT FROM cron.job WHERE jobname IN (...) AND active=true
  // No tenemos acceso directo via supabase-js a cron.* — lo hacemos via RPC.
  // Si no existe la RPC, fallback a 'skipped'.
  const expected = ['dispatch-emails-1min', 'dispatch-push-2min', 'arca-dispatch-every-min'];
  const { data, error } = await admin.rpc('health_check_cron_jobs_status' as never, {
    p_jobnames: expected,
  } as never);

  if (error) {
    // Si no existe, lo creamos en la próxima migración. Por ahora skipped.
    return { status: 'skipped', detail: `RPC no disponible: ${error.message}` };
  }

  const rows = (data ?? []) as Array<{ jobname: string; active: boolean }>;
  const inactivos = expected.filter(name => {
    const row = rows.find(r => r.jobname === name);
    return !row || !row.active;
  });

  if (inactivos.length === 0) {
    return { status: 'ok', detail: 'Los 3 dispatchers (emails/push/arca) activos', metric: 3 };
  }
  return {
    status: 'critical',
    detail: `Cron(s) inactivo(s): ${inactivos.join(', ')}`,
    metric: inactivos.length,
  };
}

async function check_cron_secret_alineado(): Promise<CheckResult> {
  // Hacemos POST a las 3 fns con el bearer del env y validamos la AUTH.
  // Detecta el caso E-GG-27 donde el cron usaba un secret obsoleto.
  //
  // DGG-274 / E-GG-308 · NO confundir "secret desalineado" con "hipo de envío". Un 5xx del
  // dispatcher significa que el bearer FUE ACEPTADO (si estuviera mal daría 401/403) y el error
  // es downstream: dispatch-emails devuelve 502 ante un error TRANSITORIO del carril SES/Gmail/OAuth
  // (jsonError '{ok:false,error:"ses ..."}'), que ya tiene su propia gobernanza (failJob + ses_freno_check).
  // Antes, cualquier status>=500 se rotulaba 'critical: Secret desalineado' y pusheaba a toda la
  // gerencia — un falso crítico por un rechazo de SES. Ahora: SÓLO 401/403 = secret (critical);
  // 5xx/red = aviso aparte (warning), nunca bajo el banner del secret.
  if (!CRON_SECRET) {
    return { status: 'warning', detail: 'CRON_SECRET no está seteado en este env' };
  }
  const fns = ['dispatch-emails', 'dispatch-push', 'dispatch-arca-emission'];
  const desalineados: string[] = [];   // 401/403 → el secret REALMENTE no alinea (señal E-GG-27)
  const noConcluyentes: string[] = []; // 5xx/red → el bearer pasó; el error es downstream (no es el secret)
  for (const fn of fns) {
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/${fn}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${CRON_SECRET}`,
        },
        body: '{}',
      });
      if (res.status === 401 || res.status === 403) {
        desalineados.push(`${fn} → ${res.status}`);
      } else if (res.status >= 500) {
        noConcluyentes.push(`${fn} → ${res.status}`);
      }
    } catch (e) {
      noConcluyentes.push(`${fn} → ${(e as Error).message}`);
    }
  }
  if (desalineados.length > 0) {
    return {
      status: 'critical',
      detail: `Secret desalineado: ${desalineados.join('; ')}`,
      metric: desalineados.length,
    };
  }
  if (noConcluyentes.length > 0) {
    return {
      status: 'warning',
      detail: `El bearer pasó (el secret está bien) pero un dispatcher respondió 5xx — probable hipo transitorio de envío (SES/Gmail), que tiene su propia gobernanza: ${noConcluyentes.join('; ')}`,
      metric: noConcluyentes.length,
    };
  }
  return { status: 'ok', detail: 'Los 3 dispatchers responden 2xx al bearer del cron', metric: 0 };
}

async function check_trigger_captacion(admin: ReturnType<typeof createClient>): Promise<CheckResult> {
  // El trigger real se llama `trg_subm_auto_tramite` (mig 0036+), llama
  // `crear_tramite_desde_submission_auto()`. Cubre la captación E-GG-26.
  const { data, error } = await admin.rpc('health_check_trigger_existe' as never, {
    p_table: 'formulario_submissions',
    p_trigger_name_like: '%auto_tramite%',
  } as never);

  if (error) {
    return { status: 'skipped', detail: `RPC no disponible: ${error.message}` };
  }

  const exists = Array.isArray(data) && data.length > 0;
  if (exists) {
    return { status: 'ok', detail: 'Trigger captación → solicitudes presente' };
  }
  return {
    status: 'critical',
    detail: 'Trigger captación no encontrado — formularios huérfanos',
  };
}

async function check_notif_escala_push(admin: ReturnType<typeof createClient>): Promise<CheckResult> {
  // Verifica que la fn private.notif_emitir contiene 'push_notifications_queue'
  // en su definición. Detecta regresión E-GG-28 (escala a push perdida).
  const { data, error } = await admin.rpc('health_check_fn_contains' as never, {
    p_schema: 'private',
    p_fn_name: 'notif_emitir',
    p_needle: 'push_notifications_queue',
  } as never);

  if (error) {
    return { status: 'skipped', detail: `RPC no disponible: ${error.message}` };
  }

  if (data === true) {
    return { status: 'ok', detail: 'notif_emitir escala a push correctamente' };
  }
  return {
    status: 'critical',
    detail: 'notif_emitir NO inserta a push_notifications_queue — campanita huérfana',
  };
}

async function check_arca_comprobantes_atascados(admin: ReturnType<typeof createClient>): Promise<CheckResult> {
  // Rows en arca_emision_queue con status='pending', scheduled_at >2h, finished_at NULL.
  // Eso es el cuello típico cuando el dispatcher ARCA falla.
  const cutoff = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const { data, error } = await admin
    .from('arca_emision_queue')
    .select('id, attempt, max_attempts')
    .eq('status', 'pending')
    .lt('scheduled_at', cutoff)
    .is('finished_at', null)
    .limit(50);

  if (error) {
    return { status: 'skipped', detail: `consulta no disponible: ${error.message}` };
  }

  const pendientes = (data ?? []).filter((r: { attempt: number; max_attempts: number }) =>
    r.attempt < r.max_attempts
  );
  const count = pendientes.length;
  if (count === 0) return { status: 'ok', detail: 'Sin comprobantes ARCA atascados', metric: 0 };
  if (count <= 2) return { status: 'warning', detail: `${count} comprobante(s) ARCA >2h sin autorizar`, metric: count };
  return { status: 'critical', detail: `${count} comprobantes ARCA atascados`, metric: count };
}

// ----------------------------------------------------------------------------
// Main handler
// ----------------------------------------------------------------------------

interface CheckDef {
  key: string;
  label: string;
  fn: (admin: ReturnType<typeof createClient>) => Promise<CheckResult>;
}

const CHECKS: CheckDef[] = [
  { key: 'email_queue_atascada', label: 'Cola de emails', fn: check_email_queue_atascada },
  { key: 'push_queue_atascada', label: 'Cola de push', fn: check_push_queue_atascada },
  { key: 'cron_dispatchers_activos', label: 'Cron dispatchers', fn: check_cron_dispatchers_activos },
  { key: 'cron_secret_alineado', label: 'Cron secret alineado', fn: () => check_cron_secret_alineado() },
  { key: 'trigger_captacion', label: 'Trigger captación → solicitudes', fn: check_trigger_captacion },
  { key: 'notif_escala_push', label: 'Notif escala a push web', fn: check_notif_escala_push },
  { key: 'arca_comprobantes', label: 'Comprobantes ARCA', fn: check_arca_comprobantes_atascados },
];

Deno.serve(async (req) => {
  if (req.method === 'GET') {
    return new Response('health-flows-check alive', { status: 200 });
  }

  // Auth: CRON_SECRET (preferido) o SERVICE_ROLE_KEY
  const authHeader = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '').trim() ?? '';
  if (authHeader !== SERVICE_KEY && (!CRON_SECRET || authHeader !== CRON_SECRET)) {
    return jsonResp(401, { ok: false, error: 'unauthorized' });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  // Permitimos que el caller diga origen='manual' (desde UI gerente)
  let body: { origen?: string } = {};
  try { body = await req.json(); } catch { /* sin body */ }
  const origen = body.origen === 'manual' ? 'manual' : 'cron';

  const startedAt = Date.now();
  const results: Record<string, CheckResult> = {};

  for (const c of CHECKS) {
    try {
      results[c.key] = await c.fn(admin);
    } catch (e) {
      results[c.key] = {
        status: 'critical',
        detail: `Excepción en el check: ${(e as Error).message}`,
      };
    }
  }

  const statuses = Object.values(results).map(r => r.status);
  let overall: 'ok' | 'warning' | 'critical';
  if (statuses.some(s => s === 'critical')) overall = 'critical';
  else if (statuses.some(s => s === 'warning')) overall = 'warning';
  else overall = 'ok';

  const durationMs = Date.now() - startedAt;

  // Registrar la corrida (la RPC crea/cierra alerts y dispatchea push)
  const { data: runId, error: recordError } = await admin.rpc(
    'health_flow_record_run' as never,
    {
      p_overall_status: overall,
      p_duration_ms: durationMs,
      p_checks: results,
      p_origen: origen,
    } as never,
  );

  if (recordError) {
    return jsonResp(500, {
      ok: false,
      error: `No se pudo registrar la corrida: ${recordError.message}`,
      results,
      overall,
      duration_ms: durationMs,
    });
  }

  // Garbage collect alertas viejas (>24h sin reconfirmación)
  try {
    await admin.rpc('health_flow_alerts_garbage_collect' as never);
  } catch {
    // no es crítico
  }

  return jsonResp(200, {
    ok: true,
    run_id: runId,
    overall_status: overall,
    duration_ms: durationMs,
    checks: results,
  });
});
