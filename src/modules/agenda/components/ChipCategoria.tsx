import type { AgendaCategoria } from '@/services/api/agenda';

interface Props {
  categoria?: AgendaCategoria | null;
  size?: 'xs' | 'sm';
}

// Chip pequeño con el color de la categoría. Si no hay categoría, devuelve null.
export function ChipCategoria({ categoria, size = 'xs' }: Props) {
  if (!categoria) return null;
  const px = size === 'xs' ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-xs';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-medium ${px}`}
      style={{ background: `${categoria.color}1a`, color: categoria.color }}
    >
      <span
        className="inline-block h-1.5 w-1.5 rounded-full"
        style={{ background: categoria.color }}
      />
      {categoria.name}
    </span>
  );
}
