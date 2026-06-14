// supabase/functions/zoom-encuentro-create/index.ts
// Crea una reunión Zoom (cuenta propia, S2S OAuth) para un encuentro sincrónico
// del Campus y persiste la metadata vía RPC SD curso_encuentro_set_zoom.
//
// F9 (Lista JL · 2026-06-08): reemplaza a `zoom-meeting-create`. Esa función
// crasheaba en el COLD-START del edge runtime actual (su handler de OPTIONS
// devolvía 500 sin headers CORS → el browser reportaba "Failed to send request /
// CORS faltante" → "no genera sala"). Tras descartar versión de supabase-js, el
// import `jsr:`, el shared-import, `verify_jwt` y el slot/id, una probe mínima
// con el mismo import booteaba pero la función completa NO → el bundle de
// `@supabase/supabase-js` instanciado era el que reventaba el boot. Solución:
// reescribir SIN supabase-js, usando fetch crudo a la REST/Auth/RPC de Supabase.
// Verificado en vivo: crea reunión Zoom real + persiste (meeting_id devuelto).
//
// Hardening §6 (E-GG-57 / DGG-57): TODO el cuerpo va dentro de un try/catch global que
// devuelve un 500 CON headers CORS. Sin esto, un fallo de red interno o un
// `.json()` sobre una respuesta no-JSON escaparía del handler → 500 sin CORS,
// que es exactamente la clase de bug que originó F9.
//
// Auth: requiere staff (gerente). El RPC SD re-valida igualmente.

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

    // 1) validar token de usuario (Auth REST)
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

    // 3) body + encuentro
    let body: any;
    try { body = await req.json(); } catch { return json(400, { error: "json" }); }
    const encuentroId = body?.encuentro_id as string;
    // UUID canónico 8-4-4-4-12 (regla §6: no aceptar basura hex de 36 chars)
    if (!encuentroId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(encuentroId)) {
      return json(400, { error: "encuentro_id" });
    }
    const hostEmail: string = body?.host_email ?? "me";
    const duracionMin: number = Number(body?.duracion_min ?? 60);

    const encArr = await (await rest(`curso_encuentros?id=eq.${encuentroId}&select=id,titulo,fecha_hora,curso_id,zoom_meeting_id,condicion_id`)).json();
    const enc = encArr?.[0];
    if (!enc) return json(404, { error: "encuentro_not_found" });
    if (enc.zoom_meeting_id) return json(409, { error: "meeting_already_created", meeting_id: enc.zoom_meeting_id });

    let cursoTitulo = "Campus";
    if (enc.curso_id) {
      const cArr = await (await rest(`cursos?id=eq.${enc.curso_id}&select=titulo`)).json();
      cursoTitulo = cArr?.[0]?.titulo ?? "Campus";
    }
    // Prefijo del MÓDULO sincrónico al que pertenece el encuentro
    // (curso_condiciones_config.etiqueta, p.ej. "Asambleas Virtuales"). Pablo
    // (DGG-83, 2026-06-14) lo pidió al frente del topic para distinguir de un
    // vistazo a qué módulo corresponde la sala en el portal Zoom. Si el encuentro
    // no tiene módulo (condicion_id NULL) NO se antepone nada (igual que antes).
    // El prefijo del módulo es PURAMENTE cosmético → nunca debe bloquear la
    // creación de la sala. Si el fetch falla (red / .json()), degradamos a
    // topic-sin-prefijo en vez de abortar (auditoría §6 DGG-83).
    let moduloEtiqueta = "";
    if (enc.condicion_id) {
      try {
        const modArr = await (await rest(`curso_condiciones_config?id=eq.${enc.condicion_id}&select=etiqueta`)).json();
        moduloEtiqueta = String(modArr?.[0]?.etiqueta ?? "").trim();
      } catch (_) { moduloEtiqueta = ""; }
    }
    // Topic con el ENCUENTRO primero: en la lista del portal Zoom el texto se
    // trunca al inicio, y dos encuentros del mismo curso se veían idénticos
    // ("Curso… · "). Con el encuentro adelante el host distingue cuál iniciar
    // (F9-bis · Lista JL · Pablo 2026-06-08). Con el módulo adelante:
    // "<módulo>: <encuentro> · <curso>" (DGG-83 · Pablo 2026-06-14).
    const topicBase = `${enc.titulo} · ${cursoTitulo}`;
    let topic = body?.topic ?? (moduloEtiqueta ? `${moduloEtiqueta}: ${topicBase}` : topicBase);
    // Zoom rechaza topics > 200 chars (code 300 "Validation Failed") → truncamos
    // defensivamente preservando el inicio (módulo + encuentro) (auditoría §6 DGG-83).
    if (topic.length > 200) topic = topic.slice(0, 197) + "…";
    const startTime = enc.fecha_hora ?? new Date().toISOString();

    // 4) token Zoom (S2S OAuth)
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

    // 5) crear reunión
    const target = hostEmail === "me" ? "me" : encodeURIComponent(hostEmail);
    const mr = await fetch(`https://api.zoom.us/v2/users/${target}/meetings`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        topic, type: 2, start_time: startTime, duration: duracionMin,
        timezone: "America/Argentina/Buenos_Aires",
        settings: {
          host_video: true, participant_video: true, join_before_host: false,
          waiting_room: true, mute_upon_entry: true, auto_recording: "cloud",
          meeting_authentication: false, approval_type: 2,
        },
      }),
    });
    if (!mr.ok) { const detail = await mr.text(); return json(502, { error: "zoom_create_failed", status: mr.status, detail }); }
    const mtg = await mr.json();

    // 6) persistir vía RPC SD (REST)
    const rpcRes = await rest(`rpc/curso_encuentro_set_zoom`, {
      method: "POST",
      body: JSON.stringify({
        p_encuentro_id: encuentroId, p_meeting_id: Number(mtg.id),
        p_join_url: mtg.join_url ?? null, p_start_url: mtg.start_url ?? null,
        p_password: mtg.password ?? null, p_duracion_min: duracionMin,
      }),
    });
    if (!rpcRes.ok) {
      const d = await rpcRes.text();
      console.error("zoom-encuentro-create set_zoom falló", d);
      return json(500, { error: "La reunión Zoom se creó pero no pudimos guardarla en el curso. Avisá a un gerente." });
    }

    return json(200, {
      ok: true, meeting_id: mtg.id, join_url: mtg.join_url,
      start_url: mtg.start_url, password: mtg.password, topic,
    });
  } catch (e) {
    // Garantiza 500 CON CORS ante cualquier fallo no previsto (red, .json(), etc.)
    console.error("zoom-encuentro-create unhandled", String(e));
    return json(500, { error: "No pudimos crear la sala Zoom en este momento. Probá de nuevo en unos minutos." });
  }
});
