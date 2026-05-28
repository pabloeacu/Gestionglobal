// ============================================================================
// TrackingDetailPage · Subsistema de Tracking (puntos 9-17 Flujo Maestro)
//
// Vive sobre la ruta `/gerencia/trackings/:id`. La ruta legacy
// `/gerencia/tramites/:id` redirige acá (ver App.tsx · TramiteLegacyRedirect,
// fix 7.A / E-GG-01). El detalle viejo `TramiteDetailPage` quedó archivado
// en src/modules/tramites/ pero ya no se renderiza desde el router.
//
// Premium UX: TrianglesAccent header + AnimatedNumber KPIs + tabs sticky +
// timeline categorizada + drawer "agregar línea" + cierre con doc final +
// recurrencia (trackings hermanos) + configuración custom de estados/categorías.
// Regla 13: useConfirm en lugar de window.confirm.
// ============================================================================
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Briefcase,
  CalendarClock,
  CalendarRange,
  CheckCircle2,
  Clock,
  Copy,
  Download,
  Eye,
  EyeOff,
  FileText,
  GitBranch,
  History,
  Layers,
  Link2,
  List,
  ListChecks,
  Loader2,
  Paperclip,
  Pencil,
  Plus,
  Settings,
  Share2,
  Sparkles,
  Timer,
} from 'lucide-react';
import { toast } from '@/lib/toast';
import {
  AnimatedNumber,
  Button,
  Field,
  Input,
  Modal,
  Select,
  Tabs,
  useConfirm,
  usePrompt,
  type TabItem,
} from '@/components/common';
import {
  generarAcceso,
  listAccesosDeRecurso,
  type AccesoConAperturas,
} from '@/services/api/accesos';
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
  type TrackingVencimientoLigado,
} from '@/services/api/trackings';
import { LineaTrackingCard } from '../components/LineaTrackingCard';
import { LineasTimeline } from '../components/LineasTimeline';
import { AgregarLineaDrawer } from '../components/AgregarLineaDrawer';
import { generateReportPdf } from '@/lib/reportPdf';
import { RecurrenciaList } from '../components/RecurrenciaList';
import { EstadosConfigManager } from '../components/EstadosConfigManager';
import { CategoriasConfigManager } from '../components/CategoriasConfigManager';
import { ProgramarVencimientoModal } from '../components/ProgramarVencimientoModal';

type TabKey = 'resumen' | 'lineas' | 'documentacion' | 'recurrencia' | 'config';

