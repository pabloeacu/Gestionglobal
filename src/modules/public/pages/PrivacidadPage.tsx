// Política de privacidad (pública) — DGG-242.
// Incluye el párrafo sobre el píxel de Meta (medición y publicidad) y cómo
// oponerse, más un control para gestionar el consentimiento en el momento.

import { useState, type ReactNode } from 'react';
import { SiteNav } from '@/components/site/SiteNav';
import { SiteFooter } from '@/components/site/SiteFooter';
import { getConsent, setConsent, type ConsentValue } from '@/lib/metaConsent';

function Seccion({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="font-display text-xl font-bold text-brand-ink sm:text-2xl">{titulo}</h2>
      <div className="mt-3 space-y-3 text-[15px] leading-relaxed text-brand-ink/80">{children}</div>
    </section>
  );
}

export function PrivacidadPage() {
  const [consent, setConsentState] = useState<ConsentValue | null>(() => getConsent());
  const cambiar = (v: ConsentValue) => {
    setConsent(v);
    setConsentState(v);
  };

  return (
    <div data-gg-classic className="min-h-screen bg-white font-sans text-brand-ink">
      <SiteNav />
      <main className="mx-auto max-w-3xl px-6 pt-28 pb-20 sm:pt-32">
        <p className="kicker text-brand-cyan">Legales</p>
        <h1 className="mt-2 font-display text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl">
          Política de privacidad
        </h1>
        <p className="mt-4 text-[15px] leading-relaxed text-brand-muted">
          En Gestión Global cuidamos tus datos. Esta política explica qué información tratamos
          cuando navegás o nos contactás a través de gestionglobal.ar.
        </p>

        <Seccion titulo="Qué datos tratamos">
          <p>
            Tratamos los datos que nos facilitás voluntariamente a través de nuestros formularios
            (por ejemplo, nombre, correo, teléfono y la documentación propia de cada gestión) con
            la única finalidad de brindarte el servicio solicitado y responder tus consultas.
          </p>
        </Seccion>

        <Seccion titulo="Medición y publicidad · Píxel de Meta">
          <p>
            Para entender cómo los visitantes llegan a nuestro sitio y mejorar la eficacia de
            nuestras campañas publicitarias, utilizamos el <strong>píxel de Meta</strong>
            (Facebook/Instagram) y su API de conversiones. Estas herramientas registran eventos de
            navegación (como visitas de página, interés en un servicio, envío de un formulario o
            contacto por WhatsApp) de forma asociada a identificadores técnicos. No publicamos ni
            vendemos tus datos personales.
          </p>
          <p>
            El píxel se carga <strong>únicamente en las páginas públicas</strong> de nuestro sitio y
            <strong> sólo si prestás tu consentimiento</strong>. Nunca se activa dentro de las áreas
            privadas (portal de clientes, panel de gestión o campus).
          </p>
          <p>
            <strong>Cómo oponerte:</strong> podés rechazar o retirar tu consentimiento en cualquier
            momento desde el botón de más abajo. También podés gestionar la publicidad
            personalizada desde la configuración de tu cuenta de Meta
            (Facebook/Instagram) y configurar tu navegador para bloquear cookies de terceros.
          </p>

          <div className="mt-4 rounded-2xl border border-slate-200 bg-brand-zebra/50 p-4">
            <p className="text-sm font-semibold text-brand-ink">Tu preferencia de medición</p>
            <p className="mt-1 text-sm text-brand-muted">
              Estado actual:{' '}
              <strong className="text-brand-ink">
                {consent === 'granted' ? 'Aceptada' : consent === 'denied' ? 'Rechazada' : 'Sin decidir'}
              </strong>
              .
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => cambiar('granted')}
                className="rounded-full bg-brand-ink px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-cyan"
              >
                Aceptar medición
              </button>
              <button
                type="button"
                onClick={() => cambiar('denied')}
                className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-brand-ink transition hover:border-brand-cyan hover:text-brand-cyan"
              >
                Rechazar / retirar
              </button>
            </div>
            <p className="mt-2 text-xs text-brand-muted">
              Si rechazás, el píxel no se carga. El cambio aplica de inmediato en este navegador.
            </p>
          </div>
        </Seccion>

        <Seccion titulo="Tus derechos">
          <p>
            Podés solicitar el acceso, la rectificación o la supresión de tus datos escribiéndonos a{' '}
            <a href="mailto:contacto@gestionglobal.ar" className="font-semibold text-brand-cyan underline underline-offset-2">
              contacto@gestionglobal.ar
            </a>
            . Atenderemos tu pedido conforme a la normativa vigente de protección de datos
            personales de la República Argentina (Ley 25.326).
          </p>
        </Seccion>
      </main>
      <SiteFooter />
    </div>
  );
}
