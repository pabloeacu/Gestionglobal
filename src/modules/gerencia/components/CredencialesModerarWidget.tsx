// ============================================================================
// CredencialesModerarWidget · Dashboard gerencia (DGG-275 F1)
//
// Recordatorio PERSISTENTE de credenciales de portales (DDJJ) que la gestoría
// propuso y esperan moderación. A diferencia de AportesGestoriaWidget (novedades
// EN VIVO, ocultables), este banner NO se puede ocultar: se mantiene visible
// mientras HAYA algo pendiente, porque una credencial sin publicar deja al
// cliente sin acceso. "Gerencia siempre atenta a lo que requiere su atención"
// (pedido de Pablo). El aviso push/mail/campanita lo dispara la propuesta
// (mig 0748); este widget es el backstop de cola que no desaparece.
//   · Vacío → no renderiza nada.
//   · Activo → banner con contador + lista, cada fila linkea a Moderación.
// ============================================================================
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { KeyRound, ChevronRight } from 'lucide-react';
import {
  fetchCredencialModeracionPendientes,
  type CredencialModeracionPendiente,
} from '@/services/api/ddjj';
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh';

export function CredencialesModerarWidget({ limit = 5 }: { limit?: number }) {
  const [creds, setCreds] = useState<CredencialModeracionPendiente[]>([]);
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);

  const load = useCallback(async () => {
    const res = await fetchCredencialModeracionPendientes();
    if (!mountedRef.current) return;
    setLoading(false);
    if (res.ok) setCreds(res.data);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void load();
    return () => {
      mountedRef.current = false;
    };
  }, [load]);

  // Las credenciales no tienen realtime propio (store con RLS deny-all, fuera de
  // la publicación). Se refresca al montar (cada vez que se vuelve al Inicio) y,
  // de paso, cuando entra cualquier novedad de gestoría (tracking_lineas).
  useRealtimeRefresh(['tracking_lineas'], load);

  if (loading || creds.length === 0) return null;

  const total = creds.length;
  const visibles = creds.slice(0, limit);

  return (
    <section
      className="relative overflow-hidden rounded-2xl border-2 border-brand-cyan-pale/70 bg-gradient-to-br from-brand-cyan-pale/30 via-white to-brand-cyan-pale/20 p-5 shadow-md animate-fade-in"
    >
      <header data-gg-plain className="mb-3 flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-cyan-pale/60 text-brand-cyan">
          <KeyRound size={18} />
        </span>
        <div className="min-w-0">
          <p className="kicker text-brand-cyan">Portales de DDJJ · pendiente</p>
          <h3 className="font-display text-lg font-bold text-brand-ink">
            <span className="tabular">{total}</span>{' '}
            {total === 1 ? 'credencial para revisar' : 'credenciales para revisar'}
          </h3>
          <p className="mt-0.5 text-xs text-brand-muted">
            La gestoría informó accesos de portales. Revisalos y publicá lo que ve el cliente.
          </p>
        </div>
      </header>

      <ul className="divide-y divide-brand-cyan-pale/50">
        {visibles.map((c) => (
          <li key={`cred:${c.administracionId}:${c.plataforma}`}>
            <Link
              to="/gerencia/moderacion"
              className="group flex items-center justify-between gap-3 rounded px-1 py-2.5 transition hover:bg-white"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-brand-ink">
                  {c.adminNombre ?? 'Cliente'}
                  <span className="text-brand-muted">
                    {' '}· Credenciales {c.plataforma === 'ddjj' ? 'DDJJ' : 'ARCA'}
                  </span>
                </p>
                <p className="truncate text-xs text-brand-muted">
                  {c.propPor ? `${c.propPor} · ` : ''}
                  {c.actualUsuario || c.actualTienePassword
                    ? 'Actualización propuesta'
                    : 'Credenciales nuevas'}
                </p>
              </div>
              <ChevronRight
                size={16}
                className="shrink-0 text-brand-muted transition group-hover:translate-x-0.5 group-hover:text-brand-cyan"
              />
            </Link>
          </li>
        ))}
      </ul>

      <Link
        to="/gerencia/moderacion"
        className="mt-3 inline-block text-xs font-medium text-brand-cyan hover:underline"
      >
        Ir a Moderación{total > visibles.length ? ` (${total})` : ''} →
      </Link>
    </section>
  );
}
