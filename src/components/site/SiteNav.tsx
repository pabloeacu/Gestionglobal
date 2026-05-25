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

interface SiteNavProps {
  // El hero detrás del nav es oscuro (gradiente cyan/teal). El logo + links
  // cambian a versión blanca mientras no se scrollee. Una vez scrolleado el
  // header se vuelve blanco y volvemos a la versión ink.
  darkHero?: boolean;
}

// Top bar fija. Transparente en hero, blanca con borde inferior al scrollear.
export function SiteNav({ darkHero = false }: SiteNavProps) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const onDark = darkHero && !scrolled;

  return (
    <header
      className={cn(
        'fixed inset-x-0 top-0 z-40 transition-all duration-300',
        scrolled
          ? 'border-b border-slate-200/70 bg-white/85 backdrop-blur-md'
          : 'bg-transparent',
      )}
    >
      <div className="mx-auto flex h-20 max-w-7xl items-center justify-between px-6">
        <a href="#top" className="flex items-center">
          <BrandMark variant={onDark ? 'dark' : 'light'} size={48} />
        </a>

        <nav className="hidden items-center gap-9 md:flex">
          {LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className={cn(
                'text-sm font-medium transition',
                onDark
                  ? 'text-white/85 hover:text-white'
                  : 'text-brand-ink/75 hover:text-brand-ink',
              )}
            >
              {l.label}
            </a>
          ))}
        </nav>

        <Link
          to="/ingresar"
          className={cn(
            'group inline-flex items-center gap-1.5 rounded-full px-5 py-2 text-sm font-medium transition',
            onDark
              ? 'bg-white text-brand-ink hover:bg-white/90'
              : 'bg-brand-ink text-white hover:bg-brand-cyan',
          )}
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
