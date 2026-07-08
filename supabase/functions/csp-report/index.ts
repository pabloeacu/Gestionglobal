// csp-report v1 (E-GG-88 Etapa 2): recibe las violaciones de la
// Content-Security-Policy que reportan los browsers (modo report-only) y las
// acumula en public.csp_reports vía la RPC csp_report_registrar (service_role).
// Sirve para MEDIR qué rompería una CSP bloqueante antes de activarla (Etapa 3).
//
// Acepta los DOS formatos de reporte:
//   * report-uri  → Content-Type application/csp-report  → { "csp-report": {...} }
//   * report-to   → Content-Type application/reports+json → [ { type, body }, ... ]
//
// verify_jwt = false: los browsers postean sin credenciales. La escritura pasa
// por una RPC SECURITY DEFINER concedida sólo a service_role; el dedup + LEFT()
// acotan la tabla. Responde 204 siempre (nunca debe afectar la navegación).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.46.1';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const noContent = () => new Response(null, { status: 204, headers: cors });

function stripQuery(u: string): string {
  return (u || '').split('?')[0].split('#')[0];
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return new Response(null, { status: 405, headers: cors });

  let payload: unknown;
  try { payload = await req.json(); } catch { return noContent(); }

  // Normalizar ambos formatos a una lista de "cuerpos de violación".
  const bodies: Record<string, unknown>[] = [];
  if (Array.isArray(payload)) {
    for (const r of payload) {
      const rr = r as { type?: string; body?: Record<string, unknown> };
      if (rr?.body && (rr.type === 'csp-violation' || rr.type === undefined)) bodies.push(rr.body);
    }
  } else if (payload && typeof payload === 'object') {
    const p = payload as Record<string, unknown>;
    if (p['csp-report']) bodies.push(p['csp-report'] as Record<string, unknown>);
    else if (p['violated-directive'] || p['effectiveDirective']) bodies.push(p);
  }
  if (bodies.length === 0) return noContent();

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const pick = (r: Record<string, unknown>, ...keys: string[]): string => {
    for (const k of keys) { const v = r[k]; if (typeof v === 'string' && v) return v; }
    return '';
  };
  const num = (r: Record<string, unknown>, ...keys: string[]): number | null => {
    for (const k of keys) { const v = r[k]; if (typeof v === 'number') return v; }
    return null;
  };

  for (const b of bodies.slice(0, 20)) {
    const violated = pick(b, 'violated-directive', 'violatedDirective', 'effective-directive', 'effectiveDirective');
    if (!violated) continue;
    await supabase.rpc('csp_report_registrar', {
      p_violated: violated,
      p_effective: pick(b, 'effective-directive', 'effectiveDirective'),
      p_blocked: stripQuery(pick(b, 'blocked-uri', 'blockedURL', 'blockedURI')),
      p_document: stripQuery(pick(b, 'document-uri', 'documentURL', 'documentURI')),
      p_source: stripQuery(pick(b, 'source-file', 'sourceFile')),
      p_line: num(b, 'line-number', 'lineNumber'),
      p_status: num(b, 'status-code', 'statusCode'),
      p_disposition: pick(b, 'disposition') || 'report',
      p_sample: b,
    });
  }

  return noContent();
});
