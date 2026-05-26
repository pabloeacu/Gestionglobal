import type { ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from './Button';
import { useLoadingTimeout } from '@/hooks/useLoadingTimeout';

interface SkeletonWithTimeoutProps {
  /** Si está en true se muestra el skeleton; cuando llega al timeout se muestra la card de "tardando". */
  loading: boolean;
  /** Default 8s — ver useLoadingTimeout. */
  timeoutMs?: number;
  /** Callback para el botón "Reintentar". Si no se pasa, el botón se oculta. */
  onRetry?: () => void;
  /** UI alternativa cuando el skeleton venció el timeout. Si se omite, se usa la card estándar. */
  fallback?: ReactNode;
  /** Skeleton(s) que se renderizan mientras está cargando dentro de los tiempos esperados. */
  children: ReactNode;
}

/**
 * P2 #4 · Wrapper para skeletons que muestra un mensaje "Está tardando más
 * de lo normal" + botón "Reintentar" cuando la carga supera el timeout.
 *
 * Uso:
 *   <SkeletonWithTimeout loading={loading} onRetry={refetch}>
 *     <Skeleton className="h-12" />
 *   </SkeletonWithTimeout>
 */
export function SkeletonWithTimeout({
  loading,
  timeoutMs = 8000,
  onRetry,
  fallback,
  children,
}: SkeletonWithTimeoutProps) {
  const isStale = useLoadingTimeout(loading, timeoutMs);

  if (!loading) return null;

  if (isStale) {
    if (fallback) return <>{fallback}</>;
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50/60 p-6 text-center">
        <AlertTriangle size={20} className="text-amber-600" />
        <div className="space-y-1">
          <p className="text-sm font-medium text-amber-900">
            Está tardando más de lo normal
          </p>
          <p className="text-xs text-amber-800/80">
            Puede ser una red lenta o el servidor está respondiendo despacio.
          </p>
        </div>
        {onRetry && (
          <Button variant="secondary" onClick={onRetry} className="px-3 py-1.5 text-xs">
            <RefreshCw size={13} /> Reintentar
          </Button>
        )}
      </div>
    );
  }

  return <>{children}</>;
}
