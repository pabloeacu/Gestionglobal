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
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useParams } from 'react-router-dom';
import { useDropZone } from '@/lib/useDropZone';
import {
  ArrowLeft,
  Briefcase,
  CalendarClock,
  CalendarRange,
  Ban,
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
  Receipt,
  RotateCcw,
  Send,
  Settings,
  Share2,
  Sparkles,
  ShieldCheck,
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
  colorBadge,
  agregarLinea,
  subirAdjuntoTracking,
  listDocsClienteDeTramite,
  type DocClienteTramite,
  getDerivacionGestoria,
  avisarGestoria,
  type TrackingDetail,
  type TrackingLineaRow,
  type TrackingVencimientoLigado,
  type ModeracionPendiente,
  type DerivacionGestoria,
} from '@/services/api/trackings';
import { ModeracionCard } from './ModeracionPage';
import { LineaTrackingCard } from '../components/LineaTrackingCard';
import { LineasTimeline } from '../components/LineasTimeline';
import { AgregarLineaDrawer } from '../components/AgregarLineaDrawer';
import { TrackingMetadataDrawer } from '../components/TrackingMetadataDrawer';
import { generateReportPdf } from '@/lib/reportPdf';
import { RecurrenciaList } from '../components/RecurrenciaList';
import { EstadosConfigManager } from '../components/EstadosConfigManager';
import { CategoriasConfigManager } from '../components/CategoriasConfigManager';
import { ProgramarVencimientoModal } from '../components/ProgramarVencimientoModal';
import { CerrarTramiteDialog } from '../components/CerrarTramiteDialog';
import { useCancelarTramite } from '@/modules/tramites/lib/useAvanzarTramite';
import { ReabrirTramiteDialog } from '../components/ReabrirTramiteDialog';
import { GenerarComprobanteTramiteModal } from '../components/GenerarComprobanteTramiteModal';
import {
  getSolicitudVinculadaTramite,
  type SolicitudVinculadaTramite,
} from '@/services/api/solicitudes';
import { PedidosDocPanel } from '@/components/common/PedidosDocPanel';
// DGG-41 (2026-06-02 · José Luis): la tab Documentación debe mostrar
// también los archivos del flujo PedidoDoc (cliente sube docs por bucket
// privado pedidos-doc-cliente). Antes solo leía archivos_urls de líneas.
import {
  listAdjuntosPedidosDocDeTramite,
  type PedidoDocAdjunto,
} from '@/services/api/tramitePedidosDoc';
import {
  OnboardingTour,
  STEPS_TRAMITES,
  shouldShowTramitesTour,
  shouldShowGerenciaTour,
  markTramitesTourSeen,
} from '@/components/onboarding/OnboardingTour';
import { humanizeError } from '@/lib/errors';

type TabKey = 'resumen' | 'lineas' | 'documentacion' | 'recurrencia' | 'config';

