// vercel-trafico-snapshot — DGG-245 / DGG-265 / DGG-266.
// Consulta Vercel Web Analytics (server-side, VERCEL_ANALYTICS_TOKEN) y persiste:
//   · public.vercel_trafico  → totales por superficie (landing / lexph) × ventana +
//     atribución desde_newsletter / desde_email (lo que leen las cards del Inicio).
//   · public.vercel_metricas → breakdown por dimensión (campaign/source/medium/path/
//     referrer/device/country) × ventana, para el reporte semanal integral y el panel
//     de analytics de gerencia (DGG-266: "traé toda la info adentro de la plataforma").
//
// Medición HONESTA (DGG-265 / E-GG-295): nunca se inventa un 0. 402 (dimensión UTM sin
// el add-on Web Analytics Plus) → sin_addon; error de API → error; en ambos casos NO se
// escribe un dato falso (vercel_trafico guarda NULL+estado; vercel_metricas no upserta
// esa dimensión y conserva el último valor bueno).
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
// DGG-271: la card "Landing" cubre el sitio de marketing = home + formularios (los mails de
// captación/federal caen en /formulario/*; Pablo: "los formularios desde el marketing"). LexPH
// es el newsletter. Cada superficie es una lista de filtros requestPath que se SUMAN (evita la
// sintaxis OR del filtro de Vercel, que el resto del código no usa).
const SURFACES: Record<string, string[]> = {
  landing: ["requestPath eq '/'", "startswith(requestPath, '/formulario')"],
  lexph: ["startswith(requestPath, '/lexph')"],
};
// Dimensión interna → campo de Vercel. Las utm* requieren Web Analytics Plus.
const DIMS: Record<string, string> = {
  campaign: 'utmCampaign',
  source: 'utmSource',
  medium: 'utmMedium',
  path: 'requestPath',
  referrer: 'referrerHostname',
  device: 'deviceType',
  country: 'country',
};

