// NovedadesBanner · banner de noticias/novedades enviadas por gerencia.
// Aparece en PortalHome cuando hay comunicaciones vigentes no vistas para
// el administrador logueado. Se descarta marcándolo visto.
//
// Reglas: 4 (API en services/), 13 (no window.confirm).

import { useCallback, useEffect, useState } from 'react';
import { Megaphone, X, ArrowRight, AlertCircle, Info, Sparkles, Bell } from 'lucide-react';
import { toast } from '@/lib/toast';
import {
  listNovedadesCliente,
  marcarNovedadVista,
  type NovedadCliente,
} from '@/services/api/comunicaciones';

const ICONS = {
  info: Info,
  novedad: Sparkles,
  aviso: Bell,
  urgente: AlertCircle,
} as const;

const STYLES = {
  info: {
    container: 'from-slate-50 via-white to-slate-50 ring-slate-200',
    icon: 'bg-slate-100 text-slate-600',
    badge: 'bg-slate-100 text-slate-700',
  },
  novedad: {
    container: 'from-cyan-50 via-white to-amber-50 ring-cyan-200',
    icon: 'bg-cyan-100 text-cyan-700',
    badge: 'bg-cyan-100 text-cyan-700',
  },
  aviso: {
    container: 'from-amber-50 via-white to-amber-50 ring-amber-200',
    icon: 'bg-amber-100 text-amber-700',
    badge: 'bg-amber-100 text-amber-800',
  },
  urgente: {
    container: 'from-rose-50 via-white to-rose-50 ring-rose-200',
    icon: 'bg-rose-100 text-rose-700',
    badge: 'bg-rose-100 text-rose-800',
  },
} as const;

const LABEL = {
  info: 'Informativo',
  novedad: 'Novedad',
  aviso: 'Aviso',
  urgente: 'Urgente',
} as const;

export function NovedadesBanner() {
  const [items, setItems] = useState<NovedadCliente[]>([]);
  const [dismissing, setDismissing] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await listNovedadesCliente();
    if (res.ok) {
      // Sólo mostramos las que aún no vio.
      setItems(res.data.filter((n) => !n.visto_at));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function dismiss(id: string) {
    setDismissing(id);
    const res = await marcarNovedadVista(id);
    setDismissing(null);
    if (!res.ok) {
      toast.error(`No se pudo cerrar: ${res.error.message}`);
      return;
    }
    setItems((prev) => prev.filter((n) => n.id !== id));
  }

  if (items.length === 0) return null;

  return (
    <div className="space-y-2">
      {items.map((n) => {
        const style = STYLES[n.banner_estilo];
        const Icon = ICONS[n.banner_estilo];
        return (
          <div
            key={n.id}
            className={`relative overflow-hidden rounded-2xl bg-gradient-to-br p-4 shadow-sm ring-1 sm:p-5 ${style.container}`}
          >
            <button
              type="button"
              onClick={() => void dismiss(n.id)}
              disabled={dismissing === n.id}
              aria-label="Cerrar"
              className="absolute right-3 top-3 rounded-lg p-1.5 text-slate-400 transition hover:bg-white/60 hover:text-slate-700"
            >
              <X size={16} />
            </button>

            <div className="flex items-start gap-3 pr-7">
              <div className={`shrink-0 rounded-xl p-2.5 ${style.icon}`}>
                <Icon size={18} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${style.badge}`}>
                    {LABEL[n.banner_estilo]}
                  </span>
                  <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-slate-500">
                    <Megaphone size={10} /> Gerencia
                  </span>
                </div>
                <h3 className="text-base font-bold text-slate-900 sm:text-lg">{n.titulo}</h3>
                <p className="mt-1 whitespace-pre-line text-sm text-slate-700">
                  {n.cuerpo_md}
                </p>
                {n.cta_label && n.cta_url && (
                  <a
                    href={n.cta_url}
                    target={n.cta_url.startsWith('http') ? '_blank' : undefined}
                    rel={n.cta_url.startsWith('http') ? 'noopener noreferrer' : undefined}
                    className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-slate-700"
                  >
                    {n.cta_label}
                    <ArrowRight size={14} />
                  </a>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
