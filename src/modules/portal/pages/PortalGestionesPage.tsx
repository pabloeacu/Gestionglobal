// PortalGestionesPage · "Mis gestiones" del cliente. Lista de trámites
// del administrador con filtro abiertos/todos + estado visual.
//
// Citas: regla 4 (queries en services/), regla 13 (sin window.confirm).

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  FileText,
  Clock,
  CheckCircle2,
  AlertCircle,
  CircleDot,
  XCircle,
  PlusCircle,
  ArrowRight,
  ChevronRight,
  Landmark,
} from 'lucide-react';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import { IllustratedEmpty } from '@/components/brand/IllustratedEmpty';
import { Skeleton } from '@/components/common';
import { toast } from '@/lib/toast';
import {
  fetchClienteTramites,
  type ClienteTramite,
} from '@/services/api/portal-dashboard';
import { humanizeError } from '@/lib/errors';
import { TramixConsultaModal } from '@/modules/portal/components/TramixConsultaModal';

export function PortalGestionesPage() {
  // E-GG-43 (2026-06-02 · José Luis): los KPIs (Abiertos/Esperan/Resueltos)
  // deben calcularse sobre el universo COMPLETO de gestiones del cliente,
  // no sobre la lista filtrada por tab. Antes el fetch traía solo abiertos
  // cuando el tab era "Activos" → "Resueltos: 0" hasta que el usuario
  // cambiaba a "Todo el historial" y refrescaba.
  //
  // Fix: un único fetch sin filtro backend. El filtro por tab vive en
  // memoria; los stats calculan sobre items completos.
  const [items, setItems] = useState<ClienteTramite[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'abiertos' | 'todos'>('abiertos');
  // DGG-46 · modal de consulta a la Mesa de Entradas Virtual (TRAMIX/DPPJ-PBA)
  const [tramixOpen, setTramixOpen] = useState(false);

  async function load() {
    setLoading(true);
    const res = await fetchClienteTramites(false); // TRAE TODO siempre
    setLoading(false);
    if (!res.ok) {
      toast.error('No pudimos cargar tus gestiones', { description: humanizeError(res.error) });
      return;
    }
    setItems(res.data);
  }

  // Solo refetch al montar el componente — no cuando cambia filter
  // (el filtro vive 100% en memoria).
  useEffect(() => { void load(); }, []);

  // Lista visible filtrada según tab (lo que antes hacía el RPC).
  const ESTADOS_ABIERTOS = ['abierto', 'en_progreso', 'esperando_cliente'] as const;
  const visibleItems = useMemo(
    () => filter === 'abiertos'
      ? items.filter((t) => (ESTADOS_ABIERTOS as readonly string[]).includes(t.estado))
      : items,
    [items, filter],
  );

  // Stats sobre el universo COMPLETO. "Resueltos" incluye tanto
  // 'resuelto' como 'cerrado' — ambos son trámites terminados desde
  // la perspectiva del cliente (DGG-38 EXT introdujo cierre con motivo
  // que deja estado='cerrado').
  const stats = useMemo(() => ({
    abiertos: items.filter((t) => (ESTADOS_ABIERTOS as readonly string[]).includes(t.estado)).length,
    esperando: items.filter((t) => t.estado === 'esperando_cliente').length,
    resueltos: items.filter((t) => t.estado === 'resuelto' || t.estado === 'cerrado').length,
  }), [items]);

  return (
    <div className="relative space-y-5 pb-12">
      <TrianglesAccent position="top-right" size={180} tone="cyan" density="soft" className="opacity-30" />

      {/* Header */}
      <section className="card-premium relative overflow-hidden">
        <div className="relative flex flex-col gap-4 p-5 sm:flex-row sm:items-end sm:justify-between sm:p-6">
          <div>
            <p className="kicker text-brand-cyan">PORTAL · OPERACIÓN</p>
            <h1 className="font-display text-2xl font-bold text-brand-ink sm:text-3xl">
              Mis gestiones
            </h1>
            <p className="mt-1 max-w-xl text-sm text-brand-muted">
              Acá ves el estado de todos los trámites que Gestión Global está procesando para vos.
            </p>
          </div>
          <div className="flex flex-col gap-2 self-start sm:flex-row sm:items-center sm:self-end">
            <button
              type="button"
              onClick={() => setTramixOpen(true)}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-brand-cyan/30 bg-brand-cyan/5 px-4 py-2 text-sm font-semibold text-brand-cyan transition hover:bg-brand-cyan/10"
            >
              <Landmark size={15} /> Consultar en Mesa de Entradas Virtual PBA
            </button>
            <Link
              to="/portal/nuevo"
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-cyan px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-cyan/90"
            >
              <PlusCircle size={15} /> Nueva solicitud
            </Link>
          </div>
        </div>
      </section>

      {/* DGG-46 · Modal Mesa de Entradas Virtual PBA (TRAMIX) */}
      <TramixConsultaModal open={tramixOpen} onClose={() => setTramixOpen(false)} />

      {/* Stats */}
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatBox label="Abiertos" value={stats.abiertos} tone="cyan" icon={CircleDot} />
        <StatBox label="Esperan acción tuya" value={stats.esperando} tone="amber" icon={AlertCircle} />
        <StatBox label="Resueltos" value={stats.resueltos} tone="emerald" icon={CheckCircle2} />
      </section>

      {/* Tabs */}
      <section className="flex items-center gap-1 rounded-2xl border border-slate-200 bg-white p-1">
        {(['abiertos','todos'] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`flex-1 rounded-xl px-3 py-1.5 text-sm font-semibold transition ${
              filter === f
                ? 'bg-brand-cyan-pale/80 text-brand-cyan'
                : 'text-brand-muted hover:text-brand-ink'
            }`}
          >
            {f === 'abiertos' ? 'Activos' : 'Todo el historial'}
          </button>
        ))}
      </section>

      {/* List */}
      {loading ? (
        <div className="space-y-2">
          {[0,1,2].map((i) => <Skeleton key={i} className="h-20 rounded-2xl" />)}
        </div>
      ) : visibleItems.length === 0 ? (
        <IllustratedEmpty
          illustration="lista"
          title={filter === 'abiertos' ? 'Sin gestiones activas' : 'Sin gestiones registradas'}
          description={filter === 'abiertos'
            ? 'Cuando inicies un trámite o nos lo derives, lo verás acá.'
            : 'Todavía no hay registros de gestiones.'}
          action={
            <Link to="/portal/nuevo" className="inline-flex items-center gap-2 rounded-xl bg-brand-cyan px-4 py-2 text-sm font-semibold text-white">
              <PlusCircle size={15} /> Solicitar nuevo servicio
            </Link>
          }
        />
      ) : (
        <ul className="space-y-2">
          {visibleItems.map((t) => (
            <li key={t.id}>
              <TramiteCard t={t} />
            </li>
          ))}
        </ul>
      )}

      {/* Bloque H / obs 12: el modal ya no se usa (avances tienen pantalla
          propia ahora). Se mantiene el componente abajo solo por compat con
          imports si quedaran sueltos. */}
    </div>
  );
}


