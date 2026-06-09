// supabase/functions/zoom-encuentro-delete/index.ts
// Borra una reunión Zoom (cuenta propia, S2S OAuth) y limpia la metadata del
// encuentro. Contrapartida de zoom-encuentro-create (F9-bis · Lista JL).
//
// Por qué existe (Pablo 2026-06-08): `borrarEncuentro` sólo borraba la fila de
// `curso_encuentros` y dejaba la reunión HUÉRFANA en la cuenta Zoom para siempre
// → con el tiempo la cuenta se llena de salas fantasma y el host se confunde.
// Esta fn permite: (a) al borrar un encuentro, borrar también su reunión Zoom;
// (b) "Regenerar sala" (borrar la actual para volver a crear); (c) limpieza de
// huérfanos por meeting_id.
//
// Sin `@supabase/supabase-js` (DGG-57: su bundle crashea el cold-start). Raw
// fetch a Auth/REST de Supabase + try/catch global CORS-safe.
//
// Modos:
//   { encuentro_id }  → busca su zoom_meeting_id, borra la reunión y limpia la fila.
//   { meeting_id }    → borra esa reunión directo (limpieza de huérfanos, admin).
//
// Idempotente: si Zoom devuelve 404 (la reunión ya no existe), se trata como OK.
// Auth: requiere staff (gerente).

Deno.serve(async (req) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers });

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return json(405, { error: "method" });

  try {
    const ACCOUNT_ID    = Deno.env.get("ZOOM_ACCOUNT_ID") ?? "";
    const CLIENT_ID     = Deno.env.get("ZOOM_S2S_CLIENT_ID") ?? "";
    const CLIENT_SECRET = Deno.env.get("ZOOM_S2S_CLIENT_SECRET") ?? "";
    const SUPABASE_URL  = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/$/, "");
    const SERVICE_ROLE  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const ANON_KEY      = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

    if (!CLIENT_ID || !CLIENT_SECRET || !ACCOUNT_ID) return json(500, { error: "zoom_s2s_not_configured" });

    const auth = req.headers.get("Authorization") ?? "";
    if (!auth.startsWith("Bearer ")) return json(401, { error: "no_auth" });

    // 1) validar token de usuario
    const ures = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { Authorization: auth, apikey: ANON_KEY } });
    if (!ures.ok) return json(401, { error: "invalid_auth" });
    const user = await ures.json();
    const userId = user?.id as string | undefined;
    if (!userId) return json(401, { error: "invalid_auth" });

    const svc = { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}`, "Content-Type": "application/json" };
    const rest = (path: string, init: RequestInit = {}) =>
      fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...init, headers: { ...svc, ...(init.headers ?? {}) } });

    // 2) rol gerente
    const profArr = await (await rest(`profiles?id=eq.${userId}&select=role`)).json();
    if (profArr?.[0]?.role !== "gerente") return json(403, { error: "only_staff" });

    // 3) resolver meeting_id (por encuentro o directo)
    let body: any;
    try { body = await req.json(); } catch { return json(400, { error: "json" }); }
    const encuentroId = body?.encuentro_id as string | undefined;
    let meetingId: number | null = null;

    if (encuentroId) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(encuentroId)) {
        return json(400, { error: "encuentro_id" });
      }
      const encArr = await (await rest(`curso_encuentros?id=eq.${encuentroId}&select=zoom_meeting_id`)).json();
      const enc = encArr?.[0];
      if (!enc) return json(404, { error: "encuentro_not_found" });
      meetingId = enc.zoom_meeting_id ? Number(enc.zoom_meeting_id) : null;
      if (!meetingId) {
        // No tenía sala: nada que borrar en Zoom, pero garantizamos fila limpia.
        await rest(`curso_encuentros?id=eq.${encuentroId}`, {
          method: "PATCH",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify({ zoom_meeting_id: null, zoom_join_url: null, zoom_start_url: null, zoom_password: null, zoom_status: "programado" }),
        });
        return json(200, { ok: true, already_clear: true });
      }
    } else if (body?.meeting_id != null && /^[0-9]+$/.test(String(body.meeting_id))) {
      meetingId = Number(body.meeting_id);
    } else {
      return json(400, { error: "encuentro_id_or_meeting_id" });
    }

    // 4) token Zoom S2S
    let token: string;
    try {
      const basic = btoa(`${CLIENT_ID}:${CLIENT_SECRET}`);
      const tr = await fetch(
        `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${ACCOUNT_ID}`,
        { method: "POST", headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" } },
      );
      if (!tr.ok) throw new Error(`zoom_oauth_${tr.status}: ${await tr.text()}`);
      token = (await tr.json()).access_token as string;
    } catch (e) { return json(502, { error: "zoom_oauth", detail: String(e) }); }

    // 5) borrar reunión (404 = ya no existe → idempotente OK)
    const dr = await fetch(`https://api.zoom.us/v2/meetings/${meetingId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!dr.ok && dr.status !== 404) {
      const detail = await dr.text();
      console.error("zoom-encuentro-delete DELETE failed", "status=" + dr.status, "detail=" + detail);
      // Zoom code 4711 = la app S2S no tiene el scope `meeting:delete:meeting:admin`
      // (config del Marketplace de Zoom — sólo un gerente puede agregarlo).
      const missingScope = /does not contain scopes|meeting:delete|"?code"?\s*:?\s*4711/i.test(detail);
      return json(502, {
        error: missingScope
          ? "Zoom no permite borrar la reunión: falta activar el permiso «meeting:delete:meeting:admin» en la app de Zoom (Marketplace) y reactivarla."
          : "No pudimos borrar la reunión en Zoom en este momento.",
        missing_scope: missingScope,
        status: dr.status,
        detail,
      });
    }

    // 6) limpiar la fila del encuentro (si vino por encuentro_id)
    if (encuentroId) {
      const pr = await rest(`curso_encuentros?id=eq.${encuentroId}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ zoom_meeting_id: null, zoom_join_url: null, zoom_start_url: null, zoom_password: null, zoom_status: "programado" }),
      });
      if (!pr.ok) {
        const d = await pr.text();
        console.error("zoom-encuentro-delete clear falló", d);
        return json(500, { error: "Borramos la reunión en Zoom pero no pudimos limpiar el encuentro. Avisá a un gerente." });
      }
    }

    return json(200, { ok: true, deleted_meeting_id: meetingId, zoom_status: dr.status });
  } catch (e) {
    console.error("zoom-encuentro-delete unhandled", String(e));
    return json(500, { error: "No pudimos borrar la sala Zoom en este momento. Probá de nuevo en unos minutos." });
  }
});
