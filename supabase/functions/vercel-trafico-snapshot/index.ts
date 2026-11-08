// vercel-trafico-snapshot — DGG-245.
// Consulta la API de Web Analytics de Vercel (server-side, con VERCEL_ANALYTICS_TOKEN)
// y hace UPSERT del tráfico por superficie (landing = '/', lexph = '/lexph*') y ventana
// (hoy=24h / 7d / 30d) en public.vercel_trafico, que leen las cards de gerencia.
//
// Auth: verify_jwt=false (config.toml) + is_cron_token adentro (patrón del repo).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const TEAM_ID = 'team_OljNRseVlgxscZzarVO4XDzA';
const PROJECT_ID = 'prj_38DTR3jSOlfqYMVBOAsZugeH5YPz';
const VA = 'https://api.vercel.com/v1/query/web-analytics';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

const WINDOWS: Record<string, number> = {
  hoy: 24 * 3600_000,
  '7d': 7 * 24 * 3600_000,
  '30d': 30 * 24 * 3600_000,
};
const SURFACES: Record<string, string> = {
  landing: "requestPath eq '/'",
  lexph: "startswith(requestPath, '/lexph')",
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const token = Deno.env.get('VERCEL_ANALYTICS_TOKEN');
  if (!token) return json({ ok: false, error: 'Falta el secret VERCEL_ANALYTICS_TOKEN.' }, 500);

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // Auth interna (verify_jwt=false + validación propia, patrón del repo): sólo el cron,
  // que manda Authorization = Bearer <cron_secret> (private.cron_bearer / is_cron_token).
  const authToken = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  const { data: isCron } = await admin.rpc('is_cron_token', { p_token: authToken });
  if (!isCron) return json({ ok: false, error: 'No autorizado.' }, 401);

  const now = Date.now();
  const until = new Date(now).toISOString();
  let loggedRaw = false;

  async function va(path: string, params: Record<string, string>): Promise<any> {
    const url = new URL(`${VA}/${path}`);
    url.searchParams.set('teamId', TEAM_ID);
    url.searchParams.set('projectId', PROJECT_ID);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const r = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
    // 404 = WA prendido sin datos aun; 402 = dimension UTM sin el add-on Web
    // Analytics Plus (Pablo lo dejo para despues). Ambos -> "0", sin error.
    if (r.status === 404 || r.status === 402) return { __nodata: true };
    const txt = await r.text();
    if (!r.ok) throw new Error(`Vercel ${r.status}: ${txt.slice(0, 220)}`);
    const data = txt ? JSON.parse(txt) : {};
    if (!loggedRaw) { loggedRaw = true; console.log(`[raw ${path}]`, txt.slice(0, 600)); }
    return data;
  }

  // Totales de una superficie+ventana: aggregate agrupado por environment (1 grupo prod)
  // → count (vistas) + visitors (visitantes únicos del universo filtrado).
  async function surfaceTotals(filter: string, since: string) {
    const res = await va('visits/aggregate', {
      by: 'environment',
      since, until,
      filter: `${filter} and environment eq 'production'`,
      limit: '5',
    });
    if (res.__nodata) return { vistas: 0, visitantes: 0 };
    const rows: any[] = Array.isArray(res?.data)
      ? res.data
      : (res?.data && typeof res.data === 'object' ? [res.data] : []);
    let vistas = 0, visitantes = 0;
    for (const row of rows) {
      vistas += Number(row?.count ?? row?.total ?? row?.pageviews ?? row?.views ?? 0);
      visitantes += Number(row?.visitors ?? row?.uniqueVisitors ?? row?.devices ?? 0);
    }
    // Fallback: algunas respuestas traen el total en el nivel superior.
    if (!rows.length) {
      vistas = Number(res?.count ?? res?.total ?? 0);
      visitantes = Number(res?.visitors ?? res?.uniqueVisitors ?? 0);
    }
    return { vistas, visitantes };
  }

  // Pageviews de un filtro (para la atribución del newsletter por UTM).
  async function countViews(filter: string, since: string): Promise<number> {
    const res = await va('visits/count', {
      since, until,
      filter: `${filter} and environment eq 'production'`,
    });
    if (res.__nodata) return 0;
    return Number(res?.count ?? res?.total ?? res?.data?.count ?? 0);
  }

  const rows: any[] = [];
  const errors: string[] = [];
  const nowIso = new Date().toISOString();

  for (const [vkey, ms] of Object.entries(WINDOWS)) {
    const since = new Date(now - ms).toISOString();
    for (const [skey, sfilter] of Object.entries(SURFACES)) {
      try {
        const { vistas, visitantes } = await surfaceTotals(sfilter, since);
        let desde_newsletter = 0;
        if (skey === 'lexph') {
          try { desde_newsletter = await countViews(`${sfilter} and utmSource eq 'newsletter'`, since); }
          catch (e) { errors.push(`nl ${skey}/${vkey}: ${(e as Error).message}`); }
        }
        rows.push({
          superficie: skey, ventana: vkey,
          visitantes, vistas, desde_newsletter, actualizado_at: nowIso,
        });
      } catch (e) {
        errors.push(`${skey}/${vkey}: ${(e as Error).message}`);
      }
    }
  }

  if (rows.length) {
    const { error } = await admin
      .from('vercel_trafico')
      .upsert(rows, { onConflict: 'superficie,ventana' });
    if (error) errors.push(`upsert: ${error.message}`);
  }

  return json({ ok: errors.length === 0, actualizados: rows.length, rows, errors }, 200);
});
