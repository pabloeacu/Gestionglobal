import { cn } from '@/lib/cn';

interface BrandMarkProps {
  // 'dark' = sobre fondo oscuro (wordmark blanco) · 'light' = fondo claro (tinta)
  variant?: 'dark' | 'light';
  // alto del logo en px
  size?: number;
  withSlogan?: boolean;
  className?: string;
}

// Logo institucional Gestión Global. Usa los archivos oficiales con su
// tipografía propia (carpeta /public/brand/). Cuatro variantes según
// fondo claro/oscuro y con/sin slogan.
export function BrandMark({
  variant = 'light',
  size = 40,
  withSlogan = false,
  className,
}: BrandMarkProps) {
  const src = withSlogan
    ? (variant === 'dark' ? '/brand/logo-h-slogan-white.png' : '/brand/logo-h-slogan.png')
    : (variant === 'dark' ? '/brand/logo-h-white.png' : '/brand/logo-h.png');
  return (
    <img
      src={src}
      alt="Gestión Global · Aliados de tu tiempo"
      style={{ height: size, width: 'auto' }}
      className={cn('object-contain', className)}
    />
  );
}
