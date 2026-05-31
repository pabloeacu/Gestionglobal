import { useEffect, useMemo, useState } from 'react';
import { toast } from '@/lib/toast';
import {
  Plus,
  Search,
  Filter,
  CalendarClock,
  AlertTriangle,
  Sliders,
  RefreshCcw,
  Download,
  List,
  Building2,
  ChevronDown,
  type LucideIcon,
} from 'lucide-react';
import { Link } from 'react-router-dom';
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
import { VencimientoFormDrawer } from '../components/VencimientoFormDrawer';
// FIX-V2 · RenovarModal y BulkRenovarModal eliminados del flujo.
import { VencimientoCard } from '../components/VencimientoCard';
import { MiniMapaVencimientos } from '../components/MiniMapaVencimientos';
import { useUrlFilters } from '@/lib/useUrlFilters';
import { usePullToRefresh } from '@/lib/usePullToRefresh';
import { CheckSquare, RefreshCcw as RefreshIcon, Square, X as CloseIcon } from 'lucide-react';
import {
  getProximosVencimientos,
  pausarVencimiento,
  reanudarVencimiento,
  eliminarVencimiento,
  diasHastaFecha,
  VENCIMIENTO_TIPOS,
  VENCIMIENTO_TIPO_LABEL,
  VENCIMIENTO_ESTADOS,
  VENCIMIENTO_ESTADO_LABEL,
  type ProximoVencimiento,
  type VencimientoTipo,
  type VencimientoEstado,
} from '@/services/api/vencimientos';
import { usePrompt } from '@/components/common';
import { ExportButtons } from '@/components/reports/ExportButtons';
import { SavedViewsMenu } from '@/components/common/SavedViewsMenu';
import { generateReportPdf } from '@/lib/reportPdf';
import { generateReportXls } from '@/lib/reportXls';
import { copyAsCsv } from '@/lib/csvCopy';

type TipoFilter = VencimientoTipo | 'todos';
type EstadoFilter = VencimientoEstado | 'todos';

