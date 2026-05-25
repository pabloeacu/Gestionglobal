import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Search,
  Filter,
  Sliders,
  FileEdit,
  Users,
} from 'lucide-react';
import { toast } from '@/lib/toast';
import {
  Field,
  Input,
  Select,
  Skeleton,
} from '@/components/common';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import { IllustratedEmpty } from '@/components/brand/IllustratedEmpty';
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh';
import { AccionRecuperoCard } from '../components/AccionRecuperoCard';
import { MorososKpiStrip } from '../components/MorososKpiStrip';
import {
  listAcciones,
  getKpis,
  RECUPERO_NIVELES,
  RECUPERO_NIVEL_LABEL,
  type AccionListItem,
  type RecuperoKpis,
  type RecuperoNivel,
} from '@/services/api/recupero';
import { ExportButtons } from '@/components/reports/ExportButtons';
import { generateReportPdf } from '@/lib/reportPdf';
import { generateReportXls } from '@/lib/reportXls';

type NivelFilter = RecuperoNivel | 'todos';

export function RecuperoListPage() {
  const [rows, setRows] = useState<AccionListItem[]>([]);
  const [kpis, setKpis] = useState<RecuperoKpis>({
    deuda_total: 0,
    morosos_count: 0,
    r1_30d: 0,
    r2_30d: 0,
    r3_30d: 0,
  });
  const [loading, setLoading] = useState(true);
  const [loadingKpis, setLoadingKpis] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [nivel, setNivel] = useState<NivelFilter>('todos');

  async function load() {
    setLoading(true);
    setError(null);
    const res = await listAcciones({ nivel: nivel === 'todos' ? 'todos' : nivel });
    setLoading(false);
    if (!res.ok) {
      setError(res.error.message);
      toast.error(`No pudimos cargar las acciones: ${res.error.message}`);
      return;
    }
    setRows(res.data.rows);
  }

  async function loadKpis() {
    setLoadingKpis(true);
    const res = await getKpis();
    setLoadingKpis(false);
    if (res.ok) setKpis(res.data);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nivel]);

  useEffect(() => {
    void loadKpis();
  }, []);

  useRealtimeRefresh(['recupero_acciones', 'comprobantes'], () => {
    void load();
    void loadKpis();
  });

  const filtered = useMemo(() => {
    if (!search.trim()) return rows;
    const s = search.trim().toLowerCase();
    return rows.filter((r) =>
      [r.administracion_nombre, r.consorcio_nombre, r.observaciones]
        .filter(Boolean)
        .some((x) => x!.toLowerCase().includes(s)),
    );
  }, [rows, search]);

  // DGG-26 · Export a PDF/XLS del filtrado actual.
  const exportFiltros = useMemo<Array<{ label: string; value: string }>>(() => {
    const items: Array<{ label: string; value: string }> = [];
    items.push({
      label: 'Nivel',
      value: nivel === 'todos' ? 'Todos' : RECUPERO_NIVEL_LABEL[nivel as RecuperoNivel] ?? String(nivel),
    });
    if (search.trim()) items.push({ label: 'Búsqueda', value: search.trim() });
    return items;
  }, [nivel, search]);

  function formatMoney(n: number | string | null): string {
    const v = Number(n ?? 0);
    return new Intl.NumberFormat('es-AR', {
      style: 'currency',
      currency: 'ARS',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(v);
  }

  function formatFecha(s: string | null): string {
    if (!s) return '—';
    try {
      return new Date(s).toLocaleDateString('es-AR');
    } catch {
      return s;
    }
  }

  async function onExportPdf() {
    await generateReportPdf<AccionListItem>({
      filename: `recupero-${new Date().toISOString().slice(0, 10)}`,
      titulo: 'Acciones de recupero',
      subtitulo: 'Gestión progresiva de mora · Gestión Global',
      filtros: exportFiltros,
      kpis: [
        { label: 'Deuda total', value: formatMoney(kpis.deuda_total), tone: 'rose' },
        { label: 'Morosos', value: String(kpis.morosos_count), tone: 'amber' },
        { label: 'R1 30d', value: String(kpis.r1_30d), tone: 'cyan' },
        { label: 'R2/R3 30d', value: String(kpis.r2_30d + kpis.r3_30d), tone: 'rose' },
      ],
      columns: [
        { key: 'administracion_nombre', label: 'Administración', width: '30%',
          format: (r) => r.administracion_nombre ?? '—' },
        { key: 'monto_adeudado', label: 'Deuda', align: 'right', width: '14%',
          format: (r) => formatMoney(r.monto_adeudado) },
        { key: 'dias_vencido', label: 'Días mora', align: 'right', width: '12%',
          format: (r) => String(r.dias_vencido ?? '—') },
        { key: 'nivel', label: 'Nivel', width: '14%',
          format: (r) => RECUPERO_NIVEL_LABEL[r.nivel as RecuperoNivel] ?? String(r.nivel) },
        { key: 'enviado_at', label: 'Última gestión', width: '14%',
          format: (r) => formatFecha(r.enviado_at) },
        { key: 'autor_nombre', label: 'Autor', width: '16%',
          format: (r) => r.autor_nombre ?? '—' },
      ],
      rows: filtered,
    });
  }

  async function onExportXls() {
    generateReportXls<AccionListItem>({
      filename: `recupero-${new Date().toISOString().slice(0, 10)}`,
      sheetName: 'Recupero',
      titulo: 'Recupero · Gestión Global',
      filtros: exportFiltros,
      columns: [
        { key: 'administracion_nombre', label: 'Administración', width: 32,
          value: (r) => r.administracion_nombre ?? '' },
        { key: 'consorcio_nombre', label: 'Consorcio', width: 24,
          value: (r) => r.consorcio_nombre ?? '' },
        { key: 'monto_adeudado', label: 'Deuda', width: 16,
          value: (r) => Number(r.monto_adeudado ?? 0) },
        { key: 'dias_vencido', label: 'Días mora', width: 12,
          value: (r) => Number(r.dias_vencido ?? 0) },
        { key: 'nivel', label: 'Nivel', width: 12,
          value: (r) => RECUPERO_NIVEL_LABEL[r.nivel as RecuperoNivel] ?? String(r.nivel) },
        { key: 'enviado_at', label: 'Última gestión', width: 16,
          value: (r) => r.enviado_at ? new Date(r.enviado_at) : null },
        { key: 'autor_nombre', label: 'Autor', width: 22,
          value: (r) => r.autor_nombre ?? '' },
      ],
      rows: filtered,
    });
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="kicker text-brand-cyan">Cobranzas · MDC-17</p>
          <h1 className="font-display text-3xl font-bold text-brand-ink sm:text-4xl">
            Recupero
          </h1>
          <p className="mt-1 text-sm text-brand-muted">
            Gestión progresiva de mora con niveles R1 (amistoso), R2 (firme) y R3
            (prejudicial). Cada acción queda persistida y envía un email al cliente.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ExportButtons
            onExportPdf={onExportPdf}
            onExportXls={onExportXls}
            disabled={filtered.length === 0}
            hint="Recupero"
          />
          <Link
            to="/gerencia/recupero/plantillas"
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-brand-ink transition hover:border-brand-cyan hover:text-brand-cyan"
          >
            <FileEdit size={15} /> Plantillas
          </Link>
          <Link
            to="/gerencia/recupero/configuracion"
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-brand-ink transition hover:border-brand-cyan hover:text-brand-cyan"
          >
            <Sliders size={15} /> Configuración
          </Link>
          <Link
            to="/gerencia/recupero/morosos"
            className="inline-flex items-center gap-2 rounded-lg bg-brand-ink px-3 py-2 text-sm font-medium text-white transition hover:bg-brand-cyan"
          >
            <Users size={15} /> Morosos
          </Link>
        </div>
      </header>

      <MorososKpiStrip kpis={kpis} loading={loadingKpis} />

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
              placeholder="Administración, consorcio, observaciones…"
              className="pl-9"
            />
          </div>
        </Field>
        <Field label="Nivel" className="sm:w-52">
          <div className="relative">
            <Filter
              size={14}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-brand-muted"
            />
            <Select
              value={String(nivel)}
              onChange={(e) =>
                setNivel(
                  e.target.value === 'todos'
                    ? 'todos'
                    : (Number(e.target.value) as RecuperoNivel),
                )
              }
              className="pl-9"
            >
              <option value="todos">Todos</option>
              {RECUPERO_NIVELES.map((n) => (
                <option key={n} value={n}>
                  {RECUPERO_NIVEL_LABEL[n]}
                </option>
              ))}
            </Select>
          </div>
        </Field>
      </section>

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
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-44 w-full rounded-2xl" />
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
                  ? 'Sin acciones de recupero aún'
                  : 'Sin resultados con esos filtros'
              }
              description={
                <>
                  Cuando dispares un R1, R2 o R3 desde la página de morosos,
                  la gestión va a aparecer acá con el historial completo.
                </>
              }
              action={
                <Link
                  to="/gerencia/recupero/morosos"
                  className="inline-flex items-center gap-2 rounded-lg bg-brand-ink px-3 py-2 text-sm font-medium text-white transition hover:bg-brand-cyan"
                >
                  <Users size={15} /> Ver morosos
                </Link>
              }
            />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {filtered.map((a) => (
                <AccionRecuperoCard key={a.id} accion={a} />
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

