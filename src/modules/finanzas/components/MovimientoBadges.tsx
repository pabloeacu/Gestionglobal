import {
  ArrowUpRight, ArrowDownRight, ArrowRightLeft, RotateCcw, Ban,
} from 'lucide-react';
import { cn } from '@/lib/cn';

export function TipoBadge({ tipo, size = 14 }: { tipo: string; size?: number }) {
  const map: Record<string, { label: string; cls: string; Icon: typeof ArrowUpRight }> = {
    ingreso:           { label: 'Ingreso',      cls: 'bg-green-50 text-green-700 ring-green-200',       Icon: ArrowDownRight },
    egreso:            { label: 'Egreso',       cls: 'bg-red-50 text-red-700 ring-red-200',             Icon: ArrowUpRight },
    transferencia_in:  { label: 'Transf. (in)', cls: 'bg-cyan-50 text-cyan-700 ring-cyan-200',          Icon: ArrowRightLeft },
    transferencia_out: { label: 'Transf. (out)',cls: 'bg-amber-50 text-amber-700 ring-amber-200',       Icon: ArrowRightLeft },
  };
  const m = map[tipo] ?? { label: tipo, cls: 'bg-slate-50 text-slate-700 ring-slate-200', Icon: ArrowRightLeft };
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ring-1', m.cls)}>
      <m.Icon size={size - 4} /> {m.label}
    </span>
  );
}

export function EstadoBadge({ estado, revertido }: { estado: string; revertido: boolean }) {
  if (revertido) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-orange-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-orange-700 ring-1 ring-orange-200">
        <RotateCcw size={10} /> Revertido
      </span>
    );
  }
  if (estado === 'anulado') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-600 ring-1 ring-slate-200 line-through">
        <Ban size={10} /> Anulado
      </span>
    );
  }
  if (estado === 'pendiente_id') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-yellow-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-yellow-700 ring-1 ring-yellow-200">
        Pendiente
      </span>
    );
  }
  return null;
}

export function formatMonto(monto: number, tipo?: string): string {
  const formatted = new Intl.NumberFormat('es-AR', {
    style: 'currency', currency: 'ARS', maximumFractionDigits: 2,
  }).format(monto);
  if (!tipo) return formatted;
  if (tipo === 'egreso' || tipo === 'transferencia_out') return `- ${formatted}`;
  return formatted;
}

export function montoColor(tipo: string): string {
  if (tipo === 'ingreso' || tipo === 'transferencia_in') return 'text-green-700';
  if (tipo === 'egreso' || tipo === 'transferencia_out') return 'text-red-700';
  return 'text-brand-ink';
}
