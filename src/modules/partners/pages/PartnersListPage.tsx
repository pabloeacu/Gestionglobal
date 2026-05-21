import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Plus,
  Search,
  Handshake,
  Power,
  PowerOff,
  ChevronRight,
  TrendingUp,
  Users,
  Percent,
  type LucideIcon,
} from 'lucide-react';
import { toast } from '@/lib/toast';
import {
  Button,
  Field,
  Input,
  Select,
  Skeleton,
  AnimatedNumber,
  useConfirm,
} from '@/components/common';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import { IllustratedEmpty } from '@/components/brand/IllustratedEmpty';
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh';
import { cn } from '@/lib/cn';
import { PartnerFormDrawer } from '../components/PartnerFormDrawer';
import {
  listPartners,
  listRendiciones,
  setPartnerActivo,
  fmtMoneda,
  fmtPct,
  type PartnerListItem,
  type RendicionListItem,
} from '@/services/api/partners';

type ActivoFilter = 'todos' | 'activos' | 'inactivos';

export function PartnersListPage() {
  const confirm = useConfirm();
  const [rows, setRows] = useState<PartnerListItem[]>([]);
  const [rendiciones, setRendiciones] = useState<RendicionListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [activoFilter, setActivoFilter] = useState<ActivoFilter>('todos');
  const [drawerOpen, setDrawerOpen] = useState(false);

  async function load() {
    setLoading(true);
    const [p, r] = await Promise.all([
      listPartners({ limit: 200 }),
      listRendiciones({ limit: 200 }),
    ]);
    setLoading(false);
    if (!p.ok) {
      toast.error(`No pudimos cargar partners: ${p.error.message}`);
      return;
    }
    setRows(p.data.rows);
    if (r.ok) setRendiciones(r.data);
  }

  useEffect(() => {
    void load();
  }, []);

  useRealtimeRefresh(
    ['partners', 'partner_convenios', 'partner_rendiciones'],
    () => void load(),
  );

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (activoFilter === 'activos' && !r.activo) return false;
      if (activoFilter === 'inactivos' && r.activo) return false;
      if (search.trim().length > 0) {
        const s = search.trim().toLowerCase();
        const hay = [r.nombre_legal, r.slug, r.cuit, r.email]
          .filter(Boolean)
          .some((x) => x!.toLowerCase().includes(s));
        if (!hay) return false;
      }
      return true;
    });
  }, [rows, search, activoFilter]);

  const kpis = useMemo(() => {
    const activos = rows.filter((r) => r.activo).length;
    // Último mes: ingresos atribuidos en rendiciones (cualquier estado) cuyo
    // periodo_hasta cae en los últimos 31 días.
    const hace31 = new Date();
    hace31.setDate(hace31.getDate() - 31);
    const corte = hace31.toISOString().slice(0, 10);
    const ingresos = rendiciones
      .filter((r) => r.periodo_hasta >= corte)
      .reduce((acc, r) => acc + Number(r.total_ingresos_atribuidos ?? 0), 0);
    const promPct =
      rows.length > 0
        ? rows.reduce(
            (acc, r) => acc + Number(r.convenio_vigente_porc_ingresos ?? 0),
            0,
          ) / rows.length
        : 0;
    return { activos, ingresos, promPct };
  }, [rows, rendiciones]);

  async function onToggleActivo(p: PartnerListItem) {
    const okConf = await confirm({
      title: p.activo ? 'Desactivar partner' : 'Activar partner',
      message: p.activo
        ? `¿Desactivar ${p.nombre_legal}? Los convenios y rendiciones siguen en el histórico pero no se podrán crear nuevas.`
        : `¿Reactivar ${p.nombre_legal}?`,
      confirmLabel: p.activo ? 'Desactivar' : 'Activar',
      cancelLabel: 'Volver',
      danger: p.activo,
    });
    if (!okConf) return;
    const res = await setPartnerActivo(p.id, !p.activo);
    if (!res.ok) {
      toast.error(res.error.message);
      return;
    }
    toast.success(p.activo ? 'Partner desactivado' : 'Partner activado');
    void load();
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="kicker text-brand-cyan">Subsistema 6</p>
          <h1 className="font-display text-3xl font-bold text-brand-ink sm:text-4xl">
            Partners
          </h1>
          <p className="mt-1 text-sm text-brand-muted">
            Entidades con convenio que aportan clientes/proyectos. Se les rinde
            un % de los ingresos generados y comparten un % de los costos.
          </p>
        </div>
        <Button onClick={() => setDrawerOpen(true)}>
          <Plus size={16} /> Nuevo partner
        </Button>
      </header>

      {/* KPIs */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <KpiCard
          icon={Users}
          label="Partners activos"
          value={<AnimatedNumber value={kpis.activos} />}
          tone="cyan"
        />
        <KpiCard
          icon={TrendingUp}
          label="Ingresos atribuidos (30 d)"
          value={fmtMoneda(kpis.ingresos)}
          tone="emerald"
        />
        <KpiCard
          icon={Percent}
          label="% ingresos promedio"
          value={fmtPct(kpis.promPct)}
          tone="amber"
        />
      </section>

      {/* Toolbar */}
      <section className="card-premium flex flex-col gap-3 p-4 sm:flex-row sm:items-end">
        <Field label="Buscar" className="flex-1">
          <div className="relative">
            <Search
              size={15}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-brand-muted"
            />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Nombre, slug, CUIT o email"
              className="pl-9"
            />
          </div>
        </Field>
        <Field label="Estado" className="sm:w-48">
          <Select
            value={activoFilter}
            onChange={(e) => setActivoFilter(e.target.value as ActivoFilter)}
          >
            <option value="todos">Todos</option>
            <option value="activos">Activos</option>
            <option value="inactivos">Inactivos</option>
          </Select>
        </Field>
      </section>

      {/* Lista */}
      <section className="card-premium relative overflow-hidden p-5">
        <TrianglesAccent
          position="top-right"
          size={140}
          tone="cyan"
          density="soft"
          className="opacity-20"
        />
        <div className="relative">
          {loading ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-32 w-full rounded-2xl" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <IllustratedEmpty
              illustration="lista"
              title={
                rows.length === 0 ? 'Aún no hay partners' : 'Sin resultados'
              }
              description={
                <>
                  Registrá partners para vincular convenios y generar rendiciones
                  periódicas sobre el ecosistema.
                </>
              }
              action={
                <Button onClick={() => setDrawerOpen(true)}>
                  <Plus size={15} /> Nuevo partner
                </Button>
              }
            />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {filtered.map((p) => (
                <article
                  key={p.id}
                  className={cn(
                    'group relative flex flex-col gap-3 overflow-hidden rounded-2xl border bg-white p-4 shadow-sm transition hover:shadow-md',
                    p.activo
                      ? 'border-slate-200 hover:border-brand-cyan'
                      : 'border-slate-200 opacity-70 hover:border-slate-300',
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      'absolute inset-x-0 top-0 h-0.5 opacity-60',
                      p.activo
                        ? 'bg-gradient-to-r from-brand-cyan/0 via-brand-cyan/60 to-brand-cyan/0'
                        : 'bg-slate-300',
                    )}
                  />
                  <header className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <Handshake
                          size={15}
                          className="shrink-0 text-brand-cyan"
                        />
                        <p className="truncate text-[11px] font-semibold uppercase tracking-wider text-brand-muted">
                          {p.slug}
                        </p>
                      </div>
                      <h3 className="mt-1 truncate font-display text-base font-semibold text-brand-ink">
                        {p.nombre_legal}
                      </h3>
                      {p.cuit && (
                        <p className="truncate text-xs text-brand-muted">
                          CUIT {p.cuit}
                        </p>
                      )}
                    </div>
                    {!p.activo && (
                      <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                        Inactivo
                      </span>
                    )}
                  </header>

                  <dl className="grid grid-cols-2 gap-2 text-xs">
                    <div className="rounded-lg border border-slate-100 bg-brand-zebra/40 px-3 py-2">
                      <dt className="text-[10px] font-semibold uppercase tracking-wider text-brand-muted">
                        % Ingresos
                      </dt>
                      <dd className="mt-0.5 font-semibold text-brand-ink">
                        {fmtPct(p.convenio_vigente_porc_ingresos)}
                      </dd>
                    </div>
                    <div className="rounded-lg border border-slate-100 bg-brand-zebra/40 px-3 py-2">
                      <dt className="text-[10px] font-semibold uppercase tracking-wider text-brand-muted">
                        % Costos
                      </dt>
                      <dd className="mt-0.5 font-semibold text-brand-ink">
                        {fmtPct(p.convenio_vigente_porc_costos)}
                      </dd>
                    </div>
                  </dl>

                  <footer className="flex items-center justify-between">
                    <button
                      onClick={() => void onToggleActivo(p)}
                      className={cn(
                        'inline-flex items-center gap-1 text-xs font-medium transition',
                        p.activo
                          ? 'text-brand-muted hover:text-red-600'
                          : 'text-brand-muted hover:text-emerald-600',
                      )}
                      title={p.activo ? 'Desactivar' : 'Activar'}
                    >
                      {p.activo ? <PowerOff size={13} /> : <Power size={13} />}
                      {p.activo ? 'Desactivar' : 'Activar'}
                    </button>
                    <Link
                      to={`/gerencia/partners/${p.id}`}
                      className="inline-flex items-center gap-1 text-sm font-medium text-brand-cyan hover:underline"
                    >
                      Detalle <ChevronRight size={14} />
                    </Link>
                  </footer>
                </article>
              ))}
            </div>
          )}
        </div>
      </section>

      <PartnerFormDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onSaved={() => void load()}
      />
    </div>
  );
}

interface KpiCardProps {
  icon: LucideIcon;
  label: string;
  value: React.ReactNode;
  tone: 'cyan' | 'amber' | 'emerald';
}

const TONE: Record<KpiCardProps['tone'], string> = {
  cyan: 'bg-brand-cyan/10 text-brand-cyan',
  amber: 'bg-amber-50 text-amber-600',
  emerald: 'bg-emerald-50 text-emerald-600',
};

function KpiCard({ icon: Icon, label, value, tone }: KpiCardProps) {
  return (
    <div className="card-premium flex items-center gap-3 p-4">
      <span className={cn('grid h-10 w-10 place-items-center rounded-xl', TONE[tone])}>
        <Icon size={18} />
      </span>
      <div className="min-w-0">
        <p className="truncate text-[11px] font-semibold uppercase tracking-wider text-brand-muted">
          {label}
        </p>
        <p className="font-display text-2xl font-bold text-brand-ink">{value}</p>
      </div>
    </div>
  );
}
