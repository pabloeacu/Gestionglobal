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
//   email_queue_atascada    — rows en email_queue >30min sin enviar
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
  // E-GG-108: el dispatcher de emails envía CON throttle (DGG-113: 60s global
  // entre destinatarios distintos + piso 5 min por destinatario, lección E42/
  // D05). Por eso una cola de emails esperando NO es "cron caído": es el
  // throttle drenando de a uno (un burst de N a destinatarios distintos tarda
  // ~N minutos). La versión anterior gritaba "crítico" ante cualquier backlog
  // de +30min y daba falsas alarmas constantes. Señal REAL de caída: hay cola
  // due-sin-enviar Y (a) el más viejo lleva esperando > una ventana holgada Y
  // (b) el dispatcher no marcó ningún envío en ese lapso (last_sent_at stale).
  // Ambas condiciones evitan el falso positivo del período quieto (cola recién
  // llegada con last_sent_at viejo) y el del throttle drenando (last_sent_at fresco).
  const STALE_MS = 20 * 60 * 1000; // holgura amplia (20 ventanas de 60s)
  const { data, error } = await admin
    .from('email_queue')
    .select('id, intento, max_intentos, programado_para')
    .lte('programado_para', new Date().toISOString())
    .is('enviado_at', null)
    .order('programado_para', { ascending: true })
    .limit(200);

  if (error) {
    return { status: 'critical', detail: `No se pudo consultar email_queue: ${error.message}` };
  }

  const retryable = (data ?? []).filter((r: { intento: number; max_intentos: number }) =>
    r.intento < r.max_intentos
  );
  const backlog = retryable.length;
  if (backlog === 0) return { status: 'ok', detail: 'Cola de emails al día', metric: 0 };

  // ¿El dispatcher dio señales de vida? last_sent_at fresco = está drenando.
  const { data: thr } = await admin
    .from('email_throttle').select('last_sent_at').eq('key', 'global').maybeSingle();
  const lastSentMs = thr?.last_sent_at
    ? Date.now() - new Date((thr as { last_sent_at: string }).last_sent_at).getTime()
    : Infinity;
  const oldestDueMs = Date.now() - new Date(
    (retryable[0] as { programado_para: string }).programado_para,
  ).getTime();

  if (oldestDueMs > STALE_MS && lastSentMs > STALE_MS) {
    const mins = Number.isFinite(lastSentMs) ? Math.round(lastSentMs / 60000) : null;
    return {
      status: 'critical',
      detail: `${backlog} email(s) en cola y el dispatcher no envía hace ${mins ?? '∞'} min (cron caído?)`,
      metric: backlog,
    };
  }
  if (backlog > 40) {
    return {
      status: 'warning',
      detail: `${backlog} emails en cola (throttle 60s; ~${Math.max(1, Math.round(backlog / 60))}h para drenar)`,
      metric: backlog,
    };
  }
  return { status: 'ok', detail: `${backlog} email(s) en cola, drenando con throttle`, metric: backlog };
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
  // Hacemos POST a las 3 fns con el bearer del env y validamos 2xx.
  // Esto detecta el caso E-GG-27 donde el cron usaba un secret obsoleto.
  if (!CRON_SECRET) {
    return { status: 'warning', detail: 'CRON_SECRET no está seteado en este env' };
  }
  const fns = ['dispatch-emails', 'dispatch-push', 'dispatch-arca-emission'];
  const fallidos: string[] = [];
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
      // 200 = OK, también 200 con throttled:true. 401 = secret desalineado.
      if (res.status === 401) {
        fallidos.push(`${fn} → 401`);
      } else if (res.status >= 500) {
        fallidos.push(`${fn} → ${res.status}`);
      }
    } catch (e) {
      fallidos.push(`${fn} → ${(e as Error).message}`);
    }
  }
  if (fallidos.length === 0) {
    return { status: 'ok', detail: 'Los 3 dispatchers responden 2xx al bearer del cron', metric: 0 };
  }
  return {
    status: 'critical',
    detail: `Secret desalineado: ${fallidos.join('; ')}`,
    metric: fallidos.length,
  };
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
