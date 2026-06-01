// db-health-alert-check · cron diario.
//
// 1. Llama a la RPC db_health_metrics() (via service_role, bypassa is_staff).
// 2. Por cada alerta del payload, chequea si ya se notificó en las últimas 24h.
// 3. Si no, encola push + email a todos los gerentes y registra en
//    salud_alertas_log para idempotencia.
//
// Trigger: pg_cron diario 12:00 UTC = 09:00 ART.
// Auth: exige Bearer CRON_SECRET o service_role.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.46.1';

interface Alert {
  kind: string;
  severity: 'warning' | 'critical';
  message: string;
}

Deno.serve(async (req) => {
  if (req.method === 'GET') return new Response('db-health-alert-check alive', { status: 200 });

  const cronSecret = Deno.env.get('CRON_SECRET');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const authHeader = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '').trim() ?? '';
  if (authHeader !== serviceKey && (!cronSecret || authHeader !== cronSecret)) {
    return json({ ok: false, error: 'unauthorized' }, 401);
  }

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey);

  // 1) Llamar la RPC
  const { data: payload, error: errRpc } = await admin.rpc('db_health_metrics');
  if (errRpc) return json({ ok: false, error: `rpc: ${errRpc.message}` }, 500);

  const alerts = (payload as { alerts?: Alert[] })?.alerts ?? [];
  if (alerts.length === 0) return json({ ok: true, alerts: 0 });

  // 2) Listar gerentes destinatarios
  const { data: gerentes } = await admin
    .from('profiles')
    .select('id, full_name')
    .in('role', ['gerente', 'operador']);
  if (!gerentes || gerentes.length === 0) {
    return json({ ok: true, alerts: alerts.length, skipped: 'sin gerentes' });
  }

  let sent = 0;
  let throttled = 0;

  for (const alert of alerts) {
    // 3) Throttle 24h por kind
    const { data: last } = await admin
      .from('salud_alertas_log')
      .select('enviado_at')
      .eq('kind', alert.kind)
      .order('enviado_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (last) {
      const diffHours = (Date.now() - new Date(last.enviado_at).getTime()) / (1000 * 60 * 60);
      if (diffHours < 24) {
        throttled++;
        continue;
      }
    }

    // 4) Encolar push a cada gerente
    const pushRows = gerentes.map((g) => ({
      user_id: g.id,
      titulo: alert.severity === 'critical' ? '🚨 Salud del sistema · crítico' : '⚠️ Salud del sistema',
      cuerpo: alert.message,
      icono_url: 'https://www.gestionglobal.ar/logo-color.png',
      click_url: 'https://www.gestionglobal.ar/gerencia/configuracion/salud-sistema',
    }));
    if (pushRows.length > 0) {
      await admin.from('push_notifications_queue').insert(pushRows);
    }

    // 5) Encolar email a cada gerente
    const emailRows = await Promise.all(
      gerentes.map(async (g) => {
        // Obtener email del auth.users
        const { data: u } = await admin.auth.admin.getUserById(g.id);
        if (!u?.user?.email) return null;
        return {
          kind: 'workflow',
          template_slug: 'salud-sistema-alerta',
          to_email: u.user.email,
          to_nombre: g.full_name ?? 'Gerencia',
          variables: {
            severidad_label: alert.severity === 'critical' ? 'CRÍTICO' : 'Advertencia',
            mensaje: alert.message,
            link_panel: 'https://www.gestionglobal.ar/gerencia/configuracion/salud-sistema',
          },
          prioridad: alert.severity === 'critical' ? 1 : 2,
          intento: 0,
          max_intentos: 3,
          programado_para: new Date().toISOString(),
        };
      }),
    );
    const validEmails = emailRows.filter(Boolean);
    if (validEmails.length > 0) {
      // @ts-expect-error tipo dinámico
      await admin.from('email_queue').insert(validEmails);
    }

    // 6) Registrar en log
    await admin.from('salud_alertas_log').insert({
      kind: alert.kind,
      severity: alert.severity,
      message: alert.message,
    });

    sent++;
  }

  return json({ ok: true, alerts: alerts.length, sent, throttled });
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
