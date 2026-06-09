import { useEffect, useMemo, useRef, useState } from 'react';
import { Inbox, Eye, Send, Sparkles, XCircle, Archive, Search, AlertTriangle } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import {
  Input,
  RefreshIndicator,
  Switch,
  FilterChips,
  FilterMultiSelect,
  SegmentCard,
  ResultCount,
  type FilterTone,
} from '@/components/common';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import { IllustratedEmpty } from '@/components/brand/IllustratedEmpty';
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh';
import { toast } from '@/lib/toast';
import {
  listSolicitudes,
  type SolicitudEstado,
  type SolicitudListItem,
} from '@/services/api/solicitudes';
import { SolicitudCard, SolicitudCardSkeleton } from '../components/SolicitudCard';
import { ExportButtons } from '@/components/reports/ExportButtons';
import { generateReportPdf } from '@/lib/reportPdf';
import { generateReportXls } from '@/lib/reportXls';
import { humanizeError } from '@/lib/errors';

// Estados activos (esperan acción del gerente) vs cerrados.
const ACTIVE_SOL: SolicitudEstado[] = ['recibida', 'en_revision', 'derivada'];
const CLOSED_SOL: SolicitudEstado[] = ['activada', 'rechazada', 'descartada'];

// Segmentos = estados de triage como cards-filtro (las "KPI cards que filtran").
const SOL_SEGMENTOS: Record<SolicitudEstado, { label: string; icon: LucideIcon; tone: FilterTone }> = {
  recibida: { label: 'Sin revisar', icon: Inbox, tone: 'cyan' },
  en_revision: { label: 'En revisión', icon: Eye, tone: 'amber' },
  derivada: { label: 'Derivadas', icon: Send, tone: 'violet' },
  activada: { label: 'Activadas', icon: Sparkles, tone: 'emerald' },
  rechazada: { label: 'Rechazadas', icon: XCircle, tone: 'red' },
  descartada: { label: 'Descartadas', icon: Archive, tone: 'slate' },
};

const ORIGEN_LABEL: Record<string, string> = {
  landing: 'Landing',
  cliente: 'Portal cliente',
  publico: 'Público',
  portal: 'Portal cliente',
};

const MAX_UNIVERSO = 1000;

