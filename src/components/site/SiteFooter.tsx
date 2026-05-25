import { BrandMark } from '@/components/brand/BrandMark';
import { Mail, Phone, Instagram, Facebook } from 'lucide-react';

export function SiteFooter() {
  return (
    <footer className="border-t border-slate-200 bg-white">
      <div className="mx-auto grid max-w-7xl gap-12 px-6 py-16 md:grid-cols-4">
        <div className="md:col-span-2">
          <BrandMark variant="light" size={56} withSlogan />
          <p className="mt-5 max-w-sm text-sm leading-relaxed text-brand-muted">
            Gestoría, capacitación, declaraciones juradas, asesoramiento
            jurídico y plataforma de gestión integral — todo en un único
            lugar.
          </p>
        </div>

        <div>
          <p className="kicker">Navegación</p>
          <ul className="mt-4 space-y-2 text-sm text-brand-ink/80">
            <li><a href="#servicios" className="hover:text-brand-cyan">Servicios</a></li>
            <li><a href="#plataforma" className="hover:text-brand-cyan">Plataforma</a></li>
            <li><a href="#cursos" className="hover:text-brand-cyan">Cursos</a></li>
            <li><a href="#nosotros" className="hover:text-brand-cyan">Nosotros</a></li>
            <li><a href="/ingresar" className="hover:text-brand-cyan">Ingresar</a></li>
          </ul>
        </div>

        <div>
          <p className="kicker">Contacto</p>
          <ul className="mt-4 space-y-3 text-sm text-brand-ink/80">
            <li className="flex items-center gap-2">
              <Mail size={14} className="text-brand-cyan" />
              <a href="mailto:contacto@gestionglobal.ar" className="hover:text-brand-cyan">
                contacto@gestionglobal.ar
              </a>
            </li>
            <li className="flex items-center gap-2">
              <Phone size={14} className="text-brand-cyan" />
              <a href="https://wa.me/5492214317914" className="hover:text-brand-cyan">
                +54 9 221 431-7914
              </a>
            </li>
            <li className="mt-3 flex items-center gap-3">
              <a
                href="https://www.instagram.com/gestionglobal.ar/"
                aria-label="Instagram"
                className="text-brand-ink/70 transition hover:text-brand-cyan"
              >
                <Instagram size={18} />
              </a>
              <a
                href="https://www.facebook.com/gestionglobal.ar"
                aria-label="Facebook"
                className="text-brand-ink/70 transition hover:text-brand-cyan"
              >
                <Facebook size={18} />
              </a>
            </li>
          </ul>
        </div>
      </div>
      <div className="border-t border-slate-100">
        <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-2 px-6 py-6 text-xs text-brand-muted md:flex-row md:items-center">
          <p>© {new Date().getFullYear()} Gestión Global · #AliadosDeTuTiempo</p>
          <p>gestionglobal.ar</p>
        </div>
      </div>
    </footer>
  );
}
