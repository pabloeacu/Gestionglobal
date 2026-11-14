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
import { PremiumBanner, premiumCtaClass, type BannerTone } from './premiumBanner';

const ICONS = {
  info: Info,
  novedad: Sparkles,
  aviso: Bell,
  urgente: AlertCircle,
} as const;

// DGG-254 · tono premium marca-nativa por estilo de comunicación.
// DGG-254-b: info/novedad usan el tono 'novedad' (violeta) — propio de las
// comunicaciones de gerencia — para no confundirse con la agenda (brand) ni con
// los assistants (cielo) cuando conviven en el inicio. aviso=alto, urgente=urgente.
const TONE: Record<NovedadCliente['banner_estilo'], BannerTone> = {
  info: 'novedad',
  novedad: 'novedad',
  aviso: 'alto',
  urgente: 'urgente',
};

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
            const tone = TONE[n.banner_estilo];
            const Icon = ICONS[n.banner_estilo];
            const esImagen = !!n.imagen_url;
            return (
              <PremiumBanner
                key={n.id}
                tone={tone}
                icon={<Icon size={20} />}
                kicker={`${LABEL[n.banner_estilo]} · De gerencia`}
                title={n.titulo}
                onDismiss={() => void dismiss(n.id)}
                dismissing={dismissing === n.id}
                actions={
                  esImagen ? (
                    <button type="button" onClick={() => setModalItem(n)} className={premiumCtaClass(tone)}>
                      {n.cta_label || 'Ver comunicado'} <ArrowRight size={14} />
                    </button>
                  ) : (
                    n.cta_label && n.cta_url ? (
                      <a
                        href={n.cta_url}
                        target={n.cta_url.startsWith('http') ? '_blank' : undefined}
                        rel={n.cta_url.startsWith('http') ? 'noopener noreferrer' : undefined}
                        className={premiumCtaClass(tone)}
                      >
                        {n.cta_label} <ArrowRight size={14} />
                      </a>
                    ) : null
                  )
                }
              >
                {n.cuerpo_md && <span className="whitespace-pre-line">{n.cuerpo_md}</span>}
              </PremiumBanner>
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
