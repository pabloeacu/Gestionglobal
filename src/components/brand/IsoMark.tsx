// IsoMark · solo el isotipo (símbolo gráfico) de Gestión Global, sin
// wordmark. Usado en sidebars colapsados donde el nombre completo se cortaría.
//
// Source: el archivo PNG de PWA icon (192×192) sirve como isotipo limpio
// con fondo transparente.

import { cn } from '@/lib/cn';

interface IsoMarkProps {
  size?: number;
  className?: string;
  title?: string;
}

export function IsoMark({ size = 36, className, title = 'Gestión Global' }: IsoMarkProps) {
  return (
    <img
      src="/icons/icon-192.png"
      alt={title}
      width={size}
      height={size}
      className={cn('block object-contain select-none', className)}
      style={{ width: size, height: size }}
      draggable={false}
    />
  );
}
