import { BadgeCheck, UserCheck, ShieldCheck, CircleHelp } from 'lucide-react';
import type { CertezaDato, FuenteDato, HechoConCerteza } from '@/services/api/perfilRegulatorio';
import { formatDateShort } from '@/lib/dates';
import { cn } from '@/lib/cn';

// Agenda · perfil regulatorio del CLIENTE — badge + valor con tokens de MARCA GG.
// DGG-231: distinción simple y no-ruda de la FUENTE del dato (pedido de Pablo):
//   · "Datos declarados" = lo que cargó el cliente (y lo que se deriva de eso)
//   · "TRAMIX"           = verificado contra el registro oficial
//   · "Verificado"       = confirmado por Gestión Global sin pasar por TRAMIX
//   · "Pendiente"        = sin dato por ninguna vía
// Nada de "estimado"/"aproximado"/«≈»: una fecha declarada se muestra como lo que
// es, un dato del cliente — no una presunción de la que desconfiamos.

interface CertezaMeta {
  label: string;
  Icon: typeof BadgeCheck;
  chip: string; // clases del chip
  hint: string;
}

export const CERTEZA_META: Record<CertezaDato, CertezaMeta> = {
  // Textos oscurecidos para contraste AA (>=4.5:1) sobre su fondo; la firma no-cromática
  // (icono + texto) ya cubre el significado sin depender del color.
  confirmado: {
    label: 'Verificado',
    Icon: BadgeCheck,
    chip: 'bg-gg-okBg text-[#0A7D57] border border-gg-ok/40',
    hint: 'Lo verificó Gestión Global (trámite resuelto o dato cargado por nosotros).',
  },
  declarado: {
    label: 'Datos declarados',
    Icon: UserCheck,
    chip: 'bg-white text-gg-petrolD border border-gg-petrol/50',
    hint: 'Son datos que cargaste vos. Podés corregirlos cuando quieras.',
  },
  inferido: {
    // Misma voz que "declarado": se calcula a partir de lo que el cliente cargó.
    label: 'Datos declarados',
    Icon: UserCheck,
    chip: 'bg-white text-gg-petrolD border border-gg-petrol/50',
    hint: 'Lo calculamos a partir de los datos que cargaste.',
  },
  desconocido: {
    label: 'Pendiente',
    Icon: CircleHelp,
    chip: 'bg-transparent text-brand-muted border border-gg-line',
    hint: 'Todavía no lo tenemos. Cargá el dato o tu legajo RPAC.',
  },
};

// DGG-231 · cuando un dato CONFIRMADO proviene del registro oficial (TRAMIX),
// se rotula distinto (el sello premium de la plataforma).
const META_TRAMIX: CertezaMeta = {
  label: 'TRAMIX',
  Icon: ShieldCheck,
  chip: 'bg-gg-okBg text-[#0A7D57] border border-gg-ok/40',
  hint: 'Verificado con el registro oficial (TRAMIX).',
};

function metaDe(certeza: CertezaDato, fuente?: FuenteDato | null): CertezaMeta {
  if (certeza === 'confirmado' && fuente === 'tramix') return META_TRAMIX;
  return CERTEZA_META[certeza];
}

export function CertezaBadge({
  certeza,
  fuente,
  className,
}: {
  certeza: CertezaDato;
  fuente?: FuenteDato | null;
  className?: string;
}) {
  const m = metaDe(certeza, fuente);
  const Icon = m.Icon;
  return (
    <span
      title={m.hint}
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide',
        m.chip,
        className,
      )}
    >
      <Icon size={11} />
      {m.label}
    </span>
  );
}

// Renderiza el VALOR de un hecho. DGG-231: sin «≈» ni itálica de "estimación".
// Un confirmado se muestra firme (negrita); el resto (declarado/inferido), normal.
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
  return (
    <span
      className={cn(
        'tabular-nums whitespace-nowrap',
        hecho.certeza === 'confirmado' ? 'font-semibold text-brand-ink' : 'text-brand-ink',
      )}
    >
      {fecha}
    </span>
  );
}
