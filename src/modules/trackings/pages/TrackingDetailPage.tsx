// ============================================================================
// TrackingDetailPage · Subsistema de Tracking (puntos 9-17 Flujo Maestro)
//
// Vive sobre la ruta `/gerencia/tramites/:id` (mismo path para no romper
// links; el detalle viejo `TramiteDetailPage` queda en src/modules/tramites/
// hasta que G1 lo refactorice).
//
// Premium UX: TrianglesAccent header + AnimatedNumber KPIs + tabs sticky +
// timeline categorizada + drawer "agregar línea" + cierre con doc final +
// recurrencia (trackings hermanos) + configuración custom de estados/categorías.
// Regla 13: useConfirm en lugar de window.confirm.
// ============================================================================
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Briefcase,
  CalendarRange,
  CheckCircle2,
  Clock,
  FileText,
  History,
  Layers,
  ListChecks,
  Paperclip,
  Plus,
  Settings,
  Sparkles,
} from 'lucide-react';
import { toast } from '@/lib/toast';
import {
  AnimatedNumber,
  Button,
  Tabs,
  useConfirm,
  usePrompt,
  type TabItem,
} from '@/components/common';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import { BrandLoader } from '@/components/brand/BrandLoader';
import { useAuth } from '@/contexts/AuthContext';
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh';
import { formatDateShort, formatDateTime } from '@/lib/dates';
import { cn } from '@/lib/cn';
import {
  getTracking,
  cerrarTracking,
  colorBadge,
  type TrackingDetail,
  type TrackingLineaRow,
} from '@/services/api/trackings';
import { LineaTrackingCard } from '../components/LineaTrackingCard';
import { AgregarLineaDrawer } from '../components/AgregarLineaDrawer';
import { RecurrenciaList } from '../components/RecurrenciaList';
import { EstadosConfigManager } from '../components/EstadosConfigManager';
import { CategoriasConfigManager } from '../components/CategoriasConfigManager';

type TabKey = 'resumen' | 'lineas' | 'documentacion' | 'recurrencia' | 'config';