export function VencimientosListPage() {
  const confirm = useConfirm();
  const prompt = usePrompt();
  const [rows, setRows] = useState<ProximoVencimiento[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 7.G · filtros persistidos en URL: deep-link, back/forward y compartir
  // vistas. El hook escribe sólo los no-default para mantener el query limpio.
  const [urlFilters, setUrlFilter] = useUrlFilters({
    q: '',
    tipo: 'todos',
    estado: 'todos',
    horizonte: '90',
    dia: '',
  });
  const search = urlFilters.q;
  const setSearch = (v: string) => setUrlFilter('q', v);
  const tipo = urlFilters.tipo as TipoFilter;
  const setTipo = (v: TipoFilter) => setUrlFilter('tipo', v);
  const estado = urlFilters.estado as EstadoFilter;
  const setEstado = (v: EstadoFilter) => setUrlFilter('estado', v);
  const horizonte = parseInt(urlFilters.horizonte, 10) || 90;
  const setHorizonte = (v: number) => setUrlFilter('horizonte', String(v));
  // 6.C · día foco del mini-mapa (filtra la lista al click en una celda).
  const diaFiltro = urlFilters.dia || null;
  const setDiaFiltro = (v: string | null) => setUrlFilter('dia', v ?? '');

  const [drawerOpen, setDrawerOpen] = useState(false);
  // 6.A · vista Lista vs Por cliente (agrupada por administración).
  const [vista, setVista] = useState<'lista' | 'cliente'>('lista');
  const [colapsadas, setColapsadas] = useState<Set<string>>(new Set());
  // FIX-V2 · multi-select para bulk PAUSAR (antes era bulk renovar). Sólo
  // vigentes/vencidos pueden incluirse. Barra flotante aparece con ≥1.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function isRenovable(v: ProximoVencimiento) {
    return v.estado === 'vigente' || v.estado === 'vencido';
  }
  function selectAllVisible() {
    setSelectedIds(new Set(filtered.filter(isRenovable).map((v) => v.id)));
  }
  function clearSelection() {
    setSelectedIds(new Set());
  }

  async function load() {
    setLoading(true);
    setError(null);
    const res = await getProximosVencimientos(horizonte);
    setLoading(false);
    if (!res.ok) {
      setError(res.error.message);
      toast.error(`No pudimos cargar los vencimientos: ${res.error.message}`);
      return;
    }
    setRows(res.data);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [horizonte]);

  useRealtimeRefresh(['vencimientos'], () => void load());

  // Filtros client-side sobre el resultado del RPC (lista acotada).
  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (tipo !== 'todos' && r.tipo !== tipo) return false;
      if (estado !== 'todos' && r.estado !== estado) return false;
      if (diaFiltro && r.fecha_vencimiento !== diaFiltro) return false;
      if (search.trim().length > 0) {
        const s = search.trim().toLowerCase();
        const hay = [
          r.administracion_nombre,
          r.consorcio_nombre,
          r.descripcion,
          r.observaciones,
          VENCIMIENTO_TIPO_LABEL[r.tipo],
        ]
          .filter(Boolean)
          .some((x) => x!.toLowerCase().includes(s));
        if (!hay) return false;
      }
      return true;
    });
  }, [rows, tipo, estado, search, diaFiltro]);

  // 7.E · Pull-to-refresh en mobile. En desktop no afecta (sin touch events).
  const pullRefresh = usePullToRefresh(async () => {
    await load();
  });

  // 6.A · agrupar por administración para la vista "Por cliente". Cada grupo
  // trae su resumen de vencimientos críticos (<30d, vigentes).
  const grupos = useMemo(() => {
    const map = new Map<
      string,
      { nombre: string; items: ProximoVencimiento[]; criticos30: number }
    >();
    for (const v of filtered) {
      const key = v.administracion_nombre ?? 'Sin administración';
      const g = map.get(key) ?? { nombre: key, items: [], criticos30: 0 };
      g.items.push(v);
      if (v.estado === 'vigente' && v.dias_restantes >= 0 && v.dias_restantes <= 30) {
        g.criticos30 += 1;
      }
      map.set(key, g);
    }
    return Array.from(map.values()).sort((a, b) => a.nombre.localeCompare(b.nombre));
  }, [filtered]);

  function toggleGrupo(nombre: string) {
    setColapsadas((prev) => {
      const next = new Set(prev);
      if (next.has(nombre)) next.delete(nombre);
      else next.add(nombre);
      return next;
    });
  }

  const kpis = useMemo(() => {
    const vigentes = rows.filter((r) => r.estado === 'vigente').length;
    const proximos30 = rows.filter(
      (r) =>
        r.estado === 'vigente' &&
        r.dias_restantes >= 0 &&
        r.dias_restantes <= 30,
    ).length;
    const vencidos = rows.filter((r) => r.estado === 'vencido').length;
    const renovados = rows.filter((r) => {
      if (r.estado !== 'renovado') return false;
      const d = diasHastaFecha(r.fecha_vencimiento);
      return d >= -30;
    }).length;
    return { vigentes, proximos30, vencidos, renovados };
  }, [rows]);

  // 6.D · export CSV con los filtros aplicados. Cabeceras en español y
  // escapado RFC4180 (comillas + LF). Compatible con Excel/Sheets.
  function exportarCSV() {
    if (filtered.length === 0) {
      toast.error('No hay vencimientos para exportar');
      return;
    }
    const headers = [
      'Tipo',
      'Administración',
      'Consorcio',
      'Fecha vencimiento',
      'Días restantes',
      'Estado',
      'Descripción',
    ];
    const escape = (v: unknown) => {
      const s = v == null ? '' : String(v);
      return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rowsCsv = filtered.map((r) =>
      [
        VENCIMIENTO_TIPO_LABEL[r.tipo],
        r.administracion_nombre,
        r.consorcio_nombre ?? '',
        r.fecha_vencimiento,
        r.dias_restantes,
        VENCIMIENTO_ESTADO_LABEL[r.estado] ?? r.estado,
        r.descripcion ?? '',
      ]
        .map(escape)
        .join(','),
    );
    const csv = '﻿' + [headers.join(','), ...rowsCsv].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `vencimientos-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success('CSV descargado', {
      description: `${filtered.length} vencimientos exportados.`,
    });
  }

  // DGG-26 · Export a PDF/XLS del filtrado actual.
  const exportFiltros = useMemo<Array<{ label: string; value: string }>>(() => {
    const items: Array<{ label: string; value: string }> = [];
    items.push({
      label: 'Tipo',
      value: tipo === 'todos' ? 'Todos' : VENCIMIENTO_TIPO_LABEL[tipo] ?? tipo,
    });
    items.push({
      label: 'Estado',
      value: estado === 'todos' ? 'Todos' : VENCIMIENTO_ESTADO_LABEL[estado] ?? estado,
    });
    items.push({ label: 'Horizonte', value: `${horizonte} días` });
    if (search.trim()) items.push({ label: 'Búsqueda', value: search.trim() });
    return items;
  }, [tipo, estado, horizonte, search]);

  async function onExportPdf() {
    await generateReportPdf<ProximoVencimiento>({
      filename: `vencimientos-${new Date().toISOString().slice(0, 10)}`,
      titulo: 'Vencimientos',
      subtitulo: `Próximos ${horizonte} días · Gestión Global`,
      filtros: exportFiltros,
      kpis: [
        { label: 'Vigentes', value: String(kpis.vigentes), tone: 'cyan' },
        { label: 'Próximos 30d', value: String(kpis.proximos30), tone: 'amber' },
        { label: 'Vencidos', value: String(kpis.vencidos), tone: 'rose' },
        { label: 'Renovados 30d', value: String(kpis.renovados), tone: 'emerald' },
      ],
      columns: [
        { key: 'fecha_vencimiento', label: 'Vencimiento', width: '14%' },
        { key: 'tipo', label: 'Tipo', width: '18%',
          format: (r) => VENCIMIENTO_TIPO_LABEL[r.tipo] ?? r.tipo },
        { key: 'descripcion', label: 'Descripción', width: '26%',
          format: (r) => r.descripcion ?? '—' },
        { key: 'administracion_nombre', label: 'Administración', width: '24%' },
        { key: 'estado', label: 'Estado', width: '18%',
          format: (r) => VENCIMIENTO_ESTADO_LABEL[r.estado] ?? r.estado },
      ],
      rows: filtered,
    });
  }

  async function onExportXls() {
    generateReportXls<ProximoVencimiento>({
      filename: `vencimientos-${new Date().toISOString().slice(0, 10)}`,
      sheetName: 'Vencimientos',
      titulo: 'Vencimientos · Gestión Global',
      filtros: exportFiltros,
      columns: [
        { key: 'fecha_vencimiento', label: 'Fecha vencimiento', width: 16,
          value: (r) => r.fecha_vencimiento ? new Date(r.fecha_vencimiento) : null },
        { key: 'tipo', label: 'Tipo', width: 22,
          value: (r) => VENCIMIENTO_TIPO_LABEL[r.tipo] ?? r.tipo },
        { key: 'descripcion', label: 'Descripción', width: 30,
          value: (r) => r.descripcion ?? '' },
        { key: 'administracion_nombre', label: 'Administración', width: 28 },
        { key: 'consorcio_nombre', label: 'Consorcio', width: 22,
          value: (r) => r.consorcio_nombre ?? '' },
        { key: 'dias_restantes', label: 'Días restantes', width: 14,
          value: (r) => Number(r.dias_restantes ?? 0) },
        { key: 'estado', label: 'Estado', width: 14,
          value: (r) => VENCIMIENTO_ESTADO_LABEL[r.estado] ?? r.estado },
      ],
      rows: filtered,
    });
  }

  // P2-#16 · Copy as CSV (al portapapeles, separador ';' para Excel-AR)
  async function onCopyCsv() {
    return copyAsCsv(
      filtered,
      [
        { key: 'fecha_vencimiento', label: 'Fecha vencimiento' },
        { key: 'tipo', label: 'Tipo',
          format: (r) => VENCIMIENTO_TIPO_LABEL[r.tipo] ?? r.tipo },
        { key: 'descripcion', label: 'Descripción',
          format: (r) => r.descripcion ?? '' },
        { key: 'administracion_nombre', label: 'Administración' },
        { key: 'consorcio_nombre', label: 'Consorcio',
          format: (r) => r.consorcio_nombre ?? '' },
        { key: 'dias_restantes', label: 'Días restantes' },
        { key: 'estado', label: 'Estado',
          format: (r) => VENCIMIENTO_ESTADO_LABEL[r.estado] ?? r.estado },
      ],
      { separator: ';' },
    );
  }

  // 6.E · vencimientos críticos HOY (dias_restantes <= 0 && vigente).
  const [bannerCerrado, setBannerCerrado] = useState(false);
  const venceHoy = useMemo(
    () =>
      rows.filter(
        (r) => r.estado === 'vigente' && r.dias_restantes <= 0,
      ),
    [rows],
  );

  // FIX-V2 · gestión de alertas — la gerencia NO renueva. Las acciones acá
  // son: pausar (p. ej. el cliente ya inició el trámite por otro lado) /
  // reanudar / eliminar (soft delete: estado='cancelado').
  async function onPausar(v: ProximoVencimiento) {
    const motivo = await prompt({
      title: 'Pausar alertas',
      message: `Las alertas dejan de enviarse al cliente y al staff. ¿Por qué pausás? (opcional)`,
      defaultValue: 'Trámite en curso por otro canal',
      placeholder: 'Motivo (visible para staff)',
      confirmLabel: 'Pausar alertas',
    });
    if (motivo === null) return;
    const res = await pausarVencimiento(v.id, motivo?.trim() || null);
    if (!res.ok) {
      toast.error(`No se pudo pausar: ${res.error.message}`);
      return;
    }
    toast.success('Alertas pausadas', {
      description: 'Volvé a Reanudar cuando corresponda — o eliminá el vencimiento si ya no aplica.',
    });
    void load();
  }
  async function onReanudar(v: ProximoVencimiento) {
    const res = await reanudarVencimiento(v.id);
    if (!res.ok) {
      toast.error(`No se pudo reanudar: ${res.error.message}`);
      return;
    }
    toast.success('Alertas reanudadas');
    void load();
  }
  async function onEliminar(v: ProximoVencimiento) {
    const okConf = await confirm({
      title: 'Eliminar vencimiento',
      message: `¿Eliminar el vencimiento de ${
        VENCIMIENTO_TIPO_LABEL[v.tipo]
      } de ${v.administracion_nombre}? Se cancelan las alertas. El registro queda en el histórico.`,
      confirmLabel: 'Eliminar',
      cancelLabel: 'Volver',
      danger: true,
    });
    if (!okConf) return;
    const res = await eliminarVencimiento(v.id);
    if (!res.ok) {
      toast.error(`No se pudo eliminar: ${res.error.message}`);
      return;
    }
    toast.success('Vencimiento eliminado');
    void load();
  }

  return (
    <div
      className="mx-auto max-w-7xl space-y-6"
      {...pullRefresh.listeners}
      style={{
        transform: pullRefresh.pullPx > 0 ? `translateY(${pullRefresh.pullPx}px)` : undefined,
        transition: pullRefresh.pullPx === 0 ? 'transform 0.2s' : undefined,
      }}
    >
      {/* 7.E · indicador pull-to-refresh */}
      {pullRefresh.pullPx > 0 && (
        <div
          className="pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-center pt-3"
          aria-live="polite"
        >
          <span
            className={cn(
              'inline-flex items-center gap-2 rounded-full bg-brand-cyan/90 px-3 py-1 text-xs font-semibold text-white shadow',
              pullRefresh.refreshing && 'animate-pulse',
            )}
          >
            <RefreshIcon
              size={12}
              className={cn(pullRefresh.refreshing && 'animate-spin')}
              style={{ transform: `rotate(${pullRefresh.visiblePct * 360}deg)` }}
            />
            {pullRefresh.refreshing
              ? 'Actualizando…'
              : pullRefresh.visiblePct >= 1
                ? 'Soltá para actualizar'
                : 'Bajá para actualizar'}
          </span>
        </div>
      )}
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="kicker text-brand-cyan">Datos estratégicos</p>
          <h1 className="font-display text-3xl font-bold text-brand-ink sm:text-4xl">
            Vencimientos
          </h1>
          <p className="mt-1 text-sm text-brand-muted">
            Matrículas, DDJJ, certificados ARCA, seguros y libros — con alertas
            configurables y sugerencias automáticas de servicios.
          </p>
        </div>
        {/* FIX-V1 · header compacto: toggle vista + Mis vistas + Exports +
            iconos para Config / Nuevo. Wrap responsive sin cortar. */}
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:flex-nowrap">
          {/* 6.A · toggle Lista / Por cliente. */}
          <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1">
            <button
              type="button"
              onClick={() => setVista('lista')}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition',
                vista === 'lista'
                  ? 'bg-white text-brand-ink shadow-sm'
                  : 'text-brand-muted hover:text-brand-ink',
              )}
              aria-pressed={vista === 'lista'}
            >
              <List size={13} /> Lista
            </button>
            <button
              type="button"
              onClick={() => setVista('cliente')}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition',
                vista === 'cliente'
                  ? 'bg-white text-brand-ink shadow-sm'
                  : 'text-brand-muted hover:text-brand-ink',
              )}
              aria-pressed={vista === 'cliente'}
            >
              <Building2 size={13} /> Por cliente
            </button>
          </div>
          {/* P2-#26 · Mis vistas (filtros guardados) */}
          <SavedViewsMenu
            modulo="vencimientos"
            currentFiltros={{ search, tipo, estado, horizonte, vista }}
            onApply={(f) => {
              if (typeof f.search === 'string') setSearch(f.search);
              if (typeof f.tipo === 'string') setTipo(f.tipo as TipoFilter);
              if (typeof f.estado === 'string') setEstado(f.estado as EstadoFilter);
              if (typeof f.horizonte === 'number') setHorizonte(f.horizonte);
              if (f.vista === 'lista' || f.vista === 'cliente') setVista(f.vista);
            }}
          />
          {/* DGG-26 · Exports PDF/XLS/Copy/CSV agrupados en un dropdown
              (ExportButtons internamente ya unifica los 3). El CSV legacy
              entra como una opción adicional via Sheet/Menu si se quiere;
              por ahora lo dejamos como ghost minimalista. */}
          <ExportButtons
            onExportPdf={onExportPdf}
            onExportXls={onExportXls}
            onCopyCsv={onCopyCsv}
            disabled={filtered.length === 0}
            hint="Vencimientos"
          />
          <Button
            variant="ghost"
            onClick={exportarCSV}
            title="Exportar CSV con los filtros aplicados"
            className="!px-2"
            aria-label="Exportar CSV"
          >
            <Download size={15} />
          </Button>
          {/* Configuración como icono (texto solo en pantallas grandes). */}
          <Link
            to="/gerencia/vencimientos/configuracion"
            title="Configuración de vencimientos"
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2 py-2 text-sm font-medium text-brand-ink transition hover:border-brand-cyan hover:text-brand-cyan"
            aria-label="Configuración"
          >
            <Sliders size={15} />
            <span className="hidden xl:inline">Configuración</span>
          </Link>
          {/* "Nuevo" como icono + texto condicional para no comerse el header. */}
          <Button onClick={() => setDrawerOpen(true)} title="Nuevo vencimiento">
            <Plus size={16} />
            <span className="hidden sm:inline">Nuevo</span>
          </Button>
        </div>
      </header>

      {/* 6.E · banner crítico: vencimientos HOY o vencidos sin renovar. Cierra
          por sesión hasta que se procesen o el usuario los descarte. */}
      {!bannerCerrado && venceHoy.length > 0 && (
        <section
          role="alert"
          className="flex items-center gap-3 rounded-2xl border border-red-300 bg-gradient-to-r from-red-50 via-red-50/90 to-rose-50 p-4 text-sm shadow-sm motion-safe:animate-fade-up"
        >
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-red-100 text-red-600">
            <AlertTriangle size={18} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-display text-base font-bold text-red-800">
              {venceHoy.length === 1
                ? '1 vencimiento requiere acción HOY'
                : `${venceHoy.length} vencimientos requieren acción HOY`}
            </p>
            <p className="mt-0.5 text-xs text-red-700/90">
              Tocá &laquo;Ver&raquo; para enfocarte y resolverlos uno por uno.
            </p>
          </div>
          <Button
            variant="primary"
            onClick={() => {
              setEstado('vigente');
              setHorizonte(30);
            }}
          >
            Ver
          </Button>
          <button
            type="button"
            onClick={() => setBannerCerrado(true)}
            className="rounded-md p-1 text-red-700/70 transition hover:bg-red-100"
            aria-label="Cerrar"
            title="Cerrar hasta la próxima carga"
          >
            ×
          </button>
        </section>
      )}

      {/* KPIs */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard
          icon={CalendarClock}
          label="Vigentes"
          value={<AnimatedNumber value={kpis.vigentes} />}
          tone="cyan"
        />
        <KpiCard
          icon={AlertTriangle}
          label="Próximos 30 d"
          value={<AnimatedNumber value={kpis.proximos30} />}
          tone="amber"
        />
        <KpiCard
          icon={AlertTriangle}
          label="Vencidos"
          value={<AnimatedNumber value={kpis.vencidos} />}
          tone="red"
        />
        <KpiCard
          icon={RefreshCcw}
          label="Renovados (30 d)"
          value={<AnimatedNumber value={kpis.renovados} />}
          tone="teal"
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
              placeholder="Administración, consorcio, descripción…"
              className="pl-9"
            />
          </div>
        </Field>
        <Field label="Tipo" className="sm:w-52">
          <div className="relative">
            <Filter
              size={14}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-brand-muted"
            />
            <Select
              value={tipo}
              onChange={(e) => setTipo(e.target.value as TipoFilter)}
              className="pl-9"
            >
              <option value="todos">Todos</option>
              {VENCIMIENTO_TIPOS.map((t) => (
                <option key={t} value={t}>
                  {VENCIMIENTO_TIPO_LABEL[t]}
                </option>
              ))}
            </Select>
          </div>
        </Field>
        <Field label="Estado" className="sm:w-44">
          <Select
            value={estado}
            onChange={(e) => setEstado(e.target.value as EstadoFilter)}
          >
            <option value="todos">Todos</option>
            {VENCIMIENTO_ESTADOS.map((e) => (
              <option key={e} value={e}>
                {VENCIMIENTO_ESTADO_LABEL[e]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Horizonte" className="sm:w-32">
          <Select
            value={String(horizonte)}
            onChange={(e) => setHorizonte(Number(e.target.value))}
          >
            <option value="30">30 días</option>
            <option value="60">60 días</option>
            <option value="90">90 días</option>
            <option value="180">180 días</option>
            <option value="365">1 año</option>
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
        <div className="relative space-y-4">
          {/* 6.C · Mini-mapa heatmap de vencimientos: vista panorámica de
              los próximos N días. Click en una celda focaliza la lista.
              Sólo en desktop (en mobile ocupa demasiado). */}
          {!loading && rows.length > 0 && (
            <div className="hidden lg:block">
              <MiniMapaVencimientos
                vencimientos={rows}
                dias={horizonte}
                selectedYmd={diaFiltro}
                onPickDay={(ymd, _f, count) => {
                  if (count === 0) return;
                  setDiaFiltro(diaFiltro === ymd ? null : ymd);
                }}
              />
              {diaFiltro && (
                <div className="mt-2 flex items-center gap-2 text-xs">
                  <span className="text-brand-muted">
                    Filtrando por día: {diaFiltro}
                  </span>
                  <button
                    type="button"
                    onClick={() => setDiaFiltro(null)}
                    className="rounded-full bg-brand-cyan-pale/40 px-2 py-0.5 text-brand-cyan hover:bg-brand-cyan-pale"
                  >
                    Quitar filtro
                  </button>
                </div>
              )}
            </div>
          )}
          {loading ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-36 w-full rounded-2xl" />
              ))}
            </div>
          ) : error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              {error}
            </div>
          ) : filtered.length === 0 ? (
            <IllustratedEmpty
              illustration="lista"
              title={
                rows.length === 0
                  ? 'Sin vencimientos registrados'
                  : 'Sin resultados con esos filtros'
              }
              description={
                <>
                  Registrá matrículas, DDJJ y otros datos estratégicos para
                  recibir alertas automáticas y proponer servicios.
                </>
              }
              action={
                <Button onClick={() => setDrawerOpen(true)}>
                  <Plus size={15} /> Nuevo vencimiento
                </Button>
              }
            />
          ) : vista === 'lista' ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {filtered.map((v) => (
                <SelectableCard
                  key={v.id}
                  v={v}
                  selected={selectedIds.has(v.id)}
                  onToggle={isRenovable(v) ? () => toggleSelected(v.id) : undefined}
                >
                  <VencimientoCard
                    venc={v}
                    onPausar={isRenovable(v) ? onPausar : undefined}
                    onReanudar={isRenovable(v) ? onReanudar : undefined}
                    onEliminar={isRenovable(v) ? onEliminar : undefined}
                  />
                </SelectableCard>
              ))}
            </div>
          ) : (
            // 6.A · vista "Por cliente": secciones colapsables por administración.
            <div className="space-y-3">
              {grupos.map((g) => {
                const colapsado = colapsadas.has(g.nombre);
                return (
                  <section
                    key={g.nombre}
                    className="overflow-hidden rounded-2xl border border-slate-200 bg-white"
                  >
                    <button
                      type="button"
                      onClick={() => toggleGrupo(g.nombre)}
                      className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-slate-50"
                      aria-expanded={!colapsado}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <Building2 size={16} className="shrink-0 text-brand-cyan" />
                        <span className="truncate font-display text-base font-bold text-brand-ink">
                          {g.nombre}
                        </span>
                        <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-brand-muted">
                          {g.items.length}
                        </span>
                        {g.criticos30 > 0 && (
                          <span className="shrink-0 rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-700">
                            {g.criticos30} vence{g.criticos30 === 1 ? '' : 'n'} &lt;30d
                          </span>
                        )}
                      </span>
                      <ChevronDown
                        size={18}
                        className={cn(
                          'shrink-0 text-brand-muted transition-transform',
                          colapsado && '-rotate-90',
                        )}
                      />
                    </button>
                    {!colapsado && (
                      <div className="grid gap-3 border-t border-slate-100 p-4 sm:grid-cols-2 lg:grid-cols-3">
                        {g.items.map((v) => (
                          <SelectableCard
                            key={v.id}
                            v={v}
                            selected={selectedIds.has(v.id)}
                            onToggle={
                              isRenovable(v) ? () => toggleSelected(v.id) : undefined
                            }
                          >
                            <VencimientoCard
                              venc={v}
                              onPausar={isRenovable(v) ? onPausar : undefined}
                              onReanudar={isRenovable(v) ? onReanudar : undefined}
                              onEliminar={isRenovable(v) ? onEliminar : undefined}
                            />
                          </SelectableCard>
                        ))}
                      </div>
                    )}
                  </section>
                );
              })}
            </div>
          )}
        </div>
      </section>

      <VencimientoFormDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onSaved={() => void load()}
      />

      {/* FIX-V2 · Eliminados RenovarModal y BulkRenovarModal: la renovación
          siempre viene del cliente (con formulario). La gerencia sólo
          gestiona alertas: pausar / reanudar / eliminar. */}

      {/* FIX-V2 · Barra flotante de selección — ahora ofrece "Pausar masivo"
          en lugar de "Renovar masivo" (regla nueva: la gerencia no renueva). */}
      {selectedIds.size > 0 && (
        <div className="fixed inset-x-0 bottom-4 z-40 flex justify-center px-4 motion-safe:animate-fade-up">
          <div className="flex flex-wrap items-center gap-3 rounded-full border border-slate-200 bg-white px-4 py-2.5 shadow-[0_18px_48px_-15px_rgba(18,34,48,0.35)]">
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-ink">
              <CheckSquare size={13} className="text-brand-cyan" />
              {selectedIds.size}{' '}
              {selectedIds.size === 1 ? 'seleccionado' : 'seleccionados'}
            </span>
            <button
              type="button"
              onClick={selectAllVisible}
              className="text-xs text-brand-muted underline-offset-2 hover:underline"
              title="Marcar todos los visibles"
            >
              Marcar todos
            </button>
            <Button
              variant="tonal"
              onClick={async () => {
                const seleccion = rows.filter((v) => selectedIds.has(v.id));
                if (seleccion.length === 0) return;
                const motivo = await prompt({
                  title: `Pausar alertas (${seleccion.length})`,
                  message: 'Las alertas dejan de enviarse al cliente y al staff.',
                  defaultValue: 'Trámite en curso por otro canal',
                  placeholder: 'Motivo (opcional)',
                  confirmLabel: 'Pausar',
                });
                if (motivo === null) return;
                let ok = 0;
                let err = 0;
                for (const v of seleccion) {
                  const res = await pausarVencimiento(v.id, motivo?.trim() || null);
                  if (res.ok) ok++;
                  else err++;
                }
                clearSelection();
                void load();
                toast.success(`Pausadas: ${ok}${err ? ` · errores: ${err}` : ''}`);
              }}
            >
              <RefreshIcon size={13} /> Pausar masivo
            </Button>
            <button
              type="button"
              onClick={clearSelection}
              className="inline-flex h-7 w-7 items-center justify-center rounded-full text-brand-muted hover:bg-slate-100"
              aria-label="Cancelar selección"
              title="Cancelar selección"
            >
              <CloseIcon size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 6.B · SelectableCard
// Wrapper que rodea a VencimientoCard con un overlay para checkbox de
// selección. Sólo se muestra el checkbox cuando el vencimiento es renovable
// (es decir, onToggle existe). El borde cambia a brand-cyan cuando seleccionado.
// ---------------------------------------------------------------------------
function SelectableCard({
  v,
  selected,
  onToggle,
  children,
}: {
  v: ProximoVencimiento;
  selected: boolean;
  onToggle?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className={cn('relative', selected && 'ring-2 ring-brand-cyan/50 rounded-2xl')}>
      {onToggle && (
        <button
          type="button"
          onClick={onToggle}
          aria-label={selected ? 'Quitar de la selección' : 'Agregar a la selección'}
          aria-pressed={selected}
          title={v.descripcion ?? VENCIMIENTO_TIPO_LABEL[v.tipo]}
          className={cn(
            'absolute left-2 top-2 z-10 inline-flex h-7 w-7 items-center justify-center rounded-md border-2 bg-white/95 transition',
            selected
              ? 'border-brand-cyan bg-brand-cyan text-white shadow'
              : 'border-slate-300 text-brand-muted hover:border-brand-cyan',
          )}
        >
          {selected ? <CheckSquare size={14} /> : <Square size={14} />}
        </button>
      )}
      {children}
    </div>
  );
}

interface KpiCardProps {
  icon: LucideIcon;
  label: string;
  value: React.ReactNode;
  tone: 'cyan' | 'amber' | 'red' | 'teal';
}

const TONE: Record<KpiCardProps['tone'], string> = {
  cyan: 'bg-brand-cyan/10 text-brand-cyan',
  amber: 'bg-amber-50 text-amber-600',
  red: 'bg-red-50 text-red-600',
  teal: 'bg-emerald-50 text-emerald-600',
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
        <p className="font-display text-2xl font-bold text-brand-ink">
          {value}
        </p>
      </div>
    </div>
  );
}
