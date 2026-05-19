import { useAuth, type CurrentUser } from '@/contexts/AuthContext';

// Único acceso al usuario actual en toda la app (E10). Si necesitás el rol,
// derivá de acá; nunca crees un segundo estado de usuario.
export function useCurrentUser(): CurrentUser | null {
  return useAuth().user;
}
