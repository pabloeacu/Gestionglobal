// CirculoHecha — tilde estilo Apple Tasks (handoff C4 + E12). Se embebe en
// Lista / Mes / Semana / Día. CRÍTICO: stopPropagation en onPointerDown para
// no disparar drag al marcar.
import { Check } from 'lucide-react';

interface Props {
  isDone: boolean;
  onToggle: () => void;
  size?: number;
  /** Si está sobre fondo de color (bloque de calendario), usar 'sobreColor'. */
  variant?: 'plano' | 'sobreColor';
  ariaLabel?: string;
}

export function CirculoHecha({ isDone, onToggle, size = 18, variant = 'plano', ariaLabel }: Props) {
  const sobreColor = variant === 'sobreColor';
  return (
    <button
      type="button"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      aria-label={ariaLabel ?? (isDone ? 'Marcar como pendiente' : 'Marcar como hecha')}
      title={isDone ? 'Marcar como pendiente' : 'Marcar como hecha'}
      className="shrink-0 rounded-full flex items-center justify-center transition-transform hover:scale-110 active:scale-95"
      style={{
        width: size,
        height: size,
        background: isDone
          ? sobreColor
            ? 'rgba(255,255,255,.95)'
            : '#10b981'
          : sobreColor
            ? 'rgba(255,255,255,.12)'
            : 'transparent',
        border: isDone
          ? 'none'
          : sobreColor
            ? '1.5px solid rgba(255,255,255,.7)'
            : '1.5px solid #94a3b8',
      }}
    >
      {isDone && (
        <Check
          style={{ width: size - 6, height: size - 6 }}
          className={sobreColor ? 'text-emerald-600' : 'text-white'}
          strokeWidth={3.5}
        />
      )}
    </button>
  );
}