// =========================================================================
// Componentes del timeline visual de avances
// =========================================================================

// =========================================================================

function StatBox({ label, value, tone, icon: Icon }: {
  label: string;
  value: number;
  tone: 'cyan' | 'amber' | 'emerald';
  icon: typeof CircleDot;
}) {
  const toneCls = {
    cyan: 'text-brand-cyan bg-brand-cyan-pale/40',
    amber: 'text-amber-700 bg-amber-50',
    emerald: 'text-emerald-700 bg-emerald-50',
  }[tone];
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-3 sm:p-4">
      <div className={`inline-grid h-8 w-8 place-items-center rounded-lg ${toneCls}`}>
        <Icon size={14} />
      </div>
      <p className="mt-2 font-display text-2xl font-bold tabular text-brand-ink leading-none">{value}</p>
      <p className="mt-1 text-[11px] text-brand-muted">{label}</p>
    </div>
  );
}

function TramiteCard({ t }: { t: ClienteTramite; onOpen?: (t: ClienteTramite) => void }) {
  const estadoInfo = ESTADOS[t.estado] ?? { label: t.estado, tone: 'slate' as const, icon: FileText };
  const isReadOnly = ['resuelto','cerrado','cancelado'].includes(t.estado);
  // Bloque H / obs 12: navegamos a pantalla propia en lugar de abrir modal.
  // Pasamos el tramite via state para evitar refetch (mejor UX, sin spinner).
  return (
    <Link
      to={`/portal/gestiones/${t.id}`}
      state={{ tramite: t }}
      className={`group block w-full text-left rounded-2xl border bg-white p-4 transition hover:border-brand-cyan hover:shadow-md ${isReadOnly ? 'border-slate-200 opacity-90' : 'border-slate-200'}`}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex items-start gap-3 sm:flex-1">
          <span className={`grid h-10 w-10 flex-shrink-0 place-items-center rounded-xl ${TONES[estadoInfo.tone]}`}>
            <estadoInfo.icon size={16} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate font-semibold text-brand-ink">{t.titulo}</p>
              <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase ${TONE_BADGE[estadoInfo.tone]}`}>
                {estadoInfo.label}
              </span>
            </div>
            <p className="mt-0.5 text-[11px] text-brand-muted">
              <span className="font-mono">{t.codigo}</span>
              {' · '}
              {labelCategoria(t.categoria)}
              {t.total_comentarios > 0 && ` · ${t.total_comentarios} comentario${t.total_comentarios > 1 ? 's' : ''}`}
            </p>
            <p className="mt-1 inline-flex items-center gap-1 text-[11px] text-brand-muted">
              <Clock size={10} /> {formatActividad(t.horas_desde_actividad)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1 self-end text-sm font-semibold text-brand-cyan transition group-hover:gap-1.5 sm:self-center">
          <span className="hidden sm:inline">{isReadOnly ? 'Ver' : 'Detalle'}</span>
          <ChevronRight size={14} />
        </div>
      </div>
    </Link>
  );
}

// =========================================================================
// Diccionarios visuales
// =========================================================================
type Tone = 'cyan' | 'amber' | 'emerald' | 'rose' | 'slate';

const TONES: Record<Tone, string> = {
  cyan: 'bg-brand-cyan-pale/60 text-brand-cyan',
  amber: 'bg-amber-50 text-amber-700',
  emerald: 'bg-emerald-50 text-emerald-700',
  rose: 'bg-rose-50 text-rose-700',
  slate: 'bg-slate-100 text-slate-600',
};

const TONE_BADGE: Record<Tone, string> = {
  cyan: 'bg-brand-cyan-pale text-brand-cyan ring-1 ring-inset ring-brand-cyan/30',
  amber: 'bg-amber-100 text-amber-800 ring-1 ring-inset ring-amber-300',
  emerald: 'bg-emerald-100 text-emerald-800 ring-1 ring-inset ring-emerald-300',
  rose: 'bg-rose-100 text-rose-800 ring-1 ring-inset ring-rose-300',
  slate: 'bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-300',
};

const ESTADOS: Record<string, { label: string; tone: Tone; icon: typeof FileText }> = {
  abierto:           { label: 'Abierto', tone: 'cyan', icon: CircleDot },
  en_progreso:       { label: 'En curso', tone: 'cyan', icon: ArrowRight },
  esperando_cliente: { label: 'Tu acción', tone: 'amber', icon: AlertCircle },
  resuelto:          { label: 'Resuelto', tone: 'emerald', icon: CheckCircle2 },
  cerrado:           { label: 'Cerrado', tone: 'slate', icon: CheckCircle2 },
  cancelado:         { label: 'Cancelado', tone: 'rose', icon: XCircle },
};

function labelCategoria(c: string): string {
  const map: Record<string, string> = {
    matricula: 'Matrícula',
    dj: 'Declaración jurada',
    consulta_juridica: 'Consulta jurídica',
    renovacion: 'Renovación',
    curso: 'Curso',
    reclamo: 'Reclamo',
    otro: 'Otro',
  };
  return map[c] ?? c;
}

function formatActividad(horas: number | null): string {
  if (horas == null || !isFinite(horas)) return 'Sin actividad reciente';
  if (horas < 1) return 'Actualizado hace minutos';
  if (horas < 24) return `Actualizado hace ${Math.round(horas)} h`;
  const dias = Math.round(horas / 24);
  return dias === 1 ? 'Actualizado ayer' : `Actualizado hace ${dias} días`;
}
