// oauth-callback · captura authorization code de Google, lo intercambia por
// refresh_token y muestra el token en una página HTML para copiar.
//
// Secrets: GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, OAUTH_STATE_SECRET.
// El redirect_uri va hardcoded porque Supabase Edge Runtime no expone el host
// público en req.url (devuelve un host interno), lo que genera mismatch en el
// token exchange. Con hardcoded matchea pixel-perfect con lo registrado en GCP.

const REDIRECT_URI = 'https://kaoyhkebnidzqjixvchh.supabase.co/functions/v1/oauth-callback';

Deno.serve(async (req) => {
  const url = new URL(req.url);

  if (url.searchParams.get('intent') === 'start') {
    return htmlPage(buildStartPage());
  }

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const stateSecret = Deno.env.get('OAUTH_STATE_SECRET');

  if (!code) return htmlPage(errorPage('Falta el parametro `code`. Esta URL la abre Google despues de autorizar.'));
  if (!stateSecret) return htmlPage(errorPage('Servidor sin OAUTH_STATE_SECRET configurado.'));
  if (state !== stateSecret) return htmlPage(errorPage('State invalido (posible CSRF). Reintenta el flujo.'));

  const clientId = Deno.env.get('GOOGLE_OAUTH_CLIENT_ID');
  const clientSecret = Deno.env.get('GOOGLE_OAUTH_CLIENT_SECRET');
  if (!clientId || !clientSecret) return htmlPage(errorPage('Faltan secrets CLIENT_ID / CLIENT_SECRET en Supabase Dashboard.'));

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
    }).toString(),
  });

  if (!tokenRes.ok) {
    const txt = await tokenRes.text();
    return htmlPage(errorPage(`Google rechazo el code (${tokenRes.status}): ${txt}`));
  }
  const tokens = await tokenRes.json() as { refresh_token?: string; access_token?: string };
  if (!tokens.refresh_token) {
    return htmlPage(errorPage('Google no devolvio refresh_token. Revisa access_type=offline y prompt=consent en el authUrl.'));
  }

  let email = '';
  try {
    const u = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (u.ok) {
      const j = await u.json() as { email?: string };
      email = j.email ?? '';
    }
  } catch { /* opcional */ }

  return htmlPage(successPage(tokens.refresh_token, email));
});

function htmlPage(body: string): Response {
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

function buildStartPage(): string {
  return `<!DOCTYPE html><html lang="es"><body><h1>OAuth setup</h1><p>callback: ${REDIRECT_URI}</p></body></html>`;
}

function successPage(refreshToken: string, email: string): string {
  return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"/><title>OAuth OK</title><style>body{font-family:Inter,system-ui,sans-serif;max-width:640px;margin:60px auto;padding:0 20px;color:#0d1e2f;line-height:1.6}h1{font-size:24px;margin:0 0 8px;color:#059669}.box{background:#fff;border:2px solid #009eca;border-radius:12px;padding:20px;margin:20px 0}.token{font-family:monospace;font-size:12px;background:#f1f5f9;padding:12px;border-radius:6px;word-break:break-all;border:1px solid #e2e8f0}.label{font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:#009eca;font-weight:700;margin-bottom:6px}button{background:#009eca;color:#fff;border:0;padding:10px 18px;border-radius:8px;font-weight:600;cursor:pointer}</style></head><body><h1>✓ Autorización exitosa</h1><p>Copiá estos dos valores como secrets en Supabase. <strong>NO los pegues en ningún otro lado</strong>.</p>${email ? `<div class="box"><div class="label">GOOGLE_OAUTH_SENDER_EMAIL</div><div style="font-size:14px;font-weight:600;">${email}</div></div>` : ''}<div class="box"><div class="label">GOOGLE_OAUTH_REFRESH_TOKEN</div><div class="token" id="tok">${refreshToken}</div><button onclick="navigator.clipboard.writeText(document.getElementById('tok').textContent);this.textContent='Copiado!';">Copiar</button></div></body></html>`;
}

function errorPage(msg: string): string {
  return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"/><title>OAuth error</title><style>body{font-family:Inter,system-ui,sans-serif;max-width:640px;margin:60px auto;padding:0 20px;color:#0d1e2f;line-height:1.6}h1{color:#dc2626}.box{background:#fef2f2;border:1px solid #fca5a5;border-radius:8px;padding:16px;font-family:monospace;font-size:12px;white-space:pre-wrap;}</style></head><body><h1>✗ Error en OAuth</h1><div class="box">${msg}</div></body></html>`;
}
