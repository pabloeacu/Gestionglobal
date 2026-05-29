import { supabase } from '@/lib/supabase';
import { ok, fail, toApiError, type ApiResponse } from '@/lib/errors';

// Push notifications VAPID. La pubkey vive en VITE_VAPID_PUBLIC_KEY (Vercel
// env). Las suscripciones se persisten en push_subscriptions.

function urlBase64ToBuffer(base64String: string): ArrayBuffer {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const b64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out.buffer;
}

function bufferToB64Url(buf: ArrayBuffer | null | undefined): string {
  if (!buf) return '';
  const arr = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i] ?? 0);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function getVapidPublicKey(): string | null {
  // La pubkey se publica como variable de entorno (es safe en el front).
  const k = (import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined) ?? null;
  return k && k.length > 50 ? k : null;
}

export function pushSoportado(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

export async function estadoSuscripcion(): Promise<
  ApiResponse<{ activa: boolean; endpoint: string | null }>
> {
  try {
    if (!pushSoportado()) return ok({ activa: false, endpoint: null });
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    return ok({ activa: !!sub, endpoint: sub?.endpoint ?? null });
  } catch (e) {
    const err = toApiError(e);
    return fail(err.code, err.message, err.details);
  }
}

export async function suscribirPush(): Promise<
  ApiResponse<{ endpoint: string }>
> {
  try {
    if (!pushSoportado()) {
      return fail('NOT_SUPPORTED', 'Este browser no soporta notificaciones push.');
    }
    const pubKey = getVapidPublicKey();
    if (!pubKey) {
      // VAPID public key no está configurada en el environment (VITE_VAPID_PUBLIC_KEY).
      // Esto es un setup pendiente de gerencia, no un problema del usuario.
      return fail(
        'NO_VAPID',
        'Las notificaciones push aún no fueron configuradas en el servidor. Avisanos a contacto@gestionglobal.ar y lo resolvemos. Mientras tanto, vas a recibir todos los avisos por email y en la campanita del portal.',
      );
    }
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToBuffer(pubKey),
      });
    }
    const auth = bufferToB64Url(sub.getKey('auth'));
    const p256dh = bufferToB64Url(sub.getKey('p256dh'));
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return fail('NO_AUTH', 'Necesitás estar logueado.');
    const { error } = await supabase
      .from('push_subscriptions')
      .upsert(
        {
          user_id: user.id,
          endpoint: sub.endpoint,
          keys_p256dh: p256dh,
          keys_auth: auth,
          user_agent: navigator.userAgent,
        },
        { onConflict: 'user_id,endpoint' },
      );
    if (error) throw error;
    return ok({ endpoint: sub.endpoint });
  } catch (e) {
    const err = toApiError(e);
    return fail(err.code, err.message, err.details);
  }
}

export async function desuscribirPush(): Promise<ApiResponse<null>> {
  try {
    if (!pushSoportado()) return ok(null);
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      const endpoint = sub.endpoint;
      await sub.unsubscribe();
      await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint);
    }
    return ok(null);
  } catch (e) {
    const err = toApiError(e);
    return fail(err.code, err.message, err.details);
  }
}

export async function pedirPermisoYSuscribir(): Promise<
  ApiResponse<{ endpoint: string }>
> {
  if (!pushSoportado()) {
    return fail('NOT_SUPPORTED', 'Este browser no soporta notificaciones push.');
  }
  if (Notification.permission === 'denied') {
    return fail(
      'DENIED',
      'Notificaciones bloqueadas. Habilitalas desde la configuración del browser.',
    );
  }
  if (Notification.permission === 'default') {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') {
      return fail('DENIED', 'No nos diste permiso para enviarte notificaciones.');
    }
  }
  return suscribirPush();
}

export async function encolarPushDePrueba(
  userId: string,
): Promise<ApiResponse<{ id: string }>> {
  try {
    const args = {
      p_user_id: userId,
      p_titulo: 'Notificación de prueba',
      p_cuerpo: 'Si ves esto, las push están funcionando.',
      p_click_url: '/gerencia',
    } as unknown as {
      p_user_id: string;
      p_titulo: string;
      p_cuerpo: string;
      p_icono_url: string;
      p_click_url: string;
    };
    const { data, error } = await supabase.rpc('encolar_push', args);
    if (error) throw error;
    return ok({ id: String(data) });
  } catch (e) {
    const err = toApiError(e);
    return fail(err.code, err.message, err.details);
  }
}
