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
  arrivedWithRecoveryHash,
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
  /**
   * La carga del profile falló por error técnico (red/timeout/RLS) tras
   * agotar los reintentos con backoff. Distinto a `profileMissing` (perfil
   * no existe en DB). Cuando es `true`, ya se hizo `signOut()` automático
   * para no operar con sesión auth viva sin profile cargado. Inspirado en
   * el handoff de MDC (1/6/2026): un fallback "seguro" a rol mínimo
   * engaña la UX; fallback honesto = sin sesión + mensaje claro.
   */
  profileLoadFailed: boolean;
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
  const [profileLoadFailed, setProfileLoadFailed] = useState(false);
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

  // Reintentos + backoff + watchdog en la hidratación del profile.
  // Inspirado en el handoff de MDC (1/6/2026):
  //   - Tres reglas de oro: no inventes perfil sintético, reintentá con
  //     backoff, si falla todo signOut y mandá al login con mensaje claro.
  //   - Antipatrón a evitar: fallback "seguro" a rol de mínimo privilegio
  //     (engaña la UX y trata mal al usuario real).
  //
  // Diseño:
  //   - 3 intentos con timeouts crecientes [8s, 9s, 12s] (Promise.race contra
  //     timeout duro, evita "Cargando…" infinito si supabase-js cuelga).
  //   - Backoff entre intentos: 350ms (primero, cubre el caso "trigger
  //     handle_new_user en vuelo" post-signup) y 1000ms (segundo).
  //   - Tres resultados posibles por intento:
  //       * success: profile cargado, sale.
  //       * null: respuesta válida sin datos (perfil no existe).
  //       * error: timeout/red/RLS — error técnico.
  //   - Si ≥2 intentos consistentemente null y NINGÚN error técnico →
  //     marca `profileMissing=true` (la UI muestra "Hablá con un gerente").
  //   - Si hubo ANY error técnico tras agotar reintentos → loguea con
  //     `console.error`, hace `signOut()`, limpia sesión y marca
  //     `profileLoadFailed=true` (la UI muestra "No pudimos completar el
  //     inicio de sesión, reintentá").
  const loadProfile = useCallback(async (s: Session | null) => {
    if (!s) {
      setUser(null);
      setProfileMissing(false);
      setProfileLoadFailed(false);
      return;
    }

    const TIMEOUTS_MS = [8_000, 9_000, 12_000];
    const BACKOFFS_MS = [350, 1_000];
    let lastError: unknown = null;
    let nullCount = 0;

    for (let i = 0; i < TIMEOUTS_MS.length; i++) {
      let attempted: 'success' | 'null' | 'error' = 'error';
      try {
        const timeoutP = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error(`profile load timeout ${TIMEOUTS_MS[i]}ms`)), TIMEOUTS_MS[i]);
        });
        const queryP = getCurrentProfile(s.user.id);
        const r = await Promise.race([queryP, timeoutP]);

        if (!r.ok) {
          // r.error existe sólo en esta rama del discriminated union.
          lastError = r.error;
          attempted = 'error';
        } else if (r.data) {
          setUser({ ...r.data, email: s.user.email ?? '' });
          setProfileMissing(false);
          setProfileLoadFailed(false);
          return;
        } else {
          nullCount++;
          attempted = 'null';
        }
      } catch (e) {
        // Timeout duro del Promise.race o excepción imprevista.
        lastError = e;
        attempted = 'error';
      }

      // Backoff sólo si quedan intentos. Caso null: backoff corto (trigger
      // handle_new_user en vuelo). Caso error: backoff progresivo.
      if (i < TIMEOUTS_MS.length - 1) {
        const wait = attempted === 'null' ? BACKOFFS_MS[0] : BACKOFFS_MS[Math.min(i, BACKOFFS_MS.length - 1)];
        await new Promise((r) => setTimeout(r, wait));
      }
    }

    // Acá agotamos los 3 intentos sin éxito.
    if (nullCount >= 2 && !lastError) {
      // Múltiples respuestas válidas con perfil null → realmente no existe
      // (no es un transient de red). UI: "Hablá con un gerente".
      setUser(null);
      setProfileMissing(true);
      setProfileLoadFailed(false);
      return;
    }

    // Hubo errores técnicos en al menos un intento. NO operamos con sesión
    // auth viva sin profile cargado → signOut explícito.
    // eslint-disable-next-line no-console
    console.error('[Auth] No se pudo cargar el perfil tras reintentos', {
      userId: s.user.id,
      lastError: lastError instanceof Error ? lastError.message : String(lastError),
      nullCount,
    });
    try {
      if (isSupabaseConfigured) await supabase.auth.signOut();
    } catch {
      // Si el signOut falla por red, igual limpiamos local — la sesión queda
      // muerta del lado cliente y el próximo intento la regenera.
    }
    persistSession(null);
    setSession(null);
    setUser(null);
    setProfileMissing(false);
    setProfileLoadFailed(true);
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
      // DGG-93 · Si llegamos por un link de recuperación (hash type=recovery), NO
      // restauramos la sesión guardada: dejamos que la sesión de recovery (que
      // setea detectSessionInUrl) sea la autoritativa, para que /restablecer opere
      // sobre el usuario correcto y no sobre uno ya logueado en el navegador.
      const stored = arrivedWithRecoveryHash() ? null : readStoredSession();
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
    setProfileLoadFailed(false);
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
        profileLoadFailed,
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
