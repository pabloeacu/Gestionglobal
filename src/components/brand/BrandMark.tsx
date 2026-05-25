import { cn } from '@/lib/cn';

interface BrandMarkProps {
  // 'dark' = sobre fondo oscuro (wordmark blanco) · 'light' = fondo claro (tinta)
  variant?: 'dark' | 'light';
  // 'horizontal' (default) = iso + wordmark al lado · 'vertical' = iso encima del wordmark
  orientation?: 'horizontal' | 'vertical';
  // alto del logo en px
  size?: number;
  withSlogan?: boolean;
  className?: string;
}

// Logo institucional Gestión Global. Usa los archivos oficiales con su
// tipografía propia (carpeta /public/brand/). Soporta orientación
// horizontal (h, default) y vertical (v); variante para fondo claro
// (light, full color) y oscuro (dark, blanco sólido); con o sin slogan.
export function BrandMark({
  variant = 'light',
  orientation = 'horizontal',
  size = 40,
  withSlogan = false,
  className,
}: BrandMarkProps) {
  const prefix = orientation === 'vertical' ? 'logo-v' : 'logo-h';
  const sloganSuffix = withSlogan ? '-slogan' : '';
  const colorSuffix = variant === 'dark' ? '-white' : '';
  const src = `/brand/${prefix}${sloganSuffix}${colorSuffix}.png`;
  return (
    <img
      src={src}
      alt="Gestión Global · Aliados de tu tiempo"
      style={{ height: size, width: 'auto' }}
      className={cn('object-contain', className)}
    />
  );
}
