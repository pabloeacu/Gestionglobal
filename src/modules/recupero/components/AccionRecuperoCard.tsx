import { AlertTriangle, Mail, User, Building2, FileText } from 'lucide-react';
import { cn } from '@/lib/cn';
import { formatTimestampDate } from '@/lib/dates';
import { formatMoney, comprobanteLabel } from '../lib/format';
import {
  RECUPERO_NIVEL_LABEL,
  RECUPERO_NIVEL_TONO,
  type AccionListItem,
  type RecuperoNivel,
} from '@/services/api/recupero';

const TONE_RING: Record<'cyan' | 'amber' | 'red', string> = {
  cyan: 'border-brand-cyan/30 bg-brand-cyan/5 text-brand-cyan',
  amber: 'border-amber-200 bg-amber-50 text-amber-700',
  red: 'border-red-200 bg-red-50 text-red-700',
};

interface Props {
  accion: AccionListItem;
}

export function AccionRecuperoCard({ accion }: Props) {
  const nivel = (accion.nivel as RecuperoNivel) ?? 1;
  const tone = RECUPERO_NIVEL_TONO[nivel];
  return (
    <article className="group relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-brand-cyan hover:shadow-md">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Mail size={15} className="shrink-0 text-brand-cyan" aria-hidden />
            <p className="truncate text-[11px] font-semibold uppercase tracking-wider text-brand-muted">
              {formatTimestampDate(accion.enviado_at, 'long')}
            </p>
          </div>
          <h3 className="mt-1 truncate font-display text-base font-semibold text-brand-ink">
            {accion.administracion_nombre ?? '—'}
          </h3>
          {accion.consorcio_nombre && (
            <p className="truncate text-xs text-brand-muted">
              <Building2 size={11} className="-mt-0.5 mr-1 inline" aria-hidden />
              {accion.consorcio_nombre}
            </p>
          )}
        </div>
        <span
          className={cn(
            'inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold',
            TONE_RING[tone],
          )}
        >
          {nivel === 3 && <AlertTriangle size={11} aria-hidden />}
          {RECUPERO_NIVEL_LABEL[nivel]}
        </span>
      </header>

      <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-brand-muted">
        <div>
          <p className="font-semibold uppercase tracking-wider text-[10px]">Comprobante</p>
          <p className="font-medium text-brand-ink">
            <FileText size={11} className="-mt-0.5 mr-1 inline" aria-hidden />
            {comprobanteLabel(
              accion.comprobante_tipo,
              accion.punto_venta,
              accion.comprobante_numero,
            )}
          </p>
        </div>
        <div>
          <p className="font-semibold uppercase tracking-wider text-[10px]">Saldo</p>
          <p className="font-display text-sm font-semibold text-brand-ink">
            {formatMoney(Number(accion.monto_adeudado ?? 0))}
          </p>
        </div>
        {accion.dias_vencido != null && (
          <div>
            <p className="font-semibold uppercase tracking-wider text-[10px]">Días vencido</p>
            <p className="font-medium text-brand-ink">{accion.dias_vencido}</p>
          </div>
        )}
        {accion.autor_nombre && (
          <div>
            <p className="font-semibold uppercase tracking-wider text-[10px]">Autor</p>
            <p className="font-medium text-brand-ink">
              <User size={11} className="-mt-0.5 mr-1 inline" aria-hidden />
              {accion.autor_nombre}
            </p>
          </div>
        )}
      </div>

      {accion.observaciones && (
        <p className="mt-3 line-clamp-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-brand-muted">
          {accion.observaciones}
        </p>
      )}
    </article>
  );
}
