import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Calendar,
  ClipboardList,
  Mail,
  Phone,
  User,
} from 'lucide-react';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import { cn } from '@/lib/cn';
import type {
  SolicitudListItem,
  SolicitudEstado,
} from '@/services/api/solicitudes';

const ESTADO_BADGE: Record<SolicitudEstado, string> = {
  recibida: 'bg-blue-50 text-blue-700 border-blue-200',
  en_revision: 'bg-amber-50 text-amber-700 border-amber-200',
  derivada: 'bg-violet-50 text-violet-700 border-violet-200',
  activada: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  descartada: 'bg-slate-100 text-slate-500 border-slate-200',
};

const ESTADO_LABEL: Record<SolicitudEstado, string> = {
  recibida: 'Recibida',
  en_revision: 'En revisión',
  derivada: 'Derivada',
  activada: 'Activada',
  descartada: 'Descartada',
};

interface Props {
  s: SolicitudListItem;
}

export function SolicitudCard({ s }: Props) {
  const fecha = new Date(s.created_at ?? '').toLocaleDateString('es-AR', {
    day: '2-digit',
    month: 'short',
  });
  const estado = (s.estado ?? 'recibida') as SolicitudEstado;

  return (
    <Link
      to={`/gerencia/solicitudes/${s.id}`}
      className="group relative flex flex-col gap-3 overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-brand-cyan/50 hover:shadow-[0_18px_40px_-24px_rgba(0,158,202,0.4)] motion-safe:animate-fade-up"
    >
      <TrianglesAccent
        position="top-right"
        size={130}
        tone="cyan"
        density="soft"
        className="opacity-30 transition-opacity group-hover:opacity-60"
      />

      {/* Cabecera con estado + fecha */}
      <div className="relative flex items-start justify-between gap-2">
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider',
            ESTADO_BADGE[estado],
          )}
        >
          {ESTADO_LABEL[estado]}
        </span>
        <span className="inline-flex items-center gap-1 text-[11px] text-brand-muted">
          <Calendar size={11} /> {fecha}
        </span>
      </div>

      {/* Servicio */}
      <div className="relative">
        <p className="kicker text-brand-cyan">
          {s.formulario_categoria ?? 'Solicitud'}
        </p>
        <h3 className="mt-0.5 font-display text-base font-bold leading-tight text-brand-ink">
          {s.formulario_titulo ?? s.servicio_nombre ?? 'Servicio sin identificar'}
        </h3>
      </div>

      {/* Solicitante */}
      <div className="relative space-y-1 border-t border-slate-100 pt-3 text-xs text-brand-muted">
        <p className="flex items-center gap-1.5 truncate text-brand-ink">
          <User size={12} className="text-brand-cyan" />
          {s.solicitante_nombre ?? '—'}
        </p>
        {s.solicitante_email && (
          <p className="flex items-center gap-1.5 truncate">
            <Mail size={11} /> {s.solicitante_email}
          </p>
        )}
        {s.solicitante_telefono && (
          <p className="flex items-center gap-1.5 truncate">
            <Phone size={11} /> {s.solicitante_telefono}
          </p>
        )}
      </div>

      {/* CTA */}
      <div className="relative -mb-1 mt-1 flex items-center justify-end text-xs font-medium text-brand-cyan opacity-70 transition group-hover:opacity-100">
        <span>Procesar</span>
        <ArrowRight
          size={13}
          className="ml-1 transition group-hover:translate-x-0.5"
        />
      </div>
    </Link>
  );
}

export function SolicitudCardSkeleton() {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="h-4 w-24 animate-pulse rounded-full bg-slate-100" />
      <div className="space-y-2">
        <div className="h-3 w-20 animate-pulse rounded bg-slate-100" />
        <div className="h-5 w-3/4 animate-pulse rounded bg-slate-200" />
      </div>
      <div className="space-y-1 pt-3">
        <div className="h-3 w-32 animate-pulse rounded bg-slate-100" />
        <div className="h-3 w-40 animate-pulse rounded bg-slate-100" />
      </div>
      {/* Para que tenga la altura aprox de una card real */}
      <ClipboardList size={1} className="invisible" />
    </div>
  );
}