export function TrackingDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const confirm = useConfirm();
  // DGG-95 · Cancelar el trámite desde el detalle vivo usa el MISMO diálogo/cascada
  // que el kanban (anula el comprobante no-fiscal → saldo a favor). Antes sólo se
  // podía "cancelar" seteando el estado desde una línea (bypass silencioso de la cascada).
  const cancelarTramite = useCancelarTramite();

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
  // JL 2 · obs 1 · atajo "Generar comprobante" del trámite (cuando comprobante_pendiente).
  const [genCompOpen, setGenCompOpen] = useState(false);
  const [programarOpen, setProgramarOpen] = useState(false);
  // DGG-38 · Modal de cierre con tabs "Subir archivo" / "Pegar URL".
  // Reemplaza el `usePrompt()` simple que sólo aceptaba URL.
  const [cerrarOpen, setCerrarOpen] = useState(false);
  // DGG-42 · Modal de reapertura cuando el trámite está cerrado y se quiere
  // revertir el cierre (error de gerencia, documentación tardía del cliente,
  // etc.). Pide motivo + opt-in para notificar al cliente.
  const [reabrirOpen, setReabrirOpen] = useState(false);
  // Después de cerrar, si el servicio tiene vigencia_meses, encadenamos al
  // ProgramarVencimientoModal (FIX-V4). Memorizamos el flag al abrir el
  // cerrar dialog para usarlo en el callback.
  const [cerrarTieneRenovacion, setCerrarTieneRenovacion] = useState(false);
  // DEEP-1 · drawer para editar metadata del trámite post-alta. Antes los
  // campos titulo/categoria/prioridad/vence_at/admin/consorcio/solicitante
  // sólo se podían setear durante el alta.
  const [editMetaOpen, setEditMetaOpen] = useState(false);
  // 2.G · cuando true, el modal de programar abre en modo edición del
  // vencimiento ligado (precarga fecha + offsets + notificar).
  const [editandoCronograma, setEditandoCronograma] = useState(false);
  // 2.B · estado del modal "Compartir externo"
  const [compartirOpen, setCompartirOpen] = useState(false);
  // 5.C · accesos externos del tracking + sus aperturas.
  const [accesos, setAccesos] = useState<AccesoConAperturas[]>([]);
  // DGG-90 (JL #2) · derivación a gestoría del trámite (para el botón "Avisar a la gestoría")
  const [derivacion, setDerivacion] = useState<DerivacionGestoria | null>(null);
  const [avisandoGestoria, setAvisandoGestoria] = useState(false);
  // JL-W8-1 · solicitud que generó este trámite (para advertir si el atajo
  // "Generar comprobante" se usa sin que el wizard haya corrido, y para espejar
  // el vínculo del comprobante en la solicitud al emitir).
  const [solicitudVinculada, setSolicitudVinculada] =
    useState<SolicitudVinculadaTramite | null>(null);
  // Error in-place (no redirigir al listado: enmascara fallos — E-GG-04 bonus).
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // J1 · Tour secundario Trámites — primer visit a un tracking, sólo si el
  // tour principal de gerencia ya fue completado y el user es staff.
  const [tramitesTourOpen, setTramitesTourOpen] = useState(false);
  useEffect(() => {
    if (shouldShowGerenciaTour()) return;
    if (!isStaff) return;
    if (shouldShowTramitesTour()) {
      const t = setTimeout(() => setTramitesTourOpen(true), 1100);
      return () => clearTimeout(t);
    }
  }, [isStaff]);

  // 2.F · Drag&drop sobre el detalle. Cuando soltás archivos, los sube al
  // bucket `gestor-uploads` y crea una línea "Documentación adjunta"
  // automáticamente. IMPORTANTE: este hook tiene que ir ANTES del early
  // return de loading/!data para no violar Rules of Hooks (React #310).
  const handleFilesDrop = useCallback(async (files: File[]) => {
    const tid = data?.id;
    if (!tid || files.length === 0) return;
    toast.info(`Subiendo ${files.length} archivo${files.length === 1 ? '' : 's'}…`);
    const urls: string[] = [];
    for (const f of files) {
      const r = await subirAdjuntoTracking(tid, f);
      if (!r.ok) {
        toast.error(`No se pudo subir ${f.name}`, { description: humanizeError(r.error) });
        continue;
      }
      urls.push(r.data);
    }
    if (urls.length === 0) return;
    const res = await agregarLinea(tid, {
      categoria: 'documentacion',
      descripcion: `Documentación adjunta (${urls.length} archivo${urls.length === 1 ? '' : 's'} via drag&drop)`,
      archivos_urls: urls,
      visible_cliente: false,
    });
    if (!res.ok) {
      toast.error('Archivos subidos pero no pudimos crear la línea', {
        description: humanizeError(res.error),
      });
      return;
    }
    toast.success(`${urls.length} archivo${urls.length === 1 ? '' : 's'} agregado${urls.length === 1 ? '' : 's'} al tracking`);
    void load();
  }, [data?.id]);
  const { isDragOver, dropProps } = useDropZone({
    onDrop: handleFilesDrop,
    disabled: !isStaff || !data,
  });

  async function load() {
    if (!id) return;
    setLoading(true);
    setErrorMsg(null);
    const res = await getTracking(id);
    setLoading(false);
    if (!res.ok) {
      setErrorMsg(humanizeError(res.error));
      return;
    }
    setData(res.data);
    // 5.C · accesos externos generados para este tracking + aperturas.
    const acc = await listAccesosDeRecurso('tramite', id);
    if (acc.ok) setAccesos(acc.data);
    // DGG-90 · ¿el trámite fue derivado a una gestoría? (para el botón de aviso)
    const der = await getDerivacionGestoria(id);
    if (der.ok) setDerivacion(der.data);
    // JL-W8-1 · solicitud de origen (best-effort: si falla, sin advertencia).
    const sol = await getSolicitudVinculadaTramite(id);
    if (sol.ok) setSolicitudVinculada(sol.data);
  }

  // JL-W8-1 · advertencia (sin bloquear) al usar el atajo "Generar comprobante"
  // cuando el circuito normal (wizard de activación) no corrió para este trámite.
  async function handleGenerarComprobanteClick() {
    const solSinActivar =
      solicitudVinculada &&
      !['activada', 'derivada'].includes(solicitudVinculada.estado);
    const tramiteManual = !solicitudVinculada && !data?.formulario_submission_id;
    if (solSinActivar || tramiteManual) {
      const okConfirm = await confirm({
        title: 'Este trámite no pasó por el wizard de activación',
        message: (
          <div className="space-y-2 text-sm">
            <p>
              {solSinActivar
                ? 'La solicitud vinculada está sin activar: el wizard da de alta el cliente y registra la cobranza con el precio y las bonificaciones del catálogo.'
                : 'El trámite fue creado a mano (sin solicitud de origen), así que no hay precio ni bonificación del catálogo precargados.'}
            </p>
            <p>Verificá el importe y el receptor antes de emitir.</p>
          </div>
        ),
        confirmLabel: 'Emitir igual',
        cancelLabel: 'Volver',
      });
      if (!okConfirm) return;
    }
    setGenCompOpen(true);
  }

  // DGG-90 (JL #2) · reavisa a la gestoría externa que hay info nueva.
  async function handleAvisarGestoria() {
    if (!id || !derivacion) return;
    const okConfirm = await confirm({
      title: 'Avisar a la gestoría',
      message: (
        <div className="space-y-2 text-sm">
          <p>
            Le avisaremos a <strong>{derivacion.destinatario_email}</strong> que hay
            información nueva y que ya puede retomar el trámite (verá la información anterior y
            la nueva desde su acceso).
          </p>
          <p>¿Enviar el aviso?</p>
        </div>
      ),
      confirmLabel: 'Avisar a la gestoría',
      cancelLabel: 'Cancelar',
    });
    if (!okConfirm) return;
    setAvisandoGestoria(true);
    const res = await avisarGestoria(id, null);
    setAvisandoGestoria(false);
    if (!res.ok) {
      toast.error('No pudimos avisar a la gestoría', { description: humanizeError(res.error) });
      return;
    }
    toast.success(`Aviso enviado a ${res.data.email}`);
    void load();
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

  // F4 (DGG-66): los aportes del gestor PENDIENTES van a la sección de
  // moderación (no al timeline); los descartados se ocultan. El resto
  // (publicados, internos, líneas normales) se muestran en el timeline.
  // Líneas que SÍ van al timeline (excluye pendientes de moderación y
  // descartados). Base para contadores/chips/export → coherente con lo listado.
  const lineasVisibles = useMemo<TrackingLineaRow[]>(
    () => (data?.lineas ?? []).filter(
      (l) => l.moderacion_estado !== 'pendiente' && l.moderacion_estado !== 'descartado',
    ),
    [data],
  );
  const lineasFiltradas = useMemo<TrackingLineaRow[]>(() => {
    if (!filtroCategoria) return lineasVisibles;
    return lineasVisibles.filter((l) => l.categoria === filtroCategoria);
  }, [lineasVisibles, filtroCategoria]);

  // F4 · aportes del gestor pendientes de moderación en ESTE trámite.
  const pendientesModeracion = useMemo<ModeracionPendiente[]>(() => {
    if (!data) return [];
    return data.lineas
      .filter((l) => l.categoria === 'gestor_avance' && l.moderacion_estado === 'pendiente')
      .map((l) => ({
        linea_id: l.id,
        tramite_id: data.id,
        tramite_codigo: data.codigo ?? '',
        servicio_nombre: data.servicio?.nombre ?? data.titulo ?? null,
        cliente_nombre: data.administracion?.nombre ?? null,
        gestor_label: l.gestor_label,
        descripcion: l.descripcion,
        archivos_urls: l.archivos_urls ?? [],
        created_at: l.created_at,
      }));
  }, [data]);

  // DGG-41: además de archivos_urls de líneas, traer los items del flujo
  // PedidoDoc (cliente sube docs vía bucket privado). Se cargan paralelamente
  // al detalle, con signed URLs ya resueltas.
  const [adjuntosPedidoDoc, setAdjuntosPedidoDoc] = useState<PedidoDocAdjunto[]>([]);
  const [docsCliente, setDocsCliente] = useState<DocClienteTramite[]>([]);
  useEffect(() => {
    if (!data?.id) {
      setAdjuntosPedidoDoc([]);
      setDocsCliente([]);
      return;
    }
    let cancel = false;
    void listAdjuntosPedidosDocDeTramite(data.id).then((r) => {
      if (!cancel && r.ok) setAdjuntosPedidoDoc(r.data);
    });
    // E-GG-90 · docs del cliente + de derivación (antes sólo visibles en la solicitud).
    void listDocsClienteDeTramite(data.id).then((r) => {
      if (!cancel && r.ok) setDocsCliente(r.data);
    });
    return () => { cancel = true; };
  }, [data?.id]);

  interface AdjuntoUnif {
    url: string;
    nombre: string;
    fecha: string;
    categoria: string;
    origen: 'linea' | 'pedido_doc' | 'cliente' | 'derivacion';
    estado?: string;        // solo para pedido_doc: aprobado / subido / etc
  }
  const adjuntosTodos = useMemo<AdjuntoUnif[]>(() => {
    if (!data) return [];
    const out: AdjuntoUnif[] = [];
    // (a) Archivos en archivos_urls de cada línea (drag&drop, cerrar trámite, etc).
    for (const l of data.lineas) {
      for (const u of l.archivos_urls ?? []) {
        const nombre = decodeURIComponent(u.split('/').pop() ?? 'archivo')
          .replace(/^\d+-[a-z0-9]+-/, '');
        out.push({
          url: u,
          nombre,
          fecha: l.created_at,
          categoria: l.categoria,
          origen: 'linea',
        });
      }
    }
    // (b) Archivos subidos por el cliente vía PedidoDoc (DGG-41).
    for (const a of adjuntosPedidoDoc) {
      out.push({
        url: a.url,
        nombre: a.archivoNombre,
        fecha: a.subidoAt ?? data.created_at,
        categoria: `Pedido: ${a.descripcion}`,
        origen: 'pedido_doc',
        estado: a.estado,
      });
    }
    // (c) E-GG-90 · Documentos del cliente (form-adjuntos) + reenviados a la
    // gestoría al derivar (gestoria-adjuntos). Antes no se veían en el trámite.
    for (const d of docsCliente) {
      out.push({
        url: d.url,
        nombre: d.nombre,
        fecha: data.created_at,
        categoria: d.origen === 'derivacion' ? 'Enviado a gestoría' : 'Documento del cliente',
        origen: d.origen,
      });
    }
    // Ordenar más recientes primero
    out.sort((x, y) => +new Date(y.fecha) - +new Date(x.fecha));
    return out;
  }, [data, adjuntosPedidoDoc, docsCliente]);

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
          { label: 'Líneas', value: String(lineasVisibles.length), tone: 'cyan' },
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
        rows: [...lineasVisibles].sort(
          (a, b) =>
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
        ),
      });
      toast.success('PDF generado', {
        description: `Descargá ${filename}`,
      });
    } catch (err) {
      toast.error('No pudimos generar el PDF', {
        description: humanizeError(err),
      });
    } finally {
      setPdfBusy(false);
    }
  }

  // FIX-V4 · Unificación: si el servicio tiene vigencia_meses != null, al cerrar
  // el trámite encadenamos al ProgramarVencimientoModal para que el gerente
  // setee la próxima fecha en el mismo flujo. Si vigencia_meses == null,
  // sólo cierra el trámite.
  // DGG-38 (2026-06-02 · José Luis): el modal de cierre ahora admite subir
  // archivo además de URL externa. Abre `CerrarTramiteDialog`.
  async function handleCerrar() {
    if (!data) return;
    const tieneRenovacion = (data.servicio?.vigencia_meses ?? null) !== null;

    if (data.estado !== 'aprobado' && data.estado !== 'resuelto') {
      const cont = await confirm({
        title: tieneRenovacion ? 'Cerrar trámite y programar próximo vencimiento' : 'Cerrar trámite',
        message: `El estado actual es "${data.estado}". ¿Cerrarlo igualmente?`,
        confirmLabel: 'Continuar',
        danger: true,
      });
      if (!cont) return;
    }
    setCerrarTieneRenovacion(tieneRenovacion);
    setCerrarOpen(true);
  }

  // Callback del CerrarTramiteDialog tras un cierre exitoso (subió archivo o
  // pegó URL). Encadena al ProgramarVencimientoModal si corresponde.
  function handleCerradoOk() {
    if (cerrarTieneRenovacion) {
      void load();
      toast.success('Trámite cerrado · programá el próximo vencimiento');
      setProgramarOpen(true);
    } else {
      toast.success('Trámite cerrado');
      void load();
    }
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
      badge: lineasVisibles.length,
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
    <div
      className={cn(
        'relative space-y-6 motion-safe:animate-fade-up',
        isDragOver && 'rounded-3xl outline outline-4 outline-brand-cyan/40',
      )}
      {...dropProps}
    >
      {/* 2.F · overlay de drop visible cuando arrastrás archivos sobre el detalle. */}
      {isDragOver && createPortal(
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-brand-cyan/10 backdrop-blur-[1px]">
          <div className="rounded-2xl border-2 border-dashed border-brand-cyan bg-white/90 px-6 py-5 text-center shadow-2xl">
            <Paperclip size={28} className="mx-auto mb-2 text-brand-cyan" />
            <p className="font-display text-base font-semibold text-brand-ink">
              Soltá para adjuntar al tracking
            </p>
            <p className="mt-1 text-xs text-brand-muted">
              Se crea una línea "Documentación adjunta" automáticamente
            </p>
          </div>
        </div>,
        document.body,
      )}
      {/* F4 (DGG-66) · aportes del gestor PENDIENTES de revisión (inline) */}
      {pendientesModeracion.length > 0 && (
        <section className="rounded-3xl border border-amber-300 bg-amber-50/50 p-4 sm:p-5">
          <div className="mb-3 flex items-center gap-2">
            <ShieldCheck size={18} className="text-amber-700" />
            <h2 className="font-display text-lg font-bold text-brand-ink">
              {pendientesModeracion.length} aporte{pendientesModeracion.length === 1 ? '' : 's'} de gestoría
              {' '}pendiente{pendientesModeracion.length === 1 ? '' : 's'} de revisión
            </h2>
          </div>
          <ul className="space-y-3">
            {pendientesModeracion.map((p) => (
              <li key={p.linea_id}><ModeracionCard item={p} onResuelto={() => void load()} /></li>
            ))}
          </ul>
        </section>
      )}

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
              {/* DEEP-1 · Editar metadata: visible solo para staff. Abrimos
                  drawer lateral con titulo/categoria/prioridad/vence_at +
                  admin+consorcio dependiente + solicitante. */}
              {isStaff && (
                <button
                  type="button"
                  onClick={() => setEditMetaOpen(true)}
                  title="Editar metadata del trámite"
                  className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-brand-muted transition hover:border-brand-cyan hover:text-brand-ink"
                >
                  <Pencil className="h-3.5 w-3.5" /> Editar metadata
                </button>
              )}
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
            {/* JL 2 · obs 1 · atajo para emitir el comprobante sin volver a
                Solicitudes. Visible sólo si el trámite lo tiene pendiente. */}
            {isStaff && data.comprobante_pendiente && (
              <Button
                variant="tonal"
                onClick={() => void handleGenerarComprobanteClick()}
                title="Emitir el comprobante de este trámite sin volver a Solicitudes"
              >
                <Receipt className="h-4 w-4" /> Generar comprobante
              </Button>
            )}
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
            {/* DGG-90 (JL #2) · avisar a la gestoría externa que hay info nueva
                (sólo si el trámite fue derivado y no está cerrado). */}
            {isStaff && derivacion && data.estado !== 'cerrado' && data.estado !== 'cancelado' && (
              <Button
                variant="ghost"
                onClick={() => void handleAvisarGestoria()}
                loading={avisandoGestoria}
                title={`Avisar a la gestoría (${derivacion.destinatario_email}) que hay información nueva`}
              >
                <Send className="h-4 w-4" /> Avisar a la gestoría
              </Button>
            )}
            {isStaff && data.estado !== 'cerrado' && (
              <Button
                variant="secondary"
                onClick={() => void handleCerrar()}
                data-tour="tracking-cerrar"
              >
                <CheckCircle2 className="h-4 w-4" />{' '}
                {data.servicio?.vigencia_meses
                  ? 'Cerrar trámite y programar próximo vencimiento'
                  : 'Cerrar trámite'}
              </Button>
            )}
            {/* DGG-95 (reporte JL) · Cancelar el trámite con cascada a la cta cte
                (anula el comprobante no-fiscal → saldo a favor). Reemplaza el bypass
                silencioso de "cambiar estado a Cancelado" desde una línea de avance. */}
            {isStaff && data.estado !== 'cerrado' && data.estado !== 'cancelado' && (
              <Button
                variant="ghost"
                onClick={async () => {
                  const result = await cancelarTramite(data.id, data.codigo);
                  if (result) void load();
                }}
                title="Cancelar el trámite (podés dejar lo pagado como saldo a favor)"
              >
                <Ban className="h-4 w-4" /> Cancelar trámite
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
            {/* DGG-42 · Reabrir el trámite si fue cerrado por error. */}
            {isStaff && data.estado === 'cerrado' && (
              <Button
                variant="ghost"
                onClick={() => setReabrirOpen(true)}
                title="Revertir el cierre de este trámite"
              >
                <RotateCcw className="h-4 w-4" /> Reabrir
              </Button>
            )}
          </div>
        </div>

        {/* E-GG-91 (e · reporte JL) · discoverability: cuando el cliente subió
            documentación de un pedido y el trámite está derivado a una gestoría,
            surface el reaviso (el mecanismo ya vive en la toolbar). Cierra el
            loop "el cliente completó → avisá a la gestoría que puede retomar". */}
        {isStaff && derivacion && data.estado !== 'cerrado' && data.estado !== 'cancelado' && adjuntosPedidoDoc.length > 0 && (
          <div className="mt-4 flex flex-col gap-3 rounded-xl border-2 border-violet-300/70 bg-violet-50 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-violet-100 text-violet-700">
                <Send size={16} />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-brand-ink">El cliente subió documentación</p>
                <p className="text-xs text-brand-muted">
                  Avisá a la gestoría ({derivacion.destinatario_email}) que ya puede retomar el trámite
                  con la información nueva.
                </p>
              </div>
            </div>
            <Button
              onClick={() => void handleAvisarGestoria()}
              loading={avisandoGestoria}
              className="shrink-0"
            >
              <Send className="h-4 w-4" /> Avisar a la gestoría
            </Button>
          </div>
        )}

        {/* KPI strip */}
        <div className="relative mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          <KpiTile label="Líneas" value={lineasVisibles.length} icon={<ListChecks />} />
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
            {/* JL 2 · obs 1 (follow-up): link al comprobante vinculado para
                saltar a Facturación (ver/registrar cobranza) tras emitirlo. */}
            {data.comprobante && (
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="text-brand-muted">Comprobante</span>
                <Link
                  to={`/gerencia/facturacion/${data.comprobante.id}`}
                  className="truncate font-medium text-cyan-700 hover:underline"
                >
                  {data.comprobante.tipo}{' '}
                  {String(data.comprobante.punto_venta).padStart(5, '0')}-
                  {data.comprobante.numero
                    ? String(data.comprobante.numero).padStart(8, '0')
                    : '—'}
                </Link>
              </div>
            )}
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
          {/* N2 · Panel de pedidos de documentación al cliente. Gerencia puede
              crear pedidos en cualquier momento; el cliente los ve en su portal. */}
          <div className="md:col-span-2">
            <PedidosDocPanel
              tramiteId={data.id}
              variant="gerente"
              tramiteLabel={data.codigo ?? undefined}
            />
          </div>
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
                Todas ({lineasVisibles.length})
              </button>
              {data.categorias_disponibles.map((c) => {
                const count = lineasVisibles.filter((l) => l.categoria === c.slug).length;
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
                    download={a.nombre}
                    title={`Descargar ${a.nombre}`}
                    className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 transition hover:border-slate-300 hover:shadow-sm"
                  >
                    <span className="grid h-10 w-10 place-items-center rounded-lg bg-slate-100">
                      <FileText className="h-5 w-5 text-slate-500" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-800">
                        {a.nombre}
                      </p>
                      <p className="truncate text-xs text-slate-500">
                        {a.categoria} · {formatDateShort(a.fecha)}
                      </p>
                    </div>
                    {/* Badge del origen para que gerencia sepa de dónde vino el
                        archivo (DGG-41 + E-GG-90). */}
                    {(a.origen === 'pedido_doc' || a.origen === 'cliente') && (
                      <span
                        className="shrink-0 rounded-full bg-brand-cyan-pale/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-brand-cyan"
                        title="Documento aportado por el cliente"
                      >
                        Cliente
                      </span>
                    )}
                    {a.origen === 'derivacion' && (
                      <span
                        className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-700"
                        title="Reenviado a la gestoría al derivar"
                      >
                        A gestoría
                      </span>
                    )}
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

      {/* DEEP-1 · Drawer de edición de metadata del trámite. Recarga el detalle
          al guardar para que el header refleje el cambio inmediatamente. */}
      <TrackingMetadataDrawer
        open={editMetaOpen}
        tracking={data}
        onClose={() => setEditMetaOpen(false)}
        onSaved={() => {
          setEditMetaOpen(false);
          void load();
        }}
      />

      <CerrarTramiteDialog
        open={cerrarOpen}
        onClose={() => setCerrarOpen(false)}
        tramiteId={data.id}
        categoria={data.categoria as import('@/services/api/tramites').TramiteCategoria}
        onCerrado={handleCerradoOk}
      />

      {/* DGG-42 · Reabrir trámite cerrado con motivo + opt-in para
          notificar al cliente. */}
      <ReabrirTramiteDialog
        open={reabrirOpen}
        onClose={() => setReabrirOpen(false)}
        tramiteId={data.id}
        tramiteTitulo={data.titulo}
        motivoCierreOriginal={(data as { motivo_cierre?: string | null }).motivo_cierre ?? null}
        onReabierto={() => { void load(); }}
      />

      <ProgramarVencimientoModal
        open={programarOpen}
        onClose={() => {
          setProgramarOpen(false);
          setEditandoCronograma(false);
        }}
        trackingId={data.id}
        trackingTitulo={data.titulo}
        // FIX-V4 · precalcular fecha sugerida desde vigencia_meses del servicio.
        periodoSugeridoDias={
          data.servicio?.vigencia_meses != null
            ? Math.round(data.servicio.vigencia_meses * 30.4375)
            : undefined
        }
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

      {/* JL 2 · obs 1 · atajo "Generar comprobante" desde el trámite pendiente. */}
      <GenerarComprobanteTramiteModal
        open={genCompOpen}
        tramiteId={data.id}
        tramiteCodigo={data.codigo}
        administracionId={data.administracion_id}
        consorcioId={data.consorcio_id}
        servicioNombre={data.servicio?.nombre ?? data.titulo}
        servicioPrecioBase={data.servicio?.precio_base ?? null}
        receptorNombre={data.administracion?.nombre ?? data.solicitante_nombre ?? '—'}
        esDDJJ={data.categoria === 'dj'}
        solicitudVinculada={solicitudVinculada}
        onClose={() => setGenCompOpen(false)}
        onGenerado={() => {
          setGenCompOpen(false);
          void load();
        }}
      />

      {/* J1 · Tour secundario Trámites (1 paso) — primer visit. */}
      <OnboardingTour
        open={tramitesTourOpen}
        steps={STEPS_TRAMITES}
        onClose={() => {
          setTramitesTourOpen(false);
          markTramitesTourSeen();
        }}
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
      toast.error('No pudimos generar el acceso', { description: humanizeError(res.error) });
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
