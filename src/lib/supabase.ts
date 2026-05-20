import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(url && anonKey);

// Singleton anchorado a globalThis para sobrevivir HMR de Vite. Si no, cada
// recarga en caliente crea una instancia nueva y el lock interno de auth
// (navigator.locks) queda contendido entre instancias → getSession() cuelga.
const GLOBAL_KEY = '__gg_supabase_client__';
type GlobalCache = { [GLOBAL_KEY]?: SupabaseClient<Database> };
const g = globalThis as unknown as GlobalCache;

export const supabase: SupabaseClient<Database> =
  g[GLOBAL_KEY] ??
  (g[GLOBAL_KEY] = createClient<Database>(
    url ?? 'http://localhost:54321',
    anonKey ?? 'public-anon-key-placeholder',
    {
      auth: {
        // persistSession + autoRefreshToken activan locks internos
        // (navigator.locks) que bajo StrictMode/HMR quedan contendidos y
        // cuelgan cualquier query posterior. La session la persistimos a
        // mano con localStorage + setSession() en bootstrap.
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: true,
      },
    },
  ));

// Persistencia manual de session. supabase-js maneja localStorage solo si
// `persistSession: true`, pero eso activa locks que se contienden y cuelgan
// las queries bajo StrictMode/HMR. Lo replicamos a mano sin locks.
const SESSION_KEY = 'gg.auth.session';

export interface StoredSessionLite {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  user: { id: string; email?: string };
}

export function readStoredSession(): StoredSessionLite | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredSessionLite>;
    if (!parsed.access_token || !parsed.user?.id) return null;
    if (parsed.expires_at && parsed.expires_at * 1000 < Date.now()) {
      localStorage.removeItem(SESSION_KEY);
      return null;
    }
    return parsed as StoredSessionLite;
  } catch {
    return null;
  }
}

export function persistSession(s: StoredSessionLite | null): void {
  if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
  else localStorage.removeItem(SESSION_KEY);
}

// Limpia cualquier session vieja de supabase-js (cuando persistSession era
// true) para que no nos contamine la carga.
export function clearLegacySupabaseStorage(): void {
  Object.keys(localStorage)
    .filter((k) => k.startsWith('sb-') && k.endsWith('-auth-token'))
    .forEach((k) => localStorage.removeItem(k));
}