export function TrackingDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const confirm = useConfirm();
  const prompt = usePrompt();

  const isStaff = user?.role === 'gerente' || user?.role === 'operador';

  const [data, setData] = useState<TrackingDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabKey>('resumen');
  const [filtroCategoria, setFiltroCategoria] = useState<string>('');
  // 2.A · vista del tab Líneas: lista clásica o timeline visual. Persistimos
  // la preferencia para que el gerente no la elija cada vez.
  const [vistaLineas, setVistaLineas] = useState<'lista' | 'timeline'>(() => {
    try {
      const v = localStorage.getItem('gg.tracking.vistaLineas');
      return v === 'timeline' ? 'timeline' : 'lista';
    } catch { return 'lista'; }
  });
  // 2.C · estado de generación del PDF (para deshabilitar el botón mientras corre)
  const [pdfBusy, setPdfBusy] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [programarOpen, setProgramarOpen] = useState(false);
  // 2.G · cuando true, el modal de programar abre en modo edición del
  // vencimiento ligado (precarga fecha + offsets + notificar).
  const [editandoCronograma, setEditandoCronograma] = useState(false);
  // 2.B · estado del modal "Compartir externo"
  const [compartirOpen, setCompartirOpen] = useState(false);
  // 5.C · accesos externos del tracking + sus aperturas.
  const [accesos, setAccesos] = useState<AccesoConAperturas[]>([]);
  // Error in-place (no redirigir al listado: enmascara fallos — E-GG-04 bonus).
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function load() {
    if (!id) return;
    setLoading(true);
    setErrorMsg(null);
    const res = await getTracking(id);
    setLoading(false);
    if (!res.ok) {
      setErrorMsg(res.error.message);
      return;
    }
    setData(res.data);
    // 5.C · accesos externos generados para este tracking + aperturas.
    const acc = await listAccesosDeRecurso('tramite', id);
    if (acc.ok) setAccesos(acc.data);
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

  // 2.A · cambia de vista y persiste la preferencia.
  function toggleVistaLineas(next: 'lista' | 'timeline') {
    setVistaLineas(next);
    try { localStorage.setItem('gg.tracking.vistaLineas', next); } catch {/* noop */}
  }

  // 2.C · Exportar tracking como PDF resumen premium (DGG-31).
  //
  // Reutiliza el sistema de DGG-26 (`generateReportPdf`): cada línea es una
  // fila de la "tabla" del reporte. Los datos del tracking (cliente,
  // servicio, estado, fechas, KPIs) van como header/subtitle + filtros chips
  // + KPI strip. Header con logo + footer "Generado por Gestión Global".
  async function handleExportPdf() {
    if (!data) return;
    setPdfBusy(true);
    try {
      const filename = `tracking-${data.codigo ?? data.id.slice(0, 8)}-${new Date()
        .toISOString()
        .slice(0, 10)}.pdf`;
      const diasAbiertos = Math.max(
        0,
        Math.floor(
          (Date.now() - new Date(data.created_at).getTime()) /
            (1000 * 60 * 60 * 24),
        ),
      );
      // Categoría → label (para que la columna se vea humana, no slug).
      const catLabel = (slug: string) =>
        categoriaConfigMap.get(slug)?.label ?? slug;
      // Estado label
      const estadoLabel =
        data.estados_disponibles.find((e) => e.slug === data.estado)?.label ??
        data.estado;
      await generateReportPdf({
        filename,
        titulo: data.servicio?.nombre ?? data.titulo,
        subtitulo: `${data.codigo} · ${data.administracion?.nombre ?? '—'}`,
        filtros: [
          { label: 'Estado', value: estadoLabel },
          ...(data.periodo ? [{ label: 'Período', value: data.periodo }] : []),
          {
            label: 'Inicio',
            value: data.fecha_inicio
              ? formatDateShort(data.fecha_inicio)
              : '—',
          },
          ...(data.consorcio
            ? [{ label: 'Consorcio', value: data.consorcio.nombre }]
            : []),
          ...(data.solicitante_nombre
            ? [{ label: 'Solicitante', value: data.solicitante_nombre }]
            : []),
        ],
        kpis: [
          { label: 'Líneas', value: String(data.lineas.length), tone: 'cyan' },
          { label: 'Adjuntos', value: String(adjuntosTodos.length), tone: 'amber' },
          { label: 'Pendientes', value: String(lineasPendientes), tone: 'rose' },
          { label: 'Días abiertos', value: String(diasAbiertos), tone: 'ink' },
        ],
        columns: [
          {
            key: 'fecha',
            label: 'Fecha',
            width: '18%',
            format: (l: TrackingLineaRow) => formatDateTime(l.created_at),
          },
          {
            key: 'categoria',
            label: 'Categoría',
            width: '22%',
            format: (l: TrackingLineaRow) => catLabel(l.categoria),
          },
          {
            key: 'estado',
            label: 'Estado→',
            width: '14%',
            format: (l: TrackingLineaRow) => l.estado_asociado ?? '—',
          },
          {
            key: 'descripcion',
            label: 'Nota / detalle',
            format: (l: TrackingLineaRow) => l.descripcion ?? '—',
          },
          {
            key: 'adjuntos',
            label: 'Adj',
            align: 'right',
            width: '8%',
            format: (l: TrackingLineaRow) =>
              String(l.archivos_urls?.length ?? 0),
          },
        ],
        rows: [...data.lineas].sort(
          (a, b) =>
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
        ),
      });
      toast.success('PDF generado', {
        description: `Descargá ${filename}`,
      });
    } catch (err) {
      toast.error('No pudimos generar el PDF', {
        description: err instanceof Error ? err.message : 'Error desconocido',
      });
    } finally {
      setPdfBusy(false);
    }
  }

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

  if (!loading && errorMsg && !data) {
    return (
      <div className="grid min-h-[60vh] place-items-center px-6 text-center">
        <div className="max-w-sm space-y-3">
          <p className="font-display text-xl font-bold text-brand-ink">
            No pudimos cargar este tracking.
          </p>
          <p className="text-sm text-brand-muted">{errorMsg}</p>
          <div className="flex items-center justify-center gap-2 pt-1">
            <button
              onClick={() => void load()}
              className="rounded-lg bg-brand-cyan px-3 py-1.5 text-sm font-medium text-white transition hover:opacity-90"
            >
              Reintentar
            </button>
            <Link
              to="/gerencia/tramites"
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-brand-ink transition hover:bg-slate-50"
            >
              Volver al listado
            </Link>
          </div>
        </div>
      </div>
    );
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
            {/* 2.C · Exportar tracking como PDF resumen premium (DGG-31). */}
            <Button
              variant="ghost"
              onClick={() => void handleExportPdf()}
              disabled={pdfBusy}
              title="Generar PDF resumen del tracking (líneas + KPIs)"
            >
              {pdfBusy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}{' '}
              Exportar PDF
            </Button>
            {/* 2.B · botón "Compartir externo" inline → modal con email +
                vigencia + copia/envío del link público. */}
            {isStaff && (
              <Button
                variant="ghost"
                onClick={() => setCompartirOpen(true)}
                title="Generar y compartir un acceso externo sin login"
              >
                <Share2 className="h-4 w-4" /> Compartir externo
              </Button>
            )}
            {isStaff && data.estado !== 'cerrado' && (
              <Button variant="secondary" onClick={() => void handleCerrar()}>
                <CheckCircle2 className="h-4 w-4" /> Cerrar tracking
              </Button>
            )}
            {/* Programar próximo vencimiento — visible cuando el tracking está
                cerrado/resuelto (renovable). Genera un vencimiento ligado al
                tracking via tracking_cerrar_ciclo (mig 0040). */}
            {/* 7.B · variant tonal del sistema (antes hardcode cyan). */}
            {isStaff && (data.estado === 'cerrado' || data.estado === 'resuelto') && (
              <Button
                variant="tonal"
                onClick={() => setProgramarOpen(true)}
              >
                <CalendarClock className="h-4 w-4" /> Programar próximo vencimiento
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

        {/* 2.D · indicador de SLA. Sólo si el servicio tiene sla_dias cargado y
            el tracking sigue abierto. Barra de progreso con semáforo:
            verde <50%, ámbar 50-90%, rojo >90% o atrasado. */}
        {data.servicio?.sla_dias && data.estado !== 'cerrado' && (
          <SlaBar
            diasAbiertos={Math.max(
              0,
              Math.floor(
                (Date.now() - new Date(data.created_at).getTime()) /
                  (1000 * 60 * 60 * 24),
              ),
            )}
            slaDias={data.servicio.sla_dias}
          />
        )}
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

          {/* 2.G · panel "Próximas alarmas" si hay un vencimiento ligado al
              tracking (DGG-07). Calcula fechas = fecha_venc - offset. */}
          {data.vencimiento_ligado && (
            <ProximasAlarmasPanel
              venc={data.vencimiento_ligado}
              onEditar={() => {
                setEditandoCronograma(true);
                setProgramarOpen(true);
              }}
            />
          )}

          {/* 5.C · accesos externos compartidos + tracking de aperturas. */}
          {accesos.length > 0 && (
            <AccesosCompartidosPanel accesos={accesos} />
          )}

          {data.descripcion && (
            <Panel title="Descripción" className="md:col-span-2">
              <p className="whitespace-pre-wrap text-sm text-slate-700">{data.descripcion}</p>
            </Panel>
          )}
        </section>
      )}

      {tab === 'lineas' && (
        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
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

            {/* 2.A · Toggle Lista / Timeline. Persistido en localStorage. */}
            <div
              className="inline-flex items-center gap-0.5 rounded-full border border-slate-200 bg-white p-0.5 text-[11px]"
              role="tablist"
              aria-label="Vista de líneas"
            >
              <button
                type="button"
                role="tab"
                aria-selected={vistaLineas === 'lista'}
                onClick={() => toggleVistaLineas('lista')}
                className={cn(
                  'inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-medium transition',
                  vistaLineas === 'lista'
                    ? 'bg-brand-cyan text-white shadow-sm'
                    : 'text-brand-muted hover:text-brand-ink',
                )}
              >
                <List size={12} /> Lista
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={vistaLineas === 'timeline'}
                onClick={() => toggleVistaLineas('timeline')}
                className={cn(
                  'inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-medium transition',
                  vistaLineas === 'timeline'
                    ? 'bg-brand-cyan text-white shadow-sm'
                    : 'text-brand-muted hover:text-brand-ink',
                )}
              >
                <GitBranch size={12} /> Timeline
              </button>
            </div>
          </div>

          {lineasFiltradas.length === 0 ? (
            <EmptyState
              icon={<ListChecks />}
              title="Sin líneas todavía"
              hint='Agregá la primera línea con el botón "Agregar línea" del header.'
            />
          ) : vistaLineas === 'timeline' ? (
            <LineasTimeline
              lineas={lineasFiltradas}
              categoriaConfigMap={categoriaConfigMap}
            />
          ) : (
            <ol className="space-y-3">
              {lineasFiltradas.map((l) => (
                <li key={l.id}>
                  <LineaTrackingCard
                    linea={l}
                    categoriaConfig={categoriaConfigMap.get(l.categoria)}
                    onEdited={() => void load()}
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

      <ProgramarVencimientoModal
        open={programarOpen}
        onClose={() => {
          setProgramarOpen(false);
          setEditandoCronograma(false);
        }}
        trackingId={data.id}
        trackingTitulo={data.titulo}
        onProgramado={() => void load()}
        // 2.G · si estamos editando, precargamos el vencimiento ligado.
        vencimientoExistente={
          editandoCronograma && data.vencimiento_ligado
            ? {
                id: data.vencimiento_ligado.id,
                fecha_vencimiento: data.vencimiento_ligado.fecha_vencimiento,
                alarmas_offsets: data.vencimiento_ligado.alarmas_offsets,
                notificar_cliente: data.vencimiento_ligado.notificar_cliente,
              }
            : null
        }
      />

      {/* 2.B · modal "Compartir externo" — genera token, copia URL, envía mail. */}
      <CompartirExternoModal
        open={compartirOpen}
        onClose={() => setCompartirOpen(false)}
        trackingId={data.id}
        trackingTitulo={data.titulo}
        emailSugerido={data.administracion?.email ?? data.solicitante_email ?? ''}
        onGenerado={() => void load()}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// 2.B · CompartirExternoModal
// ---------------------------------------------------------------------------
function CompartirExternoModal({
  open,
  onClose,
  trackingId,
  trackingTitulo,
  emailSugerido,
  onGenerado,
}: {
  open: boolean;
  onClose: () => void;
  trackingId: string;
  trackingTitulo: string;
  emailSugerido: string;
  onGenerado?: () => void;
}) {
  const [email, setEmail] = useState(emailSugerido);
  const [dias, setDias] = useState('14');
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<string | null>(null);

  // Si cambia la sugerencia (al abrir con datos frescos), reseteamos.
  useEffect(() => {
    if (open) {
      setEmail(emailSugerido);
      setLink(null);
    }
  }, [open, emailSugerido]);

  async function handleGenerar() {
    if (!email.trim()) {
      toast.error('Necesitamos un email para compartir');
      return;
    }
    setBusy(true);
    const res = await generarAcceso({
      recursoTipo: 'tramite',
      recursoId: trackingId,
      emailDestinatario: email.trim(),
      diasValidez: Math.max(1, Math.min(60, parseInt(dias, 10) || 14)),
      observaciones: `Tracking: ${trackingTitulo}`,
    });
    setBusy(false);
    if (!res.ok) {
      toast.error('No pudimos generar el acceso', { description: res.error.message });
      return;
    }
    setLink(res.data.url);
    onGenerado?.(); // 5.C · refresca la lista de accesos del tracking.
    // Copia automática al portapapeles para acortar el flujo.
    try {
      await navigator.clipboard.writeText(res.data.url);
      toast.success('Link copiado', {
        description: 'También se envió por mail al destinatario.',
      });
    } catch {
      toast.success('Acceso generado', {
        description: 'Copialo manualmente si no se copió solo.',
      });
    }
  }

  async function handleCopiar() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      toast.success('Link copiado');
    } catch {
      toast.error('No pudimos copiar — copialo a mano');
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Compartir con el cliente"
      kicker="Acceso externo sin login"
      width={520}
    >
      <div className="space-y-4">
        <p className="text-sm text-brand-muted">
          Generamos un link de acceso seguro al tracking, válido por el
          período que elijas. El destinatario lo recibe por mail y también
          podés copiarlo y pegarlo donde quieras.
        </p>
        <Field label="Email del destinatario" required>
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="cliente@ejemplo.com"
          />
        </Field>
        <Field label="Vigencia">
          <Select value={dias} onChange={(e) => setDias(e.target.value)}>
            <option value="7">7 días</option>
            <option value="14">14 días (recomendado)</option>
            <option value="30">30 días</option>
            <option value="60">60 días</option>
          </Select>
        </Field>

        {link && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 text-xs">
            <p className="mb-2 font-semibold text-emerald-800">
              <Link2 size={12} className="mr-1 inline" /> Link generado
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 truncate rounded bg-white px-2 py-1 font-mono text-[11px] text-brand-ink">
                {link}
              </code>
              <button
                type="button"
                onClick={handleCopiar}
                className="rounded-md border border-emerald-300 bg-white p-1.5 text-emerald-700 transition hover:bg-emerald-100"
                title="Copiar"
                aria-label="Copiar link"
              >
                <Copy size={13} />
              </button>
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {link ? 'Cerrar' : 'Cancelar'}
          </Button>
          {!link && (
            <Button onClick={handleGenerar} loading={busy} disabled={busy}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Share2 size={14} />}
              Generar y compartir
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// 5.C · Panel "Accesos compartidos" con tracking de aperturas.
// ---------------------------------------------------------------------------
function tiempoRelativoCorto(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const h = (Date.now() - d.getTime()) / 3_600_000;
  if (h < 1) return 'hace minutos';
  if (h < 24) return `hace ${Math.round(h)} h`;
  const dias = h / 24;
  if (dias < 7) return `hace ${Math.round(dias)} d`;
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: 'short' });
}

function AccesosCompartidosPanel({
  accesos,
}: {
  accesos: AccesoConAperturas[];
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:col-span-2">
      <h2 className="mb-3 inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-brand-muted">
        <Share2 className="h-4 w-4 text-brand-cyan" /> Accesos compartidos
      </h2>
      <ul className="space-y-2">
        {accesos.map((a) => {
          const vencido = new Date(a.vence_at).getTime() < Date.now();
          const revocado = !!a.revocado_at;
          const visto = a.total_aperturas > 0;
          return (
            <li
              key={a.token}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50/50 px-3 py-2 text-sm"
            >
              <div className="min-w-0">
                <p className="truncate font-medium text-brand-ink">
                  {a.email_destinatario}
                </p>
                <p className="text-xs text-brand-muted">
                  {revocado
                    ? 'Revocado'
                    : vencido
                      ? 'Vencido'
                      : `Vigente hasta ${new Date(a.vence_at).toLocaleDateString('es-AR', { day: '2-digit', month: 'short' })}`}
                </p>
              </div>
              {/* 5.C · badge "Visto N veces · última hace …" */}
              <span
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium',
                  visto
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                    : 'border-slate-200 bg-white text-brand-muted',
                )}
                title={
                  a.ultima_apertura
                    ? `Última apertura: ${new Date(a.ultima_apertura).toLocaleString('es-AR')}`
                    : 'Sin aperturas registradas'
                }
              >
                {visto ? <Eye size={12} /> : <EyeOff size={12} />}
                {visto
                  ? `Visto ${a.total_aperturas} ${a.total_aperturas === 1 ? 'vez' : 'veces'} · ${tiempoRelativoCorto(a.ultima_apertura)}`
                  : 'Sin abrir'}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 2.D · Barra de SLA. Verde <50%, ámbar 50-90%, rojo >90% o atrasado.
// ---------------------------------------------------------------------------
function SlaBar({ diasAbiertos, slaDias }: { diasAbiertos: number; slaDias: number }) {
  const ratio = slaDias > 0 ? diasAbiertos / slaDias : 0;
  const pct = Math.min(100, Math.round(ratio * 100));
  const atrasado = diasAbiertos > slaDias;
  const tone =
    atrasado || ratio > 0.9
      ? { bar: 'bg-red-500', text: 'text-red-700', track: 'bg-red-100' }
      : ratio >= 0.5
        ? { bar: 'bg-amber-500', text: 'text-amber-700', track: 'bg-amber-100' }
        : { bar: 'bg-emerald-500', text: 'text-emerald-700', track: 'bg-emerald-100' };
  return (
    <div className="relative mt-4 rounded-2xl border border-slate-200/80 bg-white/80 p-4 shadow-sm">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-brand-muted">
          <Timer className="h-3.5 w-3.5" /> SLA del servicio
        </span>
        <span className={cn('text-sm font-semibold', tone.text)}>
          {atrasado
            ? `Atrasado (+${diasAbiertos - slaDias} d)`
            : `Día ${diasAbiertos} / SLA ${slaDias}`}
        </span>
      </div>
      <div className={cn('h-2 w-full overflow-hidden rounded-full', tone.track)}>
        <div
          className={cn('h-full rounded-full transition-all duration-500', tone.bar)}
          style={{ width: `${atrasado ? 100 : pct}%` }}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 2.G · Panel "Próximas alarmas" — fechas calculadas del vencimiento ligado.
// ---------------------------------------------------------------------------
function ProximasAlarmasPanel({
  venc,
  onEditar,
}: {
  venc: TrackingVencimientoLigado;
  onEditar: () => void;
}) {
  const base = new Date(venc.fecha_vencimiento + 'T09:00:00');
  const alarmas = [...(venc.alarmas_offsets ?? [])]
    .sort((a, b) => b - a)
    .map((offset) => {
      const d = new Date(base);
      d.setDate(d.getDate() - offset);
      return { offset, fecha: d, pasada: d.getTime() < Date.now() };
    });
  const fmt = (d: Date) =>
    d.toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' });
  const offsetLabel = (o: number) =>
    o === 0 ? 'el día' : o === 1 ? '1 día antes' : `${o} días antes`;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:col-span-2">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-brand-muted">
          <CalendarClock className="h-4 w-4 text-brand-cyan" /> Próximas alarmas
        </h2>
        <Button variant="ghost" onClick={onEditar} title="Editar cronograma de alarmas">
          <Pencil className="h-3.5 w-3.5" /> Editar cronograma
        </Button>
      </div>
      <p className="mb-3 text-xs text-brand-muted">
        Vence el{' '}
        <span className="font-medium text-brand-ink">{fmt(base)}</span>
        {venc.notificar_cliente
          ? ' · cada alarma avisa al equipo y al cliente.'
          : ' · cada alarma avisa al equipo.'}
      </p>
      {alarmas.length === 0 ? (
        <p className="text-sm text-brand-muted">Sin alarmas configuradas.</p>
      ) : (
        <ul className="space-y-1.5 text-sm">
          {alarmas.map((a) => (
            <li
              key={a.offset}
              className={cn(
                'flex items-center gap-2',
                a.pasada ? 'text-brand-muted line-through' : 'text-brand-ink',
              )}
            >
              <span
                className={cn(
                  'inline-block h-1.5 w-1.5 rounded-full',
                  a.pasada ? 'bg-slate-300' : 'bg-brand-cyan',
                )}
              />
              {fmt(a.fecha)} · {offsetLabel(a.offset)}
            </li>
          ))}
        </ul>
      )}
    </section>
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
