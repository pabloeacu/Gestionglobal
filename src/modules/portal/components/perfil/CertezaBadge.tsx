import { BadgeCheck, UserCheck, CircleDashed, CircleHelp } from 'lucide-react';
import type { CertezaDato, HechoConCerteza } from '@/services/api/perfilRegulatorio';
import { formatDateShort } from '@/lib/dates';
import { cn } from '@/lib/cn';

// Agenda · perfil regulatorio del CLIENTE — badge + valor con NIVELES DE CERTEZA,
// con tokens de MARCA GG (ok/petróleo/warn/muted). NO reusa los emerald/sky/amber
// de la grilla de gerencia (PerfilRegulatorioPanel): esos son de otra superficie.
// Principio rector: nunca afirmar una presunción. La firma visual comunica la
// incertidumbre ANTES de leer la etiqueta (borde punteado + valor en itálica + «≈»).

interface CertezaMeta {
  label: string;
  Icon: typeof BadgeCheck;
  chip: string; // clases del chip
  hint: string;
}

export const CERTEZA_META: Record<CertezaDato, CertezaMeta> = {
  // Textos oscurecidos para contraste AA (>=4.5:1) sobre su fondo; la firma no-cromática
  // (icono + texto + estilo del valor) ya cubre el significado sin depender del color.
  confirmado: {
    label: 'Confirmado',
    Icon: BadgeCheck,
    chip: 'bg-gg-okBg text-[#0A7D57] border border-gg-ok/40',
    hint: 'Lo sabe Gestión Global (matrícula cargada o trámite resuelto).',
  },
  declarado: {
    label: 'Lo dijiste vos',
    Icon: UserCheck,
    chip: 'bg-white text-gg-petrolD border border-gg-petrol/50',
    hint: 'Nos lo declaraste vos. Podés corregirlo cuando quieras.',
  },
  inferido: {
    label: 'Estimado · a confirmar',
    Icon: CircleDashed,
    chip: 'bg-gg-warnBg text-[#8A4A00] border border-dashed border-gg-warn/70',
    hint: 'Es una estimación por cálculo. Conviene que lo confirmes.',
  },
  desconocido: {
    label: 'Falta',
    Icon: CircleHelp,
    chip: 'bg-transparent text-brand-muted border border-gg-line',
    hint: 'Todavía no lo sabemos.',
  },
};

export function CertezaBadge({ certeza, className }: { certeza: CertezaDato; className?: string }) {
  const m = CERTEZA_META[certeza];
  const Icon = m.Icon;
  return (
    <span
      title={m.hint}
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide',
        m.chip,
        className,
      )}
    >
      <Icon size={11} />
      {m.label}
    </span>
  );
}

// Renderiza el VALOR de un hecho con la firma visual del principio rector:
// confirmado = firme; declarado = normal; inferido = itálica + subrayado punteado + «≈»;
// desconocido = «—». Un solo lugar garantiza que un inferido nunca se muestre como afirmación.
export function HechoValue({
  hecho,
  fallback = 'Sin dato',
}: {
  hecho: HechoConCerteza;
  fallback?: string;
}) {
  if (!hecho.fecha) {
    return <span className="text-brand-muted">{fallback}</span>;
  }
  const fecha = formatDateShort(hecho.fecha);
  if (hecho.certeza === 'inferido') {
    return (
      <span className="italic tabular-nums text-[#8A4A00] underline decoration-dotted underline-offset-2">
        ≈{fecha}
      </span>
    );
  }
  return (
    <span
      className={cn(
        'tabular-nums',
        hecho.certeza === 'confirmado' ? 'font-semibold text-brand-ink' : 'text-brand-ink',
      )}
    >
      {fecha}
    </span>
  );
}
