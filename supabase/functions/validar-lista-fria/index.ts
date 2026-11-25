// validar-lista-fria · DGG-268 F5 (chunk 3). Valida por DNS la lista fría (import_nacional)
// y suprime (HARD, 'invalida') las direcciones cuyo DOMINIO está muerto (sin MX ni A/AAAA).
// Reusable para futuros imports. El DNS lo hace Deno.resolveDns (server-side, sin mover datos
// a terceros: sólo consulta registros públicos de los dominios). Los BUZONES muertos con
// dominio vivo (typos tipo 'samchez') NO se detectan acá — los caza el freno (ses_freno_check)
// con los rebotes reales de SES durante la rampa de warm-up.
//
// Auth: CRON_SECRET / service_role en Bearer (verify_jwt=false en config.toml).
// Body (JSON, opcional): { "origen": "import_nacional", "apply": true }.
//   apply=false (default) ⇒ DRY-RUN (reporta muertos, no suprime). apply=true ⇒ suprime.
//
// Reusa cold_list_dominios(p_origen) + cold_list_suprimir_dominios(p_origen, p_doms[]) (mig 0729).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.46.1';

const BATCH = 40; // dominios resueltos en paralelo por tanda

async function dominioVivo(dom: string): Promise<boolean> {
  // Vivo si tiene MX; fallback RFC 5321: si no hay MX, vale un A/AAAA.
  for (const tipo of ['MX', 'A', 'AAAA'] as const) {
    try {
      const r = await Deno.resolveDns(dom, tipo);
      if (Array.isArray(r) && r.length > 0) return true;
    } catch (_e) {
      // NXDOMAIN / sin registro de ese tipo / timeout → probar el siguiente tipo.
    }
  }
  return false;
}

Deno.serve(async (req) => {
  if (req.method === 'GET') return new Response('validar-lista-fria alive', { status: 200 });

  const cronSecret = Deno.env.get('CRON_SECRET');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const authHeader = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '').trim() ?? '';
  if (authHeader !== serviceKey && (!cronSecret || authHeader !== cronSecret)) {
    return new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    });
  }

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey);
  const body = await req.json().catch(() => ({})) as { origen?: string; apply?: boolean };
  const origen = typeof body.origen === 'string' ? body.origen : 'import_nacional';
  const apply = body.apply === true;

  const { data: doms, error } = await admin.rpc('cold_list_dominios', { p_origen: origen });
  if (error) {
    return new Response(JSON.stringify({ ok: false, error: error.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
  const lista = (doms ?? []) as { dom: string; n: number }[];

  const muertos: string[] = [];
  let emailsMuertos = 0;
  for (let i = 0; i < lista.length; i += BATCH) {
    const slice = lista.slice(i, i + BATCH);
    const res = await Promise.all(slice.map(async (d) => ({ d, vivo: await dominioVivo(d.dom) })));
    for (const { d, vivo } of res) {
      if (!vivo) { muertos.push(d.dom); emailsMuertos += d.n; }
    }
  }

  let suprimidos = 0;
  if (apply && muertos.length > 0) {
    const { data: sup, error: e2 } = await admin.rpc('cold_list_suprimir_dominios', {
      p_origen: origen, p_doms: muertos,
    });
    if (e2) {
      return new Response(JSON.stringify({ ok: false, error: e2.message, dominios_muertos: muertos.length }), {
        status: 500, headers: { 'Content-Type': 'application/json' },
      });
    }
    suprimidos = (sup as number) ?? 0;
  }

  return new Response(JSON.stringify({
    ok: true,
    origen,
    apply,
    dominios: lista.length,
    dominios_muertos: muertos.length,
    emails_en_muertos: emailsMuertos,
    suprimidos,
    muertos_sample: muertos.slice(0, 60),
  }), { headers: { 'Content-Type': 'application/json' } });
});
