// dispatch-push · drena push_notifications_queue y envía Web Push vía VAPID.
//
// Implementación nativa Deno (SubtleCrypto) — sin dependencias npm.
// Pasos por cada notificación:
//   1. Por cada push_subscription del user, construir VAPID JWT (ES256, exp +12h).
//   2. POST al endpoint con Authorization: vapid t=<jwt>, k=<pubkey base64url>
//      y body cifrado (aes128gcm) — en esta primera versión enviamos el body
//      en claro como Encryption=aes128gcm sin payload encriptado: muchos
//      browsers permiten payload null (notificación "tickle"); el SW lee el
//      payload por separado vía fetch al click_url.
//      → Para evitar incompatibilidades, usamos payload vacío + datos en
//      título/cuerpo guardados en el SW via Push event sin data.
//
// Secrets:
//   VAPID_PUBLIC_KEY  (base64url, 65 bytes uncompressed P-256)
//   VAPID_PRIVATE_KEY (base64url, 32 bytes)
//   VAPID_SUBJECT     (mailto:..., opcional, default mailto:contacto@gestionglobal.ar)
//
// Si los secrets no están seteados, la función log-only (no rompe nada).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.46.1';

const BATCH_MAX = 25;

Deno.serve(async (req) => {
  if (req.method === 'GET') return new Response('dispatch-push alive', { status: 200 });

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const pubB64 = Deno.env.get('VAPID_PUBLIC_KEY');
  const privB64 = Deno.env.get('VAPID_PRIVATE_KEY');
  const subject = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:contacto@gestionglobal.ar';

  if (!pubB64 || !privB64) {
    return json({ ok: true, skipped: 'VAPID keys not configured' });
  }

  const { data: rows } = await admin
    .from('push_notifications_queue')
    .select('id, user_id, titulo, cuerpo, icono_url, click_url, intento, max_intentos')
    .is('enviada_at', null)
    .order('created_at', { ascending: true })
    .limit(BATCH_MAX);

  if (!rows || rows.length === 0) return json({ ok: true, drained: 0 });

  let importedKey: CryptoKey;
  try {
    importedKey = await importVapidPrivateKey(privB64);
  } catch (e) {
    return json({ ok: false, error: 'VAPID private key inválida: ' + (e as Error).message }, 500);
  }

  let sent = 0;
  let failed = 0;

  for (const n of rows) {
    const { data: subs } = await admin
      .from('push_subscriptions')
      .select('id, endpoint, keys_p256dh, keys_auth')
      .eq('user_id', n.user_id);
    if (!subs || subs.length === 0) {
      await admin.from('push_notifications_queue')
        .update({ enviada_at: new Date().toISOString(), error: 'sin subscriptions' })
        .eq('id', n.id);
      continue;
    }

    let okCount = 0;
    let lastErr: string | null = null;

    for (const s of subs) {
      try {
        const endpoint = s.endpoint as string;
        const origin = new URL(endpoint).origin;
        const aud = origin;
        const exp = Math.floor(Date.now() / 1000) + 12 * 60 * 60;
        const jwt = await signVapidJwt(
          { aud, exp, sub: subject },
          importedKey,
        );

        const payload = JSON.stringify({
          titulo: n.titulo,
          cuerpo: n.cuerpo,
          icono_url: n.icono_url,
          click_url: n.click_url,
        });

        // Encripta payload con aes128gcm para la subscription.
        const encrypted = await encryptPayload(
          payload,
          s.keys_p256dh as string,
          s.keys_auth as string,
        );

        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Authorization': `vapid t=${jwt}, k=${pubB64}`,
            'Content-Encoding': 'aes128gcm',
            'Content-Type': 'application/octet-stream',
            'TTL': '86400',
          },
          body: encrypted,
        });

        if (res.status === 201 || res.status === 200 || res.status === 202) {
          okCount++;
          await admin
            .from('push_subscriptions')
            .update({ last_used_at: new Date().toISOString() })
            .eq('id', s.id);
        } else if (res.status === 404 || res.status === 410) {
          // subscription expirada → eliminar
          await admin.from('push_subscriptions').delete().eq('id', s.id);
          lastErr = `subscription ${res.status}`;
        } else {
          lastErr = `http ${res.status}`;
        }
      } catch (e) {
        lastErr = (e as Error).message;
      }
    }

    if (okCount > 0) {
      await admin.from('push_notifications_queue')
        .update({ enviada_at: new Date().toISOString(), error: null, intento: (n.intento ?? 0) + 1 })
        .eq('id', n.id);
      sent++;
    } else {
      const nextIntento = (n.intento ?? 0) + 1;
      const giveUp = nextIntento >= (n.max_intentos ?? 3);
      await admin.from('push_notifications_queue')
        .update({
          intento: nextIntento,
          error: lastErr ?? 'sin éxito',
          enviada_at: giveUp ? new Date().toISOString() : null,
        })
        .eq('id', n.id);
      failed++;
    }
  }

  return json({ ok: true, drained: rows.length, sent, failed });
});

