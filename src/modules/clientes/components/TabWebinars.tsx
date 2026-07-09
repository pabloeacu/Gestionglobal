// TabWebinars · histórico de webinars de la administración (G1).
// Vista de gerencia (en AdministracionDetailPage) y portal cliente reutilizable.
// Capitaliza la info sin tocar el modelo fiscal de CC.

import { useCallback, useEffect, useState } from 'react';
import {
  Video,
  CheckCircle2,
  XCircle,
  PlayCircle,
  CalendarClock,
  Clock,
} from 'lucide-react';
import { Skeleton } from '@/components/common';
import { IllustratedEmpty } from '@/components/brand/IllustratedEmpty';
import { toast } from '@/lib/toast';
import {
  listAdministracionWebinars,
  type AdminWebinarHistorial,
} from '@/services/api/webinars';
import { humanizeError } from '@/lib/errors';

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('es-AR', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function formatDur(seg: number | null): string {
  if (!seg) return '—';
  const min = Math.floor(seg / 60);
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)}h ${min % 60}m`;
}

interface Props {
  administracionId: string;
}

export function TabWebinars({ administracionId }: Props) {
  const [rows, setRows] = useState<AdminWebinarHistorial[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await listAdministracionWebinars(administracionId);
    if (!res.ok) {
      toast.error(`No se pudo cargar: ${humanizeError(res.error)}`);
      setRows([]);
    } else {
      setRows(res.data);
    }
    setLoading(false);
  }, [administracionId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-20" />
        <Skeleton className="h-20" />
        <Skeleton className="h-20" />
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <IllustratedEmpty
        title="Sin inscripciones a eventos"
        description="Cuando el cliente se inscriba a un evento, va a quedar registrado acá como histórico — útil para medir fidelización y para retomar contacto."
      />
    );
  }

  const asistidos = rows.filter((r) => r.asistio).length;
  const finalizados = rows.filter((r) => r.webinar_status === 'finalizado').length;

  return (
    <div className="space-y-4">
      {/* KPI strip */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Kpi label="Inscripciones" value={rows.length} icon={<Video size={16} />} />
        <Kpi
          label="Asistencia confirmada"
          value={`${asistidos}/${finalizados}`}
          icon={<CheckCircle2 size={16} />}
          tone="emerald"
        />
        <Kpi
          label="Próximo / en agenda"
          value={rows.filter((r) => r.webinar_status === 'programado').length}
          icon={<CalendarClock size={16} />}
          tone="cyan"
        />
      </div>

      <p className="text-xs text-slate-500">
        Histórico de servicios gratuitos prestados a este cliente vía eventos.
        Útil para mostrar el valor agregado de la relación.
      </p>

      {/* Listado */}
      <div className="space-y-2">
        {rows.map((r) => {
          const isProgramado = r.webinar_status === 'programado';
          const isEnCurso = r.webinar_status === 'en_curso';
          const isFinalizado = r.webinar_status === 'finalizado';
          return (
            <div
              key={r.inscripto_id}
              className="flex flex-col gap-2 rounded-xl bg-white p-3 ring-1 ring-slate-200 sm:flex-row sm:items-center"
            >
              <div className="flex flex-1 items-center gap-3">
                <div
                  className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg ${
                    isEnCurso
                      ? 'bg-rose-100 text-rose-600'
                      : isProgramado
                        ? 'bg-cyan-100 text-cyan-700'
                        : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  <Video size={18} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-900">
                    {r.titulo}
                  </p>
                  <p className="text-xs text-slate-500">
                    {formatDate(r.fecha_hora)} · {r.duracion_min} min · {r.canal === 'zoom' ? 'Zoom' : 'YouTube'}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2 text-xs">
                {isFinalizado && r.asistio && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 font-semibold text-emerald-700 ring-1 ring-emerald-200">
                    <CheckCircle2 size={11} /> Asistió · {formatDur(r.tiempo_conectado_seg)}
                  </span>
                )}
                {isFinalizado && !r.asistio && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-slate-50 px-2.5 py-1 font-medium text-slate-500 ring-1 ring-slate-200">
                    <XCircle size={11} /> No asistió
                  </span>
                )}
                {isProgramado && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-cyan-50 px-2.5 py-1 font-semibold text-cyan-700 ring-1 ring-cyan-200">
                    <Clock size={11} /> Programado
                  </span>
                )}
                {isEnCurso && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2.5 py-1 font-semibold text-rose-700 ring-1 ring-rose-200">
                    <PlayCircle size={11} /> En vivo
                  </span>
                )}
                {r.grabacion_url && (
                  <a
                    href={r.grabacion_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded-full bg-slate-900 px-2.5 py-1 font-medium text-white transition hover:bg-slate-700"
                  >
                    <PlayCircle size={11} /> Grabación
                  </a>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Kpi({
  label,
  value,
  icon,
  tone = 'slate',
}: {
  label: string;
  value: number | string;
  icon: React.ReactNode;
  tone?: 'slate' | 'cyan' | 'emerald';
}) {
  const tones = {
    slate: 'bg-slate-50 text-slate-700 ring-slate-200',
    cyan: 'bg-cyan-50 text-cyan-700 ring-cyan-200',
    emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  } as const;
  return (
    <div className={`flex items-center gap-3 rounded-xl p-3 ring-1 ${tones[tone]}`}>
      <span className="rounded-lg bg-white/70 p-2">{icon}</span>
      <div>
        <p className="text-[10px] font-bold uppercase tracking-wider opacity-70">{label}</p>
        <p className="text-lg font-bold leading-none">{value}</p>
      </div>
    </div>
  );
}
