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
    // DGG-265 / E-GG-295 — distinguir, NO mentir con un 0:
    //  · 404 = Web Analytics prendido pero sin filas para ese filtro/ventana → cero REAL.
    //  · 402 = la dimensión UTM requiere el add-on "Web Analytics Plus"; si falta o se
    //    cayó, NO sabemos el valor → sin_addon (se guarda NULL, nunca 0).
    //  · cualquier otro no-ok (401/403/5xx) → throw → el caller lo marca 'error' (NULL).
    if (r.status === 404) return { __nodata: true };
    if (r.status === 402) return { __sinAddon: true };
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

  // Atribución por dimensión UTM, con ESTADO honesto (DGG-265 / E-GG-295):
  //  · {value:N, estado:'ok'}      → medido (N real; 0 es un cero genuino).
  //  · {value:null, estado:'sin_addon'} → 402: dimensión UTM sin Web Analytics Plus.
  //  · {value:null, estado:'error'}     → otra falla de la API.
  // IMPORTANTE (E-GG-295b): se usa visits/aggregate agrupando por la dimensión (dimField)
  // y se lee el bucket wantValue — EXACTAMENTE lo que hace el dashboard de Vercel. El
  // endpoint visits/count con un filtro `utmSource eq ...` devuelve 0 (no soporta el corte
  // por UTM), aunque el dashboard sí lo muestre. Nunca devuelve 0 cuando no se pudo medir.
  // Cuenta VISITANTES del bucket (coincide con la columna VISITORS del dashboard, que es
  // lo que Pablo cruza). Shape verificado: {visitors, pageviews, <dimField>:'<valor>'}.
  type Attr = { value: number | null; estado: 'ok' | 'sin_addon' | 'error' };
  async function attrDim(dimField: string, wantValue: string, since: string, tag: string): Promise<Attr> {
    try {
      const res = await va('visits/aggregate', {
        by: dimField, since, until,
        filter: `environment eq 'production'`,
        limit: '100',
      });
      if (res.__sinAddon) return { value: null, estado: 'sin_addon' };
      if (res.__nodata) return { value: 0, estado: 'ok' };
      const arr: any[] = Array.isArray(res?.data) ? res.data : [];
      let total = 0;
      for (const r of arr) {
        const dv = String(r?.[dimField] ?? r?.key ?? r?.value ?? r?.name ?? r?.group ?? '');
        if (dv === wantValue) {
          total += Number(r?.visitors ?? r?.uniqueVisitors ?? r?.count ?? r?.pageviews ?? r?.total ?? 0);
        }
      }
      return { value: total, estado: 'ok' };
    } catch (e) {
      errors.push(`${tag}: ${(e as Error).message}`);
      return { value: null, estado: 'error' };
    }
  }

  const rows: any[] = [];
  const errors: string[] = [];
  const nowIso = new Date().toISOString();

  for (const [vkey, ms] of Object.entries(WINDOWS)) {
    const since = new Date(now - ms).toISOString();
    // Atribución UTM a NIVEL PROYECTO (no por requestPath) — E-GG-295b. Vercel atribuye
    // el UTM a la VISITA, no a cada pageview: combinar utmSource con startswith(requestPath,
    // '/lexph') devuelve 0 aunque el dashboard muestre datos (verificado en vivo: el panel
    // UTM da newsletter>0 pero el count con filtro de ruta daba 0). El newsletter sólo
    // linkea a /lexph y la captación a la landing, así que el corte por source/medium YA
    // identifica la campaña sin el filtro de ruta. Se calcula UNA vez por ventana y se
    // guarda igual en ambas superficies (es un total de proyecto, no por superficie).
    const aNl = await attrDim('utmSource', 'newsletter', since, `nl ${vkey}`);
    const aEm = await attrDim('utmMedium', 'email', since, `em ${vkey}`);
    const estado: 'ok' | 'sin_addon' | 'error' =
      aNl.estado === 'ok' && aEm.estado === 'ok' ? 'ok'
        : aNl.estado === 'sin_addon' || aEm.estado === 'sin_addon' ? 'sin_addon' : 'error';
    for (const [skey, sfilter] of Object.entries(SURFACES)) {
      try {
        const { vistas, visitantes } = await surfaceTotals(sfilter, since);
        rows.push({
          superficie: skey, ventana: vkey,
          visitantes, vistas,
          desde_newsletter: aNl.value, // NULL si no medible (no 0 falso) · total proyecto
          desde_email: aEm.value,
          medicion_estado: estado,
          actualizado_at: nowIso,
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
