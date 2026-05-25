import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Eye,
  Inbox,
  Send,
  Sparkles,
  Search,
  Filter,
  Tag,
} from 'lucide-react';
import {
  AnimatedNumber,
  Field,
  Input,
  Select,
} from '@/components/common';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import { IllustratedEmpty } from '@/components/brand/IllustratedEmpty';
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh';
import {
  getKpis,
  listSolicitudes,
  type SolicitudEstado,
  type SolicitudListItem,
  type SolicitudesKpis,
} from '@/services/api/solicitudes';
import {
  SolicitudCard,
  SolicitudCardSkeleton,
} from '../components/SolicitudCard';
import { ExportButtons } from '@/components/reports/ExportButtons';
import { generateReportPdf } from '@/lib/reportPdf';
import { generateReportXls } from '@/lib/reportXls';

type EstadoFilter = SolicitudEstado | 'todos' | 'activas';

export function SolicitudesListPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [rows, setRows] = useState<SolicitudListItem[]>([]);
  const [kpis, setKpis] = useState<SolicitudesKpis | null>(null);
  const [loading, setLoading] = useState(true);
  const [estado, setEstado] = useState<EstadoFilter>(
    (searchParams.get('estado') as EstadoFilter) || 'activas',
  );
  const [search, setSearch] = useState('');
  // 1.E · filtro por categoría compartible vía URL (?cat=…).
  const [categoria, setCategoria] = useState<string>(
    searchParams.get('cat') ?? '',
  );

  async function reload() {
    setLoading(true);
    const [r1, r2] = await Promise.all([
      listSolicitudes({ estado, search }),
      getKpis(),
    ]);
    setLoading(false);
    if (r1.ok) setRows(r1.data.rows);
    if (r2.ok) setKpis(r2.data);
  }

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  useEffect(() => {
    const t = setTimeout(() => void reload(), 280);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  useRealtimeRefresh(['solicitudes', 'solicitud_derivaciones'], reload);

  // 1.E · categorías presentes en el set para filtrar.
  const categoriasDisponibles = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) if (r.formulario_categoria) set.add(r.formulario_categoria);
    return Array.from(set).sort();
  }, [rows]);

  // 1.E · aplicar filtro categoría client-side + sync URL.
  const rowsFiltrados = useMemo(
    () => (categoria ? rows.filter((r) => r.formulario_categoria === categoria) : rows),
    [rows, categoria],
  );

  // 1.E · sync filtros relevantes a la URL para que el link sea compartible.
  useEffect(() => {
    const params = new URLSearchParams(searchParams);
    if (estado !== 'activas') params.set('estado', estado);
    else params.delete('estado');
    if (categoria) params.set('cat', categoria);
    else params.delete('cat');
    setSearchParams(params, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado, categoria]);

  const kpiCards = useMemo(
    () => [
      {
        label: 'Recibidas',
        value: kpis?.recibidas ?? 0,
        icon: Inbox,
        tone: 'cyan' as const,
      },
      {
        label: 'En revisión',
        value: kpis?.en_revision ?? 0,
        icon: Eye,
        tone: 'amber' as const,
      },
      {
        label: 'Derivadas',
        value: kpis?.derivadas ?? 0,
        icon: Send,
        tone: 'violet' as const,
      },
      {
        label: 'Activadas hoy',
        value: kpis?.activadas_hoy ?? 0,
        icon: Sparkles,
        tone: 'emerald' as const,
      },
    ],
    [kpis],
  );

  // DGG-26 · Export a PDF/XLS del filtrado actual.
  const exportFiltros = useMemo<Array<{ label: string; value: string }>>(() => {
    const items: Array<{ label: string; value: string }> = [];
    const estadoLabel: Record<EstadoFilter, string> = {
      activas: 'Activas (no procesadas)',
      recibida: 'Recibidas',
      en_revision: 'En revisión',
      derivada: 'Derivadas',
      activada: 'Activadas',
      descartada: 'Descartadas',
      todos: 'Todas',
    };
    items.push({ label: 'Estado', value: estadoLabel[estado] ?? estado });
    if (categoria) items.push({ label: 'Categoría', value: categoria });
    if (search.trim()) items.push({ label: 'Búsqueda', value: search.trim() });
    return items;
  }, [estado, categoria, search]);

  function formatFecha(s: string | null): string {
    if (!s) return '—';
    try {
      return new Date(s).toLocaleDateString('es-AR');
    } catch {
      return s;
    }
  }

  async function onExportPdf() {
    await generateReportPdf<SolicitudListItem>({
      filename: `solicitudes-${new Date().toISOString().slice(0, 10)}`,
      titulo: 'Solicitudes recibidas',
      subtitulo: 'Centro de solicitudes · Gestión Global',
      filtros: exportFiltros,
      kpis: [
        { label: 'Recibidas', value: String(kpis?.recibidas ?? 0), tone: 'cyan' },
        { label: 'En revisión', value: String(kpis?.en_revision ?? 0), tone: 'amber' },
        { label: 'Derivadas', value: String(kpis?.derivadas ?? 0), tone: 'cyan' },
        { label: 'Activadas hoy', value: String(kpis?.activadas_hoy ?? 0), tone: 'emerald' },
      ],
      columns: [
        { key: 'created_at', label: 'Fecha', width: '14%', format: (r) => formatFecha(r.created_at) },
        { key: 'solicitante_nombre', label: 'Solicitante', width: '24%',
          format: (r) => r.solicitante_nombre ?? '—' },
        { key: 'formulario_categoria', label: 'Categoría', width: '18%',
          format: (r) => r.formulario_categoria ?? '—' },
        { key: 'formulario_titulo', label: 'Formulario', width: '26%',
          format: (r) => r.formulario_titulo ?? '—' },
        { key: 'estado', label: 'Estado', width: '18%' },
      ],
      rows: rowsFiltrados,
    });
  }

  async function onExportXls() {
    generateReportXls<SolicitudListItem>({
      filename: `solicitudes-${new Date().toISOString().slice(0, 10)}`,
      sheetName: 'Solicitudes',
      titulo: 'Solicitudes recibidas · Gestión Global',
      filtros: exportFiltros,
      columns: [
        { key: 'created_at', label: 'Fecha',
          value: (r) => r.created_at ? new Date(r.created_at) : null, width: 14 },
        { key: 'solicitante_nombre', label: 'Solicitante', width: 28,
          value: (r) => r.solicitante_nombre ?? '' },
        { key: 'solicitante_email', label: 'Email', width: 28,
          value: (r) => r.solicitante_email ?? '' },
        { key: 'solicitante_telefono', label: 'Teléfono', width: 18,
          value: (r) => r.solicitante_telefono ?? '' },
        { key: 'formulario_categoria', label: 'Categoría', width: 18,
          value: (r) => r.formulario_categoria ?? '' },
        { key: 'formulario_titulo', label: 'Formulario', width: 28,
          value: (r) => r.formulario_titulo ?? '' },
        { key: 'estado', label: 'Estado', width: 14 },
      ],
      rows: rowsFiltrados,
    });
  }

  return (
    <div className="relative mx-auto max-w-6xl space-y-6">
      <TrianglesAccent
        position="top-right"
        size={240}
        tone="cyan"
        density="soft"
        className="opacity-40"
      />

      {/* Header */}
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="kicker text-brand-cyan">Operación</p>
          <h1 className="font-display text-3xl font-bold text-brand-ink sm:text-4xl">
            Solicitudes recibidas
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-brand-muted">
            Cada formulario público se convierte automáticamente en una solicitud
            operativa. Acá las revisás, derivás a gestoría y las activás como
            tracking del cliente.
          </p>
        </div>
        <ExportButtons
          onExportPdf={onExportPdf}
          onExportXls={onExportXls}
          disabled={rowsFiltrados.length === 0}
          hint="Solicitudes"
        />
      </header>

      {/* KPIs */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {kpiCards.map((k) => (
          <KpiCard key={k.label} {...k} />
        ))}
      </section>

      {/* Toolbar */}
      <section className="card-premium flex flex-col gap-3 p-4 sm:flex-row sm:items-end">
        <Field label="Buscar solicitante" className="flex-1">
          <div className="relative">
            <Search
              size={15}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-brand-muted"
            />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Nombre, email o teléfono…"
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
              onChange={(e) => setEstado(e.target.value as EstadoFilter)}
              className="pl-9"
            >
              <option value="activas">Activas (no procesadas)</option>
              <option value="recibida">Recibidas</option>
              <option value="en_revision">En revisión</option>
              <option value="derivada">Derivadas</option>
              <option value="activada">Activadas</option>
              <option value="descartada">Descartadas</option>
              <option value="todos">Todas</option>
            </Select>
          </div>
        </Field>
        {/* 1.E · filtro categoría — sólo se muestra si hay categorías. */}
        {categoriasDisponibles.length > 0 && (
          <Field label="Categoría" className="sm:w-48">
            <div className="relative">
              <Tag
                size={14}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-brand-muted"
              />
              <Select
                value={categoria}
                onChange={(e) => setCategoria(e.target.value)}
                className="pl-9"
              >
                <option value="">Todas</option>
                {categoriasDisponibles.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </div>
          </Field>
        )}
      </section>

      {/* Grilla de cards */}
      {loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <SolicitudCardSkeleton key={i} />
          ))}
        </div>
      ) : rowsFiltrados.length === 0 ? (
        <IllustratedEmpty
          illustration="lista"
          title="Sin solicitudes en este filtro"
          description="Las solicitudes aparecen automáticamente cuando alguien envía un formulario público desde la landing."
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rowsFiltrados.map((r) => (
            <SolicitudCard key={r.id} s={r} />
          ))}
        </div>
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------

interface KpiCardProps {
  label: string;
  value: number;
  icon: typeof Inbox;
  tone: 'cyan' | 'amber' | 'violet' | 'emerald';
}

const TONE_CLASSES: Record<KpiCardProps['tone'], string> = {
  cyan: 'bg-brand-cyan-pale/40 text-brand-cyan',
  amber: 'bg-amber-50 text-amber-600',
  violet: 'bg-violet-50 text-violet-600',
  emerald: 'bg-emerald-50 text-emerald-600',
};

function KpiCard({ label, value, icon: Icon, tone }: KpiCardProps) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-sm motion-safe:animate-fade-up">
      <TrianglesAccent
        position="top-right"
        size={90}
        tone="cyan"
        density="soft"
        className="opacity-30"
      />
      <div className="relative flex items-center gap-3">
        <span
          className={`grid h-9 w-9 place-items-center rounded-xl ${TONE_CLASSES[tone]}`}
        >
          <Icon size={16} />
        </span>
        <div className="min-w-0">
          <p className="kicker truncate text-brand-muted">{label}</p>
          <p className="font-display text-2xl font-bold tabular text-brand-ink">
            <AnimatedNumber value={value} />
          </p>
        </div>
      </div>
    </div>
  );
}
