// ============================================================================
// AportesGestoriaWidget · Dashboard gerencia (E-GG-91, reporte JL)
//
// "El aporte de gestoría no lo informa en el inicio, sólo en la campanita o
//  ingresando al trámite." → banner en el inicio, EN TIEMPO REAL, cuando la
// gestoría externa manda un aporte pendiente de moderación. Mismo patrón que
// NuevasSolicitudesWidget (F7/DGG-62) pero tono violeta para distinguirlo.
//   · Vacío  → no renderiza nada (NuevasSolicitudes ya muestra el "todo al día").
//   · Activo → banner con el contador y la lista, cada uno linkea a su trámite;
//     "Ver todos" va a la cola de Moderación.
// ============================================================================
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ClipboardCheck, ChevronRight, X, KeyRound } from 'lucide-react';
import { fetchModeracionPendientes, type ModeracionPendiente } from '@/services/api/trackings';
import { fetchCredencialModeracionPendientes, type CredencialModeracionPendiente } from '@/services/api/ddjj';
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh';
import { useCardDismiss } from '@/hooks/useCardDismiss';

export function AportesGestoriaWidget({ limit = 5 }: { limit?: number }) {
  const [items, setItems] = useState<ModeracionPendiente[]>([]);
  // DGG-243 F2b · las propuestas de credenciales de portales (DDJJ) también son
  // "pendientes de moderación" → deben verse en el inicio (fan-out §6-a: que no
  // quede un pendiente invisible).
  const [creds, setCreds] = useState<CredencialModeracionPendiente[]>([]);
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);

  const load = useCallback(async () => {
    const [res, resCred] = await Promise.all([
      fetchModeracionPendientes(),
      fetchCredencialModeracionPendientes(),
    ]);
    if (!mountedRef.current) return;
    setLoading(false);
    if (res.ok) setItems(res.data);
    if (resCred.ok) setCreds(resCred.data);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void load();
    return () => {
      mountedRef.current = false;
    };
  }, [load]);

  // Tiempo real: cuando entra/cambia un aporte del gestor (tracking_lineas) se
  // re-fetchea (y de paso re-trae las credenciales a moderar). Las propuestas de
  // credenciales NO tienen realtime propio (store con RLS deny-all, fuera de la
  // publicación) → se ven al cargar o cuando llega cualquier otra novedad de gestoría.
  useRealtimeRefresh(['tracking_lineas'], load);

  // Vacío o cargando → no ocupa espacio (el widget de solicitudes ya da el
  // "todo al día"; no queremos dos barras).
  // E-GG-158 · la X oculta el card hasta que llegue un aporte NUEVO del gestor.
  const { dismissedAt, dismiss } = useCardDismiss('gg.dismiss.aportesGestoria');
  const nuevos = items.filter((a) => Date.parse(a.created_at) > dismissedAt);
  const nuevosCreds = creds.filter((c) => !!c.propAt && Date.parse(c.propAt) > dismissedAt);

  if (loading || (nuevos.length === 0 && nuevosCreds.length === 0)) return null;

  const total = nuevos.length + nuevosCreds.length;
  // Las credenciales van primero (sensibles); los aportes completan hasta el límite.
  const credsVisibles = nuevosCreds.slice(0, limit);
  const visibles = nuevos.slice(0, Math.max(0, limit - credsVisibles.length));

  return (
    <section className="relative overflow-hidden rounded-2xl border-2 border-violet-300/70 bg-gradient-to-br from-violet-50 via-white to-violet-50/60 p-5 shadow-md animate-fade-in">
      <button
        type="button"
        onClick={dismiss}
        title="Ocultar hasta que haya aportes nuevos"
        className="absolute right-3 top-3 z-10 rounded-full p-1.5 text-brand-muted transition hover:bg-white hover:text-brand-ink"
      >
        <X size={16} />
      </button>
      <header data-gg-plain className="mb-3 flex items-start gap-3">
        <span className="relative grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-violet-100 text-violet-700">
          <ClipboardCheck size={18} />
          <span className="absolute -right-0.5 -top-0.5 flex h-3 w-3">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-violet-400 opacity-75" />
            <span className="relative inline-flex h-3 w-3 rounded-full bg-violet-500 ring-2 ring-white" />
          </span>
        </span>
        <div className="min-w-0">
          <p className="kicker text-violet-700">Gestoría externa · en vivo</p>
          <h3 className="font-display text-lg font-bold text-brand-ink">
            <span key={total} className="inline-block animate-fade-in tabular">
              {total}
            </span>{' '}
            {total === 1 ? 'novedad para revisar' : 'novedades para revisar'}
          </h3>
          <p className="mt-0.5 text-xs text-brand-muted">
            La gestoría mandó novedades. Revisá y publicá lo que ve el cliente.
          </p>
        </div>
      </header>

      <ul className="divide-y divide-violet-200/60">
        {credsVisibles.map((c) => (
          <li key={`cred:${c.administracionId}:${c.plataforma}`}>
            <Link
              to="/gerencia/moderacion"
              className="group flex items-center justify-between gap-3 rounded px-1 py-2.5 transition hover:bg-white"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-brand-ink">
                  <KeyRound size={12} className="mr-1 inline text-brand-cyan" />
                  {c.adminNombre ?? 'Cliente'}
                  <span className="text-brand-muted"> · Credenciales {c.plataforma === 'ddjj' ? 'DDJJ' : 'ARCA'}</span>
                </p>
                <p className="truncate text-xs text-brand-muted">
                  {c.propPor ? `${c.propPor} · ` : ''}
                  {c.actualUsuario || c.actualTienePassword ? 'Actualización propuesta' : 'Credenciales nuevas'}
                </p>
              </div>
              <ChevronRight
                size={16}
                className="shrink-0 text-brand-muted transition group-hover:translate-x-0.5 group-hover:text-violet-600"
              />
            </Link>
          </li>
        ))}
        {visibles.map((a) => (
          <li key={a.linea_id}>
            <Link
              to={`/gerencia/trackings/${a.tramite_id}`}
              className="group flex items-center justify-between gap-3 rounded px-1 py-2.5 transition hover:bg-white"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-brand-ink">
                  {a.cliente_nombre ?? a.tramite_codigo}
                  {a.servicio_nombre ? ` · ${a.servicio_nombre}` : ''}
                </p>
                <p className="truncate text-xs text-brand-muted">
                  {a.gestor_label ? `${a.gestor_label} · ` : ''}
                  {a.descripcion}
                </p>
              </div>
              <ChevronRight
                size={16}
                className="shrink-0 text-brand-muted transition group-hover:translate-x-0.5 group-hover:text-violet-600"
              />
            </Link>
          </li>
        ))}
      </ul>

      <Link
        to="/gerencia/moderacion"
        className="mt-3 inline-block text-xs font-medium text-violet-700 hover:underline"
      >
        Ir a Moderación{total > credsVisibles.length + visibles.length ? ` (${total})` : ''} →
      </Link>
    </section>
  );
}
