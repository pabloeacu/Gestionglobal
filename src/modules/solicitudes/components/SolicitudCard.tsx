import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  Calendar,
  ClipboardList,
  Mail,
  Phone,
  Send,
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
  rechazada: 'bg-red-50 text-red-700 border-red-200',
  descartada: 'bg-slate-100 text-slate-500 border-slate-200',
};

const ESTADO_LABEL: Record<SolicitudEstado, string> = {
  recibida: 'Recibida',
  en_revision: 'En revisión',
  derivada: 'Derivada',
  activada: 'Activada',
  rechazada: 'Rechazada',
  descartada: 'Descartada',
};

interface Props {
  s: SolicitudListItem;
}

// 1.G · helper para tiempo relativo + color creciente (verde <24h, ambar
// <72h, rojo >72h). Tooltip muestra la fecha exacta. Pensado para detectar
// backlog crítico de un vistazo.
function tiempoRelativo(iso: string | null | undefined): {
  texto: string;
  color: string;
  fechaExacta: string;
} {
  if (!iso) {
    return { texto: '—', color: 'text-brand-muted', fechaExacta: '' };
  }
  const date = new Date(iso);
  const ahora = Date.now();
  const deltaMs = ahora - date.getTime();
  const horas = deltaMs / (1000 * 60 * 60);
  const dias = horas / 24;

  let texto: string;
  if (horas < 1) texto = 'hace minutos';
  else if (horas < 24) texto = `hace ${Math.round(horas)} h`;
  else if (dias < 7) texto = `hace ${Math.round(dias)} d`;
  else if (dias < 30) texto = `hace ${Math.round(dias / 7)} sem`;
  else texto = `hace ${Math.round(dias / 30)} m`;

  let color = 'text-emerald-700';
  if (horas >= 24 && horas < 72) color = 'text-amber-700';
  else if (horas >= 72) color = 'text-red-700';

  const fechaExacta = date.toLocaleString('es-AR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  return { texto, color, fechaExacta };
}

export function SolicitudCard({ s }: Props) {
  const navigate = useNavigate();
  const { texto: tiempoTexto, color: tiempoColor, fechaExacta } = tiempoRelativo(
    s.created_at,
  );
  const estado = (s.estado ?? 'recibida') as SolicitudEstado;
  // 1.D · "Derivar" rápido disponible mientras la solicitud no esté cerrada.
  const puedeDerivar = estado !== 'activada' && estado !== 'descartada';

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
        <span
          className={cn(
            'inline-flex items-center gap-1 text-[11px] font-medium',
            tiempoColor,
          )}
          title={fechaExacta}
        >
          <Calendar size={11} /> {tiempoTexto}
        </span>
      </div>

      {/* Servicio */}
      <div className="relative">
        <p className="kicker text-brand-cyan">
          {s.formulario_categoria ?? 'Solicitud'}
        </p>
        <h3 className="mt-0.5 font-display text-base font-semibold leading-tight text-brand-ink">
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

      {/* CTA + 1.D acción rápida "Derivar" (visible en hover/focus) */}
      <div className="relative -mb-1 mt-1 flex items-center justify-between gap-2">
        {/* 1.D · "Derivar" abre el wizard en paso 1 (ruta ?wizard=derivar).
            Reduce 3 clicks a 1. stopPropagation para no disparar el Link. */}
        {puedeDerivar ? (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              navigate(`/gerencia/solicitudes/${s.id}?wizard=derivar`);
            }}
            className="inline-flex items-center gap-1 rounded-full border border-violet-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-violet-700 opacity-0 shadow-sm transition focus-visible:opacity-100 group-hover:opacity-100 hover:bg-violet-50 motion-reduce:opacity-100"
            title="Derivar a gestoría"
          >
            <Send size={11} /> Derivar
          </button>
        ) : (
          <span />
        )}
        <span className="inline-flex items-center text-xs font-medium text-brand-cyan opacity-70 transition group-hover:opacity-100">
          Procesar
          <ArrowRight
            size={13}
            className="ml-1 transition group-hover:translate-x-0.5"
          />
        </span>
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
