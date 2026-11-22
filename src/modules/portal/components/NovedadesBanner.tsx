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
import { Link, useSearchParams } from 'react-router-dom';
import {
  ArrowRight,
  AlertCircle,
  Info,
  Sparkles,
  Bell,
  ShieldCheck,
  X,
} from 'lucide-react';
import { toast } from '@/lib/toast';
import { Modal, Button } from '@/components/common';
import {
  listNovedadesCliente,
  marcarNovedadVista,
  type NovedadCliente,
} from '@/services/api/comunicaciones';
import { humanizeError } from '@/lib/errors';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import { PremiumBanner, premiumCtaClass, type BannerTone } from './premiumBanner';

const ICONS = {
  info: Info,
  novedad: Sparkles,
  aviso: Bell,
  urgente: AlertCircle,
} as const;

// DGG-254 · tono premium marca-nativa por estilo de comunicación.
// DGG-254-b: toda comunicación de gerencia NO urgente (info/novedad/aviso) usa el
// tono 'novedad' (violeta) — voz unificada de gerencia — para no confundirse con la
// agenda (brand), los assistants (cielo) ni DocsPendientes (alto/ámbar) al convivir.
// Sólo 'urgente' se despega a rojo. (El icono + label distinguen info/aviso/novedad.)
const TONE: Record<NovedadCliente['banner_estilo'], BannerTone> = {
  info: 'novedad',
  novedad: 'novedad',
  aviso: 'novedad',
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
            // DGG-254-b · el aviso de nueva edición de LexPH (mig 0684,
            // cta_url='/lexph') tiene su propia piel: NEGRO con matices + logo
            // LexPH en blanco. Distinto de las demás comunicaciones de gerencia.
            if (n.cta_url === '/lexph') {
              return (
                <LexphNovedadBanner
                  key={n.id}
                  novedad={n}
                  dismissing={dismissing === n.id}
                  onDismiss={() => void dismiss(n.id)}
                />
              );
            }
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

// DGG-254-b · Banner de LexPH para el portal del cliente (aviso de nueva edición
// del newsletter, cta_url='/lexph'). Piel propia: NEGRO con matices de fondo +
// logo LexPH en BLANCO, CTA blanco.
//
// DGG-261 (E-GG-292) · MISMA anatomía que PremiumBanner (fila única
// `flex items-start gap-3` → mismo footprint/alto que el resto de los banners del
// inicio). El logo va como marca de la izquierda con su proporción NATURAL
// (900×304 ≈ 2.96:1, atributos width/height + self-start → NUNCA lo estira el
// `align-items:stretch` del flex) y la info se redistribuye en la columna
// (kicker → título → cuerpo → CTA) igual que los demás. Antes usaba `flex-col`
// en mobile y el logo, con `w-auto` bajo stretch, se deformaba a lo ancho.
function LexphNovedadBanner({
  novedad, dismissing, onDismiss,
}: {
  novedad: NovedadCliente;
  dismissing: boolean;
  onDismiss: () => void;
}) {
  return (
    <section className="relative overflow-hidden gg-chamfer bg-gradient-to-br from-black via-[#0a1018] to-[#08232a] p-4 text-white motion-safe:animate-fade-up sm:p-5">
      <TrianglesAccent position="top-right" size={132} tone="cyan" density="rich" className="opacity-15" />
      <div aria-hidden className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-brand-cyan/10 blur-2xl" />
      <button
        type="button"
        onClick={onDismiss}
        disabled={dismissing}
        aria-label="Cerrar"
        className="absolute right-2.5 top-2.5 rounded-md p-1.5 text-white/60 transition hover:bg-white/10 hover:text-white disabled:opacity-40"
      >
        <X size={16} />
      </button>
      <div className="relative flex items-start gap-3 pr-7">
        {/* Marca LexPH: proporción natural preservada (width/height intrínsecos +
            self-start para que el stretch del flex no la deforme). Ocupa el lugar
            del glyph de los demás banners, a la altura del tile (h-11). */}
        <img
          src="/brand/lexph-logo-white.png"
          alt="LexPH"
          width={900}
          height={304}
          className="mt-0.5 h-7 w-auto shrink-0 self-start sm:h-8"
        />
        <div className="min-w-0 flex-1">
          <p className="kicker text-brand-cyan-light">Inteligencia jurídica en PH</p>
          <h3 className="font-display text-base uppercase leading-tight tracking-tight sm:text-lg">
            {novedad.titulo}
          </h3>
          {novedad.cuerpo_md && (
            <p className="mt-1 line-clamp-2 text-sm text-white/80">{novedad.cuerpo_md}</p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Link
              to="/lexph"
              className="inline-flex items-center justify-center gap-1.5 gg-chamfer-sm bg-white px-4 py-2 font-display text-xs uppercase tracking-wider text-brand-ink transition hover:bg-white/90"
            >
              {novedad.cta_label || 'Leer la edición'} <ArrowRight size={14} />
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
