import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/common';

// Placeholder del panel de socios gerentes. El dashboard ejecutivo real
// (punto 22 del Documento Maestro) se construye en fase posterior.
export function GerenciaHome() {
  const { user, signOut } = useAuth();
  return (
    <div className="min-h-screen bg-brand-zebra p-8">
      <div className="mx-auto max-w-4xl">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <p className="kicker">Panel de gerencia</p>
            <h1 className="text-2xl font-bold text-brand-ink">
              Hola{user?.fullName ? `, ${user.fullName}` : ''}
            </h1>
          </div>
          <Button variant="secondary" onClick={() => void signOut()}>
            Salir
          </Button>
        </div>
        <div className="card-premium p-6 text-sm text-brand-muted">
          Esqueleto listo. Fase 1: clientes, facturación y cuenta corriente.
        </div>
      </div>
    </div>
  );
}
