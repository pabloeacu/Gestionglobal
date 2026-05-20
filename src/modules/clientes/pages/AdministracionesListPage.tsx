import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from '@/lib/toast';
import {
  Plus,
  Search,
  Building2,
  ChevronRight,
  Filter,
} from 'lucide-react';
import {
  Button,
  Field,
  Input,
  Select,
  SkeletonRow,
  AnimatedNumber,
} from '@/components/common';
import { AdministracionFormDrawer } from '../components/AdministracionFormDrawer';
import {
  listAdministraciones,
  type AdministracionListItem,
  type AdministracionEstado,
} from '@/services/api/administraciones';

type Estado = AdministracionEstado | 'todos';

const ESTADO_BADGES: Record<AdministracionEstado, { label: string; cls: string }> = {
  activo: { label: 'Activo', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  prospecto: { label: 'Prospecto', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  suspendido: { label: 'Suspendido', cls: 'bg-orange-50 text-orange-700 border-orange-200' },
  baja: { label: 'Baja', cls: 'bg-slate-100 text-slate-600 border-slate-200' },
};

export function AdministracionesListPage() {
  const [search, setSearch] = useState('');
  const [estado, setEstado] = useState<Estado>('activo');
  const [rows, setRows] = useState<AdministracionListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    const res = await listAdministraciones({ search, estado });
    setLoading(false);
    if (!res.ok) {
      setError(res.error.message);
      toast.error(`No pudimos cargar las administraciones: ${res.error.message}`);
      return;
    }
    setRows(res.data.rows);
    setTotal(res.data.total);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => void load(), 320);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const kpis = useMemo(() => {
    const activos = rows.filter((r) => r.estado === 'activo').length;
    const prospectos = rows.filter((r) => r.estado === 'prospecto').length;
    const consorcios = rows.reduce((s, r) => s + (r.consorcios_count ?? 0), 0);
    return { activos, prospectos, consorcios };
  }, [rows]);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="kicker text-brand-cyan">Clientes</p>
          <h1 className="font-display text-3xl font-bold text-brand-ink sm:text-4xl">
            Administraciones
          </h1>
          <p className="mt-1 text-sm text-brand-muted">
            Cada administración agrupa N consorcios y centraliza facturación,
            trámites y portal.
          </p>
        </div>
        <Button onClick={() => setDrawerOpen(true)}>
          <Plus size={16} /> Nueva administración
        </Button>
      </header>

      {/* KPI mini-cards */}
      <section className="grid grid-cols-3 gap-3">
        <Kpi label="En la vista" value={total} hint={`${rows.length} cargadas`} />
        <Kpi label="Activos" value={kpis.activos} tone="cyan" />
        <Kpi label="Consorcios" value={kpis.consorcios} tone="teal" />
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
              placeholder="Nombre, código o CUIT…"
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
              onChange={(e) => setEstado(e.target.value as Estado)}
              className="pl-9"
            >
              <option value="todos">Todos</option>
              <option value="activo">Activos</option>
              <option value="prospecto">Prospectos</option>
              <option value="suspendido">Suspendidos</option>
              <option value="baja">Bajas</option>
            </Select>
          </div>
        </Field>
      </section>

      {/* Table */}
      <section className="card-premium overflow-hidden">
        {loading ? (
          <div className="divide-y divide-slate-100">
            {Array.from({ length: 5 }).map((_, i) => (
              <SkeletonRow key={i} cols={5} />
            ))}
          </div>
        ) : error ? (
          <div className="p-8 text-center text-sm text-red-600">{error}</div>
        ) : rows.length === 0 ? (
          <EmptyState onCreate={() => setDrawerOpen(true)} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-brand-zebra/40 text-left text-[11px] font-semibold uppercase tracking-wider text-brand-muted">
                  <th className="px-4 py-3">Administración</th>
                  <th className="px-4 py-3">Código</th>
                  <th className="px-4 py-3">CUIT</th>
                  <th className="px-4 py-3 text-right">Consorcios</th>
                  <th className="px-4 py-3">Estado</th>
                  <th className="px-4 py-3 w-10"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, idx) => {
                  const badge = ESTADO_BADGES[r.estado as AdministracionEstado];
                  return (
                    <tr
                      key={r.id}
                      className="group border-b border-slate-100 transition-colors hover:bg-brand-zebra/40 motion-safe:animate-fade-up"
                      style={{ animationDelay: `${Math.min(idx, 12) * 35}ms` }}
                    >
                      <td className="px-4 py-3">
                        <Link
                          to={`/gerencia/clientes/${r.id}`}
                          className="flex items-center gap-3 font-medium text-brand-ink transition group-hover:text-brand-cyan"
                        >
                          <span className="grid h-9 w-9 place-items-center rounded-lg bg-brand-cyan-pale/40 text-brand-cyan transition group-hover:scale-105 group-hover:bg-brand-cyan group-hover:text-white">
                            <Building2 size={16} />
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate">{r.nombre}</span>
                            <span className="block truncate text-xs text-brand-muted">
                              {r.responsable_nombre || r.responsable_apellido
                                ? `${r.responsable_nombre ?? ''} ${r.responsable_apellido ?? ''}`.trim()
                                : '—'}
                            </span>
                          </span>
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-brand-muted">{r.codigo}</td>
                      <td className="px-4 py-3 tabular text-brand-muted">
                        {r.cuit ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-right tabular font-medium text-brand-ink">
                        {r.consorcios_count}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-block rounded-full border px-2 py-0.5 text-[11px] font-semibold ${badge?.cls ?? ''}`}
                        >
                          {badge?.label ?? r.estado}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          to={`/gerencia/clientes/${r.id}`}
                          className="inline-flex text-brand-muted transition-transform group-hover:translate-x-1 group-hover:text-brand-cyan"
                          aria-label="Abrir ficha"
                        >
                          <ChevronRight size={16} />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <AdministracionFormDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onSaved={() => void load()}
      />
    </div>
  );
}

function Kpi({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: number;
  hint?: string;
  tone?: 'cyan' | 'teal';
}) {
  const ring =
    tone === 'cyan'
      ? 'border-brand-cyan/30 hover:border-brand-cyan/60'
      : tone === 'teal'
        ? 'border-brand-teal/30 hover:border-brand-teal/60'
        : 'border-slate-200 hover:border-slate-300';
  return (
    <div
      className={`group relative overflow-hidden rounded-2xl border ${ring} bg-white p-4 transition hover:-translate-y-0.5`}
    >
      {tone && (
        <span
          aria-hidden
          className={`pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full blur-2xl transition-opacity duration-500 ${
            tone === 'cyan' ? 'bg-brand-cyan/15' : 'bg-brand-teal/15'
          } opacity-0 group-hover:opacity-100`}
        />
      )}
      <p className="kicker text-brand-muted">{label}</p>
      <p className="mt-1 font-display text-2xl font-bold tabular text-brand-ink">
        <AnimatedNumber value={value} />
      </p>
      {hint && <p className="text-xs text-brand-muted">{hint}</p>}
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 p-12 text-center">
      <span className="grid h-14 w-14 place-items-center rounded-2xl bg-brand-cyan-pale/40 text-brand-cyan">
        <Building2 size={24} />
      </span>
      <h3 className="font-display text-xl font-bold">Todavía no hay administraciones</h3>
      <p className="max-w-sm text-sm text-brand-muted">
        Las administraciones son tus clientes contractuales. Cada una agrupa los
        consorcios y centraliza facturación, trámites y portal.
      </p>
      <Button onClick={onCreate} className="mt-1">
        <Plus size={15} /> Crear la primera
      </Button>
    </div>
  );
}
