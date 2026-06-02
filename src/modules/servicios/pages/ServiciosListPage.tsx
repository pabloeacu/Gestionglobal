import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from '@/lib/toast';
import {
  Plus,
  Search,
  Briefcase,
  TrendingUp,
  ChevronRight,
  Layers,
  AlertCircle,
  Power,
  PowerOff,
} from 'lucide-react';
import {
  Button,
  Field,
  Input,
  Select,
  SkeletonRow,
  AnimatedNumber,
  useConfirm,
} from '@/components/common';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import { IllustratedEmpty } from '@/components/brand/IllustratedEmpty';
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh';
import { cn } from '@/lib/cn';
import {
  listCategorias,
  listServicios,
  desactivarServicio,
  activarServicio,
  PRECIO_MODOS,
  PRECIO_MODO_LABEL,
  type PrecioModo,
  type CategoriaServicioRow,
  type ServicioListItem,
} from '@/services/api/servicios';
import { ServicioFormDrawer } from '../components/ServicioFormDrawer';
import { AjusteMasivoModal } from '../components/AjusteMasivoModal';
import { humanizeError } from '@/lib/errors';

type ModalidadFiltro = PrecioModo | 'todas';

export function ServiciosListPage() {
  const [categorias, setCategorias] = useState<CategoriaServicioRow[]>([]);
  const [categoriaCodigo, setCategoriaCodigo] = useState<string>('todas');
  const [modalidad, setModalidad] = useState<ModalidadFiltro>('todas');
  const [soloActivos, setSoloActivos] = useState(true);
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<ServicioListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [ajusteOpen, setAjusteOpen] = useState(false);
  const confirm = useConfirm();

  async function loadCategorias() {
    const r = await listCategorias();
    if (r.ok) setCategorias(r.data);
  }

  async function load() {
    setLoading(true);
    setError(null);
    const r = await listServicios({
      categoriaCodigo: categoriaCodigo === 'todas' ? undefined : categoriaCodigo,
      modalidad: modalidad === 'todas' ? undefined : modalidad,
      soloActivos,
      search,
    });
    setLoading(false);
    if (!r.ok) {
      setError(humanizeError(r.error));
      toast.error(`No pudimos cargar los servicios: ${humanizeError(r.error)}`);
      return;
    }
    setRows(r.data);
  }

  useEffect(() => {
    void loadCategorias();
  }, []);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoriaCodigo, modalidad, soloActivos]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  useRealtimeRefresh(
    ['servicios', 'tabulador_precios', 'categorias_servicio'],
    () => void load(),
  );

  const kpis = useMemo(() => {
    const activos = rows.filter((r) => r.activo).length;
    // "Con precio vigente" cuenta servicios con al menos un canal con precio
    // (público o cliente). Servicios con ambos null son los que no se ofrecen
    // por ningún canal.
    const con_precio = rows.filter(
      (r) =>
        typeof r.precio_publico === 'number' ||
        typeof r.precio_cliente === 'number',
    ).length;
    const total_precios = rows.reduce(
      (s, r) => s + (Number(r.precio_publico ?? r.precio_cliente ?? 0)),
      0,
    );
    return { activos, con_precio, total_precios };
  }, [rows]);

  const grouped = useMemo(() => {
    const map = new Map<string, ServicioListItem[]>();
    for (const r of rows) {
      const k = r.categoria_codigo || '_sin';
      const list = map.get(k) ?? [];
      list.push(r);
      map.set(k, list);
    }
    return map;
  }, [rows]);

  async function toggleActivo(s: ServicioListItem) {
    if (s.activo) {
      const ok = await confirm({
        title: `Desactivar “${s.nombre}”`,
        message:
          'El servicio dejará de aparecer en el wizard de emisión y en los formularios públicos. Podés reactivarlo después.',
        confirmLabel: 'Desactivar',
        danger: true,
      });
      if (!ok) return;
      const r = await desactivarServicio(s.id);
      if (!r.ok) {
        toast.error(humanizeError(r.error));
        return;
      }
      toast.success('Servicio desactivado.');
    } else {
      const r = await activarServicio(s.id);
      if (!r.ok) {
        toast.error(humanizeError(r.error));
        return;
      }
      toast.success('Servicio activado.');
    }
    void load();
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <section className="card-premium relative overflow-hidden p-6 motion-safe:animate-fade-up">
        <TrianglesAccent position="top-right" size={180} tone="cyan" />
        <div className="relative z-10 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="kicker">Catálogo y tabulador</p>
            <h1 className="font-display text-2xl font-bold text-brand-ink sm:text-3xl">
              Servicios
            </h1>
            <p className="mt-1 max-w-xl text-sm text-brand-muted">
              Subsistemas 3 + 5 · catálogo extensible con precios fijos, por
              consorcio, por unidad funcional, convenios y preferenciales.
              Cada cambio queda en bitácora.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              onClick={() => setAjusteOpen(true)}
              type="button"
            >
              <TrendingUp size={16} /> Ajuste masivo
            </Button>
            <Button onClick={() => setDrawerOpen(true)} type="button">
              <Plus size={16} /> Nuevo servicio
            </Button>
          </div>
        </div>

        <div className="relative z-10 mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Kpi
            label="Servicios visibles"
            value={rows.length}
            icon={<Briefcase size={16} />}
          />
          <Kpi
            label="Activos"
            value={kpis.activos}
            icon={<Power size={16} />}
          />
          <Kpi
            label="Con precio vigente"
            value={kpis.con_precio}
            icon={<Layers size={16} />}
          />
        </div>
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[240px_1fr]">
        {/* Sidebar categorías */}
        <aside className="card-premium h-fit p-4">
          <p className="kicker mb-3">Categorías</p>
          <ul className="space-y-1">
            <CategoriaItem
              label="Todas"
              active={categoriaCodigo === 'todas'}
              count={rows.length}
              onClick={() => setCategoriaCodigo('todas')}
            />
            {categorias.map((c) => {
              const list = grouped.get(c.codigo) ?? [];
              return (
                <CategoriaItem
                  key={c.id}
                  label={c.nombre}
                  active={categoriaCodigo === c.codigo}
                  count={list.length}
                  onClick={() => setCategoriaCodigo(c.codigo)}
                />
              );
            })}
          </ul>
        </aside>

        {/* Tabla / lista */}
        <section className="space-y-4">
          {/* Filtros */}
          <div className="card-premium flex flex-wrap items-end gap-3 p-4">
            <Field label="Buscar" className="min-w-[220px] flex-1">
              <div className="relative">
                <Search
                  size={16}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-brand-muted"
                />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Nombre, código o descripción"
                  className="pl-9"
                />
              </div>
            </Field>
            <Field label="Modalidad" className="min-w-[180px]">
              <Select
                value={modalidad}
                onChange={(e) =>
                  setModalidad(e.target.value as ModalidadFiltro)
                }
              >
                <option value="todas">Todas</option>
                {PRECIO_MODOS.map((m) => (
                  <option key={m} value={m}>
                    {PRECIO_MODO_LABEL[m]}
                  </option>
                ))}
              </Select>
            </Field>
            <label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-brand-ink">
              <input
                type="checkbox"
                checked={soloActivos}
                onChange={(e) => setSoloActivos(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-brand-cyan"
              />
              Sólo activos
            </label>
          </div>

          {/* Lista */}
          <div className="card-premium overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-brand-zebra text-left text-xs uppercase tracking-wide text-brand-muted">
                <tr>
                  <th className="px-4 py-3">Servicio</th>
                  <th className="px-4 py-3">Modalidad</th>
                  <th className="px-4 py-3 text-right">Precio público</th>
                  <th className="px-4 py-3 text-right">Precio cliente</th>
                  <th className="px-4 py-3">Estado</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading &&
                  Array.from({ length: 4 }).map((_, i) => (
                    <tr key={i}>
                      <td colSpan={6} className="px-4 py-3">
                        <SkeletonRow />
                      </td>
                    </tr>
                  ))}

                {!loading && error && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center">
                      <div className="inline-flex items-center gap-2 text-red-600">
                        <AlertCircle size={16} /> {error}
                      </div>
                    </td>
                  </tr>
                )}

                {!loading && !error && rows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-10">
                      <IllustratedEmpty
                        illustration="lista"
                        title="Todavía no hay servicios"
                        description="Cargá el primero del catálogo: gestoría RPAC, cursos, asesoría jurídica o tu plataforma SaaS."
                        action={
                          <Button onClick={() => setDrawerOpen(true)}>
                            <Plus size={16} /> Nuevo servicio
                          </Button>
                        }
                      />
                    </td>
                  </tr>
                )}

                {!loading &&
                  !error &&
                  rows.map((r) => (
                    <tr
                      key={r.id}
                      className="motion-safe:animate-fade-up hover:bg-slate-50"
                    >
                      <td className="px-4 py-3">
                        <Link
                          to={`/gerencia/servicios/${r.id}`}
                          className="block"
                        >
                          <p className="font-medium text-brand-ink">
                            {r.nombre}
                          </p>
                          <p className="text-xs text-brand-muted">
                            {r.categoria_nombre} · {r.codigo}
                          </p>
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-brand-muted">
                        {PRECIO_MODO_LABEL[r.precio_modo as PrecioModo] ??
                          r.precio_modo}
                      </td>
                      <td className="px-4 py-3 text-right font-medium tabular-nums text-brand-ink">
                        <PrecioCol value={r.precio_publico} />
                      </td>
                      <td className="px-4 py-3 text-right font-medium tabular-nums text-brand-ink">
                        <PrecioCol value={r.precio_cliente} />
                      </td>
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => void toggleActivo(r)}
                          className={cn(
                            'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium transition',
                            r.activo
                              ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                              : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100',
                          )}
                        >
                          {r.activo ? (
                            <Power size={12} />
                          ) : (
                            <PowerOff size={12} />
                          )}
                          {r.activo ? 'Activo' : 'Inactivo'}
                        </button>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          to={`/gerencia/servicios/${r.id}`}
                          className="inline-flex items-center gap-1 text-sm font-medium text-brand-cyan hover:text-brand-blue"
                        >
                          Detalle <ChevronRight size={14} />
                        </Link>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <ServicioFormDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onSaved={() => void load()}
        categorias={categorias}
      />
      <AjusteMasivoModal
        open={ajusteOpen}
        onClose={() => setAjusteOpen(false)}
        onApplied={() => void load()}
      />
    </div>
  );
}