export function SolicitudesListPage() {
  const [universe, setUniverse] = useState<SolicitudListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Estado de filtro (efímero — decisión de Pablo, F8).
  const [soloActivos, setSoloActivos] = useState(true);
  const [segEstado, setSegEstado] = useState<SolicitudEstado | null>(null);
  const [categorias, setCategorias] = useState<string[]>([]);
  const [servicios, setServicios] = useState<string[]>([]);
  const [origenes, setOrigenes] = useState<string[]>([]);
  const [search, setSearch] = useState('');

  const firstLoadDoneRef = useRef(false);
  async function load() {
    if (firstLoadDoneRef.current) setRefreshing(true);
    else setLoading(true);
    setError(null);
    const res = await listSolicitudes({ estado: soloActivos ? 'activas' : 'todos', limit: MAX_UNIVERSO });
    setLoading(false);
    setRefreshing(false);
    firstLoadDoneRef.current = true;
    if (!res.ok) {
      setError(humanizeError(res.error));
      toast.error(`No pudimos cargar las solicitudes: ${humanizeError(res.error)}`);
      return;
    }
    setUniverse(res.data.rows);
    setTotal(res.data.total);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [soloActivos]);

  useRealtimeRefresh(['solicitudes', 'solicitud_derivaciones'], () => void load());

  function toggleSoloActivos(v: boolean) {
    setSoloActivos(v);
    // si el segmento elegido era un estado cerrado y volvemos a "solo activos", limpiarlo
    if (v && segEstado && !ACTIVE_SOL.includes(segEstado)) setSegEstado(null);
  }
  function toggleSeg(e: SolicitudEstado) {
    setSegEstado((prev) => (prev === e ? null : e));
  }
  function clear() {
    setSegEstado(null);
    setCategorias([]);
    setServicios([]);
    setOrigenes([]);
    setSearch('');
  }

  // Estados visibles como segment cards (3 activos, o 6 al apagar el switch).
  const estadosVisibles = soloActivos ? ACTIVE_SOL : [...ACTIVE_SOL, ...CLOSED_SOL];

  // Conteos de segmentos sobre el universo (R19).
  const counts = useMemo(() => {
    const c = {} as Record<SolicitudEstado, number>;
    for (const e of [...ACTIVE_SOL, ...CLOSED_SOL]) c[e] = 0;
    for (const r of universe) {
      const e = r.estado as SolicitudEstado;
      if (c[e] != null) c[e] += 1;
    }
    return c;
  }, [universe]);

  // Opciones de Categoría / Servicio / Origen presentes en el universo (con conteo).
  const categoriaOpts = useMemo(() => optionsFrom(universe, (r) => r.formulario_categoria), [universe]);
  const servicioOpts = useMemo(
    () => optionsFrom(universe, (r) => r.servicio_solicitado_id, (r) => r.servicio_nombre),
    [universe],
  );
  const origenOpts = useMemo(
    () => optionsFrom(universe, (r) => r.origen_canal, (r) => ORIGEN_LABEL[r.origen_canal ?? ''] ?? r.origen_canal),
    [universe],
  );

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return universe.filter((r) => {
      if (segEstado && r.estado !== segEstado) return false;
      if (categorias.length && !categorias.includes(r.formulario_categoria ?? '')) return false;
      if (servicios.length && !servicios.includes(r.servicio_solicitado_id ?? '')) return false;
      if (origenes.length && !origenes.includes(r.origen_canal ?? '')) return false;
      if (needle) {
        const hay = `${r.solicitante_nombre ?? ''} ${r.solicitante_email ?? ''} ${r.solicitante_telefono ?? ''} ${r.formulario_titulo ?? ''}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [universe, segEstado, categorias, servicios, origenes, search]);

  const hasFilters = segEstado !== null || categorias.length > 0 || servicios.length > 0 || origenes.length > 0 || search.trim().length > 0;
  const universoTruncado = total > universe.length;

  const exportFiltros = useMemo<Array<{ label: string; value: string }>>(() => {
    const items: Array<{ label: string; value: string }> = [];
    items.push({ label: 'Vista', value: soloActivos ? 'Solo activas' : 'Todas' });
    if (segEstado) items.push({ label: 'Estado', value: SOL_SEGMENTOS[segEstado].label });
    if (categorias.length) items.push({ label: 'Categoría', value: categorias.join(', ') });
    if (search.trim()) items.push({ label: 'Búsqueda', value: search.trim() });
    return items;
  }, [soloActivos, segEstado, categorias, search]);

  function formatFecha(s: string | null): string {
    if (!s) return '—';
    try { return new Date(s).toLocaleDateString('es-AR'); } catch { return s; }
  }

  async function onExportPdf() {
    await generateReportPdf<SolicitudListItem>({
      filename: `solicitudes-${new Date().toISOString().slice(0, 10)}`,
      titulo: 'Solicitudes recibidas',
      subtitulo: 'Centro de solicitudes · Gestión Global',
      filtros: exportFiltros,
      kpis: estadosVisibles.map((e) => ({
        label: SOL_SEGMENTOS[e].label,
        value: String(counts[e]),
        tone: (SOL_SEGMENTOS[e].tone === 'red' ? 'rose' : SOL_SEGMENTOS[e].tone === 'amber' ? 'amber' : SOL_SEGMENTOS[e].tone === 'emerald' ? 'emerald' : SOL_SEGMENTOS[e].tone === 'cyan' ? 'cyan' : 'ink') as 'rose' | 'amber' | 'emerald' | 'cyan' | 'ink',
      })),
      columns: [
        { key: 'created_at', label: 'Fecha', width: '14%', format: (r) => formatFecha(r.created_at) },
        { key: 'solicitante_nombre', label: 'Solicitante', width: '24%', format: (r) => r.solicitante_nombre ?? '—' },
        { key: 'formulario_categoria', label: 'Categoría', width: '18%', format: (r) => r.formulario_categoria ?? '—' },
        { key: 'formulario_titulo', label: 'Formulario', width: '26%', format: (r) => r.formulario_titulo ?? '—' },
        { key: 'estado', label: 'Estado', width: '18%' },
      ],
      rows: filtered,
    });
  }

  async function onExportXls() {
    generateReportXls<SolicitudListItem>({
      filename: `solicitudes-${new Date().toISOString().slice(0, 10)}`,
      sheetName: 'Solicitudes',
      titulo: 'Solicitudes recibidas · Gestión Global',
      filtros: exportFiltros,
      columns: [
        { key: 'created_at', label: 'Fecha', value: (r) => (r.created_at ? new Date(r.created_at) : null), width: 14 },
        { key: 'solicitante_nombre', label: 'Solicitante', width: 28, value: (r) => r.solicitante_nombre ?? '' },
        { key: 'solicitante_email', label: 'Email', width: 28, value: (r) => r.solicitante_email ?? '' },
        { key: 'solicitante_telefono', label: 'Teléfono', width: 18, value: (r) => r.solicitante_telefono ?? '' },
        { key: 'formulario_categoria', label: 'Categoría', width: 18, value: (r) => r.formulario_categoria ?? '' },
        { key: 'formulario_titulo', label: 'Formulario', width: 28, value: (r) => r.formulario_titulo ?? '' },
        { key: 'estado', label: 'Estado', width: 14 },
      ],
      rows: filtered,
    });
  }

  return (
    <div className="relative mx-auto max-w-6xl space-y-6">
      <RefreshIndicator show={refreshing} />
      <TrianglesAccent position="top-right" size={240} tone="cyan" density="soft" className="opacity-40" />

      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="kicker text-brand-cyan">Operación</p>
          <h1 className="font-display text-3xl font-bold text-brand-ink sm:text-4xl">Solicitudes recibidas</h1>
          <p className="mt-1 max-w-2xl text-sm text-brand-muted">
            Cada formulario público se convierte en una solicitud operativa. Acá las revisás, derivás a gestoría y las activás como tracking del cliente.
          </p>
        </div>
        <ExportButtons onExportPdf={onExportPdf} onExportXls={onExportXls} disabled={filtered.length === 0} hint="Solicitudes" />
      </header>

      {/* F8 · Segmentos = estados de triage como cards-filtro */}
      <section className={`grid grid-cols-2 gap-3 ${soloActivos ? 'sm:grid-cols-3' : 'sm:grid-cols-3 lg:grid-cols-6'}`}>
        {estadosVisibles.map((e) => {
          const cfg = SOL_SEGMENTOS[e];
          return (
            <SegmentCard
              key={e}
              label={cfg.label}
              count={counts[e]}
              icon={cfg.icon}
              tone={cfg.tone}
              active={segEstado === e}
              onClick={() => toggleSeg(e)}
            />
          );
        })}
      </section>

      {/* F8 · Barra de filtros premium */}
      <section className="card-premium space-y-3 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-brand-muted" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nombre, email, teléfono, formulario…" className="pl-9" />
          </div>
          <Switch
            checked={soloActivos}
            onChange={toggleSoloActivos}
            label="Solo activas"
            hint={soloActivos ? '(oculta cerradas)' : '(mostrando todo)'}
          />
          <ResultCount shown={filtered.length} total={universe.length} hasFilters={hasFilters} onClear={clear} noun="solicitudes" />
        </div>

        {(categoriaOpts.length > 0 || servicioOpts.length > 0 || origenOpts.length > 1) && (
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2.5">
            {origenOpts.length > 1 && (
              <div className="flex items-center gap-2">
                <span className="kicker text-brand-muted">Origen</span>
                <FilterChips
                  options={origenOpts.map((o) => ({ value: o.value, label: o.label }))}
                  selected={origenes}
                  onChange={setOrigenes}
                  ariaLabel="Filtrar por origen"
                />
              </div>
            )}
            {categoriaOpts.length > 0 && (
              <FilterMultiSelect label="Categoría" options={categoriaOpts} selected={categorias} onChange={setCategorias} />
            )}
            {servicioOpts.length > 0 && (
              <FilterMultiSelect label="Servicio" options={servicioOpts} selected={servicios} onChange={setServicios} searchable />
            )}
          </div>
        )}
      </section>

      {universoTruncado && (
        <p className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <AlertTriangle size={13} className="shrink-0" />
          Mostrando {universe.length} de {total} solicitudes. Afiná los filtros para no perder ninguna.
        </p>
      )}

      {loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => <SolicitudCardSkeleton key={i} />)}
        </div>
      ) : error ? (
        <div className="card-premium p-8 text-center text-sm text-red-600">{error}</div>
      ) : filtered.length === 0 ? (
        <IllustratedEmpty
          illustration="lista"
          title={hasFilters ? 'Sin solicitudes con estos filtros' : 'Sin solicitudes activas'}
          description={hasFilters ? 'Ajustá o limpiá los filtros para ver más.' : 'Las solicitudes aparecen automáticamente cuando alguien envía un formulario público.'}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((r) => <SolicitudCard key={r.id} s={r} />)}
        </div>
      )}
    </div>
  );
}

// Helper: opciones {value,label,count} para multiselect/chips desde el universo.
function optionsFrom(
  rows: SolicitudListItem[],
  getValue: (r: SolicitudListItem) => string | null | undefined,
  getLabel?: (r: SolicitudListItem) => string | null | undefined,
): { value: string; label: string; count: number }[] {
  const map = new Map<string, { label: string; count: number }>();
  for (const r of rows) {
    const v = getValue(r);
    if (!v) continue;
    const prev = map.get(v);
    if (prev) prev.count += 1;
    else map.set(v, { label: (getLabel ? getLabel(r) : v) || v, count: 1 });
  }
  return [...map.entries()].map(([value, x]) => ({ value, label: x.label, count: x.count })).sort((a, b) => a.label.localeCompare(b.label));
}
