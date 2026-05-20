// oauth-callback · captura el authorization code de Google y lo intercambia
// por refresh_token. Devuelve una página HTML con el refresh_token listo
// para copiar/pegar en Supabase secrets.
//
// Esta función es PUBLICA (verify_jwt=false). Solo procesa requests con
// state que matchee OAUTH_STATE_SECRET, evitando ataque CSRF.
//
// Secrets que debe leer:
//   GOOGLE_OAUTH_CLIENT_ID
//   GOOGLE_OAUTH_CLIENT_SECRET
//   OAUTH_STATE_SECRET    (random, generado al armar el authUrl)

Deno.serve(async (req) => {
  const url = new URL(req.url);

  if (url.searchParams.get('intent') === 'start') {
    return htmlPage(buildStartPage(url.origin + url.pathname));
  }

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const stateSecret = Deno.env.get('OAUTH_STATE_SECRET');

  if (!code) return htmlPage(errorPage('Falta el parametro `code`. Esta URL la abre Google despues de autorizar.'));
  if (!stateSecret) return htmlPage(errorPage('Servidor sin OAUTH_STATE_SECRET configurado.'));
  if (state !== stateSecret) return htmlPage(errorPage('State inválido (posible CSRF). Reintentá el flujo.'));

  const clientId = Deno.env.get('GOOGLE_OAUTH_CLIENT_ID');
  const clientSecret = Deno.env.get('GOOGLE_OAUTH_CLIENT_SECRET');
  if (!clientId || !clientSecret) return htmlPage(errorPage('Faltan secrets CLIENT_ID / CLIENT_SECRET. Configurá en Supabase Dashboard.'));

  const redirectUri = `${url.origin}${url.pathname}`;
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }).toString(),
  });

  if (!tokenRes.ok) {
    const txt = await tokenRes.text();
    return htmlPage(errorPage(`Google rechazo el code (${tokenRes.status}): ${txt}`));
  }
  const tokens = await tokenRes.json() as { refresh_token?: string; access_token?: string; expires_in?: number; scope?: string };
  if (!tokens.refresh_token) {
    return htmlPage(errorPage('Google no devolvió refresh_token. Revisá que el authUrl incluya access_type=offline y prompt=consent.'));
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
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

function buildStartPage(callbackUrl: string): string {
  return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"/><title>OAuth setup · Gestión Global</title><style>body{font-family:Inter,system-ui,sans-serif;max-width:640px;margin:60px auto;padding:0 20px;color:#0d1e2f;line-height:1.6}h1{font-size:24px;margin:0 0 8px}.note{background:#fef3c7;border:1px solid #fcd34d;border-radius:8px;padding:12px;margin:16px 0;font-size:14px}code{background:#f1f5f9;padding:2px 6px;border-radius:4px;font-size:13px}</style></head><body><h1>OAuth setup</h1><p>Para iniciar la autorización, abrí esta URL en el browser (reemplazá <code>YOUR_CLIENT_ID</code> por tu Client ID y <code>YOUR_STATE</code> por el OAUTH_STATE_SECRET que generaste):</p><pre style="background:#0d1e2f;color:#fff;padding:16px;border-radius:8px;font-size:11px;overflow:auto;">https://accounts.google.com/o/oauth2/v2/auth?client_id=YOUR_CLIENT_ID&redirect_uri=${encodeURIComponent(callbackUrl)}&response_type=code&scope=${encodeURIComponent('https://mail.google.com/ openid email')}&access_type=offline&prompt=consent&state=YOUR_STATE</pre><div class="note"><strong>Importante:</strong> elegí en "Authorized redirect URIs" del cliente OAuth en GCP exactamente: <code>${callbackUrl}</code></div></body></html>`;
}

function successPage(refreshToken: string, email: string): string {
  return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"/><title>OAuth OK · Gestión Global</title><style>body{font-family:Inter,system-ui,sans-serif;max-width:640px;margin:60px auto;padding:0 20px;color:#0d1e2f;line-height:1.6}h1{font-size:24px;margin:0 0 8px;color:#059669}.box{background:#fff;border:2px solid #009eca;border-radius:12px;padding:20px;margin:20px 0}.token{font-family:'SF Mono',Monaco,monospace;font-size:12px;background:#f1f5f9;padding:12px;border-radius:6px;word-break:break-all;border:1px solid #e2e8f0}.label{font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:#009eca;font-weight:700;margin-bottom:6px}button{background:#009eca;color:#fff;border:0;padding:10px 18px;border-radius:8px;font-weight:600;cursor:pointer}</style></head><body><h1>✓ Autorización exitosa</h1><p>Google devolvió un <strong>refresh_token</strong>. Copialo y pegá en Supabase Dashboard como secret <code>GOOGLE_OAUTH_REFRESH_TOKEN</code>.</p>${email ? `<div class="box"><div class="label">Casilla autorizada</div><div style="font-size:14px;font-weight:600;">${email}</div><p style="font-size:13px;color:#64748b;margin:8px 0 0;">También pegá esta dirección como secret <code>GOOGLE_OAUTH_SENDER_EMAIL</code>.</p></div>` : ''}<div class="box"><div class="label">GOOGLE_OAUTH_REFRESH_TOKEN</div><div class="token" id="tok">${refreshToken}</div><button onclick="navigator.clipboard.writeText(document.getElementById('tok').textContent);this.textContent='Copiado!';">Copiar</button></div><p style="font-size:13px;color:#64748b;">Cuando cargues ese secret en Supabase, la edge function send-comprobante-email va a poder enviar emails como ${email || 'la casilla autorizada'} vía Gmail API. <strong>NO compartas este token</strong>: equivale a tu contraseña Gmail.</p></body></html>`;
}

function errorPage(msg: string): string {
  return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"/><title>OAuth error</title><style>body{font-family:Inter,system-ui,sans-serif;max-width:640px;margin:60px auto;padding:0 20px;color:#0d1e2f;line-height:1.6}h1{color:#dc2626}.box{background:#fef2f2;border:1px solid #fca5a5;border-radius:8px;padding:16px;font-family:monospace;font-size:13px;}</style></head><body><h1>✗ Error en OAuth</h1><div class="box">${msg}</div></body></html>`;
}
