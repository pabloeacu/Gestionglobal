import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { BrandMark } from '@/components/brand/BrandMark';
import { cn } from '@/lib/cn';

const LINKS = [
  { href: '#servicios', label: 'Servicios' },
  { href: '#plataforma', label: 'Plataforma' },
  { href: '#cursos', label: 'Cursos' },
  { href: '#nosotros', label: 'Nosotros' },
];

// Top bar fija. Transparente en hero, blanca con borde inferior al scrollear.
export function SiteNav() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header
      className={cn(
        'fixed inset-x-0 top-0 z-40 transition-all duration-300',
        scrolled
          ? 'border-b border-slate-200/70 bg-white/85 backdrop-blur-md'
          : 'bg-transparent',
      )}
    >
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
        <a href="#top" className="flex items-center">
          <BrandMark variant="light" size={32} />
        </a>

        <nav className="hidden items-center gap-9 md:flex">
          {LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="text-sm font-medium text-brand-ink/75 transition hover:text-brand-ink"
            >
              {l.label}
            </a>
          ))}
        </nav>

        <Link
          to="/ingresar"
          className="group inline-flex items-center gap-1.5 rounded-full bg-brand-ink px-5 py-2 text-sm font-medium text-white transition hover:bg-brand-cyan"
        >
          Ingresar
          <ArrowRight
            size={15}
            className="transition group-hover:translate-x-0.5"
          />
        </Link>
      </div>
    </header>
  );
}
