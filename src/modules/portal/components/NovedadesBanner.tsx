// NovedadesBanner · banner de noticias/novedades enviadas por gerencia.
// Aparece en PortalHome cuando hay comunicaciones vigentes no vistas para
// el administrador logueado. Se descarta marcándolo visto.
//
// DGG-230: una comunicación puede traer `imagen_url`. En ese caso el banner,
// en vez de navegar a un cta_url, abre un MODAL con la imagen (ventana
// emergente). Además:
//   • auto-popup: la primera vez que el cliente entra al portal y hay un
//     comunicado-con-imagen aún no visto, el modal se abre solo (1 sola vez
//     por dispositivo, guard en localStorage). La X del banner lo descarta de
//     verdad (visto_at en DB, cross-device).
//   • deep-link: campanita y push llevan a /portal?comunicado=<id>; acá se lee
//     ese query param y se abre el mismo modal (sirva o no el auto-popup, y aun
//     si el cliente ya cerró el banner).
//
// Reglas: 4 (API en services/), 13 (no window.confirm).

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Megaphone,
  X,
  ArrowRight,
  AlertCircle,
  Info,
  Sparkles,
  Bell,
  ShieldCheck,
} from 'lucide-react';
import { toast } from '@/lib/toast';
import { Modal, Button } from '@/components/common';
import {
  listNovedadesCliente,
  marcarNovedadVista,
  type NovedadCliente,
} from '@/services/api/comunicaciones';
import { humanizeError } from '@/lib/errors';

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

// localStorage: guard efímero por-dispositivo para no auto-abrir el modal más de
// una vez. NO es el "dismiss" (eso vive en DB vía visto_at). Envuelto en
// try/catch porque puede fallar en modo privado / storage bloqueado.
const autoShownKey = (id: string) => `gg_comunicado_autoshown_${id}`;
function yaAutoMostrado(id: string): boolean {
  try {
    return localStorage.getItem(autoShownKey(id)) === '1';
  } catch {
    return false;
  }
}
function marcarAutoMostrado(id: string) {
  try {
    localStorage.setItem(autoShownKey(id), '1');
  } catch {
    /* noop */
  }
}

export function NovedadesBanner() {
  const [items, setItems] = useState<NovedadCliente[]>([]);
  const [dismissing, setDismissing] = useState<string | null>(null);
  const [modalItem, setModalItem] = useState<NovedadCliente | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const autoTriedRef = useRef(false);

  const load = useCallback(async () => {
    const res = await listNovedadesCliente();
    if (res.ok) {
      // Guardamos TODAS las vigentes (incluso las ya vistas) para poder
      // resolver el deep-link ?comunicado=<id> aunque el cliente ya haya
      // cerrado el banner. El filtro de "no vistas" se aplica sólo al banner.
      setItems(res.data);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Auto-popup: 1 sola vez por dispositivo, si hay un comunicado-con-imagen aún
  // no visto. Si viene un deep-link en la URL, lo maneja el otro efecto.
  useEffect(() => {
    if (autoTriedRef.current) return;
    if (items.length === 0) return;
    autoTriedRef.current = true;
    if (searchParams.get('comunicado')) return;
    const img = items.find(
      (n) => n.imagen_url && !n.visto_at && !yaAutoMostrado(n.id),
    );
    if (img) {
      setModalItem(img);
      marcarAutoMostrado(img.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  // Deep-link: /portal?comunicado=<id> abre el modal de esa comunicación.
  // Reacciona a cambios del query param (la campanita navega por SPA).
  useEffect(() => {
    const comId = searchParams.get('comunicado');
    if (!comId) return;
    const target = items.find((n) => n.id === comId && n.imagen_url);
    if (target) setModalItem(target);
  }, [searchParams, items]);

  async function dismiss(id: string) {
    setDismissing(id);
    const res = await marcarNovedadVista(id);
    setDismissing(null);
    if (!res.ok) {
      toast.error(`No se pudo cerrar: ${humanizeError(res.error)}`);
      return;
    }
    setItems((prev) =>
      prev.map((n) => (n.id === id ? { ...n, visto_at: new Date().toISOString() } : n)),
    );
  }

  function closeModal() {
    setModalItem(null);
    if (searchParams.get('comunicado')) {
      const next = new URLSearchParams(searchParams);
      next.delete('comunicado');
      setSearchParams(next, { replace: true });
    }
  }

  const bannerItems = items.filter((n) => !n.visto_at);

  if (bannerItems.length === 0 && !modalItem) return null;

  return (
    <>
      {bannerItems.length > 0 && (
        <div className="space-y-2">
          {bannerItems.map((n) => {
            const style = STYLES[n.banner_estilo];
            const Icon = ICONS[n.banner_estilo];
            const esImagen = !!n.imagen_url;
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
                    {esImagen ? (
                      <button
                        type="button"
                        onClick={() => setModalItem(n)}
                        className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-slate-700"
                      >
                        {n.cta_label || 'Ver comunicado'}
                        <ArrowRight size={14} />
                      </button>
                    ) : (
                      n.cta_label &&
                      n.cta_url && (
                        <a
                          href={n.cta_url}
                          target={n.cta_url.startsWith('http') ? '_blank' : undefined}
                          rel={n.cta_url.startsWith('http') ? 'noopener noreferrer' : undefined}
                          className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-slate-700"
                        >
                          {n.cta_label}
                          <ArrowRight size={14} />
                        </a>
                      )
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {modalItem?.imagen_url && (
        <Modal
          open={!!modalItem}
          onClose={closeModal}
          width={820}
          kicker="Comunicado oficial"
          title={modalItem.titulo}
          icon={<ShieldCheck size={18} />}
          footer={
            <Button variant="primary" onClick={closeModal}>
              Entendido
            </Button>
          }
        >
          {modalItem.cuerpo_md && (
            <p className="mb-4 whitespace-pre-line text-sm text-brand-muted">
              {modalItem.cuerpo_md}
            </p>
          )}
          <img
            src={modalItem.imagen_url}
            alt={modalItem.titulo}
            className="w-full rounded-xl ring-1 ring-slate-200"
          />
        </Modal>
      )}
    </>
  );
}