// ---------------------------------------------------------------------------
// VAPID JWT (ES256)
// ---------------------------------------------------------------------------
async function importVapidPrivateKey(b64url: string): Promise<CryptoKey> {
  const raw = b64urlDecode(b64url); // 32 bytes
  // El private key VAPID es un escalar P-256. Lo importamos como JWK.
  // Para JWK necesitamos también la public key (x,y). La derivamos haciendo
  // que la importemos como pkcs8 sería más simple, pero la entrada es raw.
  // Solución: armamos un JWK con d=privKey y usamos importKey('jwk', ...)
  // — para ECDSA Deno permite importar sólo d si pasamos también x,y, así
  // que reconstruimos x,y multiplicando G * d (libsodium no está, pero
  // podemos hacerlo importando como 'pkcs8' construyendo el ASN.1).
  //
  // Forma más simple y robusta: requerir VAPID_PRIVATE_KEY en formato PKCS8
  // base64url. Para mantener compatibilidad con `web-push generate-vapid-keys`,
  // que devuelve raw 32-byte, hacemos importación vía JWK con derivación.

  // Atajo: usamos jose-style — importamos como JWK incompleto. Si el d viene
  // sólo, browsers la rechazan. Trabajo manual:
  // Construimos PKCS#8 DER para ECPrivateKey P-256 con sólo `privateKey`.

  const pkcs8 = ecPrivateKeyToPkcs8(raw);
  return await crypto.subtle.importKey(
    'pkcs8',
    pkcs8,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
}

function ecPrivateKeyToPkcs8(d: Uint8Array): Uint8Array {
  // PKCS#8 PrivateKeyInfo for P-256 ECPrivateKey (RFC 5208 + 5915)
  // Layout (DER):
  //   SEQUENCE {
  //     INTEGER 0
  //     SEQUENCE { OID 1.2.840.10045.2.1, OID 1.2.840.10045.3.1.7 }   -- ecPublicKey + P-256
  //     OCTET STRING {
  //       SEQUENCE {
  //         INTEGER 1
  //         OCTET STRING (d, 32 bytes)
  //       }
  //     }
  //   }
  const ecPrivKey = concat([
    Uint8Array.from([0x30, 0x25, 0x02, 0x01, 0x01, 0x04, 0x20]),
    d,
  ]);
  const pkcs8Body = concat([
    // version 0
    Uint8Array.from([0x02, 0x01, 0x00]),
    // AlgId: SEQ { OID ecPublicKey, OID P-256 }
    Uint8Array.from([
      0x30, 0x13,
      0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01,
      0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07,
    ]),
    // OCTET STRING wrapping ecPrivKey
    Uint8Array.from([0x04, ecPrivKey.length]),
    ecPrivKey,
  ]);
  // SEQ wrapper
  return concat([Uint8Array.from([0x30, pkcs8Body.length]), pkcs8Body]);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}

async function signVapidJwt(claims: Record<string, unknown>, key: CryptoKey): Promise<string> {
  const header = b64urlEncode(new TextEncoder().encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const payload = b64urlEncode(new TextEncoder().encode(JSON.stringify(claims)));
  const signingInput = `${header}.${payload}`;
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${b64urlEncode(new Uint8Array(sig))}`;
}

// ---------------------------------------------------------------------------
// aes128gcm payload encryption (RFC 8291)
// ---------------------------------------------------------------------------
async function encryptPayload(
  payload: string,
  uaPublicB64url: string,
  authSecretB64url: string,
): Promise<Uint8Array> {
  const uaPublic = b64urlDecode(uaPublicB64url);
  const authSecret = b64urlDecode(authSecretB64url);

  // Generate ephemeral ECDH P-256 keypair
  const ephemeral = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits'],
  );
  const asPublicRaw = new Uint8Array(
    await crypto.subtle.exportKey('raw', ephemeral.publicKey),
  ); // 65 bytes uncompressed

  // Import UA public key
  const uaKey = await crypto.subtle.importKey(
    'raw',
    uaPublic,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );

  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: 'ECDH', public: uaKey },
      ephemeral.privateKey,
      256,
    ),
  );

  // PRK_key = HMAC-SHA256(authSecret, ecdhSecret)
  const prkKey = await hmacSha256(authSecret, ecdhSecret);

  // key_info = "WebPush: info\0" || UA_public || AS_public
  const keyInfo = concat([
    new TextEncoder().encode('WebPush: info\0'),
    uaPublic,
    asPublicRaw,
  ]);
  // IKM = HKDF(authSecret, ecdhSecret, key_info, 32)
  const ikm = await hkdfExpand(prkKey, keyInfo, 32);

  // Salt: 16 random bytes
  const salt = crypto.getRandomValues(new Uint8Array(16));

  // PRK = HMAC-SHA256(salt, IKM)
  const prk = await hmacSha256(salt, ikm);

  // CEK = HKDF-Expand(PRK, "Content-Encoding: aes128gcm\0", 16)
  const cek = await hkdfExpand(prk, new TextEncoder().encode('Content-Encoding: aes128gcm\0'), 16);
  // NONCE = HKDF-Expand(PRK, "Content-Encoding: nonce\0", 12)
  const nonce = await hkdfExpand(prk, new TextEncoder().encode('Content-Encoding: nonce\0'), 12);

  // Payload: data || 0x02 (delimiter for last record)
  const data = new TextEncoder().encode(payload);
  const padded = concat([data, Uint8Array.from([0x02])]);

  const cekKey = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, cekKey, padded),
  );

  // Header: salt(16) || rs(4 BE = 4096) || idlen(1 = 65) || keyid (AS_public 65)
  const rs = new Uint8Array([0x00, 0x00, 0x10, 0x00]); // 4096
  const idlen = new Uint8Array([asPublicRaw.length]);
  return concat([salt, rs, idlen, asPublicRaw, ciphertext]);
}

async function hmacSha256(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data));
}

async function hkdfExpand(prk: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  // Single-iteration HKDF-Expand (sufficient for length <= 32)
  const t = await hmacSha256(prk, concat([info, Uint8Array.from([0x01])]));
  return t.slice(0, length);
}

// ---------------------------------------------------------------------------
// base64url helpers
// ---------------------------------------------------------------------------
function b64urlEncode(buf: Uint8Array): string {
  let s = btoa(String.fromCharCode(...buf));
  return s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(s: string): Uint8Array {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
