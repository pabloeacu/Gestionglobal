import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
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
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import { IllustratedEmpty } from '@/components/brand/IllustratedEmpty';
import { AdministracionFormDrawer } from '../components/AdministracionFormDrawer';
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh';
import {
  listAdministraciones,
  type AdministracionListItem,
  type AdministracionEstado,
} from '@/services/api/administraciones';
import { ExportButtons } from '@/components/reports/ExportButtons';
import { generateReportPdf } from '@/lib/reportPdf';
import { generateReportXls } from '@/lib/reportXls';
import { humanizeError } from '@/lib/errors';

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
  const [searchParams, setSearchParams] = useSearchParams();

  // Abrir el drawer si vienen desde el command palette con ?new=1
  useEffect(() => {
    if (searchParams.get('new') === '1') {
      setDrawerOpen(true);
      searchParams.delete('new');
      setSearchParams(searchParams, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  async function load() {
    setLoading(true);
    setError(null);
    const res = await listAdministraciones({ search, estado });
    setLoading(false);
    if (!res.ok) {
      setError(humanizeError(res.error));
      toast.error(`No pudimos cargar las administraciones: ${humanizeError(res.error)}`);
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

  // Realtime: si alguien crea/edita en otra sesión, refrescamos.
  useRealtimeRefresh(['administraciones', 'consorcios'], () => {
    void load();
  });

  const kpis = useMemo(() => {
    const activos = rows.filter((r) => r.estado === 'activo').length;
    const prospectos = rows.filter((r) => r.estado === 'prospecto').length;
    const consorcios = rows.reduce((s, r) => s + (r.consorcios_count ?? 0), 0);
    return { activos, prospectos, consorcios };
  }, [rows]);

  // DGG-26 · Export a PDF/XLS del filtrado actual.
  const exportFiltros = useMemo<Array<{ label: string; value: string }>>(() => {
    const items: Array<{ label: string; value: string }> = [];
    items.push({
      label: 'Estado',
      value:
        estado === 'todos' ? 'Todos'
        : estado === 'activo' ? 'Activos'
        : estado === 'prospecto' ? 'Prospectos'
        : estado === 'suspendido' ? 'Suspendidos'
        : 'Bajas',
    });
    if (search.trim()) items.push({ label: 'Búsqueda', value: search.trim() });
    return items;
  }, [estado, search]);

  async function onExportPdf() {
    await generateReportPdf<AdministracionListItem>({
      filename: `administraciones-${new Date().toISOString().slice(0, 10)}`,
      titulo: 'Administraciones',
      subtitulo: 'Clientes contractuales · Gestión Global',
      filtros: exportFiltros,
      kpis: [
        { label: 'En la vista', value: String(rows.length), tone: 'cyan' },
        { label: 'Activos', value: String(kpis.activos), tone: 'emerald' },
        { label: 'Prospectos', value: String(kpis.prospectos), tone: 'amber' },
        { label: 'Consorcios', value: String(kpis.consorcios), tone: 'cyan' },
      ],
      columns: [
        { key: 'nombre', label: 'Administración', width: '28%' },
        { key: 'codigo', label: 'Código', width: '10%' },
        { key: 'cuit', label: 'CUIT', width: '14%', format: (r) => r.cuit ?? '—' },
        { key: 'email', label: 'Email', width: '20%', format: (r) => r.email ?? '—' },
        { key: 'telefono', label: 'Teléfono', width: '14%', format: (r) => r.telefono ?? '—' },
        { key: 'estado', label: 'Estado', width: '14%',
          format: (r) => ESTADO_BADGES[r.estado as AdministracionEstado]?.label ?? r.estado },
      ],
      rows,
    });
  }

  async function onExportXls() {
    generateReportXls<AdministracionListItem>({
      filename: `administraciones-${new Date().toISOString().slice(0, 10)}`,
      sheetName: 'Administraciones',
      titulo: 'Administraciones · Gestión Global',
      filtros: exportFiltros,
      columns: [
        { key: 'nombre', label: 'Administración', width: 32 },
        { key: 'codigo', label: 'Código', width: 14 },
        { key: 'cuit', label: 'CUIT', width: 16 },
        { key: 'email', label: 'Email', width: 28 },
        { key: 'telefono', label: 'Teléfono', width: 18 },
        { key: 'consorcios_count', label: 'Consorcios',
          value: (r) => Number(r.consorcios_count ?? 0), width: 12 },
        { key: 'estado', label: 'Estado', width: 14,
          value: (r) => ESTADO_BADGES[r.estado as AdministracionEstado]?.label ?? r.estado },
      ],
      rows,
    });
  }

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
        <div className="flex flex-wrap items-center gap-2">
          <ExportButtons
            onExportPdf={onExportPdf}
            onExportXls={onExportXls}
            disabled={rows.length === 0}
            hint="Administraciones"
          />
          <Button onClick={() => setDrawerOpen(true)}>
            <Plus size={16} /> Nueva administración
          </Button>
        </div>
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
      <section className="card-premium relative overflow-hidden">
        <TrianglesAccent
          position="top-right"
          size={140}
          tone="cyan"
          density="soft"
          className="opacity-25"
        />
        <div className="relative">
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
                          {r.responsable_avatar_url ? (
                            <img
                              src={r.responsable_avatar_url}
                              alt=""
                              className="h-9 w-9 flex-shrink-0 rounded-lg object-cover ring-1 ring-slate-200 transition group-hover:scale-105 group-hover:ring-brand-cyan"
                            />
                          ) : (
                            <span className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-lg bg-brand-cyan-pale/40 text-brand-cyan transition group-hover:scale-105 group-hover:bg-brand-cyan group-hover:text-white">
                              <Building2 size={16} />
                            </span>
                          )}
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
        </div>
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
      {/* Marca de agua de triángulos en la esquina */}
      <TrianglesAccent
        position="top-right"
        size={120}
        tone={tone ?? 'cyan'}
        density="soft"
        className="opacity-40"
      />
      {tone && (
        <span
          aria-hidden
          className={`pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full blur-2xl transition-opacity duration-500 ${
            tone === 'cyan' ? 'bg-brand-cyan/15' : 'bg-brand-teal/15'
          } opacity-0 group-hover:opacity-100`}
        />
      )}
      <div className="relative">
        <p className="kicker text-brand-muted">{label}</p>
        <p className="mt-1 font-display text-2xl font-bold tabular text-brand-ink">
          <AnimatedNumber value={value} />
        </p>
        {hint && <p className="text-xs text-brand-muted">{hint}</p>}
      </div>
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <IllustratedEmpty
      illustration="consorcio"
      title="Todavía no hay administraciones"
      description={
        <>
          Cada administración es tu cliente contractual: agrupa los consorcios,
          centraliza facturación y trámites, y dispara las plantillas de email.
          <br />
          Arrancá creando la primera y después le sumás los edificios.
        </>
      }
      action={
        <Button onClick={onCreate}>
          <Plus size={15} /> Crear la primera
        </Button>
      }
    />
  );
}
