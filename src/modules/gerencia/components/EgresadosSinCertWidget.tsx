// ============================================================================
// EgresadosSinCertWidget · Dashboard gerencia (DGG-166, pedido de Pablo)
//
// "Para los cursos que NO tengan configurada la extensión automática del
//  certificado (p. ej. CABA, cuya certificación depende de terceros), cuando un
//  alumno egresa hay que avisar a gerencia por banner + push + mail para
//  gestionarlo por afuera."
//
// Espejo del patrón ListoParaCerrarWidget. El push+mail+campanita los dispara el
// trigger `trg_matricula_condiciones_avisar_egreso` (mig 0471); este banner es el
// refuerzo persistente en el Inicio. Lista los egresados (todas las condiciones
// cumplidas) de cursos con `cert_emite_auto=false` sin certificado emitido. Cada
// item linkea a la pestaña Alumnos del curso, donde gerencia emite el cert a mano.
// Cuando el gerente emite el certificado, la fila desaparece sola (realtime).
// Tono ámbar (acción pendiente). Vacío → no renderiza.
// ============================================================================
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Award, ChevronRight, X } from 'lucide-react';
import { fetchEgresadosSinCert, type EgresadoSinCertRow } from '@/services/api/dashboard';
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh';
import { useCardDismiss } from '@/hooks/useCardDismiss';

export function EgresadosSinCertWidget({ limit = 6 }: { limit?: number }) {
  const [items, setItems] = useState<EgresadoSinCertRow[]>([]);
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);

  const load = useCallback(async () => {
    const res = await fetchEgresadosSinCert();
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

  // Realtime: el alumno cumple la última condición (egresa) o el gerente emite el
  // certificado → re-fetch para que el banner aparezca/desaparezca solo.
  useRealtimeRefresh(['matricula_condiciones', 'curso_matriculas', 'certificados'], load);

  // La X oculta el card hasta que aparezca un egresado NUEVO.
  const { dismissedAt, dismiss } = useCardDismiss('gg.dismiss.egresadosSinCert');
  const nuevos = items.filter((i) => Date.parse(i.egreso_desde) > dismissedAt);

  if (loading || nuevos.length === 0) return null;

  const total = nuevos.length;
  const visibles = nuevos.slice(0, limit);

  return (
    <section className="relative overflow-hidden rounded-2xl border-2 border-amber-300 bg-gradient-to-br from-amber-50 via-white to-amber-50/40 p-5 shadow-md animate-fade-in">
      <button
        type="button"
        onClick={dismiss}
        title="Ocultar hasta que haya un nuevo egresado por certificar"
        className="absolute right-3 top-3 z-10 rounded-full p-1.5 text-brand-muted transition hover:bg-white hover:text-brand-ink"
      >
        <X size={16} />
      </button>
      <header data-gg-plain className="mb-3 flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-amber-100 text-amber-700">
          <Award size={18} />
        </span>
        <div className="min-w-0">
          <p className="kicker text-amber-700">Cursos · certificado a gestionar</p>
          <h3 className="font-display text-lg font-bold text-brand-ink">
            <span key={total} className="inline-block animate-fade-in tabular">
              {total}
            </span>{' '}
            {total === 1 ? 'egresado sin certificado automático' : 'egresados sin certificado automático'}
          </h3>
          <p className="mt-0.5 text-xs text-brand-muted">
            Completaron todas las condiciones, pero el curso no emite el certificado solo. Es tiempo de
            gestionarlo para completar la graduación.
          </p>
        </div>
      </header>

      <ul className="divide-y divide-amber-200/60">
        {visibles.map((i) => (
          <li key={i.matricula_id}>
            <Link
              to={`/gerencia/campus/${i.curso_id}`}
              className="group flex items-center justify-between gap-3 rounded px-1 py-2.5 transition hover:bg-white"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-brand-ink">{i.alumno_nombre}</p>
                <p className="truncate text-xs text-brand-muted">{i.curso_titulo ?? 'Curso'}</p>
              </div>
              <ChevronRight
                size={16}
                className="shrink-0 text-brand-muted transition group-hover:translate-x-0.5 group-hover:text-amber-700"
              />
            </Link>
          </li>
        ))}
      </ul>

      {total > visibles.length && (
        <p className="mt-3 text-xs font-medium text-amber-700">y {total - visibles.length} más…</p>
      )}
    </section>
  );
}
