import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';

// 7.B · `tonal` reemplaza los hardcodes "!bg-cyan-100 !text-cyan-700" que
// había sueltos en algunos CTAs secundarios (ej. "Programar próximo
// vencimiento"). Es un botón cyan suave: presencia de marca sin competir con
// el `primary` sólido. Estados hover/focus/disabled consistentes con el resto.
type Variant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'tonal';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  loading?: boolean;
  children: ReactNode;
}

const styles: Record<Variant, string> = {
  primary: 'bg-brand-cyan text-white hover:bg-brand-blue',
  secondary: 'border border-slate-300 bg-white text-brand-ink hover:bg-slate-50',
  danger: 'bg-red-600 text-white hover:bg-red-700',
  ghost: 'text-brand-muted hover:bg-slate-100',
  tonal: 'bg-cyan-100 text-cyan-700 ring-1 ring-inset ring-cyan-200 hover:bg-cyan-200',
};

export function Button({
  variant = 'primary',
  loading = false,
  disabled,
  children,
  className,
  // E-GG-106: default seguro `type="button"`. En HTML, un <button> sin type
  // hereda `type="submit"` y, dentro de un <form>, submitea al hacer click.
  // Los CTAs que SÍ deben submitear pasan `type="submit"` explícito (gana sobre
  // este default). Evita submits accidentales en toda la app.
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60',
        styles[variant],
        className,
      )}
      disabled={disabled || loading}
      {...rest}
    >
      {loading && <Loader2 size={16} className="animate-spin" />}
      {children}
    </button>
  );
}
