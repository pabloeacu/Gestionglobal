// webinar-acceso · endpoint público (verify_jwt=false) que verifica un token
// de inscripción a webinar y devuelve los datos necesarios para la página
// pública /webinar/:token.
//
// Patrón:
//   GET /functions/v1/webinar-acceso/{token}
//   GET /functions/v1/webinar-acceso?token={token}
//
// Reglas:
// - Token = 64 chars hex (gen_random_bytes(32)). Caso contrario 400.
// - Verifica que exista, no esté revocado, no haya vencido.
// - Registra ultima_visita_at + total_visitas++ y primera_visita_at si era NULL.
// - Devuelve: webinar (datos públicos), inscripto (nombre/canal asignado),
//   join_url específico del canal (zoom_join_url O youtube_live_url), status,
//   y countdown.
// - service_role bypass RLS para leer recursos (token actúa como capability).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.46.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

interface TokenRow {
  token: string;
  webinar_inscripto_id: string;
  vence_at: string;
  primera_visita_at: string | null;
  total_visitas: number;
  revocado_at: string | null;
}

interface InscriptoRow {
  id: string;
  webinar_id: string;
  email_snapshot: string;
  nombre_snapshot: string;
  canal: 'zoom' | 'youtube' | 'presencial';
  administracion_id: string | null;
  prospecto_id: string | null;
  asistio: boolean;
  tiempo_conectado_seg: number;
}

interface WebinarRow {
  id: string;
  titulo: string;
  descripcion: string | null;
  fecha_hora: string;
  duracion_min: number;
  status: 'programado' | 'en_curso' | 'finalizado' | 'cancelado';
  plataforma: 'zoom' | 'webex';
  modalidad: 'online' | 'presencial' | 'mixto';
  tipo: string | null;
  ubicacion_lugar: string | null;
  ubicacion_direccion: string | null;
  ubicacion_localidad: string | null;
  ubicacion_mapa_url: string | null;
  ubicacion_instrucciones: string | null;
  zoom_join_url: string | null;
  zoom_password: string | null;
  zoom_meeting_number: string | null;
  youtube_live_url: string | null;
  grabacion_url: string | null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'GET') return errorJson(405, 'Method not allowed');

  const url = new URL(req.url);
  const segs = url.pathname.split('/').filter(Boolean);
  let token = url.searchParams.get('token') ?? '';
  if (!token && segs.length) {
    const last = segs[segs.length - 1];
    if (last && last !== 'webinar-acceso') token = last;
  }
  if (!token || !/^[a-f0-9]{32,128}$/.test(token)) {
    return errorJson(400, 'Token inválido');
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // 1) Verificar token
  const { data: tokenRow, error: tokenErr } = await admin
    .from('webinar_acceso_tokens')
    .select('token, webinar_inscripto_id, vence_at, primera_visita_at, total_visitas, revocado_at')
    .eq('token', token)
    .maybeSingle();
  if (tokenErr) return errorJson(500, 'Error verificando token');
  if (!tokenRow) return errorJson(404, 'Acceso no encontrado');
  const t = tokenRow as TokenRow;
  if (t.revocado_at) return errorJson(410, 'Acceso revocado');
  if (new Date(t.vence_at).getTime() < Date.now()) return errorJson(410, 'Acceso vencido');

  // 2) Marcar visita (idempotente por update)
  const nowIso = new Date().toISOString();
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
  const userAgent = req.headers.get('user-agent') ?? null;
  await admin
    .from('webinar_acceso_tokens')
    .update({
      ultima_visita_at: nowIso,
      total_visitas: (t.total_visitas ?? 0) + 1,
      primera_visita_at: t.primera_visita_at ?? nowIso,
      ip_ultima: ip,
      user_agent_ultima: userAgent,
    })
    .eq('token', t.token);

  // 3) Cargar inscripto + webinar
  const { data: inscriptoRow, error: insErr } = await admin
    .from('webinar_inscriptos')
    .select('id, webinar_id, email_snapshot, nombre_snapshot, canal, administracion_id, prospecto_id, asistio, tiempo_conectado_seg')
    .eq('id', t.webinar_inscripto_id)
    .maybeSingle();
  if (insErr || !inscriptoRow) return errorJson(404, 'Inscripto no encontrado');
  const ins = inscriptoRow as InscriptoRow;

  const { data: webinarRow, error: webErr } = await admin
    .from('webinars')
    .select('id, titulo, descripcion, fecha_hora, duracion_min, status, plataforma, modalidad, tipo, ubicacion_lugar, ubicacion_direccion, ubicacion_localidad, ubicacion_mapa_url, ubicacion_instrucciones, zoom_join_url, zoom_password, zoom_meeting_number, youtube_live_url, grabacion_url')
    .eq('id', ins.webinar_id)
    .maybeSingle();
  if (webErr || !webinarRow) return errorJson(404, 'Webinar no encontrado');
  const w = webinarRow as WebinarRow;

  // 4) Resolver join_url según canal asignado (presencial no tiene link online)
  const joinUrl = ins.canal === 'zoom'
    ? w.zoom_join_url
    : ins.canal === 'youtube'
      ? w.youtube_live_url
      : null;

  // 5) Calcular ventana del evento (countdown desde cliente)
  const startMs = new Date(w.fecha_hora).getTime();
  const endMs = startMs + w.duracion_min * 60_000;
  const inWindow = Date.now() >= startMs && Date.now() <= endMs;
  const isFuture = Date.now() < startMs;
  const isPast = Date.now() > endMs;

  return json({
    ok: true,
    inscripto: {
      id: ins.id,
      nombre: ins.nombre_snapshot,
      email: ins.email_snapshot,
      canal: ins.canal,
      es_prospecto: ins.prospecto_id !== null,
      es_cliente: ins.administracion_id !== null,
      asistio: ins.asistio,
      tiempo_conectado_seg: ins.tiempo_conectado_seg,
    },
    webinar: {
      id: w.id,
      titulo: w.titulo,
      descripcion: w.descripcion,
      fecha_hora: w.fecha_hora,
      duracion_min: w.duracion_min,
      status: w.status,
      plataforma: w.plataforma,
      modalidad: w.modalidad,
      tipo: w.tipo,
      ubicacion_lugar: w.ubicacion_lugar,
      ubicacion_direccion: w.ubicacion_direccion,
      ubicacion_localidad: w.ubicacion_localidad,
      ubicacion_mapa_url: w.ubicacion_mapa_url,
      ubicacion_instrucciones: w.ubicacion_instrucciones,
      grabacion_url: w.grabacion_url,
    },
    acceso: {
      canal: ins.canal,
      join_url: joinUrl,
      zoom_password: ins.canal === 'zoom' ? w.zoom_password : null,
      zoom_meeting_number: ins.canal === 'zoom' ? w.zoom_meeting_number : null,
      in_window: inWindow,
      is_future: isFuture,
      is_past: isPast,
      vence_at: t.vence_at,
    },
  });
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
function errorJson(status: number, message: string) {
  return json({ ok: false, error: { code: String(status), message } }, status);
}
