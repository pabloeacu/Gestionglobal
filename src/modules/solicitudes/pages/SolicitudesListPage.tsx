import { useEffect, useMemo, useState } from 'react';
import {
  Eye,
  Inbox,
  Send,
  Sparkles,
  Search,
  Filter,
} from 'lucide-react';
import {
  AnimatedNumber,
  Field,
  Input,
  Select,
} from '@/components/common';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import { IllustratedEmpty } from '@/components/brand/IllustratedEmpty';
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh';
import {
  getKpis,
  listSolicitudes,
  type SolicitudEstado,
  type SolicitudListItem,
  type SolicitudesKpis,
} from '@/services/api/solicitudes';
import {
  SolicitudCard,
  SolicitudCardSkeleton,
} from '../components/SolicitudCard';

type EstadoFilter = SolicitudEstado | 'todos' | 'activas';

export function SolicitudesListPage() {
  const [rows, setRows] = useState<SolicitudListItem[]>([]);
  const [kpis, setKpis] = useState<SolicitudesKpis | null>(null);
  const [loading, setLoading] = useState(true);
  const [estado, setEstado] = useState<EstadoFilter>('activas');
  const [search, setSearch] = useState('');

  async function reload() {
    setLoading(true);
    const [r1, r2] = await Promise.all([
      listSolicitudes({ estado, search }),
      getKpis(),
    ]);
    setLoading(false);
    if (r1.ok) setRows(r1.data.rows);
    if (r2.ok) setKpis(r2.data);
  }

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  useEffect(() => {
    const t = setTimeout(() => void reload(), 280);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  useRealtimeRefresh(['solicitudes', 'solicitud_derivaciones'], reload);

  const kpiCards = useMemo(
    () => [
      {
        label: 'Recibidas',
        value: kpis?.recibidas ?? 0,
        icon: Inbox,
        tone: 'cyan' as const,
      },
      {
        label: 'En revisión',
        value: kpis?.en_revision ?? 0,
        icon: Eye,
        tone: 'amber' as const,
      },
      {
        label: 'Derivadas',
        value: kpis?.derivadas ?? 0,
        icon: Send,
        tone: 'violet' as const,
      },
      {
        label: 'Activadas hoy',
        value: kpis?.activadas_hoy ?? 0,
        icon: Sparkles,
        tone: 'emerald' as const,
      },
    ],
    [kpis],
  );

  return (
    <div className="relative mx-auto max-w-6xl space-y-6">
      <TrianglesAccent
        position="top-right"
        size={240}
        tone="cyan"
        density="soft"
        className="opacity-40"
      />

      {/* Header */}
      <header>
        <p className="kicker text-brand-cyan">Operación</p>
        <h1 className="font-display text-3xl font-bold text-brand-ink sm:text-4xl">
          Solicitudes recibidas
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-brand-muted">
          Cada formulario público se convierte automáticamente en una solicitud
          operativa. Acá las revisás, derivás a gestoría y las activás como
          tracking del cliente.
        </p>
      </header>

      {/* KPIs */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {kpiCards.map((k) => (
          <KpiCard key={k.label} {...k} />
        ))}
      </section>

      {/* Toolbar */}
      <section className="card-premium flex flex-col gap-3 p-4 sm:flex-row sm:items-end">
        <Field label="Buscar solicitante" className="flex-1">
          <div className="relative">
            <Search
              size={15}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-brand-muted"
            />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Nombre, email o teléfono…"
              className="pl-9"
            />
          </div>
        </Field>
        <Field label="Estado" className="sm:w-48">
          <div className="relative">
            <Filter
              size={14}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-brand-muted"
            />
            <Select
              value={estado}
              onChange={(e) => setEstado(e.target.value as EstadoFilter)}
              className="pl-9"
            >
              <option value="activas">Activas (no procesadas)</option>
              <option value="recibida">Recibidas</option>
              <option value="en_revision">En revisión</option>
              <option value="derivada">Derivadas</option>
              <option value="activada">Activadas</option>
              <option value="descartada">Descartadas</option>
              <option value="todos">Todas</option>
            </Select>
          </div>
        </Field>
      </section>

      {/* Grilla de cards */}
      {loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <SolicitudCardSkeleton key={i} />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <IllustratedEmpty
          illustration="lista"
          title="Sin solicitudes en este filtro"
          description="Las solicitudes aparecen automáticamente cuando alguien envía un formulario público desde la landing."
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((r) => (
            <SolicitudCard key={r.id} s={r} />
          ))}
        </div>
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------

interface KpiCardProps {
  label: string;
  value: number;
  icon: typeof Inbox;
  tone: 'cyan' | 'amber' | 'violet' | 'emerald';
}

const TONE_CLASSES: Record<KpiCardProps['tone'], string> = {
  cyan: 'bg-brand-cyan-pale/40 text-brand-cyan',
  amber: 'bg-amber-50 text-amber-600',
  violet: 'bg-violet-50 text-violet-600',
  emerald: 'bg-emerald-50 text-emerald-600',
};

function KpiCard({ label, value, icon: Icon, tone }: KpiCardProps) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-sm motion-safe:animate-fade-up">
      <TrianglesAccent
        position="top-right"
        size={90}
        tone="cyan"
        density="soft"
        className="opacity-30"
      />
      <div className="relative flex items-center gap-3">
        <span
          className={`grid h-9 w-9 place-items-center rounded-xl ${TONE_CLASSES[tone]}`}
        >
          <Icon size={16} />
        </span>
        <div className="min-w-0">
          <p className="kicker truncate text-brand-muted">{label}</p>
          <p className="font-display text-2xl font-bold tabular text-brand-ink">
            <AnimatedNumber value={value} />
          </p>
        </div>
      </div>
    </div>
  );
}