function Kpi({
  label,
  value,
  icon,
}: {
  label: string;
  value: number;
  icon?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-slate-100 bg-white/80 p-3 backdrop-blur">
      <p className="kicker flex items-center gap-1 text-brand-muted">
        {icon} {label}
      </p>
      <p className="font-display text-xl font-bold text-brand-ink">
        <AnimatedNumber value={value} />
      </p>
    </div>
  );
}

function CategoriaItem({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          'flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition',
          active
            ? 'bg-brand-cyan-pale/50 text-brand-ink'
            : 'text-brand-muted hover:bg-slate-50 hover:text-brand-ink',
        )}
      >
        <span className="truncate">{label}</span>
        <span className="text-xs tabular-nums">{count}</span>
      </button>
    </li>
  );
}

/**
 * Muestra un precio TOTAL (público o cliente). Si es null = el servicio NO se
 * ofrece por ese canal — chip discreto. Si es 0 = gratis. Si tiene valor =
 * formato ARS animado.
 */
function PrecioCol({ value }: { value: number | null | undefined }) {
  if (value == null) {
    return (
      <span className="text-xs italic text-brand-muted/80">no se ofrece</span>
    );
  }
  return (
    <AnimatedNumber
      value={Number(value)}
      format={(n) =>
        n.toLocaleString('es-AR', {
          style: 'currency',
          currency: 'ARS',
          maximumFractionDigits: 0,
        })
      }
    />
  );
}
