import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';

// Roles (adaptados de doc 01 a single-tenant Gestión Global):
//  gerente       → los 2 socios, acceso total (≈ apex/partner MANAXER)
//  operador      → futuro, permisos granulares (≈ pulse)
//  administrador → cliente, ve sólo su administración (portal)
export type Role = 'gerente' | 'operador' | 'administrador';

export interface CurrentUser {
  id: string;
  email: string;
  role: Role;
  fullName: string | null;
  administracionId: string | null;
}

interface AuthState {
  loading: boolean;
  session: Session | null;
  user: CurrentUser | null;
  configured: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

// Fuente única de verdad del usuario actual (E10): un solo contexto, nada de
// estados de usuario paralelos.
export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<CurrentUser | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }
    let active = true;

    supabase.auth.getSession().then(({ data }) => {
      if (active) {
        setSession(data.session);
        setLoading(false);
      }
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  // El profile (role / administracion) se cargará desde services/api cuando
  // exista la tabla `profiles` (Fase 1). Por ahora derivamos sólo del session.
  useEffect(() => {
    if (!session) {
      setUser(null);
      return;
    }
    setUser({
      id: session.user.id,
      email: session.user.email ?? '',
      role: 'gerente',
      fullName: (session.user.user_metadata?.full_name as string) ?? null,
      administracionId: null,
    });
  }, [session]);

  const signOut = async () => {
    if (isSupabaseConfigured) await supabase.auth.signOut();
    setSession(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider
      value={{ loading, session, user, configured: isSupabaseConfigured, signOut }}
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
