// dispatch-arca-emission · cron processor. Lee N jobs pending vencidos y los
// despacha en serie a arca-autorizar-comprobante. verify_jwt=false; bearer
// CRON_SECRET o service_role. Doc 02 §4 + §4.8 ítem 5.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.46.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const MAX_JOBS_POR_CORRIDA = 5;
// C1/A4 (Auditoría 2026-09): timeout de la llamada a arca-autorizar-comprobante. Sin él, si
// AFIP cuelga la emisión, la corrida entera quedaba retenida hasta el wall-clock limit. 90s >
// 3×20s de las llamadas SOAP internas; al vencer, el job queda 'pending' (no se pierde) y lo
// reintenta el próximo cron + el watchdog reset_arca_jobs_colgados.
const AUTORIZAR_TIMEOUT_MS = 90000;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return jsonError(405, 'Method not allowed');

  const bearer = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const cronSecret = Deno.env.get('CRON_SECRET');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!bearer || (bearer !== cronSecret && bearer !== serviceKey)) {
    return jsonError(401, 'Bearer inválido');
  }

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey!);
  const { data: jobs, error } = await admin
    .from('arca_emision_queue')
    .select('id')
    .eq('status', 'pending')
    .lte('scheduled_at', new Date().toISOString())
    .order('scheduled_at', { ascending: true })
    .limit(MAX_JOBS_POR_CORRIDA);
  if (error) return jsonError(500, `Query falló: ${error.message}`);
  if (!jobs || jobs.length === 0) {
    return new Response(JSON.stringify({ ok: true, procesados: 0 }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const url = `${Deno.env.get('SUPABASE_URL')!}/functions/v1/arca-autorizar-comprobante`;
  const results: Array<{ job_id: string; ok: boolean; error?: string }> = [];

  for (const j of jobs) {
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${cronSecret ?? serviceKey}`,
        },
        body: JSON.stringify({ job_id: j.id }),
        signal: AbortSignal.timeout(AUTORIZAR_TIMEOUT_MS),
      });
      const body = await r.json().catch(() => ({}));
      results.push({ job_id: j.id as string, ok: !!body.ok, error: body.error });
    } catch (e) {
      results.push({ job_id: j.id as string, ok: false, error: (e as Error).message });
    }
  }

  return new Response(
    JSON.stringify({ ok: true, procesados: results.length, results }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );
});

function jsonError(status: number, message: string) {
  return new Response(JSON.stringify({ ok: false, error: message }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
