import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Session } from '@supabase/supabase-js';
import {
  supabase,
  isSupabaseConfigured,
  readStoredSession,
  persistSession,
  clearLegacySupabaseStorage,
} from '@/lib/supabase';
import { getCurrentProfile, type CurrentProfile, type Role } from '@/services/api/profiles';

export type { Role } from '@/services/api/profiles';

export interface CurrentUser extends CurrentProfile {
  email: string;
}

interface AuthState {
  loading: boolean;
  session: Session | null;
  user: CurrentUser | null;
  configured: boolean;
  /** El profile aún no apareció en DB después de auth (trigger en vuelo). */
  profileMissing: boolean;
  signOut: () => Promise<void>;
  reloadProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

// Fuente única de verdad del usuario actual (E10). Carga session + profile y
// los mantiene sincronizados con auth state changes y refresh manual.
//
// Bootstrap: leemos session de localStorage sincrónicamente para que el shell
// no haga "flash" de Cargando… en cada navegación. Luego onAuthStateChange
// confirma/actualiza con la sesión real.
export function AuthProvider({ children }: { children: ReactNode }) {
  const stored = isSupabaseConfigured ? readStoredSession() : null;
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(
    stored
      ? ({
          access_token: stored.access_token,
          refresh_token: stored.refresh_token,
          expires_at: stored.expires_at,
          user: { id: stored.user.id, email: stored.user.email ?? '' },
        } as unknown as Session)
      : null,
  );
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [profileMissing, setProfileMissing] = useState(false);
  // E-GG-07 · timer de refresh manual. Como autoRefreshToken=false (los locks
  // de supabase-js cuelgan bajo StrictMode/HMR), refrescamos el token a mano
  // ~60s antes de que venza, así la sesión no muere cada ~1h.
  const refreshTimer = useRef<number | null>(null);

  const scheduleRefresh = useCallback((s: Session | null) => {
    if (refreshTimer.current) {
      clearTimeout(refreshTimer.current);
      refreshTimer.current = null;
    }
    if (!s?.expires_at || !s.refresh_token) return;
    // 60s de colchón; mínimo 5s para no spamear si ya está por vencer.
    const delay = Math.max(s.expires_at * 1000 - Date.now() - 60_000, 5_000);
    refreshTimer.current = window.setTimeout(async () => {
      const { data, error } = await supabase.auth.refreshSession({
        refresh_token: s.refresh_token,
      });
      if (error || !data.session) {
        // refresh_token muerto → logout limpio.
        persistSession(null);
        setSession(null);
        setUser(null);
        return;
      }
      persistSession({
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
        expires_at: data.session.expires_at ?? 0,
        user: { id: data.session.user.id, email: data.session.user.email },
      });
      setSession(data.session);
      scheduleRefresh(data.session);
    }, delay);
  }, []);

  const loadProfile = useCallback(async (s: Session | null) => {
    if (!s) {
      setUser(null);
      setProfileMissing(false);
      return;
    }
    const res = await getCurrentProfile(s.user.id);
    if (!res.ok) {
      setUser(null);
      setProfileMissing(true);
      return;
    }
    if (!res.data) {
      // trigger handle_new_user puede estar en vuelo; reintentamos una vez
      await new Promise((r) => setTimeout(r, 350));
      const retry = await getCurrentProfile(s.user.id);
      if (retry.ok && retry.data) {
        setUser({ ...retry.data, email: s.user.email ?? '' });
        setProfileMissing(false);
        return;
      }
      setUser(null);
      setProfileMissing(true);
      return;
    }
    setUser({ ...res.data, email: s.user.email ?? '' });
    setProfileMissing(false);
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }
    let active = true;

    // Limpiar storage legacy (supabase-js con persistSession activo) por las
    // dudas, para que no nos contamine.
    clearLegacySupabaseStorage();

    (async () => {
      const stored = readStoredSession();
      let s: Session | null = null;
      if (stored) {
        // Si el access token ya venció, refrescamos con el refresh_token antes
        // de seguir (evita 401 en todas las queries). Si no, lo re-inyectamos.
        const expirado = stored.expires_at * 1000 < Date.now();
        if (expirado) {
          const { data: r } = await supabase.auth.refreshSession({
            refresh_token: stored.refresh_token,
          });
          s = r.session ?? null;
          if (s) {
            persistSession({
              access_token: s.access_token,
              refresh_token: s.refresh_token,
              expires_at: s.expires_at ?? 0,
              user: { id: s.user.id, email: s.user.email },
            });
          } else {
            persistSession(null);
          }
        } else {
          await supabase.auth.setSession({
            access_token: stored.access_token,
            refresh_token: stored.refresh_token,
          });
          s = (await supabase.auth.getSession()).data.session;
        }
      }
      if (!active) return;
      setSession(s);
      scheduleRefresh(s);
      await loadProfile(s);
      if (active) setLoading(false);
    })();

    // Persistimos manualmente cada cambio de auth (signIn / signOut / refresh).
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (!active) return;
      if (s) {
        persistSession({
          access_token: s.access_token,
          refresh_token: s.refresh_token,
          expires_at: s.expires_at ?? 0,
          user: { id: s.user.id, email: s.user.email },
        });
      } else {
        persistSession(null);
      }
      // Re-cargamos profile solo en cambios reales (signin/signout); el
      // INITIAL_SESSION lo manejamos arriba con la lectura de storage.
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'TOKEN_REFRESHED') {
        setSession(s);
        scheduleRefresh(s);
        void loadProfile(s);
      }
    });

    return () => {
      active = false;
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      sub.subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadProfile]);

  const signOut = useCallback(async () => {
    if (isSupabaseConfigured) await supabase.auth.signOut();
    setSession(null);
    setUser(null);
    setProfileMissing(false);
  }, []);

  const reloadProfile = useCallback(async () => {
    await loadProfile(session);
  }, [loadProfile, session]);

  return (
    <AuthContext.Provider
      value={{
        loading,
        session,
        user,
        configured: isSupabaseConfigured,
        profileMissing,
        signOut,
        reloadProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>');
  return ctx;
}

// Convenience: rol actual o null
export function useRole(): Role | null {
  return useAuth().user?.role ?? null;
}
