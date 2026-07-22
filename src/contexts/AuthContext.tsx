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
  SESSION_KEY,
} from '@/lib/supabase';

// E-GG-144 (auditoría §6) · un fallo de red (AuthRetryableFetchError, status 0 o
// sin status) NO significa refresh_token muerto: la laptop pudo despertar de una
// suspensión antes de que vuelva el WiFi. En ese caso el token sigue vivo y NO
// hay que borrar la sesión — se reintenta. Solo un error real del servidor
// (invalid_grant / 4xx) marca el token como muerto.
function esErrorTransitorioDeRed(error: { name?: string; status?: number } | null): boolean {
  if (!error) return false;
  return error.name === 'AuthRetryableFetchError' || error.status === 0 || error.status === undefined;
}
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
  /**
   * El profile existe pero es un administrador cuyo cliente fue dado de baja
   * (profile.activo=false). Se hizo signOut automático; la UI muestra un
   * mensaje honesto "tu acceso fue dado de baja" (Gap 1 / mig 0318). Evita el
   * "portal fantasma": entrar a un portal que carga vacío por la RLS gateada.
   */
  accesoRevocado: boolean;
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
  const [accesoRevocado, setAccesoRevocado] = useState(false);
  // E-GG-07 · timer de refresh manual. Como autoRefreshToken=false (los locks
  // de supabase-js cuelgan bajo StrictMode/HMR), refrescamos el token a mano
  // ~60s antes de que venza, así la sesión no muere cada ~1h.
  //
  // E-GG-144 (incidente JL 21/07 17:26) · el refresh manual competía entre
  // pestañas: cada una cerraba sobre el refresh_token EN MEMORIA (de hasta 1h
  // antes) y, tras una suspensión, todos los timers despertaban juntos y
  // refrescaban con tokens viejos → GoTrue lo detecta como reuso fuera de la
  // ventana de 10s → revoca la FAMILIA entera → deslogueo ("se me cerró la
  // sesión"; la lentitud previa eran los reintentos con el token ya muerto).
  // Fix en 3 capas: (1) re-leer SIEMPRE gg.auth.session antes de refrescar y
  // usar el token más nuevo; (2) lock cross-tab puntual (navigator.locks
  // 'gg-auth-refresh') SOLO alrededor del refresh — no es el lock global de
  // supabase-js que colgaba queries; (3) listener de 'storage' que adopta al
  // instante el token rotado por otra pestaña (la carrera desaparece de raíz).
  const refreshTimer = useRef<number | null>(null);
  const refreshSeguroRef = useRef<() => Promise<void>>(async () => {});
  // Id del usuario ya cargado en contexto — para que la adopción cross-tab de un
  // token rotado (mismo usuario) no re-dispare loadProfile en cada rotación.
  const userIdRef = useRef<string | null>(null);

  // Reintento corto tras un fallo transitorio (red caída post-suspensión).
  const programarReintentoRefresh = useCallback((ms: number) => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = window.setTimeout(() => {
      void refreshSeguroRef.current();
    }, ms);
  }, []);

  const scheduleRefresh = useCallback((s: Session | null) => {
    if (refreshTimer.current) {
      clearTimeout(refreshTimer.current);
      refreshTimer.current = null;
    }
    if (!s?.expires_at || !s.refresh_token) return;
    // 60s de colchón; mínimo 5s para no spamear si ya está por vencer.
    const delay = Math.max(s.expires_at * 1000 - Date.now() - 60_000, 5_000);
    refreshTimer.current = window.setTimeout(() => {
      void refreshSeguroRef.current();
    }, delay);
  }, []);

  // Cuerpo real del refresh (se reasigna en cada render para cerrar sobre el
  // estado más fresco; el timer solo dispara la ref). Ídem userIdRef: el
  // handler de onAuthStateChange (closure del mount) lo lee siempre fresco.
  userIdRef.current = user?.id ?? null;
  refreshSeguroRef.current = async () => {
    const run = async () => {
      // 1) Re-leer el storage: otra pestaña pudo haber rotado el token
      //    mientras este timer dormía (suspensión de la laptop, tab inactiva).
      const stored = readStoredSession();
      if (!stored?.refresh_token) {
        // Logout hecho en otra pestaña → logout local limpio.
        setSession(null);
        setUser(null);
        return;
      }
      // 2) Si el access del storage sigue vigente con margen (>2 min), otra
      //    pestaña ya refrescó: adoptamos sin consumir el refresh_token
      //    (setSession valida el access con un GET /user, nada más).
      if (stored.expires_at * 1000 - Date.now() > 120_000) {
        const { data } = await supabase.auth.setSession({
          access_token: stored.access_token,
          refresh_token: stored.refresh_token,
        });
        if (data.session) {
          setSession(data.session);
          scheduleRefresh(data.session);
          return;
        }
      }
      // 3) Refrescar con el token MÁS NUEVO (el del storage, no el de memoria).
      const { data, error } = await supabase.auth.refreshSession({
        refresh_token: stored.refresh_token,
      });
      if (error && esErrorTransitorioDeRed(error)) {
        // Sin red: el refresh_token sigue vivo — NO tocar el storage ni el
        // estado; reintentar en 30s (cuando vuelva la conexión, adopta/refresca).
        programarReintentoRefresh(30_000);
        return;
      }
      if (error || !data.session) {
        // refresh_token muerto (error real del servidor) → logout limpio.
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
    };
    // Lock cross-tab puntual: si otra pestaña está refrescando, esperamos y al
    // entrar re-leemos el storage (paso 1/2) → adoptamos su resultado.
    try {
      if (typeof navigator !== 'undefined' && navigator.locks?.request) {
        await navigator.locks.request('gg-auth-refresh', run);
      } else {
        await run();
      }
    } catch (err) {
      // Una excepción acá no debe matar el ciclo de refresh de la pestaña:
      // logueamos y reintentamos (la sesión del storage sigue intacta).
      // eslint-disable-next-line no-console
      console.error('[Auth] refresh falló con excepción, reintento en 30s', err);
      programarReintentoRefresh(30_000);
    }
  };

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
      setAccesoRevocado(false);
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
          // Gap 1 (mig 0318): un administrador cuyo cliente fue dado de baja
          // tiene su profile deshabilitado (activo=false). No lo dejamos entrar
          // a un portal que la RLS ya vació — signOut + mensaje honesto.
          if (r.data.role === 'administrador' && !r.data.activo) {
            setUser(null);
            setProfileMissing(false);
            setProfileLoadFailed(false);
            setAccesoRevocado(true);
            try {
              if (isSupabaseConfigured) await supabase.auth.signOut();
            } catch { /* limpiamos storage local igual */ }
            return;
          }
          setUser({ ...r.data, email: s.user.email ?? '' });
          setProfileMissing(false);
          setProfileLoadFailed(false);
          setAccesoRevocado(false);
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
      // scope 'local': el objetivo es no operar sin profile en ESTA pestaña,
      // no revocar server-side la familia de tokens de las demás (§6 E-GG-144).
      if (isSupabaseConfigured) await supabase.auth.signOut({ scope: 'local' });
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
      let falloTransitorioBoot = false;
      if (stored) {
        // Si el access token ya venció, refrescamos con el refresh_token antes
        // de seguir (evita 401 en todas las queries). Si no, lo re-inyectamos.
        const expirado = stored.expires_at * 1000 < Date.now();
        if (expirado) {
          // E-GG-144: el refresh del arranque también va con lock cross-tab y
          // re-lectura del storage — otra pestaña activa pudo rotar el token
          // entre nuestra lectura y este punto.
          const refrescarConLock = async (): Promise<Session | null> => {
            const run = async (): Promise<Session | null> => {
              const fresco = readStoredSession() ?? stored;
              if (fresco.expires_at * 1000 - Date.now() > 120_000) {
                const { data } = await supabase.auth.setSession({
                  access_token: fresco.access_token,
                  refresh_token: fresco.refresh_token,
                });
                if (data.session) return data.session;
              }
              const { data: r, error } = await supabase.auth.refreshSession({
                refresh_token: fresco.refresh_token,
              });
              // Arrancar sin red (PWA offline post-suspensión) NO invalida el
              // refresh_token: no wipear el storage; reintentar cuando vuelva.
              if (error && esErrorTransitorioDeRed(error)) falloTransitorioBoot = true;
              return r.session ?? null;
            };
            if (typeof navigator !== 'undefined' && navigator.locks?.request) {
              return await navigator.locks.request('gg-auth-refresh', run);
            }
            return await run();
          };
          s = await refrescarConLock();
          if (s) {
            persistSession({
              access_token: s.access_token,
              refresh_token: s.refresh_token,
              expires_at: s.expires_at ?? 0,
              user: { id: s.user.id, email: s.user.email },
            });
          } else if (!falloTransitorioBoot) {
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
      // Después de scheduleRefresh (que limpia el timer con s=null): si el boot
      // falló por red transitoria, dejar armado el reintento que recupera la
      // sesión intacta del storage cuando vuelva la conexión.
      if (!s && falloTransitorioBoot) programarReintentoRefresh(30_000);
      await loadProfile(s);
      if (active) setLoading(false);
    })();

    // Persistimos manualmente cada cambio de auth (signIn / signOut / refresh).
    // DGG-93 + E-GG-144 §6: la pestaña de recovery NO escribe gg.auth.session —
    // su sesión (la del link) no debe ser adoptada por las demás pestañas, ni su
    // signOut final debe wipear la sesión normal de otro usuario del browser.
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (!active) return;
      if (!arrivedWithRecoveryHash()) {
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
      }
      // Re-cargamos profile solo en cambios reales (signin/signout); el
      // INITIAL_SESSION lo manejamos arriba con la lectura de storage.
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'TOKEN_REFRESHED') {
        setSession(s);
        scheduleRefresh(s);
        // La adopción cross-tab de un token rotado emite SIGNED_IN; si es el
        // mismo usuario ya cargado, el profile no cambió — no re-cargarlo.
        if (s && s.user.id === userIdRef.current) return;
        void loadProfile(s);
      }
    });

    // E-GG-144 · cuando OTRA pestaña rota el token (o hace logout), este evento
    // llega acá (el evento 'storage' solo dispara en las pestañas que NO
    // escribieron). Adoptamos el token nuevo al instante y reprogramamos el
    // scheduler: ninguna pestaña vuelve a usar un refresh_token viejo.
    const onStorage = (e: StorageEvent) => {
      if (e.key !== SESSION_KEY || !active) return;
      // DGG-93: la pestaña de recovery no adopta sesiones ajenas ni refleja
      // logouts — la sesión autoritativa ahí es la del link, siempre.
      if (arrivedWithRecoveryHash()) return;
      const stored = readStoredSession();
      if (!stored) {
        // Logout en otra pestaña → reflejar acá (flags de error incluidas).
        setSession(null);
        setUser(null);
        setProfileMissing(false);
        setProfileLoadFailed(false);
        setAccesoRevocado(false);
        scheduleRefresh(null);
        return;
      }
      // Si lo guardado ya está por vencer, setSession refrescaría contra el
      // servidor FUERA del lock — delegar en el camino lockeado que re-lee,
      // adopta o refresca serializado.
      if (stored.expires_at * 1000 - Date.now() <= 120_000) {
        void refreshSeguroRef.current();
        return;
      }
      void supabase.auth
        .setSession({
          access_token: stored.access_token,
          refresh_token: stored.refresh_token,
        })
        .then(({ data }) => {
          if (active && data.session) {
            setSession(data.session);
            scheduleRefresh(data.session);
          }
        });
    };
    window.addEventListener('storage', onStorage);

    return () => {
      active = false;
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      window.removeEventListener('storage', onStorage);
      sub.subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadProfile]);

  const signOut = useCallback(async () => {
    try {
      if (isSupabaseConfigured) await supabase.auth.signOut();
    } catch {
      // Ante fallo de red auth-js NO emite SIGNED_OUT ni limpia nada —
      // limpiamos local igual para que la sesión no "resucite" con el timer.
    }
    // Limpieza local incondicional (no depender del evento SIGNED_OUT): borra
    // el storage (propaga el logout a las otras pestañas vía 'storage') y
    // desarma el timer de refresh.
    persistSession(null);
    scheduleRefresh(null);
    setSession(null);
    setUser(null);
    setProfileMissing(false);
    setProfileLoadFailed(false);
    setAccesoRevocado(false);
  }, [scheduleRefresh]);

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
        accesoRevocado,
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
