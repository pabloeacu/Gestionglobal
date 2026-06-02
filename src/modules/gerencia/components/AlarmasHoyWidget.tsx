// ============================================================================
// AlarmasHoyWidget · Bloque A (obs 5)
//
// Muestra las alarmas de tracking que vencen hoy o están vencidas. Con botón
// "Postergar" rápido (3 / 5 / 10 días hábiles) para reprogramar in-line sin
// salir del dashboard.
// ============================================================================
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bell, Clock, AlertTriangle, ChevronRight, Loader2 } from 'lucide-react';
import { Skeleton } from '@/components/common';
import { toast } from '@/lib/toast';
import { humanizeError } from '@/lib/errors';
import { listarAlarmasHoy } from '@/services/api/dashboard';
import { postergarAlarmaLinea } from '@/services/api/trackings';

interface AlarmaHoy {
  linea_id: string;
  tramite_id: string;
  tramite_codigo: string;
  tramite_titulo: string;
  categoria: string;
  descripcion: string;
  alerta_en: string;
  vencida: boolean;
  postergada_veces: number;
}

export function AlarmasHoyWidget() {
  const [items, setItems] = useState<AlarmaHoy[]>([]);
  const [loading, setLoading] = useState(true);
  const [postergandoId, setPostergandoId] = useState<string | null>(null);

  async function cargar() {
    setLoading(true);
    const res = await listarAlarmasHoy();
    setLoading(false);
    if (!res.ok) {
      console.warn('alarmas_hoy', res.error.message);
      return;
    }
    setItems(res.data as unknown as AlarmaHoy[]);
  }

  useEffect(() => {
    void cargar();
  }, []);

  async function postergar(lineaId: string, dias: number) {
    setPostergandoId(lineaId);
    const res = await postergarAlarmaLinea(lineaId, dias);
    setPostergandoId(null);
    if (!res.ok) {
      toast.error('No pudimos postergar', { description: humanizeError(res.error) });
      return;
    }
    toast.success(`Postergada +${dias} días hábiles`);
    void cargar();
  }

  if (loading) {
    return (
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <Skeleton className="mb-3 h-6 w-40 rounded" />
        <div className="space-y-2">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-12 rounded-lg" />
          ))}
        </div>
      </section>
    );
  }

  const vencidas = items.filter((i) => i.vencida).length;
  const hoy = items.length - vencidas;

  if (items.length === 0) {
    return (
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <header className="mb-3 flex items-center justify-between">
          <div>
            <p className="kicker text-brand-cyan">Alarmas de hoy</p>
            <h3 className="font-display text-lg font-bold text-brand-ink">
              Sin pendientes para hoy
            </h3>
          </div>
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-50 text-emerald-600">
            <Bell size={18} />
          </span>
        </header>
        <p className="text-sm text-brand-muted">
          No hay seguimientos vencidos ni que cierren hoy.
        </p>
      </section>
    );
  }

  return (
    <section
      className={`relative overflow-hidden rounded-2xl border-2 p-5 shadow-sm ${
        vencidas > 0
          ? 'border-rose-300/60 bg-gradient-to-br from-rose-50 via-white to-rose-50/60'
          : 'border-amber-300/60 bg-gradient-to-br from-amber-50 via-white to-amber-50/60'
      }`}
    >
      <header className="mb-3 flex items-center justify-between">
        <div>
          <p
            className={`kicker ${vencidas > 0 ? 'text-rose-700' : 'text-amber-700'}`}
          >
            Alarmas de hoy
          </p>
          <h3 className="font-display text-lg font-bold text-brand-ink">
            {vencidas > 0
              ? `${vencidas} ${vencidas === 1 ? 'vencida' : 'vencidas'}`
              : ''}
            {vencidas > 0 && hoy > 0 ? ' · ' : ''}
            {hoy > 0
              ? `${hoy} ${hoy === 1 ? 'para hoy' : 'para hoy'}`
              : ''}
          </h3>
          <p className="mt-0.5 text-xs text-brand-muted">
            Postergá o entrá al trámite a resolverlas.
          </p>
        </div>
        <span
          className={`grid h-10 w-10 place-items-center rounded-xl ${
            vencidas > 0
              ? 'bg-rose-100 text-rose-700'
              : 'bg-amber-100 text-amber-700'
          }`}
        >
          {vencidas > 0 ? <AlertTriangle size={18} /> : <Bell size={18} />}
        </span>
      </header>

      <ul className="divide-y divide-slate-200/60">
        {items.map((a) => (
          <li key={a.linea_id} className="py-2.5">
            <div className="flex items-start justify-between gap-3">
              <Link
                to={`/gestion/tracking/${a.tramite_id}`}
                className="group min-w-0 flex-1"
              >
                <div className="flex items-center gap-1.5">
                  {a.vencida && (
                    <span className="inline-flex items-center gap-0.5 rounded-full bg-rose-200 px-1.5 py-0.5 text-[10px] font-bold uppercase text-rose-800">
                      <Clock size={9} /> Vencida
                    </span>
                  )}
                  <p className="truncate text-sm font-medium text-brand-ink group-hover:text-brand-cyan">
                    {a.tramite_titulo}
                  </p>
                </div>
                <p className="mt-0.5 truncate text-xs text-brand-muted">
                  <span className="font-mono">{a.tramite_codigo}</span> ·{' '}
                  {a.descripcion.slice(0, 100)}
                  {a.descripcion.length > 100 ? '…' : ''}
                  {a.postergada_veces > 0 && (
                    <span className="ml-1 italic text-amber-700">
                      · postergada {a.postergada_veces}x
                    </span>
                  )}
                </p>
              </Link>
              <div className="flex shrink-0 items-center gap-1">
                {postergandoId === a.linea_id ? (
                  <Loader2 className="h-3 w-3 animate-spin text-brand-muted" />
                ) : (
                  <>
                    {[3, 5, 10].map((d) => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => void postergar(a.linea_id, d)}
                        className="rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-brand-ink hover:border-brand-cyan hover:text-brand-cyan"
                        title={`Postergar ${d} días hábiles`}
                      >
                        +{d}d
                      </button>
                    ))}
                  </>
                )}
                <ChevronRight
                  size={12}
                  className="ml-0.5 text-brand-muted"
                />
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
