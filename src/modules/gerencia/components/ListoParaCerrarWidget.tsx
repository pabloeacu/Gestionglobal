// ============================================================================
// ListoParaCerrarWidget · Dashboard gerencia (DGG-153, pedido de Pablo)
//
// "El aviso 'Listo para cerrar' [mail + campanita] también tiene que aparecer
//  como banner en el Inicio, para reforzarlo y que no se nos pase."
//
// CONSIGNA (DGG-235, mig 0626/0627): "listo para cerrar" = alumno EGRESÓ
// (matrícula 'completada' o 'vencida') Y su certificado ya tiene +30 días —
// el MISMO predicado `private.curso_cert_mas30` que usan el agente de cierre
// y el aviso por-alumno (cron `gg-cursos-avisar-listo-cerrar`). Fuente única,
// sin divergencias (E-GG-241). OJO: NO es el mismo gate que el asistente
// "Cerrar y programar" del detalle (TrackingDetailPage), que aparece ya al
// egresar — el cierre MANUAL se permite a criterio del gerente antes de los
// +30d; este banner/agente es la señal de AUTO-cierre. Cada item linkea al
// detalle. Cuando el trámite se cierra, la fila desaparece sola (realtime);
// la aparición al cruzar +30d llega vía el cron de aviso (que escribe la fila).
// `listo_desde` = momento real de elegibilidad (cert+30d), no `updated_at`, para
// que el filtro de novedad (dismiss) no oculte una fila recién lista. Tono
// brand-cyan (birrete). Vacío → no renderiza.
// ============================================================================
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { GraduationCap, ChevronRight, X } from 'lucide-react';
import { fetchListoParaCerrar, type ListoParaCerrarRow } from '@/services/api/dashboard';
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh';
import { useCardDismiss } from '@/hooks/useCardDismiss';

export function ListoParaCerrarWidget({ limit = 6 }: { limit?: number }) {
  const [items, setItems] = useState<ListoParaCerrarRow[]>([]);
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);

  const load = useCallback(async () => {
    const res = await fetchListoParaCerrar();
    if (!mountedRef.current) return;
    setLoading(false);
    if (res.ok) setItems(res.data);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void load();
    return () => {
      mountedRef.current = false;
    };
  }, [load]);

  // Realtime: la matrícula pasa a 'vencida' (cron de vencimiento) o el gerente
  // cierra el trámite → re-fetch para que el banner aparezca/desaparezca solo.
  useRealtimeRefresh(['curso_matriculas', 'tramites'], load);

  // La X oculta el card hasta que aparezca un alumno NUEVO listo para cerrar.
  const { dismissedAt, dismiss } = useCardDismiss('gg.dismiss.listoParaCerrar');
  const nuevos = items.filter((i) => Date.parse(i.listo_desde) > dismissedAt);

  if (loading || nuevos.length === 0) return null;

  const total = nuevos.length;
  const visibles = nuevos.slice(0, limit);

  return (
    <section className="relative overflow-hidden rounded-2xl border-2 border-brand-cyan/40 bg-gradient-to-br from-brand-cyan/10 via-white to-brand-cyan/5 p-5 shadow-md animate-fade-in">
      <button
        type="button"
        onClick={dismiss}
        title="Ocultar hasta que haya un nuevo alumno listo para cerrar"
        className="absolute right-3 top-3 z-10 rounded-full p-1.5 text-brand-muted transition hover:bg-white hover:text-brand-ink"
      >
        <X size={16} />
      </button>
      <header data-gg-plain className="mb-3 flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-cyan/15 text-brand-cyan">
          <GraduationCap size={18} />
        </span>
        <div className="min-w-0">
          <p className="kicker text-brand-cyan">Cursos · listos para cerrar</p>
          <h3 className="font-display text-lg font-bold text-brand-ink">
            <span key={total} className="inline-block animate-fade-in tabular">
              {total}
            </span>{' '}
            {total === 1 ? 'alumno listo para cerrar' : 'alumnos listos para cerrar'}
          </h3>
          <p className="mt-0.5 text-xs text-brand-muted">
            Terminaron el curso y su plazo de gracia finalizó. Cerrá el trámite y programá el próximo
            vencimiento desde el detalle.
          </p>
        </div>
      </header>

      <ul className="divide-y divide-brand-cyan/15">
        {visibles.map((i) => (
          <li key={i.matricula_id}>
            <Link
              to={`/gerencia/trackings/${i.tramite_id}`}
              className="group flex items-center justify-between gap-3 rounded px-1 py-2.5 transition hover:bg-white"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-brand-ink">{i.cliente_nombre}</p>
                <p className="truncate text-xs text-brand-muted">
                  {i.curso_titulo ?? 'Curso'}
                  {i.matricula_estado === 'vencida' ? ' · plazo de gracia finalizado' : ''}
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

      {total > visibles.length && (
        <p className="mt-3 text-xs font-medium text-brand-cyan">
          y {total - visibles.length} más…
        </p>
      )}
    </section>
  );
}
