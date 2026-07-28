// ============================================================================
// CertsRetenidosWidget · Dashboard gerencia (DGG-119)
//
// Banner cuando un alumno completó TODAS las condiciones de su curso pero el
// certificado quedó retenido porque el estado de pago de la matrícula no es
// «Pago completo». El gerente resuelve desde el curso (tab Alumnos): cambia
// el estado de pago o acredita la condición — el certificado se emite solo.
// Patrón E-GG-158: la X oculta hasta que aparezca un retenido NUEVO.
// ============================================================================
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Award, ChevronRight, X } from 'lucide-react';
import { listCertsRetenidos, type CertRetenido } from '@/services/api/campus';
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh';
import { useCardDismiss } from '@/hooks/useCardDismiss';

export function CertsRetenidosWidget({ limit = 5 }: { limit?: number }) {
  const [items, setItems] = useState<CertRetenido[]>([]);
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);

  const load = useCallback(async () => {
    const res = await listCertsRetenidos();
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

  // Cambios en condiciones/matrículas/certificados re-fetchean.
  useRealtimeRefresh(['matricula_condiciones', 'curso_matriculas', 'certificados'], load);

  const { dismissedAt, dismiss } = useCardDismiss('gg.dismiss.certsRetenidos');
  const nuevos = items.filter((i) => Date.parse(i.detectado_at) > dismissedAt);

  if (loading || nuevos.length === 0) return null;

  const total = nuevos.length;
  const visibles = nuevos.slice(0, limit);

  return (
    <section className="relative overflow-hidden rounded-2xl border-2 border-orange-300/70 bg-gradient-to-br from-orange-50 via-white to-orange-50/60 p-5 shadow-md animate-fade-in">
      <button
        type="button"
        onClick={dismiss}
        title="Ocultar hasta que haya retenciones nuevas"
        className="absolute right-3 top-3 z-10 rounded-full p-1.5 text-brand-muted transition hover:bg-white hover:text-brand-ink"
      >
        <X size={16} />
      </button>
      <header className="mb-3 flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-orange-100 text-orange-700">
          <Award size={18} />
        </span>
        <div className="min-w-0">
          <p className="kicker text-orange-700">Campus · certificados retenidos</p>
          <h3 className="font-display text-lg font-bold text-brand-ink">
            {total} {total === 1 ? 'certificado espera' : 'certificados esperan'} tu decisión
          </h3>
          <p className="mt-0.5 text-xs text-brand-muted">
            Completaron el curso pero el pago no figura completo. Cambiá el estado
            de pago o acreditá la condición y el certificado se emite solo.
          </p>
        </div>
      </header>

      <ul className="divide-y divide-orange-200/60">
        {visibles.map((i) => (
          <li key={i.matricula_id}>
            <Link
              to={`/gerencia/campus/${i.curso_id}`}
              className="group flex items-center justify-between gap-3 rounded px-1 py-2.5 transition hover:bg-white"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-brand-ink">
                  {i.alumno_nombre ?? 'Alumno'}
                </p>
                <p className="truncate text-xs text-brand-muted">
                  {i.curso_titulo} · pago: {i.estado_pago.replace('_', ' ')}
                </p>
              </div>
              <ChevronRight
                size={16}
                className="shrink-0 text-brand-muted transition group-hover:translate-x-0.5 group-hover:text-orange-600"
              />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