export function TrackingDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const confirm = useConfirm();
  const prompt = usePrompt();

  const isStaff = user?.role === 'gerente' || user?.role === 'operador';

  const [data, setData] = useState<TrackingDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabKey>('resumen');
  const [filtroCategoria, setFiltroCategoria] = useState<string>('');
  const [drawerOpen, setDrawerOpen] = useState(false);

  async function load() {
    if (!id) return;
    setLoading(true);
    const res = await getTracking(id);
    setLoading(false);
    if (!res.ok) {
      toast.error(res.error.message);
      navigate('/gerencia/tramites');
      return;
    }
    setData(res.data);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useRealtimeRefresh(['tramites', 'tracking_lineas'], () => void load());

  const categoriaConfigMap = useMemo(() => {
    const m = new Map<string, TrackingDetail['categorias_disponibles'][number]>();
    if (data) for (const c of data.categorias_disponibles) m.set(c.slug, c);
    return m;
  }, [data]);

  const estadoConfigActual = useMemo(() => {
    if (!data) return null;
    return data.estados_disponibles.find((e) => e.slug === data.estado) ?? null;
  }, [data]);

  const lineasFiltradas = useMemo<TrackingLineaRow[]>(() => {
    if (!data) return [];
    if (!filtroCategoria) return data.lineas;
    return data.lineas.filter((l) => l.categoria === filtroCategoria);
  }, [data, filtroCategoria]);

  const adjuntosTodos = useMemo<{ url: string; fecha: string; categoria: string }[]>(() => {
    if (!data) return [];
    const out: { url: string; fecha: string; categoria: string }[] = [];
    for (const l of data.lineas) {
      for (const u of l.archivos_urls ?? []) {
        out.push({ url: u, fecha: l.created_at, categoria: l.categoria });
      }
    }
    return out;
  }, [data]);

  const lineasPendientes = useMemo(
    () => (data?.lineas ?? []).filter((l) => l.alerta_en && new Date(l.alerta_en).getTime() > Date.now()).length,
    [data],
  );

  async function handleCerrar() {
    if (!data) return;
    if (data.estado !== 'aprobado' && data.estado !== 'resuelto') {
      const cont = await confirm({
        title: 'Cerrar tracking',
        message: `El estado actual es "${data.estado}". ¿Cerrarlo igualmente?`,
        confirmLabel: 'Cerrar',
        danger: true,
      });
      if (!cont) return;
    }
    const url = await prompt({
      title: 'Cerrar tracking',
      message: 'URL del documento final (certificado / diploma):',
      placeholder: 'https://…',
    });
    if (!url) return;
    const res = await cerrarTracking(data.id, url);
    if (!res.ok) {
      toast.error(res.error.message);
      return;
    }
    toast.success('Tracking cerrado');
    void load();
  }

  if (loading || !data) {
    return (
      <div className="grid min-h-[60vh] place-items-center">
        <BrandLoader />
      </div>
    );
  }

  const tabs: TabItem[] = [
    { key: 'resumen', label: 'Resumen', icon: <Sparkles className="h-4 w-4" /> },
    {
      key: 'lineas',
      label: 'Líneas de avance',
      icon: <ListChecks className="h-4 w-4" />,
      badge: data.lineas.length,
    },
    {
      key: 'documentacion',
      label: 'Documentación',
      icon: <Paperclip className="h-4 w-4" />,
      badge: adjuntosTodos.length,
    },
    {
      key: 'recurrencia',
      label: 'Recurrencia',
      icon: <History className="h-4 w-4" />,
      hidden: !data.administracion || !data.servicio,
    },
    {
      key: 'config',
      label: 'Configuración',
      icon: <Settings className="h-4 w-4" />,
      hidden: !isStaff,
    },
  ];

  return (
    <div className="space-y-6 motion-safe:animate-fade-up">
      {/* Header premium */}
      <header className="relative overflow-hidden rounded-3xl border border-slate-200 bg-gradient-to-br from-white via-cyan-50/40 to-white p-6">
        <TrianglesAccent position="top-right" />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <Link
              to="/gerencia/tramites"
              className="inline-flex items-center gap-1 text-sm text-brand-muted hover:text-brand-ink"
            >
              <ArrowLeft className="h-4 w-4" /> Volver
            </Link>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold text-brand-ink">
                {data.servicio?.nombre ?? data.titulo}
              </h1>
              {data.periodo && (
                <span className="rounded-full bg-cyan-100 px-3 py-1 text-sm font-semibold text-cyan-700 ring-1 ring-cyan-200">
                  {data.periodo}
                </span>
              )}
              <span
                className={cn(
                  'inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ring-1',
                  colorBadge(estadoConfigActual?.color ?? 'slate'),
                )}
              >
                <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                {estadoConfigActual?.label ?? data.estado}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-brand-muted">
              <span className="font-mono text-xs">{data.codigo}</span>
              {data.administracion && (
                <span>
                  <Briefcase className="mr-1 inline h-3.5 w-3.5" />
                  {data.administracion.nombre}
                </span>
              )}
              {data.fecha_inicio && (
                <span>
                  <CalendarRange className="mr-1 inline h-3.5 w-3.5" />
                  Inicio: {formatDateShort(data.fecha_inicio)}
                </span>
              )}
              {data.fecha_fin && (
                <span>
                  Fin: {formatDateShort(data.fecha_fin)}
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button onClick={() => setDrawerOpen(true)}>
              <Plus className="h-4 w-4" /> Agregar línea
            </Button>
            {isStaff && data.estado !== 'cerrado' && (
              <Button variant="secondary" onClick={() => void handleCerrar()}>
                <CheckCircle2 className="h-4 w-4" /> Cerrar tracking
              </Button>
            )}
          </div>
        </div>

        {/* KPI strip */}
        <div className="relative mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          <KpiTile label="Líneas" value={data.lineas.length} icon={<ListChecks />} />
          <KpiTile label="Adjuntos" value={adjuntosTodos.length} icon={<Paperclip />} />
          <KpiTile label="Pendientes" value={lineasPendientes} icon={<Clock />} />
          <KpiTile
            label="Días abiertos"
            value={Math.max(
              0,
              Math.floor(
                (Date.now() - new Date(data.created_at).getTime()) / (1000 * 60 * 60 * 24),
              ),
            )}
            icon={<Layers />}
          />
        </div>
      </header>

      <div className="sticky top-0 z-10 bg-white/85 backdrop-blur">
        <Tabs items={tabs} activeKey={tab} onChange={(k) => setTab(k as TabKey)} />
      </div>

      {tab === 'resumen' && (
        <section className="grid gap-4 md:grid-cols-2">
          <Panel title="Datos">
            <Dl label="Servicio" value={data.servicio?.nombre ?? '—'} />
            <Dl label="Período" value={data.periodo ?? '—'} />
            <Dl label="Estado" value={estadoConfigActual?.label ?? data.estado} />
            <Dl label="Administración" value={data.administracion?.nombre ?? '—'} />
            <Dl label="Consorcio" value={data.consorcio?.nombre ?? '—'} />
            <Dl label="Documento final" value={data.documento_final_url ?? '—'} link={!!data.documento_final_url} />
          </Panel>

          <Panel title="Solicitante">
            <Dl label="Nombre" value={data.solicitante_nombre ?? '—'} />
            <Dl label="Email" value={data.solicitante_email ?? '—'} />
            <Dl label="Teléfono" value={data.solicitante_telefono ?? '—'} />
            <Dl label="Origen" value={data.formulario_submission_id ? 'Formulario público' : 'Manual'} />
            <Dl label="Creado" value={formatDateTime(data.created_at)} />
            <Dl label="Última actividad" value={formatDateTime(data.ultima_actividad_at)} />
          </Panel>

          {data.descripcion && (
            <Panel title="Descripción" className="md:col-span-2">
              <p className="whitespace-pre-wrap text-sm text-slate-700">{data.descripcion}</p>
            </Panel>
          )}
        </section>
      )}

      {tab === 'lineas' && (
        <section className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setFiltroCategoria('')}
              className={cn(
                'rounded-full border px-3 py-1 text-xs font-medium transition',
                filtroCategoria === ''
                  ? 'border-cyan-300 bg-cyan-100 text-cyan-700'
                  : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300',
              )}
            >
              Todas ({data.lineas.length})
            </button>
            {data.categorias_disponibles.map((c) => {
              const count = data.lineas.filter((l) => l.categoria === c.slug).length;
              if (count === 0) return null;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setFiltroCategoria(c.slug)}
                  className={cn(
                    'rounded-full border px-3 py-1 text-xs font-medium transition',
                    filtroCategoria === c.slug
                      ? 'border-cyan-300 bg-cyan-100 text-cyan-700'
                      : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300',
                  )}
                >
                  {c.label} ({count})
                </button>
              );
            })}
          </div>

          {lineasFiltradas.length === 0 ? (
            <EmptyState
              icon={<ListChecks />}
              title="Sin líneas todavía"
              hint='Agregá la primera línea con el botón "Agregar línea" del header.'
            />
          ) : (
            <ol className="space-y-3">
              {lineasFiltradas.map((l) => (
                <li key={l.id}>
                  <LineaTrackingCard
                    linea={l}
                    categoriaConfig={categoriaConfigMap.get(l.categoria)}
                  />
                </li>
              ))}
            </ol>
          )}
        </section>
      )}

      {tab === 'documentacion' && (
        <section className="space-y-3">
          {adjuntosTodos.length === 0 ? (
            <EmptyState
              icon={<Paperclip />}
              title="Sin adjuntos"
              hint="Los archivos cargados como adjuntos de cualquier línea aparecen acá."
            />
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {adjuntosTodos.map((a, i) => (
                <li key={i}>
                  <a
                    href={a.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 transition hover:border-slate-300 hover:shadow-sm"
                  >
                    <span className="grid h-10 w-10 place-items-center rounded-lg bg-slate-100">
                      <FileText className="h-5 w-5 text-slate-500" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-800">
                        {a.url.split('/').pop()}
                      </p>
                      <p className="truncate text-xs text-slate-500">
                        {a.categoria} · {formatDateShort(a.fecha)}
                      </p>
                    </div>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {tab === 'recurrencia' && data.administracion && data.servicio && (
        <RecurrenciaList
          administracionId={data.administracion.id}
          servicioCodigo={data.servicio.codigo}
          trackingActualId={data.id}
        />
      )}

      {tab === 'config' && isStaff && (
        <section className="space-y-6">
          <EstadosConfigManager
            servicioId={data.servicio_id}
            estados={data.estados_disponibles}
            onChange={() => void load()}
          />
          <CategoriasConfigManager
            servicioId={data.servicio_id}
            categorias={data.categorias_disponibles}
            onChange={() => void load()}
          />
        </section>
      )}

      <AgregarLineaDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        trackingId={data.id}
        categorias={data.categorias_disponibles}
        estados={data.estados_disponibles}
        permiteCambiarEstado={isStaff}
        onSaved={() => void load()}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers locales
// ---------------------------------------------------------------------------
function KpiTile({
  label,
  value,
  icon,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-slate-200/80 bg-white/80 p-4 shadow-sm">
      <span className="grid h-10 w-10 place-items-center rounded-xl bg-cyan-50 text-cyan-600">
        {icon}
      </span>
      <div>
        <p className="text-xs uppercase tracking-wide text-brand-muted">{label}</p>
        <p className="text-2xl font-semibold text-brand-ink">
          <AnimatedNumber value={value} />
        </p>
      </div>
    </div>
  );
}

function Panel({
  title,
  children,
  className,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        'rounded-2xl border border-slate-200 bg-white p-5 shadow-sm',
        className,
      )}
    >
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-brand-muted">
        {title}
      </h2>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function Dl({
  label,
  value,
  link,
}: {
  label: string;
  value: string;
  link?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span className="text-brand-muted">{label}</span>
      {link && value !== '—' ? (
        <a
          href={value}
          target="_blank"
          rel="noopener noreferrer"
          className="truncate font-medium text-cyan-700 hover:underline"
        >
          Ver documento
        </a>
      ) : (
        <span className="truncate font-medium text-brand-ink">{value}</span>
      )}
    </div>
  );
}

function EmptyState({
  icon,
  title,
  hint,
}: {
  icon: React.ReactNode;
  title: string;
  hint: string;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/50 p-10 text-center">
      <span className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-white text-slate-400 shadow-sm">
        {icon}
      </span>
      <h3 className="text-base font-semibold text-slate-700">{title}</h3>
      <p className="mt-1 text-sm text-slate-500">{hint}</p>
    </div>
  );
}