type Estado = 'ok' | 'sin_addon' | 'error';
type Bucket = { valor: string; visitantes: number; vistas: number };
type Breakdown = { estado: Estado; buckets: Bucket[] };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const token = Deno.env.get('VERCEL_ANALYTICS_TOKEN');
  if (!token) return json({ ok: false, error: 'Falta el secret VERCEL_ANALYTICS_TOKEN.' }, 500);

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const authToken = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  const { data: isCron } = await admin.rpc('is_cron_token', { p_token: authToken });
  if (!isCron) return json({ ok: false, error: 'No autorizado.' }, 401);

  const now = Date.now();
  const until = new Date(now).toISOString();
  const nowIso = new Date().toISOString();
  const errors: string[] = [];

  async function va(path: string, params: Record<string, string>): Promise<any> {
    const url = new URL(`${VA}/${path}`);
    url.searchParams.set('teamId', TEAM_ID);
    url.searchParams.set('projectId', PROJECT_ID);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const r = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
    if (r.status === 404) return { __nodata: true };      // WA prendido, sin filas → 0 real
    if (r.status === 402) return { __sinAddon: true };     // dimensión UTM sin el add-on
    const txt = await r.text();
    if (!r.ok) throw new Error(`Vercel ${r.status}: ${txt.slice(0, 220)}`);
    return txt ? JSON.parse(txt) : {};
  }

  const vis = (r: any) => Number(r?.visitors ?? r?.uniqueVisitors ?? r?.devices ?? 0);
  const views = (r: any) => Number(r?.pageviews ?? r?.count ?? r?.views ?? r?.total ?? 0);

  // Totales de una superficie: aggregate by environment (1 grupo prod).
  async function surfaceTotals(filter: string, since: string): Promise<{ vistas: number; visitantes: number }> {
    const res = await va('visits/aggregate', {
      by: 'environment', since, until,
      filter: `${filter} and environment eq 'production'`, limit: '5',
    });
    if (res.__sinAddon) throw new Error('402 en totales base (no debería: no usa UTM)'); // B1: no coercer 402→0
    if (res.__nodata) return { vistas: 0, visitantes: 0 };
    const arr: any[] = Array.isArray(res?.data) ? res.data : (res?.data ? [res.data] : []);
    let vistas = 0, visitantes = 0;
    for (const row of arr) { vistas += views(row); visitantes += vis(row); }
    if (!arr.length) { vistas = views(res); visitantes = vis(res); }
    return { vistas, visitantes };
  }

  // DGG-271: atribución UTM de UNA superficie (pedido de Pablo: "identificado debajo de cada
  // card, según corresponda" → landing ← desde el mail, lexph ← desde el newsletter). Cruza la
  // dimensión UTM con el filtro de requestPath de la superficie, en vez de medir global y duplicar.
  async function surfaceUtmPick(
    sfilter: string, dimField: string, wantValue: string, since: string, tag: string,
  ): Promise<{ value: number | null; estado: Estado }> {
    try {
      const res = await va('visits/aggregate', {
        by: dimField, since, until,
        filter: `${sfilter} and environment eq 'production'`, limit: '100',
      });
      if (res.__sinAddon) return { value: null, estado: 'sin_addon' };
      if (res.__nodata) return { value: 0, estado: 'ok' };
      const arr: any[] = Array.isArray(res?.data) ? res.data : [];
      if (arr.length > 0 && !arr.some((r) => r?.[dimField] !== undefined)) {
        errors.push(`${tag}: shape inesperado (sin campo ${dimField})`);
        return { value: null, estado: 'error' };
      }
      const hit = arr.find((r) => String(r?.[dimField] ?? '') === wantValue);
      return { value: hit ? vis(hit) : 0, estado: 'ok' };
    } catch (e) {
      errors.push(`${tag}: ${(e as Error).message}`);
      return { value: null, estado: 'error' };
    }
  }

  // Breakdown COMPLETO de una dimensión (todos los buckets). Honesto: sin_addon/error no
  // inventan datos. B3: si vienen filas pero ninguna trae el campo de la dimensión →
  // shape inesperado → error (no un 0 'ok'). Métrica de visitantes NO cae a pageviews.
  async function dimBreakdown(dimField: string, since: string, tag: string): Promise<Breakdown> {
    try {
      const res = await va('visits/aggregate', {
        by: dimField, since, until, filter: `environment eq 'production'`, limit: '100',
      });
      if (res.__sinAddon) return { estado: 'sin_addon', buckets: [] };
      if (res.__nodata) return { estado: 'ok', buckets: [] };
      const arr: any[] = Array.isArray(res?.data) ? res.data : [];
      if (arr.length > 0 && !arr.some((r) => r?.[dimField] !== undefined)) {
        errors.push(`${tag}: shape inesperado (sin campo ${dimField})`);
        return { estado: 'error', buckets: [] };
      }
      const buckets: Bucket[] = arr.map((r) => {
        const raw = String(r?.[dimField] ?? '').slice(0, 300);
        return { valor: raw === '' ? '(directo)' : raw, visitantes: vis(r), vistas: views(r) };
      });
      return { estado: 'ok', buckets };
    } catch (e) {
      errors.push(`${tag}: ${(e as Error).message}`);
      return { estado: 'error', buckets: [] };
    }
  }

  // 1) Breakdowns por dimensión × ventana (una sola pasada; de acá sale todo).
  const bd: Record<string, Record<string, Breakdown>> = {};
  for (const [dim, field] of Object.entries(DIMS)) {
    bd[dim] = {};
    for (const [vkey, ms] of Object.entries(WINDOWS)) {
      const since = new Date(now - ms).toISOString();
      bd[dim][vkey] = await dimBreakdown(field, since, `${dim}/${vkey}`);
    }
  }

  // 2) vercel_metricas: upsert de todos los buckets medidos (estado 'ok').
  const metricRows: any[] = [];
  const refreshed: Array<[string, string]> = []; // [dimension, ventana] efectivamente medidas
  for (const [dim, perV] of Object.entries(bd)) {
    for (const [vkey, b] of Object.entries(perV)) {
      if (b.estado !== 'ok') continue; // no escribir datos falsos; conserva lo último bueno
      refreshed.push([dim, vkey]);
      for (const bk of b.buckets) {
        if (bk.visitantes <= 0 && bk.vistas <= 0) continue;
        metricRows.push({ dimension: dim, valor: bk.valor, ventana: vkey, visitantes: bk.visitantes, vistas: bk.vistas, actualizado_at: nowIso });
      }
    }
  }
  if (metricRows.length) {
    const { error } = await admin.from('vercel_metricas').upsert(metricRows, { onConflict: 'dimension,valor,ventana' });
    if (error) errors.push(`upsert metricas: ${error.message}`);
  }
  // Limpieza de buckets viejos que ya no aparecen (ventana rodante), sólo para las dim×ventana
  // que SÍ se midieron bien en esta corrida (no tocar las que fallaron → se conserva lo último).
  for (const [dim, vkey] of refreshed) {
    const { error } = await admin.from('vercel_metricas')
      .delete().eq('dimension', dim).eq('ventana', vkey).lt('actualizado_at', nowIso);
    if (error) errors.push(`clean ${dim}/${vkey}: ${error.message}`);
  }

  // 3) vercel_trafico: totales + atribución POR SUPERFICIE (DGG-271). Antes la atribución
  //    se medía global y se duplicaba en landing y lexph (misma cifra en ambas); ahora cada
  //    superficie trae su propia desde_email / desde_newsletter cruzando el UTM con su requestPath.
  // Suma picks de varios filtros (home + formularios para landing). Si alguno es sin_addon/error,
  // esa superficie queda sin_addon/error (no se inventa un parcial).
  const sumPicks = (parts: { value: number | null; estado: Estado }[]): { value: number | null; estado: Estado } => {
    if (parts.some((p) => p.estado === 'error')) return { value: null, estado: 'error' };
    if (parts.some((p) => p.estado === 'sin_addon')) return { value: null, estado: 'sin_addon' };
    return { value: parts.reduce((a, p) => a + (p.value ?? 0), 0), estado: 'ok' };
  };
  const rows: any[] = [];
  for (const vkey of Object.keys(WINDOWS)) {
    const since = new Date(now - WINDOWS[vkey]).toISOString();
    for (const [skey, filters] of Object.entries(SURFACES)) {
      try {
        let vistas = 0, visitantes = 0;
        const emailParts: { value: number | null; estado: Estado }[] = [];
        const nlParts: { value: number | null; estado: Estado }[] = [];
        for (const f of filters) {
          const t = await surfaceTotals(f, since);
          vistas += t.vistas; visitantes += t.visitantes;
          emailParts.push(await surfaceUtmPick(f, 'utmMedium', 'email', since, `${skey}/${vkey} email`));
          nlParts.push(await surfaceUtmPick(f, 'utmSource', 'newsletter', since, `${skey}/${vkey} newsletter`));
        }
        const aEm = sumPicks(emailParts);
        const aNl = sumPicks(nlParts);
        const estado: Estado =
          aNl.estado === 'ok' && aEm.estado === 'ok' ? 'ok'
            : aNl.estado === 'sin_addon' || aEm.estado === 'sin_addon' ? 'sin_addon' : 'error';
        rows.push({
          superficie: skey, ventana: vkey, visitantes, vistas,
          desde_newsletter: aNl.value, desde_email: aEm.value,
          medicion_estado: estado, actualizado_at: nowIso,
        });
      } catch (e) {
        // No upsertamos la fila: se conserva la anterior (last-good); su actualizado_at
        // viejo es la señal honesta de staleness (el widget muestra "actualizado hace X").
        errors.push(`${skey}/${vkey}: ${(e as Error).message}`);
      }
    }
  }
  if (rows.length) {
    const { error } = await admin.from('vercel_trafico').upsert(rows, { onConflict: 'superficie,ventana' });
    if (error) errors.push(`upsert trafico: ${error.message}`);
  }

  return json({ ok: errors.length === 0, trafico: rows.length, metricas: metricRows.length, errors }, 200);
});
