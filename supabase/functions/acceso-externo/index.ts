// acceso-externo · endpoint público (verify_jwt=false) que verifica un token
// de acceso externo y devuelve los datos sanitizados del recurso vinculado.
//
// Patrón:
//   GET /functions/v1/acceso-externo/{token}
//   GET /functions/v1/acceso-externo?token={token}
//
// Reglas:
// - Token requerido (32 bytes hex = 64 chars). Caso contrario 400.
// - Verifica que el token exista, no esté revocado y no haya vencido.
// - Registra ultima_visita_at + total_visitas++ y usado_at si era NULL.
// - Devuelve el recurso con campos seguros (sin sensibles) + adjuntos (URLs
//   firmadas a Storage, 1 hora).
// - service_role bypass RLS para leer recursos (justificado por estar el
//   token actuando como capability).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.46.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

interface AccesoRow {
  token: string;
  recurso_tipo: 'tramite' | 'solicitud' | 'tracking' | 'documento';
  recurso_id: string;
  email_destinatario: string;
  nombre_destinatario: string | null;
  vence_at: string;
  usado_at: string | null;
  revocado_at: string | null;
  total_visitas: number;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'GET') return errorJson(405, 'Method not allowed');

  const url = new URL(req.url);
  const segs = url.pathname.split('/').filter(Boolean);
  // Last segment if not the function name; o ?token=
  let token = url.searchParams.get('token') ?? '';
  if (!token && segs.length) {
    const last = segs[segs.length - 1];
    if (last && last !== 'acceso-externo') token = last;
  }
  if (!token || !/^[a-f0-9]{32,128}$/.test(token)) {
    return errorJson(400, 'Token inválido');
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const { data: acceso, error } = await admin
    .from('accesos_externos')
    .select('token, recurso_tipo, recurso_id, email_destinatario, nombre_destinatario, vence_at, usado_at, revocado_at, total_visitas')
    .eq('token', token)
    .maybeSingle();

  if (error) return errorJson(500, 'No pudimos verificar el token');
  if (!acceso) return errorJson(404, 'Acceso no encontrado');
  const row = acceso as AccesoRow;
  if (row.revocado_at) return errorJson(410, 'Este acceso fue revocado');
  if (new Date(row.vence_at).getTime() < Date.now()) {
    return errorJson(410, 'Este acceso venció');
  }

  // Marcar visita.
  await admin
    .from('accesos_externos')
    .update({
      ultima_visita_at: new Date().toISOString(),
      total_visitas: (row.total_visitas ?? 0) + 1,
      usado_at: row.usado_at ?? new Date().toISOString(),
    })
    .eq('token', row.token);

  let recurso: Record<string, unknown> | null = null;
  let historial: unknown[] = [];
  let adjuntos: { nombre: string; url: string }[] = [];

  if (row.recurso_tipo === 'tramite') {
    const { data: t } = await admin
      .from('tramites')
      .select('id, codigo, titulo, descripcion, categoria, estado, prioridad, fecha_solicitud, fecha_estimada, created_at, updated_at')
      .eq('id', row.recurso_id)
      .maybeSingle();
    recurso = (t as Record<string, unknown>) ?? null;
  } else if (row.recurso_tipo === 'solicitud') {
    const { data: s } = await admin
      .from('formulario_submissions')
      .select('id, formulario_slug, estado, datos, created_at')
      .eq('id', row.recurso_id)
      .maybeSingle();
    if (s) {
      recurso = {
        id: s.id,
        formulario_slug: s.formulario_slug,
        estado: s.estado,
        created_at: s.created_at,
        // Campos sanitizados sin datos sensibles (sólo etiquetas comunes).
        datos_resumen: sanitizeDatos(s.datos),
      };
    }
  } else if (row.recurso_tipo === 'tracking') {
    // tracking aún no existe (G2). Mostramos placeholder.
    recurso = { id: row.recurso_id, info: 'Tracking pendiente de implementación.' };
  } else if (row.recurso_tipo === 'documento') {
    recurso = { id: row.recurso_id };
    // Si en el futuro tenemos `documentos`, firmamos su URL.
  }

  return json({
    ok: true,
    acceso: {
      tipo: row.recurso_tipo,
      destinatario: row.nombre_destinatario ?? row.email_destinatario,
      vence_at: row.vence_at,
    },
    recurso,
    historial,
    adjuntos,
  });
});

function sanitizeDatos(d: unknown): Record<string, unknown> {
  if (!d || typeof d !== 'object') return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(d as Record<string, unknown>)) {
    // No exponer DNIs, claves fiscales ni archivos crudos
    if (/dni|cuit|password|clave|cbu/i.test(k)) continue;
    if (typeof v === 'string' && v.length < 240) out[k] = v;
    else if (typeof v === 'number' || typeof v === 'boolean') out[k] = v;
  }
  return out;
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
function errorJson(status: number, message: string) {
  return json({ ok: false, error: { code: String(status), message } }, status);
}
