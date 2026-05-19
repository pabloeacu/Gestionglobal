import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/common';

// Placeholder del portal de administradores clientes (punto 8.3 del
// Documento Maestro). Se construye en Fase 2.
export function PortalHome() {
  const { user, signOut } = useAuth();
  return (
    <div className="min-h-screen bg-white p-8">
      <div className="mx-auto max-w-3xl">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <p className="kicker">Portal del administrador</p>
            <h1 className="text-2xl font-bold text-brand-ink">
              {user?.email}
            </h1>
          </div>
          <Button variant="secondary" onClick={() => void signOut()}>
            Salir
          </Button>
        </div>
        <div className="card-premium p-6 text-sm text-brand-muted">
          Portal en construcción. Acá verás tus servicios, trámites, cuenta
          corriente y documentación.
        </div>
      </div>
    </div>
  );
}
