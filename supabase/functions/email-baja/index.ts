import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// ============================================================================
// email-baja · Baja one-click (opt-out). Público (verify_jwt=false).
//   PROSPECTO (DGG-220 F2): ?p=<prospecto_id>&t=<token>  → prospecto_baja
//   CLIENTE   (DGG-224 F2): ?a=<admin_id>&t=<token>      → administracion_baja
//
//   GET  → VALIDA el token (sin mutar) y muestra una página con botón
//          "Confirmar baja" que hace POST. Así los escáneres de links
//          (SafeLinks/proxies que prefetchean con GET) NO dan de baja.
//   POST → PROCESA la baja. Sirve al botón humano y a List-Unsubscribe-Post
//          one-click (RFC 8058); devuelve 200 siempre.
// Token inválido → página/mensaje genérico (sin enumeración ni fuga de datos).
// ============================================================================

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const NAVY = "#0B1F33", CYAN = "#009ECA", INK = "#122230", PAPER = "#F3F7FB", WARN = "#C46A10";
const LOGO = "https://www.gestionglobal.ar/logo-color.png";

function shell(titulo: string, acento: string, inner: string): string {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${titulo} · Gestión Global</title></head>
<body style="margin:0;background:${PAPER};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:${INK};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:48px 16px;"><tr><td align="center">
    <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;background:#fff;border-radius:16px;box-shadow:0 4px 24px rgba(11,31,51,.08);overflow:hidden;">
      <tr><td align="center" style="padding:34px 32px 10px;"><img src="${LOGO}" alt="Gestión Global" style="max-width:190px;height:auto;"/></td></tr>
      <tr><td style="height:5px;background:${acento};"></td></tr>
      <tr><td style="padding:28px 36px 34px;">${inner}</td></tr>
      <tr><td style="padding:16px 36px 28px;border-top:1px solid #e2e8f0;"><p style="margin:0;font-size:12px;color:#94a3b8;text-align:center;">Gestión Global · <a href="https://www.gestionglobal.ar" style="color:${CYAN};text-decoration:none;">gestionglobal.ar</a> · Aliados de tu tiempo</p></td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}
const body = (titulo: string, texto: string) => `<h1 style="margin:0 0 12px;font-size:22px;font-weight:800;color:${NAVY};">${titulo}</h1><p style="margin:0;font-size:15px;line-height:1.65;color:#334155;">${texto}</p>`;
const htmlResp = (s: string, status = 200) => new Response(s, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Access-Control-Allow-Origin": "*" } });
const CONTACTO = `<a href="mailto:contacto@gestionglobal.ar" style="color:${CYAN};">contacto@gestionglobal.ar</a>`;

// Copy por tipo de destinatario (prospecto = captación en frío; cliente = relación).
interface Modo {
  tipo: "prospecto" | "cliente";
  id: string;
  // texto del éxito de la baja
  okTexto: string;
  // texto de la confirmación (GET)
  confirmTexto: string;
  // querystring del action del form (p=&t= o a=&t=)
  qs: (id: string, t: string) => string;
}
function modoProspecto(id: string): Modo {
  return {
    tipo: "prospecto", id,
    okTexto: `No vas a recibir más correos de captación de Gestión Global. Si alguna vez querés volver a recibir novedades, escribinos a ${CONTACTO}.`,
    confirmTexto: "Si confirmás, no vas a recibir más correos de captación de Gestión Global.",
    qs: (i, t) => `p=${encodeURIComponent(i)}&t=${encodeURIComponent(t)}`,
  };
}
function modoCliente(id: string): Modo {
  return {
    tipo: "cliente", id,
    okTexto: `Listo. No vas a recibir más novedades ni ofertas de Gestión Global. Tus comunicaciones de servicio (comprobantes, trámites, avisos de tu cuenta) siguen llegando normalmente. Si querés volver a recibir novedades, escribinos a ${CONTACTO}.`,
    confirmTexto: "Si confirmás, no vas a recibir más novedades ni ofertas de Gestión Global. Tus comunicaciones de servicio (comprobantes, trámites, avisos de tu cuenta) van a seguir llegando igual.",
    qs: (i, t) => `a=${encodeURIComponent(i)}&t=${encodeURIComponent(t)}`,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" } });
  const url = new URL(req.url);
  const p = (url.searchParams.get("p") || "").trim();
  const a = (url.searchParams.get("a") || "").trim();
  const t = (url.searchParams.get("t") || "").trim();
  const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  // El modo lo define qué parámetro vino. `a` (cliente) tiene prioridad si ambos.
  const modo: Modo | null = a ? modoCliente(a) : (p ? modoProspecto(p) : null);

  // ---- POST: procesar la baja (botón humano o List-Unsubscribe-Post one-click) ----
  if (req.method === "POST") {
    let ok = false;
    try {
      if (modo && t) {
        if (modo.tipo === "cliente") {
          const { data } = await svc.rpc("administracion_baja", { p_admin_id: modo.id, p_token: t });
          ok = data?.ok === true;
        } else {
          const { data } = await svc.rpc("prospecto_baja", { p_prospecto_id: modo.id, p_token: t });
          ok = data?.ok === true;
        }
      }
    } catch { /* genérico */ }
    // Respuesta JSON: la consume la página pública gestionglobal.ar/baja (que es
    // la que ve el humano y SÍ renderiza como HTML). El one-click RFC 8058
    // (Gmail/Yahoo POSTea server-side) sólo espera 2xx → 200 en éxito; 400 en
    // fallo para que el front muestre el error correcto.
    return new Response(JSON.stringify({ ok }), {
      status: ok ? 200 : 400,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }

  // ---- GET: validar token (SIN mutar) y mostrar confirmación ----
  let valido = false;
  try {
    if (modo && t) {
      if (modo.tipo === "cliente") {
        const { data } = await svc.from("administraciones").select("id").eq("id", modo.id).eq("baja_token", t).maybeSingle();
        valido = !!data?.id;
      } else {
        const { data } = await svc.from("prospectos").select("id").eq("id", modo.id).eq("baja_token", t).maybeSingle();
        valido = !!data?.id;
      }
    }
  } catch { /* genérico */ }

  if (!modo || !valido) {
    return htmlResp(shell("Enlace no válido", WARN, body("No pudimos procesar la baja", `El enlace no es válido o ya expiró. Si querés dejar de recibir estos correos, escribinos a ${CONTACTO} y lo resolvemos.`)));
  }
  // Página de confirmación con POST (el GET no da de baja → a prueba de prefetch/escáneres).
  const action = `${SUPABASE_URL}/functions/v1/email-baja?${modo.qs(modo.id, t)}`;
  const inner = body("¿Querés darte de baja?", modo.confirmTexto) +
    `<form method="POST" action="${action}" style="margin-top:22px;"><button type="submit" style="display:inline-block;padding:13px 26px;background:${CYAN};color:#fff;border:0;border-radius:10px;font-size:15px;font-weight:700;cursor:pointer;">Confirmar baja</button></form>`;
  return htmlResp(shell("Confirmar baja", CYAN, inner));
});
